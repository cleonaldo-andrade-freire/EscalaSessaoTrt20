import toast from 'react-hot-toast';
import React, { useState, useEffect } from 'react';
import AdminLayout from '../../layouts/AdminLayout';
import { supabase } from '../../services/supabaseClient';
import { registrarCheckin } from '../../services/presencaService';
import { Search, Loader2, CalendarSearch, ChevronLeft, ChevronRight, RotateCcw, AlertCircle, UserCheck, CheckCircle2, Trash2, ArrowLeftRight } from 'lucide-react';

interface EscalaPermuta {
  id: string;
  data: string;
  tipo_sessao: string;
  funcao: string;
  membro_original_id: string;
  membro_substituto_id: string | null;
  status_substituicao: string;
  justificativa_troca: string | null;
  compareceu: boolean;
  membro_original: { nome: string; foto_url?: string } | null;
  membro_substituto: { nome: string; foto_url?: string } | null;
}

interface MembroSimples {
  id: string;
  nome: string;
  foto_url?: string;
}

const ManageSwaps = () => {
  const [permutas, setPermutas] = useState<EscalaPermuta[]>([]);
  const [membros, setMembros] = useState<MembroSimples[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('Todos');
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Undo Modal State
  const [escalaToUndo, setEscalaToUndo] = useState<EscalaPermuta | null>(null);
  const [isUndoModalOpen, setIsUndoModalOpen] = useState(false);
  const [undoing, setUndoing] = useState(false);

  // Register Swap Modal State
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [escalaToRegister, setEscalaToRegister] = useState<EscalaPermuta | null>(null);
  const [selectedSubstitutoId, setSelectedSubstitutoId] = useState('');
  const [memberSearchTerm, setMemberSearchTerm] = useState('');
  const [registering, setRegistering] = useState(false);
  
  // Check-in Modal State
  const [escalaToCheckIn, setEscalaToCheckIn] = useState<EscalaPermuta | null>(null);
  const [isCheckInModalOpen, setIsCheckInModalOpen] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);

  // Delete Swap Request Modal State
  const [escalaToDelete, setEscalaToDelete] = useState<EscalaPermuta | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [permutasRes, membrosRes] = await Promise.all([
        supabase
          .from('escalas')
          .select(`
            *,
            membro_original:membros!membro_original_id(nome, foto_url),
            membro_substituto:membros!membro_substituto_id(nome, foto_url)
          `)
          .neq('status_substituicao', 'Nenhum')
          .order('data', { ascending: false }),
        supabase
          .from('membros')
          .select('id, nome, foto_url')
          .order('nome', { ascending: true }),
      ]);

      if (permutasRes.error) {
        console.error('Erro ao carregar permutas:', permutasRes.error);
      } else {
        setPermutas(permutasRes.data || []);
      }

      if (membrosRes.error) {
        console.error('Erro ao carregar membros:', membrosRes.error);
      } else {
        setMembros(membrosRes.data || []);
      }
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '';
    const [year, month, day] = dateString.split('-');
    return `${day}/${month}/${year}`;
  };

  // Filter logic
  const filteredPermutas = permutas.filter((p) => {
    const searchLower = searchTerm.toLowerCase();
    const nomeOriginal = p.membro_original?.nome?.toLowerCase() || '';
    const nomeSubstituto = p.membro_substituto?.nome?.toLowerCase() || '';
    const dateStr = formatDate(p.data);
    const funcaoStr = p.funcao?.toLowerCase() || '';
    
    const matchesSearch = 
      nomeOriginal.includes(searchLower) ||
      nomeSubstituto.includes(searchLower) ||
      dateStr.includes(searchTerm) ||
      funcaoStr.includes(searchLower);

    const matchesStatus = statusFilter === 'Todos' || p.status_substituicao === statusFilter;

    return matchesSearch && matchesStatus;
  });

  // Pagination logic
  const totalPages = Math.ceil(filteredPermutas.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentItems = filteredPermutas.slice(startIndex, startIndex + itemsPerPage);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter]);

  const handlePrevPage = () => setCurrentPage((prev) => Math.max(prev - 1, 1));
  const handleNextPage = () => setCurrentPage((prev) => Math.min(prev + 1, totalPages));

  // --- Undo handlers ---
  const openUndoModal = (permuta: EscalaPermuta) => {
    setEscalaToUndo(permuta);
    setIsUndoModalOpen(true);
  };

  const confirmUndoSwap = async () => {
    if (!escalaToUndo) return;
    setUndoing(true);
    try {
      const { error } = await supabase
        .from('escalas')
        .update({
          membro_substituto_id: null,
          status_substituicao: 'Disponível para Troca'
        })
        .eq('id', escalaToUndo.id);

      if (error) throw error;
      
      loadData();
      setIsUndoModalOpen(false);
      setEscalaToUndo(null);
    } catch (error) {
      console.error('Erro ao desfazer permuta:', error);
      toast.error('Erro ao desfazer permuta. Tente novamente.');
    } finally {
      setUndoing(false);
    }
  };

  // --- Check-in handlers ---
  const openCheckInModal = (permuta: EscalaPermuta) => {
    setEscalaToCheckIn(permuta);
    setIsCheckInModalOpen(true);
  };

  // --- Delete Swap Request handlers ---
  const openDeleteModal = (permuta: EscalaPermuta) => {
    setEscalaToDelete(permuta);
    setIsDeleteModalOpen(true);
  };

  const confirmDeleteSwap = async () => {
    if (!escalaToDelete) return;
    setDeleting(true);
    try {
      const { error } = await supabase
        .from('escalas')
        .update({
          status_substituicao: 'Nenhum',
          justificativa_troca: null,
        })
        .eq('id', escalaToDelete.id);

      if (error) throw error;

      loadData();
      setIsDeleteModalOpen(false);
      setEscalaToDelete(null);
    } catch (error) {
      console.error('Erro ao excluir solicitação de permuta:', error);
      toast.error('Erro ao excluir solicitação. Tente novamente.');
    } finally {
      setDeleting(false);
    }
  };

  const confirmManualCheckIn = async () => {
    if (!escalaToCheckIn) return;
    setCheckingIn(true);
    try {
      // Check-in pelo admin com o horário atual (servidor)
      await registrarCheckin(escalaToCheckIn.id);

      loadData();
      setIsCheckInModalOpen(false);
      setEscalaToCheckIn(null);
    } catch (error: any) {
      console.error('Erro ao realizar check-in:', error);
      toast.error(error?.message || 'Erro ao realizar check-in. Tente novamente.');
    } finally {
      setCheckingIn(false);
    }
  };

  // --- Register Swap handlers ---
  const openRegisterModal = (permuta: EscalaPermuta) => {
    setEscalaToRegister(permuta);
    setSelectedSubstitutoId('');
    setMemberSearchTerm('');
    setIsRegisterModalOpen(true);
  };

  const closeRegisterModal = () => {
    if (registering) return;
    setIsRegisterModalOpen(false);
    setEscalaToRegister(null);
    setSelectedSubstitutoId('');
    setMemberSearchTerm('');
  };

  const confirmRegisterSwap = async () => {
    if (!escalaToRegister || !selectedSubstitutoId) return;
    setRegistering(true);
    try {
      const { error } = await supabase
        .from('escalas')
        .update({
          membro_substituto_id: selectedSubstitutoId,
          status_substituicao: 'Substituição Aceita',
        })
        .eq('id', escalaToRegister.id);

      if (error) throw error;

      loadData();
      closeRegisterModal();
    } catch (error) {
      console.error('Erro ao registrar permuta:', error);
      toast.error('Erro ao registrar permuta. Tente novamente.');
    } finally {
      setRegistering(false);
    }
  };

  // Filtered member list for the modal (exclude the original member)
  const filteredMembros = membros.filter((m) => {
    const excludeOriginal = m.id !== escalaToRegister?.membro_original_id;
    const matchesSearch = m.nome.toLowerCase().includes(memberSearchTerm.toLowerCase());
    return excludeOriginal && matchesSearch;
  });

  const selectedMembro = membros.find((m) => m.id === selectedSubstitutoId);

  return (
    <AdminLayout>
      <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-800 dark:text-gray-100 flex items-center gap-3">
            <div className="bg-blue-100 p-2 rounded-xl text-blue-600">
              <CalendarSearch className="w-8 h-8" />
            </div>
            Gerenciar Permutas
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2 text-lg">
            Acompanhe o histórico de trocas e substituições de escalas.
          </p>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col min-h-[600px]">
        {/* Toolbar */}
        <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex flex-col md:flex-row justify-between gap-4 items-center bg-gray-50 dark:bg-gray-700/50">
          <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto flex-1">
            <div className="relative w-full max-w-md">
              <Search className="w-5 h-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Buscar por nome, data ou função..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-14 pr-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all shadow-sm"
              />
            </div>
            
            <div className="w-full sm:w-64">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full px-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all shadow-sm font-medium text-gray-700 dark:text-gray-200"
              >
                <option value="Todos">Todos os Status</option>
                <option value="Disponível para Troca">Disponível para Troca</option>
                <option value="Substituição Aceita">Substituição Aceita</option>
              </select>
            </div>
          </div>
          
          <div className="text-sm font-semibold text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm shrink-0">
            Total: {filteredPermutas.length} registro(s)
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 text-blue-500">
            <Loader2 className="w-10 h-10 animate-spin mb-4" />
            <p className="text-sm font-semibold text-gray-500 dark:text-gray-400 animate-pulse">Carregando registros...</p>
          </div>
        ) : filteredPermutas.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-24 px-4 text-center">
            <div className="w-20 h-20 bg-gray-50 dark:bg-gray-700/50 rounded-full flex items-center justify-center mb-6">
              <CalendarSearch className="w-10 h-10 text-gray-300" />
            </div>
            <h3 className="text-xl font-bold text-gray-700 dark:text-gray-200 mb-2">Nenhum registro encontrado</h3>
            <p className="text-gray-500 dark:text-gray-400 max-w-md">
              {searchTerm || statusFilter !== 'Todos' 
                ? 'Sua busca não retornou nenhum resultado. Tente outros filtros.' 
                : 'Não há histórico de permutas no momento.'}
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                  <th className="p-4 pl-6 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Data / Sessão</th>
                  <th className="p-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Membro Original</th>
                  <th className="p-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Substituto</th>
                  <th className="p-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Função</th>
                  <th className="p-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                  <th className="p-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-center">Check-in</th>
                  <th className="p-4 pr-6 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {currentItems.map((permuta) => {
                  const statusColors: Record<string, string> = {
                    'Disponível para Troca': 'bg-yellow-100 text-yellow-800',
                    'Substituição Aceita': 'bg-green-100 text-green-800',
                    'Troca Rejeitada': 'bg-red-100 text-red-800',
                  };
                  
                  const sColor = statusColors[permuta.status_substituicao] || 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100';

                  return (
                    <tr key={permuta.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 dark:bg-gray-700/50 transition-colors">
                      <td className="p-4 pl-6">
                        <div className="font-bold text-gray-800 dark:text-gray-100">{formatDate(permuta.data)}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{permuta.tipo_sessao}</div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                           <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold overflow-hidden border border-blue-200 shrink-0">
                            {permuta.membro_original?.foto_url ? (
                              <img src={permuta.membro_original.foto_url} alt="Foto" className="w-full h-full object-cover" />
                            ) : (
                              permuta.membro_original?.nome?.charAt(0).toUpperCase() || '?'
                            )}
                          </div>
                          <span className="font-semibold text-gray-700 dark:text-gray-200 text-sm">{permuta.membro_original?.nome || 'Desconhecido'}</span>
                        </div>
                      </td>
                      <td className="p-4">
                         {permuta.membro_substituto ? (
                           <div className="flex items-center gap-2">
                             <div className="w-8 h-8 rounded-full bg-green-100 text-green-600 flex items-center justify-center font-bold overflow-hidden border border-green-200 shrink-0">
                              {permuta.membro_substituto.foto_url ? (
                                <img src={permuta.membro_substituto.foto_url} alt="Foto" className="w-full h-full object-cover" />
                              ) : (
                                permuta.membro_substituto.nome.charAt(0).toUpperCase()
                              )}
                            </div>
                            <span className="font-semibold text-gray-700 dark:text-gray-200 text-sm">{permuta.membro_substituto.nome}</span>
                           </div>
                         ) : (
                           <span className="text-sm text-gray-400 italic">Aguardando...</span>
                         )}
                      </td>
                      <td className="p-4">
                         <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{permuta.funcao}</span>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-col gap-1 items-start">
                          <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-md ${sColor}`}>
                             {permuta.status_substituicao}
                          </span>
                          {(permuta.justificativa_troca?.toLowerCase().includes('mão dupla') || permuta.justificativa_troca?.toLowerCase().includes('mao dupla')) && (
                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 inline-flex items-center gap-1">
                              <ArrowLeftRight className="w-2.5 h-2.5" /> Mão Dupla
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-4 text-center">
                        {permuta.compareceu ? (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded-md">
                            <CheckCircle2 className="w-3 h-3" /> Feito
                          </span>
                        ) : (
                          <span className="text-xs font-medium text-gray-400">Pendente</span>
                        )}
                      </td>
                      <td className="p-4 pr-6 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {!permuta.compareceu && (
                            <button
                              onClick={() => openCheckInModal(permuta)}
                              className="p-2 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-lg transition-colors inline-flex items-center justify-center"
                              title="Realizar Check-in Manual"
                            >
                              <CheckCircle2 className="w-5 h-5" />
                            </button>
                          )}
                          {permuta.status_substituicao === 'Disponível para Troca' && (
                            <button
                              onClick={() => openRegisterModal(permuta)}
                              className="p-2 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors inline-flex items-center justify-center"
                              title="Registrar Permuta Manualmente"
                            >
                              <UserCheck className="w-5 h-5" />
                            </button>
                          )}
                          {permuta.status_substituicao === 'Disponível para Troca' && (
                            <button
                              onClick={() => openDeleteModal(permuta)}
                              className="p-2 text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors inline-flex items-center justify-center"
                              title="Excluir Solicitação de Permuta"
                            >
                              <Trash2 className="w-5 h-5" />
                            </button>
                          )}
                          {permuta.status_substituicao === 'Substituição Aceita' && (
                            <button
                              onClick={() => openUndoModal(permuta)}
                              className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors inline-flex items-center justify-center"
                              title="Desfazer Permuta"
                            >
                              <RotateCcw className="w-5 h-5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {totalPages > 1 && !loading && (
          <div className="p-4 border-t border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 flex items-center justify-between mt-auto">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Mostrando <span className="font-medium text-gray-900 dark:text-gray-50">{startIndex + 1}</span> até <span className="font-medium text-gray-900 dark:text-gray-50">{Math.min(startIndex + itemsPerPage, filteredPermutas.length)}</span> de <span className="font-medium text-gray-900 dark:text-gray-50">{filteredPermutas.length}</span> registros
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrevPage}
                disabled={currentPage === 1}
                className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50 dark:bg-gray-700/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <div className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                Página {currentPage} de {totalPages}
              </div>
              <button
                onClick={handleNextPage}
                disabled={currentPage === totalPages}
                className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50 dark:bg-gray-700/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal Desfazer Permuta */}
      {isUndoModalOpen && escalaToUndo && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-red-50/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-red-100 text-red-600 rounded-full flex items-center justify-center">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-lg text-gray-900 dark:text-gray-50">Desfazer Permuta</h3>
              </div>
              <button 
                onClick={() => !undoing && setIsUndoModalOpen(false)} 
                className="text-gray-400 hover:text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 p-2 rounded-full transition-colors"
                disabled={undoing}
              >
                ✕
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <p className="text-gray-600 dark:text-gray-300 text-sm">
                Tem certeza que deseja desfazer a permuta de <strong>{escalaToUndo.membro_original?.nome}</strong> assumida por <strong>{escalaToUndo.membro_substituto?.nome}</strong>?
              </p>
              
              <div className="bg-gray-50 dark:bg-gray-700/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700 text-sm">
                <div className="grid grid-cols-2 gap-y-3">
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase">Data / Sessão</p>
                    <p className="font-bold text-gray-800 dark:text-gray-100">{formatDate(escalaToUndo.data)}</p>
                    <p className="text-gray-500 dark:text-gray-400">{escalaToUndo.tipo_sessao}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase">Função</p>
                    <p className="font-bold text-gray-800 dark:text-gray-100">{escalaToUndo.funcao}</p>
                  </div>
                </div>
              </div>
              
              <div className="bg-red-50 p-3 rounded-xl border border-red-100 text-sm text-red-800 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <p>
                  A escala voltará para o status <strong>"Disponível para Troca"</strong>, permitindo que outro membro a assuma.
                </p>
              </div>
            </div>

            <div className="p-6 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex gap-3 justify-end">
              <button 
                onClick={() => setIsUndoModalOpen(false)} 
                className="px-4 py-2.5 font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-200 bg-gray-100 dark:bg-gray-700 rounded-xl transition-colors"
                disabled={undoing}
              >
                Cancelar
              </button>
              <button 
                onClick={confirmUndoSwap}
                disabled={undoing}
                className="px-5 py-2.5 font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl flex items-center disabled:opacity-50 shadow-sm transition-colors"
              >
                {undoing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Desfazendo...
                  </>
                ) : (
                  'Sim, Desfazer'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Registrar Permuta Manualmente */}
      {isRegisterModalOpen && escalaToRegister && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-blue-50/50 dark:bg-blue-900/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center">
                  <UserCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-gray-900 dark:text-gray-50">Registrar Permuta</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Registro manual pelo administrador</p>
                </div>
              </div>
              <button
                onClick={closeRegisterModal}
                className="text-gray-400 hover:text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 p-2 rounded-full transition-colors"
                disabled={registering}
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Escala Details */}
              <div className="bg-gray-50 dark:bg-gray-700/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700 text-sm">
                <p className="text-[10px] font-bold text-gray-400 uppercase mb-3">Detalhes da Escala</p>
                <div className="grid grid-cols-2 gap-y-3">
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase">Data / Sessão</p>
                    <p className="font-bold text-gray-800 dark:text-gray-100">{formatDate(escalaToRegister.data)}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{escalaToRegister.tipo_sessao}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase">Função</p>
                    <p className="font-bold text-gray-800 dark:text-gray-100">{escalaToRegister.funcao}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase">Membro Original</p>
                    <p className="font-bold text-gray-800 dark:text-gray-100">{escalaToRegister.membro_original?.nome || 'Desconhecido'}</p>
                  </div>
                </div>
              </div>

              {/* Member Selector */}
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-2">
                  Quem realizou a substituição?
                </label>

                {/* Search inside modal */}
                <div className="relative mb-2">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Buscar membro..."
                    value={memberSearchTerm}
                    onChange={(e) => setMemberSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-4 py-2.5 text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  />
                </div>

                {/* Member List */}
                <div className="border border-gray-200 dark:border-gray-600 rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                  {filteredMembros.length === 0 ? (
                    <div className="p-4 text-center text-sm text-gray-400">
                      Nenhum membro encontrado.
                    </div>
                  ) : (
                    filteredMembros.map((membro) => (
                      <button
                        key={membro.id}
                        onClick={() => setSelectedSubstitutoId(membro.id)}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-gray-100 dark:border-gray-700 last:border-b-0 ${
                          selectedSubstitutoId === membro.id
                            ? 'bg-blue-50 dark:bg-blue-900/30'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                        }`}
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold overflow-hidden shrink-0 border-2 transition-colors ${
                          selectedSubstitutoId === membro.id
                            ? 'border-blue-400 bg-blue-100 text-blue-700'
                            : 'border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-200'
                        }`}>
                          {membro.foto_url ? (
                            <img src={membro.foto_url} alt="Foto" className="w-full h-full object-cover" />
                          ) : (
                            membro.nome.charAt(0).toUpperCase()
                          )}
                        </div>
                        <span className={`text-sm font-semibold ${
                          selectedSubstitutoId === membro.id
                            ? 'text-blue-700 dark:text-blue-300'
                            : 'text-gray-700 dark:text-gray-200'
                        }`}>
                          {membro.nome}
                        </span>
                        {selectedSubstitutoId === membro.id && (
                          <span className="ml-auto w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          </span>
                        )}
                      </button>
                    ))
                  )}
                </div>

                {/* Selected member preview */}
                {selectedMembro && (
                  <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm">
                    <UserCheck className="w-4 h-4 text-blue-500 shrink-0" />
                    <span className="text-blue-700 dark:text-blue-300 font-medium">
                      Selecionado: <strong>{selectedMembro.nome}</strong>
                    </span>
                  </div>
                )}
              </div>

              {/* Alert */}
              <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-xl border border-amber-100 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <p>
                  Esta ação registrará a permuta manualmente, alterando o status para <strong>"Substituição Aceita"</strong> com o membro selecionado como substituto.
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex gap-3 justify-end">
              <button
                onClick={closeRegisterModal}
                className="px-4 py-2.5 font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-200 bg-gray-100 dark:bg-gray-700 rounded-xl transition-colors"
                disabled={registering}
              >
                Cancelar
              </button>
              <button
                onClick={confirmRegisterSwap}
                disabled={registering || !selectedSubstitutoId}
                className="px-5 py-2.5 font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl flex items-center disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-colors"
              >
                {registering ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Registrando...
                  </>
                ) : (
                  <>
                    <UserCheck className="w-4 h-4 mr-2" />
                    Confirmar Permuta
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Excluir Solicitação de Permuta */}
      {isDeleteModalOpen && escalaToDelete && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-red-50/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-red-100 text-red-600 rounded-full flex items-center justify-center">
                  <Trash2 className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-lg text-gray-900 dark:text-gray-50">Excluir Solicitação</h3>
              </div>
              <button 
                onClick={() => !deleting && setIsDeleteModalOpen(false)} 
                className="text-gray-400 hover:text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 p-2 rounded-full transition-colors"
                disabled={deleting}
              >
                ✕
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <p className="text-gray-600 dark:text-gray-300 text-sm">
                Tem certeza que deseja excluir a solicitação de permuta de <strong>{escalaToDelete.membro_original?.nome}</strong>?
              </p>
              
              <div className="bg-gray-50 dark:bg-gray-700/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700 text-sm">
                <div className="grid grid-cols-2 gap-y-3">
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase">Data / Sessão</p>
                    <p className="font-bold text-gray-800 dark:text-gray-100">{formatDate(escalaToDelete.data)}</p>
                    <p className="text-gray-500 dark:text-gray-400">{escalaToDelete.tipo_sessao}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase">Função</p>
                    <p className="font-bold text-gray-800 dark:text-gray-100">{escalaToDelete.funcao}</p>
                  </div>
                </div>
              </div>
              
              <div className="bg-red-50 p-3 rounded-xl border border-red-100 text-sm text-red-800 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <p>
                  A escala voltará ao status <strong>"Nenhum"</strong> e não aparecerá mais como disponível para permuta.
                </p>
              </div>
            </div>

            <div className="p-6 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex gap-3 justify-end">
              <button 
                onClick={() => setIsDeleteModalOpen(false)} 
                className="px-4 py-2.5 font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-200 bg-gray-100 dark:bg-gray-700 rounded-xl transition-colors"
                disabled={deleting}
              >
                Cancelar
              </button>
              <button 
                onClick={confirmDeleteSwap}
                disabled={deleting}
                className="px-5 py-2.5 font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl flex items-center disabled:opacity-50 shadow-sm transition-colors"
              >
                {deleting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Excluindo...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Sim, Excluir
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Realizar Check-in */}
      {isCheckInModalOpen && escalaToCheckIn && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-green-50/50 dark:bg-green-900/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-100 text-green-600 rounded-full flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-lg text-gray-900 dark:text-gray-50">Confirmar Check-in</h3>
              </div>
              <button 
                onClick={() => !checkingIn && setIsCheckInModalOpen(false)} 
                className="text-gray-400 hover:text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 p-2 rounded-full transition-colors"
                disabled={checkingIn}
              >
                ✕
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <p className="text-gray-600 dark:text-gray-300 text-sm">
                Você está prestes a realizar o check-in manual para:
              </p>
              
              <div className="bg-gray-50 dark:bg-gray-700/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700 text-sm">
                <div className="grid grid-cols-2 gap-y-3">
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase">Data / Sessão</p>
                    <p className="font-bold text-gray-800 dark:text-gray-100">{formatDate(escalaToCheckIn.data)}</p>
                    <p className="text-gray-500 dark:text-gray-400">{escalaToCheckIn.tipo_sessao}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase">Função</p>
                    <p className="font-bold text-gray-800 dark:text-gray-100">{escalaToCheckIn.funcao}</p>
                  </div>
                  <div className="col-span-2">
                     <p className="text-[10px] font-bold text-gray-400 uppercase">Membro na Escala</p>
                     <p className="font-bold text-gray-800 dark:text-gray-100">
                       {escalaToCheckIn.status_substituicao === 'Substituição Aceita' && escalaToCheckIn.membro_substituto
                         ? escalaToCheckIn.membro_substituto.nome 
                         : escalaToCheckIn.membro_original?.nome}
                     </p>
                  </div>
                </div>
              </div>
              
              <div className="bg-blue-50 p-3 rounded-xl border border-blue-100 text-sm text-blue-800 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-blue-500" />
                <p>
                  Ao confirmar, o status de presença (check-in) deste membro será registrado como realizado.
                </p>
              </div>
            </div>

            <div className="p-6 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex gap-3 justify-end">
              <button 
                onClick={() => setIsCheckInModalOpen(false)} 
                className="px-4 py-2.5 font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-200 bg-gray-100 dark:bg-gray-700 rounded-xl transition-colors"
                disabled={checkingIn}
              >
                Cancelar
              </button>
              <button 
                onClick={confirmManualCheckIn}
                disabled={checkingIn}
                className="px-5 py-2.5 font-bold text-white bg-green-600 hover:bg-green-700 rounded-xl flex items-center disabled:opacity-50 shadow-sm transition-colors"
              >
                {checkingIn ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Registrando...
                  </>
                ) : (
                  'Confirmar Check-in'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
};

export default ManageSwaps;
