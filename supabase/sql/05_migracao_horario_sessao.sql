-- =============================================================================
-- MIGRAÇÃO: horário de início da sessão + controle do lembrete 20 min antes
-- Necessária apenas para bancos criados com a versão anterior do 01_schema.sql
-- (instalações novas já incluem estas colunas). Idempotente.
-- =============================================================================

ALTER TABLE public.escalas ADD COLUMN IF NOT EXISTS hora_inicio TIME;
ALTER TABLE public.escalas ADD COLUMN IF NOT EXISTS lembrete_enviado_em TIMESTAMPTZ;

-- Escalas antigas sem horário recebem 08:00 para permitir o NOT NULL (ajuste no app se preciso)
UPDATE public.escalas SET hora_inicio = '08:00' WHERE hora_inicio IS NULL;
ALTER TABLE public.escalas ALTER COLUMN hora_inicio SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_escalas_lembrete_pendente
  ON public.escalas(data, hora_inicio) WHERE lembrete_enviado_em IS NULL;

-- Trigger: técnicos também não podem alterar horário nem o controle do lembrete
CREATE OR REPLACE FUNCTION public.proteger_escala()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.data IS DISTINCT FROM OLD.data
     OR NEW.tipo_sessao IS DISTINCT FROM OLD.tipo_sessao
     OR NEW.funcao IS DISTINCT FROM OLD.funcao
     OR NEW.membro_original_id IS DISTINCT FROM OLD.membro_original_id
     OR NEW.hora_inicio IS DISTINCT FROM OLD.hora_inicio
     OR NEW.lembrete_enviado_em IS DISTINCT FROM OLD.lembrete_enviado_em
     OR NEW.publicada IS DISTINCT FROM OLD.publicada THEN
    RAISE EXCEPTION 'Apenas administradores podem alterar dados da escala.';
  END IF;

  IF COALESCE(current_setting('app.presenca_rpc', TRUE), '') <> 'on' AND (
       NEW.compareceu IS DISTINCT FROM OLD.compareceu
       OR NEW.checkin_em IS DISTINCT FROM OLD.checkin_em
       OR NEW.checkin_por IS DISTINCT FROM OLD.checkin_por
       OR NEW.checkout_em IS DISTINCT FROM OLD.checkout_em
       OR NEW.checkout_por IS DISTINCT FROM OLD.checkout_por) THEN
    RAISE EXCEPTION 'Use o check-in/check-out do aplicativo para registrar presença.';
  END IF;

  RETURN NEW;
END;
$$;

-- Templates passam a incluir o horário
UPDATE public.sessao_mensagens
SET mensagem_padrao = 'Olá, equipe! 👋

⏰ Lembrete da escala de suporte para a sessão ' ||
  CASE WHEN tipo_sessao = 'Pleno' THEN 'do' ELSE 'da' END ||
  ' {{sessao}} de hoje ({{data}}), com início às {{horario}}.

Escalados:
{{escalados}}

📱 Ao chegar, abra o app e toque em "Fazer Check-in". Ao final da sessão, registre o "Check-out".

Bom trabalho!'
WHERE mensagem_padrao NOT LIKE '%{{horario}}%';
