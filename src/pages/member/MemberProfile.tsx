import toast from 'react-hot-toast';
import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabaseClient';
import MemberLayout from '../../layouts/MemberLayout';
import { Camera, Save, LogOut, Plus } from 'lucide-react';

const MemberProfile = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  
  const [formData, setFormData] = useState({
    id: '',
    nome: '',
    email: '',
    celular_whatsapp: '',
    foto_url: ''
  });
  
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: membro } = await supabase
          .from('membros')
          .select('id, nome, email, celular_whatsapp, foto_url')
          .eq('id', user.id)
          .single();
          
        if (membro) {
          setFormData({
            id: membro.id,
            nome: membro.nome,
            email: membro.email,
            celular_whatsapp: membro.celular_whatsapp || '',
            foto_url: membro.foto_url || ''
          });
          setPhotoPreview(membro.foto_url || null);
        }
      }
      setLoading(false);
    };
    
    fetchUser();
  }, []);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setPhotoFile(file);
      setPhotoPreview(URL.createObjectURL(file));
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    
    try {
      let nova_foto_url = formData.foto_url;

      // 1. Upload de foto (storage não tem RLS restritiva)
      if (photoFile) {
        const fileExt = photoFile.name.split('.').pop();
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
        const filePath = `avatares/${fileName}`;
        
        const { error: uploadError } = await supabase.storage
          .from('fotos-membros')
          .upload(filePath, photoFile);
          
        if (uploadError) throw new Error(`Erro no upload da foto: ${uploadError.message}`);
        
        const { data: urlData } = supabase.storage.from('fotos-membros').getPublicUrl(filePath);
        nova_foto_url = urlData.publicUrl;
      }

      // 2. Usa a Edge Function update-member (service_role); o técnico só pode
      // alterar o próprio telefone e foto.
      const { data, error: edgeError } = await supabase.functions.invoke('update-member', {
        body: {
          userId: formData.id,
          celular_whatsapp: formData.celular_whatsapp,
          foto_url: nova_foto_url
        }
      });

      if (edgeError) throw edgeError;
      if (data?.error) throw new Error(data.error);
      
      setFormData(prev => ({ ...prev, foto_url: nova_foto_url }));
      setMessage('Perfil atualizado com sucesso!');
      setTimeout(() => setMessage(''), 3000);
      
    } catch (err: any) {
      toast('Erro ao salvar perfil: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return (
    <MemberLayout activeTab="perfil">
      <div className="bg-blue-600 px-6 pt-12 pb-24 text-white shadow-md rounded-b-3xl relative">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-blue-100 text-sm font-medium">Configurações</p>
            <h1 className="text-2xl font-black">Meu Perfil</h1>
          </div>
          <button onClick={handleLogout} className="w-10 h-10 bg-white dark:bg-gray-800/20 rounded-full flex items-center justify-center backdrop-blur-sm border border-white/30 text-white hover:bg-white dark:bg-gray-800/30 transition-colors" title="Sair da Conta">
            <LogOut className="w-5 h-5 ml-1" />
          </button>
        </div>
      </div>

      <div className="px-5 -mt-16 relative z-10 space-y-5 pb-8">
        
        {loading ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-700 animate-pulse h-96"></div>
        ) : (
          <form onSubmit={handleSave} className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            
            {/* Foto Section */}
            <div className="bg-gray-50 dark:bg-gray-700/50 p-6 flex flex-col items-center justify-center border-b border-gray-100 dark:border-gray-700">
              <input 
                type="file" 
                accept="image/*" 
                onChange={handlePhotoChange} 
                className="hidden" 
                id="profile-photo-upload"
              />
              <label htmlFor="profile-photo-upload" className="cursor-pointer flex flex-col items-center group relative">
                {photoPreview ? (
                  <div className="relative w-28 h-28">
                    <img src={photoPreview} alt="Preview" className="w-28 h-28 rounded-full object-cover shadow-md border-4 border-white" />
                    <div className="absolute bottom-0 right-0 bg-blue-600 text-white p-2 rounded-full border-2 border-white shadow-sm">
                      <Camera className="w-4 h-4" />
                    </div>
                  </div>
                ) : (
                  <div className="relative w-28 h-28 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shadow-md border-4 border-white">
                    <Camera className="w-10 h-10" />
                    <div className="absolute bottom-0 right-0 bg-blue-600 text-white p-2 rounded-full border-2 border-white shadow-sm">
                      <Plus className="w-4 h-4" />
                    </div>
                  </div>
                )}
                <span className="text-sm font-bold text-gray-700 dark:text-gray-200 mt-4">Alterar Foto</span>
              </label>
            </div>

            <div className="p-6 space-y-4">
              {message && (
                <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl text-sm font-medium text-center">
                  {message}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5 ml-1">Nome Completo</label>
                <input 
                  type="text" 
                  value={formData.nome} 
                  disabled
                  className="w-full px-4 py-3 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 rounded-xl opacity-70"
                />
                <p className="text-[10px] text-gray-400 mt-1 ml-1">Para alterar seu nome, contate o administrador.</p>
              </div>
              
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5 ml-1">E-mail (Login)</label>
                <input 
                  type="email" 
                  value={formData.email} 
                  disabled
                  className="w-full px-4 py-3 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 rounded-xl opacity-70"
                />
                <p className="text-[10px] text-gray-400 mt-1 ml-1">Para alterar o e-mail de acesso, contate o administrador.</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5 ml-1">Celular (WhatsApp)</label>
                <input 
                  type="tel" 
                  value={formData.celular_whatsapp} 
                  onChange={e => setFormData({...formData, celular_whatsapp: e.target.value})}
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white dark:bg-gray-800 transition-colors"
                />
              </div>

              <button 
                type="submit" 
                disabled={saving}
                className="w-full mt-6 py-4 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 active:bg-blue-800 transition-colors flex justify-center items-center gap-2 shadow-sm"
              >
                {saving ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                ) : (
                  <>
                    <Save className="w-5 h-5" />
                    Salvar Alterações
                  </>
                )}
              </button>

            </div>
          </form>
        )}
      </div>
    </MemberLayout>
  );
};

export default MemberProfile;
