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
  dataEspecifica: string; // YYYY-MM-DD
  motivo: string;
  createdAt?: string; // dias de um mesmo período são gravados juntos (mesmo created_at)
}
