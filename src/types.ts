/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface SessaoMensagem {
  id: string;
  tipo_sessao: string;
  mensagem_padrao: string;
  created_at: string;
}

export interface Membro {
  id: string;
  nome: string;
  email: string;
  celularWhatsapp: string;
  fotoUrl: string;
  isAdmin: boolean;
  ativo: boolean;
}

export interface AusenciaProgramada {
  id: string;
  membroId: string;
  dataInicio: string; // YYYY-MM-DD
  dataFim: string;    // YYYY-MM-DD, inclusive (igual ao início em ausência de um dia)
  motivo: string;
}
