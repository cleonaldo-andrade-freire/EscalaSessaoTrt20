/**
 * Data local (fuso do dispositivo) no formato YYYY-MM-DD.
 * Evita o `toISOString()`, que usa UTC e "vira o dia" após as 21h em Sergipe.
 */
export const getLocalDateStr = (date: Date = new Date()): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/** Formata um timestamp ISO como HH:MM (horário local). */
export const formatHora = (iso: string | null | undefined): string => {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

/** Hora atual no formato HH:MM, útil como valor padrão de <input type="time">. */
export const getHoraAtual = (): string => {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
};

/** Combina uma data YYYY-MM-DD e um horário HH:MM (locais) em ISO UTC. */
export const combinarDataHora = (dataStr: string, hora: string): string => {
  return new Date(`${dataStr}T${hora}:00`).toISOString();
};

/** Duração entre check-in e check-out, ex.: "2h15". */
export const formatDuracao = (inicio: string | null | undefined, fim: string | null | undefined): string => {
  if (!inicio || !fim) return '';
  const minutos = Math.max(0, Math.round((new Date(fim).getTime() - new Date(inicio).getTime()) / 60000));
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`;
};
