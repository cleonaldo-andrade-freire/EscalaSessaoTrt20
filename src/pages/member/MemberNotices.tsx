import React, { useState, useEffect } from 'react';
import TextoFormatado from '../../components/TextoFormatado';
import { supabase } from '../../services/supabaseClient';
import { sendWhatsApp } from '../../services/whatsappService';
import MemberLayout from '../../layouts/MemberLayout';
import { Bell, CheckCircle2, Plus, X, Send, Users, UserCheck, AlertCircle, MessageCircle, ChevronDown, ChevronUp } from 'lucide-react';

interface Aviso {
  id: string;
  titulo?: string;
  mensagem: string;
  lido: boolean;
  created_at: string;
}

interface Membro {
  id: string;
  nome: string;
}

const MemberNotices = () => {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUserId, setCurrentUserId] = useState('');
  const [expandedAvisoId, setExpandedAvisoId] = useState<string | null>(null);

  // Modal de envio (apenas admin)
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalMessage, setModalMessage] = useState('');
  const [members, setMembers] = useState<Membro[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(true);
  const [sendWhatsAppMsg, setSendWhatsAppMsg] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [toast, setToast] = useState<{show: boolean, message: string, type: 'success' | 'error'}>({show: false, message: '', type: 'success'});

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast(prev => ({ ...prev, show: false }));
    }, 5000);
  };

  useEffect(() => {
    fetchUser();
    fetchAvisos();
  }, []);

  const fetchUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      setCurrentUserId(user.id);
      const { data: membro } = await supabase
        .from('membros')
        .select('is_admin')
        .eq('id', user.id)
        .single();
      
      if (membro?.is_admin) {
        setIsAdmin(true);
      }
    }
  };

  const fetchAvisos = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data } = await supabase
        .from('avisos')
        .select('*')
        .eq('membro_id', user.id)
        .order('created_at', { ascending: false });
        
      if (data) {
        setAvisos(data);
      }
    }
    setLoading(false);
  };

  const marcarComoLido = async (id: string, lidoAtual: boolean) => {
    if (lidoAtual) return;

    // Atualiza localmente logo para resposta imediata
    setAvisos(prev => prev.map(a => a.id === id ? { ...a, lido: true } : a));

    // Atualiza no banco
    await supabase
      .from('avisos')
      .update({ lido: true })
      .eq('id', id);
  };

  const handleAvisoClick = (aviso: Aviso) => {
    if (expandedAvisoId === aviso.id) {
      setExpandedAvisoId(null);
    } else {
      setExpandedAvisoId(aviso.id);
      if (!aviso.lido) {
        marcarComoLido(aviso.id, aviso.lido);
      }
    }
  };

  const formatDate = (dateString: string) => {
    const d = new Date(dateString);
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    }).format(d);
  };

  const openModal = async () => {
    setModalTitle('');
    setModalMessage('');
    setSendWhatsAppMsg(false);
    setIsSaving(false);
    setLoadingMembers(true);
    setIsModalOpen(true);

    // Carrega a lista de membros
    const { data: membrosData } = await supabase
      .from('membros')
      .select('id, nome')
      .order('nome', { ascending: true });

    if (membrosData) {
      setMembers(membrosData);
      setSelectedMembers(membrosData.map(m => m.id));
      setSelectAll(true);
    }
    setLoadingMembers(false);
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

  const toggleMember = (id: string) => {
    setSelectedMembers(prev => {
      const newSel = prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id];
      setSelectAll(newSel.length === members.length && members.length > 0);
      return newSel;
    });
  };

  const handleSend = async () => {
    if (!modalMessage.trim()) {
      showToast('A mensagem do aviso é obrigatória.', 'error');
      return;
    }
    if (selectedMembers.length === 0) {
      showToast('Selecione pelo menos um destinatário.', 'error');
      return;
    }

    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      const inserts = selectedMembers.map(id => ({
        membro_id: id,
        titulo: modalTitle || null,
        mensagem: modalMessage,
        created_at: now,
      }));

      const { error } = await supabase.from('avisos').insert(inserts);
      if (error) throw error;

      // Send WhatsApp messages if checked
      if (sendWhatsAppMsg && selectedMembers.length > 0) {
        try {
          const waMsgText = modalTitle
            ? `*${modalTitle}*\n\n${modalMessage}`
            : modalMessage;
          const result = await sendWhatsApp(selectedMembers, waMsgText);
          console.log('WhatsApp enviado:', result);
        } catch (waErr: any) {
          console.error('Erro ao enviar WhatsApp:', waErr.message);
          // Não bloqueia o fluxo principal
        }
      }

      setIsModalOpen(false);
      // Se o admin é destinatário, recarrega os avisos para mostrar o que foi enviado
      if (selectedMembers.includes(currentUserId)) {
        fetchAvisos();
      }
      showToast(`✅ Aviso enviado para ${selectedMembers.length} membro(s)!`);
    } catch (err: any) {
      console.error(err);
      showToast('Erro ao enviar aviso: ' + (err.message || JSON.stringify(err)), 'error');
    }
    setIsSaving(false);
  };

  return (
    <MemberLayout activeTab="avisos">
      <div className="bg-blue-600 px-6 pt-12 pb-24 text-white shadow-md rounded-b-3xl relative">
        <p className="text-blue-100 text-sm font-medium">Fique por dentro</p>
        <h1 className="text-2xl font-black">Avisos e Lembretes</h1>
        {isAdmin && (
          <div className="absolute top-12 right-6">
            <span className="bg-amber-400 text-amber-900 text-[10px] font-black px-2 py-1 rounded-full uppercase tracking-wide">
              Admin
            </span>
          </div>
        )}
      </div>

      <div className="px-5 -mt-16 relative z-10 space-y-4 pb-28">
        
        {loading ? (
          <div className="space-y-4">
            {[1,2,3].map(i => (
               <div key={i} className="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 animate-pulse h-24"></div>
            ))}
          </div>
        ) : avisos.length === 0 ? (
           <div className="bg-white dark:bg-gray-800 rounded-2xl p-10 shadow-sm border border-gray-100 dark:border-gray-700 text-center flex flex-col items-center">
             <div className="w-16 h-16 bg-gray-50 dark:bg-gray-700/50 rounded-full flex items-center justify-center mb-4 text-gray-300">
               <Bell className="w-8 h-8" />
             </div>
             <p className="text-gray-500 dark:text-gray-400 font-medium">Nenhum aviso no momento.</p>
             {isAdmin && (
               <p className="text-xs text-blue-500 mt-2 font-medium">Use o botão abaixo para enviar um aviso à equipe.</p>
             )}
           </div>
        ) : (
          <div className="space-y-3">
            {avisos.map(aviso => {
              const isExpanded = expandedAvisoId === aviso.id;
              return (
              <div 
                key={aviso.id}
                onClick={() => handleAvisoClick(aviso)}
                className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                  aviso.lido 
                    ? 'bg-gray-50 dark:bg-gray-800 border-gray-100 dark:border-gray-700' 
                    : 'bg-white dark:bg-gray-800 border-blue-100 shadow-sm'
                }`}
              >
                <div className="flex gap-3">
                  <div className="shrink-0 mt-0.5">
                    {aviso.lido ? (
                      <CheckCircle2 className="w-5 h-5 text-gray-300" />
                    ) : (
                      <div className="relative">
                        <Bell className="w-5 h-5 text-blue-500" />
                        <span className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
                      </div>
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between items-start gap-2">
                      {aviso.titulo ? (
                        <h3 className={`text-base font-bold mb-1 ${aviso.lido ? 'text-gray-600 dark:text-gray-300' : 'text-gray-900 dark:text-gray-50'}`}>
                          {aviso.titulo}
                        </h3>
                      ) : (
                        <h3 className={`text-base font-bold mb-1 ${aviso.lido ? 'text-gray-600 dark:text-gray-300' : 'text-gray-900 dark:text-gray-50'}`}>
                          {isExpanded ? 'Aviso' : (aviso.mensagem.length > 40 ? aviso.mensagem.substring(0, 40) + '...' : 'Aviso')}
                        </h3>
                      )}
                      <div className="shrink-0 text-gray-400 mt-1">
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </div>
                    </div>
                    
                    {isExpanded && (
                      <p className={`text-sm whitespace-pre-wrap leading-relaxed mt-2 ${aviso.lido ? 'text-gray-500 dark:text-gray-400' : (aviso.titulo ? 'text-gray-700 dark:text-gray-200' : 'text-gray-800 dark:text-gray-100 font-medium')}`}>
                        <TextoFormatado texto={aviso.mensagem} />
                      </p>
                    )}
                    <p className="text-[10px] font-bold text-gray-400 mt-2 uppercase tracking-wide">
                      {formatDate(aviso.created_at)}
                    </p>
                  </div>
                </div>
              </div>
            )})}
          </div>
        )}
      </div>

      {/* Botão flutuante para admin */}
      {isAdmin && (
        <button
          onClick={openModal}
          className="fixed bottom-24 right-5 z-40 bg-blue-600 text-white w-14 h-14 rounded-full shadow-lg shadow-blue-500/40 flex items-center justify-center hover:bg-blue-700 active:scale-95 transition-all"
          title="Enviar novo aviso"
        >
          <Plus className="w-7 h-7" />
        </button>
      )}

      {/* Modal de envio de aviso (admin) */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-t-3xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl animate-in slide-in-from-bottom-4 duration-300">
            

            {/* Header */}
            <div className="flex justify-between items-center px-5 pt-5 pb-4 border-b border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-blue-100 rounded-xl flex items-center justify-center">
                  <Send className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900 dark:text-gray-50">Enviar Aviso</h3>
                  <p className="text-xs text-gray-400">Notifique sua equipe</p>
                </div>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Conteúdo scrollável */}
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
              
              {/* Título */}
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-1.5">
                  Título <span className="text-gray-400 font-normal">(opcional)</span>
                </label>
                <input
                  type="text"
                  value={modalTitle}
                  onChange={e => setModalTitle(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-50 transition-all"
                  placeholder="Ex: Escala do mês, Reunião de equipe..."
                />
              </div>

              {/* Mensagem */}
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-1.5">
                  Mensagem <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={4}
                  value={modalMessage}
                  onChange={e => setModalMessage(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-50 transition-all"
                  placeholder="Escreva sua mensagem para a equipe..."
                />
              </div>

              {/* Destinatários */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-bold text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-blue-500" />
                    Destinatários
                  </label>
                  <button
                    onClick={handleSelectAll}
                    className="flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-800 transition-colors"
                  >
                    <UserCheck className="w-3.5 h-3.5" />
                    {selectAll ? 'Desmarcar todos' : 'Selecionar todos'}
                  </button>
                </div>

                {loadingMembers ? (
                  <div className="bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4 flex items-center justify-center gap-2 text-sm text-gray-500">
                    <div className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full" />
                    Carregando membros...
                  </div>
                ) : (
                  <div className="bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-700 rounded-xl p-3 max-h-44 overflow-y-auto">
                    <div className="space-y-1">
                      {members.map(member => (
                        <label
                          key={member.id}
                          className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-white dark:hover:bg-gray-700 cursor-pointer transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={selectedMembers.includes(member.id)}
                            onChange={() => toggleMember(member.id)}
                            className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-gray-300"
                          />
                          <span className="text-sm text-gray-800 dark:text-gray-100 font-medium">
                            {member.nome}
                            {member.id === currentUserId && (
                              <span className="ml-1.5 text-[10px] text-blue-500 font-bold">(você)</span>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-xs text-gray-400 mt-1.5 text-right font-medium">
                  {selectedMembers.length} de {members.length} selecionado(s)
                </p>
              </div>

              {/* WhatsApp toggle */}
              <div className="flex items-start gap-3 p-3.5 bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-800/30 rounded-xl mb-4">
                <input
                  type="checkbox"
                  id="sendWhatsAppCheck"
                  checked={sendWhatsAppMsg}
                  onChange={e => setSendWhatsAppMsg(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded text-green-600 focus:ring-green-500 border-gray-300 shrink-0"
                />
                <label htmlFor="sendWhatsAppCheck" className="cursor-pointer">
                  <p className="text-sm font-bold text-green-900 dark:text-green-200 flex items-center gap-2">
                    <MessageCircle className="w-4 h-4" />
                    Enviar via WhatsApp
                  </p>
                  <p className="text-xs text-green-700 dark:text-green-300 mt-0.5">Envia o aviso direto no WhatsApp dos membros selecionados.</p>
                </label>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 pt-4 pb-8 border-t border-gray-100 dark:border-gray-700 flex gap-3 bg-white dark:bg-gray-800 shrink-0">
              <button
                onClick={() => setIsModalOpen(false)}
                className="flex-1 py-3 text-sm font-bold text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSend}
                disabled={isSaving || loadingMembers}
                className="flex-1 py-3 text-sm font-bold text-white bg-blue-600 rounded-xl hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 shadow-sm shadow-blue-500/30"
              >
                {isSaving ? (
                  <>
                    <div className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
                    Enviando...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Enviar Aviso
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Toast Notification */}
      {toast.show && (
        <div className="fixed bottom-6 right-6 z-[100] animate-in slide-in-from-bottom-5 fade-in duration-300">
          <div className={`flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-lg border ${
            toast.type === 'success' 
            ? 'bg-green-50 dark:bg-green-900/90 border-green-200 dark:border-green-800 text-green-800 dark:text-green-300' 
            : 'bg-red-50 dark:bg-red-900/90 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'
          }`}>
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
            )}
            <p className="font-bold text-sm">{toast.message}</p>
            <button 
              onClick={() => setToast(prev => ({ ...prev, show: false }))}
              className="ml-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </MemberLayout>
  );
};

export default MemberNotices;
