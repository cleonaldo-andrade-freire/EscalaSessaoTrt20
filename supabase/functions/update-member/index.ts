import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, jsonResponse, createAdminClient, getCaller } from '../_shared/auth.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createAdminClient();
    const caller = await getCaller(req, supabaseClient);

    const { userId, email, password, nome, celular_whatsapp, ativo, is_admin, foto_url, updateAuth } = await req.json();

    if (!userId) {
      throw new Error("ID do usuário é obrigatório.");
    }

    // Técnico comum só pode editar o próprio telefone e foto
    const isSelf = caller.id === userId;
    if (!caller.isAdmin && !isSelf) {
      throw new Error('Sem permissão para editar este técnico.');
    }

    const dbUpdatePayload: any = {};
    if (celular_whatsapp !== undefined) dbUpdatePayload.celular_whatsapp = celular_whatsapp;
    if (foto_url !== undefined) dbUpdatePayload.foto_url = foto_url;

    if (caller.isAdmin) {
      // 1. Atualiza no Auth (E-mail e/ou Senha) se solicitado
      if (updateAuth) {
        const authUpdatePayload: any = {};
        if (email) authUpdatePayload.email = email;
        if (password) authUpdatePayload.password = password;

        if (Object.keys(authUpdatePayload).length > 0) {
          // Ignora a confirmação de email na alteração
          authUpdatePayload.email_confirm = true;
          const { error: authError } = await supabaseClient.auth.admin.updateUserById(userId, authUpdatePayload);
          if (authError) throw authError;
        }
      }

      if (nome !== undefined) dbUpdatePayload.nome = nome;
      if (email !== undefined) dbUpdatePayload.email = email;
      if (ativo !== undefined) dbUpdatePayload.ativo = ativo;
      // Um admin não pode remover o próprio acesso de administrador
      if (is_admin !== undefined && !(isSelf && is_admin === false)) dbUpdatePayload.is_admin = is_admin;
    }

    // 2. Atualiza na tabela pública de membros
    if (Object.keys(dbUpdatePayload).length > 0) {
      const { error: dbError } = await supabaseClient
        .from('membros')
        .update(dbUpdatePayload)
        .eq('id', userId);

      if (dbError) throw dbError;
    }

    return jsonResponse({ message: 'Membro atualizado com sucesso' });
  } catch (error: any) {
    return jsonResponse({ error: error.message || 'Erro desconhecido na função' });
  }
});
