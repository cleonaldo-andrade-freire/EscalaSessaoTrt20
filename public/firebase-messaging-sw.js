// Importa os scripts do Firebase para Service Workers
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

// Configuração do seu projeto Firebase (Cole as chaves reais do Console do Firebase aqui)
firebase.initializeApp({
  apiKey: "<FIREBASE_API_KEY>",
  authDomain: "<PROJETO>.firebaseapp.com",
  projectId: "<PROJETO>",
  storageBucket: "<PROJETO>.firebasestorage.app",
  messagingSenderId: "<SENDER_ID>",
  appId: "<APP_ID>"
});

const messaging = firebase.messaging();

// Intercepta mensagens quando o app está em BACKGROUND ou FECHADO
messaging.onBackgroundMessage(function(payload) {
  console.log('[firebase-messaging-sw.js] Mensagem recebida em background ', payload);
  
  const title = payload.notification?.title || payload.data?.title;
  const body = payload.notification?.body || payload.data?.body;
  
  if (title && body) {
    const notificationOptions = {
      body: body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      vibrate: [200, 100, 200],
      data: payload.data,
      tag: 'aviso-' + (title || '').substring(0, 20)
    };

    self.registration.showNotification(title, notificationOptions);
  }
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      if (clientList.length > 0) {
        let client = clientList[0];
        for (let i = 0; i < clientList.length; i++) {
          if (clientList[i].focused) {
            client = clientList[i];
          }
        }
        return client.focus();
      }
      return clients.openWindow('/');
    })
  );
});
