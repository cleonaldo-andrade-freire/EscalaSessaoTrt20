import React from 'react';

/** Exibe texto com o negrito do WhatsApp (*texto*) como <strong>. */
const TextoFormatado: React.FC<{ texto: string }> = ({ texto }) => (
  <>
    {texto.split(/(\*[^*\n]+\*)/g).map((parte, i) =>
      parte.length > 2 && parte.startsWith('*') && parte.endsWith('*')
        ? <strong key={i} className="font-bold">{parte.slice(1, -1)}</strong>
        : <React.Fragment key={i}>{parte}</React.Fragment>
    )}
  </>
);

export default TextoFormatado;
