/* firebase-messaging-sw.js
   Service worker dedicato a Firebase Cloud Messaging (push in background).
   Riceve le notifiche push anche quando l'app e' chiusa e mostra
   i pulsanti azione (Accetta / Rifiuta) per le attivita' insieme. */

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAeofl_uWBxn7gU43s7aCqZoEYyHlEQQTM",
  authDomain: "cucciolo-db4af.firebaseapp.com",
  projectId: "cucciolo-db4af",
  storageBucket: "cucciolo-db4af.firebasestorage.app",
  messagingSenderId: "154664971869",
  appId: "1:154664971869:web:2e1feb5cbcd90f3912e7b4"
});

const messaging = firebase.messaging();

// Push in arrivo mentre l'app NON e' in primo piano
messaging.onBackgroundMessage(function (payload) {
  const d = payload.data || {};
  const tipo = d.tipo || 'generico';
  const titolo = d.titolo || 'ViceVersa';
  const corpo = d.corpo || '';

  const opzioni = {
    body: corpo,
    icon: '/ragdoll.PNG',
    badge: '/ragdoll.PNG',
    tag: d.tag || tipo,
    data: d,
    requireInteraction: tipo === 'attivita'
  };

  // Solo le richieste di attivita' insieme hanno i pulsanti Accetta / Rifiuta
  if (tipo === 'attivita') {
    opzioni.actions = [
      { action: 'accetta', title: '\u2705 Accetta' },
      { action: 'rifiuta', title: '\u274C Rifiuta' }
    ];
  }

  return self.registration.showNotification(titolo, opzioni);
});

// Click sulla notifica o su un pulsante azione
self.addEventListener('notificationclick', function (event) {
  const azione = event.action;          // 'accetta' | 'rifiuta' | '' (corpo)
  const d = (event.notification && event.notification.data) || {};
  event.notification.close();

  event.waitUntil((async function () {
    const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });

    // URL con parametri: l'app li legge all'avvio e registra la risposta
    let url = '/';
    if (d.tipo === 'attivita' && (azione === 'accetta' || azione === 'rifiuta')) {
      url = '/?rispostaAttivita=' + encodeURIComponent(azione) +
            '&idAttivita=' + encodeURIComponent(d.idEvento || '') +
            '&aCodice=' + encodeURIComponent(d.mittenteCodice || '');
    }

    // Se una finestra e' gia' aperta, la usa e le manda un messaggio
    for (const client of clientList) {
      if ('focus' in client) {
        client.postMessage({ tipo: 'rispostaAttivita', azione: azione, dati: d });
        await client.focus();
        if (url !== '/' && 'navigate' in client) { try { await client.navigate(url); } catch (e) {} }
        return;
      }
    }
    // Altrimenti apre una nuova finestra
    if (clients.openWindow) return clients.openWindow(url);
  })());
});
