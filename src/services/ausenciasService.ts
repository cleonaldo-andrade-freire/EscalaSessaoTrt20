import { supabase } from './supabaseClient';
import { AusenciaProgramada, Membro } from '../types';
import { getLocalDateStr } from '../utils/date';

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
    motivo: a.motivo || '',
    createdAt: a.created_at
  }));
}

/**
 * Registra a ausência de um período (inclusive), uma linha por dia — assim
 * as verificações por data da escala continuam valendo sem mudança.
 * Dias já registrados pelo membro são ignorados.
 */
export async function saveAusenciaPeriodo(membroId: string, inicio: string, fim: string, motivo: string): Promise<number> {
  const dias: string[] = [];
  for (let d = new Date(inicio + 'T12:00:00'); getLocalDateStr(d) <= fim; d.setDate(d.getDate() + 1)) {
    dias.push(getLocalDateStr(d));
  }

  const { data: existentes, error: errExist } = await supabase
    .from('ausencias_programadas')
    .select('data_especifica')
    .eq('membro_id', membroId)
    .gte('data_especifica', inicio)
    .lte('data_especifica', fim);
  if (errExist) throw errExist;

  const jaRegistrados = new Set((existentes || []).map((e: any) => e.data_especifica));
  const novos = dias.filter(d => !jaRegistrados.has(d));
  if (novos.length === 0) return 0;

  const { error } = await supabase
    .from('ausencias_programadas')
    .insert(novos.map(d => ({ membro_id: membroId, data_especifica: d, motivo })));
  if (error) throw error;
  return novos.length;
}

// Dias gravados juntos (mesmo membro, created_at e motivo) formam um período
export interface PeriodoAusencia {
  chave: string;
  membroId: string;
  inicio: string;
  fim: string;
  motivo: string;
  dias: AusenciaProgramada[];
}

export function agruparPeriodos(lista: AusenciaProgramada[]): PeriodoAusencia[] {
  const grupos: Record<string, PeriodoAusencia> = {};
  lista.forEach(a => {
    const chave = `${a.membroId}|${a.createdAt ?? a.id}|${a.motivo}`;
    const g = (grupos[chave] ||= { chave, membroId: a.membroId, inicio: a.dataEspecifica, fim: a.dataEspecifica, motivo: a.motivo, dias: [] });
    g.dias.push(a);
    if (a.dataEspecifica < g.inicio) g.inicio = a.dataEspecifica;
    if (a.dataEspecifica > g.fim) g.fim = a.dataEspecifica;
  });
  return Object.values(grupos).sort((a, b) => b.inicio.localeCompare(a.inicio));
}

export async function deleteAusencias(ids: string[]): Promise<void> {
  const { error } = await supabase
    .from('ausencias_programadas')
    .delete()
    .in('id', ids);
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
