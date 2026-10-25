import { initializeApp } from 'firebase/app';
import { getMessaging, getToken } from 'firebase/messaging';
import { supabase } from './supabaseClient';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || ''
};

// Evita erro caso o firebase seja inicializado sem as chaves no dev environment
let messaging: any = null;
try {
  const app = initializeApp(firebaseConfig);
  messaging = getMessaging(app);
} catch (e) {
  console.warn("Firebase não inicializado corretamente. Verifique o .env");
}

export const requestNotificationPermissionAndSaveToken = async (userId: string) => {
  if (!messaging) return;

  try {
    const permission = await Notification.requestPermission();
    
    if (permission === 'granted') {
      const currentToken = await getToken(messaging, { 
        vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY 
      });

      if (currentToken) {
        const isIos = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
        const deviceOs = isIos ? 'ios' : 'android';

        const { error } = await supabase
          .from('membro_fcm_tokens')
          .upsert(
            { 
              membro_id: userId, 
              token: currentToken, 
              device_os: deviceOs 
            }, 
            { onConflict: 'membro_id, token' }
          );

        if (error) throw error;
        console.log('Token FCM salvo com sucesso.');
      }
    } else {
      console.log('Permissão para notificações foi negada.');
    }
  } catch (error) {
    console.error('Erro ao configurar notificações FCM:', error);
  }
};
