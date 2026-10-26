import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabaseClient';
import MemberLayout from '../../layouts/MemberLayout';
import { Calendar, Loader2, Users, AlertTriangle, Send, AlertCircle, X, CheckCircle2, ShieldCheck, History, LogIn, LogOut } from 'lucide-react';
import { Link } from 'react-router-dom';
import { sendWhatsApp } from '../../services/whatsappService';

import { FUNCOES_DISPONIVEIS, MENSAGEM_PADRAO_SESSAO } from '../../constants';
import { registrarCheckin, registrarCheckout } from '../../services/presencaService';
import { getLocalDateStr, formatHora, getHoraAtual, combinarDataHora } from '../../utils/date';
import { negrito, preencherTemplate } from '../../utils/mensagem';

const MemberGeneralSchedule = () => {
  const [escalas, setEscalas] = useState<any[]>([]);
  const [escalasPassadasPendentes, setEscalasPassadasPendentes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [sessaoMensagens, setSessaoMensagens] = useState<any[]>([]);
  const [noticeConfirmation, setNoticeConfirmation] = useState<{isOpen: boolean; scaleGroup: any}>({isOpen: false, scaleGroup: null});
  const [noticeText, setNoticeText] = useState('');
  const [isSendingNotice, setIsSendingNotice] = useState(false);
  const [toast, setToast] = useState<{show: boolean, message: string, type: 'success' | 'error'}>({show: false, message: '', type: 'success'});

  // Check-in Manual (Admin)
  const [showCheckinManualModal, setShowCheckinManualModal] = useState(false);
  const [slotParaCheckin, setSlotParaCheckin] = useState<any | null>(null);
  const [checkinManualLoading, setCheckinManualLoading] = useState(false);
  const [checkinManualHora, setCheckinManualHora] = useState('');

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast(prev => ({ ...prev, show: false }));
    }, 5000);
  };

  const handleOpenNoticeModal = (group: any) => {
    const templateObj = sessaoMensagens.find(c => c.tipo_sessao === group.sessao);
    let text = templateObj ? templateObj.mensagem_padrao : MENSAGEM_PADRAO_SESSAO;
    
    const escaladosList = group.itens.map((slot: any) => {
      const isSub = slot.status_substituicao === 'Substituição Aceita';
      const membro = isSub ? slot.membro_substituto : slot.membro_original;
      return `${slot.funcao}: ${membro ? negrito(membro.nome) : 'Vago'}`;
    }).join('\n');

    let dataObj = new Date(group.data);
    dataObj.setUTCHours(12);
    const dateFormatted = dataObj.toLocaleDateString('pt-BR');

    text = preencherTemplate(text, { sessao: group.sessao, data: dateFormatted, horario: group.hora || '', escalados: escaladosList });
    
    setNoticeText(text);
    setNoticeConfirmation({ isOpen: true, scaleGroup: group });
  };

  const confirmSendNotice = async () => {
    if (!noticeConfirmation.scaleGroup) return;
    setIsSendingNotice(true);
    try {
      const group = noticeConfirmation.scaleGroup;
      const membroIds = group.itens
        .map((slot: any) => {
          const isSub = slot.status_substituicao === 'Substituição Aceita';
          return isSub ? slot.membro_substituto_id : slot.membro_original_id;
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
        titulo: `Lembrete: Sessão ${group.sessao}`,
        mensagem: noticeText,
        created_at: new Date().toISOString(),
        lido: false,
      }));

      const { error: avisoError } = await supabase.from('avisos').insert(avisosInserts);
      if (avisoError) throw avisoError;

      try {
        await sendWhatsApp(uniqueMembroIds, noticeText);
      } catch (waErr) {
        console.error('Erro ao enviar whatsapp:', waErr);
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

  // Agrupa e ordena os itens de uma lista de escalas brutas
  const agruparEscalas = (data: any[]) => {
    const grouped = data.reduce((acc: any, curr: any) => {
      const key = `${curr.data}|${curr.tipo_sessao}`;
      if (!acc[key]) {
        acc[key] = { data: curr.data, sessao: curr.tipo_sessao, hora: curr.hora_inicio?.slice(0, 5) || '', itens: [] };
      }
      acc[key].itens.push(curr);
      return acc;
    }, {});

    return Object.values(grouped).map((group: any) => {
      group.itens.sort((a: any, b: any) => {
        const indexA = FUNCOES_DISPONIVEIS.indexOf(a.funcao);
        const indexB = FUNCOES_DISPONIVEIS.indexOf(b.funcao);
        return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
      });
      return group;
    }).sort((a: any, b: any) => a.data.localeCompare(b.data) || a.hora.localeCompare(b.hora));
  };

  useEffect(() => {
    const carregarEscalas = async () => {
      setLoading(true);
      const hoje = getLocalDateStr();

      // Busca informações do usuário logado
      const { data: { user } } = await supabase.auth.getUser();
      let adminFlag = false;
      if (user) {
        const { data: membro } = await supabase
          .from('membros')
          .select('is_admin')
          .eq('id', user.id)
          .single();
        adminFlag = membro?.is_admin || false;
        setIsAdmin(adminFlag);
      }

      // Busca todas as escalas futuras (apenas publicadas)
      const { data, error } = await supabase
        .from('escalas')
        .select(`
          id, data, hora_inicio, tipo_sessao, funcao, status_substituicao, justificativa_troca, membro_substituto_id, membro_original_id, compareceu, checkin_em, checkout_em,
          membro_original:membros!membro_original_id(nome, foto_url),
          membro_substituto:membros!membro_substituto_id(nome, foto_url)
        `)
        .gte('data', hoje)
        .eq('publicada', true)
        .order('data', { ascending: true });

      if (data) {
        setEscalas(agruparEscalas(data));
      }

      // Se admin, busca também as escalas passadas recentes com check-in pendente (últimos 14 dias)
      if (adminFlag) {
        const { data: mensagens } = await supabase.from('sessao_mensagens').select('*');
        if (mensagens) setSessaoMensagens(mensagens);

        const dataLimite = new Date();
        dataLimite.setDate(dataLimite.getDate() - 14);
        const dataLimiteStr = getLocalDateStr(dataLimite);

        const { data: passadas } = await supabase
          .from('escalas')
          .select(`
            id, data, hora_inicio, tipo_sessao, funcao, status_substituicao, justificativa_troca, membro_substituto_id, membro_original_id, compareceu, checkin_em, checkout_em,
            membro_original:membros!membro_original_id(nome, foto_url),
            membro_substituto:membros!membro_substituto_id(nome, foto_url)
          `)
          .lt('data', hoje)
          .gte('data', dataLimiteStr)
          .eq('publicada', true)
          .or('compareceu.is.null,compareceu.eq.false,checkout_em.is.null')
          .order('data', { ascending: false })
          .limit(100);

        if (passadas && passadas.length > 0) {
          setEscalasPassadasPendentes(agruparEscalas(passadas).reverse());
        }
      }

      setLoading(false);
    };

    carregarEscalas();
  }, []);

  // Abre modal de check-in manual para um slot específico
  const abrirCheckinManual = (slot: any, dataEscala: string, sessaoEscala: string, tipo: 'checkin' | 'checkout') => {
    setCheckinManualHora(getHoraAtual());
    setSlotParaCheckin({ ...slot, dataEscala, sessaoEscala, tipo });
    setShowCheckinManualModal(true);
  };

  // Confirma o check-in / check-out manual (admin) com o horário informado
  const confirmarCheckinManual = async () => {
    if (!slotParaCheckin) return;
    if (!checkinManualHora) {
      showToast('Informe o horário.', 'error');
      return;
    }
    setCheckinManualLoading(true);
    try {
      const slot = slotParaCheckin;
      const isCheckout = slot.tipo === 'checkout';
      const horarioInformado = combinarDataHora(slot.dataEscala, checkinManualHora);
      const horario = isCheckout
        ? await registrarCheckout(slot.id, horarioInformado)
        : await registrarCheckin(slot.id, horarioInformado);

      // Atualiza estado local (tanto escalas futuras quanto passadas)
      const updateSlot = (grupos: any[]) =>
        grupos.map(g => ({
          ...g,
          itens: g.itens.map((i: any) =>
            i.id === slot.id
              ? (isCheckout ? { ...i, checkout_em: horario } : { ...i, compareceu: true, checkin_em: horario })
              : i
          )
        }));

      setEscalas(prev => updateSlot(prev));
      // Para as passadas pendentes, remove grupos onde todos já têm check-in e check-out
      setEscalasPassadasPendentes(prev =>
        updateSlot(prev).filter(g => g.itens.some((i: any) => !i.compareceu || !i.checkout_em))
      );

      setShowCheckinManualModal(false);
      setSlotParaCheckin(null);
      showToast(isCheckout ? `✅ Check-out registrado às ${formatHora(horario)}.` : `✅ Check-in registrado às ${formatHora(horario)}.`);
    } catch (error: any) {
      console.error('Erro ao registrar presença manual:', error);
      showToast(error?.message || 'Erro ao registrar presença. Tente novamente.', 'error');
    } finally {
      setCheckinManualLoading(false);
    }
  };

  // Formatar a data
  const formatData = (dataStr: string) => {
    const dateObj = new Date(dataStr + 'T12:00:00');
    return {
      diaMes: dateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      diaSemana: dateObj.toLocaleDateString('pt-BR', { weekday: 'long' })
    };
  };

  // Renderiza um card de grupo de escala
  const renderGrupoCard = (grupo: any, idx: number, isPast: boolean = false) => {
    const dataFormatada = formatData(grupo.data);
    return (
      <div key={`${isPast ? 'past' : 'future'}-${idx}`} className={`bg-white dark:bg-gray-800 rounded-2xl shadow-lg shadow-gray-200/50 overflow-hidden border ${isPast ? 'border-amber-200 dark:border-amber-800/40' : 'border-gray-100 dark:border-gray-700'} animate-in fade-in slide-in-from-bottom-4`} style={{animationDelay: `${idx * 80}ms`}}>
        {/* Header do Card */}
        <div className={`${isPast ? 'bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/10' : 'bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-gray-700 dark:to-gray-800'} p-4 border-b ${isPast ? 'border-amber-100 dark:border-amber-800/30' : 'border-gray-100 dark:border-gray-600'} flex items-center gap-4`}>
          <div className={`${isPast ? 'bg-amber-500' : 'bg-blue-600'} text-white rounded-xl p-2 text-center min-w-[60px] shadow-sm`}>
            <p className="text-[10px] font-bold uppercase">{dataFormatada.diaSemana.substring(0,3)}</p>
            <p className="text-lg font-black leading-none mt-1">{dataFormatada.diaMes}</p>
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-black text-gray-800 dark:text-gray-100 leading-tight">{grupo.sessao}{grupo.hora && <span className="text-blue-600 dark:text-blue-400"> · {grupo.hora}</span>}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium flex items-center gap-1 mt-1">
              <Calendar className="w-3 h-3" />
              {grupo.itens.length} {grupo.itens.length === 1 ? 'técnico escalado' : 'técnicos escalados'}
              {isPast && <span className="ml-1 text-amber-600 dark:text-amber-400 font-bold">· Passada</span>}
            </p>
          </div>
          {isAdmin && !isPast && (
            <button 
              onClick={() => handleOpenNoticeModal(grupo)}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/50 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 dark:hover:bg-blue-900/40 px-3 py-2 rounded-lg transition-colors shadow-sm flex items-center justify-center whitespace-nowrap"
              title="Notificar Escalados"
            >
              <Send className="w-4 h-4 md:mr-1.5" />
              <span className="hidden md:inline">Criar Aviso</span>
            </button>
          )}
        </div>

        {/* Lista de Membros */}
        <div className="p-2">
          {grupo.itens.map((item: any) => {
            const isDisponivel = item.status_substituicao === 'Disponível para Troca';
            const isPermuta = item.membro_substituto_id !== null && item.status_substituicao === 'Substituição Aceita';
            const jaFezCheckin = item.compareceu === true;
            
            // Define quem é o membro atual da vaga
            let membroAtual = item.membro_original;
            if (isPermuta && item.membro_substituto) {
              membroAtual = item.membro_substituto;
            }

            // Admin pode lançar check-in/check-out manual para sessões de hoje ou passadas
            const sessaoIniciada = grupo.data <= getLocalDateStr();
            const podeCheckinManual = isAdmin && sessaoIniciada && !jaFezCheckin;
            const podeCheckoutManual = isAdmin && sessaoIniciada && jaFezCheckin && !item.checkout_em;

            return (
              <div key={item.id} className={`flex items-center gap-3 p-3 rounded-xl mb-1 ${isDisponivel ? 'bg-red-50/50 border border-red-100' : jaFezCheckin ? 'bg-emerald-50/40 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-800/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors'}`}>
                {/* Foto */}
                <div className="w-12 h-12 rounded-full bg-gray-200 dark:bg-gray-700 border-2 border-white dark:border-gray-600 shadow-sm overflow-hidden flex-shrink-0 flex justify-center items-center font-bold text-gray-500 text-lg">
                   {membroAtual?.foto_url ? (
                     <img src={membroAtual.foto_url} alt={membroAtual.nome} className="w-full h-full object-cover" />
                   ) : (
                     membroAtual?.nome ? membroAtual.nome.charAt(0) : '?'
                   )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className={`text-sm font-bold truncate ${isDisponivel ? 'text-red-700' : jaFezCheckin ? 'text-emerald-700 dark:text-emerald-400' : 'text-gray-900 dark:text-gray-100'}`}>
                      {membroAtual?.nome || 'Desconhecido'}
                    </p>
                    <div className="flex items-center gap-1 flex-shrink-0 ml-1">
                      {jaFezCheckin && (
                        <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold uppercase flex items-center gap-1 border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3" /> {formatHora(item.checkin_em)}{item.checkout_em ? ` – ${formatHora(item.checkout_em)}` : ''}
                        </span>
                      )}
                      {isDisponivel && (
                        <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold uppercase flex items-center gap-1 border border-red-200">
                          <AlertTriangle className="w-3 h-3" /> Precisa de Troca
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mt-0.5">
                    {item.funcao} {isPermuta && (
                      (item.justificativa_troca?.toLowerCase().includes('mão dupla') || item.justificativa_troca?.toLowerCase().includes('mao dupla')) ? (
                        <span className="text-purple-600 dark:text-purple-400 font-bold ml-1">
                          (Permuta casada com {item.membro_original?.nome?.split(' ')[0] || 'colega'})
                        </span>
                      ) : (
                        <span className="text-purple-600 dark:text-purple-400 font-bold ml-1">
                          (Substituto de {item.membro_original?.nome?.split(' ')[0] || 'N/A'})
                        </span>
                      )
                    )}
                  </p>
                  {/* Botões de Check-in / Check-out Manual (admin) */}
                  {podeCheckinManual && (
                    <button
                      onClick={() => abrirCheckinManual(item, grupo.data, grupo.sessao, 'checkin')}
                      className="mt-1.5 flex items-center gap-1.5 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700/40 px-2.5 py-1 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/40 active:scale-95 transition-all"
                    >
                      <LogIn className="w-3 h-3" />
                      Check-in Manual
                    </button>
                  )}
                  {podeCheckoutManual && (
                    <button
                      onClick={() => abrirCheckinManual(item, grupo.data, grupo.sessao, 'checkout')}
                      className="mt-1.5 flex items-center gap-1.5 text-[11px] font-bold text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-700/40 px-2.5 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-900/40 active:scale-95 transition-all"
                    >
                      <LogOut className="w-3 h-3" />
                      Check-out Manual
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <MemberLayout activeTab="home">
      <div className="bg-blue-600 px-6 pt-12 pb-24 rounded-b-3xl text-white shadow-md relative">
        <div className="flex flex-col gap-1">
          <p className="text-blue-100 text-sm font-medium flex items-center gap-2">
            <Link to="/dashboard" className="hover:underline opacity-80">Início</Link> &gt; Escala Geral
          </p>
          <h1 className="text-2xl font-black flex items-center gap-2 mt-1">
            <Users className="w-6 h-6" /> Escala da Equipe
          </h1>
          <p className="text-sm text-blue-100 mt-1 opacity-90">
            Veja os técnicos escalados para as próximas sessões.
          </p>
        </div>
      </div>

      <div className="px-5 -mt-16 relative z-10 space-y-5 pb-8">
        {loading ? (
           <div className="flex justify-center py-12">
             <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
           </div>
        ) : escalas.length > 0 ? (
          <>
            {escalas.map((grupo: any, idx: number) => renderGrupoCard(grupo, idx, false))}

            {/* Seção de escalas passadas com pendências (apenas admin, sempre visível após as futuras) */}
            {isAdmin && escalasPassadasPendentes.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 pt-2">
                  <History className="w-4 h-4 text-amber-600" />
                  <h3 className="text-sm font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wide">Presenças Pendentes (Admin)</h3>
                  <div className="flex-1 h-px bg-amber-200 dark:bg-amber-800/40" />
                </div>
                {escalasPassadasPendentes.map((grupo: any, idx: number) => renderGrupoCard(grupo, idx, true))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="text-center py-10 bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
              <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="font-bold text-gray-700 dark:text-gray-200">Nenhuma escala futura</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">A equipe ainda não foi escalada para os próximos dias.</p>
            </div>

            {/* Quando não há escalas futuras, admin vê as passadas com pendências */}
            {isAdmin && escalasPassadasPendentes.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 pt-2">
                  <History className="w-4 h-4 text-amber-600" />
                  <h3 className="text-sm font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wide">Presenças Pendentes (Admin)</h3>
                  <div className="flex-1 h-px bg-amber-200 dark:bg-amber-800/40" />
                </div>
                {escalasPassadasPendentes.map((grupo: any, idx: number) => renderGrupoCard(grupo, idx, true))}
              </div>
            )}
          </>
        )}
      </div>

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
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <p className="text-gray-600 dark:text-gray-300 text-sm">
                Edite a mensagem do aviso que será enviada para todos os escalados em <strong>{noticeConfirmation.scaleGroup.data.split('-').reverse().join('/')} - {noticeConfirmation.scaleGroup.sessao}</strong>:
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

      {/* Modal de Check-in / Check-out Manual (Admin) */}
      {showCheckinManualModal && slotParaCheckin && (() => {
        const slot = slotParaCheckin;
        const isCheckout = slot.tipo === 'checkout';
        const isPermuta = slot.membro_substituto_id !== null && slot.status_substituicao === 'Substituição Aceita';
        const membroQueServiu = isPermuta ? slot.membro_substituto : slot.membro_original;
        const nomeMembroQueServiu = membroQueServiu?.nome || 'Desconhecido';
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
              <div className="flex justify-between items-center p-5 border-b border-gray-100 dark:border-gray-700 bg-indigo-50/60 dark:bg-indigo-900/20">
                <div className="flex items-center gap-3">
                  <div className="bg-indigo-100 dark:bg-indigo-800/50 p-2 rounded-full text-indigo-600 dark:text-indigo-300">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900 dark:text-gray-50 text-sm">{isCheckout ? 'Check-out Manual' : 'Check-in Manual'}</h3>
                    <p className="text-[11px] text-indigo-600 dark:text-indigo-400 font-semibold">Ação de Administrador</p>
                  </div>
                </div>
                <button
                  onClick={() => !checkinManualLoading && setShowCheckinManualModal(false)}
                  disabled={checkinManualLoading}
                  className="text-gray-400 hover:text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 p-1 rounded-full transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Você está registrando o {isCheckout ? 'check-out' : 'check-in'} de <strong>{nomeMembroQueServiu}</strong>:
                </p>
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 border border-gray-100 dark:border-gray-700 space-y-1.5">
                  <p className="text-sm font-bold text-gray-900 dark:text-gray-100">Sessão {slot.sessaoEscala}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Data: <span className="font-semibold text-gray-700 dark:text-gray-200">{slot.dataEscala?.split('-').reverse().join('/')}</span></p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Função: <span className="font-semibold text-gray-700 dark:text-gray-200">{slot.funcao}</span></p>
                  {isCheckout && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">Check-in: <span className="font-semibold text-gray-700 dark:text-gray-200">{formatHora(slot.checkin_em)}</span></p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5 ml-1">
                    Horário do {isCheckout ? 'check-out' : 'check-in'}
                  </label>
                  <input
                    type="time"
                    value={checkinManualHora}
                    onChange={e => setCheckinManualHora(e.target.value)}
                    className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:text-white"
                  />
                </div>
              </div>

              <div className="p-5 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex gap-3">
                <button
                  onClick={() => setShowCheckinManualModal(false)}
                  disabled={checkinManualLoading}
                  className="flex-1 py-2.5 px-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-bold rounded-xl hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmarCheckinManual}
                  disabled={checkinManualLoading}
                  className="flex-1 py-2.5 px-4 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 active:bg-indigo-800 transition-colors flex justify-center items-center gap-2"
                >
                  {checkinManualLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Registrando...
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      {isCheckout ? 'Confirmar Check-out' : 'Confirmar Check-in'}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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

export default MemberGeneralSchedule;
