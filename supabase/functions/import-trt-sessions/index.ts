import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders, jsonResponse, createAdminClient, getCaller } from '../_shared/auth.ts';

// Lê o calendário público de sessões do 2º grau do TRT20 (o mesmo exibido em
// trt20.jus.br > Sessões de julgamento > Calendário de sessões) e devolve as
// sessões PRESENCIAIS de um período, já no formato da escala:
//   SP 1T → 1ª Turma · SP 2T → 2ª Turma · SP JP / SP AP → Pleno
// O horário vem do título ("9h", "9h05"). JP e AP no mesmo dia viram uma só
// sessão Pleno, no horário mais cedo. Só leitura: quem grava é o app.
//
// Corpo: { inicio: 'YYYY-MM-DD', fim: 'YYYY-MM-DD' }  (somente admin)

const ICS_PADRAO = 'https://calendar.google.com/calendar/ical/spt%40trt20.jus.br/public/basic.ics';

const SESSAO_POR_SIGLA: Record<string, string> = { '1T': '1ª Turma', '2T': '2ª Turma', 'JP': 'Pleno', 'AP': 'Pleno' };

interface Prevista { data: string; tipo_sessao: string; hora_inicio: string; descricao: string }

// Data (YYYY-MM-DD) e hora (HH:MM) de um DTSTART: dia inteiro, UTC (Z) ou local
function lerDtstart(valor: string): { data: string; hora: string | null } {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/.exec(valor);
  if (!m) return { data: '', hora: null };
  if (!m[4]) return { data: `${m[1]}-${m[2]}-${m[3]}`, hora: null };
  if (valor.endsWith('Z')) {
    // Sergipe: UTC-3, sem horário de verão
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 3, +m[5]));
    return { data: d.toISOString().slice(0, 10), hora: d.toISOString().slice(11, 16) };
  }
  return { data: `${m[1]}-${m[2]}-${m[3]}`, hora: `${m[4]}:${m[5]}` };
}

function lerEventos(ics: string) {
  // Linhas longas do iCalendar continuam na linha seguinte iniciada por espaço
  const linhas = ics.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const eventos: { summary: string; dtstart: string; status: string }[] = [];
  let atual: Record<string, string> | null = null;
  for (const linha of linhas) {
    if (linha === 'BEGIN:VEVENT') { atual = {}; continue; }
    if (linha === 'END:VEVENT') {
      if (atual) eventos.push({ summary: atual.SUMMARY ?? '', dtstart: atual.DTSTART ?? '', status: atual.STATUS ?? '' });
      atual = null;
      continue;
    }
    if (!atual) continue;
    const i = linha.indexOf(':');
    if (i < 0) continue;
    const nome = linha.slice(0, i).split(';')[0];
    atual[nome] = linha.slice(i + 1);
  }
  return eventos.map(e => ({
    ...e,
    summary: e.summary.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim(),
  }));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const db = createAdminClient();
    const caller = await getCaller(req, db).catch(() => null);
    if (!caller?.isAdmin) return jsonResponse({ error: 'Apenas administradores.' }, 403);

    const { inicio, fim } = await req.json().catch(() => ({}));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(fim ?? '')) {
      return jsonResponse({ error: 'Informe o período (inicio e fim).' }, 400);
    }

    const resp = await fetch(Deno.env.get('TRT_CALENDARIO_ICS') || ICS_PADRAO);
    if (!resp.ok) throw new Error(`Não foi possível ler o calendário do TRT (HTTP ${resp.status}).`);
    const eventos = lerEventos(await resp.text());

    const porSessao = new Map<string, Prevista>();
    for (const ev of eventos) {
      if (ev.status.toUpperCase() === 'CANCELLED') continue;
      const { data, hora } = lerDtstart(ev.dtstart);
      if (!data || data < inicio || data > fim) continue;

      // Presenciais: "SP 1T", "SP 2T", "SP JP", "SP AP" (virtuais são "SV")
      const siglas = [...ev.summary.matchAll(/\bSP\s*(1T|2T|JP|AP)\b/gi)].map(m => m[1].toUpperCase());
      if (siglas.length === 0) continue;

      const h = /^\s*(\d{1,2})\s*h\s*(\d{2})?/i.exec(ev.summary);
      const horaInicio = h ? `${h[1].padStart(2, '0')}:${h[2] ?? '00'}` : hora ?? '09:00';

      for (const tipo of new Set(siglas.map(s => SESSAO_POR_SIGLA[s]))) {
        const chave = `${data}|${tipo}`;
        const existente = porSessao.get(chave);
        if (!existente) {
          porSessao.set(chave, { data, tipo_sessao: tipo, hora_inicio: horaInicio, descricao: ev.summary });
        } else {
          if (horaInicio < existente.hora_inicio) existente.hora_inicio = horaInicio;
          existente.descricao = `${existente.descricao} · ${ev.summary}`.slice(0, 300);
        }
      }
    }

    const sessoes = [...porSessao.values()].sort((a, b) =>
      (a.data + a.hora_inicio + a.tipo_sessao).localeCompare(b.data + b.hora_inicio + b.tipo_sessao));
    return jsonResponse({ sessoes });
  } catch (error: any) {
    console.error('[import-trt-sessions] Error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
});
