import toast from 'react-hot-toast';
import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabaseClient';
import MemberLayout from '../../layouts/MemberLayout';
import { Calendar, Clock, AlertTriangle, ArrowRightCircle, History, X, Loader2, CheckCircle2, Trash2, ArrowLeftRight, LogIn, LogOut } from 'lucide-react';
import { getGreeting } from '../../utils/greeting';
import { Link } from 'react-router-dom';
import { sendWhatsApp } from '../../services/whatsappService';
import { registrarCheckin, registrarCheckout } from '../../services/presencaService';
import { getLocalDateStr, formatHora, formatDuracao } from '../../utils/date';

const MemberDashboard = () => {
  const [userName, setUserName] = useState('');
  const [userFoto, setUserFoto] = useState('');
  const [userId, setUserId] = useState('');
  const [proximasEscalas, setProximasEscalas] = useState<any[]>([]);
  const [historicoEscalas, setHistoricoEscalas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal State
  const [showSubstituicaoModal, setShowSubstituicaoModal] = useState(false);
  const [escalaIdParaSubstituicao, setEscalaIdParaSubstituicao] = useState<string | null>(null);
  const [motivoSubstituicao, setMotivoSubstituicao] = useState('');
  const [substituicaoLoading, setSubstituicaoLoading] = useState(false);
  const [modalError, setModalError] = useState('');
  const [showCheckinModal, setShowCheckinModal] = useState(false);
  const [escalaIdParaCheckin, setEscalaIdParaCheckin] = useState<string | null>(null);
  const [tipoPresenca, setTipoPresenca] = useState<'checkin' | 'checkout'>('checkin');
  const [checkinLoading, setCheckinLoading] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState('');

  // Cancelar Solicitação de Permuta
  const [showCancelarPermutaModal, setShowCancelarPermutaModal] = useState(false);
  const [escalaIdParaCancelar, setEscalaIdParaCancelar] = useState<string | null>(null);
  const [cancelandoPermuta, setCelandoPermuta] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        setUserId(user.id);
        // Busca os stats reais do membro
        const { data: membro } = await supabase
          .from('membros')
          .select('nome, foto_url')
          .eq('id', user.id)
          .single();

        if (membro) {
          setUserName(membro.nome.split(' ')[0]); // Pega o primeiro nome
          setUserFoto(membro.foto_url || '');
        }

        const hoje = getLocalDateStr();
        
        // Busca TODAS as próximas escalas dele (A partir de hoje, apenas publicadas)
        const { data: escalas } = await supabase
          .from('escalas')
          .select('*')
          .gte('data', hoje)
          .eq('publicada', true)
          // Traz onde ele é o original (e não foi substituído) OU onde ele é o substituto
          .or(`and(membro_original_id.eq.${user.id},status_substituicao.neq.Substituição Aceita),membro_substituto_id.eq.${user.id}`)
          .order('data', { ascending: true })
          .order('hora_inicio', { ascending: true });

        if (escalas) {
          const formatadas = escalas.map(escala => {
            const dateObj = new Date(escala.data + 'T12:00:00');
            const euSouSubstituto = escala.membro_substituto_id === user.id;
            return {
              id: escala.id,
              dataOriginal: escala.data,
              data: dateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
              dia_semana: dateObj.toLocaleDateString('pt-BR', { weekday: 'long' }),
              sessao: escala.tipo_sessao,
              hora: escala.hora_inicio?.slice(0, 5) || '',
              funcao: escala.funcao,
              status_substituicao: escala.status_substituicao,
              justificativa_troca: escala.justificativa_troca,
              compareceu: escala.compareceu,
              checkin_em: escala.checkin_em,
              checkout_em: escala.checkout_em,
              // Flags para controle de exibição dos botões
              euSouSubstituto,
              euSouOriginalSubstituido: escala.status_substituicao === 'Substituição Aceita' && !euSouSubstituto
            };
          });
          setProximasEscalas(formatadas);
        }

        // Busca o Histórico de escalas passadas (Menor que hoje, apenas publicadas)
        const { data: historicoData } = await supabase
          .from('escalas')
          .select('*, membro_original:membros!membro_original_id(nome), membro_substituto:membros!membro_substituto_id(nome)')
          .lt('data', hoje)
          .eq('publicada', true)
          .or(`membro_original_id.eq.${user.id},membro_substituto_id.eq.${user.id}`)
          .order('data', { ascending: false });

        if (historicoData) {
          setHistoricoEscalas(historicoData);
        }
      }
      
      setLoading(false);
    };

    loadData();
  }, []);

  const registrarPresenca = async (escalaId: string, tipo: 'checkin' | 'checkout') => {
    setCheckinLoading(escalaId);
    setSuccessMessage('');
    try {
      const horario = tipo === 'checkout'
        ? await registrarCheckout(escalaId)
        : await registrarCheckin(escalaId);

      setProximasEscalas(prev =>
        prev.map(e => e.id === escalaId
          ? (tipo === 'checkout' ? { ...e, checkout_em: horario } : { ...e, compareceu: true, checkin_em: horario })
          : e)
      );

      setSuccessMessage(tipo === 'checkout'
        ? `Check-out registrado às ${formatHora(horario)}. Obrigado!`
        : `Check-in registrado às ${formatHora(horario)}. Bom trabalho!`);
      setTimeout(() => setSuccessMessage(''), 4000);
    } catch (error: any) {
      console.error('Erro ao registrar presença:', error);
      toast.error(error?.message || 'Erro ao registrar presença. Tente novamente.');
    } finally {
      setCheckinLoading(null);
    }
  };

  const abrirModalCheckin = (escalaId: string, tipo: 'checkin' | 'checkout') => {
    setEscalaIdParaCheckin(escalaId);
    setTipoPresenca(tipo);
    setShowCheckinModal(true);
  };

  const confirmarCheckin = async () => {
    if (!escalaIdParaCheckin) return;
    setShowCheckinModal(false);
    await registrarPresenca(escalaIdParaCheckin, tipoPresenca);
  };

  // Função para abrir modal de substituição
  const abrirModalSubstituicao = (escalaId: string) => {
    setEscalaIdParaSubstituicao(escalaId);
    setMotivoSubstituicao('');
    setModalError('');
    setShowSubstituicaoModal(true);
  };

  const confirmarSubstituicao = async () => {
    if (!motivoSubstituicao.trim()) {
      setModalError("É necessário informar um motivo para pedir substituição.");
      return;
    }

    if (!escalaIdParaSubstituicao) return;

    setSubstituicaoLoading(true);
    setModalError('');

    const { error } = await supabase
      .from('escalas')
      .update({ 
        status_substituicao: 'Disponível para Troca',
        justificativa_troca: motivoSubstituicao
      })
      .eq('id', escalaIdParaSubstituicao);
      
    setSubstituicaoLoading(false);

    if (!error) {
      setProximasEscalas(prev => 
        prev.map(e => e.id === escalaIdParaSubstituicao ? { ...e, status_substituicao: 'Disponível para Troca' } : e)
      );
      setShowSubstituicaoModal(false);

      // Notificar os demais membros via WhatsApp sobre a nova solicitação de permuta
      try {
        const { data: membros } = await supabase
          .from('membros')
          .select('id')
          .eq('ativo', true)
          .neq('id', userId);

        if (membros && membros.length > 0) {
          const membroIds = membros.map((m: any) => m.id);
          const escala = proximasEscalas.find(e => e.id === escalaIdParaSubstituicao);
          
          if (escala) {
            const msg = `*Nova Solicitação de Permuta* 🔄\n\n${userName} precisa de substituição na função de *${escala.funcao}* na sessão *${escala.sessao}* do dia *${escala.data}*.\n\n*Motivo:* ${motivoSubstituicao}\n\nAcesse o aplicativo para aceitar a permuta!`;
            await sendWhatsApp(membroIds, msg);
          }
        }
      } catch (waErr) {
        console.error('Erro ao enviar notificação whatsapp de permuta:', waErr);
      }
    } else {
      setModalError("Erro ao pedir substituição. Tente novamente.");
    }
  };

  // Função para cancelar solicitação de permuta
  const abrirModalCancelarPermuta = (escalaId: string) => {
    setEscalaIdParaCancelar(escalaId);
    setShowCancelarPermutaModal(true);
  };

  const confirmarCancelamentoPermuta = async () => {
    if (!escalaIdParaCancelar) return;
    setCelandoPermuta(true);
    try {
      const { error } = await supabase
        .from('escalas')
        .update({
          status_substituicao: 'Nenhum',
          justificativa_troca: null,
        })
        .eq('id', escalaIdParaCancelar);

      if (error) throw error;

      setProximasEscalas(prev =>
        prev.map(e =>
          e.id === escalaIdParaCancelar
            ? { ...e, status_substituicao: 'Nenhum' }
            : e
        )
      );
      setShowCancelarPermutaModal(false);
      setEscalaIdParaCancelar(null);
    } catch (error) {
      console.error('Erro ao cancelar solicitação de permuta:', error);
      toast.error('Erro ao cancelar solicitação. Tente novamente.');
    } finally {
      setCelandoPermuta(false);
    }
  };

  return (
    <MemberLayout activeTab="home">
      <div className="bg-blue-600 px-6 pt-12 pb-24 rounded-b-3xl text-white shadow-md relative">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-blue-100 text-sm font-medium">Olá, {getGreeting().toLowerCase()}!</p>
            <h1 className="text-2xl font-black">{loading ? '...' : userName}</h1>
          </div>
          <div className="w-12 h-12 bg-white dark:bg-gray-800/20 rounded-full flex items-center justify-center backdrop-blur-sm border border-white/30 font-bold text-lg overflow-hidden shadow-inner">
             {userFoto ? (
               <img src={userFoto} alt={userName} className="w-full h-full object-cover" />
             ) : (
               userName ? userName.charAt(0) : ''
             )}
          </div>
        </div>
      </div>

      <div className="px-5 -mt-16 relative z-10 space-y-5 pb-8">
        
        {successMessage && (
          <div className="bg-green-100 border border-green-200 text-green-800 px-4 py-3 rounded-xl flex items-center justify-between shadow-sm animate-in fade-in slide-in-from-top-4">
            <div className="flex items-center">
              <CheckCircle2 className="w-5 h-5 mr-2 text-green-600" />
              <span className="text-sm font-bold">{successMessage}</span>
            </div>
            <button onClick={() => setSuccessMessage('')} className="text-green-600 hover:text-green-800">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Suas Próximas Escalas */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg shadow-gray-200/50 p-5 border border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-3 mb-3">
            <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 flex items-center">
              <Calendar className="w-4 h-4 mr-1.5 text-blue-600" />
              Suas Próximas Escalas
            </h2>
          </div>

          {loading ? (
            <div className="animate-pulse h-24 bg-gray-100 dark:bg-gray-700 rounded-xl"></div>
          ) : proximasEscalas.length > 0 ? (
            <div className="space-y-4">
              {proximasEscalas.map((escala, idx) => (
                <div key={escala.id} className={`${idx !== proximasEscalas.length - 1 ? 'border-b border-gray-50 pb-4' : ''}`}>
                  <div className="flex flex-wrap gap-1.5 items-center justify-between mb-3">
                    <div className="flex flex-wrap gap-1.5 items-center">
                      {escala.status_substituicao === 'Disponível para Troca' ? (
                        <span className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 text-[10px] font-black uppercase px-2 py-1 rounded-md">
                          Aguardando Substituto
                        </span>
                      ) : (
                        <span className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 text-[10px] font-black uppercase px-2 py-1 rounded-md">
                          Confirmado
                        </span>
                      )}
                      {escala.euSouSubstituto && (
                        (escala.justificativa_troca?.toLowerCase().includes('mão dupla') || escala.justificativa_troca?.toLowerCase().includes('mao dupla')) ? (
                          <span className="bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 text-[10px] font-black uppercase px-2 py-1 rounded-md inline-flex items-center gap-1">
                            <ArrowLeftRight className="w-2.5 h-2.5" /> Permuta Casada
                          </span>
                        ) : (
                          <span className="bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300 text-[10px] font-black uppercase px-2 py-1 rounded-md">
                            Cobertura
                          </span>
                        )
                      )}
                    </div>
                  </div>

                  <div className="flex items-end gap-3 mb-4">
                    <div className="bg-blue-50 text-blue-700 rounded-xl p-3 text-center min-w-[70px] border border-blue-100">
                      <p className="text-xs font-semibold uppercase">{escala.dia_semana.substring(0,3)}</p>
                      <p className="text-xl font-black">{escala.data}</p>
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900 dark:text-gray-50 text-lg leading-tight">{escala.sessao}</h3>
                      {escala.hora && <p className="text-sm font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Início às {escala.hora}</p>}
                      <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">{escala.funcao}</p>
                    </div>
                  </div>

                  {/* Guarda de segurança: oculta tudo se este usuário foi substituído (é o original com permuta aceita) */}
                  {escala.euSouOriginalSubstituido ? (
                    <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 flex items-center justify-center gap-2 text-sm text-gray-400 border border-gray-100 dark:border-gray-700">
                      <CheckCircle2 className="w-4 h-4" />
                      Você foi substituído nesta escala
                    </div>
                  ) : escala.compareceu ? (
                    <div className="mb-4 space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-3 border border-green-100 dark:border-green-800/40 text-center">
                          <p className="text-[10px] font-bold uppercase text-green-700 dark:text-green-400 flex items-center justify-center gap-1"><LogIn className="w-3 h-3" /> Check-in</p>
                          <p className="text-lg font-black text-green-800 dark:text-green-300">{formatHora(escala.checkin_em)}</p>
                        </div>
                        <div className={`rounded-xl p-3 border text-center ${escala.checkout_em ? 'bg-slate-50 dark:bg-slate-900/20 border-slate-200 dark:border-slate-700' : 'bg-gray-50 dark:bg-gray-700/40 border-dashed border-gray-200 dark:border-gray-600'}`}>
                          <p className="text-[10px] font-bold uppercase text-slate-600 dark:text-slate-300 flex items-center justify-center gap-1"><LogOut className="w-3 h-3" /> Check-out</p>
                          <p className="text-lg font-black text-slate-700 dark:text-slate-200">{formatHora(escala.checkout_em)}</p>
                        </div>
                      </div>
                      {escala.checkout_em ? (
                        <p className="text-center text-xs font-bold text-gray-500 dark:text-gray-400 flex items-center justify-center gap-1">
                          <Clock className="w-3.5 h-3.5" /> Tempo de suporte: {formatDuracao(escala.checkin_em, escala.checkout_em)}
                        </p>
                      ) : escala.dataOriginal === getLocalDateStr() ? (
                        <button
                          onClick={() => abrirModalCheckin(escala.id, 'checkout')}
                          disabled={checkinLoading === escala.id}
                          className="w-full flex justify-center items-center py-3 bg-slate-700 border-2 border-slate-800 text-white font-bold rounded-xl hover:bg-slate-800 active:bg-slate-900 transition-colors"
                        >
                          {checkinLoading === escala.id ? (
                            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                          ) : (
                            <LogOut className="w-5 h-5 mr-2" />
                          )}
                          Fazer Check-out
                        </button>
                      ) : null}
                    </div>
                  ) : escala.dataOriginal === getLocalDateStr() ? (
                    <button
                      onClick={() => abrirModalCheckin(escala.id, 'checkin')}
                      disabled={checkinLoading === escala.id}
                      className="w-full flex justify-center items-center py-3 bg-green-600 border-2 border-green-700 text-white font-bold rounded-xl hover:bg-green-700 active:bg-green-800 transition-colors mb-4"
                    >
                      {checkinLoading === escala.id ? (
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      ) : (
                        <LogIn className="w-5 h-5 mr-2" />
                      )}
                      Fazer Check-in
                    </button>
                  ) : null}

                  {/* Botão de substituição: apenas para quem é o participante ativo e não foi substituído */}
                  {!escala.euSouOriginalSubstituido && escala.status_substituicao !== 'Disponível para Troca' && !escala.compareceu && (
                    <button 
                      onClick={() => abrirModalSubstituicao(escala.id)}
                      className="w-full flex justify-center items-center py-3 bg-white dark:bg-gray-800 border-2 border-red-100 text-red-600 font-bold rounded-xl hover:bg-red-50 active:bg-red-100 transition-colors"
                    >
                      <AlertTriangle className="w-4 h-4 mr-2" />
                      Preciso ser substituído
                    </button>
                  )}

                  {/* Botão para cancelar solicitação de permuta */}
                  {!escala.euSouOriginalSubstituido && escala.status_substituicao === 'Disponível para Troca' && (
                    <button 
                      onClick={() => abrirModalCancelarPermuta(escala.id)}
                      className="w-full flex justify-center items-center py-3 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 font-bold rounded-xl hover:bg-gray-50 active:bg-gray-100 transition-colors text-sm"
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Cancelar Solicitação
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
             <div className="text-center py-6 text-gray-500 dark:text-gray-400">
               <p className="font-medium text-gray-700 dark:text-gray-200 mb-1">Escala Livre!</p>
               <p className="text-sm">Você não tem escalas programadas para os próximos dias.</p>
             </div>
          )}
          
          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
             <Link to="/escalas-geral" className="w-full flex items-center justify-center gap-2 py-3 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-bold rounded-xl hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors">
               Ver Escala Completa da Equipe
               <ArrowRightCircle className="w-4 h-4" />
             </Link>
          </div>
        </div>

        {/* Seu Histórico de Escalas */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg shadow-gray-200/50 p-5 border border-gray-100 dark:border-gray-700">
          <div className="flex items-center border-b border-gray-100 dark:border-gray-700 pb-3 mb-3">
            <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 flex items-center">
              <History className="w-4 h-4 mr-1.5 text-blue-600" />
              Histórico de Escalas
            </h2>
          </div>
          
          {loading ? (
             <div className="animate-pulse h-24 bg-gray-100 dark:bg-gray-700 rounded-xl"></div>
          ) : historicoEscalas.length > 0 ? (
            <div className="space-y-3">
              {historicoEscalas.map(escala => {
                const isPermuta = escala.membro_substituto_id !== null && escala.status_substituicao === 'Substituição Aceita';
                const euFuiSubstituto = escala.membro_substituto_id === userId;
                
                return (
                  <div key={escala.id} className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 border border-gray-100 dark:border-gray-700 relative overflow-hidden">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-1.5">
                        {isPermuta ? (
                          <span className="bg-purple-100 text-purple-800 text-[9px] font-black uppercase px-2 py-1 rounded-md inline-flex items-center">
                            Permuta
                          </span>
                        ) : (
                          <span className="bg-green-100 text-green-800 text-[9px] font-black uppercase px-2 py-1 rounded-md inline-flex items-center">
                            Regular
                          </span>
                        )}
                        {escala.compareceu === true && (
                          <span className="bg-emerald-100 text-emerald-700 text-[9px] font-black uppercase px-2 py-1 rounded-md inline-flex items-center gap-1">
                            <CheckCircle2 className="w-2.5 h-2.5" /> Presente
                          </span>
                        )}
                        {escala.compareceu === false && (
                          <span className="bg-red-100 text-red-700 text-[9px] font-black uppercase px-2 py-1 rounded-md inline-flex items-center">
                            Falta
                          </span>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-bold text-gray-800 dark:text-gray-100">{escala.data.split('-').reverse().join('/')}</p>
                      </div>
                    </div>
                    
                    <div>
                      <h3 className="font-bold text-gray-900 dark:text-gray-50 text-sm">{escala.tipo_sessao}{escala.hora_inicio && <span className="font-medium text-gray-500 dark:text-gray-400"> · {escala.hora_inicio.slice(0, 5)}</span>}</h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-2">Função: <span className="text-gray-700 dark:text-gray-200">{escala.funcao}</span></p>
                      {escala.checkin_em && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-2 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatHora(escala.checkin_em)} – {formatHora(escala.checkout_em)}
                          {escala.checkout_em && <span className="ml-1">({formatDuracao(escala.checkin_em, escala.checkout_em)})</span>}
                        </p>
                      )}
                      
                      {isPermuta && (
                        <div className="bg-white dark:bg-gray-800 p-2 rounded-lg border border-purple-100 text-xs text-gray-600 dark:text-gray-300">
                          {euFuiSubstituto ? (
                            <p>Eu cobri o(a) <strong className="text-purple-700">{escala.membro_original?.nome}</strong></p>
                          ) : (
                            <p>Eu fui coberto(a) por <strong className="text-purple-700">{escala.membro_substituto?.nome}</strong></p>
                          )}
                        </div>
                      )}

                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
             <div className="text-center py-6 text-gray-500 dark:text-gray-400">
               <p className="font-medium text-gray-700 dark:text-gray-200 mb-1">Nenhum histórico</p>
               <p className="text-xs">Você ainda não tem escalas passadas registradas.</p>
             </div>
          )}
        </div>

      </div>

      {/* Modal de Substituição */}
      {showSubstituicaoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center p-5 border-b border-gray-100 dark:border-gray-700 bg-red-50/50">
              <div className="flex items-center gap-3">
                <div className="bg-red-100 p-2 rounded-full text-red-600">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-gray-900 dark:text-gray-50">Pedir Substituição</h3>
              </div>
              <button 
                onClick={() => setShowSubstituicaoModal(false)}
                className="text-gray-400 hover:text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 dark:bg-gray-700 p-1 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Tem certeza que deseja pedir substituição? A escala ficará amarela no painel e visível para os outros membros pegarem a vaga.
              </p>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
                  Motivo da substituição <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={motivoSubstituicao}
                  onChange={(e) => setMotivoSubstituicao(e.target.value)}
                  placeholder="Informe o motivo (será visível para quem for pegar a escala)..."
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none resize-none h-24 transition-all"
                />
                {modalError && (
                  <p className="text-red-500 text-xs mt-1 font-medium">{modalError}</p>
                )}
              </div>
            </div>

            <div className="p-5 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex gap-3">
              <button
                onClick={() => setShowSubstituicaoModal(false)}
                className="flex-1 py-2.5 px-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-bold rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 dark:bg-gray-700/50 active:bg-gray-100 dark:bg-gray-700 transition-colors"
                disabled={substituicaoLoading}
              >
                Cancelar
              </button>
              <button
                onClick={confirmarSubstituicao}
                disabled={substituicaoLoading}
                className="flex-1 py-2.5 px-4 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 active:bg-red-800 transition-colors flex justify-center items-center gap-2"
              >
                {substituicaoLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processando...
                  </>
                ) : (
                  'Confirmar Pedido'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Check-in */}
      {showCheckinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center p-5 border-b border-gray-100 dark:border-gray-700 bg-green-50/50">
              <div className="flex items-center gap-3">
                <div className="bg-green-100 p-2 rounded-full text-green-600">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-gray-900 dark:text-gray-50">{tipoPresenca === 'checkout' ? 'Confirmar Check-out' : 'Confirmar Check-in'}</h3>
              </div>
              <button 
                onClick={() => setShowCheckinModal(false)}
                className="text-gray-400 hover:text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 dark:bg-gray-700 p-1 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {tipoPresenca === 'checkout'
                  ? 'Confirma o encerramento do seu suporte nesta sessão? O horário atual será registrado como check-out.'
                  : 'Confirma sua chegada para o suporte desta sessão? O horário atual será registrado como check-in.'}
              </p>
            </div>

            <div className="p-5 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex gap-3">
              <button
                onClick={() => setShowCheckinModal(false)}
                className="flex-1 py-2.5 px-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-bold rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 dark:bg-gray-700/50 active:bg-gray-100 dark:bg-gray-700 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarCheckin}
                className="flex-1 py-2.5 px-4 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 active:bg-green-800 transition-colors flex justify-center items-center gap-2"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Cancelar Solicitação de Permuta */}
      {showCancelarPermutaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center p-5 border-b border-gray-100 dark:border-gray-700 bg-gray-50/80">
              <div className="flex items-center gap-3">
                <div className="bg-gray-200 dark:bg-gray-700 p-2 rounded-full text-gray-600 dark:text-gray-300">
                  <Trash2 className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-gray-900 dark:text-gray-50">Cancelar Solicitação</h3>
              </div>
              <button 
                onClick={() => !cancelandoPermuta && setShowCancelarPermutaModal(false)}
                className="text-gray-400 hover:text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 dark:bg-gray-700 p-1 rounded-full transition-colors"
                disabled={cancelandoPermuta}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Tem certeza que deseja cancelar sua solicitação de substituição? A escala voltará ao status normal e não estará mais disponível para outros membros pegarem.
              </p>
            </div>

            <div className="p-5 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex gap-3">
              <button
                onClick={() => setShowCancelarPermutaModal(false)}
                className="flex-1 py-2.5 px-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-bold rounded-xl hover:bg-gray-50 transition-colors"
                disabled={cancelandoPermuta}
              >
                Voltar
              </button>
              <button
                onClick={confirmarCancelamentoPermuta}
                disabled={cancelandoPermuta}
                className="flex-1 py-2.5 px-4 bg-gray-700 dark:bg-gray-600 text-white font-bold rounded-xl hover:bg-gray-800 active:bg-gray-900 transition-colors flex justify-center items-center gap-2"
              >
                {cancelandoPermuta ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Cancelando...
                  </>
                ) : (
                  'Sim, Cancelar Pedido'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

    </MemberLayout>
  );
};

export default MemberDashboard;
