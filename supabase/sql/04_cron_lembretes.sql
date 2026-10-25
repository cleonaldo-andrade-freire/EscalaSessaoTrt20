-- =============================================================================
-- LEMBRETE AUTOMÁTICO 20 MINUTOS ANTES DA SESSÃO (WhatsApp + aviso no app)
--
-- Um job do pg_cron roda a cada minuto. Só chama a Edge Function
-- `send-session-reminders` quando existe sessão de hoje começando nos
-- próximos 20 minutos e ainda sem lembrete — fora disso não faz nada.
-- Cada sessão recebe o lembrete uma única vez (escalas.lembrete_enviado_em).
--
-- Antes de executar:
--   1. Gere um segredo aleatório (ex.: openssl rand -hex 32) e grave-o:
--      a) na Edge Function:  supabase secrets set CRON_SECRET=<SEGREDO>
--      b) no Vault do banco: SELECT vault.create_secret('<SEGREDO>', 'cron_secret');
--      e a chave service_role (exigida pelo gateway das Edge Functions):
--                            SELECT vault.create_secret('<SUA_SERVICE_ROLE_KEY>', 'service_role_key');
--      NÃO versione nenhum desses valores.
--   2. Substitua <SEU_PROJECT_REF> abaixo.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove agendamentos anteriores, se existirem
SELECT cron.unschedule(jobname) FROM cron.job
WHERE jobname IN ('lembrete-sessoes-vespera', 'lembrete-sessoes-20min');

SELECT cron.schedule(
  'lembrete-sessoes-20min',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://<SEU_PROJECT_REF>.supabase.co/functions/v1/send-session-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    )
  )
  WHERE EXISTS (
    SELECT 1 FROM public.escalas
    WHERE publicada
      AND lembrete_enviado_em IS NULL
      AND data = (NOW() AT TIME ZONE 'America/Maceio')::DATE
      AND hora_inicio >  (NOW() AT TIME ZONE 'America/Maceio')::TIME
      AND hora_inicio <= ((NOW() AT TIME ZONE 'America/Maceio') + INTERVAL '20 minutes')::TIME
  );
  $$
);

-- Conferir:   SELECT * FROM cron.job;
--             SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
-- Remover:    SELECT cron.unschedule('lembrete-sessoes-20min');
