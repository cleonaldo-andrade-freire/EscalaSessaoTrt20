# Escala Sessão TRT20

PWA para a escala dos técnicos de **Suporte PJe** nas sessões do 2º Grau do TRT20
(**1ª Turma**, **2ª Turma** e **Pleno**), com registro de **check-in** e **check-out**.

- Escala montada manualmente pelo administrador (sem geração automática).
- Cada sessão tem horário de início; os escalados recebem lembrete automático 20 min antes.
- Técnico faz check-in ao chegar e check-out ao final, no próprio celular. O horário é gravado pelo servidor.
- Administrador pode lançar check-in/check-out manualmente (com horário) e marcar faltas.
- Permutas entre técnicos, ausências programadas e avisos (app + WhatsApp opcional).

Stack: React 19 + Vite + Tailwind, Supabase (Postgres, Auth, Storage, Edge Functions).

## Criando o banco (projeto Supabase novo)

1. Crie um projeto no [Supabase](https://supabase.com).
2. **SQL Editor** → execute, nesta ordem:
   1. `supabase/sql/01_schema.sql` — tabelas, RLS, funções de check-in/check-out e templates.
   2. `supabase/sql/02_storage.sql` — bucket público `fotos-membros`.
3. **Authentication → Users → Add user** (marque *Auto Confirm User*) com o e-mail do primeiro administrador.
4. Edite e execute `supabase/sql/03_primeiro_admin.sql` com esse e-mail.
5. Lembrete automático **20 min antes** de cada sessão (WhatsApp + aviso no app): siga as instruções no topo de `supabase/sql/04_cron_lembretes.sql` (segredo `CRON_SECRET` + Vault). Bancos criados antes do campo de horário: rode também `05_migracao_horario_sessao.sql`.
6. Bancos criados antes das ausências por período: rode `supabase/sql/07_ausencias_periodo.sql`.
7. Google Agenda (opcional): edite e execute `supabase/sql/06_google_agenda.sql` (usa os mesmos segredos do Vault do passo 5) e faça o deploy de `sync-google-calendar`. A conexão com a agenda é feita no app, em **Admin → Google Agenda**.

## Edge Functions

Com a [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase login
supabase link --project-ref <SEU_PROJECT_REF>
supabase functions deploy create-member
supabase functions deploy update-member
supabase functions deploy delete-member
supabase functions deploy send-whatsapp
supabase functions deploy send-session-reminders
supabase functions deploy sync-google-calendar     # opcional (Google Agenda)
supabase functions deploy send-push-notification   # opcional
```

Secrets opcionais (Project Settings → Edge Functions):
- WhatsApp direto pela Evolution API (v2): `EVOLUTION_API_URL`, `EVOLUTION_INSTANCE` e `EVOLUTION_API_KEY` (token da instância). Alternativa: `N8N_WHATSAPP_WEBHOOK_URL` (lote enviado a um workflow do n8n), usada só se as variáveis da Evolution não existirem.
- `CRON_SECRET` — autoriza o pg_cron a chamar `send-session-reminders` (o mesmo valor fica no Vault como `cron_secret`).
- `FIREBASE_SERVICE_ACCOUNT_KEY` — push notifications (ver `send-push-notification`).

## Rodando localmente

```bash
npm install
cp .env.example .env   # preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm run dev            # http://localhost:3000
```

Senha padrão dos membros cadastrados pelo admin: `12Mudar34` (o membro pode trocar em "Esqueceu sua senha?").

## Configurações de domínio

- Sessões e funções: `src/constants.ts` (manter em sincronia com o `CHECK` de `escalas.tipo_sessao`).
- Para dois técnicos por sessão, adicione `'Suporte PJe 2'` em `FUNCOES_DISPONIVEIS`.

Documentação técnica: [PRD.md](PRD.md), [SDD.md](SDD.md) e [MEMORIA.md](MEMORIA.md).
