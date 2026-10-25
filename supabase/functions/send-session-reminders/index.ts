import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders, jsonResponse, createAdminClient } from '../_shared/auth.ts';

// Disparada pelo pg_cron (supabase/sql/04_cron_lembretes.sql) a cada minuto,
// apenas quando há sessão de hoje começando nos próximos 20 minutos.
const ANTECEDENCIA_MIN = 20;

const MENSAGEM_FALLBACK = `Olá, equipe! 👋

⏰ Lembrete da escala de suporte para a sessão da {{sessao}} de hoje ({{data}}), com início às {{horario}}.

Escalados:
{{escalados}}

📱 Ao chegar, abra o app e toque em "Fazer Check-in". Ao final da sessão, registre o "Check-out".

Bom trabalho!`;

// Data (YYYY-MM-DD) e hora (HH:MM:SS) no fuso de Sergipe
const agoraBRT = (offsetMin = 0) => {
  const d = new Date(Date.now() + offsetMin * 60000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Maceio', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map(p => [p.type, p.value])
  );
  return { data: `${parts.year}-${parts.month}-${parts.day}`, hora: `${parts.hour}:${parts.minute}:${parts.second}` };
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Somente o agendamento (pg_cron) pode disparar os lembretes: ele envia o
    // segredo CRON_SECRET (guardado no Vault do banco e nos secrets da função).
    const cronSecret = Deno.env.get('CRON_SECRET') ?? '';
    if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
      console.warn('[send-session-reminders] Unauthorized request');
      return jsonResponse({ error: 'Não autorizado' }, 401);
    }

    const supabaseClient = createAdminClient();
    const agora = agoraBRT();
    const limite = agoraBRT(ANTECEDENCIA_MIN);
    // Perto da meia-noite o limite "vira o dia"; sessões nesse horário não são esperadas
    const horaLimite = limite.data === agora.data ? limite.hora : '23:59:59';

    // "Reserva" as escalas pendentes marcando o envio antes de disparar,
    // para que execuções concorrentes não mandem o lembrete duas vezes.
    const { data: escalas, error: escError } = await supabaseClient
      .from('escalas')
      .update({ lembrete_enviado_em: new Date().toISOString() })
      .eq('data', agora.data)
      .eq('publicada', true)
      .is('lembrete_enviado_em', null)
      .gt('hora_inicio', agora.hora)
      .lte('hora_inicio', horaLimite)
      .select('id, tipo_sessao, hora_inicio, funcao, status_substituicao, membro_original_id, membro_substituto_id');

    if (escError) throw escError;

    if (!escalas || escalas.length === 0) {
      return jsonResponse({ message: 'Nenhuma sessão nos próximos minutos.' });
    }

    const { data: templatesDB } = await supabaseClient
      .from('sessao_mensagens')
      .select('tipo_sessao, mensagem_padrao');

    const templatesMap: Record<string, string> = {};
    for (const t of templatesDB ?? []) {
      templatesMap[t.tipo_sessao] = t.mensagem_padrao;
    }

    const membroEfetivo = (s: any) =>
      s.status_substituicao === 'Substituição Aceita' && s.membro_substituto_id ? s.membro_substituto_id : s.membro_original_id;

    const uniqueTodosIds = [...new Set(escalas.map(membroEfetivo).filter(Boolean))] as string[];
    const { data: membrosNomes } = await supabaseClient
      .from('membros')
      .select('id, nome')
      .in('id', uniqueTodosIds);

    const membrosNomesMap: Record<string, string> = {};
    for (const m of membrosNomes ?? []) {
      membrosNomesMap[m.id] = m.nome;
    }

    // Agrupa por sessão (data é sempre hoje)
    const sessoesGroups = escalas.reduce((acc: any, curr: any) => {
      if (!acc[curr.tipo_sessao]) acc[curr.tipo_sessao] = [];
      acc[curr.tipo_sessao].push(curr);
      return acc;
    }, {});

    const dataBr = agora.data.split('-').reverse().join('/');
    const resultados: any[] = [];

    for (const sessao of Object.keys(sessoesGroups)) {
      const slots = sessoesGroups[sessao];
      const uniqueMembroIds = [...new Set(slots.map(membroEfetivo).filter(Boolean))] as string[];
      if (uniqueMembroIds.length === 0) continue;

      const horario = String(slots[0].hora_inicio).slice(0, 5);
      const escaladosLinhas = slots
        .map((slot: any) => `• ${slot.funcao}: ${membrosNomesMap[membroEfetivo(slot)] ?? 'Técnico'}`)
        .join('\n');

      const text = (templatesMap[sessao] ?? MENSAGEM_FALLBACK)
        .replace(/\{\{sessao\}\}/g, sessao)
        .replace(/\{\{data\}\}/g, dataBr)
        .replace(/\{\{horario\}\}/g, horario)
        .replace(/\{\{escalados\}\}/g, escaladosLinhas);

      console.log(`[send-session-reminders] ${sessao} ${horario}: ${uniqueMembroIds.length} técnico(s)`);

      // 1. Aviso no app
      const { error: avisoError } = await supabaseClient.from('avisos').insert(
        uniqueMembroIds.map((id: string) => ({
          membro_id: id,
          titulo: `Sessão ${sessao} às ${horario}`,
          mensagem: text,
          lido: false,
        }))
      );
      if (avisoError) console.error('[send-session-reminders] Error inserting avisos:', avisoError);

      // 2. WhatsApp
      let whatsapp = 'ok';
      try {
        const { data: waData, error: waError } = await supabaseClient.functions.invoke('send-whatsapp', {
          body: { membro_ids: uniqueMembroIds, message: text }
        });
        if (waError || waData?.error) whatsapp = waError?.message || waData?.error;
      } catch (whatsErr: any) {
        whatsapp = whatsErr?.message ?? String(whatsErr);
      }
      if (whatsapp !== 'ok') console.error(`[send-session-reminders] WhatsApp falhou (${sessao}):`, whatsapp);

      // 3. Push (opcional — ignora se o Firebase não estiver configurado)
      try {
        await supabaseClient.functions.invoke('send-push-notification', {
          body: { membro_ids: uniqueMembroIds, title: `Sessão ${sessao} às ${horario} ⏰`, body: 'Sua sessão de suporte começa em breve.' }
        });
      } catch (_) { /* push opcional */ }

      resultados.push({ sessao, horario, tecnicos: uniqueMembroIds.length, whatsapp });
    }

    return jsonResponse({ success: true, resultados });
  } catch (error: any) {
    console.error('[send-session-reminders] Error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
});
