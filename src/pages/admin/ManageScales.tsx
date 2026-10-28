import toast from 'react-hot-toast';
import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabaseClient';
import { sendWhatsApp } from '../../services/whatsappService';
import AdminLayout from '../../layouts/AdminLayout';
import { Calendar as CalendarIcon, Plus, User, AlertCircle, AlertTriangle, Search, Filter, Trash2, ChevronLeft, ChevronRight, CheckCircle2, Loader2, X, XCircle, RotateCcw, Send, MessageCircle, LogIn, LogOut, Clock, CalendarDays } from 'lucide-react';
import CustomDatePicker from '../../components/CustomDatePicker';
import MonthlyScaleBuilder from '../../components/MonthlyScaleBuilder';
import TextoFormatado from '../../components/TextoFormatado';
import { negrito, preencherTemplate } from '../../utils/mensagem';
import { SESSOES_DISPONIVEIS, FUNCOES_DISPONIVEIS, MENSAGEM_PADRAO_SESSAO, LEMBRETE_ANTECEDENCIA_MIN } from '../../constants';
import { registrarCheckin, registrarCheckout } from '../../services/presencaService';
import { getLocalDateStr, formatHora, formatDuracao, getHoraAtual, combinarDataHora } from '../../utils/date';

const ManageScales = () => {
  const [escalas, setEscalas] = useState<any[]>([]);
  const [membros, setMembros] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  const [formData, setFormData] = useState({
    data: '',
    tipo_sessao: '',
    hora_inicio: '',
    membrosPorFuncao: {} as Record<string, string>
  });
  
  const [editingData, setEditingData] = useState<{isEditing: boolean; dataHoraOriginal?: string}>({isEditing: false});
  const [scaleIds, setScaleIds] = useState<Record<string, string>>({});
  
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Modais de confirmação
  const [deleteConfirmation, setDeleteConfirmation] = useState<{isOpen: boolean; scaleGroup: any}>({isOpen: false, scaleGroup: null});
  const [faltaConfirmation, setFaltaConfirmation] = useState<{isOpen: boolean; escalaId: string | null; currentCompareceu: boolean | null}>({isOpen: false, escalaId: null, currentCompareceu: null});
  const [isDeleting, setIsDeleting] = useState(false);
  
  const [checkInConfirmation, setCheckInConfirmation] = useState<{isOpen: boolean; slot: any; scaleGroup: any; tipo: 'checkin' | 'checkout'}>({isOpen: false, slot: null, scaleGroup: null, tipo: 'checkin'});
  const [presencaHora, setPresencaHora] = useState('');
  const [isCheckingIn, setIsCheckingIn] = useState(false);

  // Modal e controle de aviso de ausência programada
  const [absenceConfirmation, setAbsenceConfirmation] = useState<{
    isOpen: boolean;
    conflicts: Array<{ membroNome: string; funcao: string; motivo: string; data?: string }>;
    onConfirm?: () => void;
  }>({ isOpen: false, conflicts: [] });
  const [formDateAusencias, setFormDateAusencias] = useState<Record<string, string>>({});

  const [isBuilderOpen, setIsBuilderOpen] = useState(false);

  // Filtros
  const [viewMode, setViewMode] = useState<'lista' | 'mensal'>('lista');
  const [showPast, setShowPast] = useState(false);
  const [filterData, setFilterData] = useState('');
  const [filterSessao, setFilterSessao] = useState('');
  const [filterMembro, setFilterMembro] = useState('');
  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  // Estados para Aviso/Notificação
  const [noticeConfirmation, setNoticeConfirmation] = useState<{isOpen: boolean; scaleGroup: any}>({isOpen: false, scaleGroup: null});
  const [noticeText, setNoticeText] = useState('');
  const [isSendingNotice, setIsSendingNotice] = useState(false);
  const [sendNoticeWhatsApp, setSendNoticeWhatsApp] = useState(false);

  const [sessaoMensagens, setSessaoMensagens] = useState<any[]>([]);
  const [isMessagesModalOpen, setIsMessagesModalOpen] = useState(false);
  const [messagesForm, setMessagesForm] = useState<Record<string, string>>({});
  const lastFocusedRef = React.useRef<{ sessao: string; start: number; end: number } | null>(null);

  const [toast, setToast] = useState<{show: boolean, message: string, type: 'success' | 'error'}>({show: false, message: '', type: 'success'});

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast(prev => ({ ...prev, show: false }));
    }, 4000);
  };

  const handleOpenNoticeModal = (group: any) => {
    const templateObj = sessaoMensagens.find(c => c.tipo_sessao === group.sessao);
    let text = templateObj ? templateObj.mensagem_padrao : MENSAGEM_PADRAO_SESSAO;
    
    const escaladosList = group.slots.map((slot: any) => {
      const isSub = slot.status_substituicao === 'Substituição Aceita';
      const membro = isSub ? slot.membro_substituto : slot.membro_original;
      return `${slot.funcao}: ${membro ? negrito(membro.nome) : 'Vago'}`;
    }).join('\n');

    let dataObj = new Date(group.data);
    dataObj.setUTCHours(12);
    const dateFormatted = dataObj.toLocaleDateString('pt-BR');

    text = preencherTemplate(text, { sessao: group.sessao, data: dateFormatted, horario: group.hora || '', escalados: escaladosList });
    
    setNoticeText(text);
    setSendNoticeWhatsApp(false);
    setNoticeConfirmation({ isOpen: true, scaleGroup: group });
  };

  const openMessagesModal = () => {
    const initForm: Record<string, string> = {};
    SESSOES_DISPONIVEIS.forEach(sessao => {
      const found = sessaoMensagens.find(c => c.tipo_sessao === sessao);
      initForm[sessao] = found ? found.mensagem_padrao : '';
    });
    setMessagesForm(initForm);
    setIsMessagesModalOpen(true);
  };

  const insertTag = (tag: string) => {
    if (!lastFocusedRef.current) {
      showToast('Clique em um campo de texto primeiro para inserir a tag.', 'error');
      return;
    }
    
    const { sessao, start, end } = lastFocusedRef.current;
    const currentMsg = messagesForm[sessao] || '';
    const newMsg = currentMsg.substring(0, start) + tag + currentMsg.substring(end);
    
    setMessagesForm(prev => ({ ...prev, [sessao]: newMsg }));
    
    lastFocusedRef.current.start = start + tag.length;
    lastFocusedRef.current.end = start + tag.length;
  };

  const handleSaveMessages = async () => {
    try {
      setSaving(true);
      const updates = [];
      for (const sessao of Object.keys(messagesForm)) {
        if (messagesForm[sessao]) {
           updates.push({ tipo_sessao: sessao, mensagem_padrao: messagesForm[sessao] });
        }
      }
      
      for (const update of updates) {
        const { error } = await supabase
          .from('sessao_mensagens')
          .upsert(update, { onConflict: 'tipo_sessao' });
        if (error) throw error;
      }
      
      showToast('Templates de mensagens salvos com sucesso!');
      setIsMessagesModalOpen(false);
      fetchSessaoMensagens();
    } catch (err: any) {
      showToast('Erro ao salvar templates: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const confirmSendNotice = async () => {
    if (!noticeConfirmation.scaleGroup) return;
    setIsSendingNotice(true);
    try {
      const group = noticeConfirmation.scaleGroup;
      const membroIds = group.slots
        .map((slot: any) => {
          const isSub = slot.status_substituicao === 'Substituição Aceita';
          return isSub ? slot.membro_substituto?.id : slot.membro_original?.id;
        })
        .filter(Boolean);
        
      const uniqueMembroIds = [...new Set(membroIds)] as string[];
      
      if (uniqueMembroIds.length === 0) {
        showToast("Nenhum técnico escalado nesta sessão.", 'error');
        setIsSendingNotice(false);
        return;
      }

      const avisosInserts = uniqueMembroIds.map((id: string) => ({
        membro_id: id,
        titulo: `Lembrete: ${group.sessao}`,
        mensagem: noticeText,
        created_at: new Date().toISOString(),
        lido: false,
      }));

      const { error: avisoError } = await supabase.from('avisos').insert(avisosInserts);
      if (avisoError) throw avisoError;



      if (sendNoticeWhatsApp) {
        try {
          await sendWhatsApp(uniqueMembroIds, noticeText);
        } catch (whatsErr) {
          console.error('Erro ao enviar WhatsApp:', whatsErr);
          showToast('Aviso criado, mas houve erro ao enviar WhatsApp', 'error');
        }
      }

      showToast('Aviso enviado com sucesso para os escalados!');
      setNoticeConfirmation({ isOpen: false, scaleGroup: null });
    } catch (err: any) {
      console.error('Erro ao enviar aviso:', err);
      showToast('Erro ao enviar aviso: ' + err.message, 'error');
    } finally {
      setIsSendingNotice(false);
    }
  };

  const handlePreviousMonth = () => {
    const [year, month] = currentMonth.split('-').map(Number);
    let newMonth = month - 1;
    let newYear = year;
    if (newMonth === 0) {
      newMonth = 12;
      newYear -= 1;
    }
    setCurrentMonth(`${newYear}-${String(newMonth).padStart(2, '0')}`);
  };

  const handleNextMonth = () => {
    const [year, month] = currentMonth.split('-').map(Number);
    let newMonth = month + 1;
    let newYear = year;
    if (newMonth === 13) {
      newMonth = 1;
      newYear += 1;
    }
    setCurrentMonth(`${newYear}-${String(newMonth).padStart(2, '0')}`);
  };

  useEffect(() => {
    fetchMembros();
    fetchSessaoMensagens();
  }, []);

  const fetchSessaoMensagens = async () => {
    const { data } = await supabase.from('sessao_mensagens').select('*');
    if (data) setSessaoMensagens(data);
  };

  // Carrega ausências programadas quando a data do modal de edição/criação for informada
  useEffect(() => {
    if (!isModalOpen || !formData.data) {
      setFormDateAusencias({});
      return;
    }
    let isMounted = true;
    const fetchAusenciasForDate = async () => {
      try {
        const { data, error } = await supabase
          .from('ausencias_programadas')
          .select('membro_id, motivo')
          .lte('data_inicio', formData.data)
          .gte('data_fim', formData.data);
        if (error) throw error;
        if (isMounted && data) {
          const map: Record<string, string> = {};
          data.forEach((a: any) => {
            map[a.membro_id] = a.motivo || 'Motivo não informado';
          });
          setFormDateAusencias(map);
        }
      } catch (err) {
        console.error('Erro ao carregar ausências da data selecionada:', err);
      }
    };
    fetchAusenciasForDate();
    return () => {
      isMounted = false;
    };
  }, [isModalOpen, formData.data]);

  useEffect(() => {
    fetchEscalas();
  }, [viewMode, currentMonth, filterData, filterSessao, showPast]);

  const fetchMembros = async () => {
    const { data } = await supabase
      .from('membros')
      .select('id, nome, ativo')
      .order('nome');
    if (data) setMembros(data);
  };

  const fetchEscalas = async () => {
    setLoading(true);
    
    let query = supabase
      .from('escalas')
      .select(`
        id, data, hora_inicio, tipo_sessao, funcao, status_substituicao, justificativa_troca, compareceu, checkin_em, checkout_em, lembrete_enviado_em, publicada,
        membro_original:membro_original_id ( id, nome, foto_url ),
        membro_substituto:membro_substituto_id ( id, nome, foto_url )
      `);

    if (viewMode === 'mensal') {
      const [year, month] = currentMonth.split('-');
      const firstDay = getLocalDateStr(new Date(Number(year), Number(month) - 1, 1));
      const lastDay = getLocalDateStr(new Date(Number(year), Number(month), 0));
      query = query.gte('data', firstDay).lte('data', lastDay);
    } else {
      if (filterData) {
        query = query.eq('data', filterData);
      } else if (!showPast) {
        query = query.gte('data', getLocalDateStr());
      }
      
      if (filterSessao) {
        query = query.eq('tipo_sessao', filterSessao);
      }
    }

    const { data, error } = await query
      .order('data', { ascending: true })
      .order('hora_inicio', { ascending: true })
      .order('tipo_sessao', { ascending: true });

    if (!error && data) {
      const grouped = data.reduce((acc: any, curr: any) => {
        const key = `${curr.data}|${curr.tipo_sessao}`;
        if (!acc[key]) acc[key] = { data: curr.data, sessao: curr.tipo_sessao, hora: curr.hora_inicio?.slice(0, 5) || '', lembreteEnviado: !!curr.lembrete_enviado_em, rascunho: false, slots: [] };
        if (curr.publicada === false) acc[key].rascunho = true;
        acc[key].slots.push(curr);
        return acc;
      }, {});
      const result = Object.values(grouped);
      result.forEach((g: any) => {
        g.slots.sort((a: any, b: any) => {
          const aIdx = FUNCOES_DISPONIVEIS.indexOf(a.funcao);
          const bIdx = FUNCOES_DISPONIVEIS.indexOf(b.funcao);
          return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
        });
      });
      setEscalas(result);
    }
    setLoading(false);
  };

  const formatData = (dataString: string) => {
    const dataObj = new Date(dataString + 'T12:00:00');
    return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).format(dataObj);
  };

  // Cores por tipo de sessão (calendário e cartões da lista)
  const getSessaoStyles = (sessao: string) => {
    if (sessao === '1ª Turma') return { calendar: 'bg-blue-900 text-white border-blue-950 hover:bg-blue-950 dark:bg-blue-800 dark:border-blue-700', wrapper: 'hover:border-blue-400 dark:hover:border-blue-500', headerBg: 'bg-blue-50 border-blue-100 dark:bg-blue-900/20 dark:border-blue-800/30', text: 'text-blue-900 dark:text-blue-300', btnHover: 'hover:text-blue-800 hover:border-blue-300 dark:text-blue-300 dark:border-blue-800/50 dark:bg-blue-900/30 dark:hover:bg-blue-800/40' };
    if (sessao === '2ª Turma') return { calendar: 'bg-emerald-700 text-white border-emerald-800 hover:bg-emerald-800 dark:bg-emerald-800 dark:border-emerald-700', wrapper: 'hover:border-emerald-400 dark:hover:border-emerald-500', headerBg: 'bg-emerald-50 border-emerald-100 dark:bg-emerald-900/20 dark:border-emerald-800/30', text: 'text-emerald-800 dark:text-emerald-300', btnHover: 'hover:text-emerald-800 hover:border-emerald-300 dark:text-emerald-300 dark:border-emerald-800/50 dark:bg-emerald-900/30 dark:hover:bg-emerald-800/40' };
    if (sessao === 'Pleno') return { calendar: 'bg-amber-400 text-amber-950 border-amber-500 hover:bg-amber-500 dark:bg-amber-500 dark:text-amber-950', wrapper: 'hover:border-amber-400 dark:hover:border-amber-500', headerBg: 'bg-amber-50 border-amber-100 dark:bg-amber-900/20 dark:border-amber-800/30', text: 'text-amber-700 dark:text-amber-400', btnHover: 'hover:text-amber-800 hover:border-amber-300 dark:text-amber-400 dark:border-amber-800/50 dark:bg-amber-900/30 dark:hover:bg-amber-800/40' };
    return { calendar: 'bg-gray-100 text-gray-800 border-gray-200 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600', wrapper: 'hover:border-blue-200 dark:hover:border-blue-700', headerBg: 'bg-gray-50 dark:bg-gray-700/50 border-gray-100 dark:border-gray-700', text: 'text-blue-600 dark:text-blue-400', btnHover: 'hover:text-blue-700 hover:border-blue-200 dark:text-blue-400 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700' };
  };

  const handleEditSessao = (group: any) => {
    const membrosPorFuncao: Record<string, string> = {};
    const currentScaleIds: Record<string, string> = {};
    
    group.slots.forEach((slot: any) => {
      membrosPorFuncao[slot.funcao] = slot.membro_original?.id || '';
      currentScaleIds[slot.funcao] = slot.id;
    });

    setFormData({
      data: group.data,
      tipo_sessao: group.sessao,
      hora_inicio: group.hora,
      membrosPorFuncao
    });
    setScaleIds(currentScaleIds);
    setEditingData({ isEditing: true, dataHoraOriginal: `${group.data} ${group.hora}` });
    setError('');
    setIsModalOpen(true);
  };

  const handleOpenNewScale = () => {
    setFormData({ data: '', tipo_sessao: '', hora_inicio: '', membrosPorFuncao: {} });
    setScaleIds({});
    setEditingData({ isEditing: false });
    setError('');
    setIsModalOpen(true);
  };

  const handleSaveScale = async (skipAbsenceCheck: boolean = false) => {
    setError('');
    if (!formData.data || !formData.tipo_sessao || !formData.hora_inicio) {
      setError('Informe a data, a sessão e o horário de início.');
      return;
    }

    const functionsToProcess = Object.entries(formData.membrosPorFuncao)
      .filter(([_, membroId]) => membroId !== '');

    if (functionsToProcess.length === 0 && !editingData.isEditing) {
      setError('Selecione pelo menos um membro para uma função.');
      return;
    }

    // Validação: não permitir que um membro seja escalado mais de uma vez na mesma sessão
    const membrosEscalados = functionsToProcess.map(([_, membroId]) => membroId);
    const hasDuplicates = new Set(membrosEscalados).size !== membrosEscalados.length;
    if (hasDuplicates) {
      setError('Não é permitido escalar o mesmo técnico em mais de uma função na mesma sessão.');
      return;
    }

    // Verificação de ausências programadas na data informada
    if (skipAbsenceCheck !== true && membrosEscalados.length > 0) {
      setSaving(true);
      try {
        const { data: ausenciasData, error: ausenciasError } = await supabase
          .from('ausencias_programadas')
          .select('membro_id, motivo')
          .lte('data_inicio', formData.data)
          .gte('data_fim', formData.data)
          .in('membro_id', membrosEscalados);

        if (ausenciasError) throw ausenciasError;

        if (ausenciasData && ausenciasData.length > 0) {
          const conflitos = ausenciasData.map((a: any) => {
            const m = membros.find(x => x.id === a.membro_id);
            const funcoes = functionsToProcess
              .filter(([_, id]) => id === a.membro_id)
              .map(([fn]) => fn)
              .join(', ');
            return {
              membroNome: m?.nome || 'Membro',
              funcao: funcoes,
              motivo: a.motivo?.trim() ? a.motivo : 'Motivo não informado',
              data: formData.data
            };
          });

          setSaving(false);
          setAbsenceConfirmation({
            isOpen: true,
            conflicts: conflitos,
            onConfirm: () => handleSaveScale(true)
          });
          return;
        }
      } catch (err: any) {
        console.error('Erro ao checar ausências programadas:', err);
      } finally {
        setSaving(false);
      }
    }

    setSaving(true);
    try {
      if (editingData.isEditing) {
        const updates = [];
        const inserts = [];
        const funcoesPresentes = new Set();

        // Se data ou horário mudaram, o lembrete de 20 min volta a ficar pendente
        const dataHoraMudou = editingData.dataHoraOriginal !== `${formData.data} ${formData.hora_inicio}`;

        for (const [funcao, membroId] of functionsToProcess) {
          funcoesPresentes.add(funcao);
          if (scaleIds[funcao]) {
            updates.push({
              id: scaleIds[funcao],
              data: formData.data,
              hora_inicio: formData.hora_inicio,
              tipo_sessao: formData.tipo_sessao,
              funcao,
              membro_original_id: membroId,
              ...(dataHoraMudou ? { lembrete_enviado_em: null } : {})
            });
          } else {
            inserts.push({
              data: formData.data,
              hora_inicio: formData.hora_inicio,
              tipo_sessao: formData.tipo_sessao,
              funcao,
              membro_original_id: membroId,
              status_substituicao: 'Nenhum'
            });
          }
        }

        const deletes = Object.keys(scaleIds)
          .filter(f => !funcoesPresentes.has(f))
          .map(f => scaleIds[f]);

        if (updates.length > 0) {
          const { error } = await supabase.from('escalas').upsert(updates);
          if (error) throw error;
        }

        if (inserts.length > 0) {
          const { error } = await supabase.from('escalas').insert(inserts);
          if (error) throw error;
        }

        if (deletes.length > 0) {
          const { error } = await supabase.from('escalas').delete().in('id', deletes);
          if (error) throw error;
        }
      } else {
        const insercoes = functionsToProcess.map(([funcao, membroId]) => ({
          data: formData.data,
          hora_inicio: formData.hora_inicio,
          tipo_sessao: formData.tipo_sessao,
          funcao,
          membro_original_id: membroId,
          status_substituicao: 'Nenhum'
        }));

        const { error } = await supabase.from('escalas').insert(insercoes);
        if (error) throw error;
      }
      
      setIsModalOpen(false);
      setFormData({ data: '', tipo_sessao: '', hora_inicio: '', membrosPorFuncao: {} });
      setScaleIds({});
      setEditingData({ isEditing: false });
      setFormDateAusencias({});
      fetchEscalas();
    } catch (err: any) {
      setError('Erro ao salvar escala: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteScale = async () => {
    if (!deleteConfirmation.scaleGroup) return;
    setIsDeleting(true);
    try {
      const idsToDelete = deleteConfirmation.scaleGroup.slots.map((s: any) => s.id);
      const { error } = await supabase.from('escalas').delete().in('id', idsToDelete);
      if (error) throw error;
      setDeleteConfirmation({isOpen: false, scaleGroup: null});
      fetchEscalas();
    } catch (err: any) {
      console.error('Erro ao excluir escala:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleToggleFalta = async (id: string, currentCompareceu: boolean | null) => {
    setFaltaConfirmation({ isOpen: true, escalaId: id, currentCompareceu });
  };

  const confirmToggleFalta = async () => {
    if (!faltaConfirmation.escalaId) return;
    const newValue = faltaConfirmation.currentCompareceu === false ? null : false;
    try {
      // Marcar/desmarcar falta também limpa os horários de check-in/check-out
      const { error } = await supabase
        .from('escalas')
        .update({ compareceu: newValue, checkin_em: null, checkin_por: null, checkout_em: null, checkout_por: null })
        .eq('id', faltaConfirmation.escalaId);
      if (error) throw error;
      fetchEscalas();
    } catch (err: any) {
      console.error('Erro ao atualizar presença:', err);
    } finally {
      setFaltaConfirmation({ isOpen: false, escalaId: null, currentCompareceu: null });
    }
  };

  const openCheckInModal = (slot: any, scaleGroup: any, tipo: 'checkin' | 'checkout') => {
    setPresencaHora(getHoraAtual());
    setCheckInConfirmation({ isOpen: true, slot, scaleGroup, tipo });
  };

  const confirmManualCheckIn = async () => {
    if (!checkInConfirmation.slot) return;
    if (!presencaHora) {
      showToast('Informe o horário.', 'error');
      return;
    }
    setIsCheckingIn(true);
    try {
      const horario = combinarDataHora(checkInConfirmation.scaleGroup.data, presencaHora);
      if (checkInConfirmation.tipo === 'checkout') {
        await registrarCheckout(checkInConfirmation.slot.id, horario);
      } else {
        await registrarCheckin(checkInConfirmation.slot.id, horario);
      }

      fetchEscalas();
      setCheckInConfirmation({ isOpen: false, slot: null, scaleGroup: null, tipo: 'checkin' });
      showToast(checkInConfirmation.tipo === 'checkout' ? 'Check-out registrado!' : 'Check-in registrado!');
    } catch (error: any) {
      console.error('Erro ao registrar presença:', error);
      showToast(error?.message || 'Erro ao registrar presença. Tente novamente.', 'error');
    } finally {
      setIsCheckingIn(false);
    }
  };

  const filteredEscalas = escalas.filter(group => {
    if (!filterMembro) return true;
    const term = filterMembro.toLowerCase();
    return group.slots.some((slot: any) => 
      slot.membro_original?.nome?.toLowerCase().includes(term) ||
      slot.membro_substituto?.nome?.toLowerCase().includes(term)
    );
  });

  const renderCalendar = () => {
    const [year, month] = currentMonth.split('-').map(Number);
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const startingDayOfWeek = firstDay.getDay();
    const totalDays = lastDay.getDate();

    const days = [];
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }
    for (let i = 1; i <= totalDays; i++) {
      days.push(i);
    }

    return (
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden mt-2">
        <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 dark:bg-gray-800/50">
          {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(d => (
            <div key={d} className="px-2 py-3 text-center text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 auto-rows-fr">
          {days.map((day, i) => {
            if (!day) return <div key={`empty-${i}`} className="border-b border-r border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 dark:bg-gray-800/20 min-h-[120px] md:min-h-[150px]"></div>;

            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dayEscalas = filteredEscalas.filter(e => e.data === dateStr);

            return (
              <div key={day} className="border-b border-r border-gray-100 dark:border-gray-700 min-h-[120px] md:min-h-[150px] p-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors relative flex flex-col">
                <div className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-2 text-center">{day}</div>
                <div className="space-y-1.5 flex-1 overflow-y-auto custom-scrollbar">
                  {dayEscalas.map((esc: any, idx: number) => (
                    <div
                      key={idx}
                      onClick={() => handleEditSessao(esc)}
                      className={`p-2 rounded-lg border transition-colors cursor-pointer group ${getSessaoStyles(esc.sessao).calendar} ${esc.rascunho ? 'border-dashed opacity-70' : ''}`}
                      title={esc.rascunho ? 'Rascunho: ainda não publicado para os técnicos' : undefined}
                    >
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-semibold text-xs leading-tight block">{esc.sessao}{esc.hora && <span className="font-normal opacity-80"> {esc.hora}</span>}{esc.rascunho && <span className="block font-normal italic opacity-90">rascunho</span>}</span>
                        {esc.data >= hojeStrGlobal && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConfirmation({isOpen: true, scaleGroup: esc});
                            }}
                            className="text-red-600 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:bg-red-900/40 dark:hover:bg-red-900/60 p-1 rounded transition-all shadow-sm opacity-100 md:opacity-0 md:group-hover:opacity-100"
                            title="Excluir Escala"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="flex flex-col gap-1.5 mt-2 pb-1">
                        {esc.slots.map((slot: any, sidx: number) => {
                          let ringColor = 'border-white/20 dark:border-gray-800/20';
                          if (esc.data <= hojeStrGlobal) {
                            if (slot.compareceu === true) {
                              ringColor = 'border-green-500 ring-1 ring-green-500';
                            } else if (slot.compareceu === false) {
                              ringColor = 'border-red-500 ring-1 ring-red-500';
                            }
                          }

                          const isSubstituido = slot.status_substituicao === 'Substituição Aceita';
                          const member = isSubstituido ? slot.membro_substituto : slot.membro_original;

                          return (
                            <div key={sidx} className="flex items-center gap-1.5 overflow-hidden rounded" title={member?.nome}>
                              <div className={`w-5 h-5 shrink-0 rounded-full border ${ringColor} flex items-center justify-center overflow-hidden bg-white/80 text-gray-500 dark:bg-gray-800 dark:text-gray-400`}>
                                {member?.foto_url ? (
                                  <img src={member.foto_url} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <User className="w-3 h-3" />
                                )}
                              </div>
                              <div className="flex flex-col min-w-0 flex-1">
                                <span className="text-[10px] font-bold truncate leading-none">{member?.nome?.split(' ')[0]}</span>
                                <div className="flex items-center justify-between gap-1 mt-0.5">
                                  <span className="text-[9px] opacity-80 truncate leading-none">
                                    {slot.checkin_em ? `${formatHora(slot.checkin_em)}–${slot.checkout_em ? formatHora(slot.checkout_em) : '...'}` : slot.funcao}
                                  </span>
                                  {esc.data <= hojeStrGlobal && (
                                    slot.compareceu === true ? (
                                      <span className="text-[8px] font-bold text-green-700 bg-green-100 dark:bg-green-900/50 dark:text-green-300 px-1 py-0.5 rounded leading-none shrink-0" title="Check-in Realizado">OK</span>
                                    ) : slot.compareceu === false ? (
                                      <span className="text-[8px] font-bold text-red-700 bg-red-100 dark:bg-red-900/50 dark:text-red-300 px-1 py-0.5 rounded leading-none shrink-0" title="Faltou">Falta</span>
                                    ) : null
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const hojeStrGlobal = getLocalDateStr();

  return (
    <AdminLayout>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h2 className="text-3xl font-bold text-gray-800 dark:text-gray-100">Gerenciar Escalas</h2>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Escale os técnicos de suporte das próximas sessões e acompanhe check-in/check-out.</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <button
            onClick={() => setIsBuilderOpen(true)}
            className="flex-1 md:flex-none flex items-center justify-center px-4 py-2.5 bg-white dark:bg-gray-800 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800/60 font-medium rounded-xl hover:bg-blue-50 dark:hover:bg-blue-900/30 shadow-sm transition-colors"
          >
            <CalendarDays className="w-5 h-5 mr-2" />
            Montar Mês
          </button>
          <button
            onClick={openMessagesModal}
            className="flex-1 md:flex-none flex items-center justify-center px-4 py-2.5 bg-purple-600 text-white font-medium rounded-xl hover:bg-purple-700 shadow-sm transition-colors"
          >
            <MessageCircle className="w-5 h-5 mr-2" />
            Configurar Mensagens
          </button>
          <div className="flex bg-gray-100 dark:bg-gray-700/80 dark:bg-gray-800/80 p-1 rounded-xl">
            <button 
              onClick={() => setViewMode('lista')}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${viewMode === 'lista' ? 'bg-white dark:bg-gray-800 text-blue-700 shadow-sm dark:bg-gray-700 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-200 dark:text-gray-400 dark:hover:text-gray-200'}`}
            >
              Lista
            </button>
            <button 
              onClick={() => setViewMode('mensal')}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${viewMode === 'mensal' ? 'bg-white dark:bg-gray-800 text-blue-700 shadow-sm dark:bg-gray-700 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-200 dark:text-gray-400 dark:hover:text-gray-200'}`}
            >
              Mensal
            </button>
          </div>

          <button 
            onClick={handleOpenNewScale}
            className="flex-1 md:flex-none flex items-center justify-center px-5 py-2.5 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 shadow-sm transition-colors"
          >
            <Plus className="w-5 h-5 mr-2" />
            Nova
          </button>
        </div>
      </div>

      {viewMode === 'lista' && (
        <div className="bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 mb-6 flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5 ml-1">Filtrar por Data</label>
            <CustomDatePicker 
              selected={filterData ? new Date(filterData + 'T12:00:00') : null}
              onChange={(d: Date | null) => setFilterData(d ? d.toISOString().split('T')[0] : '')}
              placeholderText="Data específica"
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5 ml-1">Filtrar por Sessão</label>
            <select 
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-xl px-3 py-2 text-sm focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800"
              value={filterSessao}
              onChange={e => setFilterSessao(e.target.value)}
            >
              <option value="">Todas as Sessões</option>
              {SESSOES_DISPONIVEIS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5 ml-1">Buscar Membro</label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 dark:text-gray-400" />
              <input 
                type="text" 
                placeholder="Nome do membro..."
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-xl pl-9 pr-3 py-2 text-sm focus:ring-blue-500 focus:border-blue-500"
                value={filterMembro}
                onChange={e => setFilterMembro(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-300 cursor-pointer">
              <input 
                type="checkbox" 
                checked={showPast} 
                onChange={e => setShowPast(e.target.checked)} 
                className="rounded w-4 h-4 border-gray-300 dark:border-gray-600 dark:bg-gray-700 text-blue-600 focus:ring-blue-500" 
              />
              Exibir passadas
            </label>
            <button 
              onClick={() => { setFilterData(''); setFilterSessao(''); setFilterMembro(''); setShowPast(false); }}
              className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 dark:text-gray-300 text-sm font-medium rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              Limpar Filtros
            </button>
          </div>
        </div>
      )}

      {viewMode === 'mensal' && (
        <div className="bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-1.5">
            <button 
              onClick={handlePreviousMonth}
              className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 dark:bg-gray-700 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700 transition-colors flex-shrink-0"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 mx-1">
              <CalendarIcon className="w-5 h-5 text-blue-600 dark:text-blue-400 hidden sm:block" />
              <h3 className="font-bold text-lg text-gray-800 dark:text-gray-100 capitalize whitespace-nowrap">
                {new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(currentMonth + '-01T12:00:00'))}
              </h3>
            </div>
            <button 
              onClick={handleNextMonth}
              className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 dark:bg-gray-700 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700 transition-colors flex-shrink-0"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
          <div className="flex flex-1 w-full md:w-auto items-center gap-3">
            <div className="relative flex-1 md:w-64">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 dark:text-gray-400" />
              <input 
                type="text" 
                placeholder="Destacar membro..."
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-xl pl-9 pr-3 py-2 text-sm focus:ring-blue-500 focus:border-blue-500"
                value={filterMembro}
                onChange={e => setFilterMembro(e.target.value)}
              />
            </div>
            <div className="w-44">
              <CustomDatePicker 
                selected={new Date(currentMonth + '-01T12:00:00')}
                onChange={(d: Date | null) => {
                  if (d) setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
                }}
                showMonthYearPicker
              />
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center p-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400"></div>
        </div>
      ) : filteredEscalas.length === 0 && viewMode === 'lista' ? (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-12 text-center shadow-sm">
          <Filter className="w-12 h-12 text-gray-300 dark:text-gray-600 dark:text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-50 dark:text-gray-100">Nenhuma escala encontrada</h3>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Tente ajustar os filtros ou crie uma nova escala.</p>
        </div>
      ) : viewMode === 'mensal' ? (
        renderCalendar()
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {filteredEscalas.map((group, index) => {
            const styles = getSessaoStyles(group.sessao);

            return (
            <div key={index} className={`bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden flex flex-col transition-colors ${styles.wrapper}`}>
              <div className={`px-6 py-4 border-b flex justify-between items-center ${styles.headerBg}`}>
                <div>
                  <h3 className="font-bold text-gray-900 dark:text-gray-50 dark:text-gray-100 capitalize">{formatData(group.data)}</h3>
                  <p className={`text-sm font-bold ${styles.text}`}>
                    {group.sessao}{group.hora && <span className="font-medium"> · {group.hora}</span>}
                    {group.rascunho && <span className="ml-2 text-[10px] font-bold text-gray-600 bg-gray-100 border border-dashed border-gray-400 dark:bg-gray-700 dark:text-gray-300 px-1.5 py-0.5 rounded" title="Ainda não publicado para os técnicos. Publique em Montar Mês.">Rascunho</span>}
                    {group.lembreteEnviado && <span className="ml-2 text-[10px] font-bold text-green-700 bg-green-100 dark:bg-green-900/40 dark:text-green-300 px-1.5 py-0.5 rounded">Lembrete enviado</span>}
                  </p>
                </div>
                <div className="flex gap-2">
                  {group.data >= hojeStrGlobal && !group.rascunho && (
                    <button
                      onClick={() => handleOpenNoticeModal(group)}
                      className={`text-xs font-semibold text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/50 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 dark:hover:bg-blue-900/40 px-3 py-1.5 rounded-lg transition-colors shadow-sm flex items-center justify-center`}
                      title="Notificar Escalados"
                    >
                      <Send className="w-4 h-4 md:mr-1.5" />
                      <span className="hidden md:inline">Criar Aviso</span>
                    </button>
                  )}
                  <button 
                    onClick={() => handleEditSessao(group)}
                    className={`text-xs font-semibold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 rounded-lg transition-colors shadow-sm ${styles.btnHover}`}
                  >
                    Editar Sessão
                  </button>
                  {group.data >= hojeStrGlobal && (
                    <button 
                      onClick={() => setDeleteConfirmation({isOpen: true, scaleGroup: group})}
                      className="text-xs font-semibold text-red-600 border border-red-200 bg-red-50 hover:bg-red-100 hover:border-red-300 dark:text-red-400 dark:border-red-900/50 dark:bg-red-900/20 dark:hover:bg-red-900/40 px-2 py-1.5 rounded-lg transition-colors shadow-sm flex items-center justify-center"
                      title="Excluir Escala"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="p-4 flex-1">
                <div className="space-y-3">
                  {group.slots.map((slot: any) => {
                    const isTrocaPendente = slot.status_substituicao === 'Disponível para Troca';
                    const isSubstituido = slot.status_substituicao === 'Substituição Aceita';
                    
                    const isFalta = slot.compareceu === false;
                    
                    const isMembroHighlighted = filterMembro && (
                      slot.membro_original?.nome?.toLowerCase().includes(filterMembro.toLowerCase()) ||
                      slot.membro_substituto?.nome?.toLowerCase().includes(filterMembro.toLowerCase())
                    );

                    return (
                      <div key={slot.id} className={`flex items-center justify-between p-3 border rounded-xl transition-all ${
                        isTrocaPendente ? 'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800/50' : 
                        isFalta ? 'bg-red-50/50 border-red-200 dark:bg-red-900/20 dark:border-red-800/50' :
                        isSubstituido ? 'bg-blue-50 border-blue-100 dark:bg-blue-900/20 dark:border-blue-800/50' : 
                        isMembroHighlighted ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800/50' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:bg-gray-800 dark:border-gray-700 dark:hover:border-gray-500'
                      }`}>
                        
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center overflow-hidden shrink-0 ${
                            isTrocaPendente ? 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/50 dark:text-yellow-400' :
                            isSubstituido ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400' : 
                            isMembroHighlighted ? 'bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 dark:bg-gray-700 dark:text-gray-400'
                          }`}>
                            {isSubstituido && slot.membro_substituto?.foto_url ? (
                              <img src={slot.membro_substituto.foto_url} alt={slot.membro_substituto.nome} className="w-full h-full object-cover" />
                            ) : !isSubstituido && slot.membro_original?.foto_url ? (
                              <img src={slot.membro_original.foto_url} alt={slot.membro_original.nome} className="w-full h-full object-cover" />
                            ) : isTrocaPendente ? (
                              <AlertCircle className="w-4 h-4" />
                            ) : (
                              <User className="w-4 h-4" />
                            )}
                          </div>

                          <div>
                            <p className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{slot.funcao}</p>
                            <div className={`text-sm font-bold flex items-center gap-2 ${isTrocaPendente ? 'text-yellow-800 dark:text-yellow-400' : isMembroHighlighted ? 'text-green-800 dark:text-green-400' : 'text-gray-900 dark:text-gray-50 dark:text-gray-100'}`}>
                              {isSubstituido ? slot.membro_substituto?.nome : slot.membro_original?.nome}
                            </div>
                            
                            {isTrocaPendente && (
                              <p className="text-xs font-medium text-yellow-700 dark:text-yellow-500 flex items-center mt-0.5">
                                Pediu para ser substituído
                              </p>
                            )}
                            {isSubstituido && (
                              <p className="text-xs font-medium text-blue-600 dark:text-blue-400 flex items-center mt-0.5">
                                Substituiu: {slot.membro_original?.nome}
                              </p>
                            )}
                            {isFalta && (
                              <p className="text-[10px] font-black text-white bg-red-500 px-2 py-0.5 rounded-full inline-flex items-center mt-1 shadow-sm">
                                Falta
                              </p>
                            )}
                            {slot.compareceu && (
                              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                <span className="text-[10px] font-black text-white bg-green-500 px-2 py-0.5 rounded-full inline-flex items-center gap-1 shadow-sm">
                                  <LogIn className="w-3 h-3" /> Check-in {formatHora(slot.checkin_em)}
                                </span>
                                {slot.checkout_em ? (
                                  <span className="text-[10px] font-black text-white bg-slate-600 px-2 py-0.5 rounded-full inline-flex items-center gap-1 shadow-sm">
                                    <LogOut className="w-3 h-3" /> Check-out {formatHora(slot.checkout_em)}
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-bold text-amber-700 bg-amber-100 dark:bg-amber-900/40 dark:text-amber-300 px-2 py-0.5 rounded-full">
                                    Sem check-out
                                  </span>
                                )}
                                {slot.checkout_em && (
                                  <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 inline-flex items-center gap-1">
                                    <Clock className="w-3 h-3" /> {formatDuracao(slot.checkin_em, slot.checkout_em)}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {group.data <= hojeStrGlobal && (
                          <div className="flex shrink-0 ml-3 gap-2">
                            {slot.compareceu !== true && (
                              <button
                                onClick={() => openCheckInModal(slot, group, 'checkin')}
                                className="text-xs px-2.5 py-1.5 rounded-lg font-medium border border-green-600 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 dark:border-green-500 dark:text-green-500 transition-colors shadow-sm flex items-center justify-center"
                                title="Registrar Check-in Manual"
                              >
                                <LogIn className="w-4 h-4" />
                              </button>
                            )}
                            {slot.compareceu === true && !slot.checkout_em && (
                              <button
                                onClick={() => openCheckInModal(slot, group, 'checkout')}
                                className="text-xs px-2.5 py-1.5 rounded-lg font-medium border border-slate-600 text-slate-600 hover:bg-slate-50 dark:hover:bg-slate-900/30 dark:border-slate-400 dark:text-slate-300 transition-colors shadow-sm flex items-center justify-center"
                                title="Registrar Check-out Manual"
                              >
                                <LogOut className="w-4 h-4" />
                              </button>
                            )}
                            {slot.compareceu !== false && (
                              <button
                                onClick={() => handleToggleFalta(slot.id, slot.compareceu)}
                                className="text-xs px-2.5 py-1.5 rounded-lg font-medium border border-red-600 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 dark:border-red-500 dark:text-red-500 transition-colors shadow-sm flex items-center justify-center"
                                title="Marcar Falta"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            )}
                            {slot.compareceu === false && (
                              <button
                                onClick={() => handleToggleFalta(slot.id, slot.compareceu)}
                                className="text-xs px-2.5 py-1.5 rounded-lg font-medium border border-gray-400 text-gray-600 hover:bg-gray-100 dark:border-gray-500 dark:text-gray-400 dark:hover:bg-gray-800 transition-colors shadow-sm flex items-center justify-center"
                                title="Desmarcar Falta"
                              >
                                <RotateCcw className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        )}

                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )})}
        </div>
      )}

      {isBuilderOpen && (
        <MonthlyScaleBuilder
          mesInicial={currentMonth}
          membros={membros}
          onClose={() => { setIsBuilderOpen(false); fetchEscalas(); }}
        />
      )}

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-lg text-gray-900 dark:text-gray-50 dark:text-gray-100">{editingData.isEditing ? 'Editar Sessão' : 'Programar Nova Sessão'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 dark:text-gray-300 dark:hover:text-gray-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 p-2 rounded-full transition-colors">
                ✕
              </button>
            </div>
            
            {error && (
              <div className="mx-6 mt-6 p-4 bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 rounded-r-xl flex items-start shadow-sm">
                <AlertCircle className="w-5 h-5 text-red-500 mr-3 shrink-0 mt-0.5" />
                <p className="text-sm font-medium text-red-800 dark:text-red-300">{error}</p>
              </div>
            )}

            <div className="p-6 overflow-y-auto no-scrollbar space-y-4 flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 dark:text-gray-300 mb-1">Data</label>
                  <CustomDatePicker 
                    selected={formData.data ? new Date(formData.data + 'T12:00:00') : null}
                    onChange={(d: Date | null) => setFormData({...formData, data: d ? d.toISOString().split('T')[0] : ''})}
                    placeholderText="Data da sessão"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 dark:text-gray-300 mb-1">Início</label>
                  <input
                    type="time"
                    value={formData.hora_inicio}
                    onChange={(e) => setFormData({...formData, hora_inicio: e.target.value})}
                    className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-xl px-4 py-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 dark:text-gray-300 mb-1">Sessão</label>
                  <select 
                    className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-xl px-4 py-2.5 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800"
                    value={formData.tipo_sessao}
                    onChange={(e) => setFormData({...formData, tipo_sessao: e.target.value})}
                  >
                    <option value="">Selecione...</option>
                    {SESSOES_DISPONIVEIS.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1">
                Os escalados recebem lembrete automático (WhatsApp e aviso no app) {LEMBRETE_ANTECEDENCIA_MIN} minutos antes do início.
              </p>

              <div className="pt-4 border-t border-gray-100 dark:border-gray-700">
                <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100 dark:text-gray-200 mb-3">Escalar Membros</h4>
                <div className="space-y-3">
                  {FUNCOES_DISPONIVEIS.map(funcao => {
                    const membroSelecionadoId = formData.membrosPorFuncao[funcao];
                    // Ativos + o atualmente escalado (mesmo que tenha sido inativado depois)
                    const membrosAptos = membros.filter(m => m.ativo !== false || m.id === membroSelecionadoId);
                    const motivoAusenciaSelecionado = membroSelecionadoId ? formDateAusencias[membroSelecionadoId] : null;

                    return (
                      <div key={funcao} className="bg-gray-50 dark:bg-gray-700/50 dark:bg-gray-800/50 p-3 rounded-xl border border-gray-100 dark:border-gray-700 focus-within:border-blue-300 dark:focus-within:border-blue-500 focus-within:bg-blue-50/30 dark:focus-within:bg-blue-900/10 transition-colors">
                        <div className="flex items-center justify-between mb-1.5 ml-1">
                          <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{funcao}</label>
                          {motivoAusenciaSelecionado && (
                            <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 rounded-full flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" /> Ausência Marcada
                            </span>
                          )}
                        </div>
                        <select 
                          className={`w-full border rounded-lg px-3 py-2 text-sm focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 shadow-sm ${
                            motivoAusenciaSelecionado 
                              ? 'border-amber-400 dark:border-amber-500 text-amber-900 dark:text-amber-200' 
                              : 'border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white'
                          }`}
                          value={formData.membrosPorFuncao[funcao] || ''}
                          onChange={(e) => setFormData(prev => ({
                            ...prev, 
                            membrosPorFuncao: { ...prev.membrosPorFuncao, [funcao]: e.target.value }
                          }))}
                        >
                          <option value="">Ninguém Escalado</option>
                          {membrosAptos.map(m => {
                            const temAusencia = formDateAusencias[m.id];
                            return (
                              <option key={m.id} value={m.id}>
                                {m.nome} {temAusencia ? '⚠️ (Ausência programada)' : ''}
                              </option>
                            );
                          })}
                        </select>
                        {motivoAusenciaSelecionado && (
                          <p className="text-xs text-amber-700 dark:text-amber-300 mt-1 ml-1 flex items-center gap-1">
                            <span><strong>Motivo da ausência:</strong> {motivoAusenciaSelecionado}</span>
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-gray-100 dark:border-gray-700 shrink-0 bg-gray-50 dark:bg-gray-700/50 dark:bg-gray-800/50">
              <div className="flex gap-3 justify-end">
                <button 
                  onClick={() => setIsModalOpen(false)} 
                  className="px-4 py-2.5 font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 bg-gray-100 dark:bg-gray-700 dark:bg-gray-800 border dark:border-gray-600 rounded-xl transition-colors"
                  disabled={saving}
                >
                  Cancelar
                </button>
                <button 
                  onClick={() => handleSaveScale(false)}
                  disabled={saving}
                  className="px-5 py-2.5 font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl flex items-center disabled:opacity-50 shadow-sm transition-colors"
                >
                  {saving ? 'Salvando...' : 'Salvar Escala'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteConfirmation.isOpen && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-8 h-8 text-red-600 dark:text-red-400" />
              </div>
              <h3 className="font-bold text-xl text-gray-900 dark:text-gray-50 dark:text-gray-100 mb-2">Excluir Escala</h3>
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                Tem certeza que deseja excluir esta escala? Esta ação não pode ser desfeita e todos os membros escalados serão removidos.
              </p>
            </div>
            <div className="p-4 bg-gray-50 dark:bg-gray-700/50 dark:bg-gray-800/50 border-t dark:border-gray-700 flex gap-3">
              <button
                onClick={() => setDeleteConfirmation({isOpen: false, scaleGroup: null})}
                className="flex-1 px-4 py-2.5 font-medium text-gray-700 dark:text-gray-200 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50 dark:bg-gray-700/50 dark:hover:bg-gray-700 rounded-xl transition-colors"
                disabled={isDeleting}
              >
                Cancelar
              </button>
              <button
                onClick={confirmDeleteScale}
                disabled={isDeleting}
                className="flex-1 px-4 py-2.5 font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl flex items-center justify-center transition-colors disabled:opacity-50 shadow-sm"
              >
                {isDeleting ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {absenceConfirmation.isOpen && (
        <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6">
              <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-8 h-8 text-amber-600 dark:text-amber-400" />
              </div>
              <h3 className="font-bold text-xl text-gray-900 dark:text-gray-100 text-center mb-2">
                Aviso: Ausência Programada
              </h3>
              <p className="text-gray-500 dark:text-gray-400 text-sm text-center mb-4">
                Identificamos que o(s) seguinte(s) membro(s) cadastrou(aram) ausência prévia:
              </p>

              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl p-3 max-h-56 overflow-y-auto space-y-2 mb-4">
                {absenceConfirmation.conflicts.map((c, idx) => (
                  <div key={idx} className="text-sm border-b last:border-0 border-amber-200/60 dark:border-amber-800/30 pb-2 last:pb-0">
                    <div className="font-bold text-gray-900 dark:text-gray-100 flex items-center justify-between">
                      <span>{c.membroNome}</span>
                      <span className="text-xs bg-amber-200 dark:bg-amber-800/60 text-amber-900 dark:text-amber-200 px-2 py-0.5 rounded-md font-semibold">
                        {c.funcao}
                      </span>
                    </div>
                    {c.data && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        Data: {formatData(c.data)}
                      </p>
                    )}
                    <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5">
                      <span className="font-semibold">Motivo:</span> {c.motivo}
                    </p>
                  </div>
                ))}
              </div>

              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 text-center">
                Deseja continuar e escalar mesmo assim?
              </p>
            </div>

            <div className="p-4 bg-gray-50 dark:bg-gray-700/50 border-t dark:border-gray-700 flex gap-3">
              <button
                onClick={() => setAbsenceConfirmation({ isOpen: false, conflicts: [] })}
                className="flex-1 px-4 py-2.5 font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-xl transition-colors"
                disabled={saving}
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  const onConf = absenceConfirmation.onConfirm;
                  setAbsenceConfirmation({ isOpen: false, conflicts: [] });
                  if (onConf) onConf();
                }}
                disabled={saving}
                className="flex-1 px-4 py-2.5 font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl flex items-center justify-center transition-colors shadow-sm disabled:opacity-50"
              >
                {saving ? 'Salvando...' : 'Continuar e Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {faltaConfirmation.isOpen && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 text-center">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${
                faltaConfirmation.currentCompareceu === false 
                ? 'bg-gray-100 dark:bg-gray-700' 
                : 'bg-red-100 dark:bg-red-900/30'
              }`}>
                <AlertCircle className={`w-8 h-8 ${
                  faltaConfirmation.currentCompareceu === false 
                  ? 'text-gray-600 dark:text-gray-300 dark:text-gray-400' 
                  : 'text-red-600 dark:text-red-400'
                }`} />
              </div>
              <h3 className="font-bold text-xl text-gray-900 dark:text-gray-50 dark:text-gray-100 mb-2">
                {faltaConfirmation.currentCompareceu === false ? 'Desmarcar Falta' : 'Marcar Falta'}
              </h3>
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                {faltaConfirmation.currentCompareceu === false 
                  ? 'Tem certeza que deseja desmarcar a falta deste membro?' 
                  : 'Tem certeza que deseja marcar falta para este membro? Os horários de check-in/check-out registrados serão apagados.'}
              </p>
            </div>
            <div className="p-4 bg-gray-50 dark:bg-gray-700/50 dark:bg-gray-800/50 border-t dark:border-gray-700 flex gap-3">
              <button
                onClick={() => setFaltaConfirmation({isOpen: false, escalaId: null, currentCompareceu: null})}
                className="flex-1 px-4 py-2.5 font-medium text-gray-700 dark:text-gray-200 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50 dark:bg-gray-700/50 dark:hover:bg-gray-700 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmToggleFalta}
                className={`flex-1 px-4 py-2.5 font-bold text-white rounded-xl flex items-center justify-center transition-colors shadow-sm ${
                  faltaConfirmation.currentCompareceu === false 
                  ? 'bg-gray-600 hover:bg-gray-700' 
                  : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Check-in / Check-out Manual (Admin) */}
      {checkInConfirmation.isOpen && checkInConfirmation.slot && checkInConfirmation.scaleGroup && (() => {
        const isCheckout = checkInConfirmation.tipo === 'checkout';
        const fechar = () => setCheckInConfirmation({ isOpen: false, slot: null, scaleGroup: null, tipo: 'checkin' });
        return (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className={`p-6 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center ${isCheckout ? 'bg-slate-50/60 dark:bg-slate-900/20' : 'bg-green-50/50 dark:bg-green-900/10'}`}>
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isCheckout ? 'bg-slate-100 text-slate-600' : 'bg-green-100 text-green-600'}`}>
                  {isCheckout ? <LogOut className="w-5 h-5" /> : <LogIn className="w-5 h-5" />}
                </div>
                <h3 className="font-bold text-lg text-gray-900 dark:text-gray-50">{isCheckout ? 'Registrar Check-out' : 'Registrar Check-in'}</h3>
              </div>
              <button
                onClick={() => !isCheckingIn && fechar()}
                className="text-gray-400 hover:text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 p-2 rounded-full transition-colors"
                disabled={isCheckingIn}
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-gray-50 dark:bg-gray-700/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700 text-sm">
                <div className="grid grid-cols-2 gap-y-3">
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase">Data / Sessão</p>
                    <p className="font-bold text-gray-800 dark:text-gray-100">{formatData(checkInConfirmation.scaleGroup.data)}</p>
                    <p className="text-gray-500 dark:text-gray-400">{checkInConfirmation.scaleGroup.sessao}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase">Função</p>
                    <p className="font-bold text-gray-800 dark:text-gray-100">{checkInConfirmation.slot.funcao}</p>
                  </div>
                  <div className="col-span-2">
                     <p className="text-[10px] font-bold text-gray-400 uppercase">Membro na Escala</p>
                     <p className="font-bold text-gray-800 dark:text-gray-100">
                       {checkInConfirmation.slot.status_substituicao === 'Substituição Aceita' && checkInConfirmation.slot.membro_substituto
                         ? checkInConfirmation.slot.membro_substituto.nome
                         : checkInConfirmation.slot.membro_original?.nome}
                     </p>
                  </div>
                  {isCheckout && (
                    <div className="col-span-2">
                      <p className="text-[10px] font-bold text-gray-400 uppercase">Check-in registrado</p>
                      <p className="font-bold text-gray-800 dark:text-gray-100">{formatHora(checkInConfirmation.slot.checkin_em)}</p>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-1">
                  Horário do {isCheckout ? 'check-out' : 'check-in'}
                </label>
                <input
                  type="time"
                  value={presencaHora}
                  onChange={e => setPresencaHora(e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-xl px-4 py-2.5 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="bg-blue-50 p-3 rounded-xl border border-blue-100 text-sm text-blue-800 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-blue-500" />
                <p>
                  Lançamento manual do administrador. O horário informado será gravado como {isCheckout ? 'saída' : 'chegada'} do técnico nesta sessão.
                </p>
              </div>
            </div>

            <div className="p-6 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex gap-3 justify-end">
              <button
                onClick={fechar}
                className="px-4 py-2.5 font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-200 bg-gray-100 dark:bg-gray-700 rounded-xl transition-colors"
                disabled={isCheckingIn}
              >
                Cancelar
              </button>
              <button
                onClick={confirmManualCheckIn}
                disabled={isCheckingIn}
                className={`px-5 py-2.5 font-bold text-white rounded-xl flex items-center disabled:opacity-50 shadow-sm transition-colors ${isCheckout ? 'bg-slate-600 hover:bg-slate-700' : 'bg-green-600 hover:bg-green-700'}`}
              >
                {isCheckingIn ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Registrando...
                  </>
                ) : (
                  isCheckout ? 'Confirmar Check-out' : 'Confirmar Check-in'
                )}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Modal de Aviso / Notificação */}
      {noticeConfirmation.isOpen && noticeConfirmation.scaleGroup && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-blue-50/50 dark:bg-blue-900/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center">
                  <Send className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-lg text-gray-900 dark:text-gray-50">Avisar Escalados</h3>
              </div>
              <button 
                onClick={() => !isSendingNotice && setNoticeConfirmation({isOpen: false, scaleGroup: null})} 
                className="text-gray-400 hover:text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 p-2 rounded-full transition-colors"
                disabled={isSendingNotice}
              >
                ✕
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <p className="text-gray-600 dark:text-gray-300 text-sm">
                Edite a mensagem do aviso que será enviada para todos os escalados em <strong>{formatData(noticeConfirmation.scaleGroup.data)} - {noticeConfirmation.scaleGroup.sessao}</strong>:
              </p>
              
              <textarea
                value={noticeText}
                onChange={(e) => setNoticeText(e.target.value)}
                className="w-full h-56 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-xl p-3 text-sm focus:ring-blue-500 focus:border-blue-500 shadow-sm custom-scrollbar"
                placeholder="Digite a mensagem do lembrete..."
              />
              
              <div className="bg-blue-50 p-3 rounded-xl border border-blue-100 text-sm text-blue-800 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-blue-500" />
                <p>
                  Os membros receberão este texto como um Aviso no aplicativo e também via Notificação Push.
                </p>
              </div>

              <div className="flex items-center p-3 mt-4 bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-800/30 rounded-xl">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="mr-3 rounded text-green-600 focus:ring-green-500 w-4 h-4"
                    checked={sendNoticeWhatsApp}
                    onChange={e => setSendNoticeWhatsApp(e.target.checked)}
                  />
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-green-900 dark:text-green-200 flex items-center gap-2">
                      <MessageCircle className="w-4 h-4" />
                      Enviar notificação via WhatsApp
                    </span>
                    <span className="text-xs text-green-700 dark:text-green-300">Envia o aviso também no WhatsApp dos escalados.</span>
                  </div>
                </label>
              </div>
            </div>

            <div className="p-6 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex gap-3 justify-end">
              <button 
                onClick={() => setNoticeConfirmation({isOpen: false, scaleGroup: null})} 
                className="px-4 py-2.5 font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-200 bg-gray-100 dark:bg-gray-700 rounded-xl transition-colors"
                disabled={isSendingNotice}
              >
                Cancelar
              </button>
              <button 
                onClick={confirmSendNotice}
                disabled={isSendingNotice}
                className="px-5 py-2.5 font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl flex items-center disabled:opacity-50 shadow-sm transition-colors"
              >
                {isSendingNotice ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Enviando...
                  </>
                ) : (
                  'Enviar Aviso'
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
      {/* Modal de Configurar Mensagens */}
      {isMessagesModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-gray-800 rounded-3xl p-6 w-full max-w-2xl shadow-2xl border border-gray-100 dark:border-gray-700">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="font-bold text-xl text-gray-900 dark:text-gray-100 flex items-center">
                  <MessageCircle className="w-6 h-6 mr-2 text-purple-500" />
                  Configurar Mensagens Padrão
                </h3>
                <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
                  Defina o template de mensagem para cada tipo de sessão.
                </p>
                <div className="bg-gray-50 dark:bg-gray-700/50 p-4 rounded-xl mt-3 text-sm text-gray-600 dark:text-gray-300">
                  <span className="font-bold block mb-2">Variáveis disponíveis (clique para inserir; os valores saem em negrito):</span>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => insertTag('{{sessao}}')} className="inline-flex items-center px-2 py-1.5 rounded-lg bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/60 transition-colors cursor-pointer border border-purple-200 dark:border-purple-800">
                      <code>{`{{sessao}}`}</code><span className="ml-2 text-xs opacity-80 hidden sm:inline">- Nome da sessão</span>
                    </button>
                    <button onClick={() => insertTag('{{horario}}')} className="inline-flex items-center px-2 py-1.5 rounded-lg bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/60 transition-colors cursor-pointer border border-purple-200 dark:border-purple-800">
                      <code>{`{{horario}}`}</code><span className="ml-2 text-xs opacity-80 hidden sm:inline">- Horário de início</span>
                    </button>
                    <button onClick={() => insertTag('{{data}}')} className="inline-flex items-center px-2 py-1.5 rounded-lg bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/60 transition-colors cursor-pointer border border-purple-200 dark:border-purple-800">
                      <code>{`{{data}}`}</code><span className="ml-2 text-xs opacity-80 hidden sm:inline">- Data da escala</span>
                    </button>
                    <button onClick={() => insertTag('{{escalados}}')} className="inline-flex items-center px-2 py-1.5 rounded-lg bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/60 transition-colors cursor-pointer border border-purple-200 dark:border-purple-800">
                      <code>{`{{escalados}}`}</code><span className="ml-2 text-xs opacity-80 hidden sm:inline">- Lista de funções e membros</span>
                    </button>
                  </div>
                </div>
              </div>
              <button onClick={() => setIsMessagesModalOpen(false)} className="text-gray-400 hover:text-gray-600 dark:text-gray-300 dark:hover:text-gray-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 p-2 rounded-full transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-6 max-h-[60vh] overflow-y-auto custom-scrollbar pr-2">
              {SESSOES_DISPONIVEIS.map(sessao => (
                <div key={sessao} className="space-y-2">
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300">
                    Template para: {sessao}
                  </label>
                  <textarea
                    value={messagesForm[sessao] || ''}
                    onChange={(e) => setMessagesForm(prev => ({...prev, [sessao]: e.target.value}))}
                    onSelect={(e) => {
                      lastFocusedRef.current = {
                        sessao,
                        start: (e.target as HTMLTextAreaElement).selectionStart,
                        end: (e.target as HTMLTextAreaElement).selectionEnd
                      };
                    }}
                    onBlur={(e) => {
                      lastFocusedRef.current = {
                        sessao,
                        start: (e.target as HTMLTextAreaElement).selectionStart,
                        end: (e.target as HTMLTextAreaElement).selectionEnd
                      };
                    }}
                    className="w-full h-40 p-4 border border-gray-300 dark:border-gray-600 rounded-2xl bg-gray-50 dark:bg-gray-700/50 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all text-sm custom-scrollbar"
                    placeholder="Digite a mensagem padrão..."
                  />
                  {messagesForm[sessao] && (
                    <div className="p-4 rounded-2xl border border-dashed border-purple-200 dark:border-purple-800/60 bg-white dark:bg-gray-800">
                      <span className="block text-[11px] font-bold uppercase tracking-wide text-purple-600 dark:text-purple-400 mb-2">Prévia (como chega no WhatsApp e no app)</span>
                      <p className="text-sm whitespace-pre-wrap leading-relaxed text-gray-700 dark:text-gray-200">
                        <TextoFormatado texto={preencherTemplate(messagesForm[sessao], {
                          sessao,
                          data: new Date().toLocaleDateString('pt-BR'),
                          horario: '08:00',
                          escalados: FUNCOES_DISPONIVEIS.map(f => `• ${f}: ${negrito('Nome do Técnico')}`).join('\n')
                        })} />
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-3 mt-6 pt-6 border-t border-gray-100 dark:border-gray-700">
              <button 
                onClick={() => setIsMessagesModalOpen(false)}
                className="px-5 py-2.5 font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors"
                disabled={saving}
              >
                Cancelar
              </button>
              <button 
                onClick={handleSaveMessages}
                disabled={saving}
                className="px-5 py-2.5 font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-xl flex items-center shadow-sm transition-colors disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <CheckCircle2 className="w-5 h-5 mr-2" />}
                Salvar Templates
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
};

export default ManageScales;

