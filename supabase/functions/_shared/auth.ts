import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });

export const createAdminClient = (): SupabaseClient =>
  createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

/**
 * Identifica o usuário que chamou a função (pelo JWT do header Authorization)
 * e informa se ele é administrador. Lança erro se não houver usuário válido.
 */
export async function getCaller(req: Request, adminClient: SupabaseClient): Promise<{ id: string; isAdmin: boolean }> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('Não autenticado.');

  const { data, error } = await adminClient.auth.getUser(token);
  if (error || !data?.user) throw new Error('Sessão inválida. Faça login novamente.');

  const { data: membro } = await adminClient
    .from('membros')
    .select('is_admin')
    .eq('id', data.user.id)
    .maybeSingle();

  return { id: data.user.id, isAdmin: !!membro?.is_admin };
}
