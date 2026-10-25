import React, { useState, useEffect } from 'react';

const IosInstallBanner = () => {
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    const isIos = () => {
      const userAgent = window.navigator.userAgent.toLowerCase();
      return /iphone|ipad|ipod/.test(userAgent);
    };

    const isInStandaloneMode = () => {
      return ('standalone' in window.navigator) && (window.navigator as any).standalone;
    };

    if (isIos() && !isInStandaloneMode()) {
      const hasDismissed = localStorage.getItem('ios-banner-dismissed');
      if (!hasDismissed) {
        setShowBanner(true);
      }
    }
  }, []);

  const handleDismiss = () => {
    localStorage.setItem('ios-banner-dismissed', 'true');
    setShowBanner(false);
  };

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-white dark:bg-gray-800 border-t shadow-2xl rounded-t-2xl pb-safe">
      <div className="flex flex-col items-center justify-between text-center gap-4">
        <div className="text-gray-800 dark:text-gray-100 text-sm font-medium">
          <p className="mb-2">Para receber notificações das suas escalas, instale nosso app!</p>
          <p className="text-gray-600 dark:text-gray-300 font-normal">
            Toque no ícone <span className="inline-block mx-1 p-1 bg-gray-100 dark:bg-gray-700 rounded-md">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-blue-500 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            </span> abaixo e selecione <br/>
            <strong>"Adicionar à Tela de Início"</strong>.
          </p>
        </div>
        
        <button 
          onClick={handleDismiss}
          className="w-full py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-semibold rounded-xl active:bg-gray-200 transition-colors"
        >
          Entendi, fechar
        </button>
      </div>
    </div>
  );
};

export default IosInstallBanner;
