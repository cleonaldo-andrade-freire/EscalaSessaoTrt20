import React, { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { LayoutDashboard, Users, CalendarDays, LogOut, Bell, CalendarOff, UserX, Sun, Moon, ClipboardList, CalendarCheck } from 'lucide-react';
import { getGreeting } from '../utils/greeting';

const AdminLayout = ({ children }: { children: React.ReactNode }) => {
  const [userName, setUserName] = useState('Administrador');
  const [userFoto, setUserFoto] = useState('');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        window.location.href = '/login';
        return;
      }

      const { data: membro } = await supabase
        .from('membros')
        .select('nome, foto_url, is_admin')
        .eq('id', user.id)
        .single();

      if (!membro?.is_admin) {
        // Usuário autenticado mas não é admin — redireciona para área de membro
        window.location.href = '/dashboard';
        return;
      }

      setUserName(membro.nome.split(' ')[0]);
      setUserFoto(membro.foto_url || '');
      setAuthChecked(true);
    };
    fetchUser();
    
    // Check saved theme
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      setIsDarkMode(true);
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, []);

  // Não renderiza o conteúdo enquanto a verificação de admin não for concluída
  if (!authChecked) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    );
  }


  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
    if (!isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900 transition-colors duration-200">
      
      {/* Sidebar - Fixa na Esquerda */}
      <aside className="w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 shadow-sm flex flex-col transition-colors duration-200">
        <div className="p-6 border-b border-gray-100 dark:border-gray-700">
          <h1 className="text-2xl font-black text-blue-700 dark:text-blue-400">Escala Sessão TRT20</h1>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mt-1">Painel Admin</p>
        </div>
        
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto custom-scrollbar">
          <a href="/admin/dashboard" className="flex items-center px-4 py-3 text-sm font-medium text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 rounded-lg">
            <LayoutDashboard className="w-5 h-5 mr-3" />
            Dashboard
          </a>
          <a href="/admin/escalas" className="flex items-center px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
            <CalendarDays className="w-5 h-5 mr-3" />
            Gerenciar Escalas
          </a>
          <a href="/admin/membros" className="flex items-center px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
            <Users className="w-5 h-5 mr-3" />
            Equipe & Membros
          </a>
          <a href="/admin/avisos" className="flex items-center px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
            <Bell className="w-5 h-5 mr-3" />
            Quadro de Avisos
          </a>
          <a href="/admin/ausencias" className="flex items-center px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
            <CalendarOff className="w-5 h-5 mr-3" />
            Ausências Programadas
          </a>
          <a href="/admin/permutas" className="flex items-center px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
            <CalendarDays className="w-5 h-5 mr-3" />
            Permutas
          </a>
          <a href="/admin/relatorio-presenca" className="flex items-center px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
            <ClipboardList className="w-5 h-5 mr-3" />
            Relatório de Presença
          </a>
          <a href="/admin/relatorio-faltas" className="flex items-center px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-red-600 dark:hover:text-red-400 transition-colors">
            <UserX className="w-5 h-5 mr-3 text-red-500 dark:text-red-400" />
            Relatório de Faltas
          </a>
          <a href="/admin/google-agenda" className="flex items-center px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
            <CalendarCheck className="w-5 h-5 mr-3" />
            Google Agenda
          </a>
        </nav>

        <div className="p-4 border-t border-gray-100 dark:border-gray-700">
          <button 
            onClick={handleLogout}
            className="flex items-center w-full px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
          >
            <LogOut className="w-5 h-5 mr-3" />
            Sair do Sistema
          </button>
        </div>
      </aside>

      {/* Área Principal de Conteúdo */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header Superior Simples */}
        <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 h-16 flex items-center justify-end px-8 shadow-sm transition-colors duration-200">
           <div className="flex items-center gap-4">
             <button
               onClick={toggleTheme}
               className="p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
               title={isDarkMode ? "Mudar para modo claro" : "Mudar para modo escuro"}
             >
               {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
             </button>
             <div className="flex items-center gap-3">
               <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold overflow-hidden shadow-sm">
                 {userFoto ? (
                   <img src={userFoto} alt={userName} className="w-full h-full object-cover" />
                 ) : (
                   userName.charAt(0).toUpperCase()
                 )}
               </div>
               <div className="flex flex-col">
                 <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">{getGreeting()}</span>
                 <span className="text-sm font-bold text-gray-700 dark:text-gray-200 leading-tight">{userName}</span>
               </div>
             </div>
           </div>
        </header>

        {/* Renderiza o conteúdo da página ativa aqui */}
        <div className="flex-1 overflow-auto p-8 text-gray-900 dark:text-gray-100">
          {children}
        </div>
      </main>

    </div>
  );
};

export default AdminLayout;
