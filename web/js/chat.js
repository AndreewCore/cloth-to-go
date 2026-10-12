/* ============================================================
   CLOTH TO GO · web/js/chat.js
   Asistente informativo sobre la huella hídrica (burbuja flotante).

   No sabe nada por sí mismo: el backend responde solo con los documentos
   de la fundación de la que sale la fórmula del agua (server/src/chat.js).
   Sin backend, o con el asistente apagado allá, la burbuja no aparece.

   Todo lo que llega del servidor se pinta con textContent: aunque una
   respuesta trajera un <script>, sería texto y nunca código.
   ============================================================ */

/** Preguntas de arranque: muestran de qué se puede hablar. */
const CHAT_SUGGESTIONS = [
  "¿Qué es la huella hídrica?",
  "¿Cuánta agua se usa para hacer una camiseta de algodón?",
  "¿Por qué el algodón gasta más agua que el poliéster?",
];

// Solo en memoria: la conversación no se guarda en el navegador ni se asocia
// a la cuenta. Recargar la página la empieza de cero.
let chatHistory = [];
let chatBusy = false;
let chatFoundation = "";

/**
 * Agrega un globo al registro y lo deja a la vista.
 * @param {string} who Quién habla: "user", "model" o "error" (aviso local);
 *   admite clases extra, como "model typing".
 * @param {string} text Texto plano.
 * @returns {HTMLElement} El globo, por si hay que quitarlo (el "escribiendo…").
 */
function addChatBubble(who, text){
  const log = document.getElementById("chatLog");
  const el = document.createElement("p");
  el.className = `chat-msg ${who}`;
  el.textContent = text;
  log.append(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

/** Pinta el saludo y las preguntas sugeridas en un registro vacío. */
function renderChatWelcome(){
  const log = document.getElementById("chatLog");
  log.textContent = "";
  addChatBubble("model",
    `¡Hola! Respondo dudas sobre la huella hídrica de la ropa con la información de ${chatFoundation}. ¿Qué te gustaría saber?`);
  const sug = document.createElement("div");
  sug.className = "chat-suggest";
  for(const q of CHAT_SUGGESTIONS){
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.action = "chatSuggest";
    b.textContent = q;
    sug.append(b);
  }
  log.append(sug);
}

/** ¿Está abierto el panel? */
function chatIsOpen(){
  const panel = document.getElementById("chatPanel");
  return Boolean(panel) && !panel.hidden;
}

/** Abre el panel y lleva el foco al campo de la pregunta. */
function openChat(){
  document.getElementById("chatPanel").hidden = false;
  document.getElementById("chatFab").setAttribute("aria-expanded", "true");
  document.getElementById("chatInput").focus();
}

/** Cierra el panel y devuelve el foco a la burbuja que lo abrió. */
function closeChat(){
  document.getElementById("chatPanel").hidden = true;
  const fab = document.getElementById("chatFab");
  fab.setAttribute("aria-expanded", "false");
  fab.focus();
}

/** Alterna el panel desde la burbuja. */
function toggleChat(){
  if(chatIsOpen()) closeChat(); else openChat();
}

/**
 * Envía una pregunta y pinta la respuesta. Un envío a la vez: mientras el
 * modelo contesta, el formulario queda bloqueado para que el historial no se
 * desordene ni se gaste cuota en preguntas duplicadas.
 * @param {string} raw Texto escrito o sugerido.
 */
async function sendChat(raw){
  const message = raw.trim();
  if(!message || chatBusy) return;

  const input = document.getElementById("chatInput");
  const sendBtn = document.getElementById("chatSend");
  chatBusy = true;
  input.value = "";
  input.disabled = sendBtn.disabled = true;
  document.querySelector("#chatLog .chat-suggest")?.remove();

  addChatBubble("user", message);
  const typing = addChatBubble("model typing", "Escribiendo…");
  const res = await askChatbot(message, chatHistory);
  typing.remove();

  if("reply" in res){
    addChatBubble("model", res.reply);
    chatHistory.push({ role: "user", text: message }, { role: "model", text: res.reply });
    // El servidor solo mira los últimos turnos; guardar más no aporta nada.
    chatHistory = chatHistory.slice(-6);
  } else {
    addChatBubble("error", res.error);
  }

  chatBusy = false;
  input.disabled = sendBtn.disabled = false;
  input.focus();
}

/**
 * Muestra la burbuja si el backend tiene el asistente encendido. Se llama al
 * arrancar; si no hay servidor, todo queda oculto y la página sigue igual.
 */
async function initChat(){
  const status = await fetchChatStatus();
  if(!status) return;
  chatFoundation = status.foundation;
  document.getElementById("chatFab").innerHTML = icon("chat", { size: 26 });
  document.getElementById("chatSend").innerHTML = icon("send", { size: 18 });
  document.getElementById("chatSource").textContent = `Con información de ${chatFoundation}`;
  document.getElementById("chatNote").textContent =
    `Respondo solo con los documentos de ${chatFoundation}. No compartas datos personales.`;
  renderChatWelcome();
  document.getElementById("chat").hidden = false;
}
