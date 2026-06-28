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

// icon (opcional): emoji/símbolo a mostrar grande y centrado en la parte
// superior del modal (p. ej. 📝 en la encuesta).
function confirmDialog(message, onConfirm, icon){
  const iconEl = document.getElementById("modalIcon");
  iconEl.textContent = icon || "";
  iconEl.style.display = icon ? "block" : "none";
  modalText.textContent = message;     // textContent → seguro (no HTML)
  onConfirmCb = onConfirm;
  modalOverlay.classList.add("show");
  modalOk.focus();
}
function closeModal(){
  modalOverlay.classList.remove("show");
  onConfirmCb = null;
}

/* ---------------- Pop-up de ahorro de agua ----------------
   Muestra una felicitación con los litros de agua que el cliente ahorra al
   alquilar ropa reutilizada (en vez de comprarla nueva). litros → ver
   garmentWater()/cartWaterSaved() en data.js/state.js. */
const waterPop = document.getElementById("waterPop");
const waterAmount = document.getElementById("waterAmount");
const waterMsg = document.getElementById("waterMsg");

function showWaterPop(liters, garments){
  if(liters <= 0) return;
  waterAmount.innerHTML = `<span class="wa-line1">Ahorraste</span>
    <span class="wa-line2">${fmtLiters(liters)} litros de agua</span>`;
  const prendas = garments === 1 ? "esta prenda reutilizada" : `estas ${garments} prendas reutilizadas`;
  waterMsg.textContent = `Al alquilar ${prendas} evitaste fabricar ropa nueva ` +
    `y todo el agua que eso consume. ¡Gracias por elegir moda circular!`;
  waterPop.classList.add("show");
}
function closeWaterPop(){ waterPop.classList.remove("show"); }
