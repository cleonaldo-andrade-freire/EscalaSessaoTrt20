// ---------------------------------------------------------------------------
// Valores de domínio do sistema de escala de suporte às sessões do 2º Grau
// (TRT20). Manter em sincronia com o CHECK de `escalas.tipo_sessao` no banco
// (supabase/sql/01_schema.sql).
// ---------------------------------------------------------------------------

export const SESSOES_DISPONIVEIS = [
  '1ª Turma',
  '2ª Turma',
  'Pleno'
];

// Cada função corresponde a um "slot" por sessão. Para escalar dois técnicos
// na mesma sessão, basta acrescentar, por exemplo, 'Suporte PJe 2'.
export const FUNCOES_DISPONIVEIS = [
  'Suporte PJe'
];

export const STATUS_SUBSTITUICAO = {
  NENHUM: 'Nenhum',
  DISPONIVEL: 'Disponível para Troca',
  ACEITA: 'Substituição Aceita',
  REJEITADA: 'Troca Rejeitada'
} as const;

// Antecedência do lembrete automático (WhatsApp + aviso). O disparo real é
// feito pela Edge Function send-session-reminders + pg_cron.
export const LEMBRETE_ANTECEDENCIA_MIN = 20;

// Horário de início padrão das sessões (pode ser alterado em cada escala)
export const HORA_PADRAO_SESSAO = '09:00';

export const MENSAGEM_PADRAO_SESSAO = `Olá, equipe! 👋

⏰ Lembrete da escala de suporte para a sessão da {{sessao}} de {{data}}, com início às {{horario}}.

Escalados:
{{escalados}}

📱 Ao chegar, abra o app e toque em "Fazer Check-in". Ao final da sessão, registre o "Check-out".

Bom trabalho!`;
