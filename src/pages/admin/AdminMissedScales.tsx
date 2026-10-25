import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabaseClient';
import AdminLayout from '../../layouts/AdminLayout';
import { UserX, ChevronLeft, ChevronRight, Calendar, User, Filter } from 'lucide-react';
import CustomDatePicker from '../../components/CustomDatePicker';
import { SESSOES_DISPONIVEIS } from '../../constants';

const AdminMissedScales = () => {
  const [faltas, setFaltas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Paginação
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const limit = 10;

  // Filtros
  const [filterTipoSessao, setFilterTipoSessao] = useState('');
  const [filterDataInicio, setFilterDataInicio] = useState('');
  const [filterDataFim, setFilterDataFim] = useState('');

  const handleFilterChange = (setter: React.Dispatch<React.SetStateAction<string>>, value: string) => {
    setter(value);
    setPage(1);
  };

  useEffect(() => {
    fetchFaltas();
  }, [page, filterTipoSessao, filterDataInicio, filterDataFim]);

  const fetchFaltas = async () => {
    setLoading(true);
    const hojeStr = new Date().toISOString().split('T')[0];

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase
      .from('escalas')
      .select(`
        id, data, tipo_sessao, funcao, status_substituicao,
        membro_original:membro_original_id ( id, nome, foto_url ),
        membro_substituto:membro_substituto_id ( id, nome, foto_url )
      `, { count: 'exact' })
      .eq('compareceu', false)
      .lte('data', hojeStr);

    if (filterTipoSessao) {
      query = query.eq('tipo_sessao', filterTipoSessao);
    }
    if (filterDataInicio) {
      query = query.gte('data', filterDataInicio);
    }
    if (filterDataFim) {
      query = query.lte('data', filterDataFim);
    }

    const { data, count, error } = await query
      .order('data', { ascending: false })
      .range(from, to);

    if (!error && data) {
      setFaltas(data);
      if (count !== null) setTotalCount(count);
    } else {
      setFaltas([]);
      setTotalCount(0);
    }
    setLoading(false);
  };

  const totalPages = Math.ceil(totalCount / limit) || 1;

  const handlePrevPage = () => {
    if (page > 1) setPage(page - 1);
  };

  const handleNextPage = () => {
    if (page < totalPages) setPage(page + 1);
  };

  const formatData = (dataStr: string) => {
    const dataObj = new Date(dataStr + 'T12:00:00');
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(dataObj);
  };

  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-gray-800 dark:text-gray-100">Relatório de Faltas</h2>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Escalas passadas (ou do dia atual) onde não houve check-in.</p>
      </div>

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex justify-between items-center">
          <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center">
            <UserX className="w-5 h-5 mr-2 text-red-500" />
            Check-ins Pendentes ou Faltas
          </h3>
          <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
            Total: <span className="text-gray-900 dark:text-gray-50 font-bold">{totalCount}</span> registros
          </span>
        </div>

        {/* Filtros */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1 md:max-w-xs">
            <label className="block text-xs font-bold text-gray-700 dark:text-gray-200 uppercase mb-1">Data Início</label>
            <CustomDatePicker 
              selected={filterDataInicio ? new Date(filterDataInicio + 'T12:00:00') : null}
              onChange={(d: Date | null) => handleFilterChange(setFilterDataInicio, d ? d.toISOString().split('T')[0] : '')}
              placeholderText="Data de Início"
            />
          </div>
          <div className="flex-1 md:max-w-xs">
            <label className="block text-xs font-bold text-gray-700 dark:text-gray-200 uppercase mb-1">Data Fim</label>
            <CustomDatePicker 
              selected={filterDataFim ? new Date(filterDataFim + 'T12:00:00') : null}
              onChange={(d: Date | null) => handleFilterChange(setFilterDataFim, d ? d.toISOString().split('T')[0] : '')}
              placeholderText="Data Final"
            />
          </div>
          <div className="flex-1 md:max-w-xs">
            <label className="block text-xs font-bold text-gray-700 dark:text-gray-200 uppercase mb-1">Filtrar por Sessão</label>
            <select 
              value={filterTipoSessao}
              onChange={(e) => handleFilterChange(setFilterTipoSessao, e.target.value)}
              className="w-full bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-50 text-sm rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 block p-2.5 transition-all"
            >
              <option value="">Todas as Sessões</option>
              {SESSOES_DISPONIVEIS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {(filterDataInicio || filterDataFim || filterTipoSessao) && (
            <button 
              onClick={() => {
                handleFilterChange(setFilterDataInicio, '');
                handleFilterChange(setFilterDataFim, '');
                handleFilterChange(setFilterTipoSessao, '');
              }}
              className="text-sm text-red-600 hover:text-red-700 font-medium px-4 py-2.5 mb-0.5"
            >
              Limpar Filtros
            </button>
          )}
        </div>

        <div className="p-0">
          {loading ? (
             <div className="p-12 text-center text-gray-500 dark:text-gray-400 flex flex-col items-center">
               <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600 mb-4"></div>
               Carregando relatório...
             </div>
          ) : faltas.length === 0 ? (
             <div className="p-12 text-center text-gray-500 dark:text-gray-400">
               Nenhuma falta encontrada! Todos os check-ins estão em dia.
             </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[600px]">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 uppercase bg-white dark:bg-gray-800">
                    <th className="px-6 py-3 font-medium">Data / Sessão</th>
                    <th className="px-6 py-3 font-medium">Membro Escalado</th>
                    <th className="px-6 py-3 font-medium">Função</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {faltas.map((escala) => {
                    const isSubstituido = escala.status_substituicao === 'Substituição Aceita';
                    const membro = isSubstituido ? escala.membro_substituto : escala.membro_original;

                    return (
                      <tr key={escala.id} className="hover:bg-red-50/30 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2 font-medium text-gray-800 dark:text-gray-100">
                            <Calendar className="w-4 h-4 text-gray-400" />
                            {formatData(escala.data)}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{escala.tipo_sessao}</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center font-bold text-red-700 overflow-hidden shadow-sm border border-red-200">
                               {membro?.foto_url ? <img src={membro.foto_url} alt="Avatar" className="w-full h-full object-cover" /> : <User className="w-4 h-4" />}
                            </div>
                            <div>
                              <p className="text-sm font-bold text-gray-800 dark:text-gray-100">{membro?.nome || 'Sem membro'}</p>
                              {isSubstituido && (
                                <p className="text-[10px] text-blue-600 font-medium">Substituto</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-200 font-medium">
                          {escala.funcao}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Paginação */}
        {!loading && totalPages > 1 && (
          <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex items-center justify-between">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Página <span className="font-bold text-gray-900 dark:text-gray-50">{page}</span> de <span className="font-bold text-gray-900 dark:text-gray-50">{totalPages}</span>
            </span>
            <div className="flex gap-2">
              <button
                onClick={handlePrevPage}
                disabled={page === 1}
                className="p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 dark:bg-gray-700/50 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={handleNextPage}
                disabled={page === totalPages}
                className="p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 dark:bg-gray-700/50 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
};

export default AdminMissedScales;
