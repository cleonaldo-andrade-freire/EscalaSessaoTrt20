import toast from 'react-hot-toast';
import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabaseClient';
import MemberLayout from '../../layouts/MemberLayout';
import { 
  CalendarSearch, 
  History, 
  CheckCircle, 
  Clock, 
  AlertCircle, 
  XCircle, 
  Loader2, 
  ArrowLeftRight, 
  Calendar, 
  UserCheck, 
  Check, 
  Sparkles 
} from 'lucide-react';
import { sendWhatsApp } from '../../services/whatsappService';

interface EscalaItem {
  id: string;
  data: string;
  tipo_sessao: string;
  funcao: string;
  membro_original_id: string;
  membro_substituto_id?: string | null;
  status_substituicao: string;
  justificativa_troca?: string | null;
  membro_original?: { nome: string };
  membro_substituto?: { nome: string };
  jaEscalado?: boolean;
  colegaJaEscalado?: boolean;
}

const MemberSwaps = () => {
  const [activeTab, setActiveTab] = useState<'disponiveis' | 'historico'>('disponiveis');
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState('');
  
  const [escalasDisponiveis, setEscalasDisponiveis] = useState<EscalaItem[]>([]);
  const [meuHistorico, setMeuHistorico] = useState<EscalaItem[]>([]);

  // Accept Modal State & Bilateral Swap
  const [escalaToAccept, setEscalaToAccept] = useState<EscalaItem | null>(null);
  const [isAcceptModalOpen, setIsAcceptModalOpen] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Bilateral Swap states
  const [tipoAceite, setTipoAceite] = useState<'simples' | 'mao_dupla'>('simples');
  const [minhasEscalasParaTroca, setMinhasEscalasParaTroca] = useState<EscalaItem[]>([]);
  const [selectedMinhaEscalaId, setSelectedMinhaEscalaId] = useState<string>('');
  const [loadingMinhasEscalas, setLoadingMinhasEscalas] = useState(false);

  // Cancel Swap Request Modal State
  const [escalaToCancel, setEscalaToCancel] = useState<EscalaItem | null>(null);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    
    setUserId(user.id);
    const hoje = new Date().toISOString().split('T')[0];

    // Minhas escalas futuras (para saber se já estou escalado na sessão)
    const { data: minhasEscalasFuturas } = await supabase
      .from('escalas')
      .select('data, tipo_sessao')
      .or(`membro_original_id.eq.${user.id},membro_substituto_id.eq.${user.id}`)
      .gte('data', hoje)
      .eq('publicada', true);

    // Escalas disponíveis de OUTROS membros para o futuro
    const { data: disponiveis } = await supabase
      .from('escalas')
      .select('*, membro_original:membros!membro_original_id(nome)')
      .eq('status_substituicao', 'Disponível para Troca')
      .gte('data', hoje)
      .neq('membro_original_id', user.id)
      .order('data', { ascending: true });

    // Adiciona flag se o membro já está escalado na mesma sessão
    const disponiveisComFlag = (disponiveis || []).map(escalaDisponivel => {
      const jaEscalado = minhasEscalasFuturas?.some(minhaEscala => 
        minhaEscala.data === escalaDisponivel.data && minhaEscala.tipo_sessao === escalaDisponivel.tipo_sessao
      );
      return { ...escalaDisponivel, jaEscalado };
    });

    // 3. Meu Histórico de permutas (onde pedi troca, ou onde cobri alguém)
    const { data: historico } = await supabase
      .from('escalas')
      .select('*, membro_original:membros!membro_original_id(nome), membro_substituto:membros!membro_substituto_id(nome)')
      .or(`membro_original_id.eq.${user.id},membro_substituto_id.eq.${user.id}`)
      .neq('status_substituicao', 'Nenhum')
      .order('data', { ascending: false });

    setEscalasDisponiveis(disponiveisComFlag);
    setMeuHistorico(historico || []);
    setLoading(false);
  };

  const openAcceptModal = async (escala: EscalaItem) => {
    setEscalaToAccept(escala);
    setIsAcceptModalOpen(true);
    setSuccessMessage('');
    setErrorMessage('');
    setTipoAceite('simples');
    setSelectedMinhaEscalaId('');
    setLoadingMinhasEscalas(true);

    try {
      const hoje = new Date().toISOString().split('T')[0];

      // 1. Buscar minhas escalas futuras ativas para possível contrapartida
      const { data: minhasFuturas, error: errMinhas } = await supabase
        .from('escalas')
        .select('id, data, tipo_sessao, funcao, status_substituicao, membro_original_id, membro_substituto_id')
        .eq('membro_original_id', userId)
        .gte('data', hoje)
        .eq('publicada', true)
        .neq('status_substituicao', 'Substituição Aceita')
        .order('data', { ascending: true });

      if (errMinhas) throw errMinhas;

      // 2. Buscar escalas do colega para checar se ele tem conflito na data da minha escala
      const colegaId = escala.membro_original_id;
      const { data: escalasColega } = await supabase
        .from('escalas')
        .select('data, tipo_sessao')
        .or(`membro_original_id.eq.${colegaId},membro_substituto_id.eq.${colegaId}`)
        .gte('data', hoje)
        .eq('publicada', true)
        .neq('status_substituicao', 'Disponível para Troca');

      // 3. Filtrar escalas que não colidam com a mesma data/sessão da escala que estamos aceitando
      const escalasAptas = (minhasFuturas || [])
        .filter(m => !(m.data === escala.data && m.tipo_sessao === escala.tipo_sessao))
        .map(minhaEscala => {
          const colegaJaEscalado = (escalasColega || []).some(
            ec => ec.data === minhaEscala.data && ec.tipo_sessao === minhaEscala.tipo_sessao
          );
          return {
            ...minhaEscala,
            colegaJaEscalado,
          };
        });

      setMinhasEscalasParaTroca(escalasAptas);
    } catch (err: any) {
      console.error('Erro ao carregar escalas para contrapartida:', err);
    } finally {
      setLoadingMinhasEscalas(false);
    }
  };

  const confirmarAceite = async () => {
    if (!escalaToAccept) return;

    if (tipoAceite === 'mao_dupla' && !selectedMinhaEscalaId) {
      setErrorMessage('Por favor, selecione uma de suas escalas para realizar a permuta de mão dupla.');
      return;
    }

    setAccepting(true);
    setErrorMessage('');

    try {
      const { data: userData } = await supabase.from('membros').select('nome').eq('id', userId).single();
      const userName = userData?.nome?.split(' ')[0] || 'Um membro';
      const colegaNome = escalaToAccept.membro_original?.nome || 'Colega';

      if (tipoAceite === 'simples') {
        // Permuta Simples (Cobertura Unilateral)
        const { error } = await supabase
          .from('escalas')
          .update({
            membro_substituto_id: userId,
            status_substituicao: 'Substituição Aceita',
          })
          .eq('id', escalaToAccept.id);

        if (error) throw error;
        
        setSuccessMessage("Permuta aceita com sucesso!");
        
        // Notificar WhatsApp sobre Permuta Simples
        try {
          const { data: membros } = await supabase
            .from('membros')
            .select('id')
            .neq('id', userId);

          if (membros && membros.length > 0) {
            const membroIds = membros.map((m: any) => m.id);
            const msg = `*Permuta Aceita!* ✅\n\n${userName} aceitou cobrir a escala de ${colegaNome} na função de *${escalaToAccept.funcao}* na sessão *${escalaToAccept.tipo_sessao}* do dia *${escalaToAccept.data.split('-').reverse().join('/')}*.`;
            await sendWhatsApp(membroIds, msg);
          }
        } catch (waErr) {
          console.error('Erro ao enviar notificação whatsapp de permuta simples:', waErr);
        }

      } else {
        // Permuta de Mão Dupla (Troca Bilateral Casada)
        const minhaEscala = minhasEscalasParaTroca.find(e => e.id === selectedMinhaEscalaId);
        if (!minhaEscala) {
          throw new Error('Escala selecionada para contrapartida não foi encontrada.');
        }

        const dataSessaoAceita = `${escalaToAccept.data.split('-').reverse().join('/')} (${escalaToAccept.tipo_sessao})`;
        const dataSessaoMinha = `${minhaEscala.data.split('-').reverse().join('/')} (${minhaEscala.tipo_sessao})`;

        // 1. Atualiza a escala do colega (eu viro o substituto)
        const { error: err1 } = await supabase
          .from('escalas')
          .update({
            membro_substituto_id: userId,
            status_substituicao: 'Substituição Aceita',
            justificativa_troca: `Permuta de mão dupla: troca com a sessão do dia ${dataSessaoMinha}`,
          })
          .eq('id', escalaToAccept.id);

        if (err1) throw err1;

        // 2. Atualiza a minha escala (colega vira o substituto)
        const { error: err2 } = await supabase
          .from('escalas')
          .update({
            membro_substituto_id: escalaToAccept.membro_original_id,
            status_substituicao: 'Substituição Aceita',
            justificativa_troca: `Permuta de mão dupla: troca com a sessão do dia ${dataSessaoAceita}`,
          })
          .eq('id', minhaEscala.id);

        if (err2) throw err2;

        setSuccessMessage("Permuta de mão dupla realizada com sucesso! As duas escalas foram sincronizadas.");

        // Notificar WhatsApp sobre Permuta de Mão Dupla
        try {
          const { data: membros } = await supabase.from('membros').select('id');
          if (membros && membros.length > 0) {
            const membroIds = membros.map((m: any) => m.id);
            const msg = `*Permuta de Mão Dupla Realizada!* 🔄\n\n*${userName}* e *${colegaNome}* realizaram uma troca mútua de escalas:\n\n• *${userName}* cobrirá *${colegaNome}* na sessão *${escalaToAccept.tipo_sessao}* do dia *${escalaToAccept.data.split('-').reverse().join('/')}* (${escalaToAccept.funcao})\n• *${colegaNome}* cobrirá *${userName}* na sessão *${minhaEscala.tipo_sessao}* do dia *${minhaEscala.data.split('-').reverse().join('/')}* (${minhaEscala.funcao})\n\nAmbas as escalas já estão atualizadas no aplicativo!`;
            await sendWhatsApp(membroIds, msg);
          }
        } catch (waErr) {
          console.error('Erro ao enviar notificação whatsapp de mão dupla:', waErr);
        }
      }

      setTimeout(() => {
        setIsAcceptModalOpen(false);
        setSuccessMessage('');
        fetchData();
      }, 2200);
    } catch (err: any) {
      setErrorMessage("Erro ao aceitar permuta: " + err.message);
    } finally {
      setAccepting(false);
    }
  };

  const openCancelModal = (escala: EscalaItem) => {
    setEscalaToCancel(escala);
    setIsCancelModalOpen(true);
  };

  const confirmarCancelamento = async () => {
    if (!escalaToCancel) return;
    setCancelling(true);
    try {
      const { error } = await supabase
        .from('escalas')
        .update({
          status_substituicao: 'Nenhum',
          justificativa_troca: null,
        })
        .eq('id', escalaToCancel.id);

      if (error) throw error;

      setIsCancelModalOpen(false);
      setEscalaToCancel(null);
      fetchData();
    } catch (err: any) {
      toast('Erro ao cancelar solicitação: ' + err.message);
    } finally {
      setCancelling(false);
    }
  };

  const renderDisponiveis = () => {
    if (escalasDisponiveis.length === 0) {
      return (
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-10 shadow-sm border border-gray-100 dark:border-gray-700 text-center flex flex-col items-center">
          <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-4 text-blue-300">
            <CalendarSearch className="w-8 h-8" />
          </div>
          <p className="text-gray-500 dark:text-gray-400 font-medium">Nenhuma escala precisando de cobertura no momento.</p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {escalasDisponiveis.map(escala => (
          <div key={escala.id} className="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm border border-blue-100 dark:border-gray-700 relative overflow-hidden">
             <div className="absolute top-0 right-0 bg-red-500 text-white text-[10px] font-black px-3 py-1 rounded-bl-xl uppercase tracking-wider">
               Precisa de Ajuda
             </div>
             
             <div className="mt-3">
               <p className="text-sm text-gray-500 dark:text-gray-400">Membro Original:</p>
               <p className="font-bold text-gray-900 dark:text-gray-50">{escala.membro_original?.nome}</p>
             </div>
             
             <div className="grid grid-cols-2 gap-4 mt-4 bg-gray-50 dark:bg-gray-700/50 p-3 rounded-xl border border-gray-100 dark:border-gray-700">
                <div>
                  <p className="text-[10px] text-gray-400 font-bold uppercase">Data / Sessão</p>
                  <p className="font-medium text-sm text-blue-900 dark:text-blue-300">{escala.data.split('-').reverse().join('/')}</p>
                  <p className="text-xs text-gray-600 dark:text-gray-300">{escala.tipo_sessao}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 font-bold uppercase">Função</p>
                  <p className="font-medium text-sm text-gray-800 dark:text-gray-100">{escala.funcao}</p>
                </div>
             </div>

             {escala.justificativa_troca && (
               <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-xl border border-yellow-100 dark:border-yellow-800/30 text-sm text-yellow-800 dark:text-yellow-300 italic">
                 "{escala.justificativa_troca}"
               </div>
             )}

             <button 
               onClick={() => openAcceptModal(escala)}
               disabled={escala.jaEscalado}
               className={`w-full mt-4 flex justify-center items-center py-3 font-bold rounded-xl transition-colors ${
                 escala.jaEscalado 
                   ? 'bg-gray-100 text-gray-400 cursor-not-allowed dark:bg-gray-700/50 dark:text-gray-500 border border-gray-200 dark:border-gray-700' 
                   : 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
               }`}
             >
               <CheckCircle className="w-4 h-4 mr-2" />
               {escala.jaEscalado ? 'Você já está nesta sessão' : 'Aceitar Permuta'}
             </button>
          </div>
        ))}
      </div>
    );
  };

  const renderHistorico = () => {
    if (meuHistorico.length === 0) {
      return (
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-10 shadow-sm border border-gray-100 dark:border-gray-700 text-center flex flex-col items-center">
          <div className="w-16 h-16 bg-gray-50 dark:bg-gray-700/50 rounded-full flex items-center justify-center mb-4 text-gray-300">
            <History className="w-8 h-8" />
          </div>
          <p className="text-gray-500 dark:text-gray-400 font-medium">Seu histórico de permutas está vazio.</p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {meuHistorico.map(escala => {
          const fuiEuQuePedi = escala.membro_original_id === userId;
          const isMaoDupla = escala.justificativa_troca?.toLowerCase().includes('mão dupla') || escala.justificativa_troca?.toLowerCase().includes('mao dupla');
          
          const statusColors = {
            'Disponível para Troca': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
            'Substituição Aceita': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
            'Troca Rejeitada': 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
            'Nenhum': 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100'
          }[escala.status_substituicao as string] || 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100';

          return (
            <div key={escala.id} className="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
               <div className="flex justify-between items-start mb-3 gap-2">
                 <div className="flex flex-wrap gap-1.5 items-center">
                   <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-md ${statusColors}`}>
                     {escala.status_substituicao}
                   </span>
                   {isMaoDupla && (
                     <span className="text-[10px] font-black uppercase px-2 py-1 rounded-md bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 inline-flex items-center gap-1">
                       <ArrowLeftRight className="w-3 h-3" /> Mão Dupla
                     </span>
                   )}
                 </div>
                 <div className="text-right shrink-0">
                   <p className="text-xs font-bold text-gray-800 dark:text-gray-100">{escala.data.split('-').reverse().join('/')}</p>
                   <p className="text-[10px] text-gray-500 dark:text-gray-400">{escala.tipo_sessao}</p>
                 </div>
               </div>

               <div className="bg-gray-50 dark:bg-gray-700/50 p-3 rounded-xl border border-gray-100 dark:border-gray-700">
                 <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Como aconteceu</p>
                 {isMaoDupla ? (
                   <p className="text-sm text-gray-700 dark:text-gray-200">
                     {fuiEuQuePedi ? (
                       <>
                         <strong>Permuta casada:</strong> Você passou a função de <strong>{escala.funcao}</strong> para <strong>{escala.membro_substituto?.nome}</strong> em troca mútua.
                       </>
                     ) : (
                       <>
                         <strong>Permuta casada:</strong> Você cobriu <strong>{escala.membro_original?.nome}</strong> em <strong>{escala.funcao}</strong> em troca mútua.
                       </>
                     )}
                   </p>
                 ) : (
                   fuiEuQuePedi ? (
                     <p className="text-sm text-gray-700 dark:text-gray-200">
                       Eu pedi substituição em <strong>{escala.funcao}</strong>.
                       {escala.membro_substituto?.nome ? ` ${escala.membro_substituto.nome} aceitou me cobrir.` : ' Aguardando alguém aceitar.'}
                     </p>
                   ) : (
                     <p className="text-sm text-gray-700 dark:text-gray-200">
                       Eu cobri o(a) <strong>{escala.membro_original?.nome}</strong> na função de <strong>{escala.funcao}</strong>.
                     </p>
                   )
                 )}

                 {escala.justificativa_troca && (
                   <p className="text-xs text-gray-500 dark:text-gray-400 italic mt-2 border-t border-gray-200 dark:border-gray-600 pt-1.5">
                     "{escala.justificativa_troca}"
                   </p>
                 )}
               </div>

               {/* Botão Cancelar: só para quem pediu e ainda está em aberto */}
               {fuiEuQuePedi && escala.status_substituicao === 'Disponível para Troca' && (
                 <button
                   onClick={() => openCancelModal(escala)}
                   className="w-full mt-3 flex justify-center items-center py-2.5 gap-2 text-sm font-bold text-red-600 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 transition-colors"
                 >
                   <XCircle className="w-4 h-4" />
                   Cancelar Solicitação
                 </button>
               )}
            </div>
          );
        })}
      </div>
    );
  };

  const selectedMinhaEscalaObj = minhasEscalasParaTroca.find(e => e.id === selectedMinhaEscalaId);

  return (
    <MemberLayout activeTab="substituicoes">
      <div className="bg-blue-600 px-6 pt-12 pb-24 text-white shadow-md rounded-b-3xl relative">
        <p className="text-blue-100 text-sm font-medium">Permutas de Escala</p>
        <h1 className="text-2xl font-black">Permutas</h1>
      </div>

      <div className="px-5 -mt-16 relative z-10 space-y-4 pb-8">
        
        {/* Toggle Tabs */}
        <div className="bg-white dark:bg-gray-800 p-1 rounded-2xl flex border border-gray-100 dark:border-gray-700 shadow-sm">
          <button 
            className={`flex-1 py-3 text-sm font-bold rounded-xl transition-colors ${activeTab === 'disponiveis' ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}
            onClick={() => setActiveTab('disponiveis')}
          >
            Disponíveis
          </button>
          <button 
            className={`flex-1 py-3 text-sm font-bold rounded-xl transition-colors ${activeTab === 'historico' ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}
            onClick={() => setActiveTab('historico')}
          >
            Meu Histórico
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center p-10">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          activeTab === 'disponiveis' ? renderDisponiveis() : renderHistorico()
        )}

      </div>

      {/* Modal Aceitar Permuta (Simples ou Mão Dupla) */}
      {isAcceptModalOpen && escalaToAccept && (
        <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh] sm:max-h-[85vh] animate-in fade-in zoom-in-95 duration-200 border border-gray-100 dark:border-gray-700">
            
            {/* Header Modal (Fixo no topo) */}
            <div className="shrink-0 p-4 sm:p-5 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-600 text-white rounded-2xl flex items-center justify-center shadow-md shadow-blue-500/20 shrink-0">
                  <ArrowLeftRight className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base sm:text-lg text-gray-900 dark:text-gray-50 leading-tight">Aceitar Permuta</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Escolha o formato da permuta</p>
                </div>
              </div>
              <button 
                onClick={() => !accepting && setIsAcceptModalOpen(false)} 
                className="text-gray-400 hover:text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 p-2 rounded-full transition-colors shadow-sm"
                disabled={accepting}
                title="Fechar"
              >
                ✕
              </button>
            </div>
            
            {/* Conteúdo com Scroll interno */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
              {successMessage ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <div className="w-20 h-20 bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-300 rounded-full flex items-center justify-center mb-4 animate-bounce">
                    <CheckCircle className="w-10 h-10" />
                  </div>
                  <h4 className="text-xl font-bold text-gray-900 dark:text-gray-50 mb-2">Sucesso!</h4>
                  <p className="text-gray-600 dark:text-gray-300 text-sm max-w-xs">{successMessage}</p>
                </div>
              ) : (
                <>
                  {errorMessage && (
                    <div className="p-3.5 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-2xl flex items-start gap-3 shadow-sm">
                      <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                      <p className="text-xs sm:text-sm font-medium text-red-800 dark:text-red-300">{errorMessage}</p>
                    </div>
                  )}

                  {/* 1. Resumo da Escala do Colega */}
                  <div>
                    <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">
                      1. Escala que você vai cobrir
                    </span>
                    <div className="bg-blue-50/70 dark:bg-gray-700/60 p-3.5 rounded-2xl border border-blue-100 dark:border-gray-600">
                      <div className="flex justify-between items-center mb-1.5">
                        <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">
                          Colega: <strong>{escalaToAccept.membro_original?.nome}</strong>
                        </span>
                        <span className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 font-bold px-2 py-0.5 rounded-full">
                          {escalaToAccept.funcao}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-gray-900 dark:text-gray-100 font-bold text-sm sm:text-base">
                        <Calendar className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                        <span>{escalaToAccept.data.split('-').reverse().join('/')}</span>
                        <span className="text-gray-400 font-normal">•</span>
                        <span className="text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-300">{escalaToAccept.tipo_sessao}</span>
                      </div>
                    </div>
                  </div>

                  {/* 2. Seleção do Tipo de Permuta */}
                  <div>
                    <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">
                      2. Como você deseja proceder?
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      
                      {/* Opção 1: Permuta Simples */}
                      <div 
                        onClick={() => setTipoAceite('simples')}
                        className={`cursor-pointer p-3.5 rounded-2xl border-2 transition-all flex flex-col justify-between ${
                          tipoAceite === 'simples'
                            ? 'border-blue-600 bg-blue-50/60 dark:bg-blue-950/40 dark:border-blue-500 shadow-sm'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="w-6 h-6 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 flex items-center justify-center font-bold text-xs">
                            1
                          </div>
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                            tipoAceite === 'simples' ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 dark:border-gray-600'
                          }`}>
                            {tipoAceite === 'simples' && <Check className="w-3 h-3 stroke-[3]" />}
                          </div>
                        </div>
                        <h4 className="font-bold text-sm text-gray-900 dark:text-gray-50 mb-0.5">Apenas Cobrir</h4>
                        <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
                          Você assume a escala por gentileza, sem solicitar troca de volta.
                        </p>
                      </div>

                      {/* Opção 2: Permuta de Mão Dupla */}
                      <div 
                        onClick={() => setTipoAceite('mao_dupla')}
                        className={`cursor-pointer p-3.5 rounded-2xl border-2 transition-all flex flex-col justify-between relative overflow-hidden ${
                          tipoAceite === 'mao_dupla'
                            ? 'border-purple-600 bg-purple-50/60 dark:bg-purple-950/40 dark:border-purple-500 shadow-sm'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="w-6 h-6 rounded-lg bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300 flex items-center justify-center font-bold text-xs">
                            <ArrowLeftRight className="w-3.5 h-3.5" />
                          </div>
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                            tipoAceite === 'mao_dupla' ? 'border-purple-600 bg-purple-600 text-white' : 'border-gray-300 dark:border-gray-600'
                          }`}>
                            {tipoAceite === 'mao_dupla' && <Check className="w-3 h-3 stroke-[3]" />}
                          </div>
                        </div>
                        <h4 className="font-bold text-sm text-gray-900 dark:text-gray-50 mb-0.5 flex items-center gap-1">
                          Mão Dupla
                          <span className="text-[9px] bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300 font-bold px-1.5 py-0.2 rounded">Casada</span>
                        </h4>
                        <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
                          Indique uma escala sua para o colega cobrir você no futuro.
                        </p>
                      </div>

                    </div>
                  </div>

                  {/* 3. Se for Mão Dupla: Seletor de Minhas Escalas */}
                  {tipoAceite === 'mao_dupla' && (
                    <div className="space-y-2.5 pt-2 border-t border-gray-100 dark:border-gray-700">
                      <div className="flex justify-between items-center">
                        <span className="text-[11px] font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider">
                          3. Escolha uma escala sua para troca
                        </span>
                        <span className="text-xs text-gray-400 font-medium">
                          {minhasEscalasParaTroca.length} disponíveis
                        </span>
                      </div>

                      {loadingMinhasEscalas ? (
                        <div className="p-6 text-center text-gray-400">
                          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-purple-600" />
                          <p className="text-xs">Carregando suas escalas futuras...</p>
                        </div>
                      ) : minhasEscalasParaTroca.length === 0 ? (
                        <div className="p-3.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                          <p>
                            Você não possui nenhuma outra escala futura disponível para troca. Você pode aceitar como <strong>"Apenas Cobrir"</strong>.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                          {minhasEscalasParaTroca.map((minhaEscala) => {
                            const isSelected = selectedMinhaEscalaId === minhaEscala.id;
                            const isDisabled = minhaEscala.colegaJaEscalado;

                            return (
                              <div
                                key={minhaEscala.id}
                                onClick={() => !isDisabled && setSelectedMinhaEscalaId(minhaEscala.id)}
                                className={`p-3 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                                  isDisabled
                                    ? 'opacity-50 bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700 cursor-not-allowed'
                                    : isSelected
                                    ? 'border-purple-600 bg-purple-50 dark:bg-purple-950/40 dark:border-purple-500 shadow-sm cursor-pointer'
                                    : 'border-gray-200 dark:border-gray-700 hover:border-purple-300 dark:hover:border-purple-700 bg-white dark:bg-gray-800 cursor-pointer'
                                }`}
                              >
                                <div className="flex items-center gap-3">
                                  <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                                    isSelected ? 'border-purple-600 bg-purple-600 text-white' : 'border-gray-300 dark:border-gray-600'
                                  }`}>
                                    {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span className="font-bold text-xs text-gray-900 dark:text-gray-50">
                                        {minhaEscala.data.split('-').reverse().join('/')}
                                      </span>
                                      <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                        {minhaEscala.tipo_sessao}
                                      </span>
                                    </div>
                                    <p className="text-[11px] text-purple-700 dark:text-purple-300 font-semibold">
                                      Função: {minhaEscala.funcao}
                                    </p>
                                  </div>
                                </div>

                                {isDisabled && (
                                  <span className="text-[10px] text-red-500 bg-red-50 dark:bg-red-900/30 px-2 py-0.5 rounded font-bold shrink-0">
                                    Colega já escalado
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Resumo da Troca Casada */}
                      {selectedMinhaEscalaObj && (
                        <div className="p-3 bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-950/40 dark:to-indigo-950/40 border border-purple-200 dark:border-purple-800/50 rounded-2xl text-xs space-y-1">
                          <p className="font-bold text-purple-900 dark:text-purple-200 flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
                            Acordo de Troca Casada:
                          </p>
                          <div className="text-gray-700 dark:text-gray-300 space-y-0.5 pl-5 text-[11px] sm:text-xs">
                            <p>• <strong>Você</strong> cobre <strong>{escalaToAccept.membro_original?.nome}</strong> em {escalaToAccept.data.split('-').reverse().join('/')} ({escalaToAccept.tipo_sessao})</p>
                            <p>• <strong>{escalaToAccept.membro_original?.nome}</strong> cobrirá <strong>você</strong> em {selectedMinhaEscalaObj.data.split('-').reverse().join('/')} ({selectedMinhaEscalaObj.tipo_sessao})</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-2xl border border-amber-100 dark:border-amber-800/30 text-[11px] sm:text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                    <p>
                      {tipoAceite === 'mao_dupla'
                        ? 'Ao confirmar, ambas as escalas serão sincronizadas e atualizadas automaticamente no aplicativo.'
                        : 'Ao aceitar, você ficará responsável por esta escala e deverá comparecer no dia e horário marcados.'}
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Footer Fixo e Sem Cortes */}
            {!successMessage && (
              <div className="shrink-0 p-4 sm:p-5 border-t border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] flex flex-col-reverse sm:flex-row gap-2.5 sm:gap-3 justify-end items-stretch sm:items-center">
                <button 
                  onClick={() => setIsAcceptModalOpen(false)} 
                  className="w-full sm:w-auto py-3 px-5 font-bold text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 bg-gray-50 dark:bg-gray-700/50 rounded-xl transition-colors text-center border border-gray-200 dark:border-gray-600"
                  disabled={accepting}
                >
                  Cancelar
                </button>
                <button 
                  onClick={confirmarAceite}
                  disabled={accepting || (tipoAceite === 'mao_dupla' && !selectedMinhaEscalaId)}
                  className={`w-full sm:w-auto py-3.5 px-6 font-bold text-sm text-white rounded-xl flex items-center justify-center gap-2 shadow-lg transition-all transform active:scale-98 ${
                    accepting
                      ? 'bg-gray-400 cursor-wait opacity-80'
                      : tipoAceite === 'mao_dupla'
                      ? selectedMinhaEscalaId
                        ? 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 shadow-purple-500/25'
                        : 'bg-purple-400 dark:bg-purple-800/60 cursor-not-allowed opacity-75 shadow-none'
                      : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-blue-500/25'
                  }`}
                >
                  {accepting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Confirmando...
                    </>
                  ) : tipoAceite === 'mao_dupla' ? (
                    selectedMinhaEscalaId ? (
                      <>
                        <ArrowLeftRight className="w-4 h-4" />
                        Confirmar Troca de Mão Dupla
                      </>
                    ) : (
                      'Selecione uma escala acima'
                    )
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      Sim, Aceitar Cobertura
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Cancelar Solicitação de Permuta */}
      {isCancelModalOpen && escalaToCancel && (
        <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-200 border border-gray-100 dark:border-gray-700">
            <div className="shrink-0 p-5 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-red-50/60 dark:bg-red-900/20">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 rounded-2xl flex items-center justify-center shrink-0">
                  <XCircle className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-lg text-gray-900 dark:text-gray-50">Cancelar Solicitação</h3>
              </div>
              <button
                onClick={() => !cancelling && setIsCancelModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-100 p-2 rounded-full transition-colors shadow-sm"
                disabled={cancelling}
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <p className="text-gray-600 dark:text-gray-300 text-sm">
                Tem certeza que deseja cancelar sua solicitação de permuta?
              </p>

              <div className="bg-gray-50 dark:bg-gray-700/50 p-4 rounded-2xl border border-gray-100 dark:border-gray-700 text-sm">
                <div className="grid grid-cols-2 gap-y-3">
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase">Data / Sessão</p>
                    <p className="font-bold text-gray-800 dark:text-gray-100">{escalaToCancel.data.split('-').reverse().join('/')}</p>
                    <p className="text-gray-500 dark:text-gray-400">{escalaToCancel.tipo_sessao}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase">Função</p>
                    <p className="font-bold text-gray-800 dark:text-gray-100">{escalaToCancel.funcao}</p>
                  </div>
                </div>
              </div>

              <div className="bg-red-50 dark:bg-red-900/20 p-3.5 rounded-2xl border border-red-100 dark:border-red-800/30 text-xs text-red-800 dark:text-red-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <p>Sua escala voltará ao status normal e não ficará mais disponível para permuta.</p>
              </div>
            </div>

            <div className="shrink-0 p-4 sm:p-5 border-t border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col-reverse sm:flex-row gap-2.5 sm:gap-3 justify-end items-stretch sm:items-center">
              <button
                onClick={() => setIsCancelModalOpen(false)}
                className="w-full sm:w-auto py-3 px-5 font-bold text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 bg-gray-50 dark:bg-gray-700/50 rounded-xl transition-colors text-center border border-gray-200 dark:border-gray-600"
                disabled={cancelling}
              >
                Voltar
              </button>
              <button
                onClick={confirmarCancelamento}
                disabled={cancelling}
                className="w-full sm:w-auto py-3.5 px-6 font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-red-500/20 transition-all text-sm"
              >
                {cancelling ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Cancelando...
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4" />
                    Sim, Cancelar
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </MemberLayout>
  );
};

export default MemberSwaps;
