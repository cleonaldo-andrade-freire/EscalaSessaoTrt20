import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface NotificationPayload {
  membro_ids: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
}

// O Google Credentials JSON file in string format must be set as an environment variable in Supabase.
// Secret name: FIREBASE_SERVICE_ACCOUNT_KEY
// Example: supabase secrets set FIREBASE_SERVICE_ACCOUNT_KEY='{ "type": "service_account", ... }'

async function getAccessToken(serviceAccountStr: string) {
  const serviceAccount = JSON.parse(serviceAccountStr);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    getPrivateKeyBuffer(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: { name: "SHA-256" } },
    false,
    ["sign"]
  );

  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const jwt = await createJwt(header, payload, cryptoKey);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  const data = await response.json();
  return data.access_token;
}

// Helpers for JWT creation
function getPrivateKeyBuffer(privateKey: string) {
  const pemHeader = "-----BEGIN PRIVATE KEY-----";
  const pemFooter = "-----END PRIVATE KEY-----";
  const pemContents = privateKey.substring(
    privateKey.indexOf(pemHeader) + pemHeader.length,
    privateKey.indexOf(pemFooter)
  );
  const binaryDerString = atob(pemContents.replace(/\s/g, ""));
  const binaryDer = new Uint8Array(binaryDerString.length);
  for (let i = 0; i < binaryDerString.length; i++) {
    binaryDer[i] = binaryDerString.charCodeAt(i);
  }
  return binaryDer.buffer;
}

function encodeBase64Url(source: string | Uint8Array) {
  let encoded = typeof source === 'string' ? btoa(source) : btoa(String.fromCharCode(...source));
  return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function createJwt(header: any, payload: any, cryptoKey: CryptoKey) {
  const encodedHeader = encodeBase64Url(JSON.stringify(header));
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const dataToSign = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const signature = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, cryptoKey, dataToSign);
  const encodedSignature = encodeBase64Url(new Uint8Array(signature));
  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}


serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    const payload: NotificationPayload = await req.json()
    console.log('Recebido payload:', payload);
    const { membro_ids, title, body, data } = payload

    if (!membro_ids || !membro_ids.length) {
      return new Response(JSON.stringify({ error: 'Nenhum membro informado' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    // 1. Get tokens from database
    const { data: tokensData, error: dbError } = await supabaseClient
      .from('membro_fcm_tokens')
      .select('token')
      .in('membro_id', membro_ids)

    if (dbError) throw dbError

    const tokens = [...new Set(tokensData.map((t: any) => t.token))]
    console.log(`Encontrados ${tokens.length} tokens únicos para os membros solicitados.`);

    if (tokens.length === 0) {
      return new Response(JSON.stringify({ message: 'Nenhum token encontrado para os membros informados' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // 2. Auth with Firebase
    const serviceAccountStr = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_KEY');
    if (!serviceAccountStr) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY environment variable is not set");
    }

    const projectId = JSON.parse(serviceAccountStr).project_id;
    console.log('Gerando access token para o projeto:', projectId);
    const accessToken = await getAccessToken(serviceAccountStr);

    // 3. Send notifications via FCM HTTP v1 API
    const sendResults = [];
    for (const token of tokens) {
      const fcmMessage = {
        message: {
          token: token,
          // Enviando como data-only para que o onBackgroundMessage seja acionado no Android
          data: {
            title: title || 'Notificação',
            body: body || '',
            ...data
          }
        }
      };

      const fcmResponse = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(fcmMessage)
      });

      const result = await fcmResponse.json();
      console.log('Resultado do envio para o token', token, ':', result);

      // Limpar tokens expirados/desinstalados do banco de dados
      if (
        result.error &&
        (result.error.status === 'NOT_FOUND' ||
          (result.error.details && result.error.details.some((d: any) => d.errorCode === 'UNREGISTERED')))
      ) {
        console.log(`Removendo token expirado do banco de dados: ${token}`);
        
        // Criando admin client para burlar RLS (já que o admin pode não ter permissão de apagar token de outro usuário)
        const adminClient = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );
        
        const { error: deleteError } = await adminClient
          .from('membro_fcm_tokens')
          .delete()
          .eq('token', token);
          
        if (deleteError) {
          console.error('Erro ao deletar token inválido:', deleteError);
        }
      }

      sendResults.push({ token, result });
    }

    return new Response(
      JSON.stringify({ message: 'Notificações enviadas', results: sendResults }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    console.error('Erro na execução da Edge Function:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
