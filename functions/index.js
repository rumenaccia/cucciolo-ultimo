/* functions/index.js
   Cloud Function per ViceVersa.
   Quando cambia il documento di un cucciolo (cuccioli/{codice}),
   guarda la coda eventi e invia una notifica PUSH al destinatario
   giusto usando i token FCM salvati nel suo documento.

   Tipi di evento gestiti:
     - "amico"      : richiesta / conferma di collegamento fra cuccioli
     - "promemoria" : promemoria condiviso
     - "ciclo"      : avviso ciclo (es. 3 giorni prima)
     - "attivita"   : attivita' insieme (con pulsanti Accetta / Rifiuta)
     - "rispostaAttivita" : l'altro ha accettato/rifiutato una attivita'
*/

const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const db = admin.firestore();

// Testo della notifica a seconda del tipo di evento
function componiTesto(ev) {
  const nome = ev.daNome || "Il tuo partner";
  switch (ev.tipo) {
    case "amico":
      return { titolo: "Nuovo collegamento", corpo: nome + " ha collegato il suo cucciolo al tuo" };
    case "promemoria":
      return { titolo: "Promemoria", corpo: ev.testo || (nome + " ti ricorda una cosa") };
    case "ciclo":
      return { titolo: "Promemoria ciclo", corpo: ev.testo || "Il ciclo e' previsto tra 3 giorni" };
    case "attivita":
      return { titolo: "Attivita' insieme", corpo: nome + " vuole fare: " + (ev.testo || "un'attivita'") };
    case "rispostaAttivita":
      return {
        titolo: "Risposta attivita'",
        corpo: nome + (ev.risposta === "accetta" ? " ha accettato!" : " non puo' partecipare")
      };
    default:
      return { titolo: "ViceVersa", corpo: ev.testo || "Novita' dal tuo cucciolo" };
  }
}

// Invia una push a tutti i token del destinatario
async function inviaPush(codiceDestinatario, ev) {
  const snap = await db.collection("cuccioli").doc(codiceDestinatario).get();
  if (!snap.exists) return;
  const dati = snap.data() || {};
  const tokens = Array.isArray(dati.fcmTokens) ? dati.fcmTokens : [];
  if (tokens.length === 0) return;

  const testo = componiTesto(ev);
  const message = {
    tokens: tokens,
    // SOLO data: cosi' il service worker decide come mostrarla (pulsanti inclusi)
    data: {
      tipo: String(ev.tipo || "generico"),
      titolo: testo.titolo,
      corpo: testo.corpo,
      idEvento: String(ev.id || ""),
      mittenteCodice: String(ev.daCodice || ""),
      tag: String(ev.tipo || "generico")
    },
    webpush: {
      headers: { Urgency: "high" },
      fcmOptions: { link: "/" }
    }
  };

  const resp = await admin.messaging().sendEachForMulticast(message);

  // Pulisce i token non piu' validi
  const daRimuovere = [];
  resp.responses.forEach(function (r, i) {
    if (!r.success) {
      const code = r.error && r.error.code;
      if (code === "messaging/registration-token-not-registered" ||
          code === "messaging/invalid-registration-token") {
        daRimuovere.push(tokens[i]);
      }
    }
  });
  if (daRimuovere.length) {
    const rimasti = tokens.filter(function (t) { return daRimuovere.indexOf(t) === -1; });
    await db.collection("cuccioli").doc(codiceDestinatario).update({ fcmTokens: rimasti });
  }
}

// Trigger: ogni volta che un documento cucciolo viene scritto
exports.notificaEventi = functions.firestore
  .document("cuccioli/{codice}")
  .onWrite(async function (change, context) {
    const dopo = change.after.exists ? change.after.data() : null;
    if (!dopo) return null;

    const coda = Array.isArray(dopo.coda) ? dopo.coda : [];
    if (coda.length === 0) return null;

    // Evita di rimandare eventi gia' notificati
    const gia = Array.isArray(dopo.eventiNotificati) ? dopo.eventiNotificati : [];
    const giaSet = new Set(gia.map(String));

    const nuovi = coda.filter(function (ev) {
      return ev && ev.id && !giaSet.has(String(ev.id));
    });
    if (nuovi.length === 0) return null;

    // "cuccioli/{codice}" e' la CASELLA del destinatario:
    // gli eventi qui dentro sono per chi possiede questo codice.
    const codiceDestinatario = context.params.codice;

    for (const ev of nuovi) {
      try { await inviaPush(codiceDestinatario, ev); }
      catch (e) { console.error("push errore:", e); }
    }

    // Segna gli eventi come notificati
    const nuoviId = nuovi.map(function (e) { return String(e.id); });
    await change.after.ref.update({
      eventiNotificati: admin.firestore.FieldValue.arrayUnion.apply(null, nuoviId)
    });

    return null;
  });
