import React, { useState } from 'react';
import { supabase } from '../../services/supabaseClient';
import AdminLayout from '../../layouts/AdminLayout';
import { Camera, CheckCircle2, Shield } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const SENHA_PADRAO = '12Mudar34';

const AddMember = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    nome: '',
    email: '',
    celular_whatsapp: '',
    ativo: true,
    is_admin: false
  });
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const formatPhone = (value: string) => {
    let v = value.replace(/\D/g, "");
    v = v.substring(0, 11);
    if (v.length > 2) {
      v = `(${v.substring(0, 2)}) ${v.substring(2)}`;
    }
    if (v.length > 10) {
      v = `${v.substring(0, 10)}-${v.substring(10)}`;
    }
    return v;
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setPhotoFile(file);
      setPhotoPreview(URL.createObjectURL(file));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      let foto_url = '';

      // Upload da foto caso exista
      if (photoFile) {
        const fileExt = photoFile.name.split('.').pop();
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
        const filePath = `avatares/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('fotos-membros')
          .upload(filePath, photoFile);

        if (uploadError) throw new Error(`Erro no upload da foto: ${uploadError.message}`);

        const { data: urlData } = supabase.storage.from('fotos-membros').getPublicUrl(filePath);
        foto_url = urlData.publicUrl;
      }

      // A Edge Function cria o usuário no Auth e o registro em `membros`
      const { data, error } = await supabase.functions.invoke('create-member', {
        body: { ...formData, password: SENHA_PADRAO, foto_url }
      });

      if (error) throw error;
      if (data && data.error) throw new Error(data.error);

      setMessage(`Membro cadastrado com sucesso! A senha padrão de acesso é: ${SENHA_PADRAO}`);

      setFormData({ nome: '', email: '', celular_whatsapp: '', ativo: true, is_admin: false });
      setPhotoFile(null);
      setPhotoPreview(null);

      setTimeout(() => {
        navigate('/admin/membros');
      }, 2000);

    } catch (error: any) {
      setMessage(`Erro: ${error.message || 'Falha ao cadastrar.'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AdminLayout>
      <div className="max-w-xl mx-auto p-6 bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
        <h2 className="mb-6 text-2xl font-bold text-gray-800 dark:text-gray-100">Cadastrar Novo Membro</h2>

        {message && (
          <div className={`p-4 mb-6 text-sm rounded-xl font-medium ${message.includes('Erro') ? 'bg-red-50 text-red-700 border border-red-100' : 'bg-green-50 text-green-700 border border-green-100'}`}>
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">

          {/* Seção da Foto */}
          <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
            <input
              type="file"
              accept="image/*"
              onChange={handlePhotoChange}
              className="hidden"
              id="photo-upload"
            />
            <label htmlFor="photo-upload" className="cursor-pointer flex flex-col items-center">
              {photoPreview ? (
                <img src={photoPreview} alt="Preview" className="w-24 h-24 rounded-full object-cover shadow-sm border-4 border-white mb-3" />
              ) : (
                <div className="w-20 h-20 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center mb-3 shadow-sm">
                  <Camera className="w-8 h-8" />
                </div>
              )}
              <span className="text-sm font-bold text-gray-700 dark:text-gray-200">{photoPreview ? 'Trocar Foto' : 'Adicionar Foto (Opcional)'}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-center">Clique para escolher uma imagem do seu dispositivo</span>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Nome Completo</label>
              <input
                type="text" required
                className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 dark:text-white"
                value={formData.nome}
                onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">E-mail</label>
              <input
                type="email" required
                className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 dark:text-white"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Celular (WhatsApp)</label>
              <input
                type="tel"
                className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 dark:text-white"
                value={formData.celular_whatsapp}
                onChange={(e) => setFormData({ ...formData, celular_whatsapp: formatPhone(e.target.value) })}
              />
            </div>
          </div>

          {/* Seção Membro Ativo/Inativo */}
          <div className="mt-4 p-4 rounded-xl border border-green-100 dark:border-green-900/50 bg-green-50 dark:bg-green-900/20 flex items-center justify-between cursor-pointer" onClick={() => setFormData({ ...formData, ativo: !formData.ativo })}>
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${formData.ativo ? 'bg-green-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-400'}`}>
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-800 dark:text-gray-100">Membro Ativo?</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Sinaliza que este membro pode ser escalado nas sessões.</p>
              </div>
            </div>
            <div className="relative">
              <input type="checkbox" className="sr-only" checked={formData.ativo} onChange={() => { }} />
              <div className={`block w-10 h-6 rounded-full transition-colors ${formData.ativo ? 'bg-green-600' : 'bg-gray-300 dark:bg-gray-600'}`}></div>
              <div className={`absolute left-1 top-1 bg-white dark:bg-gray-800 w-4 h-4 rounded-full transition-transform ${formData.ativo ? 'transform translate-x-4' : ''}`}></div>
            </div>
          </div>

          {/* Seção Administrador */}
          <div className="mt-4 p-4 rounded-xl border border-amber-100 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 flex items-center justify-between cursor-pointer" onClick={() => setFormData({ ...formData, is_admin: !formData.is_admin })}>
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${formData.is_admin ? 'bg-amber-500 text-white' : 'bg-white dark:bg-gray-800 text-gray-400'}`}>
                <Shield className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-800 dark:text-gray-100">Administrador?</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Pode montar escalas, cadastrar membros e lançar presenças.</p>
              </div>
            </div>
            <div className="relative">
              <input type="checkbox" className="sr-only" checked={formData.is_admin} onChange={() => { }} />
              <div className={`block w-10 h-6 rounded-full transition-colors ${formData.is_admin ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-600'}`}></div>
              <div className={`absolute left-1 top-1 bg-white dark:bg-gray-800 w-4 h-4 rounded-full transition-transform ${formData.is_admin ? 'transform translate-x-4' : ''}`}></div>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 mt-6 text-base font-bold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
          >
            {loading ? 'Cadastrando Membro...' : 'Cadastrar Membro'}
          </button>
        </form>
      </div>
    </AdminLayout>
  );
};

export default AddMember;
