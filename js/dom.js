/* ============================================================
   CLOTH TO GO · dom.js
   Referencias al DOM y utilidades de interfaz compartidas:
   panel deslizante (sheet), badge del carrito y toast.
   Depende de state.js (view, cartCount) y de los módulos de vistas
   (renderCart/renderCheckout/renderDone/renderDetail/renderProfile)
   que se invocan en tiempo de ejecución desde renderSheet().
   ============================================================ */

/* ---------------- Referencias DOM ---------------- */
const grid = document.getElementById("grid");
const noResults = document.getElementById("noResults");
const resultsBar = document.getElementById("resultsBar");
const filtersEl = document.getElementById("filters");
const overlay = document.getElementById("overlay");
const sheet = document.getElementById("sheet");
const sheetBody = document.getElementById("sheetBody");
const sheetFoot = document.getElementById("sheetFoot");
const sheetTitle = document.getElementById("sheetTitle");
const searchInput = document.getElementById("searchInput");
const loginEl = document.getElementById("login");
const greeting = document.getElementById("greeting");
const backBtn = document.getElementById("backBtn");

/* ---------------- Panel deslizante (sheet) ---------------- */
function openSheet(){ overlay.classList.add("show"); sheet.classList.add("show"); }
function closeSheet(){ overlay.classList.remove("show"); sheet.classList.remove("show"); }

/**
 * Desplaza el contenido del panel hasta un elemento suyo (por id).
 * No se usa scrollIntoView(): ese método desplaza TODOS los ancestros
 * desplazables, incluido el marco `.phone` (overflow:hidden también se puede
 * desplazar por código), lo que descuadraba el encabezado y dejaba el panel
 * asomando abajo sin forma de volver. Aquí solo se mueve `.sheet-body`.
 * @param {string} id Id del elemento destino dentro del panel.
 * @param {number} [margin=8] Aire en px que queda sobre el elemento.
 */
function scrollSheetTo(id, margin = 8){
  const el = document.getElementById(id);
  if(!el) return;
  const top = Math.max(0, sheetBody.scrollTop
    + (el.getBoundingClientRect().top - sheetBody.getBoundingClientRect().top)
    - margin);
  // scrollTo() no existe en entornos sin layout (jsdom de las pruebas).
  if(sheetBody.scrollTo) sheetBody.scrollTo({ top, behavior: "smooth" });
  else sheetBody.scrollTop = top;
}

// Vista → paso anterior (define cuándo se muestra el botón "atrás").
const SHEET_BACK = { checkout: "cart", payment: "checkout", rewards: "profile", donate: "profile" };

// Despacha el render del panel según la vista activa.
function renderSheet(){
  backBtn.style.display = SHEET_BACK[view] ? "grid" : "none";
  if(view==="cart") renderCart();
  else if(view==="checkout") renderCheckout();
  else if(view==="payment") renderPayment();
  else if(view==="done") renderDone();
  else if(view==="detail") renderDetail();
  else if(view==="profile") renderProfile();
  else if(view==="rewards") renderRewards();
  else if(view==="donate") renderDonate();
  else if(view==="filters") renderFilterSheet();
}

/* ---------------- Badge del carrito ---------------- */
function updateBadge(){
  const badge = document.getElementById("badge");
  const n = cartCount();
  badge.textContent = n;
  badge.style.display = n > 0 ? "grid" : "none";
}

/* ---------------- Toast ---------------- */
let toastTimer;
function toast(msg){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove("show"), 1600);
}

/* ---------------- Modal de confirmación in-app ----------------
   Reemplaza a confirm() nativo. confirmDialog(mensaje, alConfirmar):
   muestra el modal y ejecuta el callback solo si el usuario confirma. */
const modalOverlay = document.getElementById("modalOverlay");
const modalText = document.getElementById("modalText");
const modalOk = document.getElementById("modalOk");
const modalCancel = document.getElementById("modalCancel");
let onConfirmCb = null;

/**
 * Muestra el modal de confirmación y ejecuta el callback solo si el usuario acepta.
 * @param {string} message Texto principal (puede ir vacío si se usa `detailHTML`).
 * @param {Function} onConfirm Callback al confirmar.
 * @param {string} [iconName] Clave de ICON_PATHS: icono grande centrado arriba.
 *   Se llama `iconName` y no `icon` para no tapar dentro de esta función a la
 *   función global icon(), que es justo la que necesita para dibujarlo.
 * @param {object} [opts] Extras: `title`, `detailHTML`, `okLabel`, `danger`,
 *   `infoOnly` (oculta "Cancelar": el diálogo informa y no decide nada).
 *   ⚠️ `detailHTML` se inserta como HTML: quien lo arma debe pasar sus valores
 *   por escapeHTML(). El resto de campos van por textContent.
 */
function confirmDialog(message, onConfirm, iconName, opts = {}){
  const iconEl = document.getElementById("modalIcon");
  const titleEl = document.getElementById("modalTitle");
  const detailEl = document.getElementById("modalDetail");
  // innerHTML sin riesgo: el marcado sale de nuestro set, no de datos del usuario.
  iconEl.innerHTML = iconName ? icon(iconName, { size: 26 }) : "";
  // Se oculta por clase, no por style.display: un `display:block` inline pisaría
  // el `display:flex` del CSS y descentraría el icono dentro de su disco.
  iconEl.classList.toggle("is-hidden", !iconName);
  // El icono de una acción destructiva va en rojo, no en el verde de marca.
  iconEl.classList.toggle("danger", !!opts.danger);
  // `tone`: tiñe el disco para que el diálogo se reconozca de la tarjeta que lo
  // abrió (el armario es café en las dos). Se limpia el tono anterior porque el
  // elemento del modal se reutiliza en todos los diálogos.
  iconEl.classList.remove("tone-brown");
  if(opts.tone) iconEl.classList.add(`tone-${opts.tone}`);
  titleEl.textContent = opts.title || "";
  titleEl.classList.toggle("is-hidden", !opts.title);
  modalText.textContent = message;     // textContent → seguro (no HTML)
  modalText.classList.toggle("is-hidden", !message);
  detailEl.innerHTML = opts.detailHTML || "";
  detailEl.classList.toggle("is-hidden", !opts.detailHTML);
  modalOk.textContent = opts.okLabel || "Confirmar";
  modalOk.classList.toggle("danger", !!opts.danger);
  // `infoOnly`: el diálogo solo informa, no hay nada que decidir. Ofrecer
  // "Cancelar" frente a un aviso sugiere que se puede rechazar algo, cuando la
  // única salida posible es enterarse y cerrar.
  modalCancel.classList.toggle("is-hidden", !!opts.infoOnly);
  onConfirmCb = onConfirm;
  modalOverlay.classList.add("show");
  modalOk.focus();
}
function closeModal(){
  modalOverlay.classList.remove("show");
  onConfirmCb = null;
}

// El ahorro de agua ya no se muestra en un pop-up aparte: se integró en la
// pantalla de confirmación del pedido (renderDone en checkout.js).
