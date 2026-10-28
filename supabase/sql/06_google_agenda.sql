-- =============================================================================
-- SINCRONIZAÇÃO COM O GOOGLE AGENDA (agenda compartilhada da equipe)
--
-- Sempre que escalas publicadas mudam — publicação do mês, troca aceita,
-- mudança de data/horário/sessão/função/técnico ou exclusão — o trigger avisa
-- a Edge Function `sync-google-calendar`, que atualiza um evento por sessão.
-- Rascunhos, check-in/check-out e lembretes não disparam nada.
-- Ausências programadas também viram eventos (dia inteiro, um por período,
-- sem o motivo): cadastrar, encurtar ou cancelar atualiza a agenda.
--
-- A conexão (chave da Service Account + ID da agenda) é feita pelo admin no
-- app, em "Google Agenda", e fica gravada em google_agenda_config. Com a
-- sincronização desativada (ou sem configuração) o trigger não chama nada.
--
-- Antes de executar:
--   1. Os segredos `cron_secret` e `service_role_key` precisam existir no Vault
--      (os mesmos do 04_cron_lembretes.sql — veja as instruções lá).
--   2. Substitua <SEU_PROJECT_REF> abaixo.
--   3. Faça o deploy: supabase functions deploy sync-google-calendar
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net;

-- Configuração única (id = 1). RLS ligada e sem policies: só a service_role
-- (Edge Function) lê e grava — a chave privada nunca chega ao navegador.
CREATE TABLE IF NOT EXISTS public.google_agenda_config (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    calendar_id VARCHAR(255) NOT NULL,
    service_account TEXT NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.google_agenda_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_agenda_config FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_agenda_config TO service_role;

-- Chama a Edge Function. pg_net é assíncrono: a requisição só sai depois do
-- COMMIT e uma falha aqui nunca impede a alteração de ser salva.
CREATE OR REPLACE FUNCTION public.notificar_google_agenda(p_body JSONB)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://<SEU_PROJECT_REF>.supabase.co/functions/v1/sync-google-calendar',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := p_body
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Google Agenda: não foi possível agendar a sincronização: %', SQLERRM;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.notificar_google_agenda(JSONB) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sincronizar_google_agenda()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sessoes JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.google_agenda_config WHERE ativo) THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT jsonb_agg(DISTINCT jsonb_build_object('data', n.data, 'tipo_sessao', n.tipo_sessao))
      INTO v_sessoes
      FROM novas n
     WHERE n.publicada;

  ELSIF TG_OP = 'DELETE' THEN
    SELECT jsonb_agg(DISTINCT jsonb_build_object('data', o.data, 'tipo_sessao', o.tipo_sessao))
      INTO v_sessoes
      FROM antigas o
     WHERE o.publicada;

  ELSE
    -- Sessão de origem e de destino (a escala pode ter mudado de dia/sessão)
    WITH mudancas AS (
      SELECT o.data AS data_antiga, o.tipo_sessao AS sessao_antiga, n.data, n.tipo_sessao
        FROM antigas o
        JOIN novas n ON n.id = o.id
       WHERE (o.publicada OR n.publicada)
         AND (o.data, o.hora_inicio, o.tipo_sessao, o.funcao, o.membro_original_id,
              o.membro_substituto_id, o.status_substituicao, o.publicada)
             IS DISTINCT FROM
             (n.data, n.hora_inicio, n.tipo_sessao, n.funcao, n.membro_original_id,
              n.membro_substituto_id, n.status_substituicao, n.publicada)
    )
    SELECT jsonb_agg(DISTINCT s)
      INTO v_sessoes
      FROM (
        SELECT jsonb_build_object('data', data_antiga, 'tipo_sessao', sessao_antiga) AS s FROM mudancas
        UNION ALL
        SELECT jsonb_build_object('data', data, 'tipo_sessao', tipo_sessao) FROM mudancas
      ) x;
  END IF;

  IF v_sessoes IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM public.notificar_google_agenda(jsonb_build_object('sessoes', v_sessoes));
  RETURN NULL;
END;
$$;

-- Ausências: manda os ids afetados; a função relê cada um (removido = apaga o evento)
CREATE OR REPLACE FUNCTION public.sincronizar_google_agenda_ausencias()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.google_agenda_config WHERE ativo) THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT jsonb_agg(n.id) INTO v_ids FROM novas n;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT jsonb_agg(o.id) INTO v_ids FROM antigas o;
  ELSE
    -- O motivo não vai para a agenda: só período e técnico importam
    SELECT jsonb_agg(n.id) INTO v_ids
      FROM antigas o JOIN novas n ON n.id = o.id
     WHERE (o.membro_id, o.data_inicio, o.data_fim) IS DISTINCT FROM (n.membro_id, n.data_inicio, n.data_fim);
  END IF;

  IF v_ids IS NOT NULL THEN
    PERFORM public.notificar_google_agenda(jsonb_build_object('ausencias', v_ids));
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_google_agenda_insert ON public.escalas;
DROP TRIGGER IF EXISTS trg_google_agenda_update ON public.escalas;
DROP TRIGGER IF EXISTS trg_google_agenda_delete ON public.escalas;

CREATE TRIGGER trg_google_agenda_insert
  AFTER INSERT ON public.escalas
  REFERENCING NEW TABLE AS novas
  FOR EACH STATEMENT EXECUTE FUNCTION public.sincronizar_google_agenda();

CREATE TRIGGER trg_google_agenda_update
  AFTER UPDATE ON public.escalas
  REFERENCING OLD TABLE AS antigas NEW TABLE AS novas
  FOR EACH STATEMENT EXECUTE FUNCTION public.sincronizar_google_agenda();

CREATE TRIGGER trg_google_agenda_delete
  AFTER DELETE ON public.escalas
  REFERENCING OLD TABLE AS antigas
  FOR EACH STATEMENT EXECUTE FUNCTION public.sincronizar_google_agenda();

DROP TRIGGER IF EXISTS trg_google_agenda_ausencias_insert ON public.ausencias_programadas;
DROP TRIGGER IF EXISTS trg_google_agenda_ausencias_update ON public.ausencias_programadas;
DROP TRIGGER IF EXISTS trg_google_agenda_ausencias_delete ON public.ausencias_programadas;

CREATE TRIGGER trg_google_agenda_ausencias_insert
  AFTER INSERT ON public.ausencias_programadas
  REFERENCING NEW TABLE AS novas
  FOR EACH STATEMENT EXECUTE FUNCTION public.sincronizar_google_agenda_ausencias();

CREATE TRIGGER trg_google_agenda_ausencias_update
  AFTER UPDATE ON public.ausencias_programadas
  REFERENCING OLD TABLE AS antigas NEW TABLE AS novas
  FOR EACH STATEMENT EXECUTE FUNCTION public.sincronizar_google_agenda_ausencias();

CREATE TRIGGER trg_google_agenda_ausencias_delete
  AFTER DELETE ON public.ausencias_programadas
  REFERENCING OLD TABLE AS antigas
  FOR EACH STATEMENT EXECUTE FUNCTION public.sincronizar_google_agenda_ausencias();

-- Conferir as chamadas: SELECT * FROM net._http_response ORDER BY created DESC LIMIT 10;
