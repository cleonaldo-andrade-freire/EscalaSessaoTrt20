/**
 * Negrito no padrão do WhatsApp (*texto*). O app exibe o mesmo marcador em
 * negrito pelo componente <TextoFormatado>. Não atravessa quebras de linha,
 * então listas devem ser marcadas item a item.
 */
export const negrito = (texto: string): string => (texto ? `*${texto}*` : texto);

/** Substitui as tags {{sessao}}, {{data}}, {{horario}} e {{escalados}} de um template, destacando os valores. */
export const preencherTemplate = (
  template: string,
  valores: { sessao: string; data: string; horario: string; escalados: string }
): string =>
  template
    .replace(/{{sessao}}/g, negrito(valores.sessao))
    .replace(/{{data}}/g, negrito(valores.data))
    .replace(/{{horario}}/g, negrito(valores.horario))
    .replace(/{{escalados}}/g, valores.escalados);
