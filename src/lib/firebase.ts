import { initializeApp } from "firebase/app";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

// Configuração do Firebase via variáveis de ambiente (definidas no .env)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || '',
};

// VAPID Key via variável de ambiente
const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || '';


// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Cloud Messaging and get a reference to the service
// It's important to only initialize messaging if it's supported (e.g. not in SSR or unsupported browsers)
let messaging: any = null;
let messagingInitError: string | null = null;

if (typeof window !== "undefined") {
  if (!("Notification" in window)) {
    messagingInitError = "window.Notification não suportado pelo navegador ou faltando Adicionar à Tela de Início.";
  } else if (!("serviceWorker" in navigator)) {
    messagingInitError = "serviceWorker não suportado pelo navegador.";
  } else {
    try {
      messaging = getMessaging(app);
    } catch (error: any) {
      console.error("Firebase Messaging could not be initialized", error);
      messagingInitError = "Erro do Firebase: " + (error.message || String(error));
    }
  }
} else {
  messagingInitError = "window is undefined (SSR).";
}

export const requestFirebaseNotificationPermission = async (): Promise<string | null> => {
  if (!messaging) throw new Error("Falha na inicialização: " + messagingInitError);

  try {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      // Registrar o Service Worker manualmente para garantir que o Firebase Messaging o encontre,
      // mesmo existindo o Service Worker do vite-plugin-pwa.
      let registration: ServiceWorkerRegistration | undefined;
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          if (reg.active?.scriptURL.includes('firebase-messaging-sw.js') && reg.scope === window.location.origin + '/') {
            console.log('Unregistering old firebase service worker from root scope');
            await reg.unregister();
          }
        }
        registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/firebase-cloud-messaging-push-scope' });
      }

      const token = await getToken(messaging, { 
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: registration 
      });
      return token;
    } else {
      console.warn("Notification permission denied by user.");
      throw new Error(`Permissão negada pelo usuário (status: ${permission}).`);
    }
  } catch (error: any) {
    console.error("An error occurred while retrieving token.", error);
    throw new Error(error.message || "Erro desconhecido ao obter token.");
  }
};

export const onForegroundMessage = (callback: (payload: any) => void) => {
  if (!messaging) return;
  return onMessage(messaging, callback);
};

export { app, messaging };
