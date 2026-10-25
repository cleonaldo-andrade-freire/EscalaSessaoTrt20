import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { supabase } from './services/supabaseClient';
import Login from './pages/Login';
import UpdatePassword from './pages/UpdatePassword';
import Dashboard from './pages/admin/Dashboard';
import AddMember from './pages/admin/AddMember';
import MembersList from './pages/admin/MembersList';
import ManageScales from './pages/admin/ManageScales';
import ManageNotices from './pages/admin/ManageNotices';
import MemberDashboard from './pages/member/MemberDashboard';
import MemberProfile from './pages/member/MemberProfile';
import MemberNotices from './pages/member/MemberNotices';
import MemberSwaps from './pages/member/MemberSwaps';
import MemberAbsences from './pages/member/MemberAbsences';
import MemberGeneralSchedule from './pages/member/MemberGeneralSchedule';
import ManageAbsences from './pages/admin/ManageAbsences';
import ManageSwaps from './pages/admin/ManageSwaps';
import AdminMissedScales from './pages/admin/AdminMissedScales';
import IosInstallBanner from './components/IosInstallBanner';

// ---------------------------------------------------------------------------
// Guard: protege qualquer rota autenticada. Redireciona para /login se não
// houver sessão ativa no Supabase.
// ---------------------------------------------------------------------------
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const [status, setStatus] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setStatus(data.session ? 'authenticated' : 'unauthenticated');
    });
  }, []);

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    );
  }

  return status === 'authenticated' ? <>{children}</> : <Navigate to="/login" replace />;
};

// ---------------------------------------------------------------------------
// Guard: protege rotas exclusivas de admin. Verifica sessão E campo is_admin
// na tabela membros. Redireciona não-admins para /dashboard (área de membro).
// ---------------------------------------------------------------------------
const AdminRoute = ({ children }: { children: React.ReactNode }) => {
  const [status, setStatus] = useState<'loading' | 'admin' | 'member' | 'unauthenticated'>('loading');

  useEffect(() => {
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setStatus('unauthenticated');
        return;
      }
      const { data: membro } = await supabase
        .from('membros')
        .select('is_admin')
        .eq('id', session.user.id)
        .single();

      setStatus(membro?.is_admin ? 'admin' : 'member');
    };
    check();
  }, []);

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (status === 'unauthenticated') return <Navigate to="/login" replace />;
  if (status === 'member') return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
};

function App() {

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" />} />
        <Route path="/login" element={<Login />} />
        <Route path="/update-password" element={<UpdatePassword />} />

        {/* Rotas de Admin — protegidas: exigem sessão + is_admin */}
        <Route path="/admin/dashboard" element={<AdminRoute><Dashboard /></AdminRoute>} />
        <Route path="/admin/membros/novo" element={<AdminRoute><AddMember /></AdminRoute>} />
        <Route path="/admin/membros" element={<AdminRoute><MembersList /></AdminRoute>} />
        <Route path="/admin/escalas" element={<AdminRoute><ManageScales /></AdminRoute>} />
        <Route path="/admin/avisos" element={<AdminRoute><ManageNotices /></AdminRoute>} />
        <Route path="/admin/ausencias" element={<AdminRoute><ManageAbsences /></AdminRoute>} />
        <Route path="/admin/permutas" element={<AdminRoute><ManageSwaps /></AdminRoute>} />
        <Route path="/admin/relatorio-faltas" element={<AdminRoute><AdminMissedScales /></AdminRoute>} />

        {/* Rotas de Membro (Mobile) — protegidas: exigem sessão */}
        <Route path="/dashboard" element={<ProtectedRoute><MemberDashboard /></ProtectedRoute>} />
        <Route path="/perfil" element={<ProtectedRoute><MemberProfile /></ProtectedRoute>} />
        <Route path="/avisos" element={<ProtectedRoute><MemberNotices /></ProtectedRoute>} />
        <Route path="/ausencias" element={<ProtectedRoute><MemberAbsences /></ProtectedRoute>} />
        <Route path="/substituicoes" element={<ProtectedRoute><MemberSwaps /></ProtectedRoute>} />
        <Route path="/escalas-geral" element={<ProtectedRoute><MemberGeneralSchedule /></ProtectedRoute>} />
      </Routes>
      <IosInstallBanner />
      <Toaster position="top-right" />
    </BrowserRouter>
  );
}

export default App;
