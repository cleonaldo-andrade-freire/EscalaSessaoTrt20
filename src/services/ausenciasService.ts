import { supabase } from './supabaseClient';
import { AusenciaProgramada, Membro } from '../types';

export async function getAusencias(): Promise<AusenciaProgramada[]> {
  const { data, error } = await supabase
    .from('ausencias_programadas')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data || []).map((a: any) => ({
    id: a.id,
    membroId: a.membro_id,
    dataEspecifica: a.data_especifica,
    motivo: a.motivo || ''
  }));
}

export async function saveAusencia(a: Omit<AusenciaProgramada, 'id'>): Promise<void> {
  const { error } = await supabase
    .from('ausencias_programadas')
    .insert({
      membro_id: a.membroId,
      data_especifica: a.dataEspecifica,
      motivo: a.motivo
    });
  if (error) throw error;
}

export async function deleteAusencia(id: string): Promise<void> {
  const { error } = await supabase
    .from('ausencias_programadas')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

export async function getMembros(): Promise<Membro[]> {
  const { data, error } = await supabase
    .from('membros')
    .select('id, nome, email, celular_whatsapp, foto_url, is_admin, ativo')
    .order('nome', { ascending: true });

  if (error) throw error;

  return (data || []).map((m: any) => ({
    id: m.id,
    nome: m.nome,
    email: m.email,
    celularWhatsapp: m.celular_whatsapp || '',
    fotoUrl: m.foto_url || '',
    isAdmin: !!m.is_admin,
    ativo: m.ativo !== false
  }));
}
