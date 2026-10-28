import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { corsHeaders, jsonResponse, createAdminClient, getCaller } from '../_shared/auth.ts';
import { getGoogleAccessToken } from '../_shared/google.ts';

// Lê o calendário público de sessões do 2º grau do TRT20 (o mesmo exibido em
// trt20.jus.br > Sessões de julgamento > Calendário de sessões) e devolve as
// sessões PRESENCIAIS de um período, já no formato da escala:
//   SP 1T → 1ª Turma · SP 2T → 2ª Turma · SP JP / SP AP → Pleno
// O horário vem do título ("9h", "9h05"). JP e AP no mesmo dia viram uma só
// sessão Pleno, no horário mais cedo. Um técnico atende o dia todo: havendo
// mais de uma sessão no dia, vale a Turma (1ª antes da 2ª) e as demais ficam
// só como complementares na descrição. Só leitura: quem grava é o app.
//
// Leitura pela API do Google Calendar com a Service Account do Google Agenda
// (Admin → Google Agenda): agenda pública pode ser lida por qualquer conta.
// Sem essa conexão, usa o arquivo iCal público — que o Google às vezes limita
// (HTTP 429) quando o pedido sai de servidores de nuvem.
//
// Corpo: { inicio: 'YYYY-MM-DD', fim: 'YYYY-MM-DD' }  (somente admin)

const CALENDARIO_TRT = 'spt@trt20.jus.br';
const ICS_PADRAO = 'https://calendar.google.com/calendar/ical/spt%40trt20.jus.br/public/basic.ics';
const FUSO = 'America/Maceio';

interface EventoTRT { summary: string; data: string; hora: string | null; cancelado: boolean }

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

// Dia seguinte (timeMax da API é exclusivo)
const diaSeguinte = (data: string) => {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

async function eventosPelaApi(serviceAccount: string, inicio: string, fim: string): Promise<EventoTRT[]> {
  const token = await getGoogleAccessToken(serviceAccount, 'https://www.googleapis.com/auth/calendar.events');
  const eventos: EventoTRT[] = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      timeMin: `${inicio}T00:00:00-03:00`,
      timeMax: `${diaSeguinte(fim)}T00:00:00-03:00`,
      singleEvents: 'true',
      timeZone: FUSO,
      maxResults: '250',
      ...(pageToken ? { pageToken } : {}),
    });
    const resp = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDARIO_TRT)}/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const corpo = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(`API do Google Calendar: ${corpo?.error?.message ?? `HTTP ${resp.status}`}`);
    for (const ev of corpo.items ?? []) {
      // Dia inteiro: start.date; com horário: start.dateTime já no fuso pedido
      const dt: string = ev.start?.dateTime ?? '';
      eventos.push({
        summary: String(ev.summary ?? '').trim(),
        data: ev.start?.date ?? dt.slice(0, 10),
        hora: dt ? dt.slice(11, 16) : null,
        cancelado: ev.status === 'cancelled',
      });
    }
    pageToken = corpo.nextPageToken ?? '';
  } while (pageToken);
  return eventos;
}

async function eventosPeloIcs(): Promise<EventoTRT[]> {
  const url = Deno.env.get('TRT_CALENDARIO_ICS') || ICS_PADRAO;
  let resp = await fetch(url);
  for (let tentativa = 1; resp.status === 429 && tentativa <= 2; tentativa++) {
    await new Promise(r => setTimeout(r, 1500 * tentativa));
    resp = await fetch(url);
  }
  if (!resp.ok) {
    throw new Error(resp.status === 429
      ? 'O Google limitou a leitura do calendário do TRT (HTTP 429). Conecte o Google Agenda em Admin → Google Agenda para importar pela API, ou tente de novo em alguns minutos.'
      : `Não foi possível ler o calendário do TRT (HTTP ${resp.status}).`);
  }
  return lerEventos(await resp.text()).map(ev => ({
    summary: ev.summary,
    ...lerDtstart(ev.dtstart),
    cancelado: ev.status.toUpperCase() === 'CANCELLED',
  }));
}

async function serviceAccountConfigurada(db: SupabaseClient): Promise<string | null> {
  const { data } = await db.from('google_agenda_config').select('service_account').eq('id', 1).maybeSingle();
  return data?.service_account ?? null;
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

    // API do Google (com a Service Account) e, se não houver ou falhar, o iCal
    let eventos: EventoTRT[];
    const serviceAccount = await serviceAccountConfigurada(db);
    try {
      if (!serviceAccount) throw new Error('Google Agenda não conectado');
      eventos = await eventosPelaApi(serviceAccount, inicio, fim);
    } catch (err: any) {
      if (serviceAccount) console.warn('[import-trt-sessions] API falhou, usando iCal:', err?.message ?? err);
      eventos = await eventosPeloIcs();
    }

    const porSessao = new Map<string, Prevista>();
    for (const ev of eventos) {
      if (ev.cancelado) continue;
      const { data, hora } = ev;
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

    // Uma sessão por dia: a de maior prioridade vale; as outras são complementares
    const PRIORIDADE = ['1ª Turma', '2ª Turma', 'Pleno'];
    const porDia = new Map<string, Prevista[]>();
    for (const s of porSessao.values()) porDia.set(s.data, [...(porDia.get(s.data) ?? []), s]);
    const sessoes = [...porDia.values()].map(doDia => {
      const [principal, ...complementares] = doDia.sort((a, b) => PRIORIDADE.indexOf(a.tipo_sessao) - PRIORIDADE.indexOf(b.tipo_sessao));
      if (complementares.length === 0) return principal;
      return {
        ...principal,
        descricao: `${principal.descricao} · complementar: ${complementares.map(c => `${c.tipo_sessao} (${c.descricao})`).join(', ')}`.slice(0, 300),
      };
    }).sort((a, b) => a.data.localeCompare(b.data));
    return jsonResponse({ sessoes });
  } catch (error: any) {
    console.error('[import-trt-sessions] Error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
});
