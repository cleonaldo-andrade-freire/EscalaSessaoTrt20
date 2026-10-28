import React, { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, useSensor, useSensors, useDraggable, useDroppable,
  type DragStartEvent, type DragEndEvent
} from '@dnd-kit/core';
import { ChevronLeft, ChevronRight, X, Lock, Send, Trash2, Loader2, CalendarCheck, AlertTriangle, ArrowRightLeft, MoveRight, Download } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { sendWhatsApp } from '../services/whatsappService';
import { buscarSessoesTRT, SessaoTRT } from '../services/trtSessoesService';
import { SESSOES_DISPONIVEIS, FUNCOES_DISPONIVEIS, LEMBRETE_ANTECEDENCIA_MIN, HORA_PADRAO_SESSAO } from '../constants';
import { getLocalDateStr } from '../utils/date';
import { negrito } from '../utils/mensagem';

// ---------------------------------------------------------------------------
// Montador da escala mensal: o admin escolhe sessão + técnico e clica nos dias
// do mês para marcar/desmarcar. Cada marcação é gravada como rascunho
// (escalas.publicada = false), invisível para os técnicos e ignorada pelo
// lembrete automático, até o admin publicar o mês — momento em que cada
// técnico recebe um aviso (app e, opcionalmente, WhatsApp) com seus dias.
// Uma marcação pode ser arrastada para outro dia: se o dia já tem a mesma
// sessão, os dois técnicos trocam; senão, a escala só muda de dia. Mexer em
// escala publicada pede confirmação e avisa os técnicos afetados.
// "Importar sessões do TRT" traz as sessões presenciais do calendário público
// do tribunal para public.sessoes_previstas; elas aparecem como "a preencher"
// e viram escala quando o admin escolhe o técnico.
// ---------------------------------------------------------------------------

interface MembroResumo {
  id: string;
  nome: string;
  ativo?: boolean;
}

interface EscalaMes {
  id: string;
  data: string;
  hora_inicio: string;
  tipo_sessao: string;
  funcao: string;
  membro_original_id: string;
  membro_substituto_id: string | null;
  publicada: boolean;
  compareceu: boolean | null;
  status_substituicao: string;
}

interface Prevista {
  id: string;
  data: string;
  tipo_sessao: string;
  hora_inicio: string;
  descricao: string | null;
}

// Item da prévia de importação
type ItemImportacao = SessaoTRT & { situacao: 'nova' | 'atualizada' | 'igual' | 'escalada' };

type Destino =
  | { tipo: 'mesmo' }
  | { tipo: 'bloqueado'; motivo: string }
  | { tipo: 'mover' }
  | { tipo: 'trocar'; alvo: EscalaMes };

// Arrasto: só inicia após mover alguns pixels (mouse) ou segurar (toque),
// para o clique no dia continuar marcando/desmarcando
const Arrastavel: React.FC<{ id: string; disabled: boolean; children: React.ReactNode }> = ({ id, disabled, children }) => {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id, disabled });
  return (
    <span
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`block ${disabled ? '' : 'cursor-grab active:cursor-grabbing'} ${isDragging ? 'opacity-30' : ''}`}
    >
      {children}
    </span>
  );
};

const Soltavel: React.FC<{ id: string; children: (isOver: boolean, ref: (el: HTMLElement | null) => void) => React.ReactNode }> = ({ id, children }) => {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <>{children(isOver, setNodeRef)}</>;
};

interface MonthlyScaleBuilderProps {
  mesInicial: string; // YYYY-MM
  membros: MembroResumo[];
  onClose: () => void;
}

const CAMPOS_ESCALA = 'id, data, hora_inicio, tipo_sessao, funcao, membro_original_id, membro_substituto_id, publicada, compareceu, status_substituicao';

// Presença registrada ou troca em andamento: não pode ser arrastada
const travada = (e: EscalaMes) => e.compareceu !== null || e.status_substituicao !== 'Nenhum';
// Quem atende de fato após permuta aceita (null = o próprio titular)
const substitutoAceito = (e: EscalaMes) =>
  e.status_substituicao === 'Substituição Aceita' ? e.membro_substituto_id : null;

const CORES_SESSAO: Record<string, { chip: string; dot: string; tab: string }> = {
  '1ª Turma': { chip: 'bg-blue-900 text-white border-blue-300 dark:bg-blue-800 dark:border-blue-400', dot: 'bg-blue-900 dark:bg-blue-400', tab: 'bg-blue-900 text-white dark:bg-blue-700' },
  '2ª Turma': { chip: 'bg-emerald-700 text-white border-emerald-300 dark:bg-emerald-800 dark:border-emerald-400', dot: 'bg-emerald-600 dark:bg-emerald-400', tab: 'bg-emerald-700 text-white dark:bg-emerald-700' },
  'Pleno': { chip: 'bg-amber-400 text-amber-950 border-amber-700 dark:bg-amber-500', dot: 'bg-amber-400', tab: 'bg-amber-400 text-amber-950' },
};
const COR_PADRAO = { chip: 'bg-gray-700 text-white border-gray-400', dot: 'bg-gray-400', tab: 'bg-gray-700 text-white' };

const SIGLA_SESSAO: Record<string, string> = { '1ª Turma': '1ª T', '2ª Turma': '2ª T', 'Pleno': 'Pleno' };

const ordemSessao = (s: string) => {
  const i = SESSOES_DISPONIVEIS.indexOf(s);
  return i === -1 ? 999 : i;
};

const deslocarMes = (mes: string, delta: number) => {
  const [ano, m] = mes.split('-').map(Number);
  const d = new Date(ano, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const primeiroNome = (nome?: string) => nome?.split(' ')[0] || '—';

const iniciais = (nome: string) =>
  nome.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();

const formatDiaCurto = (data: string) =>
  new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }).format(new Date(data + 'T12:00:00'));

const MonthlyScaleBuilder: React.FC<MonthlyScaleBuilderProps> = ({ mesInicial, membros, onClose }) => {
  const [mes, setMes] = useState(mesInicial);
  const [sessao, setSessao] = useState(SESSOES_DISPONIVEIS[0]);
  const [funcao, setFuncao] = useState(FUNCOES_DISPONIVEIS[0]);
  const [membroId, setMembroId] = useState('');
  // Horário de início por sessão; começa no padrão e o admin pode mudar
  const [horas, setHoras] = useState<Record<string, string>>(
    () => Object.fromEntries(SESSOES_DISPONIVEIS.map(s => [s, HORA_PADRAO_SESSAO]))
  );
  const [visao, setVisao] = useState<'sessao' | 'todas'>('sessao');

  const [arrastando, setArrastando] = useState<EscalaMes | null>(null);
  const [movPendente, setMovPendente] = useState<{ origem: EscalaMes; data: string; alvo?: EscalaMes } | null>(null);
  const arrastouRef = useRef(false);
  const sensores = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } })
  );

  const [escalas, setEscalas] = useState<EscalaMes[]>([]);
  const [previstas, setPrevistas] = useState<Prevista[]>([]);
  const [importacao, setImportacao] = useState<{ itens: ItemImportacao[]; remover: Prevista[] } | null>(null);
  const [importando, setImportando] = useState(false);
  const [ausencias, setAusencias] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState(true);
  const [diasSalvando, setDiasSalvando] = useState<Set<string>>(new Set());

  const [confirmPublicar, setConfirmPublicar] = useState(false);
  const [confirmDescartar, setConfirmDescartar] = useState(false);
  const [enviarWhatsApp, setEnviarWhatsApp] = useState(true);
  const [processando, setProcessando] = useState(false);

  const hoje = getLocalDateStr();
  const hora = horas[sessao] || '';
  const membrosAtivos = membros.filter(m => m.ativo !== false);
  const nomeMembro = (id: string) => membros.find(m => m.id === id)?.nome || 'Técnico';
  const nomeMes = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(mes + '-01T12:00:00'));
  const nomeMesTitulo = nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1);


  const carregarMes = async (isAtual: () => boolean = () => true) => {
    setLoading(true);
    const [ano, m] = mes.split('-').map(Number);
    const inicio = getLocalDateStr(new Date(ano, m - 1, 1));
    const fim = getLocalDateStr(new Date(ano, m, 0));

    const [escRes, ausRes, prevRes] = await Promise.all([
      supabase.from('escalas').select(CAMPOS_ESCALA).gte('data', inicio).lte('data', fim),
      // Períodos que tocam o mês
      supabase.from('ausencias_programadas').select('membro_id, data_inicio, data_fim, motivo').lte('data_inicio', fim).gte('data_fim', inicio),
      supabase.from('sessoes_previstas').select('id, data, tipo_sessao, hora_inicio, descricao').gte('data', inicio).lte('data', fim),
    ]);
    if (!isAtual()) return;

    if (escRes.error) toast.error('Erro ao carregar escalas: ' + escRes.error.message);
    setEscalas((escRes.data as EscalaMes[]) || []);
    setPrevistas(((prevRes.data as Prevista[]) || []).map(p => ({ ...p, hora_inicio: p.hora_inicio.slice(0, 5) })));

    const mapa: Record<string, Record<string, string>> = {};
    ausRes.data?.forEach((a: any) => {
      const motivo = a.motivo?.trim() || 'Motivo não informado';
      const ultimo = a.data_fim < fim ? a.data_fim : fim;
      for (let d = new Date((a.data_inicio > inicio ? a.data_inicio : inicio) + 'T12:00:00'); getLocalDateStr(d) <= ultimo; d.setDate(d.getDate() + 1)) {
        (mapa[a.membro_id] ||= {})[getLocalDateStr(d)] = motivo;
      }
    });
    setAusencias(mapa);
    setLoading(false);
  };

  useEffect(() => {
    let atual = true;
    carregarMes(() => atual);
    return () => { atual = false; };
  }, [mes]);

  const porSlot = useMemo(() => {
    const mapa: Record<string, EscalaMes> = {};
    escalas.forEach(e => { mapa[`${e.data}|${e.tipo_sessao}|${e.funcao}`] = e; });
    return mapa;
  }, [escalas]);

  const porDia = useMemo(() => {
    const mapa: Record<string, EscalaMes[]> = {};
    escalas.forEach(e => { (mapa[e.data] ||= []).push(e); });
    return mapa;
  }, [escalas]);

  const previstaPorSessao = useMemo(() => {
    const mapa: Record<string, Prevista> = {};
    previstas.forEach(p => { mapa[`${p.data}|${p.tipo_sessao}`] = p; });
    return mapa;
  }, [previstas]);

  // Sessão prevista ainda sem nenhuma escala (de qualquer função) no dia
  const temEscalaNaSessao = (data: string, tipo: string) => (porDia[data] || []).some(e => e.tipo_sessao === tipo);
  const aPreencher = previstas.filter(p => p.data >= hoje && !temEscalaNaSessao(p.data, p.tipo_sessao));

  const diasPorMembro = useMemo(() => {
    const cont: Record<string, number> = {};
    escalas.forEach(e => { cont[e.membro_original_id] = (cont[e.membro_original_id] || 0) + 1; });
    return cont;
  }, [escalas]);

  const rascunhos = escalas.filter(e => !e.publicada);
  const rascunhosAPublicar = rascunhos
    .filter(e => e.data >= hoje)
    .sort((a, b) => (a.data + a.hora_inicio).localeCompare(b.data + b.hora_inicio));

  const rascunhosPorMembro = useMemo(() => {
    const grupos: Record<string, EscalaMes[]> = {};
    rascunhosAPublicar.forEach(e => { (grupos[e.membro_original_id] ||= []).push(e); });
    return grupos;
  }, [rascunhosAPublicar]);

  const marcarSalvando = (data: string, ativo: boolean) => {
    setDiasSalvando(prev => {
      const novo = new Set(prev);
      if (ativo) novo.add(data); else novo.delete(data);
      return novo;
    });
  };

  // sessaoAlvo: clique numa sessão "a preencher" de outra sessão (visão "todas")
  const handleClickDia = async (data: string, sessaoAlvo: string = sessao) => {
    if (arrastouRef.current || data < hoje || diasSalvando.has(data)) return;

    // Sessão importada do TRT já traz o horário do dia
    const hora = previstaPorSessao[`${data}|${sessaoAlvo}`]?.hora_inicio || horas[sessaoAlvo] || '';
    const atual = porSlot[`${data}|${sessaoAlvo}|${funcao}`];
    if (atual?.publicada) {
      toast('Escala publicada: arraste-a para outro dia ou use "Editar Sessão".', { icon: '🔒' });
      return;
    }
    if (!membroId) {
      toast.error('Para marcar dias, escolha um técnico acima. Para mover uma marcação, segure e arraste.');
      return;
    }

    const desmarcar = atual?.membro_original_id === membroId;
    if (!desmarcar) {
      const motivo = ausencias[membroId]?.[data];
      if (motivo) {
        toast.error(`${primeiroNome(nomeMembro(membroId))} tem ausência programada neste dia: ${motivo}`);
        return;
      }
      if (!hora) {
        toast.error('Informe o horário de início da sessão.');
        return;
      }
    }

    marcarSalvando(data, true);
    try {
      if (atual && desmarcar) {
        setEscalas(prev => prev.filter(e => e.id !== atual.id));
        const { error } = await supabase.from('escalas').delete().eq('id', atual.id);
        if (error) {
          setEscalas(prev => [...prev, atual]);
          throw error;
        }
      } else if (atual) {
        const alterado = { ...atual, membro_original_id: membroId, hora_inicio: hora };
        setEscalas(prev => prev.map(e => (e.id === atual.id ? alterado : e)));
        const { error } = await supabase
          .from('escalas')
          .update({ membro_original_id: membroId, hora_inicio: hora })
          .eq('id', atual.id);
        if (error) {
          setEscalas(prev => prev.map(e => (e.id === atual.id ? atual : e)));
          throw error;
        }
      } else {
        const { data: nova, error } = await supabase
          .from('escalas')
          .insert({
            data,
            hora_inicio: hora,
            tipo_sessao: sessaoAlvo,
            funcao,
            membro_original_id: membroId,
            status_substituicao: 'Nenhum',
            publicada: false,
          })
          .select(CAMPOS_ESCALA)
          .single();
        if (error) throw error;
        setEscalas(prev => [...prev, nova as EscalaMes]);
      }
    } catch (err: any) {
      console.error('Erro ao salvar rascunho da escala:', err);
      toast.error('Não foi possível salvar: ' + err.message);
    } finally {
      marcarSalvando(data, false);
    }
  };

  const montarMensagem = (id: string, itens: EscalaMes[]) => {
    const linhas = itens
      .map(e => `• ${negrito(formatDiaCurto(e.data))} — ${e.tipo_sessao}, às ${negrito(e.hora_inicio.slice(0, 5))}`)
      .join('\n');
    return `Olá, ${primeiroNome(nomeMembro(id))}! 📅

A escala de suporte às sessões de ${negrito(nomeMes)} foi publicada. Seus dias:

${linhas}

⏰ Você receberá um lembrete ${LEMBRETE_ANTECEDENCIA_MIN} minutos antes de cada sessão. Confira os detalhes no app.

Bom trabalho!`;
  };

  const handlePublicar = async () => {
    if (rascunhosAPublicar.length === 0) return;
    setProcessando(true);
    try {
      const ids = rascunhosAPublicar.map(e => e.id);
      const { error } = await supabase.from('escalas').update({ publicada: true }).in('id', ids);
      if (error) throw error;
      setEscalas(prev => prev.map(e => (ids.includes(e.id) ? { ...e, publicada: true } : e)));

      const mensagens = Object.entries(rascunhosPorMembro).map(([id, itens]) => ({ id, texto: montarMensagem(id, itens) }));

      const { error: avisoError } = await supabase.from('avisos').insert(
        mensagens.map(m => ({ membro_id: m.id, titulo: `Escala de ${nomeMesTitulo} publicada`, mensagem: m.texto, lido: false }))
      );

      let falhasWhatsApp = 0;
      if (enviarWhatsApp) {
        for (const m of mensagens) {
          try {
            await sendWhatsApp([m.id], m.texto);
          } catch (whatsErr) {
            console.error('Erro ao enviar WhatsApp:', whatsErr);
            falhasWhatsApp++;
          }
        }
      }

      if (avisoError) {
        toast.error('Escala publicada, mas houve erro ao criar os avisos no app: ' + avisoError.message);
      } else if (falhasWhatsApp > 0) {
        toast.error(`Escala publicada, mas ${falhasWhatsApp} WhatsApp(s) não foram enviados.`);
      } else {
        toast.success(`Escala publicada! ${mensagens.length} técnico(s) avisado(s).`);
      }
      setConfirmPublicar(false);
    } catch (err: any) {
      console.error('Erro ao publicar escala:', err);
      toast.error('Erro ao publicar: ' + err.message);
    } finally {
      setProcessando(false);
    }
  };

  const handleDescartar = async () => {
    setProcessando(true);
    try {
      const ids = rascunhos.map(e => e.id);
      const { error } = await supabase.from('escalas').delete().in('id', ids);
      if (error) throw error;
      setEscalas(prev => prev.filter(e => !ids.includes(e.id)));
      toast.success('Rascunhos descartados.');
      setConfirmDescartar(false);
    } catch (err: any) {
      toast.error('Erro ao descartar: ' + err.message);
    } finally {
      setProcessando(false);
    }
  };

  // ---- Arrastar e soltar ----------------------------------------------------

  const avaliarDestino = (origem: EscalaMes, data: string): Destino => {
    if (data === origem.data) return { tipo: 'mesmo' };
    if (data < hoje) return { tipo: 'bloqueado', motivo: 'Dia já passou' };

    const motivoOrigem = ausencias[origem.membro_original_id]?.[data];
    if (motivoOrigem) return { tipo: 'bloqueado', motivo: `${primeiroNome(nomeMembro(origem.membro_original_id))} ausente: ${motivoOrigem}` };

    const alvo = porSlot[`${data}|${origem.tipo_sessao}|${origem.funcao}`];
    if (!alvo) return { tipo: 'mover' };

    if (travada(alvo)) return { tipo: 'bloqueado', motivo: `${primeiroNome(nomeMembro(alvo.membro_original_id))} já tem presença ou troca registrada` };
    const motivoAlvo = ausencias[alvo.membro_original_id]?.[origem.data];
    if (motivoAlvo) return { tipo: 'bloqueado', motivo: `${primeiroNome(nomeMembro(alvo.membro_original_id))} ausente em ${formatDiaCurto(origem.data)}: ${motivoAlvo}` };
    return { tipo: 'trocar', alvo };
  };

  const handleDragStart = (ev: DragStartEvent) => {
    setArrastando(escalas.find(e => e.id === ev.active.id) || null);
  };

  const handleDragEnd = (ev: DragEndEvent) => {
    // Evita que o "click" disparado ao soltar marque/desmarque o dia
    arrastouRef.current = true;
    setTimeout(() => { arrastouRef.current = false; }, 50);

    const origem = arrastando;
    setArrastando(null);
    if (!origem || !ev.over) return;

    const data = String(ev.over.id);
    const destino = avaliarDestino(origem, data);
    if (destino.tipo === 'mesmo') return;
    if (destino.tipo === 'bloqueado') {
      toast.error(destino.motivo);
      return;
    }

    const alvo = destino.tipo === 'trocar' ? destino.alvo : undefined;
    if (origem.publicada || alvo?.publicada) {
      setMovPendente({ origem, data, alvo });
    } else {
      aplicarMovimento(origem, data, alvo);
    }
  };

  const mensagemMudanca = (membro: string, sessaoEsc: string, de: string, para: string, horaPara: string, trocaCom?: string) =>
    `Olá, ${primeiroNome(nomeMembro(membro))}! 🔄

Sua escala de suporte na sessão ${negrito(sessaoEsc)} foi alterada:
de ${negrito(formatDiaCurto(de))} para ${negrito(formatDiaCurto(para))}, às ${negrito(horaPara.slice(0, 5))}${trocaCom ? ` (troca com ${nomeMembro(trocaCom)})` : ''}.

Confira os detalhes no app.`;

  // Move a escala para outro dia ou, havendo a mesma sessão no destino, troca
  // os técnicos (cada um leva junto o status de publicada da sua escala).
  const aplicarMovimento = async (origem: EscalaMes, data: string, alvo?: EscalaMes) => {
    setProcessando(true);
    marcarSalvando(origem.data, true);
    marcarSalvando(data, true);
    const avisar: { membro: string; texto: string }[] = [];
    try {
      if (!alvo) {
        const { error } = await supabase.from('escalas').update({ data, lembrete_enviado_em: null }).eq('id', origem.id);
        if (error) throw error;
        setEscalas(prev => prev.map(e => (e.id === origem.id ? { ...e, data } : e)));
        if (origem.publicada) {
          avisar.push({ membro: origem.membro_original_id, texto: mensagemMudanca(origem.membro_original_id, origem.tipo_sessao, origem.data, data, origem.hora_inicio) });
        }
      } else {
        const { error: e1 } = await supabase
          .from('escalas')
          .update({ membro_original_id: alvo.membro_original_id, publicada: alvo.publicada, lembrete_enviado_em: null })
          .eq('id', origem.id);
        if (e1) throw e1;
        const { error: e2 } = await supabase
          .from('escalas')
          .update({ membro_original_id: origem.membro_original_id, publicada: origem.publicada, lembrete_enviado_em: null })
          .eq('id', alvo.id);
        if (e2) {
          // Desfaz a primeira metade para não deixar o mesmo técnico nos dois dias
          await supabase.from('escalas')
            .update({ membro_original_id: origem.membro_original_id, publicada: origem.publicada })
            .eq('id', origem.id);
          throw e2;
        }
        setEscalas(prev => prev.map(e => {
          if (e.id === origem.id) return { ...e, membro_original_id: alvo.membro_original_id, publicada: alvo.publicada };
          if (e.id === alvo.id) return { ...e, membro_original_id: origem.membro_original_id, publicada: origem.publicada };
          return e;
        }));
        if (origem.publicada) {
          avisar.push({ membro: origem.membro_original_id, texto: mensagemMudanca(origem.membro_original_id, origem.tipo_sessao, origem.data, alvo.data, alvo.hora_inicio, alvo.membro_original_id) });
        }
        if (alvo.publicada) {
          avisar.push({ membro: alvo.membro_original_id, texto: mensagemMudanca(alvo.membro_original_id, alvo.tipo_sessao, alvo.data, origem.data, origem.hora_inicio, origem.membro_original_id) });
        }
      }

      if (avisar.length > 0) {
        const { error: avisoError } = await supabase.from('avisos').insert(
          avisar.map(a => ({ membro_id: a.membro, titulo: 'Sua escala foi alterada', mensagem: a.texto, lido: false }))
        );
        let falhasWhatsApp = 0;
        if (enviarWhatsApp) {
          for (const a of avisar) {
            try {
              await sendWhatsApp([a.membro], a.texto);
            } catch (whatsErr) {
              console.error('Erro ao enviar WhatsApp:', whatsErr);
              falhasWhatsApp++;
            }
          }
        }
        if (avisoError) toast.error('Escala alterada, mas houve erro ao criar o aviso no app: ' + avisoError.message);
        else if (falhasWhatsApp > 0) toast.error(`Escala alterada, mas ${falhasWhatsApp} WhatsApp(s) não foram enviados.`);
        else toast.success(`Escala ${alvo ? 'trocada' : 'movida'} e ${avisar.length === 1 ? 'técnico avisado' : 'técnicos avisados'}.`);
      } else {
        toast.success(alvo ? 'Técnicos trocados.' : 'Escala movida.');
      }
      setMovPendente(null);
    } catch (err: any) {
      console.error('Erro ao mover escala:', err);
      toast.error('Não foi possível alterar: ' + err.message);
      carregarMes();
    } finally {
      marcarSalvando(origem.data, false);
      marcarSalvando(data, false);
      setProcessando(false);
    }
  };

  // Marcação dentro do dia: sessão + horário na 1ª linha, técnico na 2ª
  const renderMarcacao = (e: EscalaMes, cores: string, esmaecido: boolean) => (
    <Arrastavel
      key={e.id}
      id={e.id}
      disabled={e.data < hoje || travada(e) || processando || diasSalvando.has(e.data)}
    >
      {conteudoMarcacao(e, cores, esmaecido)}
    </Arrastavel>
  );

  // Com permuta aceita mostra quem atende (substituto) e sinaliza a troca
  const conteudoMarcacao = (e: EscalaMes, cores: string, esmaecido: boolean) => {
    const substituto = substitutoAceito(e);
    const quem = substituto
      ? `${nomeMembro(substituto)} (no lugar de ${nomeMembro(e.membro_original_id)})`
      : nomeMembro(e.membro_original_id);
    return (
      <span
        className={`block rounded-md px-1 sm:px-1.5 py-0.5 sm:py-1 border leading-tight ${cores} ${e.publicada ? '' : 'border-dashed'} ${esmaecido ? 'opacity-30' : ''}`}
        title={`${e.tipo_sessao} · ${quem} · ${e.hora_inicio.slice(0, 5)} · ${e.publicada ? 'publicada' : 'rascunho'}`}
      >
        <span className="flex items-center gap-1 text-[9px] sm:text-[10px] font-medium opacity-85">
          {e.publicada && <Lock className="w-2.5 h-2.5 shrink-0" />}
          <span className="truncate"><span className="sm:hidden">{SIGLA_SESSAO[e.tipo_sessao] || e.tipo_sessao}</span><span className="hidden sm:inline">{e.tipo_sessao}</span></span>
          <span className="hidden md:inline ml-auto shrink-0">{e.hora_inicio.slice(0, 5)}</span>
        </span>
        <span className="flex items-center gap-1 text-[10px] sm:text-[11px] font-bold">
          <span className="truncate">{primeiroNome(nomeMembro(substituto || e.membro_original_id))}</span>
          {substituto && <ArrowRightLeft className="w-3 h-3 shrink-0" />}
        </span>
      </span>
    );
  };

  // Lê o calendário do TRT e monta a prévia (só datas de hoje em diante)
  const handleImportarTRT = async () => {
    setImportando(true);
    try {
      const [ano, m] = mes.split('-').map(Number);
      const inicio = getLocalDateStr(new Date(ano, m - 1, 1));
      const fim = getLocalDateStr(new Date(ano, m, 0));
      const sessoes = (await buscarSessoesTRT(inicio, fim)).filter(s => s.data >= hoje);

      const itens: ItemImportacao[] = sessoes.map(s => {
        const prevista = previstaPorSessao[`${s.data}|${s.tipo_sessao}`];
        const situacao = temEscalaNaSessao(s.data, s.tipo_sessao) ? 'escalada'
          : !prevista ? 'nova'
          : prevista.hora_inicio !== s.hora_inicio || prevista.descricao !== s.descricao ? 'atualizada'
          : 'igual';
        return { ...s, situacao };
      });
      // Previstas futuras que saíram do calendário do TRT (sessão cancelada/remarcada)
      const chaves = new Set(sessoes.map(s => `${s.data}|${s.tipo_sessao}`));
      const remover = previstas.filter(p => p.data >= hoje && !chaves.has(`${p.data}|${p.tipo_sessao}`));

      if (itens.length === 0 && remover.length === 0) {
        toast(`Nenhuma sessão presencial a partir de hoje em ${nomeMesTitulo} no calendário do TRT.`, { icon: 'ℹ️' });
        return;
      }
      setImportacao({ itens, remover });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setImportando(false);
    }
  };

  const confirmarImportacao = async () => {
    if (!importacao) return;
    setProcessando(true);
    try {
      const gravar = importacao.itens.filter(i => i.situacao !== 'igual');
      if (gravar.length > 0) {
        const { error } = await supabase.from('sessoes_previstas').upsert(
          gravar.map(({ data, tipo_sessao, hora_inicio, descricao }) => ({ data, tipo_sessao, hora_inicio, descricao })),
          { onConflict: 'data,tipo_sessao' }
        );
        if (error) throw error;
      }
      if (importacao.remover.length > 0) {
        const { error } = await supabase.from('sessoes_previstas').delete().in('id', importacao.remover.map(p => p.id));
        if (error) throw error;
      }
      const novas = importacao.itens.filter(i => i.situacao === 'nova').length;
      toast.success(`Calendário do TRT importado: ${novas} sessão(ões) nova(s).`);
      setImportacao(null);
      await carregarMes();
    } catch (err: any) {
      console.error('Erro ao importar sessões do TRT:', err);
      toast.error('Não foi possível importar: ' + err.message);
    } finally {
      setProcessando(false);
    }
  };

  const descartarPrevista = async (p: Prevista) => {
    setPrevistas(prev => prev.filter(x => x.id !== p.id));
    const { error } = await supabase.from('sessoes_previstas').delete().eq('id', p.id);
    if (error) {
      setPrevistas(prev => [...prev, p]);
      toast.error('Não foi possível descartar: ' + error.message);
    }
  };

  // Sessão do TRT ainda sem técnico: clique (com técnico escolhido) preenche
  const renderPrevista = (p: Prevista) => (
    <span
      key={p.id}
      onClick={ev => {
        ev.stopPropagation();
        setSessao(p.tipo_sessao);
        if (membroId) handleClickDia(p.data, p.tipo_sessao);
        else toast('Escolha o técnico acima e clique na sessão para escalá-lo.', { icon: '👆' });
      }}
      title={`${p.tipo_sessao} às ${p.hora_inicio} · a preencher${p.descricao ? `\nTRT: ${p.descricao}` : ''}`}
      className="group/prev block rounded-md px-1 sm:px-1.5 py-0.5 sm:py-1 border border-dashed border-gray-400 dark:border-gray-500 bg-white/70 dark:bg-gray-800/70 text-gray-600 dark:text-gray-300 leading-tight cursor-pointer hover:border-blue-500 hover:text-blue-700 dark:hover:text-blue-300"
    >
      <span className="flex items-center gap-1 text-[9px] sm:text-[10px] font-medium">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${(CORES_SESSAO[p.tipo_sessao] || COR_PADRAO).dot}`} />
        <span className="truncate"><span className="sm:hidden">{SIGLA_SESSAO[p.tipo_sessao] || p.tipo_sessao}</span><span className="hidden sm:inline">{p.tipo_sessao}</span></span>
        <span className="hidden md:inline ml-auto shrink-0">{p.hora_inicio}</span>
        <button
          onClick={ev => { ev.stopPropagation(); descartarPrevista(p); }}
          title="Descartar esta sessão prevista"
          className="hidden sm:group-hover/prev:inline-flex shrink-0 text-gray-400 hover:text-red-600"
        >
          <X className="w-3 h-3" />
        </button>
      </span>
      <span className="block truncate text-[10px] sm:text-[11px] font-bold italic">a preencher</span>
    </span>
  );

  const renderCalendario = () => {
    const [ano, m] = mes.split('-').map(Number);
    const primeiroDiaSemana = new Date(ano, m - 1, 1).getDay();
    const totalDias = new Date(ano, m, 0).getDate();
    const celulas: (number | null)[] = [
      ...Array(primeiroDiaSemana).fill(null),
      ...Array.from({ length: totalDias }, (_, i) => i + 1),
    ];
    const cor = CORES_SESSAO[sessao] || COR_PADRAO;

    return (
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden">
        <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
          {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(d => (
            <div key={d} className="py-2 text-center text-[11px] sm:text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {celulas.map((dia, i) => {
            if (!dia) return <div key={`vazio-${i}`} className="border-b border-r border-gray-100 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/40" />;

            const data = `${mes}-${String(dia).padStart(2, '0')}`;
            const diaSemana = (primeiroDiaSemana + dia - 1) % 7;
            const passado = data < hoje;
            const salvando = diasSalvando.has(data);
            const slot = porSlot[`${data}|${sessao}|${funcao}`];
            const doSelecionado = !!slot && slot.membro_original_id === membroId;
            const motivoAusencia = membroId ? ausencias[membroId]?.[data] : undefined;
            const outrasSessoes = (porDia[data] || []).filter(e => e.tipo_sessao !== sessao);
            const prevista = !passado && !slot ? previstaPorSessao[`${data}|${sessao}`] : undefined;
            const previstasDoDia = passado ? [] : previstas.filter(p => p.data === data && !temEscalaNaSessao(data, p.tipo_sessao));
            const tecnicoEmOutraSessao = membroId ? outrasSessoes.find(e => e.membro_original_id === membroId) : undefined;
            const bloqueado = passado || slot?.publicada || (!!motivoAusencia && !doSelecionado);

            return (
              <Soltavel key={data} id={data}>
              {(isOver, ref) => {
              const destino = arrastando && isOver ? avaliarDestino(arrastando, data) : null;
              const realceDestino =
                destino?.tipo === 'mover' ? 'ring-2 ring-inset ring-green-500 bg-green-50 dark:bg-green-900/20'
                : destino?.tipo === 'trocar' ? 'ring-2 ring-inset ring-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : destino?.tipo === 'bloqueado' ? 'ring-2 ring-inset ring-red-500 bg-red-50 dark:bg-red-900/20'
                : '';
              return (
              <div
                ref={ref}
                role="button"
                tabIndex={passado ? -1 : 0}
                aria-disabled={passado}
                onClick={() => handleClickDia(data)}
                onKeyDown={ev => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    handleClickDia(data);
                  }
                }}
                title={motivoAusencia ? `Ausência programada: ${motivoAusencia}` : undefined}
                className={`group relative min-h-[68px] sm:min-h-[96px] p-1 sm:p-2 border-b border-r border-gray-100 dark:border-gray-700 text-left flex flex-col gap-1 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
                  passado
                    ? 'bg-gray-50 dark:bg-gray-800/40 opacity-45 cursor-not-allowed'
                    : bloqueado
                      ? 'cursor-not-allowed'
                      : 'cursor-pointer hover:bg-blue-50/70 dark:hover:bg-gray-700/60'
                } ${!passado && (diaSemana === 0 || diaSemana === 6) ? 'bg-gray-50/70 dark:bg-gray-800/60' : ''} ${
                  motivoAusencia && !passado ? 'bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgba(245,158,11,0.16)_6px_12px)]' : ''
                } ${realceDestino}`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs sm:text-sm font-bold ${data === hoje ? 'bg-blue-600 text-white rounded-full w-6 h-6 grid place-items-center' : 'text-gray-700 dark:text-gray-200'}`}>{dia}</span>
                  <span className="flex gap-0.5">
                    {visao === 'sessao' && outrasSessoes.map(e => (
                      <span
                        key={e.id}
                        className={`w-1.5 h-1.5 rounded-full ${(CORES_SESSAO[e.tipo_sessao] || COR_PADRAO).dot}`}
                        title={`${e.tipo_sessao}: ${nomeMembro(substitutoAceito(e) || e.membro_original_id)}`}
                      />
                    ))}
                  </span>
                </div>

                {salvando ? (
                  <Loader2 className="w-4 h-4 animate-spin text-blue-500 mx-auto mt-1" />
                ) : visao === 'todas' ? (
                  <>
                    {[...(porDia[data] || [])]
                      .sort((a, b) => ordemSessao(a.tipo_sessao) - ordemSessao(b.tipo_sessao))
                      .map(e => renderMarcacao(
                        e,
                        (CORES_SESSAO[e.tipo_sessao] || COR_PADRAO).chip,
                        !!membroId && e.membro_original_id !== membroId
                      ))}
                    {previstasDoDia
                      .sort((a, b) => ordemSessao(a.tipo_sessao) - ordemSessao(b.tipo_sessao))
                      .map(renderPrevista)}
                    {motivoAusencia && !passado && (
                      <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">{primeiroNome(nomeMembro(membroId))} ausente</span>
                    )}
                    {!slot && !passado && membroId && !motivoAusencia && (
                      <span className="hidden sm:group-hover:block text-[11px] text-gray-400 dark:text-gray-500">+ {primeiroNome(nomeMembro(membroId))} ({SIGLA_SESSAO[sessao] || sessao})</span>
                    )}
                  </>
                ) : slot ? (
                  renderMarcacao(slot, doSelecionado ? cor.chip : 'bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-500', false)
                ) : prevista && !temEscalaNaSessao(data, sessao) ? (
                  <>
                    {renderPrevista(prevista)}
                    {motivoAusencia && <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">Ausente</span>}
                  </>
                ) : motivoAusencia && !passado ? (
                  <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">Ausente</span>
                ) : !passado && membroId ? (
                  <span className="hidden sm:group-hover:block text-[11px] text-gray-400 dark:text-gray-500">+ {primeiroNome(nomeMembro(membroId))}</span>
                ) : null}

                {visao === 'sessao' && tecnicoEmOutraSessao && !passado && (
                  <span className="hidden sm:flex items-center gap-0.5 text-[10px] text-amber-700 dark:text-amber-400 truncate" title={`${primeiroNome(nomeMembro(membroId))} também está na ${tecnicoEmOutraSessao.tipo_sessao} neste dia`}>
                    <AlertTriangle className="w-3 h-3 shrink-0" /> {tecnicoEmOutraSessao.tipo_sessao}
                  </span>
                )}

                {destino && destino.tipo !== 'mesmo' && (
                  <span className={`text-[10px] font-bold leading-tight ${
                    destino.tipo === 'mover' ? 'text-green-700 dark:text-green-400'
                    : destino.tipo === 'trocar' ? 'text-blue-700 dark:text-blue-400'
                    : 'text-red-700 dark:text-red-400'
                  }`}>
                    {destino.tipo === 'mover' ? 'Mover para cá'
                      : destino.tipo === 'trocar' ? `Trocar com ${primeiroNome(nomeMembro(destino.alvo.membro_original_id))}`
                      : destino.motivo}
                  </span>
                )}
              </div>
              );
              }}
              </Soltavel>
            );
          })}
        </div>
      </div>
    );
  };

  // Quadro técnico × sessão com a quantidade de dias no mês (rascunho + publicadas)
  const renderResumo = () => {
    const linhas = membros
      .filter(m => m.ativo !== false || diasPorMembro[m.id])
      .map(m => {
        const porSessao: Record<string, number> = {};
        escalas.forEach(e => {
          if (e.membro_original_id === m.id) porSessao[e.tipo_sessao] = (porSessao[e.tipo_sessao] || 0) + 1;
        });
        return { membro: m, porSessao, total: diasPorMembro[m.id] || 0 };
      })
      .sort((a, b) => b.total - a.total || a.membro.nome.localeCompare(b.membro.nome));

    return (
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-700/50 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">
              <th className="text-left px-4 py-2.5">Técnico · {nomeMesTitulo}</th>
              {SESSOES_DISPONIVEIS.map(s => (
                <th key={s} className="px-3 py-2.5 text-center whitespace-nowrap">
                  <span className={`inline-block w-2 h-2 rounded-sm mr-1.5 ${(CORES_SESSAO[s] || COR_PADRAO).dot}`} />{s}
                </th>
              ))}
              <th className="px-4 py-2.5 text-center">Total</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map(({ membro, porSessao, total }) => (
              <tr
                key={membro.id}
                onClick={() => setMembroId(membro.id === membroId ? '' : membro.id)}
                className={`border-t border-gray-100 dark:border-gray-700 cursor-pointer transition-colors ${membro.id === membroId ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700/40'}`}
              >
                <td className="px-4 py-2 font-medium text-gray-800 dark:text-gray-100">{membro.nome}</td>
                {SESSOES_DISPONIVEIS.map(s => (
                  <td key={s} className="px-3 py-2 text-center text-gray-600 dark:text-gray-300">{porSessao[s] || <span className="text-gray-300 dark:text-gray-600">–</span>}</td>
                ))}
                <td className="px-4 py-2 text-center font-bold text-gray-800 dark:text-gray-100">{total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-gray-100 dark:bg-gray-900 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 py-4 sm:py-6 space-y-4">
        {/* Cabeçalho */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100">Montar Escala do Mês</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Escolha a sessão e o técnico e clique nos dias para marcar; clique de novo para desmarcar. Arraste uma marcação para mudar de dia ou trocar com outro técnico. Tudo fica em rascunho até você publicar.
            </p>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <button
              onClick={handleImportarTRT}
              disabled={importando || processando}
              title={`Traz as sessões presenciais de ${nomeMesTitulo} do calendário do TRT20 como "a preencher"`}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 bg-white dark:bg-gray-800 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-xl shadow-sm transition-colors disabled:opacity-50"
            >
              {importando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              <span className="hidden sm:inline">Importar sessões do TRT</span>
              <span className="sm:hidden">TRT</span>
            </button>
            <button onClick={onClose} className="shrink-0 text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-gray-100 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 p-2 rounded-full transition-colors" title="Fechar">
            <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Controles */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm p-4 space-y-4">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Mês</label>
              <div className="flex items-center gap-1">
                <button onClick={() => setMes(deslocarMes(mes, -1))} className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <span className="font-bold text-gray-800 dark:text-gray-100 w-44 text-center">{nomeMesTitulo}</span>
                <button onClick={() => setMes(deslocarMes(mes, 1))} className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Sessão</label>
              <div className="flex bg-gray-100 dark:bg-gray-700/80 p-1 rounded-xl">
                {SESSOES_DISPONIVEIS.map(s => (
                  <button
                    key={s}
                    onClick={() => setSessao(s)}
                    className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors ${
                      sessao === s ? `${(CORES_SESSAO[s] || COR_PADRAO).tab} shadow-sm` : 'text-gray-500 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Início</label>
              <input
                type="time"
                value={hora}
                onChange={e => setHoras(prev => ({ ...prev, [sessao]: e.target.value }))}
                className="border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-white rounded-xl px-3 py-1.5 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Exibir</label>
              <div className="flex bg-gray-100 dark:bg-gray-700/80 p-1 rounded-xl">
                {([['sessao', 'Só esta sessão'], ['todas', 'Todas as sessões']] as const).map(([valor, rotulo]) => (
                  <button
                    key={valor}
                    onClick={() => setVisao(valor)}
                    className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors ${
                      visao === valor ? 'bg-white dark:bg-gray-800 text-blue-700 dark:text-blue-400 shadow-sm' : 'text-gray-500 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100'
                    }`}
                  >
                    {rotulo}
                  </button>
                ))}
              </div>
            </div>

            {FUNCOES_DISPONIVEIS.length > 1 && (
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Função</label>
                <select
                  value={funcao}
                  onChange={e => setFuncao(e.target.value)}
                  className="border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-white rounded-xl px-3 py-2 text-sm focus:ring-blue-500 focus:border-blue-500"
                >
                  {FUNCOES_DISPONIVEIS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
              Técnico <span className="normal-case font-medium">(número = dias escalados no mês)</span>
            </label>
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1">
              {membrosAtivos.map(m => {
                const selecionado = m.id === membroId;
                return (
                  <button
                    key={m.id}
                    onClick={() => setMembroId(selecionado ? '' : m.id)}
                    className={`shrink-0 flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border text-sm font-medium transition-colors ${
                      selecionado
                        ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                        : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-blue-400'
                    }`}
                  >
                    <span className={`w-7 h-7 rounded-full grid place-items-center text-[11px] font-bold ${selecionado ? 'bg-white/20' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}>
                      {iniciais(m.nome)}
                    </span>
                    {m.nome.split(' ').slice(0, 2).join(' ')}
                    <span className={`text-xs font-bold px-1.5 rounded-full ${selecionado ? 'bg-white/20' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                      {diasPorMembro[m.id] || 0}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Legenda */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
          <span className="flex items-center gap-1.5"><span className="w-4 h-3 rounded border border-dashed border-gray-500" /> rascunho</span>
          <span className="flex items-center gap-1.5"><Lock className="w-3 h-3" /> publicada (arraste para mover; o técnico é avisado)</span>
          <span className="flex items-center gap-1.5"><span className="w-4 h-3 rounded bg-[repeating-linear-gradient(135deg,transparent_0_3px,rgba(245,158,11,0.5)_3px_6px)]" /> ausência do técnico</span>
          {previstas.length > 0 && (
            <span className="flex items-center gap-1.5"><span className="w-4 h-3 rounded border border-dashed border-gray-400 bg-white dark:bg-gray-800" /> <em>a preencher</em> (sessão do TRT sem técnico)</span>
          )}
          {visao === 'sessao' ? (
            <span className="flex items-center gap-1.5">
              {SESSOES_DISPONIVEIS.map(s => <span key={s} className={`w-1.5 h-1.5 rounded-full ${(CORES_SESSAO[s] || COR_PADRAO).dot}`} />)}
              outras sessões no dia
            </span>
          ) : (
            <>
              {SESSOES_DISPONIVEIS.map(s => (
                <span key={s} className="flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-sm ${(CORES_SESSAO[s] || COR_PADRAO).dot}`} /> {s}</span>
              ))}
              <span>· técnico selecionado em destaque; clique continua marcando a sessão {sessao}</span>
            </>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center p-12">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600 dark:text-blue-400" />
          </div>
        ) : (
          <>
            <DndContext
              sensors={sensores}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={() => setArrastando(null)}
            >
              {renderCalendario()}
              <DragOverlay dropAnimation={null}>
                {arrastando && (
                  <div className="w-28 sm:w-36 shadow-xl rotate-2 cursor-grabbing">
                    {conteudoMarcacao(arrastando, (CORES_SESSAO[arrastando.tipo_sessao] || COR_PADRAO).chip, false)}
                  </div>
                )}
              </DragOverlay>
            </DndContext>
            {renderResumo()}
          </>
        )}
      </div>
      </div>

      {/* Barra de publicação (fora da área rolável, para não cobrir o conteúdo) */}
      <div className="shrink-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            <strong>{rascunhos.length}</strong> {rascunhos.length === 1 ? 'dia em rascunho' : 'dias em rascunho'} em {nomeMesTitulo}
            <span className="hidden sm:inline text-gray-400"> · invisíveis para os técnicos até publicar</span>
            {aPreencher.length > 0 && (
              <span className="text-amber-700 dark:text-amber-400"> · <strong>{aPreencher.length}</strong> {aPreencher.length === 1 ? 'sessão do TRT a preencher' : 'sessões do TRT a preencher'}</span>
            )}
          </p>
          <div className="flex gap-2 ml-auto">
            {rascunhos.length > 0 && (
              <button
                onClick={() => setConfirmDescartar(true)}
                className="px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-xl flex items-center gap-1.5 transition-colors"
              >
                <Trash2 className="w-4 h-4" /> Descartar
              </button>
            )}
            <button
              onClick={() => setConfirmPublicar(true)}
              disabled={rascunhosAPublicar.length === 0}
              className="px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl flex items-center gap-1.5 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <CalendarCheck className="w-4 h-4" /> Publicar mês
            </button>
          </div>
        </div>
      </div>

      {importacao && (
        <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
            <div className="p-5 border-b border-gray-100 dark:border-gray-700 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">Sessões do TRT · {nomeMesTitulo}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  Sessões presenciais do calendário do tribunal, de hoje em diante. Elas entram como <em>a preencher</em>; depois é só escolher o técnico.
                </p>
              </div>
              <button onClick={() => setImportacao(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto flex-1 min-h-0 space-y-1.5">
              {importacao.itens.map(i => (
                <div key={`${i.data}|${i.tipo_sessao}`} className="flex items-center gap-3 text-sm">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${(CORES_SESSAO[i.tipo_sessao] || COR_PADRAO).dot}`} />
                  <span className="w-28 shrink-0 font-medium text-gray-800 dark:text-gray-100">{formatDiaCurto(i.data)}</span>
                  <span className="w-20 shrink-0 text-gray-700 dark:text-gray-200">{i.tipo_sessao}</span>
                  <span className="w-12 shrink-0 text-gray-500 dark:text-gray-400">{i.hora_inicio}</span>
                  <span className={`ml-auto text-xs font-semibold shrink-0 ${
                    i.situacao === 'nova' ? 'text-green-700 dark:text-green-400'
                    : i.situacao === 'atualizada' ? 'text-blue-700 dark:text-blue-400'
                    : 'text-gray-400'
                  }`}>
                    {{ nova: 'nova', atualizada: 'horário atualizado', igual: 'já importada', escalada: 'já escalada' }[i.situacao]}
                  </span>
                </div>
              ))}
              {importacao.remover.length > 0 && (
                <div className="mt-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 text-sm text-amber-800 dark:text-amber-300">
                  <strong>Não estão mais no calendário do TRT</strong> e serão retiradas das sessões a preencher:
                  <ul className="mt-1 list-disc pl-5">
                    {importacao.remover.map(p => <li key={p.id}>{formatDiaCurto(p.data)} · {p.tipo_sessao} · {p.hora_inicio}</li>)}
                  </ul>
                  <span className="text-xs">Escalas já marcadas nesses dias não são alteradas.</span>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-2">
              <button onClick={() => setImportacao(null)} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-600 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700">
                Cancelar
              </button>
              <button
                onClick={confirmarImportacao}
                disabled={processando}
                className="px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl flex items-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                {processando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Importar
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmPublicar && (
        <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
            <div className="p-6 border-b border-gray-100 dark:border-gray-700">
              <h3 className="font-bold text-lg text-gray-900 dark:text-gray-100">Publicar escala de {nomeMesTitulo}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {rascunhosAPublicar.length} {rascunhosAPublicar.length === 1 ? 'dia passa' : 'dias passam'} a ser visíveis e cada técnico recebe um aviso com os seus dias.
              </p>
            </div>
            <div className="p-6 overflow-y-auto space-y-3 flex-1">
              {Object.entries(rascunhosPorMembro).map(([id, itens]) => (
                <div key={id} className="p-3 rounded-xl bg-gray-50 dark:bg-gray-700/50 border border-gray-100 dark:border-gray-700">
                  <p className="text-sm font-bold text-gray-800 dark:text-gray-100">{nomeMembro(id)} <span className="font-medium text-gray-500 dark:text-gray-400">· {itens.length} {itens.length === 1 ? 'dia' : 'dias'}</span></p>
                  <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 leading-relaxed">
                    {itens.map(e => `${formatDiaCurto(e.data)} (${e.tipo_sessao})`).join(' · ')}
                  </p>
                </div>
              ))}
              {rascunhos.length > rascunhosAPublicar.length && (
                <p className="text-xs text-amber-700 dark:text-amber-400">Rascunhos em dias que já passaram não serão publicados.</p>
              )}
            </div>
            <div className="p-6 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 space-y-4">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enviarWhatsApp}
                  onChange={e => setEnviarWhatsApp(e.target.checked)}
                  className="rounded w-4 h-4 border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                />
                Avisar também por WhatsApp (o aviso no app é sempre criado)
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400 -mt-2">O lembrete automático de {LEMBRETE_ANTECEDENCIA_MIN} minutos antes de cada sessão continua valendo.</p>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setConfirmPublicar(false)} disabled={processando} className="px-4 py-2.5 font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 border dark:border-gray-600 rounded-xl transition-colors">
                  Cancelar
                </button>
                <button onClick={handlePublicar} disabled={processando} className="px-5 py-2.5 font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl flex items-center gap-2 disabled:opacity-50 shadow-sm transition-colors">
                  {processando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {processando ? 'Publicando...' : 'Publicar e avisar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {movPendente && (() => {
        const { origem, data, alvo } = movPendente;
        const afetados = [origem, alvo].filter((e): e is EscalaMes => !!e && e.publicada);
        return (
          <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md p-6">
              <div className="w-14 h-14 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                {alvo ? <ArrowRightLeft className="w-7 h-7 text-blue-600 dark:text-blue-400" /> : <MoveRight className="w-7 h-7 text-blue-600 dark:text-blue-400" />}
              </div>
              <h3 className="font-bold text-lg text-gray-900 dark:text-gray-100 text-center">
                {alvo ? 'Trocar escalas publicadas?' : 'Mover escala publicada?'}
              </h3>
              <div className="mt-4 space-y-2 text-sm text-gray-700 dark:text-gray-200">
                <p className="p-3 rounded-xl bg-gray-50 dark:bg-gray-700/50">
                  <strong>{nomeMembro(origem.membro_original_id)}</strong> · {origem.tipo_sessao}<br />
                  {formatDiaCurto(origem.data)} → <strong>{formatDiaCurto(data)}</strong>
                </p>
                {alvo && (
                  <p className="p-3 rounded-xl bg-gray-50 dark:bg-gray-700/50">
                    <strong>{nomeMembro(alvo.membro_original_id)}</strong> · {alvo.tipo_sessao}<br />
                    {formatDiaCurto(alvo.data)} → <strong>{formatDiaCurto(origem.data)}</strong>
                  </p>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
                {afetados.map(e => primeiroNome(nomeMembro(e.membro_original_id))).join(' e ')} {afetados.length === 1 ? 'receberá' : 'receberão'} um aviso no app com a mudança. O lembrete de {LEMBRETE_ANTECEDENCIA_MIN} minutos segue o novo dia.
              </p>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200 cursor-pointer mt-3">
                <input
                  type="checkbox"
                  checked={enviarWhatsApp}
                  onChange={e => setEnviarWhatsApp(e.target.checked)}
                  className="rounded w-4 h-4 border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                />
                Avisar também por WhatsApp
              </label>
              <div className="flex gap-3 justify-end mt-6">
                <button onClick={() => setMovPendente(null)} disabled={processando} className="px-4 py-2.5 font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-xl transition-colors">
                  Cancelar
                </button>
                <button onClick={() => aplicarMovimento(origem, data, alvo)} disabled={processando} className="px-5 py-2.5 font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl flex items-center gap-2 disabled:opacity-50 shadow-sm transition-colors">
                  {processando && <Loader2 className="w-4 h-4 animate-spin" />}
                  {processando ? 'Salvando...' : alvo ? 'Trocar e avisar' : 'Mover e avisar'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {confirmDescartar && (
        <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
            <div className="w-14 h-14 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <Trash2 className="w-7 h-7 text-red-600 dark:text-red-400" />
            </div>
            <h3 className="font-bold text-lg text-gray-900 dark:text-gray-100">Descartar rascunhos?</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              Os {rascunhos.length} dias em rascunho de {nomeMesTitulo} serão apagados. As escalas já publicadas não são afetadas.
            </p>
            <div className="flex gap-3 justify-center mt-6">
              <button onClick={() => setConfirmDescartar(false)} disabled={processando} className="px-4 py-2.5 font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-xl transition-colors">
                Cancelar
              </button>
              <button onClick={handleDescartar} disabled={processando} className="px-5 py-2.5 font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl disabled:opacity-50 transition-colors">
                {processando ? 'Descartando...' : 'Descartar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MonthlyScaleBuilder;
