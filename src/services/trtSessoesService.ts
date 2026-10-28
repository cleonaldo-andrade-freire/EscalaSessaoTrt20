import { supabase } from './supabaseClient';

export interface SessaoTRT {
  data: string;        // YYYY-MM-DD
  tipo_sessao: string; // 1ª Turma | 2ª Turma | Pleno
  hora_inicio: string; // HH:MM
  descricao: string;   // título no calendário do TRT, ex.: "9h - 39ª SP 2T"
}

/**
 * Sessões presenciais do período no calendário público do TRT20
 * (Edge Function import-trt-sessions, somente admin).
 */
export async function buscarSessoesTRT(inicio: string, fim: string): Promise<SessaoTRT[]> {
  const { data, error } = await supabase.functions.invoke('import-trt-sessions', {
    body: { inicio, fim },
  });
  if (error) {
    // Em respostas 4xx/5xx a mensagem útil está no corpo
    const corpo = await (error as any).context?.json?.().catch(() => null);
    throw new Error(corpo?.error || error.message || 'Erro ao ler o calendário do TRT');
  }
  if (data?.error) throw new Error(data.error);
  return data?.sessoes ?? [];
}
