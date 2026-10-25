import { supabase } from './supabaseClient';

/**
 * Envia mensagens de WhatsApp para um ou mais membros via Supabase Edge Function → n8n → Evolution API.
 * @param membroIds - Array de IDs dos membros destinatários
 * @param message - Texto da mensagem a ser enviada (suporta acentos e emojis)
 */
export async function sendWhatsApp(membroIds: string[], message: string): Promise<{
  sent: number;
  failed: number;
  message: string;
}> {
  const { data, error } = await supabase.functions.invoke('send-whatsapp', {
    body: {
      membro_ids: membroIds,
      message,
    },
  });

  if (error) {
    throw new Error(error.message || 'Erro ao chamar a função de envio de WhatsApp');
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return {
    sent: data?.sent ?? data?.queued ?? 0,
    failed: data?.failed ?? data?.skipped ?? 0,
    message: data?.message ?? 'Enviado',
  };
}
