import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, jsonResponse, createAdminClient, getCaller } from '../_shared/auth.ts';

serve(async (req) => {
  // Tratamento de CORS para chamadas do frontend
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createAdminClient();

    const caller = await getCaller(req, supabaseClient);
    if (!caller.isAdmin) throw new Error('Apenas administradores podem cadastrar técnicos.');

    const { email, password, nome, celular_whatsapp, foto_url, ativo, is_admin } = await req.json();

    if (!email || !password || !nome) {
      throw new Error("E-mail, senha e nome são obrigatórios.");
    }

    // 1. Cria o usuário no Auth (sem enviar email de confirmação)
    const { data: authData, error: authError } = await supabaseClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true // Ignora a confirmação do email
    });

    if (authError) throw authError;

    const newUserId = authData.user.id;

    // 2. Insere na tabela pública de membros
    const { error: dbError } = await supabaseClient.from('membros').insert({
      id: newUserId,
      nome,
      email,
      celular_whatsapp: celular_whatsapp || null,
      foto_url: foto_url || null,
      ativo: ativo !== undefined ? ativo : true,
      is_admin: !!is_admin
    });

    if (dbError) {
      // Evita deixar um usuário órfão no Auth
      await supabaseClient.auth.admin.deleteUser(newUserId);
      throw dbError;
    }

    return jsonResponse({ message: 'Membro criado com sucesso', userId: newUserId });
  } catch (error: any) {
    // Retornamos 200 para que o frontend consiga ler o JSON ao invés de estourar erro HTTP
    return jsonResponse({ error: error.message || 'Erro desconhecido na função' });
  }
});
