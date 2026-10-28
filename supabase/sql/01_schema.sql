-- =============================================================================
-- ESCALA DE SUPORTE ÀS SESSÕES DO 2º GRAU — TRT20
-- Schema completo para um projeto Supabase NOVO (banco vazio).
--
-- Como usar: Supabase Studio > SQL Editor > cole este arquivo inteiro > Run.
-- Em seguida execute 02_storage.sql e, após criar o primeiro usuário,
-- 03_primeiro_admin.sql. O 04_cron_lembretes.sql é opcional.
--
-- O script é idempotente nas tabelas/funções (IF NOT EXISTS / OR REPLACE) e
-- recria as policies, então pode ser executado novamente sem erro.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- 1. TABELAS
-- -----------------------------------------------------------------------------

-- 1.1 membros (técnicos) — vinculada ao Supabase Auth
CREATE TABLE IF NOT EXISTS public.membros (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    nome VARCHAR(150) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    celular_whatsapp VARCHAR(30),
    foto_url VARCHAR(500),
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1.2 escalas — cada linha é UM slot (função) em UMA sessão
CREATE TABLE IF NOT EXISTS public.escalas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    data DATE NOT NULL,
    hora_inicio TIME NOT NULL,
    tipo_sessao VARCHAR(50) NOT NULL
        CHECK (tipo_sessao IN ('1ª Turma', '2ª Turma', 'Pleno')),
    funcao VARCHAR(100) NOT NULL DEFAULT 'Suporte PJe',
    membro_original_id UUID NOT NULL REFERENCES public.membros(id) ON DELETE RESTRICT,
    membro_substituto_id UUID REFERENCES public.membros(id) ON DELETE SET NULL,
    justificativa_troca VARCHAR(500),
    status_substituicao VARCHAR(50) NOT NULL DEFAULT 'Nenhum'
        CHECK (status_substituicao IN ('Nenhum', 'Disponível para Troca', 'Substituição Aceita', 'Troca Rejeitada')),
    -- Presença: NULL = pendente, TRUE = check-in feito, FALSE = falta
    compareceu BOOLEAN,
    checkin_em TIMESTAMPTZ,
    checkin_por UUID REFERENCES public.membros(id) ON DELETE SET NULL,
    checkout_em TIMESTAMPTZ,
    checkout_por UUID REFERENCES public.membros(id) ON DELETE SET NULL,
    publicada BOOLEAN NOT NULL DEFAULT TRUE,
    -- Preenchido pela Edge Function send-session-reminders (lembrete 20 min antes)
    lembrete_enviado_em TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT escalas_slot_unico UNIQUE (data, tipo_sessao, funcao),
    CONSTRAINT escalas_checkout_apos_checkin
        CHECK (checkout_em IS NULL OR (checkin_em IS NOT NULL AND checkout_em >= checkin_em))
);
CREATE INDEX IF NOT EXISTS idx_escalas_data_sessao ON public.escalas(data, tipo_sessao);
CREATE INDEX IF NOT EXISTS idx_escalas_lembrete_pendente ON public.escalas(data, hora_inicio) WHERE lembrete_enviado_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_escalas_membro_original ON public.escalas(membro_original_id);
CREATE INDEX IF NOT EXISTS idx_escalas_membro_substituto ON public.escalas(membro_substituto_id);
CREATE INDEX IF NOT EXISTS idx_escalas_status_substituicao ON public.escalas(status_substituicao);

-- 1.3 ausencias_programadas — um registro por período (inclusive)
CREATE TABLE IF NOT EXISTS public.ausencias_programadas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    membro_id UUID NOT NULL REFERENCES public.membros(id) ON DELETE CASCADE,
    data_inicio DATE NOT NULL,
    data_fim DATE NOT NULL,
    motivo VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ausencias_periodo_valido CHECK (data_fim >= data_inicio)
);
CREATE INDEX IF NOT EXISTS idx_ausencias_periodo ON public.ausencias_programadas(membro_id, data_inicio, data_fim);

-- 1.4 avisos (um registro por destinatário)
CREATE TABLE IF NOT EXISTS public.avisos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    membro_id UUID NOT NULL REFERENCES public.membros(id) ON DELETE CASCADE,
    titulo VARCHAR(200),
    mensagem TEXT NOT NULL,
    lido BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_avisos_membro_lido ON public.avisos(membro_id, lido);

-- 1.5 membro_fcm_tokens (push notifications — opcional)
CREATE TABLE IF NOT EXISTS public.membro_fcm_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    membro_id UUID NOT NULL REFERENCES public.membros(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    device_os VARCHAR(20) CHECK (device_os IN ('ios', 'android')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_membro_token UNIQUE (membro_id, token)
);
CREATE INDEX IF NOT EXISTS idx_fcm_tokens_membro ON public.membro_fcm_tokens(membro_id);

-- 1.6 sessao_mensagens (templates de lembrete por tipo de sessão)
CREATE TABLE IF NOT EXISTS public.sessao_mensagens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tipo_sessao VARCHAR(50) NOT NULL UNIQUE,
    mensagem_padrao TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1.7 sessoes_previstas — sessões presenciais importadas do calendário do
-- TRT20 ("a preencher" no Montar Mês até o admin escolher o técnico)
CREATE TABLE IF NOT EXISTS public.sessoes_previstas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    data DATE NOT NULL,
    tipo_sessao VARCHAR(50) NOT NULL
        CHECK (tipo_sessao IN ('1ª Turma', '2ª Turma', 'Pleno')),
    hora_inicio TIME NOT NULL,
    descricao VARCHAR(300),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT sessoes_previstas_unica UNIQUE (data, tipo_sessao)
);


-- -----------------------------------------------------------------------------
-- 2. FUNÇÕES AUXILIARES
-- -----------------------------------------------------------------------------

-- Retorna TRUE se o usuário autenticado é administrador.
-- SECURITY DEFINER evita recursão de RLS ao consultar `membros` dentro das policies.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.membros WHERE id = auth.uid() AND is_admin = TRUE);
$$;

-- Membro que efetivamente atende a escala (substituto, se houve permuta aceita).
CREATE OR REPLACE FUNCTION public.membro_efetivo(e public.escalas)
RETURNS UUID
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN e.status_substituicao = 'Substituição Aceita' AND e.membro_substituto_id IS NOT NULL
      THEN e.membro_substituto_id
    ELSE e.membro_original_id
  END;
$$;


-- -----------------------------------------------------------------------------
-- 3. CHECK-IN / CHECK-OUT (RPC)
-- O horário é sempre o do servidor (now()). Administradores podem informar
-- um horário manual (lançamento retroativo) e registrar para qualquer técnico.
-- Fuso de referência para "dia da sessão": America/Maceio (UTC-3, Sergipe).
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.registrar_checkin(p_escala_id UUID, p_horario TIMESTAMPTZ DEFAULT NULL)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_esc public.escalas;
  v_admin BOOLEAN := public.is_admin();
  v_hoje DATE := (NOW() AT TIME ZONE 'America/Maceio')::DATE;
  v_horario TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  SELECT * INTO v_esc FROM public.escalas WHERE id = p_escala_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escala não encontrada.';
  END IF;

  IF NOT v_admin THEN
    IF public.membro_efetivo(v_esc) <> auth.uid() THEN
      RAISE EXCEPTION 'Apenas o técnico escalado pode registrar o check-in.';
    END IF;
    IF v_esc.data <> v_hoje THEN
      RAISE EXCEPTION 'O check-in só pode ser feito no dia da sessão.';
    END IF;
    IF v_esc.checkin_em IS NOT NULL THEN
      RAISE EXCEPTION 'Check-in já registrado para esta sessão.';
    END IF;
    IF p_horario IS NOT NULL THEN
      RAISE EXCEPTION 'Somente administradores podem informar horário manual.';
    END IF;
  END IF;

  v_horario := COALESCE(p_horario, NOW());

  IF v_esc.checkout_em IS NOT NULL AND v_horario > v_esc.checkout_em THEN
    RAISE EXCEPTION 'O horário de check-in não pode ser posterior ao check-out já registrado.';
  END IF;

  PERFORM set_config('app.presenca_rpc', 'on', TRUE);
  UPDATE public.escalas
     SET compareceu = TRUE,
         checkin_em = v_horario,
         checkin_por = auth.uid()
   WHERE id = p_escala_id;

  RETURN v_horario;
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_checkout(p_escala_id UUID, p_horario TIMESTAMPTZ DEFAULT NULL)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_esc public.escalas;
  v_admin BOOLEAN := public.is_admin();
  v_hoje DATE := (NOW() AT TIME ZONE 'America/Maceio')::DATE;
  v_horario TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  SELECT * INTO v_esc FROM public.escalas WHERE id = p_escala_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escala não encontrada.';
  END IF;

  IF v_esc.checkin_em IS NULL THEN
    RAISE EXCEPTION 'Registre o check-in antes do check-out.';
  END IF;

  IF NOT v_admin THEN
    IF public.membro_efetivo(v_esc) <> auth.uid() THEN
      RAISE EXCEPTION 'Apenas o técnico escalado pode registrar o check-out.';
    END IF;
    IF v_esc.data <> v_hoje THEN
      RAISE EXCEPTION 'O check-out só pode ser feito no dia da sessão. Procure o administrador.';
    END IF;
    IF v_esc.checkout_em IS NOT NULL THEN
      RAISE EXCEPTION 'Check-out já registrado para esta sessão.';
    END IF;
    IF p_horario IS NOT NULL THEN
      RAISE EXCEPTION 'Somente administradores podem informar horário manual.';
    END IF;
  END IF;

  v_horario := COALESCE(p_horario, NOW());

  IF v_horario < v_esc.checkin_em THEN
    RAISE EXCEPTION 'O horário de check-out não pode ser anterior ao check-in.';
  END IF;

  PERFORM set_config('app.presenca_rpc', 'on', TRUE);
  UPDATE public.escalas
     SET checkout_em = v_horario,
         checkout_por = auth.uid()
   WHERE id = p_escala_id;

  RETURN v_horario;
END;
$$;

-- Impede que não-administradores alterem diretamente campos de presença ou
-- a estrutura da escala (data, sessão, função, titular). Membros só podem
-- mexer nos campos de permuta; a presença passa obrigatoriamente pelas RPCs.
CREATE OR REPLACE FUNCTION public.proteger_escala()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- service_role / SQL Editor (sem usuário) e administradores passam direto
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

DROP TRIGGER IF EXISTS trg_proteger_escala ON public.escalas;
CREATE TRIGGER trg_proteger_escala
  BEFORE UPDATE ON public.escalas
  FOR EACH ROW EXECUTE FUNCTION public.proteger_escala();


-- -----------------------------------------------------------------------------
-- 4. PERMISSÕES
-- -----------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.membros, public.escalas, public.ausencias_programadas,
  public.avisos, public.membro_fcm_tokens, public.sessao_mensagens, public.sessoes_previstas
TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.registrar_checkin(UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.registrar_checkout(UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_checkin(UUID, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_checkout(UUID, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;


-- -----------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------

ALTER TABLE public.membros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escalas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ausencias_programadas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.avisos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membro_fcm_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessao_mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessoes_previstas ENABLE ROW LEVEL SECURITY;

-- membros: todos os autenticados leem; só admin escreve.
-- (Cadastro e edição do próprio perfil passam pelas Edge Functions com service_role.)
DROP POLICY IF EXISTS membros_select ON public.membros;
DROP POLICY IF EXISTS membros_admin_write ON public.membros;
CREATE POLICY membros_select ON public.membros FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY membros_admin_write ON public.membros FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- escalas
DROP POLICY IF EXISTS escalas_select ON public.escalas;
DROP POLICY IF EXISTS escalas_admin_insert ON public.escalas;
DROP POLICY IF EXISTS escalas_admin_delete ON public.escalas;
DROP POLICY IF EXISTS escalas_update ON public.escalas;
CREATE POLICY escalas_select ON public.escalas FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY escalas_admin_insert ON public.escalas FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY escalas_admin_delete ON public.escalas FOR DELETE TO authenticated USING (public.is_admin());
-- Admin atualiza tudo; técnico atualiza escalas suas (titular/substituto) ou
-- abertas para permuta. O trigger trg_proteger_escala limita QUAIS campos.
CREATE POLICY escalas_update ON public.escalas FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    OR auth.uid() = membro_original_id
    OR auth.uid() = membro_substituto_id
    OR status_substituicao = 'Disponível para Troca'
  )
  WITH CHECK (
    public.is_admin()
    OR auth.uid() = membro_original_id
    OR auth.uid() = membro_substituto_id
    OR status_substituicao = 'Disponível para Troca'
  );

-- ausencias_programadas: todos leem (o admin precisa ver conflitos ao escalar);
-- cada técnico gerencia as próprias; admin gerencia todas.
DROP POLICY IF EXISTS ausencias_select ON public.ausencias_programadas;
DROP POLICY IF EXISTS ausencias_insert ON public.ausencias_programadas;
DROP POLICY IF EXISTS ausencias_update ON public.ausencias_programadas;
DROP POLICY IF EXISTS ausencias_delete ON public.ausencias_programadas;
CREATE POLICY ausencias_select ON public.ausencias_programadas FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY ausencias_insert ON public.ausencias_programadas FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = membro_id OR public.is_admin());
-- Cancelar o restante de um período em andamento encurta o data_fim
CREATE POLICY ausencias_update ON public.ausencias_programadas FOR UPDATE TO authenticated
  USING (auth.uid() = membro_id OR public.is_admin())
  WITH CHECK (auth.uid() = membro_id OR public.is_admin());
CREATE POLICY ausencias_delete ON public.ausencias_programadas FOR DELETE TO authenticated
  USING (auth.uid() = membro_id OR public.is_admin());

-- avisos: cada um vê/marca como lido os seus; admin gerencia todos.
DROP POLICY IF EXISTS avisos_select ON public.avisos;
DROP POLICY IF EXISTS avisos_update ON public.avisos;
DROP POLICY IF EXISTS avisos_admin_insert ON public.avisos;
DROP POLICY IF EXISTS avisos_admin_delete ON public.avisos;
CREATE POLICY avisos_select ON public.avisos FOR SELECT TO authenticated
  USING (auth.uid() = membro_id OR public.is_admin());
CREATE POLICY avisos_update ON public.avisos FOR UPDATE TO authenticated
  USING (auth.uid() = membro_id OR public.is_admin())
  WITH CHECK (auth.uid() = membro_id OR public.is_admin());
CREATE POLICY avisos_admin_insert ON public.avisos FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY avisos_admin_delete ON public.avisos FOR DELETE TO authenticated USING (public.is_admin());

-- membro_fcm_tokens: cada um gerencia os próprios tokens.
DROP POLICY IF EXISTS fcm_tokens_own ON public.membro_fcm_tokens;
CREATE POLICY fcm_tokens_own ON public.membro_fcm_tokens FOR ALL TO authenticated
  USING (auth.uid() = membro_id) WITH CHECK (auth.uid() = membro_id);

-- sessao_mensagens: todos leem; admin gerencia.
DROP POLICY IF EXISTS sessao_mensagens_select ON public.sessao_mensagens;
DROP POLICY IF EXISTS sessao_mensagens_admin ON public.sessao_mensagens;
CREATE POLICY sessao_mensagens_select ON public.sessao_mensagens FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY sessao_mensagens_admin ON public.sessao_mensagens FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- sessoes_previstas: só o admin (monta a escala)
DROP POLICY IF EXISTS sessoes_previstas_admin ON public.sessoes_previstas;
CREATE POLICY sessoes_previstas_admin ON public.sessoes_previstas FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());


-- -----------------------------------------------------------------------------
-- 6. DADOS INICIAIS — templates de lembrete
-- Variáveis: {{sessao}}, {{data}}, {{horario}}, {{escalados}}
-- -----------------------------------------------------------------------------

INSERT INTO public.sessao_mensagens (tipo_sessao, mensagem_padrao) VALUES
('1ª Turma', 'Olá, equipe! 👋

⏰ Lembrete da escala de suporte para a sessão da {{sessao}} de hoje ({{data}}), com início às {{horario}}.

Escalados:
{{escalados}}

📱 Ao chegar, abra o app e toque em "Fazer Check-in". Ao final da sessão, registre o "Check-out".

Bom trabalho!'),
('2ª Turma', 'Olá, equipe! 👋

⏰ Lembrete da escala de suporte para a sessão da {{sessao}} de hoje ({{data}}), com início às {{horario}}.

Escalados:
{{escalados}}

📱 Ao chegar, abra o app e toque em "Fazer Check-in". Ao final da sessão, registre o "Check-out".

Bom trabalho!'),
('Pleno', 'Olá, equipe! 👋

⏰ Lembrete da escala de suporte para a sessão do {{sessao}} de hoje ({{data}}), com início às {{horario}}.

Escalados:
{{escalados}}

📱 Ao chegar, abra o app e toque em "Fazer Check-in". Ao final da sessão, registre o "Check-out".

Bom trabalho!')
ON CONFLICT (tipo_sessao) DO NOTHING;
