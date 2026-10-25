export const getGreeting = (): string => {
  const options = { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false };
  const formatter = new Intl.DateTimeFormat('en-US', options as any);
  const hour = parseInt(formatter.format(new Date()), 10);
  
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
};
