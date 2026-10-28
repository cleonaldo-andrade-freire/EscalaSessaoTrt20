-- =============================================================================
-- SESSÕES PREVISTAS (importadas do calendário de sessões do TRT20)
--
-- No "Montar Escala do Mês", o botão "Importar sessões do TRT" lê a agenda
-- pública spt@trt20.jus.br (Edge Function import-trt-sessions) e grava aqui
-- as sessões PRESENCIAIS do mês. Elas aparecem no calendário como
-- "a preencher" e só viram escala (public.escalas) quando o admin escolhe o
-- técnico — as regras de rascunho/publicação não mudam.
--
-- Bancos novos: já incluído no 01_schema.sql. Idempotente.
-- Deploy: supabase functions deploy import-trt-sessions
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.sessoes_previstas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    data DATE NOT NULL,
    tipo_sessao VARCHAR(50) NOT NULL
        CHECK (tipo_sessao IN ('1ª Turma', '2ª Turma', 'Pleno')),
    hora_inicio TIME NOT NULL,
    -- Título(s) do calendário do TRT, ex.: "9h - 39ª SP 2T"
    descricao VARCHAR(300),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT sessoes_previstas_unica UNIQUE (data, tipo_sessao)
);

ALTER TABLE public.sessoes_previstas ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sessoes_previstas TO authenticated, service_role;

-- Só o admin monta a escala
DROP POLICY IF EXISTS sessoes_previstas_admin ON public.sessoes_previstas;
CREATE POLICY sessoes_previstas_admin ON public.sessoes_previstas FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
