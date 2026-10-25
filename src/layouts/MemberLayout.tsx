import React, { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { Home, CalendarSearch, Bell, User, CalendarOff } from 'lucide-react';

const MemberLayout = ({ children, activeTab = 'home' }: { children: React.ReactNode, activeTab?: string }) => {
  const [unreadAvisos, setUnreadAvisos] = useState(0);
  const [availableSwaps, setAvailableSwaps] = useState(0);
  
  useEffect(() => {
    const fetchCounts = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // 1. Busca avisos não lidos
      const { count: avisosCount } = await supabase
        .from('avisos')
        .select('*', { count: 'exact', head: true })
        .eq('membro_id', user.id)
        .eq('lido', false);
        
      if (avisosCount !== null) setUnreadAvisos(avisosCount);

      // 2. Busca permutas disponíveis (de outros membros, data futura)
      const hoje = new Date().toISOString().split('T')[0];
      
      const { count: swapsCount } = await supabase
        .from('escalas')
        .select('*', { count: 'exact', head: true })
        .eq('status_substituicao', 'Disponível para Troca')
        .gte('data', hoje)
        .neq('membro_original_id', user.id);

      if (swapsCount !== null) setAvailableSwaps(swapsCount);
    };

    fetchCounts();
  }, []);

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      
      <main className="flex-1 overflow-y-auto pb-safe pb-24">
        {children}
      </main>

      <nav className="fixed bottom-0 w-full bg-white border-t border-gray-200 pb-safe z-50">
        <div className="flex justify-around items-center h-16 px-2">
          
          <a href="/dashboard" className={`flex flex-col items-center justify-center w-full h-full gap-1 ${activeTab === 'home' ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}>
            <Home className="w-6 h-6" strokeWidth={activeTab === 'home' ? 2.5 : 2} />
            <span className="text-[10px] font-medium">Início</span>
          </a>

          <a href="/substituicoes" className={`flex flex-col items-center justify-center w-full h-full gap-1 ${activeTab === 'substituicoes' ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}>
            <div className="relative">
               <CalendarSearch className="w-6 h-6" strokeWidth={activeTab === 'substituicoes' ? 2.5 : 2} />
               {availableSwaps > 0 && (
                 <div className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full border-2 border-white shadow-sm">
                   {availableSwaps > 9 ? '9+' : availableSwaps}
                 </div>
               )}
            </div>
            <span className="text-[10px] font-medium">Permutas</span>
          </a>

          <a href="/avisos" className={`flex flex-col items-center justify-center w-full h-full gap-1 ${activeTab === 'avisos' ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}>
            <div className="relative">
              <Bell className="w-6 h-6" strokeWidth={activeTab === 'avisos' ? 2.5 : 2} />
              {unreadAvisos > 0 && (
                 <div className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full border-2 border-white shadow-sm">
                   {unreadAvisos > 9 ? '9+' : unreadAvisos}
                 </div>
               )}
            </div>
            <span className="text-[10px] font-medium">Avisos</span>
          </a>

          <a href="/ausencias" className={`flex flex-col items-center justify-center w-full h-full gap-1 ${activeTab === 'ausencias' ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}>
            <CalendarOff className="w-6 h-6" strokeWidth={activeTab === 'ausencias' ? 2.5 : 2} />
            <span className="text-[10px] font-medium">Ausências</span>
          </a>

          <a href="/perfil" className={`flex flex-col items-center justify-center w-full h-full gap-1 ${activeTab === 'perfil' ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}>
            <User className="w-6 h-6" strokeWidth={activeTab === 'perfil' ? 2.5 : 2} />
            <span className="text-[10px] font-medium">Perfil</span>
          </a>
          
        </div>
      </nav>
    </div>
  );
};

export default MemberLayout;
