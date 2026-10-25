import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';
import { Eye, EyeOff } from 'lucide-react';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resetMessage, setResetMessage] = useState('');

  // Verifica sessão existente ao carregar — mantém o usuário logado
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data: membro } = await supabase
          .from('membros')
          .select('is_admin')
          .eq('id', session.user.id)
          .single();

        if (membro?.is_admin) {
          const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
          window.location.href = isMobile ? '/dashboard' : '/admin/dashboard';
        } else {
          window.location.href = '/dashboard';
        }
      }
    };
    checkSession();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResetMessage('');

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError('E-mail ou senha incorretos.');
      setLoading(false);
    } else {
      if (data?.user) {
        const { data: membro } = await supabase
          .from('membros')
          .select('is_admin')
          .eq('id', data.user.id)
          .single();

        if (membro?.is_admin) {
          const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
          if (isMobile) {
            window.location.href = '/dashboard'; // Mobile -> Área de Membro
          } else {
            window.location.href = '/admin/dashboard'; // Desktop -> Área de Admin
          }
        } else {
          window.location.href = '/dashboard';
        }
      } else {
        window.location.href = '/dashboard';
      }
    }
  };

  const handleResetPassword = async () => {
    if (!email) {
      setError('Por favor, digite seu e-mail no campo acima antes de clicar em recuperar senha.');
      return;
    }
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/update-password`,
    });

    if (error) {
      setError(`Erro ao enviar e-mail: ${error.message}`);
    } else {
      setResetMessage('E-mail de redefinição enviado! Verifique sua caixa de entrada.');
    }
    setLoading(false);
  };

  return (
    <div className="flex flex-col justify-center min-h-screen px-6 bg-gray-50 dark:bg-gray-700/50">
      <div className="w-full max-w-sm mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold text-gray-900 dark:text-gray-50">Escala Sessão TRT20</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2">Escala de suporte às sessões do 2º Grau</p>
        </div>

        {error && (
          <div className="p-3 mb-4 text-sm text-red-700 bg-red-100 rounded-lg">
            {error}
          </div>
        )}
        
        {resetMessage && (
          <div className="p-3 mb-4 text-sm text-green-700 bg-green-100 rounded-lg">
            {resetMessage}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">E-mail</label>
            <input 
              type="email" required
              className="w-full px-4 py-3 mt-1 text-base border rounded-xl focus:ring-blue-500 focus:border-blue-500"
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">Senha</label>
            <div className="relative mt-1">
              <input 
                type={showPassword ? 'text' : 'password'} required
                className="w-full px-4 py-3 text-base border rounded-xl focus:ring-blue-500 focus:border-blue-500 pr-12"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 px-4 flex items-center text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          <button 
            type="submit" disabled={loading}
            className="w-full py-3.5 text-base font-bold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50 shadow-sm"
          >
            {loading ? 'Aguarde...' : 'Entrar'}
          </button>
        </form>
        
        <div className="mt-6 text-center">
          <button 
            type="button"
            onClick={handleResetPassword}
            disabled={loading}
            className="text-sm font-medium text-blue-600 hover:text-blue-500 disabled:opacity-50"
          >
            Esqueceu sua senha?
          </button>
        </div>
      </div>
    </div>
  );
};

export default Login;
