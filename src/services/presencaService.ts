import { supabase } from './supabaseClient';

/**
 * Registra check-in/check-out via funções RPC do banco (ver supabase/sql/01_schema.sql).
 * O horário é gravado pelo servidor (now()); apenas administradores podem
 * informar um horário manual (`horario`, ISO) — ex.: lançamento retroativo.
 */
export async function registrarCheckin(escalaId: string, horario?: string | null): Promise<string> {
  const { data, error } = await supabase.rpc('registrar_checkin', {
    p_escala_id: escalaId,
    p_horario: horario ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function registrarCheckout(escalaId: string, horario?: string | null): Promise<string> {
  const { data, error } = await supabase.rpc('registrar_checkout', {
    p_escala_id: escalaId,
    p_horario: horario ?? null,
  });
  if (error) throw error;
  return data as string;
}
