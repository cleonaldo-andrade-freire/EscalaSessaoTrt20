-- =============================================================================
-- MIGRAÇÃO: ausência programada passa a ser UM registro por período
-- (data_inicio .. data_fim, inclusive), em vez de uma linha por dia.
--
-- Necessária apenas para bancos criados com a versão anterior do 01_schema.sql
-- (instalações novas já nascem assim). Idempotente.
--
-- Os dias que foram gravados juntos (mesmo técnico, mesmo envio e mesmo
-- motivo) viram um único período; ausências antigas de um dia continuam
-- como períodos de um dia.
--
-- Depois de rodar este script, rode de novo o 06_google_agenda.sql (com o
-- <SEU_PROJECT_REF> trocado) para as ausências irem também para o Google Agenda.
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ausencias_programadas' AND column_name = 'data_especifica'
  ) THEN
    ALTER TABLE public.ausencias_programadas RENAME COLUMN data_especifica TO data_inicio;
  END IF;
END $$;

ALTER TABLE public.ausencias_programadas ADD COLUMN IF NOT EXISTS data_fim DATE;

-- Junta os dias gravados juntos num único período (mantém a linha do 1º dia)
WITH grupos AS (
  SELECT membro_id, created_at, motivo,
         MIN(data_inicio) AS inicio,
         MAX(data_inicio) AS fim,
         (array_agg(id ORDER BY data_inicio))[1] AS manter
    FROM public.ausencias_programadas
   WHERE data_fim IS NULL
   GROUP BY membro_id, created_at, motivo
), periodo AS (
  UPDATE public.ausencias_programadas a
     SET data_inicio = g.inicio, data_fim = g.fim
    FROM grupos g
   WHERE a.id = g.manter
  RETURNING a.id
)
DELETE FROM public.ausencias_programadas a
 USING grupos g
 WHERE a.data_fim IS NULL
   AND a.membro_id = g.membro_id
   AND a.created_at = g.created_at
   AND a.motivo IS NOT DISTINCT FROM g.motivo
   AND a.id <> g.manter;

UPDATE public.ausencias_programadas SET data_fim = data_inicio WHERE data_fim IS NULL;
ALTER TABLE public.ausencias_programadas ALTER COLUMN data_fim SET NOT NULL;

ALTER TABLE public.ausencias_programadas DROP CONSTRAINT IF EXISTS ausencias_periodo_valido;
ALTER TABLE public.ausencias_programadas
  ADD CONSTRAINT ausencias_periodo_valido CHECK (data_fim >= data_inicio);

DROP INDEX IF EXISTS public.idx_ausencias_lookup;
CREATE INDEX IF NOT EXISTS idx_ausencias_periodo ON public.ausencias_programadas(membro_id, data_inicio, data_fim);

-- Cancelar o restante de um período em andamento encurta o data_fim
DROP POLICY IF EXISTS ausencias_update ON public.ausencias_programadas;
CREATE POLICY ausencias_update ON public.ausencias_programadas FOR UPDATE TO authenticated
  USING (auth.uid() = membro_id OR public.is_admin())
  WITH CHECK (auth.uid() = membro_id OR public.is_admin());

-- Conferência
SELECT membro_id, data_inicio, data_fim, motivo FROM public.ausencias_programadas ORDER BY data_inicio DESC LIMIT 20;
