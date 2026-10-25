import React, { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../../services/supabaseClient';
import AdminLayout from '../../layouts/AdminLayout';
import { ClipboardList, Download, Calendar, User, Clock } from 'lucide-react';
import CustomDatePicker from '../../components/CustomDatePicker';
import { SESSOES_DISPONIVEIS } from '../../constants';
import { getLocalDateStr, formatHora, formatDuracao } from '../../utils/date';

type Linha = {
  id: string;
  data: string;
  hora: string;
  sessao: string;
  funcao: string;
  membroId: string;
  membroNome: string;
  substituto: boolean;
  status: 'Presente' | 'Falta' | 'Pendente';
  checkinEm: string | null;
  checkoutEm: string | null;
  minutos: number;
  registroCheckin: string;
  registroCheckout: string;
};

const minutosEntre = (inicio: string | null, fim: string | null) =>
  inicio && fim ? Math.max(0, Math.round((new Date(fim).getTime() - new Date(inicio).getTime()) / 60000)) : 0;

const formatHoras = (minutos: number) =>
  `${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, '0')}`;

const AttendanceReport = () => {
  const hoje = new Date();
  const [dataInicio, setDataInicio] = useState(getLocalDateStr(new Date(hoje.getFullYear(), hoje.getMonth(), 1)));
  const [dataFim, setDataFim] = useState(getLocalDateStr(hoje));
  const [filterSessao, setFilterSessao] = useState('');
  const [filterMembro, setFilterMembro] = useState('');
  const [apenasPresencas, setApenasPresencas] = useState(false);

  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [membros, setMembros] = useState<{ id: string; nome: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('membros').select('id, nome').order('nome').then(({ data }) => setMembros(data || []));
  }, []);

  useEffect(() => {
    fetchRelatorio();
  }, [dataInicio, dataFim, filterSessao]);

  const fetchRelatorio = async () => {
    setLoading(true);
    // Só sessões já ocorridas (até hoje)
    const fim = dataFim && dataFim < getLocalDateStr() ? dataFim : getLocalDateStr();

    let query = supabase
      .from('escalas')
      .select(`
        id, data, hora_inicio, tipo_sessao, funcao, status_substituicao, compareceu,
        checkin_em, checkout_em, checkin_por, checkout_por,
        membro_original:membro_original_id ( id, nome ),
        membro_substituto:membro_substituto_id ( id, nome ),
        quem_checkin:checkin_por ( nome ),
        quem_checkout:checkout_por ( nome )
      `)
      .lte('data', fim);

    if (dataInicio) query = query.gte('data', dataInicio);
    if (filterSessao) query = query.eq('tipo_sessao', filterSessao);

    const { data, error } = await query
      .order('data', { ascending: true })
      .order('hora_inicio', { ascending: true });

    if (error) {
      console.error('Erro ao carregar relatório:', error);
      toast.error('Erro ao carregar o relatório.');
      setLinhas([]);
    } else {
      setLinhas((data || []).map((e: any) => {
        const substituto = e.status_substituicao === 'Substituição Aceita' && !!e.membro_substituto;
        const membro = substituto ? e.membro_substituto : e.membro_original;
        // Quem registrou: o próprio técnico ou o admin (lançamento manual)
        const registro = (por: string | null, quem: any) =>
          !por ? '' : por === membro?.id ? 'Próprio' : `Admin (${quem?.nome?.split(' ')[0] ?? '—'})`;
        return {
          id: e.id,
          data: e.data,
          hora: e.hora_inicio?.slice(0, 5) || '',
          sessao: e.tipo_sessao,
          funcao: e.funcao,
          membroId: membro?.id || '',
          membroNome: membro?.nome || '—',
          substituto,
          status: e.compareceu === true ? 'Presente' : e.compareceu === false ? 'Falta' : 'Pendente',
          checkinEm: e.checkin_em,
          checkoutEm: e.checkout_em,
          minutos: minutosEntre(e.checkin_em, e.checkout_em),
          registroCheckin: registro(e.checkin_por, e.quem_checkin),
          registroCheckout: registro(e.checkout_por, e.quem_checkout),
        } as Linha;
      }));
    }
    setLoading(false);
  };

  // Filtros de membro e status são aplicados no cliente (o membro efetivo pode ser o substituto)
  const linhasFiltradas = useMemo(() => linhas.filter(l =>
    (!filterMembro || l.membroId === filterMembro) &&
    (!apenasPresencas || l.status === 'Presente')
  ), [linhas, filterMembro, apenasPresencas]);

  const totaisPorMembro = useMemo(() => {
    const mapa: Record<string, { nome: string; sessoes: number; presencas: number; faltas: number; semCheckout: number; minutos: number }> = {};
    linhasFiltradas.forEach(l => {
      if (!mapa[l.membroId]) mapa[l.membroId] = { nome: l.membroNome, sessoes: 0, presencas: 0, faltas: 0, semCheckout: 0, minutos: 0 };
      const t = mapa[l.membroId];
      t.sessoes++;
      if (l.status === 'Presente') t.presencas++;
      if (l.status === 'Falta') t.faltas++;
      if (l.status === 'Presente' && !l.checkoutEm) t.semCheckout++;
      t.minutos += l.minutos;
    });
    return Object.values(mapa).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [linhasFiltradas]);

  const totalMinutos = totaisPorMembro.reduce((acc, t) => acc + t.minutos, 0);
  const totalPresencas = totaisPorMembro.reduce((acc, t) => acc + t.presencas, 0);

  const formatData = (dataStr: string) =>
    new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(dataStr + 'T12:00:00'));

  const exportarCSV = () => {
    if (linhasFiltradas.length === 0) {
      toast.error('Nenhum registro para exportar.');
      return;
    }
    // Separador ";" e BOM UTF-8 para abrir corretamente no Excel em português
    const esc = (v: string | number) => {
      const s = String(v ?? '');
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const cabecalho = ['Data', 'Início', 'Sessão', 'Função', 'Técnico', 'Substituto', 'Status', 'Check-in', 'Check-out', 'Duração (min)', 'Duração', 'Check-in registrado por', 'Check-out registrado por'];
    const corpo = linhasFiltradas.map(l => [
      formatData(l.data), l.hora, l.sessao, l.funcao, l.membroNome, l.substituto ? 'Sim' : 'Não', l.status,
      l.checkinEm ? formatHora(l.checkinEm) : '', l.checkoutEm ? formatHora(l.checkoutEm) : '',
      l.minutos || '', l.minutos ? formatHoras(l.minutos) : '', l.registroCheckin, l.registroCheckout,
    ]);
    const resumo = [
      [],
      ['Resumo por técnico'],
      ['Técnico', 'Sessões', 'Presenças', 'Faltas', 'Sem check-out', 'Horas de suporte'],
      ...totaisPorMembro.map(t => [t.nome, t.sessoes, t.presencas, t.faltas, t.semCheckout, formatHoras(t.minutos)]),
    ];
    const csv = [cabecalho, ...corpo, ...resumo].map(linha => linha.map(esc).join(';')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `presenca_${dataInicio || 'inicio'}_a_${dataFim || 'hoje'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const statusBadge = (status: Linha['status']) => {
    if (status === 'Presente') return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300';
    if (status === 'Falta') return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
    return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
  };

  return (
    <AdminLayout>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h2 className="text-3xl font-bold text-gray-800 dark:text-gray-100">Relatório de Presença</h2>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Horários de check-in e check-out dos técnicos por período.</p>
        </div>
        <button
          onClick={exportarCSV}
          disabled={loading}
          className="flex items-center px-4 py-2.5 bg-green-600 text-white font-medium rounded-xl hover:bg-green-700 shadow-sm transition-colors disabled:opacity-50"
        >
          <Download className="w-5 h-5 mr-2" />
          Exportar CSV
        </button>
      </div>

      {/* Filtros */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 mb-6 flex flex-col md:flex-row flex-wrap gap-4 items-end">
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs font-bold text-gray-700 dark:text-gray-200 uppercase mb-1">Data Início</label>
          <CustomDatePicker
            selected={dataInicio ? new Date(dataInicio + 'T12:00:00') : null}
            onChange={(d: Date | null) => setDataInicio(d ? getLocalDateStr(d) : '')}
            placeholderText="Data de Início"
          />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs font-bold text-gray-700 dark:text-gray-200 uppercase mb-1">Data Fim</label>
          <CustomDatePicker
            selected={dataFim ? new Date(dataFim + 'T12:00:00') : null}
            onChange={(d: Date | null) => setDataFim(d ? getLocalDateStr(d) : '')}
            placeholderText="Data Final"
          />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs font-bold text-gray-700 dark:text-gray-200 uppercase mb-1">Sessão</label>
          <select
            value={filterSessao}
            onChange={(e) => setFilterSessao(e.target.value)}
            className="w-full bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-50 text-sm rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 block p-2.5"
          >
            <option value="">Todas as Sessões</option>
            {SESSOES_DISPONIVEIS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-bold text-gray-700 dark:text-gray-200 uppercase mb-1">Técnico</label>
          <select
            value={filterMembro}
            onChange={(e) => setFilterMembro(e.target.value)}
            className="w-full bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-50 text-sm rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 block p-2.5"
          >
            <option value="">Todos</option>
            {membros.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200 cursor-pointer pb-2.5">
          <input
            type="checkbox"
            checked={apenasPresencas}
            onChange={e => setApenasPresencas(e.target.checked)}
            className="rounded w-4 h-4 border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          Apenas presenças
        </label>
      </div>

      {/* Totais */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="p-5 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl shadow-sm">
          <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Sessões no período</div>
          <div className="mt-1 text-3xl font-black text-gray-800 dark:text-gray-100">{loading ? '...' : linhasFiltradas.length}</div>
        </div>
        <div className="p-5 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl shadow-sm">
          <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Presenças</div>
          <div className="mt-1 text-3xl font-black text-green-600">{loading ? '...' : totalPresencas}</div>
        </div>
        <div className="p-5 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl shadow-sm">
          <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Horas de suporte</div>
          <div className="mt-1 text-3xl font-black text-blue-600">{loading ? '...' : formatHoras(totalMinutos)}</div>
        </div>
      </div>

      {/* Resumo por técnico */}
      {!loading && totaisPorMembro.length > 0 && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">Resumo por técnico</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[600px]">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 uppercase">
                  <th className="px-6 py-3 font-medium">Técnico</th>
                  <th className="px-6 py-3 font-medium text-center">Sessões</th>
                  <th className="px-6 py-3 font-medium text-center">Presenças</th>
                  <th className="px-6 py-3 font-medium text-center">Faltas</th>
                  <th className="px-6 py-3 font-medium text-center">Sem check-out</th>
                  <th className="px-6 py-3 font-medium text-right">Horas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {totaisPorMembro.map(t => (
                  <tr key={t.nome} className="text-sm text-gray-700 dark:text-gray-200">
                    <td className="px-6 py-3 font-bold text-gray-800 dark:text-gray-100">{t.nome}</td>
                    <td className="px-6 py-3 text-center">{t.sessoes}</td>
                    <td className="px-6 py-3 text-center text-green-700 dark:text-green-400 font-bold">{t.presencas}</td>
                    <td className="px-6 py-3 text-center text-red-600 dark:text-red-400 font-bold">{t.faltas}</td>
                    <td className="px-6 py-3 text-center text-amber-600 dark:text-amber-400 font-bold">{t.semCheckout}</td>
                    <td className="px-6 py-3 text-right font-bold">{formatHoras(t.minutos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detalhamento */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex justify-between items-center">
          <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center">
            <ClipboardList className="w-5 h-5 mr-2 text-blue-500" />
            Detalhamento
          </h3>
          <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
            {linhasFiltradas.length} registro(s)
          </span>
        </div>

        {loading ? (
          <div className="p-12 text-center text-gray-500 dark:text-gray-400 flex flex-col items-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-4"></div>
            Carregando relatório...
          </div>
        ) : linhasFiltradas.length === 0 ? (
          <div className="p-12 text-center text-gray-500 dark:text-gray-400">
            Nenhuma sessão encontrada no período.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[900px]">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 uppercase">
                  <th className="px-6 py-3 font-medium">Data / Sessão</th>
                  <th className="px-6 py-3 font-medium">Técnico</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Check-in</th>
                  <th className="px-6 py-3 font-medium">Check-out</th>
                  <th className="px-6 py-3 font-medium">Duração</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {linhasFiltradas.map(l => (
                  <tr key={l.id} className="hover:bg-blue-50/30 dark:hover:bg-gray-700/30 transition-colors">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2 font-medium text-gray-800 dark:text-gray-100">
                        <Calendar className="w-4 h-4 text-gray-400" />
                        {formatData(l.data)}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{l.sessao}{l.hora && ` · ${l.hora}`}</div>
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-gray-400" />
                        <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{l.membroNome}</span>
                      </div>
                      {l.substituto && <div className="text-[10px] text-blue-600 font-medium mt-0.5 ml-6">Substituto</div>}
                    </td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-bold ${statusBadge(l.status)}`}>{l.status}</span>
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-700 dark:text-gray-200">
                      {l.checkinEm ? (
                        <>
                          <div className="font-bold">{formatHora(l.checkinEm)}</div>
                          <div className="text-[10px] text-gray-400">{l.registroCheckin}</div>
                        </>
                      ) : '—'}
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-700 dark:text-gray-200">
                      {l.checkoutEm ? (
                        <>
                          <div className="font-bold">{formatHora(l.checkoutEm)}</div>
                          <div className="text-[10px] text-gray-400">{l.registroCheckout}</div>
                        </>
                      ) : l.status === 'Presente' ? (
                        <span className="text-xs font-bold text-amber-600 dark:text-amber-400">Sem check-out</span>
                      ) : '—'}
                    </td>
                    <td className="px-6 py-3 text-sm font-bold text-gray-700 dark:text-gray-200">
                      {l.minutos ? (
                        <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-gray-400" />{formatDuracao(l.checkinEm, l.checkoutEm)}</span>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
};

export default AttendanceReport;
