import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface WhatsAppPayload {
  membro_ids: string[];
  message: string;
}

interface Membro {
  id: string;
  nome: string;
  celular_whatsapp: string;
}

/**
 * Formata o número de celular para o padrão numérico limpo (5579999999999).
 */
function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  return '55' + digits;
}

serve(async (req) => {
  // Responde ao preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const payload: WhatsAppPayload = await req.json();
    const { membro_ids, message } = payload;

    // --- Validações básicas ---
    if (!membro_ids || membro_ids.length === 0) {
      return new Response(JSON.stringify({ error: 'Nenhum membro informado' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    if (!message || !message.trim()) {
      return new Response(JSON.stringify({ error: 'Mensagem não pode ser vazia' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    // --- Busca os dados dos membros no banco ---
    const { data: membros, error: dbError } = await supabaseClient
      .from('membros')
      .select('id, nome, celular_whatsapp')
      .in('id', membro_ids)
      .not('celular_whatsapp', 'is', null)
      .neq('celular_whatsapp', '');

    if (dbError) throw dbError;

    if (!membros || membros.length === 0) {
      return new Response(
        JSON.stringify({
          message: 'Nenhum membro com WhatsApp cadastrado encontrado',
          queued: 0,
          skipped: membro_ids.length,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    // --- Envio direto pela Evolution API (v2), se configurada ---
    const evolutionUrl = (Deno.env.get('EVOLUTION_API_URL') ?? '').replace(/\/+$/, '');
    const evolutionInstance = Deno.env.get('EVOLUTION_INSTANCE') ?? '';
    const evolutionKey = Deno.env.get('EVOLUTION_API_KEY') ?? '';

    if (evolutionUrl && evolutionInstance && evolutionKey) {
      let sent = 0;
      const falhas: string[] = [];
      for (const [i, membro] of membros.entries()) {
        // Pequeno intervalo entre mensagens para não arriscar bloqueio do número
        if (i > 0) await new Promise((r) => setTimeout(r, 3000));
        try {
          const resp = await fetch(`${evolutionUrl}/message/sendText/${encodeURIComponent(evolutionInstance)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8', apikey: evolutionKey },
            body: JSON.stringify({ number: formatPhone(membro.celular_whatsapp), text: message }),
          });
          if (resp.ok) {
            sent++;
          } else {
            falhas.push(`${membro.nome}: HTTP ${resp.status} ${(await resp.text()).slice(0, 200)}`);
          }
        } catch (err: any) {
          falhas.push(`${membro.nome}: ${err?.message ?? err}`);
        }
      }
      if (falhas.length) console.error('[send-whatsapp] Falhas na Evolution API:', falhas);

      return new Response(
        JSON.stringify({
          message: `${sent} mensagem(ns) enviada(s) pela Evolution API.`,
          sent,
          failed: falhas.length,
          skipped: membro_ids.length - membros.length,
          ...(falhas.length ? { errors: falhas } : {}),
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }, status: 200 }
      );
    }

    // --- Caso contrário, envia o lote para o webhook do n8n ---
    const n8nWebhookUrl = Deno.env.get('N8N_WHATSAPP_WEBHOOK_URL');
    if (!n8nWebhookUrl) {
      throw new Error('WhatsApp não configurado: defina EVOLUTION_API_URL, EVOLUTION_INSTANCE e EVOLUTION_API_KEY (ou N8N_WHATSAPP_WEBHOOK_URL) nos secrets do Supabase');
    }

    // --- Monta o payload em Lote para o n8n ---
    const contatosPayload = membros.map((membro) => ({
      nome: membro.nome,
      phone: formatPhone(membro.celular_whatsapp),
      message: message,
    }));

    console.log(`[send-whatsapp] Disparando lote de ${contatosPayload.length} contatos para o n8n...`);

    // --- Envia TUDO de uma vez para o n8n ---
    // Agora o n8n será responsável por gerenciar o loop e o delay de 20s
    const bodyJson = JSON.stringify({
      lote: true,
      quantidade: contatosPayload.length,
      contatos: contatosPayload,
    });
    
    const bodyBytes = new TextEncoder().encode(bodyJson);

    const response = await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Accept': 'application/json',
      },
      body: bodyBytes,
    });

    const responseText = await response.text();
    if (!response.ok) {
      console.error(`[send-whatsapp] ❌ Falha no webhook n8n — status ${response.status}: ${responseText}`);
      throw new Error(`Falha no n8n: ${response.status}`);
    }

    console.log(`[send-whatsapp] ✅ Lote enviado com sucesso para o n8n.`);

    // Resposta IMEDIATA ao front-end
    return new Response(
      JSON.stringify({
        message: `Lote de ${contatosPayload.length} contato(s) enviado ao n8n com sucesso.`,
        queued: contatosPayload.length,
        skipped: membro_ids.length - contatosPayload.length,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error('[send-whatsapp] Erro na Edge Function:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
