import toast from 'react-hot-toast';
import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabaseClient';
import { sendWhatsApp } from '../../services/whatsappService';
import AdminLayout from '../../layouts/AdminLayout';
import { Search, UserPlus, Edit2, Trash2, X, Camera, Shield, CheckCircle2, MessageCircle } from 'lucide-react';

const MembersList = () => {
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Estados do Modal de Edição
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  // Estados do Modal de Exclusão
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [memberToDelete, setMemberToDelete] = useState<{ id: string, nome: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Estados do Modal de WhatsApp
  const [isWhatsAppModalOpen, setIsWhatsAppModalOpen] = useState(false);
  const [whatsAppTarget, setWhatsAppTarget] = useState<{ id: string, nome: string, phone: string } | null>(null);
  const [whatsAppMessage, setWhatsAppMessage] = useState('');
  const [isSendingWhatsApp, setIsSendingWhatsApp] = useState(false);

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

  const fetchMembers = async () => {
    setLoading(true);
    setErrorMsg(null);
    const { data, error } = await supabase
      .from('membros')
      .select(`
        id, nome, email, celular_whatsapp, foto_url, is_admin, ativo
      `)
      .order('nome', { ascending: true });

    if (error) {
      console.error('Erro ao buscar membros:', error);
      setErrorMsg(error.message || 'Erro desconhecido ao buscar membros');
    } else {
      setMembers(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchMembers();
  }, []);

  const confirmDelete = (userId: string, nome: string) => {
    setMemberToDelete({ id: userId, nome });
    setIsDeleteModalOpen(true);
  };

  const openWhatsAppModal = (member: any) => {
    setWhatsAppTarget({ id: member.id, nome: member.nome, phone: member.celular_whatsapp || '' });
    setWhatsAppMessage('');
    setIsWhatsAppModalOpen(true);
  };

  const handleSendWhatsApp = async () => {
    if (!whatsAppTarget || !whatsAppMessage.trim()) return;
    if (!whatsAppTarget.phone) {
      toast.error('Este membro não possui número de WhatsApp cadastrado.');
      return;
    }
    setIsSendingWhatsApp(true);
    try {
      const result = await sendWhatsApp([whatsAppTarget.id], whatsAppMessage);
      if (result.sent > 0) {
        toast.success(`✅ Mensagem enviada com sucesso para ${whatsAppTarget.nome}!`);
      } else {
        toast.error(`⚠️ Não foi possível enviar. Verifique se o número está correto.`);
      }
      setIsWhatsAppModalOpen(false);
      setWhatsAppMessage('');
    } catch (err: any) {
      toast('Erro ao enviar WhatsApp: ' + err.message);
    } finally {
      setIsSendingWhatsApp(false);
    }
  };

  const handleDelete = async () => {
    if (!memberToDelete) return;
    setIsDeleting(true);

    const { data, error } = await supabase.functions.invoke('delete-member', {
      body: { userId: memberToDelete.id }
    });

    if (error || (data && data.error)) {
      toast.error(`Erro ao excluir: ${error?.message || data?.error}`);
    } else {
      fetchMembers(); // recarrega a lista
    }

    setIsDeleting(false);
    setIsDeleteModalOpen(false);
    setMemberToDelete(null);
  };

  const openEditModal = (member: any) => {
    setEditingMember({
      id: member.id,
      nome: member.nome,
      email: member.email,
      celular_whatsapp: member.celular_whatsapp || '',
      emailOriginal: member.email,
      ativo: member.ativo ?? true,
      is_admin: member.is_admin ?? false,
      foto_url: member.foto_url || ''
    });
    setPhotoFile(null);
    setPhotoPreview(member.foto_url || null);
    setIsEditModalOpen(true);
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setPhotoFile(file);
      setPhotoPreview(URL.createObjectURL(file));
    }
  };

  const handleSaveEdit = async () => {
    if (!editingMember.nome || !editingMember.email) {
      toast.error("Nome e E-mail são obrigatórios!");
      return;
    }

    setIsSaving(true);
    try {
      let nova_foto_url = editingMember.foto_url;

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

      // Atualiza via Edge Function (service_role): dados do membro e, se o
      // e-mail mudou, também o login no Supabase Auth.
      const { data, error: edgeError } = await supabase.functions.invoke('update-member', {
        body: {
          userId: editingMember.id,
          nome: editingMember.nome,
          email: editingMember.email,
          celular_whatsapp: editingMember.celular_whatsapp,
          ativo: editingMember.ativo,
          is_admin: editingMember.is_admin,
          foto_url: nova_foto_url,
          updateAuth: editingMember.email !== editingMember.emailOriginal
        }
      });

      if (edgeError || (data && data.error)) {
        throw new Error(edgeError?.message || data?.error);
      }

      setIsEditModalOpen(false);
      fetchMembers(); // Recarrega os dados
    } catch (error: any) {
      toast('Erro ao salvar edições: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const filteredMembers = members.filter(m => {
    const nome = m.nome || '';
    const email = m.email || '';
    const term = searchTerm.toLowerCase();
    return nome.toLowerCase().includes(term) || email.toLowerCase().includes(term);
  });

  return (
    <AdminLayout>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h2 className="text-3xl font-bold text-gray-800 dark:text-gray-100">Equipe & Membros</h2>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Gerencie os técnicos de suporte às sessões.</p>
        </div>

        <button onClick={() => window.location.href = '/admin/membros/novo'}
          className="flex items-center px-4 py-2.5 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 shadow-sm transition-colors">
          <UserPlus className="w-5 h-5 mr-2" />
          Cadastrar Membro
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 p-4 rounded-t-2xl border border-gray-200 dark:border-gray-700 border-b-0 flex items-center shadow-sm">
        <div className="relative w-full max-w-md">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-gray-400" />
          </div>
          <input
            type="text"
            className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg leading-5 bg-white dark:bg-gray-800 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-sm"
            placeholder="Buscar por nome ou e-mail..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm rounded-b-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Membro</th>
                <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Telefone</th>
                <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                <th scope="col" className="px-6 py-4 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Ações</th>
              </tr>
            </thead>

            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                    <div className="flex justify-center items-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    </div>
                  </td>
                </tr>
              ) : errorMsg ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-red-600 font-bold">
                    Erro ao carregar membros: {errorMsg}
                  </td>
                </tr>
              ) : filteredMembers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">Nenhum membro encontrado.</td>
                </tr>
              ) : (
                filteredMembers.map((member) => (
                  <tr key={member.id} className="hover:bg-blue-50/30 transition-colors">

                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold overflow-hidden">
                          {member.foto_url ? (
                            <img src={member.foto_url} alt={member.nome} className="w-full h-full object-cover" />
                          ) : (
                            member.nome.charAt(0).toUpperCase()
                          )}
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-bold text-gray-900 dark:text-gray-50 flex items-center gap-2">
                            {member.nome}
                            {member.is_admin && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-amber-50 border-amber-200 text-amber-700 text-[10px] font-bold tracking-wide uppercase shadow-sm" title="Administrador do Sistema">
                                <Shield className="w-2.5 h-2.5" />
                                Admin
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{member.email}</div>
                        </div>
                      </div>
                    </td>

                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">
                      {member.celular_whatsapp || <span className="text-xs text-gray-400 italic">Não informado</span>}
                    </td>

                    <td className="px-6 py-4">
                      {member.ativo === false ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-800 border border-red-200">
                          Inativo
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-green-100 text-green-800 border border-green-200">
                          Ativo
                        </span>
                      )}
                    </td>

                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openWhatsAppModal(member)}
                          className="flex items-center justify-center w-8 h-8 text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:text-green-600 hover:border-green-300 hover:bg-green-50 shadow-sm hover:shadow transition-all"
                          title={member.celular_whatsapp ? `Enviar WhatsApp para ${member.nome}` : 'WhatsApp não cadastrado'}
                        >
                          <MessageCircle className="w-4 h-4" />
                        </button>
                        <button onClick={() => openEditModal(member)} className="flex items-center justify-center w-8 h-8 text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50 shadow-sm hover:shadow transition-all" title="Editar Membro">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => confirmDelete(member.id, member.nome)} className="flex items-center justify-center w-8 h-8 text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:text-red-600 hover:border-red-300 hover:bg-red-50 shadow-sm hover:shadow transition-all" title="Remover Membro">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>

                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL DE WHATSAPP */}
      {isWhatsAppModalOpen && whatsAppTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
            <div className="flex justify-between items-center p-5 border-b border-gray-100 dark:border-gray-700 bg-green-50/50 dark:bg-green-900/20">
              <h3 className="text-lg font-bold text-green-800 dark:text-green-200 flex items-center gap-2">
                <MessageCircle className="w-5 h-5" />
                Enviar WhatsApp
              </h3>
              <button onClick={() => setIsWhatsAppModalOpen(false)} className="text-gray-400 hover:text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl border border-gray-200 dark:border-gray-700">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center text-green-700 dark:text-green-300 font-bold">
                  {whatsAppTarget.nome.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900 dark:text-gray-50">{whatsAppTarget.nome}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {whatsAppTarget.phone || <span className="text-red-500 italic">Sem número cadastrado</span>}
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-800 dark:text-gray-100 mb-2">Mensagem</label>
                <textarea
                  rows={4}
                  value={whatsAppMessage}
                  onChange={e => setWhatsAppMessage(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-green-500 focus:border-green-500 resize-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  placeholder="Digite a mensagem que será enviada via WhatsApp..."
                />
              </div>

              {!whatsAppTarget.phone && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl">
                  <span className="text-amber-600 mt-0.5">⚠️</span>
                  <p className="text-xs text-amber-800 dark:text-amber-300">Este membro não possui número de WhatsApp cadastrado.</p>
                </div>
              )}
            </div>

            <div className="p-5 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex justify-end gap-3">
              <button
                onClick={() => setIsWhatsAppModalOpen(false)}
                disabled={isSendingWhatsApp}
                className="px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 rounded-xl hover:bg-gray-50 disabled:opacity-50 transition-colors shadow-sm"
              >
                Cancelar
              </button>
              <button
                onClick={handleSendWhatsApp}
                disabled={isSendingWhatsApp || !whatsAppMessage.trim() || !whatsAppTarget.phone}
                className="px-4 py-2.5 text-sm font-medium text-white bg-green-600 rounded-xl hover:bg-green-700 disabled:opacity-50 flex items-center gap-2 transition-colors shadow-sm"
              >
                {isSendingWhatsApp ? (
                  <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white/40 border-t-white"></div> Enviando...</>
                ) : (
                  <><MessageCircle className="w-4 h-4" /> Enviar</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE EDIÇÃO */}
      {isEditModalOpen && editingMember && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black bg-opacity-50 overflow-y-auto">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg flex flex-col my-8">
            <div className="flex justify-between items-center p-5 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-50">Editar Membro</h3>
              <button onClick={() => setIsEditModalOpen(false)} className="text-gray-400 hover:text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 p-1 rounded-lg border border-gray-200 dark:border-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">

              {/* Seção da Foto */}
              <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-600 dark:bg-gray-700 transition-colors">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoChange}
                  className="hidden"
                  id="edit-photo-upload"
                />
                <label htmlFor="edit-photo-upload" className="cursor-pointer flex flex-col items-center">
                  {photoPreview ? (
                    <img src={photoPreview} alt="Preview" className="w-24 h-24 rounded-full object-cover shadow-sm border-4 border-white mb-3" />
                  ) : (
                    <div className="w-20 h-20 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center mb-3 shadow-sm">
                      <Camera className="w-8 h-8" />
                    </div>
                  )}
                  <span className="text-sm font-bold text-gray-700 dark:text-gray-200">{photoPreview ? 'Trocar Foto' : 'Adicionar Foto'}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-center">Clique para escolher uma imagem do seu dispositivo</span>
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Nome Completo</label>
                  <input
                    type="text"
                    value={editingMember.nome}
                    onChange={e => setEditingMember({ ...editingMember, nome: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">E-mail</label>
                  <input
                    type="email"
                    value={editingMember.email}
                    onChange={e => setEditingMember({ ...editingMember, email: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Celular (WhatsApp)</label>
                  <input
                    type="text"
                    value={editingMember.celular_whatsapp}
                    onChange={e => setEditingMember({ ...editingMember, celular_whatsapp: formatPhone(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Seção Ativo / Inativo */}
              <div className="p-3 mt-4 rounded-lg border border-green-100 dark:border-green-900 bg-green-50 dark:bg-green-900/30 flex items-center justify-between cursor-pointer" onClick={() => setEditingMember({ ...editingMember, ativo: !editingMember.ativo })}>
                <div className="flex items-center gap-3">
                  <div className={`p-1.5 rounded-lg ${editingMember.ativo ? 'bg-green-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-400'}`}>
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-800 dark:text-gray-100">Membro Ativo?</p>
                  </div>
                </div>
                <div className="relative">
                  <input type="checkbox" className="sr-only" checked={editingMember.ativo} onChange={() => { }} />
                  <div className={`block w-8 h-5 rounded-full transition-colors ${editingMember.ativo ? 'bg-green-600' : 'bg-gray-300'}`}></div>
                  <div className={`absolute left-0.5 top-0.5 bg-white dark:bg-gray-800 w-4 h-4 rounded-full transition-transform ${editingMember.ativo ? 'transform translate-x-3' : ''}`}></div>
                </div>
              </div>

              {/* Seção Administrador */}
              <div className="p-3 mt-4 rounded-lg border border-amber-100 dark:border-amber-900 bg-amber-50 dark:bg-amber-900/30 flex items-center justify-between cursor-pointer" onClick={() => setEditingMember({ ...editingMember, is_admin: !editingMember.is_admin })}>
                <div className="flex items-center gap-3">
                  <div className={`p-1.5 rounded-lg ${editingMember.is_admin ? 'bg-amber-500 text-white' : 'bg-white dark:bg-gray-800 text-gray-400'}`}>
                    <Shield className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-800 dark:text-gray-100">Administrador?</p>
                  </div>
                </div>
                <div className="relative">
                  <input type="checkbox" className="sr-only" checked={editingMember.is_admin} onChange={() => { }} />
                  <div className={`block w-8 h-5 rounded-full transition-colors ${editingMember.is_admin ? 'bg-amber-500' : 'bg-gray-300'}`}></div>
                  <div className={`absolute left-0.5 top-0.5 bg-white dark:bg-gray-800 w-4 h-4 rounded-full transition-transform ${editingMember.is_admin ? 'transform translate-x-3' : ''}`}></div>
                </div>
              </div>
            </div>

            <div className="p-5 border-t border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 flex justify-end gap-3">
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 dark:bg-gray-700/50"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={isSaving}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {isSaving ? 'Salvando...' : 'Salvar Alterações'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE CONFIRMAÇÃO DE EXCLUSÃO */}
      {isDeleteModalOpen && memberToDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col transform transition-all">
            <div className="flex justify-between items-center p-5 border-b border-gray-100 dark:border-gray-700 bg-red-50/50">
              <h3 className="text-lg font-bold text-red-700 flex items-center">
                <Trash2 className="w-5 h-5 mr-2" />
                Remover Membro
              </h3>
              <button onClick={() => setIsDeleteModalOpen(false)} className="text-gray-400 hover:text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 dark:bg-gray-700/50 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              <p className="text-gray-700 dark:text-gray-200 mb-4 text-[15px]">
                Tem certeza que deseja remover DEFINITIVAMENTE o membro <span className="font-bold text-gray-900 dark:text-gray-50">{memberToDelete.nome}</span>?
              </p>
              <div className="bg-red-50 text-red-800 p-4 rounded-xl text-sm border border-red-100 flex items-start">
                <div className="mt-0.5 mr-3 text-red-500">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
                </div>
                Esta ação não pode ser desfeita. Se o membro já tiver escalas registradas, a exclusão será bloqueada para preservar o histórico de check-in/check-out — nesse caso, marque-o como inativo.
              </div>
            </div>

            <div className="p-5 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50/80 flex justify-end gap-3">
              <button
                onClick={() => setIsDeleteModalOpen(false)}
                disabled={isDeleting}
                className="px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 dark:bg-gray-700/50 disabled:opacity-50 transition-colors shadow-sm"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="px-4 py-2.5 text-sm font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 disabled:opacity-50 flex items-center transition-colors shadow-sm"
              >
                {isDeleting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white/40 border-t-white mr-2"></div>
                    Removendo...
                  </>
                ) : 'Sim, Remover Membro'}
              </button>
            </div>
          </div>
        </div>
      )}

    </AdminLayout>
  );
};

export default MembersList;
