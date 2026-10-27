# PRD — Escala Sessão TRT20

> **Versão:** 2.0 (adaptado do Sistema de Escalas de Mídia)
> **Data:** 2026-10-25
> **Status:** Fonte da Verdade

---

## 1. Visão Geral

PWA para organizar a escala dos técnicos que dão **Suporte PJe** às sessões do 2º Grau do TRT20 — **1ª Turma**, **2ª Turma** e **Pleno** (em geral 2 a 3 sessões por semana) — e registrar o horário de **check-in** e **check-out** de cada técnico.

- Escala montada **manualmente** pelo administrador (equipe pequena).
- Sem gamificação (moedas, pontos, assiduidade).
- Cadastro do membro: **nome, e-mail, telefone (WhatsApp) e foto**.

## 2. Personas

| Persona | Acesso | Jornadas |
|---|---|---|
| Técnico (membro) | Celular (PWA) | Ver próximas escalas; check-in ao chegar; check-out ao sair; pedir/aceitar permuta; registrar ausência; ler avisos |
| Administrador | Desktop (e celular como membro) | Montar escala; lançar presença manual; marcar falta; gerenciar membros, permutas e avisos |

## 3. Módulos e Rotas

| Módulo | Rotas | Perfil |
|---|---|---|
| App do Membro | `/dashboard`, `/escalas-geral`, `/substituicoes`, `/avisos`, `/ausencias`, `/perfil` | Membro |
| Painel Admin | `/admin/dashboard`, `/admin/escalas`, `/admin/membros`, `/admin/membros/novo`, `/admin/avisos`, `/admin/ausencias`, `/admin/permutas`, `/admin/relatorio-faltas`, `/admin/relatorio-presenca` | Admin |
| Autenticação | `/login`, `/update-password` | Público |

## 4. Funcionalidades

### 4.1 Autenticação
Login por e-mail/senha, recuperação de senha, sessão persistente, redirecionamento admin desktop → painel / mobile → app.

### 4.2 Dashboard do Membro (`/dashboard`)
| ID | Funcionalidade |
|---|---|
| MBR-01 | Saudação com nome e foto |
| MBR-03 | Próximas escalas (publicadas, a partir de hoje) |
| MBR-05 | **Fazer Check-in** (somente no dia da sessão) — grava `checkin_em` (horário do servidor) |
| MBR-05b | **Fazer Check-out** (após check-in, no dia) — grava `checkout_em`; exibe tempo de suporte |
| MBR-06 | Modal de confirmação para check-in/check-out |
| MBR-07/08 | Pedir / cancelar permuta (motivo obrigatório; WhatsApp para os colegas ativos) |
| MBR-10 | Histórico com presença/falta e horários de entrada/saída |

### 4.3 Escala Geral (`/escalas-geral`)
Escalas futuras agrupadas por data/sessão com horários registrados. Para admin: presenças pendentes dos últimos 14 dias (sem check-in, falta ou sem check-out), check-in/check-out manual com horário e envio de aviso aos escalados.

### 4.4 Permutas (`/substituicoes`)
Mantidas do sistema original: permuta simples (cobertura) e de mão dupla, com validação de conflito de data/sessão e aviso por WhatsApp.

### 4.5 Avisos, Ausências e Perfil
- Avisos: lista, marcar como lido; admin cria avisos (app + WhatsApp).
- Ausências programadas: o membro cadastra/exclui as próprias; o admin vê todas e recebe alerta ao escalar alguém ausente.
- Perfil: membro edita **telefone e foto** (nome e e-mail só pelo admin).

### 4.6 Painel Admin
| ID | Funcionalidade |
|---|---|
| ADM-01 | Cards: membros ativos, permutas pendentes, escalados hoje/amanhã |
| ADM-05 | **Check-outs pendentes** (últimos 30 dias) |
| ADM-06 | **Sessões atendidas no ano** por membro, com horas de suporte |
| ADM-10..15 | Gerenciar escalas: lista e calendário mensal, filtros, criar/editar/excluir (manual) |
| ADM-21 | Check-in / check-out manual com horário; marcar/desmarcar falta |
| ADM-12b | Sessão com **horário de início** obrigatório |
| ADM-22 | Aviso aos escalados com template por sessão (`{{sessao}}`, `{{data}}`, `{{horario}}`, `{{escalados}}`) |
| ADM-23 | **Lembrete automático 20 min antes** do início (WhatsApp + aviso no app), uma vez por sessão; reenviado se data/horário forem alterados |
| ADM-24 | Validação: mesmo membro não pode ocupar duas funções na mesma sessão |
| ADM-30..35 | Membros: lista, busca, edição (nome, e-mail, telefone, foto, ativo, admin), WhatsApp individual, exclusão |
| ADM-40 | Cadastro de membro via Edge Function `create-member` (somente admin) |
| ADM-60 | Ausências programadas (somente leitura) |
| ADM-70..76 | Permutas: filtros, registrar substituto, desfazer, check-in, excluir |
| ADM-80 | Relatório de faltas por sessão e período |
| ADM-85 | **Relatório de Presença** (`/admin/relatorio-presenca`): filtros por período, sessão e técnico; check-in, check-out, duração e quem registrou; resumo por técnico (sessões, presenças, faltas, sem check-out, horas); exportação CSV para Excel |

> Exclusão de membro é bloqueada se ele tiver escalas (preserva o histórico de presença) — use "inativo".

### 4.7 Removido em relação ao sistema original
Gerador automático de escala mensal, rascunho/publicação mensal, modo troca visual, grupos de preferência, funções/disponibilidade por membro, iPhone, moedas/pontos/assiduidade/ranking de moedas.

## 5. Notificações

| Canal | Uso |
|---|---|
| Aviso no app (`avisos`) | Lembretes, permutas, comunicados |
| WhatsApp (Edge Function → n8n) | Avisos, permutas e lembrete 20 min antes da sessão (`send-session-reminders` via pg_cron a cada minuto) |
| Push (FCM) | Infraestrutura presente, não ativada na UI |
| Google Agenda (opcional) | Agenda compartilhada atualizada ao publicar o mês e a cada mudança em escala publicada; conexão configurada em Admin → Google Agenda |

## 6. Domínio

| Sessão | Observação |
|---|---|
| 1ª Turma | Qualquer dia |
| 2ª Turma | Qualquer dia |
| Pleno | Qualquer dia |

Função inicial: **Suporte PJe** (um slot por sessão; extensível em `src/constants.ts`).

## 7. Dívidas Técnicas

| ID | Descrição | Criticidade |
|---|---|---|
| DT-05 | `status_substituicao = 'Troca Rejeitada'` existe no schema sem UI | Baixa |
| DT-08 | `send-whatsapp` aceita qualquer usuário autenticado (usado nas permutas dos membros) | Média |
| DT-09 | Senha padrão fixa (`12Mudar34`) no cadastro; não há troca obrigatória no primeiro acesso | Média |
| DT-10 | Bundle JS > 900 kB (sem code-splitting) | Baixa |
