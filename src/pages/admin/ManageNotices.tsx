import toast from 'react-hot-toast';
import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabaseClient';
import { sendWhatsApp } from '../../services/whatsappService';
import AdminLayout from '../../layouts/AdminLayout';
import { Bell, Plus, Edit2, Trash2, X, Search, ChevronLeft, ChevronRight, MessageCircle } from 'lucide-react';
import CustomDatePicker from '../../components/CustomDatePicker';

interface Member {
  id: string;
  nome: string;
}

interface NoticeGroup {
  titulo?: string;
  mensagem: string;
  created_at: string;
  recipientsCount: number;
  recipientIds: string[];
}

const ManageNotices = () => {
  const [notices, setNotices] = useState<NoticeGroup[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');
  const [recipientFilter, setRecipientFilter] = useState<string[]>([]);
  const [isRecipientDropdownOpen, setIsRecipientDropdownOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentTitle, setCurrentTitle] = useState('');
  const [currentMessage, setCurrentMessage] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const [sendWhatsAppMsg, setSendWhatsAppMsg] = useState(false);
  const [oldNotice, setOldNotice] = useState<NoticeGroup | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [noticeToDelete, setNoticeToDelete] = useState<NoticeGroup | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. Load all members
      const { data: membersData } = await supabase
        .from('membros')
        .select('id, nome')
        .order('nome', { ascending: true });

      if (membersData) setMembers(membersData);

      // 2. Load all notices and group them
      const { data: noticesData } = await supabase
        .from('avisos')
        .select('titulo, mensagem, created_at, membro_id')
        .order('created_at', { ascending: false });

      if (noticesData) {
        const groups: Record<string, NoticeGroup> = {};

        noticesData.forEach(notice => {
          // Use created_at, titulo and mensagem as composite key
          const key = `${notice.created_at}_${notice.titulo}_${notice.mensagem}`;
          if (!groups[key]) {
            groups[key] = {
              titulo: notice.titulo || '',
              mensagem: notice.mensagem,
              created_at: notice.created_at,
              recipientsCount: 0,
              recipientIds: []
            };
          }
          groups[key].recipientsCount += 1;
          groups[key].recipientIds.push(notice.membro_id);
        });

        // Convert back to array and sort by created_at desc
        const groupedArray = Object.values(groups).sort((a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );

        setNotices(groupedArray);
      }
    } catch (err) {
      console.error("Erro ao buscar dados:", err);
    }
    setLoading(false);
  };

  const openNewModal = () => {
    setIsEditing(false);
    setCurrentTitle('');
    setCurrentMessage('');
    setSelectAll(true);
    setSendWhatsAppMsg(false);
    setSelectedMembers(members.map(m => m.id));
    setIsModalOpen(true);
  };

  const openEditModal = (notice: NoticeGroup) => {
    setIsEditing(true);
    setOldNotice(notice);
    setCurrentTitle(notice.titulo || '');
    setCurrentMessage(notice.mensagem);
    setSelectedMembers(notice.recipientIds);
    setSelectAll(notice.recipientIds.length === members.length && members.length > 0);
    setSendWhatsAppMsg(false); // Default false when editing to avoid spam
    setIsModalOpen(true);
  };

  const handleSelectAll = () => {
    if (!selectAll) {
      setSelectedMembers(members.map(m => m.id));
      setSelectAll(true);
    } else {
      setSelectedMembers([]);
      setSelectAll(false);
    }
  };

  const toggleMemberSelection = (id: string) => {
    setSelectedMembers(prev => {
      const isSelected = prev.includes(id);
      const newSelection = isSelected ? prev.filter(m => m !== id) : [...prev, id];
      setSelectAll(newSelection.length === members.length && members.length > 0);
      return newSelection;
    });
  };

  const handleSave = async () => {
    if (!currentMessage.trim()) {
      toast.error('A mensagem do aviso é obrigatória.');
      return;
    }
    if (selectedMembers.length === 0) {
      toast.error('Selecione pelo menos um destinatário.');
      return;
    }

    setIsSaving(true);
    try {
      if (isEditing && oldNotice) {
        // Edit logic: Diff members
        const membersToAdd = selectedMembers.filter(id => !oldNotice.recipientIds.includes(id));
        const membersToRemove = oldNotice.recipientIds.filter(id => !selectedMembers.includes(id));
        const membersToKeep = selectedMembers.filter(id => oldNotice.recipientIds.includes(id));

        // 1. Remove recipients
        if (membersToRemove.length > 0) {
          const { error: delError } = await supabase
            .from('avisos')
            .delete()
            .eq('mensagem', oldNotice.mensagem)
            .eq('created_at', oldNotice.created_at)
            .in('membro_id', membersToRemove);
          if (delError) throw delError;
        }

        // 2. Add new recipients with the OLD created_at so they stay grouped
        if (membersToAdd.length > 0) {
          const inserts = membersToAdd.map(id => ({
            membro_id: id,
            titulo: currentTitle,
            mensagem: currentMessage,
            created_at: oldNotice.created_at
          }));
          const { error: insError } = await supabase.from('avisos').insert(inserts);
          if (insError) throw insError;
        }

        // 3. Update message for kept recipients (only if message or title changed)
        if (membersToKeep.length > 0 && (currentMessage !== oldNotice.mensagem || currentTitle !== oldNotice.titulo)) {
          const { error: updError } = await supabase
            .from('avisos')
            .update({ titulo: currentTitle, mensagem: currentMessage })
            .eq('mensagem', oldNotice.mensagem)
            .eq('created_at', oldNotice.created_at)
            .in('membro_id', membersToKeep);
          if (updError) throw updError;
        }

      } else {
        // Create logic
        const now = new Date().toISOString();
        const inserts = selectedMembers.map(id => ({
          membro_id: id,
          titulo: currentTitle,
          mensagem: currentMessage,
          created_at: now
        }));

        const { error: insError } = await supabase.from('avisos').insert(inserts);
        if (insError) throw insError;
      }

      // Send WhatsApp messages if checked
      if (sendWhatsAppMsg && selectedMembers.length > 0) {
        try {
          const waMsgText = currentTitle
            ? `*${currentTitle}*\n\n${currentMessage}`
            : currentMessage;
          const result = await sendWhatsApp(selectedMembers, waMsgText);
          console.log('WhatsApp enviado:', result);
        } catch (waErr: any) {
          console.error('Erro ao enviar WhatsApp:', waErr.message);
          // Não bloqueia o fluxo principal — o aviso já foi salvo
        }
      }

      setIsModalOpen(false);
      fetchData();
    } catch (err: any) {
      console.error(err);
      toast('Erro ao salvar aviso: ' + (err.message || JSON.stringify(err)));
    }
    setIsSaving(false);
  };

  const confirmDelete = (notice: NoticeGroup) => {
    setNoticeToDelete(notice);
    setIsDeleteModalOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!noticeToDelete) return;
    setIsDeleting(true);

    try {
      const { error } = await supabase
        .from('avisos')
        .delete()
        .eq('mensagem', noticeToDelete.mensagem)
        .eq('created_at', noticeToDelete.created_at);

      if (error) throw error;

      fetchData();
    } catch (err: any) {
      console.error(err);
      toast('Erro ao excluir aviso: ' + (err.message || JSON.stringify(err)));
    }

    setIsDeleting(false);
    setIsDeleteModalOpen(false);
    setNoticeToDelete(null);
  };

  const formatDate = (dateString: string) => {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }).format(new Date(dateString));
  };

  const filteredNotices = notices.filter(n => {
    const matchesText = n.mensagem.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (n.titulo && n.titulo.toLowerCase().includes(searchTerm.toLowerCase()));

    if (!matchesText) return false;

    if (recipientFilter.length > 0) {
      const hasMatch = recipientFilter.some(id => n.recipientIds.includes(id));
      if (!hasMatch) return false;
    }

    if (startDateFilter || endDateFilter) {
      const noticeDate = new Date(n.created_at);
      noticeDate.setHours(0, 0, 0, 0);

      if (startDateFilter) {
        const [sY, sM, sD] = startDateFilter.split('-').map(Number);
        const startD = new Date(sY, sM - 1, sD);
        if (noticeDate < startD) return false;
      }

      if (endDateFilter) {
        const [eY, eM, eD] = endDateFilter.split('-').map(Number);
        const endD = new Date(eY, eM - 1, eD);
        if (noticeDate > endD) return false;
      }
    }

    return true;
  });

  const totalPages = Math.ceil(filteredNotices.length / itemsPerPage);
  const currentNotices = filteredNotices.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  return (
    <AdminLayout>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h2 className="text-3xl font-bold text-gray-800 dark:text-gray-100">Quadro de Avisos</h2>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Gerencie os avisos enviados aos membros.</p>
        </div>

        <button onClick={openNewModal}
          className="flex items-center px-4 py-2.5 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 shadow-sm transition-colors">
          <Plus className="w-5 h-5 mr-2" />
          Novo Aviso
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 p-4 rounded-t-2xl border border-gray-200 dark:border-gray-700 border-b-0 flex flex-col md:flex-row items-center gap-4 shadow-sm">
        <div className="relative w-full md:flex-1">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-gray-400" />
          </div>
          <input
            type="text"
            className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg leading-5 bg-white dark:bg-gray-800 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-sm text-gray-900 dark:text-gray-100"
            placeholder="Buscar nos avisos..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
          />
        </div>

        <div className="flex w-full md:w-auto items-center gap-2">
          <div className="relative w-full md:w-auto">
            <button
              onClick={() => setIsRecipientDropdownOpen(!isRecipientDropdownOpen)}
              className="block w-full md:w-48 text-left pl-3 pr-8 py-2 border border-gray-300 rounded-lg leading-5 bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-sm text-gray-900 dark:text-gray-100 truncate relative"
            >
              {recipientFilter.length === 0 ? "Todos destinatários" : `${recipientFilter.length} selecionado(s)`}
              <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
              </div>
            </button>

            {isRecipientDropdownOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setIsRecipientDropdownOpen(false)}></div>
                <div className="absolute z-20 mt-1 w-full md:w-64 bg-white dark:bg-gray-800 shadow-xl rounded-md py-1 text-base ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm border border-gray-200 dark:border-gray-700">
                  <label className="flex items-center px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer border-b border-gray-100 dark:border-gray-700">
                    <input
                      type="checkbox"
                      checked={recipientFilter.length === 0}
                      onChange={() => {
                        setRecipientFilter([]);
                        setCurrentPage(1);
                        setIsRecipientDropdownOpen(false);
                      }}
                      className="mr-3 rounded text-blue-600 focus:ring-blue-500 h-4 w-4"
                    />
                    <span className="text-gray-900 dark:text-gray-100 font-medium">Todos</span>
                  </label>
                  {members.map(m => (
                    <label key={m.id} className="flex items-center px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={recipientFilter.includes(m.id)}
                        onChange={(e) => {
                          let newFilter;
                          if (e.target.checked) {
                            newFilter = [...recipientFilter, m.id];
                          } else {
                            newFilter = recipientFilter.filter(id => id !== m.id);
                          }
                          setRecipientFilter(newFilter);
                          setCurrentPage(1);
                        }}
                        className="mr-3 rounded text-blue-600 focus:ring-blue-500 h-4 w-4"
                      />
                      <span className="text-gray-900 dark:text-gray-100">{m.nome}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="w-full md:w-36">
            <CustomDatePicker
              selected={startDateFilter ? new Date(startDateFilter + 'T12:00:00') : null}
              onChange={(d: Date | null) => {
                setStartDateFilter(d ? d.toISOString().split('T')[0] : '');
                setCurrentPage(1);
              }}
              placeholderText="Início"
            />
          </div>
          <span className="text-gray-500 dark:text-gray-400 hidden md:inline">-</span>
          <div className="w-full md:w-36">
            <CustomDatePicker
              selected={endDateFilter ? new Date(endDateFilter + 'T12:00:00') : null}
              onChange={(d: Date | null) => {
                setEndDateFilter(d ? d.toISOString().split('T')[0] : '');
                setCurrentPage(1);
              }}
              placeholderText="Fim"
            />
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm rounded-b-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Aviso</th>
                <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Data de Envio</th>
                <th scope="col" className="px-6 py-4 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Destinatários</th>
                <th scope="col" className="px-6 py-4 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Ações</th>
              </tr>
            </thead>

            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                    <div className="flex justify-center items-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    </div>
                  </td>
                </tr>
              ) : currentNotices.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">Nenhum aviso encontrado.</td>
                </tr>
              ) : (
                currentNotices.map((notice, i) => (
                  <tr key={i} className="hover:bg-blue-50/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-start">
                        <Bell className="w-5 h-5 text-blue-500 mr-3 mt-0.5 shrink-0" />
                        <div className="flex flex-col">
                          {notice.titulo && (
                            <div className="text-sm font-bold text-gray-900 dark:text-gray-50 mb-0.5">
                              {notice.titulo}
                            </div>
                          )}
                          <div className="text-sm font-medium text-gray-700 dark:text-gray-300 max-w-md line-clamp-2">
                            {notice.mensagem}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-700 dark:text-gray-200">{formatDate(notice.created_at)}</div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      {notice.recipientsCount === members.length && members.length > 0 ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800">
                          Todos os Membros
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1 justify-center max-w-[200px] mx-auto">
                          {notice.recipientIds.map(id => {
                            const memberName = members.find(m => m.id === id)?.nome;
                            return memberName ? (
                              <span key={id} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 border border-gray-200 dark:border-gray-700">
                                {memberName}
                              </span>
                            ) : null;
                          })}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => openEditModal(notice)} className="flex items-center justify-center w-8 h-8 text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50 shadow-sm transition-all" title="Editar Aviso">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => confirmDelete(notice)} className="flex items-center justify-center w-8 h-8 text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:text-red-600 hover:border-red-300 hover:bg-red-50 shadow-sm transition-all" title="Excluir Aviso">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between bg-white dark:bg-gray-800">
            <div className="flex-1 flex justify-between sm:hidden">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="relative inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 text-sm font-medium rounded-md text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
              >
                Anterior
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 text-sm font-medium rounded-md text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
              >
                Próxima
              </button>
            </div>
            <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  Mostrando <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> a <span className="font-medium">{Math.min(currentPage * itemsPerPage, filteredNotices.length)}</span> de <span className="font-medium">{filteredNotices.length}</span> resultados
                </p>
              </div>
              <div>
                <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
                  >
                    <span className="sr-only">Anterior</span>
                    <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                    .map((p, i, arr) => (
                      <React.Fragment key={p}>
                        {i > 0 && arr[i - 1] !== p - 1 && (
                          <span className="relative inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300">
                            ...
                          </span>
                        )}
                        <button
                          onClick={() => setCurrentPage(p)}
                          className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${currentPage === p
                              ? 'z-10 bg-blue-50 border-blue-500 text-blue-600 dark:bg-blue-900/20 dark:border-blue-500 dark:text-blue-400'
                              : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-600'
                            }`}
                        >
                          {p}
                        </button>
                      </React.Fragment>
                    ))}
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
                  >
                    <span className="sr-only">Próxima</span>
                    <ChevronRight className="h-5 w-5" aria-hidden="true" />
                  </button>
                </nav>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODAL DE CRIAÇÃO/EDIÇÃO */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center p-5 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-50">{isEditing ? 'Editar Aviso' : 'Novo Aviso'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 p-1 rounded-lg border border-gray-200 dark:border-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 min-h-0 space-y-5">

              <div>
                <label className="block text-sm font-bold text-gray-800 dark:text-gray-100 mb-2">Título do Aviso (Opcional)</label>
                <input
                  type="text"
                  value={currentTitle}
                  onChange={e => setCurrentTitle(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Ex: Escala Mensal, Reunião de Equipe..."
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-800 dark:text-gray-100 mb-2">Mensagem do Aviso</label>
                <textarea
                  rows={4}
                  value={currentMessage}
                  onChange={e => setCurrentMessage(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-blue-500 focus:border-blue-500 resize-none"
                  placeholder="Escreva aqui a mensagem que será enviada aos membros..."
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-bold text-gray-800 dark:text-gray-100">Destinatários</label>
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="mr-2 rounded text-blue-600 focus:ring-blue-500 w-4 h-4"
                      checked={selectAll}
                      onChange={handleSelectAll}
                    />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Selecionar Todos</span>
                  </label>
                </div>

                <div className="bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4 max-h-60 overflow-y-auto mb-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {members.map(member => (
                      <label key={member.id} className="flex items-center p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 dark:bg-gray-700 cursor-pointer">
                        <input
                          type="checkbox"
                          className="mr-3 rounded text-blue-600 focus:ring-blue-500 w-4 h-4"
                          checked={selectedMembers.includes(member.id)}
                          onChange={() => toggleMemberSelection(member.id)}
                        />
                        <span className="text-sm text-gray-800 dark:text-gray-100">{member.nome}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex items-center p-3 bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-800/30 rounded-xl">
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="mr-3 rounded text-green-600 focus:ring-green-500 w-4 h-4"
                      checked={sendWhatsAppMsg}
                      onChange={e => setSendWhatsAppMsg(e.target.checked)}
                    />
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-green-900 dark:text-green-200 flex items-center gap-2">
                        <MessageCircle className="w-4 h-4" />
                        Enviar mensagem via WhatsApp
                      </span>
                      <span className="text-xs text-green-700 dark:text-green-300">Envia o aviso direto no WhatsApp dos membros cadastrados.</span>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            <div className="p-5 border-t border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 flex justify-end gap-3">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 dark:bg-gray-700/50 transition-colors shadow-sm"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-5 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm flex items-center"
              >
                {isSaving ? 'Salvando...' : 'Salvar Aviso'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE CONFIRMAÇÃO DE EXCLUSÃO */}
      {isDeleteModalOpen && noticeToDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col transform transition-all">
            <div className="flex justify-between items-center p-5 border-b border-gray-100 dark:border-gray-700 bg-red-50/50">
              <h3 className="text-lg font-bold text-red-700 flex items-center">
                <Trash2 className="w-5 h-5 mr-2" />
                Excluir Aviso
              </h3>
              <button onClick={() => setIsDeleteModalOpen(false)} className="text-gray-400 hover:text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 dark:bg-gray-700/50 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              <p className="text-gray-700 dark:text-gray-200 mb-4 text-[15px]">
                Tem certeza que deseja excluir este aviso?
              </p>
              <div className="bg-red-50 text-red-800 p-4 rounded-xl text-sm border border-red-100 flex items-start">
                <div className="mt-0.5 mr-3 text-red-500">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
                </div>
                Esta ação não pode ser desfeita e removerá o aviso para todos os membros que o receberam.
              </div>
            </div>

            <div className="p-5 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50/80 flex justify-end gap-3">
              <button
                onClick={() => setIsDeleteModalOpen(false)}
                disabled={isDeleting}
                className="px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 dark:bg-gray-700/50 disabled:opacity-50 transition-colors shadow-sm"
              >
                Cancelar
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
                className="px-4 py-2.5 text-sm font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 disabled:opacity-50 flex items-center transition-colors shadow-sm"
              >
                {isDeleting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white/40 border-t-white mr-2"></div>
                    Excluindo...
                  </>
                ) : 'Sim, Excluir Aviso'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
};

export default ManageNotices;
