import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { CalendarCheck, Copy, PlugZap, RefreshCw, Save, Unplug } from 'lucide-react';
import AdminLayout from '../../layouts/AdminLayout';
import CustomDatePicker from '../../components/CustomDatePicker';
import { googleAgenda, GoogleAgendaStatus } from '../../services/googleAgendaService';
import { getLocalDateStr } from '../../utils/date';

// Conexão com a agenda compartilhada do Google. Depois de salva e ativa, o
// banco avisa a Edge Function sync-google-calendar sempre que a escala é
// publicada ou uma escala publicada muda (supabase/sql/06_google_agenda.sql).

const inputClass = 'block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-sm';
const botaoSecundario = 'flex items-center justify-center px-4 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 font-medium rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50';

const GoogleCalendarSettings = () => {
  const [status, setStatus] = useState<GoogleAgendaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [calendarId, setCalendarId] = useState('');
  const [serviceAccount, setServiceAccount] = useState('');
  const [ativo, setAtivo] = useState(true);
  const [mesSync, setMesSync] = useState<Date>(new Date());
  const [acaoEmCurso, setAcaoEmCurso] = useState<string | null>(null);

  const carregar = async () => {
    try {
      const s = await googleAgenda<GoogleAgendaStatus>('status');
      setStatus(s);
      setCalendarId(s.calendar_id);
      setAtivo(s.configurado ? s.ativo : true);
    } catch (err: any) {
      toast.error('Erro ao carregar a configuração: ' + err.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    carregar();
  }, []);

  const executar = async (acao: string, fn: () => Promise<void>) => {
    setAcaoEmCurso(acao);
    try {
      await fn();
    } catch (err: any) {
      toast.error(err.message);
    }
    setAcaoEmCurso(null);
  };

  const handleSalvar = () => executar('salvar', async () => {
    await googleAgenda('salvar', { calendar_id: calendarId, service_account: serviceAccount, ativo });
    setServiceAccount('');
    await carregar();
    toast.success('Configuração salva.');
  });

  const handleTestar = () => executar('testar', async () => {
    const r = await googleAgenda<{ agenda: string }>('testar');
    toast.success(`Conectado à agenda "${r.agenda}".`);
  });

  const handleSincronizar = () => executar('sincronizar', async () => {
    const inicio = new Date(mesSync.getFullYear(), mesSync.getMonth(), 1);
    const fim = new Date(mesSync.getFullYear(), mesSync.getMonth() + 1, 0);
    const r = await googleAgenda<{ sincronizadas: number; falhas: number; erro?: string }>('sincronizar', {
      inicio: getLocalDateStr(inicio),
      fim: getLocalDateStr(fim),
    });
    if (r.falhas) toast.error(`${r.sincronizadas} evento(s) sincronizado(s), ${r.falhas} com erro: ${r.erro}`);
    else toast.success(r.sincronizadas ? `${r.sincronizadas} evento(s) sincronizado(s).` : 'Nenhuma sessão publicada ou ausência neste mês.');
  });

  const handleDesconectar = () => executar('desconectar', async () => {
    if (!window.confirm('Remover a conexão com o Google Agenda? Os eventos já criados continuam na agenda.')) return;
    await googleAgenda('desconectar');
    setCalendarId('');
    setServiceAccount('');
    await carregar();
    toast.success('Conexão removida.');
  });

  const copiarEmail = () => {
    if (!status?.client_email) return;
    navigator.clipboard.writeText(status.client_email).then(() => toast.success('E-mail copiado.'));
  };

  return (
    <AdminLayout>
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-gray-800 dark:text-gray-100">Google Agenda</h2>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Mantém uma agenda compartilhada do Google igual à escala publicada: um evento por sessão com os escalados.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
        </div>
      ) : (
        <div className="space-y-6 max-w-3xl">
          {/* Situação atual */}
          <div className="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm flex items-start gap-4">
            <div className={`p-3 rounded-xl ${status?.configurado && status.ativo ? 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
              <CalendarCheck className="w-6 h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-gray-900 dark:text-gray-100">
                {!status?.configurado ? 'Não conectado' : status.ativo ? 'Sincronização ativa' : 'Sincronização pausada'}
              </p>
              {status?.configurado && (
                <p className="text-sm text-gray-500 dark:text-gray-400 break-all">
                  Agenda: {status.calendar_id}
                  {status.atualizado_em && ` · atualizado em ${new Date(status.atualizado_em).toLocaleString('pt-BR')}`}
                </p>
              )}
            </div>
          </div>

          {/* Configuração */}
          <div className="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-5">
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-50">Conexão</h3>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Chave JSON da Service Account</label>
              {status?.client_email && (
                <div className="mb-2 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                  <span className="break-all">Cadastrada: <strong>{status.client_email}</strong></span>
                  <button onClick={copiarEmail} title="Copiar e-mail" className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              )}
              <textarea
                value={serviceAccount}
                onChange={e => setServiceAccount(e.target.value)}
                rows={5}
                spellCheck={false}
                placeholder={status?.client_email ? 'Deixe em branco para manter a chave atual' : '{ "type": "service_account", "client_email": "...", "private_key": "..." }'}
                className={`${inputClass} font-mono text-xs`}
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                A chave fica guardada no servidor e não é exibida novamente.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ID da agenda</label>
              <input
                value={calendarId}
                onChange={e => setCalendarId(e.target.value)}
                placeholder="xxxxxxxx@group.calendar.google.com"
                className={inputClass}
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                No Google Agenda: Configurações da agenda → Integrar agenda → ID da agenda.
              </p>
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={ativo} onChange={e => setAtivo(e.target.checked)} className="rounded text-blue-600 focus:ring-blue-500 h-4 w-4" />
              <span className="text-sm text-gray-800 dark:text-gray-200">Sincronizar automaticamente ao publicar e ao alterar escalas publicadas</span>
            </label>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                onClick={handleSalvar}
                disabled={!!acaoEmCurso}
                className="flex items-center justify-center px-4 py-2.5 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 shadow-sm transition-colors disabled:opacity-50"
              >
                <Save className="w-5 h-5 mr-2" />
                {acaoEmCurso === 'salvar' ? 'Salvando...' : 'Salvar'}
              </button>
              <button onClick={handleTestar} disabled={!!acaoEmCurso || !status?.configurado} className={botaoSecundario}>
                <PlugZap className="w-5 h-5 mr-2" />
                {acaoEmCurso === 'testar' ? 'Testando...' : 'Testar conexão'}
              </button>
              {status?.configurado && (
                <button onClick={handleDesconectar} disabled={!!acaoEmCurso} className={`${botaoSecundario} sm:ml-auto text-red-600 dark:text-red-400`}>
                  <Unplug className="w-5 h-5 mr-2" />
                  Desconectar
                </button>
              )}
            </div>
          </div>

          {/* Sincronização manual */}
          {status?.configurado && (
            <div className="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-50">Sincronizar um mês</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Envia agora todas as sessões publicadas e as ausências do mês, por exemplo para meses publicados antes da conexão.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                <div className="w-full sm:w-48">
                  <CustomDatePicker
                    selected={mesSync}
                    onChange={(d: Date | null) => d && setMesSync(d)}
                    dateFormat="MM/yyyy"
                    showMonthYearPicker
                  />
                </div>
                <button onClick={handleSincronizar} disabled={!!acaoEmCurso} className={botaoSecundario}>
                  <RefreshCw className={`w-5 h-5 mr-2 ${acaoEmCurso === 'sincronizar' ? 'animate-spin' : ''}`} />
                  {acaoEmCurso === 'sincronizar' ? 'Sincronizando...' : 'Sincronizar mês'}
                </button>
              </div>
            </div>
          )}

          {/* Passo a passo */}
          <div className="bg-blue-50 dark:bg-blue-900/20 p-5 rounded-2xl border border-blue-100 dark:border-blue-900/40 text-sm text-gray-700 dark:text-gray-300">
            <h3 className="font-bold text-gray-900 dark:text-gray-100 mb-2">Como conectar</h3>
            <ol className="list-decimal pl-5 space-y-1">
              <li>No Google Cloud Console, ative a <strong>Google Calendar API</strong> e crie uma <strong>Service Account</strong>.</li>
              <li>Na Service Account, em <em>Chaves</em>, crie uma chave do tipo <strong>JSON</strong> e cole o conteúdo acima.</li>
              <li>No Google Agenda, compartilhe a agenda com o e-mail da Service Account com a permissão <strong>"Fazer alterações nos eventos"</strong>.</li>
              <li>Informe o ID da agenda, salve e clique em <strong>Testar conexão</strong>.</li>
            </ol>
          </div>
        </div>
      )}
    </AdminLayout>
  );
};

export default GoogleCalendarSettings;
