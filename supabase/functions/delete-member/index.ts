import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, jsonResponse, createAdminClient, getCaller } from '../_shared/auth.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createAdminClient();

    const caller = await getCaller(req, supabaseClient);
    if (!caller.isAdmin) throw new Error('Apenas administradores podem remover técnicos.');

    const { userId } = await req.json();

    if (!userId) {
      throw new Error("ID do usuário é obrigatório.");
    }
    if (userId === caller.id) {
      throw new Error('Você não pode remover o próprio usuário.');
    }

    // Técnicos com escalas registradas não podem ser removidos (preserva o
    // histórico de check-in/check-out). Nesse caso, marque-os como inativos.
    const { count } = await supabaseClient
      .from('escalas')
      .select('id', { count: 'exact', head: true })
      .eq('membro_original_id', userId);
    if (count && count > 0) {
      throw new Error('Este técnico possui escalas registradas. Marque-o como inativo em vez de removê-lo.');
    }

    // Deletar o usuário no Auth (isso causará um CASCADE para a tabela public.membros)
    const { error: deleteError } = await supabaseClient.auth.admin.deleteUser(userId);

    if (deleteError) throw deleteError;

    return jsonResponse({ message: 'Membro removido com sucesso' });
  } catch (error: any) {
    return jsonResponse({ error: error.message || 'Erro desconhecido na exclusão' });
  }
});
