import { supabase } from './supabaseClient';

export interface GoogleAgendaStatus {
  configurado: boolean;
  ativo: boolean;
  calendar_id: string;
  client_email: string | null;
  atualizado_em: string | null;
}

/**
 * Chama a Edge Function sync-google-calendar (somente admin).
 * Em respostas de erro (4xx/5xx) lê a mensagem do corpo, que o supabase-js
 * esconderia atrás de "non-2xx status code".
 */
export async function googleAgenda<T = any>(acao: string, params: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('sync-google-calendar', {
    body: { acao, ...params },
  });

  if (error) {
    const corpo = await (error as any).context?.json?.().catch(() => null);
    throw new Error(corpo?.error || error.message || 'Erro ao falar com o Google Agenda');
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}
