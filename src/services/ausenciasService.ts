import { supabase } from './supabaseClient';
import { AusenciaProgramada, Membro } from '../types';
import { getLocalDateStr } from '../utils/date';

// Mais recentes primeiro (pelo início do período)
export async function getAusencias(): Promise<AusenciaProgramada[]> {
  const { data, error } = await supabase
    .from('ausencias_programadas')
    .select('*')
    .order('data_inicio', { ascending: false });

  if (error) throw error;

  return (data || []).map((a: any) => ({
    id: a.id,
    membroId: a.membro_id,
    dataInicio: a.data_inicio,
    dataFim: a.data_fim,
    motivo: a.motivo || ''
  }));
}

/** Registra a ausência de um período (inclusive) como um único registro. */
export async function saveAusenciaPeriodo(membroId: string, inicio: string, fim: string, motivo: string): Promise<void> {
  // Períodos do mesmo técnico não se sobrepõem
  const { data: sobrepostas, error: errSobreposicao } = await supabase
    .from('ausencias_programadas')
    .select('id')
    .eq('membro_id', membroId)
    .lte('data_inicio', fim)
    .gte('data_fim', inicio)
    .limit(1);
  if (errSobreposicao) throw errSobreposicao;
  if (sobrepostas && sobrepostas.length > 0) {
    throw new Error('Já existe ausência registrada em parte desse período.');
  }

  const { error } = await supabase
    .from('ausencias_programadas')
    .insert({ membro_id: membroId, data_inicio: inicio, data_fim: fim, motivo });
  if (error) throw error;
}

/**
 * Cancela a ausência. Se o período já começou, os dias passados ficam
 * registrados e o período é encerrado ontem; senão, o registro é apagado.
 */
export async function cancelarAusencia(a: AusenciaProgramada): Promise<void> {
  const hoje = getLocalDateStr();
  if (a.dataInicio < hoje) {
    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);
    const { error } = await supabase
      .from('ausencias_programadas')
      .update({ data_fim: getLocalDateStr(ontem) })
      .eq('id', a.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from('ausencias_programadas')
    .delete()
    .eq('id', a.id);
  if (error) throw error;
}

/** Quantidade de dias do período (inclusive). */
export const diasDoPeriodo = (inicio: string, fim: string) =>
  Math.round((new Date(fim + 'T12:00:00').getTime() - new Date(inicio + 'T12:00:00').getTime()) / 86400000) + 1;

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
