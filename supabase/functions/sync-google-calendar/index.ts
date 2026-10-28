import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { corsHeaders, jsonResponse, createAdminClient, getCaller } from '../_shared/auth.ts';
import { getGoogleAccessToken } from '../_shared/google.ts';

// Espelha a escala publicada numa agenda compartilhada do Google: um evento
// por sessão (data + tipo_sessao) listando os escalados de cada função.
// A conexão (chave da Service Account + ID da agenda) é cadastrada pelo admin
// em "Google Agenda" e fica em public.google_agenda_config (só service_role lê).
//
// Chamadas aceitas:
//   - Trigger do banco (header x-cron-secret), ver supabase/sql/06_google_agenda.sql:
//       { sessoes: [{ data: 'YYYY-MM-DD', tipo_sessao: '1ª Turma' }, ...] }
//       { ausencias: ['<id>', ...] }   (ausências programadas: um evento de dia inteiro por período, título = motivo)
//   - Admin (JWT), campo `acao`:
//       status | salvar { calendar_id, service_account?, ativo } | testar
//       | sincronizar { inicio, fim } | sincronizar_ausencias | desconectar
//
// Cada sessão é relida do banco e o evento é criado, atualizado ou removido
// até ficar igual a ela — sincronizar duas vezes não duplica nada.

const FUSO = 'America/Maceio';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

const CODIGO_SESSAO: Record<string, string> = { '1ª Turma': 't1', '2ª Turma': 't2', 'Pleno': 'p' };

interface Sessao { data: string; tipo_sessao: string }
interface Config { calendar_id: string; service_account: string; ativo: boolean; atualizado_em: string }

// Id fixo do evento por sessão (o Google aceita só 0-9 e a-v), dispensando
// guardar o id no banco.
const eventId = (s: Sessao) => `trt20${s.data.replace(/-/g, '')}${CODIGO_SESSAO[s.tipo_sessao] ?? 'x'}`;

// Evento da ausência: id do registro sem hífens (hex cabe no alfabeto do Google)
const eventIdAusencia = (id: string) => `aus${id.replace(/-/g, '')}`;

// Fim exclusivo do evento de dia inteiro (dia seguinte ao último dia)
const diaSeguinte = (data: string) => {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

const membroEfetivo = (e: any) =>
  e.status_substituicao === 'Substituição Aceita' && e.membro_substituto_id ? e.membro_substituto_id : e.membro_original_id;

const clientEmail = (serviceAccount: string) => {
  try { return JSON.parse(serviceAccount).client_email ?? null; } catch { return null; }
};

async function lerConfig(db: SupabaseClient): Promise<Config | null> {
  const { data, error } = await db
    .from('google_agenda_config')
    .select('calendar_id, service_account, ativo, atualizado_em')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function clienteGoogle(accessToken: string, calendarId: string) {
  const baseUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  return (method: string, path: string, payload?: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: payload ? JSON.stringify(payload) : undefined,
    });
}

async function sincronizar(db: SupabaseClient, config: Config, sessoes: Sessao[]) {
  const unicas = [...new Map(sessoes.map(s => [`${s.data}|${s.tipo_sessao}`, s])).values()];
  if (unicas.length === 0) return [];

  // Escalas publicadas de todas as sessões envolvidas, de uma vez
  const datas = [...new Set(unicas.map(s => s.data))];
  const { data: escalas, error: escError } = await db
    .from('escalas')
    .select('data, tipo_sessao, hora_inicio, funcao, status_substituicao, membro_original_id, membro_substituto_id')
    .eq('publicada', true)
    .in('data', datas)
    .order('funcao');
  if (escError) throw escError;

  // Quem atende e o titular (para indicar "no lugar de" nas permutas)
  const membroIds = [...new Set((escalas ?? []).flatMap(e => [membroEfetivo(e), e.membro_original_id]).filter(Boolean))];
  const nomes: Record<string, string> = {};
  if (membroIds.length) {
    const { data: membros } = await db.from('membros').select('id, nome').in('id', membroIds);
    for (const m of membros ?? []) nomes[m.id] = m.nome;
  }

  const google = clienteGoogle(await getGoogleAccessToken(config.service_account, SCOPE), config.calendar_id);

  const resultados: any[] = [];
  for (const sessao of unicas) {
    const id = eventId(sessao);
    const slots = (escalas ?? []).filter(e => e.data === sessao.data && e.tipo_sessao === sessao.tipo_sessao);

    try {
      if (slots.length === 0) {
        // Sessão sem escala publicada: remove o evento, se existir
        const resp = await google('DELETE', `/${id}`);
        if (!resp.ok && resp.status !== 404 && resp.status !== 410) {
          throw new Error(`HTTP ${resp.status} ${(await resp.text()).slice(0, 200)}`);
        }
        resultados.push({ ...sessao, acao: 'removido' });
        continue;
      }

      const horario = slots.map(s => String(s.hora_inicio).slice(0, 5)).sort()[0];
      const escalados = slots.map(s => nomes[membroEfetivo(s)] ?? 'Técnico');
      // A duração da sessão é imprevisível: o evento começa e termina no horário de início
      const inicio = { dateTime: `${sessao.data}T${horario}:00`, timeZone: FUSO };
      const evento = {
        id,
        summary: `Sessão ${sessao.tipo_sessao} – ${[...new Set(escalados)].join(', ')}`,
        description: slots.map((s, i) => {
          const trocou = membroEfetivo(s) !== s.membro_original_id;
          return `${s.funcao}: ${escalados[i]}${trocou ? ` (no lugar de ${nomes[s.membro_original_id] ?? 'titular'})` : ''}`;
        }).join('\n'),
        start: inicio,
        end: inicio,
        status: 'confirmed',
      };

      // Atualiza (também "ressuscita" um evento removido antes); se nunca existiu, cria
      let resp = await google('PUT', `/${id}`, evento);
      if (resp.status === 404) resp = await google('POST', '', evento);
      if (!resp.ok) throw new Error(`HTTP ${resp.status} ${(await resp.text()).slice(0, 200)}`);
      resultados.push({ ...sessao, acao: 'atualizado' });
    } catch (err: any) {
      console.error(`[sync-google-calendar] Falha em ${sessao.data} ${sessao.tipo_sessao}:`, err?.message ?? err);
      resultados.push({ ...sessao, acao: 'erro', erro: err?.message ?? String(err) });
    }
  }
  return resultados;
}

// Ausências programadas: um evento de dia inteiro por período, com o motivo
// no título. Id que não existe mais no banco = apaga o evento.
async function sincronizarAusencias(db: SupabaseClient, config: Config, ids: string[]) {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return [];

  const { data: ausencias, error } = await db
    .from('ausencias_programadas')
    .select('id, data_inicio, data_fim, motivo, membro:membro_id ( nome )')
    .in('id', unicos);
  if (error) throw error;
  const porId = new Map((ausencias ?? []).map((a: any) => [a.id, a]));

  const google = clienteGoogle(await getGoogleAccessToken(config.service_account, SCOPE), config.calendar_id);

  const resultados: any[] = [];
  for (const id of unicos) {
    const eventId = eventIdAusencia(id);
    const a: any = porId.get(id);
    try {
      if (!a) {
        const resp = await google('DELETE', `/${eventId}`);
        if (!resp.ok && resp.status !== 404 && resp.status !== 410) {
          throw new Error(`HTTP ${resp.status} ${(await resp.text()).slice(0, 200)}`);
        }
        resultados.push({ ausencia: id, acao: 'removido' });
        continue;
      }

      const evento = {
        id: eventId,
        summary: `${a.motivo?.trim() || 'Ausência'} – ${a.membro?.nome ?? 'Técnico'}`,
        start: { date: a.data_inicio },
        end: { date: diaSeguinte(a.data_fim) },
        transparency: 'transparent', // não bloqueia horário de ninguém
        colorId: '8',                // cinza, para separar das sessões
        status: 'confirmed',
      };
      let resp = await google('PUT', `/${eventId}`, evento);
      if (resp.status === 404) resp = await google('POST', '', evento);
      if (!resp.ok) throw new Error(`HTTP ${resp.status} ${(await resp.text()).slice(0, 200)}`);
      resultados.push({ ausencia: id, acao: 'atualizado' });
    } catch (err: any) {
      console.error(`[sync-google-calendar] Falha na ausência ${id}:`, err?.message ?? err);
      resultados.push({ ausencia: id, acao: 'erro', erro: err?.message ?? String(err) });
    }
  }
  return resultados;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const db = createAdminClient();
    const body = await req.json().catch(() => ({}));

    // --- Chamada do trigger do banco (mesmo segredo do pg_cron dos lembretes) ---
    const cronSecret = Deno.env.get('CRON_SECRET') ?? '';
    if (req.headers.get('x-cron-secret')) {
      if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
        console.warn('[sync-google-calendar] Unauthorized request');
        return jsonResponse({ error: 'Não autorizado' }, 401);
      }
      const config = await lerConfig(db);
      if (!config?.ativo) return jsonResponse({ message: 'Sincronização desativada.' });
      const resultados = [
        ...await sincronizar(db, config, Array.isArray(body.sessoes) ? body.sessoes : []),
        ...await sincronizarAusencias(db, config, Array.isArray(body.ausencias) ? body.ausencias : []),
      ];
      const falhas = resultados.filter(r => r.acao === 'erro').length;
      return jsonResponse({ success: falhas === 0, resultados }, falhas ? 502 : 200);
    }

    // --- Tela do admin ---
    const caller = await getCaller(req, db).catch(() => null);
    if (!caller?.isAdmin) return jsonResponse({ error: 'Apenas administradores.' }, 403);

    const config = await lerConfig(db);

    switch (body.acao) {
      case 'status':
        return jsonResponse({
          configurado: !!config,
          ativo: !!config?.ativo,
          calendar_id: config?.calendar_id ?? '',
          client_email: config ? clientEmail(config.service_account) : null,
          atualizado_em: config?.atualizado_em ?? null,
        });

      case 'salvar': {
        const calendarId = String(body.calendar_id ?? '').trim();
        // Chave em branco mantém a já cadastrada (a tela nunca recebe a chave de volta)
        const serviceAccount = String(body.service_account ?? '').trim() || config?.service_account || '';
        if (!calendarId) return jsonResponse({ error: 'Informe o ID da agenda.' }, 400);
        if (!serviceAccount) return jsonResponse({ error: 'Cole a chave JSON da Service Account.' }, 400);
        let sa: any;
        try { sa = JSON.parse(serviceAccount); } catch { return jsonResponse({ error: 'A chave não é um JSON válido.' }, 400); }
        if (sa.type !== 'service_account' || !sa.client_email || !sa.private_key) {
          return jsonResponse({ error: 'O JSON não é a chave de uma Service Account (faltam client_email/private_key).' }, 400);
        }
        const { error } = await db.from('google_agenda_config').upsert({
          id: 1,
          calendar_id: calendarId,
          service_account: serviceAccount,
          ativo: !!body.ativo,
          atualizado_em: new Date().toISOString(),
        });
        if (error) throw error;
        return jsonResponse({ success: true, client_email: sa.client_email });
      }

      case 'testar': {
        if (!config) return jsonResponse({ error: 'Salve a configuração antes de testar.' }, 400);
        const google = clienteGoogle(await getGoogleAccessToken(config.service_account, SCOPE), config.calendar_id);
        const resp = await google('GET', '?maxResults=1');
        const info = await resp.json().catch(() => ({}));
        if (resp.status === 404) {
          return jsonResponse({ error: `Agenda não encontrada. Confira o ID e se ela foi compartilhada com ${clientEmail(config.service_account)}.` }, 400);
        }
        if (!resp.ok) return jsonResponse({ error: info?.error?.message ?? `Google respondeu HTTP ${resp.status}` }, 400);
        if (info.accessRole !== 'writer' && info.accessRole !== 'owner') {
          return jsonResponse({ error: `A agenda "${info.summary}" foi compartilhada só para leitura. Dê a permissão "Fazer alterações nos eventos".` }, 400);
        }
        return jsonResponse({ success: true, agenda: info.summary });
      }

      case 'sincronizar': {
        if (!config) return jsonResponse({ error: 'Salve a configuração antes de sincronizar.' }, 400);
        if (!body.inicio || !body.fim) return jsonResponse({ error: 'Informe o período.' }, 400);
        const { data, error } = await db
          .from('escalas')
          .select('data, tipo_sessao')
          .eq('publicada', true)
          .gte('data', body.inicio)
          .lte('data', body.fim);
        if (error) throw error;
        // Ausências que tocam o período (início antes do fim e fim depois do início)
        const { data: ausencias, error: ausError } = await db
          .from('ausencias_programadas')
          .select('id')
          .lte('data_inicio', body.fim)
          .gte('data_fim', body.inicio);
        if (ausError) throw ausError;
        const resultados = [
          ...await sincronizar(db, config, data ?? []),
          ...await sincronizarAusencias(db, config, (ausencias ?? []).map((a: any) => a.id)),
        ];
        const falhas = resultados.filter(r => r.acao === 'erro');
        return jsonResponse({
          success: falhas.length === 0,
          sincronizadas: resultados.length - falhas.length,
          falhas: falhas.length,
          ...(falhas.length ? { erro: falhas[0].erro } : {}),
        });
      }

      case 'sincronizar_ausencias': {
        if (!config) return jsonResponse({ error: 'Conecte o Google Agenda antes de sincronizar.' }, 400);
        const { data, error } = await db.from('ausencias_programadas').select('id');
        if (error) throw error;
        const resultados = await sincronizarAusencias(db, config, (data ?? []).map((a: any) => a.id));
        const falhas = resultados.filter(r => r.acao === 'erro');
        return jsonResponse({
          success: falhas.length === 0,
          sincronizadas: resultados.length - falhas.length,
          falhas: falhas.length,
          ...(falhas.length ? { erro: falhas[0].erro } : {}),
        });
      }

      case 'desconectar': {
        const { error } = await db.from('google_agenda_config').delete().eq('id', 1);
        if (error) throw error;
        return jsonResponse({ success: true });
      }

      default:
        return jsonResponse({ error: 'Ação inválida.' }, 400);
    }
  } catch (error: any) {
    console.error('[sync-google-calendar] Error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
});
