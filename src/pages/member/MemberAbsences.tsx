import toast from 'react-hot-toast';
import React, { useState, useEffect } from 'react';
import MemberLayout from '../../layouts/MemberLayout';
import { supabase } from '../../services/supabaseClient';
import { getAusencias, saveAusenciaPeriodo, deleteAusencias, agruparPeriodos, PeriodoAusencia as Periodo } from '../../services/ausenciasService';
import { CalendarOff, Plus, Trash2, Loader2, AlertCircle, X } from 'lucide-react';
import CustomDatePicker from '../../components/CustomDatePicker';
import { getLocalDateStr } from '../../utils/date';

const MAX_DIAS_PERIODO = 90;

const MemberAbsences = () => {
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  // Form states
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);

  // Modal states
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [absenceToDelete, setAbsenceToDelete] = useState<Periodo | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const hoje = getLocalDateStr();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      setUserId(user.id);

      const todasAusencias = await getAusencias();
      setPeriodos(agruparPeriodos(todasAusencias.filter(a => a.membroId === user.id)));
    } catch (error) {
      console.error('Erro ao carregar ausências:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !motivo.trim()) return;
    if (!dataInicio || !dataFim) {
      toast.error('Informe a data de início e a data final.');
      return;
    }
    if (dataFim < dataInicio) {
      toast.error('A data final não pode ser anterior à data de início.');
      return;
    }
    const totalDias = Math.round((new Date(dataFim + 'T12:00:00').getTime() - new Date(dataInicio + 'T12:00:00').getTime()) / 86400000) + 1;
    if (totalDias > MAX_DIAS_PERIODO) {
      toast.error(`O período pode ter no máximo ${MAX_DIAS_PERIODO} dias.`);
      return;
    }

    try {
      setSaving(true);
      const gravados = await saveAusenciaPeriodo(userId, dataInicio, dataFim, motivo.trim());
      if (gravados === 0) toast('Todos os dias do período já estavam registrados.', { icon: 'ℹ️' });
      else if (gravados < totalDias) toast.success(`Ausência registrada (${gravados} de ${totalDias} dias; os demais já existiam).`);
      else toast.success('Ausência registrada.');

      // Reset form and reload
      setDataInicio('');
      setDataFim('');
      setMotivo('');
      setIsFormOpen(false);
      await loadData();
    } catch (error) {
      console.error('Erro ao salvar ausência:', error);
      toast.error('Não foi possível salvar a ausência. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (periodo: Periodo) => {
    setAbsenceToDelete(periodo);
    setIsDeleteModalOpen(true);
  };

  const executeDelete = async () => {
    if (!absenceToDelete) return;

    try {
      setIsDeleting(true);
      // Dias já passados ficam registrados; cancela de hoje em diante
      await deleteAusencias(absenceToDelete.dias.filter(d => d.dataEspecifica >= hoje).map(d => d.id));
      await loadData();
    } catch (error) {
      console.error('Erro ao excluir ausência:', error);
      toast.error('Não foi possível cancelar a ausência.');
    } finally {
      setIsDeleting(false);
      setIsDeleteModalOpen(false);
      setAbsenceToDelete(null);
    }
  };

  const formatDate = (dateString: string) => {
    const [year, month, day] = dateString.split('-');
    return `${day}/${month}/${year}`;
  };

  const isPast = (dateString: string) => dateString < hoje;

  return (
    <MemberLayout activeTab="ausencias">
      <div className="bg-blue-600 px-6 py-8 text-white rounded-b-3xl shadow-md">
        <h1 className="text-2xl font-black mb-1 flex items-center gap-2">
          <CalendarOff className="w-6 h-6" />
          Ausências
        </h1>
        <p className="text-blue-100 text-sm">
          Informe dias ou períodos em que não poderá participar das escalas
        </p>
      </div>

      <div className="p-4 -mt-4 relative z-10">
        {!isFormOpen && (
          <button
            onClick={() => setIsFormOpen(true)}
            className="w-full bg-white dark:bg-gray-800 text-blue-600 font-bold py-4 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700 flex items-center justify-center gap-2 mb-6 hover:bg-blue-50 active:scale-[0.98] transition-all"
          >
            <Plus className="w-5 h-5" />
            Registrar Nova Ausência
          </button>
        )}

        {isFormOpen && (
          <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 p-5 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700 mb-6">
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">Nova Ausência</h2>
            
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">Data início</label>
                <CustomDatePicker
                  selected={dataInicio ? new Date(dataInicio + 'T12:00:00') : null}
                  onChange={(d: Date | null) => {
                    const novo = d ? getLocalDateStr(d) : '';
                    setDataInicio(novo);
                    // Um dia só por padrão; ajusta o fim se ficar antes do início
                    if (novo && (!dataFim || dataFim < novo)) setDataFim(novo);
                  }}
                  minDate={new Date()}
                  placeholderText="DD/MM/AAAA"
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">Data final</label>
                <CustomDatePicker
                  selected={dataFim ? new Date(dataFim + 'T12:00:00') : null}
                  onChange={(d: Date | null) => setDataFim(d ? getLocalDateStr(d) : '')}
                  minDate={dataInicio ? new Date(dataInicio + 'T12:00:00') : new Date()}
                  placeholderText="DD/MM/AAAA"
                  className="w-full"
                />
              </div>
            </div>
            
            <div className="mb-5">
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">Motivo (obrigatório)</label>
              <textarea
                required
                placeholder="Ex: Viagem de trabalho, consulta médica..."
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                className="w-full p-3 border border-gray-200 dark:border-gray-700 rounded-xl min-h-[100px] resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
            </div>
            
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="flex-1 py-3 font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-xl hover:bg-gray-200"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 py-3 font-bold text-white bg-blue-600 rounded-xl hover:bg-blue-700 flex items-center justify-center"
              >
                {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Salvar'}
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="flex justify-center items-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
        ) : periodos.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 text-center shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col items-center justify-center">
            <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-4">
              <CalendarOff className="w-8 h-8 text-blue-300" />
            </div>
            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-1">Nenhuma ausência</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Você não tem ausências programadas no momento.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <h3 className="font-bold text-gray-800 dark:text-gray-100 px-1">Suas Ausências Programadas</h3>
            {periodos.map(periodo => {
              const past = isPast(periodo.fim);
              const umDia = periodo.inicio === periodo.fim;
              return (
                <div
                  key={periodo.chave}
                  className={`bg-white dark:bg-gray-800 p-5 rounded-2xl shadow-sm border ${past ? 'border-gray-100 dark:border-gray-700 opacity-60' : 'border-blue-100'} flex flex-col gap-3 relative overflow-hidden`}
                >
                  {past && (
                    <div className="absolute top-0 left-0 w-full h-1 bg-gray-300"></div>
                  )}
                  {!past && (
                    <div className="absolute top-0 left-0 w-full h-1 bg-blue-500"></div>
                  )}
                  
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-sm text-gray-500 dark:text-gray-400 font-medium">
                        {umDia ? 'Data' : `Período · ${periodo.dias.length} dias`}
                      </div>
                      <div className="text-lg font-black text-gray-800 dark:text-gray-100">
                        {umDia ? formatDate(periodo.inicio) : `${formatDate(periodo.inicio)} a ${formatDate(periodo.fim)}`}
                      </div>
                    </div>

                    {!past && (
                      <button
                        onClick={() => confirmDelete(periodo)}
                        className="w-8 h-8 bg-red-50 text-red-500 rounded-full flex items-center justify-center hover:bg-red-100 hover:text-red-600 transition-colors"
                        title="Cancelar Ausência"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  
                  <div className="bg-gray-50 dark:bg-gray-700/50 p-3 rounded-xl border border-gray-100 dark:border-gray-700 mt-1">
                    <div className="text-xs text-gray-500 dark:text-gray-400 font-semibold mb-1 uppercase tracking-wide">Motivo</div>
                    <p className="text-sm text-gray-700 dark:text-gray-200">{periodo.motivo}</p>
                  </div>
                  
                  {past && (
                    <div className="flex items-center gap-1 text-xs font-bold text-gray-400 mt-1">
                      <AlertCircle className="w-3.5 h-3.5" />
                      Data passada
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* MODAL DE CONFIRMAÇÃO DE EXCLUSÃO */}
      {isDeleteModalOpen && absenceToDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col transform transition-all">
            <div className="flex justify-between items-center p-5 border-b border-gray-100 dark:border-gray-700 bg-red-50/50">
              <h3 className="text-lg font-bold text-red-700 flex items-center">
                <Trash2 className="w-5 h-5 mr-2" />
                Cancelar Ausência
              </h3>
              <button onClick={() => setIsDeleteModalOpen(false)} className="text-gray-400 hover:text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 dark:bg-gray-700/50 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6">
              <p className="text-gray-700 dark:text-gray-200 mb-4 text-[15px]">
                Tem certeza que deseja <span className="font-bold text-gray-900 dark:text-gray-50">cancelar esta ausência</span>?
              </p>
              <div className="bg-red-50 text-red-800 p-4 rounded-xl text-sm border border-red-100 flex items-start">
                <div className="mt-0.5 mr-3 text-red-500">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                </div>
                {absenceToDelete.inicio < hoje
                  ? 'Os dias que já passaram continuam registrados; você voltará a ficar disponível de hoje até o fim do período.'
                  : absenceToDelete.inicio === absenceToDelete.fim
                    ? 'Ao cancelar esta ausência, você voltará a ficar disponível para ser escalado nesta data.'
                    : 'Ao cancelar esta ausência, você voltará a ficar disponível para ser escalado em todo o período.'}
              </div>
            </div>

            <div className="p-5 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50/80 flex justify-end gap-3">
              <button 
                onClick={() => setIsDeleteModalOpen(false)}
                disabled={isDeleting}
                className="px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 dark:bg-gray-700/50 disabled:opacity-50 transition-colors shadow-sm"
              >
                Voltar
              </button>
              <button 
                onClick={executeDelete}
                disabled={isDeleting}
                className="px-4 py-2.5 text-sm font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 disabled:opacity-50 flex items-center transition-colors shadow-sm"
              >
                {isDeleting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white/40 border-t-white mr-2"></div>
                    Cancelando...
                  </>
                ) : 'Sim, Cancelar Ausência'}
              </button>
            </div>
          </div>
        </div>
      )}
    </MemberLayout>
  );
};

export default MemberAbsences;
