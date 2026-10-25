# MEMORIA.md — Regras para Interações com IA
# Escala Sessões TRT20

> **Este documento é vinculante para qualquer IA que trabalhe neste projeto.**
> **Versão:** 2.0 (adaptação para o TRT20)
> **Data:** 2026-10-25

---

## REGRA NUMERO 1 — LEITURA OBRIGATÓRIA ANTES DE QUALQUER AÇÃO

Antes de alterar código: ler `PRD.md` e `SDD.md`, verificar se a funcionalidade já existe e se a mudança afeta alguma regra crítica abaixo.

---

## REGRA NUMERO 2 — REGRAS DE NEGÓCIO CRÍTICAS (NÃO ALTERAR SEM CONFIRMAÇÃO)

### 2.1 Autenticação e Redirecionamento
- Admin em **desktop** → `/admin/dashboard`; admin em **mobile** → `/dashboard`; membro → `/dashboard`.
- Mobile detectado por `navigator.userAgent` com `/iPhone|iPad|iPod|Android/i`.

### 2.2 Visibilidade de Escalas
- Membro só vê escalas com `publicada = true` (o padrão do banco é `true`; não há mais rascunho).
- Membro vê escalas onde é titular (e não foi substituído) ou onde é o substituto.

### 2.3 Permutas
- Permuta simples (cobertura) e de mão dupla continuam como antes (ver PRD).
- Não-admins só podem alterar os campos de permuta (`status_substituicao`, `justificativa_troca`, `membro_substituto_id`) — garantido pelo trigger `trg_proteger_escala`.

### 2.4 Escala (Admin)
- Escala é **manual** — não existe gerador automático.
- Sessões: `1ª Turma`, `2ª Turma`, `Pleno`, em **qualquer dia** (sem validação de dia da semana).
- Um slot por (data, sessão, função) — `UNIQUE (data, tipo_sessao, funcao)`.
- Nenhum membro pode estar em mais de uma função na mesma sessão.

### 2.5 Check-in / Check-out
- **Não há moedas/pontos/assiduidade.**
- Presença é registrada **somente** pelas RPCs `registrar_checkin` / `registrar_checkout` (horário do servidor).
- Membro: só no **dia da sessão**, só na própria escala, uma vez cada; check-out exige check-in.
- Admin: pode lançar para qualquer membro e informar horário manual (retroativo).
- Admin "Marcar falta" grava `compareceu = false` e limpa os horários.
- Fuso de referência: `America/Maceio` (UTC-3).

### 2.6 Lembrete automático
- Toda sessão tem `hora_inicio`. Os escalados recebem WhatsApp + aviso **20 min antes** (`LEMBRETE_ANTECEDENCIA_MIN`), uma única vez (`lembrete_enviado_em`).
- Ao alterar data/horário de uma sessão, `lembrete_enviado_em` volta a NULL.

---

## REGRA NUMERO 3 — CLIENTE SUPABASE

Usar **sempre** `src/services/supabaseClient.ts`. Não criar outros clientes. (O legado `src/lib/supabase.ts` foi removido.)

---

## REGRA NUMERO 4 — DATAS

- Data de uma escala: `new Date(dateStr + 'T12:00:00')`.
- "Hoje" no frontend: `getLocalDateStr()` de `src/utils/date.ts` (nunca `toISOString().split('T')[0]`, que usa UTC).

---

## REGRA NUMERO 5 — ATUALIZAR A DOCUMENTAÇÃO

Ao implementar funcionalidade ou mudar regra: atualizar `PRD.md`, `SDD.md` e este arquivo.

---

## REGRA NUMERO 6 — PROIBIÇÕES

- Não refatorar componentes inteiros sem pedido explícito.
- Não mudar o fluxo de autenticação sem confirmação.
- Não adicionar dependências npm sem proposta e confirmação.
- Não remover/renomear campos do banco sem confirmação.
- Não registrar presença com `UPDATE` direto no cliente (usar `src/services/presencaService.ts`).

---

## REGRA NUMERO 7 — VALORES DE DOMÍNIO

Centralizados em `src/constants.ts`:

```
Sessões:  '1ª Turma', '2ª Turma', 'Pleno'      (também no CHECK de escalas.tipo_sessao)
Funções:  'Suporte PJe'
Status:   'Nenhum', 'Disponível para Troca', 'Substituição Aceita', 'Troca Rejeitada'
```

---

## CONTEXTO DO PROJETO

- **O que é:** PWA de escala dos técnicos de suporte PJe nas sessões do 2º Grau do TRT20.
- **Quem usa:** técnicos (mobile) + administrador (desktop).
- **Banco/Auth/Storage:** Supabase (scripts em `supabase/sql/`).
- **WhatsApp:** Edge Function → n8n → Evolution API (opcional).
- **Push:** Firebase FCM (infraestrutura presente, opcional).
