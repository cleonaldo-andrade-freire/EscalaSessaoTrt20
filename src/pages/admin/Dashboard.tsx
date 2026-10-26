import React, { useEffect, useState } from 'react';
import { supabase } from '../../services/supabaseClient';
import AdminLayout from '../../layouts/AdminLayout';
import { getLocalDateStr, formatHora } from '../../utils/date';

const Dashboard = () => {
  const [stats, setStats] = useState({
    totalMembros: 0,
    trocasPendentes: 0,
    escalasHojeAmanha: 0
  });
  const [pedidosTroca, setPedidosTroca] = useState<any[]>([]);
  const [checkoutsPendentes, setCheckoutsPendentes] = useState<any[]>([]);
  const [rankingAnual, setRankingAnual] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadDashboardData = async () => {
      setLoading(true);

      // 1. Total de Membros
      const { count: countMembros } = await supabase
        .from('membros')
        .select('*', { count: 'exact', head: true })
        .eq('ativo', true);

      // 2. Permutas Pendentes
      const { count: countTrocas, data: trocasRecentes } = await supabase
        .from('escalas')
        .select(`
          id, data, funcao, tipo_sessao, status_substituicao,
          membro_original:membro_original_id ( id, nome )
        `, { count: 'exact' })
        .eq('status_substituicao', 'Disponível para Troca')
        .order('data', { ascending: true })
        .limit(5);

      // 3. Escalas Hoje/Amanhã
      const hoje = new Date();
      const amanha = new Date();
      amanha.setDate(amanha.getDate() + 1);
      
      const hojeStr = getLocalDateStr(hoje);
      const amanhaStr = getLocalDateStr(amanha);

      const { count: countEscalas } = await supabase
        .from('escalas')
        .select('*', { count: 'exact', head: true })
        .eq('publicada', true)
        .in('data', [hojeStr, amanhaStr]);

      // 4. Check-outs pendentes (check-in feito, sem check-out) nos últimos 30 dias
      const limite = new Date();
      limite.setDate(limite.getDate() - 30);
      const { data: semCheckout } = await supabase
        .from('escalas')
        .select(`
          id, data, tipo_sessao, checkin_em, status_substituicao,
          membro_original:membro_original_id ( id, nome, foto_url ),
          membro_substituto:membro_substituto_id ( id, nome, foto_url )
        `)
        .eq('compareceu', true)
        .is('checkout_em', null)
        .gte('data', getLocalDateStr(limite))
        .lt('data', hojeStr)
        .order('data', { ascending: false })
        .limit(10);

      setStats({
        totalMembros: countMembros || 0,
        trocasPendentes: countTrocas || 0,
        escalasHojeAmanha: countEscalas || 0
      });

      // 5. Sessões atendidas no ano (check-ins) e horas de suporte registradas
      const anoAtual = new Date().getFullYear();
      const { data: escalasAno } = await supabase
        .from('escalas')
        .select(`
          status_substituicao, checkin_em, checkout_em,
          membro_original:membro_original_id(id, nome, foto_url),
          membro_substituto:membro_substituto_id(id, nome, foto_url)
        `)
        .eq('compareceu', true)
        .gte('data', `${anoAtual}-01-01`)
        .lte('data', `${anoAtual}-12-31`);

      const atendimentosMap: Record<string, any> = {};
      (escalasAno || []).forEach((escala: any) => {
        const isSubstituido = escala.status_substituicao === 'Substituição Aceita';
        const membro = isSubstituido ? escala.membro_substituto : escala.membro_original;
        if (!membro?.id) return;
        if (!atendimentosMap[membro.id]) {
          atendimentosMap[membro.id] = { id: membro.id, nome: membro.nome, foto_url: membro.foto_url, sessoes: 0, minutos: 0 };
        }
        atendimentosMap[membro.id].sessoes += 1;
        if (escala.checkin_em && escala.checkout_em) {
          atendimentosMap[membro.id].minutos += Math.max(0, (new Date(escala.checkout_em).getTime() - new Date(escala.checkin_em).getTime()) / 60000);
        }
      });

      const ranking = Object.values(atendimentosMap)
        .sort((a: any, b: any) => b.sessoes - a.sessoes);

      setRankingAnual(ranking);

      setPedidosTroca(trocasRecentes || []);
      setCheckoutsPendentes(semCheckout || []);
      setLoading(false);
    };

    loadDashboardData();
  }, []);

  return (
    <AdminLayout>
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-gray-800 dark:text-gray-100">Visão Geral</h2>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Acompanhe a equipe de suporte às sessões do 2º Grau.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 mb-8 lg:grid-cols-3">
        <div className="p-6 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl shadow-sm">
          <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Membros Ativos</div>
          <div className="mt-2 text-3xl font-black text-gray-800 dark:text-gray-100">
            {loading ? '...' : stats.totalMembros}
          </div>
        </div>
        
        <div className={`p-6 bg-white dark:bg-gray-800 border rounded-2xl shadow-sm relative overflow-hidden ${stats.trocasPendentes > 0 ? 'border-red-100' : 'border-gray-100 dark:border-gray-700'}`}>
          {stats.trocasPendentes > 0 && <div className="absolute top-0 right-0 w-2 h-full bg-red-500"></div>}
          <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Permutas Pendentes</div>
          <div className={`mt-2 text-3xl font-black ${stats.trocasPendentes > 0 ? 'text-red-600' : 'text-gray-800 dark:text-gray-100'}`}>
            {loading ? '...' : stats.trocasPendentes}
          </div>
          {stats.trocasPendentes > 0 && (
            <p className="text-xs text-red-500 mt-2 font-medium">Atenção necessária</p>
          )}
        </div>

        <div className="p-6 bg-white dark:bg-gray-800 border border-blue-100 rounded-2xl shadow-sm relative overflow-hidden">
           <div className="absolute top-0 right-0 w-2 h-full bg-blue-500"></div>
          <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Escalados Hoje/Amanhã</div>
          <div className="mt-2 text-3xl font-black text-blue-600">
            {loading ? '...' : stats.escalasHojeAmanha}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Tabela Resumo: Pedidos de Troca */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex justify-between items-center">
            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">Pedidos de Permuta</h3>
          </div>
          <div className="p-0 flex-1">
            {loading ? (
               <div className="p-8 text-center text-gray-500 dark:text-gray-400">Carregando...</div>
            ) : pedidosTroca.length === 0 ? (
               <div className="p-8 text-center text-gray-500 dark:text-gray-400">Nenhum pedido de troca pendente. Excelente!</div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 uppercase bg-white dark:bg-gray-800">
                    <th className="px-6 py-3 font-medium">Data / Função</th>
                    <th className="px-6 py-3 font-medium">Membro</th>
                    <th className="px-6 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {pedidosTroca.map(pedido => (
                    <tr key={pedido.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 dark:bg-gray-700/50">
                      <td className="px-6 py-4">
                        <div className="font-medium text-gray-800 dark:text-gray-100">{new Date(pedido.data + 'T12:00:00').toLocaleDateString('pt-BR')}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{pedido.funcao}</div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-200">{pedido.membro_original?.nome}</td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-yellow-100 text-yellow-800">
                          Pendente
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Painel Resumo: Check-outs pendentes */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">Check-outs Pendentes</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Sessões dos últimos 30 dias com check-in e sem check-out (lance em Gerenciar Escalas)</p>
          </div>
          <div className="p-6 flex-1">
            {loading ? (
               <div className="text-center text-gray-500 dark:text-gray-400">Carregando...</div>
            ) : checkoutsPendentes.length === 0 ? (
               <div className="text-center text-gray-500 dark:text-gray-400 py-4">Nenhum check-out pendente!</div>
            ) : (
              checkoutsPendentes.map(escala => {
                const membro = escala.status_substituicao === 'Substituição Aceita' ? escala.membro_substituto : escala.membro_original;
                return (
                  <div key={escala.id} className="flex items-center justify-between p-3 mb-3 bg-amber-50 dark:bg-amber-950/20 rounded-xl border border-amber-100 dark:border-amber-900/30">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-amber-200 dark:bg-amber-900/40 flex items-center justify-center font-bold text-amber-700 dark:text-amber-300 overflow-hidden">
                         {membro?.foto_url ? <img src={membro.foto_url} alt="Avatar" className="w-full h-full object-cover" /> : membro?.nome?.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-gray-800 dark:text-gray-100">{membro?.nome}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{new Date(escala.data + 'T12:00:00').toLocaleDateString('pt-BR')} · {escala.tipo_sessao}</p>
                      </div>
                    </div>
                    <div className="text-amber-700 dark:text-amber-400 font-bold text-sm">
                      Entrada {formatHora(escala.checkin_em)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Painel Resumo: Sessões atendidas no ano */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden flex flex-col xl:col-span-2">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex justify-between items-center">
            <div>
              <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">Sessões Atendidas no Ano</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Check-ins e horas de suporte registradas por membro ({new Date().getFullYear()})</p>
            </div>
            <div className="w-8 h-8 bg-yellow-100 dark:bg-yellow-950/40 rounded-full flex items-center justify-center text-yellow-600 dark:text-yellow-400 shadow-sm border border-transparent dark:border-yellow-900/30">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="7"></circle><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline></svg>
            </div>
          </div>
          <div className="p-6 flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
            {loading ? (
               <div className="text-center text-gray-500 dark:text-gray-400 col-span-full">Carregando...</div>
            ) : rankingAnual.length === 0 ? (
               <div className="text-center text-gray-500 dark:text-gray-400 py-4 col-span-full">Nenhuma sessão atendida neste ano ainda.</div>
            ) : (
              rankingAnual.map((membro, index) => (
                <div key={membro.id} className="flex items-center justify-between p-3 bg-gradient-to-r from-yellow-50 to-white dark:from-yellow-950/20 dark:to-gray-800/40 rounded-xl border border-yellow-100/50 dark:border-yellow-900/30 hover:shadow-sm transition-shadow">
                  <div className="flex items-center gap-3">
                    <div className="text-sm font-black text-yellow-600 dark:text-yellow-500 w-5 text-center">{index + 1}º</div>
                    <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center font-bold text-blue-700 dark:text-blue-300 overflow-hidden shadow-inner border border-blue-200 dark:border-blue-800/50">
                       {membro.foto_url ? <img src={membro.foto_url} alt="Avatar" className="w-full h-full object-cover" /> : membro.nome.charAt(0)}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-800 dark:text-gray-100">{membro.nome}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-yellow-600 dark:text-yellow-400 font-black text-lg bg-yellow-100/50 dark:bg-yellow-950/40 px-3 py-1 rounded-lg border border-yellow-200/50 dark:border-yellow-900/30">
                    {membro.sessoes}
                    <span className="text-[10px] uppercase font-bold text-yellow-700 dark:text-yellow-500">{membro.sessoes === 1 ? 'sessão' : 'sessões'}</span>
                    {membro.minutos > 0 && (
                      <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 ml-1">· {Math.floor(membro.minutos / 60)}h{String(Math.round(membro.minutos % 60)).padStart(2, '0')}</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
};

export default Dashboard;
