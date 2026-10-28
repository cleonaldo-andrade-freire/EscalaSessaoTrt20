import React, { useState, useEffect } from 'react';
import AdminLayout from '../../layouts/AdminLayout';
import { getAusencias, getMembros, agruparPeriodos, PeriodoAusencia } from '../../services/ausenciasService';
import { Membro } from '../../types';
import { CalendarOff, Search, Loader2, Calendar } from 'lucide-react';

interface AusenciaComMembro extends PeriodoAusencia {
  membroNome: string;
  membroFoto: string;
}

const ManageAbsences = () => {
  const [ausencias, setAusencias] = useState<AusenciaComMembro[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [todasAusencias, membros] = await Promise.all([
        getAusencias(),
        getMembros()
      ]);

      const membrosMap = new Map(membros.map((m: Membro) => [m.id, m]));

      // Um registro por período (já ordenados do mais recente para o mais antigo)
      const ausenciasEnriquecidas: AusenciaComMembro[] = agruparPeriodos(todasAusencias).map(p => {
        const membro = membrosMap.get(p.membroId);
        return {
          ...p,
          membroNome: membro?.nome || 'Membro Desconhecido',
          membroFoto: membro?.fotoUrl || ''
        };
      });

      setAusencias(ausenciasEnriquecidas);
    } catch (error) {
      console.error('Erro ao carregar ausências:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const [year, month, day] = dateString.split('-');
    return `${day}/${month}/${year}`;
  };

  const formatPeriodo = (a: AusenciaComMembro) =>
    a.inicio === a.fim ? formatDate(a.inicio) : `${formatDate(a.inicio)} a ${formatDate(a.fim)}`;

  const filteredAusencias = ausencias.filter(a =>
    a.membroNome.toLowerCase().includes(searchTerm.toLowerCase()) ||
    a.motivo.toLowerCase().includes(searchTerm.toLowerCase()) ||
    formatPeriodo(a).includes(searchTerm) ||
    a.dias.some(d => formatDate(d.dataEspecifica).includes(searchTerm))
  );

  return (
    <AdminLayout>
      <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-800 dark:text-gray-100 flex items-center gap-3">
            <div className="bg-blue-100 dark:bg-blue-900/30 p-2 rounded-xl text-blue-600 dark:text-blue-400">
              <CalendarOff className="w-8 h-8" />
            </div>
            Ausências Programadas
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2 text-lg">
            Acompanhe os dias em que os membros não estarão disponíveis.
          </p>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Toolbar */}
        <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row justify-between gap-4 items-center bg-gray-50 dark:bg-gray-700/50 dark:bg-gray-800/50">
          <div className="relative w-full max-w-md">
            <Search className="w-5 h-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar por nome ou motivo..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-14 pr-4 py-3 bg-white dark:bg-gray-800 dark:bg-gray-700 text-gray-900 dark:text-gray-50 dark:text-gray-100 border border-gray-200 dark:border-gray-700 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all shadow-sm placeholder-gray-400 dark:placeholder-gray-500"
            />
          </div>
          <div className="text-sm font-semibold text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 dark:bg-gray-700 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 dark:border-gray-600 shadow-sm">
            Total: {filteredAusencias.length} registro(s)
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-blue-500">
            <Loader2 className="w-10 h-10 animate-spin mb-4" />
            <p className="text-sm font-semibold text-gray-500 dark:text-gray-400 animate-pulse">Carregando registros...</p>
          </div>
        ) : filteredAusencias.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
            <div className="w-20 h-20 bg-gray-50 dark:bg-gray-700/50 rounded-full flex items-center justify-center mb-6">
              <CalendarOff className="w-10 h-10 text-gray-300" />
            </div>
            <h3 className="text-xl font-bold text-gray-700 dark:text-gray-200 mb-2">Nenhum registro encontrado</h3>
            <p className="text-gray-500 dark:text-gray-400 max-w-md">
              {searchTerm ? 'Sua busca não retornou nenhum resultado. Tente outros termos.' : 'Não há ausências programadas registradas pelos membros no momento.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                  <th className="p-4 pl-6 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Membro</th>
                  <th className="p-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Data / Período</th>
                  <th className="p-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Motivo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filteredAusencias.map((ausencia) => {
                  return (
                    <tr key={ausencia.chave}className="hover:bg-gray-50 dark:hover:bg-gray-700/50 dark:bg-gray-700/50 dark:hover:bg-gray-700/50 transition-colors group">
                      <td className="p-4 pl-6">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold overflow-hidden border border-blue-200 dark:border-blue-800">
                            {ausencia.membroFoto ? (
                              <img src={ausencia.membroFoto} alt={ausencia.membroNome} className="w-full h-full object-cover" />
                            ) : (
                              ausencia.membroNome.charAt(0).toUpperCase()
                            )}
                          </div>
                          <div>
                            <div className="font-bold text-gray-800 dark:text-gray-100 dark:text-gray-200">{ausencia.membroNome}</div>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200 dark:text-gray-300">
                          <Calendar className="w-4 h-4 text-gray-400" />
                          {formatPeriodo(ausencia)}
                        </div>
                        {ausencia.dias.length > 1 && (
                          <div className="text-xs text-gray-400 mt-0.5 ml-6">{ausencia.dias.length} dias</div>
                        )}
                      </td>
                      <td className="p-4">
                        <p className="text-sm text-gray-600 dark:text-gray-300 dark:text-gray-400 max-w-xs truncate" title={ausencia.motivo}>
                          {ausencia.motivo}
                        </p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
};

export default ManageAbsences;
