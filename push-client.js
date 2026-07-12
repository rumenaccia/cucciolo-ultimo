/* push-client.js
   Logica lato browser per le notifiche PUSH (Firebase Cloud Messaging).
   - registra il service worker FCM
   - chiede il permesso notifiche
   - ottiene il token del dispositivo e lo salva nel MIO documento cucciolo
   - gestisce la risposta "Accetta / Rifiuta" arrivata da una notifica

   Nota: questo file usa window.cloud (definito in index.html) per parlare
   con Firestore, cosi' non duplichiamo la configurazione.
*/
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import { getFirestore, doc, setDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAeofl_uWBxn7gU43s7aCqZoEYyHlEQQTM",
  authDomain: "cucciolo-db4af.firebaseapp.com",
  projectId: "cucciolo-db4af",
  storageBucket: "cucciolo-db4af.firebasestorage.app",
  messagingSenderId: "154664971869",
  appId: "1:154664971869:web:2e1feb5cbcd90f3912e7b4"
};

// Chiave pubblica VAPID (Web Push) generata nella console Firebase.
const VAPID_KEY = "BINuXSeLQkELp6lqXk2ldOzRBeATS2YPEc_-ymTPgGmwRzgOrgYT7UubmK26E4ZCX-4xJEUSCz9_tkOyzw-LLoI";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);

function mioCodice() {
  try {
    const p = JSON.parse(localStorage.getItem("pet-profile") || "{}");
    return p.codiceAmico || null;
  } catch (e) { return null; }
}

// Salva il token del dispositivo nel MIO documento (cosi' l'altro mi manda le push)
async function salvaToken(token) {
  const codice = mioCodice();
  if (!codice || !token) return;
  try {
    await setDoc(doc(db, "cuccioli", codice), { fcmTokens: arrayUnion(token) }, { merge: true });
    console.log("[push] token salvato");
  } catch (e) { console.log("[push] salvaToken:", e); }
}

// Registra il SW FCM, chiede permesso e ottiene il token.
// Ritorna { ok:true } oppure { ok:false, motivo }.
async function attivaPush() {
  try {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      return { ok: false, motivo: "non-supportato" };
    }
    const permesso = await Notification.requestPermission();
    if (permesso !== "granted") return { ok: false, motivo: "negato" };

    const reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: reg
    });
    if (!token) return { ok: false, motivo: "no-token" };
    await salvaToken(token);

    // Push ricevute mentre l'app e' APERTA in primo piano
    onMessage(messaging, (payload) => {
      const d = payload.data || {};
      // Riusa la notifica del sistema anche in foreground
      if (Notification.permission === "granted" && reg.showNotification) {
        const opz = { body: d.corpo || "", icon: "/ragdoll.PNG", badge: "/ragdoll.PNG", tag: d.tag || d.tipo, data: d };
        if (d.tipo === "attivita") {
          opz.requireInteraction = true;
          opz.actions = [
            { action: "accetta", title: "\u2705 Accetta" },
            { action: "rifiuta", title: "\u274C Rifiuta" }
          ];
        }
        reg.showNotification(d.titolo || "ViceVersa", opz);
      }
      // Avvisa l'app (per aggiornare la UI / lista richieste)
      window.dispatchEvent(new CustomEvent("push-in-arrivo", { detail: d }));
    });

    return { ok: true, token };
  } catch (e) {
    console.log("[push] attivaPush:", e);
    return { ok: false, motivo: "errore" };
  }
}

// Se l'app e' stata aperta da un pulsante Accetta/Rifiuta della notifica,
// legge i parametri dall'URL e avvisa l'app, poi pulisce l'URL.
function leggiRispostaDaURL() {
  try {
    const u = new URL(window.location.href);
    const risposta = u.searchParams.get("rispostaAttivita");
    if (!risposta) return null;
    const dettaglio = {
      azione: risposta,
      idAttivita: u.searchParams.get("idAttivita") || "",
      aCodice: u.searchParams.get("aCodice") || ""
    };
    // pulisce l'URL senza ricaricare
    u.searchParams.delete("rispostaAttivita");
    u.searchParams.delete("idAttivita");
    u.searchParams.delete("aCodice");
    window.history.replaceState({}, "", u.pathname + (u.search || ""));
    window.dispatchEvent(new CustomEvent("risposta-attivita", { detail: dettaglio }));
    return dettaglio;
  } catch (e) { return null; }
}

// Messaggi dal service worker (quando l'app era gia' aperta)
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    const m = event.data || {};
    if (m.tipo === "rispostaAttivita") {
      window.dispatchEvent(new CustomEvent("risposta-attivita", {
        detail: { azione: m.azione, idAttivita: (m.dati && m.dati.idEvento) || "", aCodice: (m.dati && m.dati.mittenteCodice) || "" }
      }));
    }
  });
}

// Espone le funzioni all'app
window.pushClient = {
  attiva: attivaPush,
  salvaToken: salvaToken,
  statoPermesso: () => (("Notification" in window) ? Notification.permission : "non-supportato")
};

// All'avvio: se gia' abbiamo il permesso, riattiva silenziosamente il token;
// e controlla se veniamo da un click su notifica.
window.addEventListener("load", () => {
  leggiRispostaDaURL();
  if (("Notification" in window) && Notification.permission === "granted") {
    attivaPush();
  }
});
