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

/* ---------------- Pestaña de detalle apilada ----------------
   Segunda hoja, independiente del panel principal, para abrir el detalle de
   una prenda POR ENCIMA de una vista a pantalla completa (el perfil). Al no
   tocar el panel principal, el perfil conserva su scroll y su estado, y la
   pestaña entra y sale con la misma animación que sobre el home. */
const sheetStack = document.getElementById("sheetStack");
const stackOverlay = document.getElementById("stackOverlay");
const stackBody = document.getElementById("stackBody");
const stackFoot = document.getElementById("stackFoot");

/**
 * Sube la pestaña apilada. Igual que openSheet(), solo muestra: quien llama
 * ya dejó pintado el contenido. El panel de abajo pasa a `inert` porque el
 * overlay solo detiene el ratón — sin esto el tabulador seguiría entrando en
 * los botones del perfil, que quedan tapados pero activos.
 */
function openStackSheet(){
  sheet.inert = true;
  stackOverlay.classList.add("show");
  sheetStack.classList.add("show");
}

/** Baja la pestaña apilada; la vista de abajo queda tal cual estaba. */
function closeStackSheet(){
  stackedDetail = false;
  sheet.inert = false;
  stackOverlay.classList.remove("show");
  sheetStack.classList.remove("show");
}

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

// Vista → paso anterior (define cuándo se muestra el botón "atrás"). `settings` ya no figura:
// se abre desde el engranaje del header, no desde el perfil, así que volver al
// perfil sería llevar al usuario a una pantalla en la que nunca estuvo.
const SHEET_BACK = { checkout: "cart", payment: "checkout", rewards: "profile", donate: "profile", review: "profile" };

/* Vistas que ocupan la pantalla entera en lugar de asomar como panel.
   El perfil y sus derivadas son destinos donde uno se queda un rato (revisar
   pedidos, canjear, configurar), no un paso rápido del checkout. Como panel al
   88% obligaban a hacer scroll dentro de un scroll y dejaban el catálogo
   asomando por arriba, que distrae y no lleva a ninguna parte. */
const FULL_VIEWS = new Set(["profile", "rewards", "donate", "settings", "review"]);

// Despacha el render del panel según la vista activa.
function renderSheet(){
  sheet.classList.toggle("full", FULL_VIEWS.has(view));
  // A pantalla completa siempre hay flecha: con paso previo vuelve a él, y sin
  // él (el perfil) hace de salida. Una ventana que tapa todo sin salida
  // evidente deja al usuario buscando por dónde se sale.
  backBtn.style.display = (SHEET_BACK[view] || FULL_VIEWS.has(view)) ? "grid" : "none";
  if(view==="cart") renderCart();
  else if(view==="checkout") renderCheckout();
  else if(view==="payment") renderPayment();
  else if(view==="done") renderDone();
  else if(view==="detail") renderDetail();
  else if(view==="profile") renderProfile();
  else if(view==="rewards") renderRewards();
  else if(view==="donate") renderDonate();
  else if(view==="filters") renderFilterSheet();
  else if(view==="settings") renderSettings();
  else if(view==="review") renderReview();
}

/* ---------------- Piezas de marcado compartidas ----------------
   Las usan varias vistas. Viven aquí y no en una de ellas para que ninguna
   dependa de otra: checkout no debe cargar profile para pintar una opción. */

/**
 * Tarjeta de opción seleccionable, del grupo `delivery-opts`.
 *
 * Estaba copiada seis veces —envío/retiro del checkout, devolución del checkout
 * y las dos de la donación—, y en cada copia el valor aparecía TRES veces (la
 * clase activa, el data-value y el aria-pressed). Tres sitios donde escribirlo
 * distinto y que el botón dejara de marcarse sin que nada fallara.
 *
 * @param {object} o
 * @param {string} o.action `data-action` que atiende el despachador de main.js.
 * @param {string} o.value Valor que viaja en `data-value`.
 * @param {boolean} o.active Si es la opción elegida ahora mismo.
 * @param {string} o.glyph Nombre del icono en ICON_PATHS.
 * @param {string} o.title Título de la opción.
 * @param {string} o.desc Explicación corta bajo el título.
 * @param {string} [o.note] Coste o etiqueta a la derecha del título.
 * @param {string} [o.noteVar=ok] Variable CSS del color de la nota (`ok`|`accent`).
 * @returns {string} HTML de la tarjeta.
 */
function optionCardHTML({ action, value, active, glyph, title, desc, note, noteVar = "ok" }){
  return `
      <div class="delivery-opt ${active ? "active" : ""}" data-action="${action}" data-value="${value}" role="button" tabindex="0" aria-pressed="${active}">
        <div class="do-icon">${icon(glyph, { size: 22 })}</div>
        <div class="do-text">
          <div class="do-title"><span>${title}</span>${note ? `<span style="color:var(--${noteVar})">${note}</span>` : ""}</div>
          <div class="do-desc">${desc}</div>
        </div>
        <div class="do-radio"></div>
      </div>`;
}

/**
 * Ficha del local físico (nombre, dirección y horario).
 * La pintan el retiro en local del checkout y la donación en local; es un dato
 * del negocio, no de una pantalla.
 * @returns {string} HTML.
 */
function localCardHTML(){
  return `<div class="pickup-detail">
        ${icon("store", { size: 15 })} <b>${LOCAL.nombre}</b><br>
        ${LOCAL.direccion}<br>
        <span style="color:var(--muted)">${LOCAL.horario}</span>
      </div>`;
}

/* ---------------- Badge del carrito ---------------- */
function updateBadge(){
  const badge = document.getElementById("badge");
  const n = cartCount();
  badge.textContent = n;
  badge.style.display = n > 0 ? "grid" : "none";
}

/**
 * Sacude el badge para acusar recibo de la prenda que acaba de entrar.
 * Reinicia la animación quitando y volviendo a poner la clase: agregar dos
 * prendas seguidas debe dar dos sacudidas, no una sola que ya estaba corriendo.
 */
function bumpBadge(){
  const badge = document.getElementById("badge");
  if(!badge || shouldReduceMotion()) return;
  badge.classList.remove("bump");
  void badge.offsetWidth;   // fuerza el reflujo: sin él el navegador funde ambos cambios de clase en uno
  badge.classList.add("bump");
}

/**
 * Manda una miniatura de la prenda volando desde su tarjeta hasta el carrito.
 *
 * Es el acuse de recibo que faltaba: el badge cambia en una esquina que nadie
 * está mirando cuando pulsa el botón, y en la feria hubo quien pulsó dos veces
 * por no ver nada. El vuelo une los dos puntos, así que enseña *dónde* quedó la
 * prenda además de *que* entró.
 *
 * Degrada a nada si no hay de dónde salir, si el usuario pidió menos movimiento
 * o si el entorno no trae la API de animaciones (jsdom, navegadores viejos): el
 * carrito ya quedó actualizado antes de llamar aquí, esto es solo el adorno.
 * @param {Element|null} origin Elemento del que sale el vuelo (la miniatura).
 * @returns {boolean} Si el vuelo llegó a lanzarse.
 */
function flyToCart(origin){
  const target = document.getElementById("openCart");
  if(!origin || !target || shouldReduceMotion() || typeof origin.animate !== "function") return false;

  const desde = origin.getBoundingClientRect();
  const hasta = target.getBoundingClientRect();
  // Sin medidas no hay trayecto que dibujar (elemento oculto, o un DOM sin
  // layout como el de los tests).
  if(!desde.width || !hasta.width) return false;

  const ghost = document.createElement("div");
  ghost.className = "fly-ghost";
  const img = origin.querySelector("img");
  // Si la prenda no tiene foto, vuela el color de la marca: un fantasma vacío
  // parecería un fallo de carga.
  if(img && img.src && img.style.display !== "none") ghost.style.backgroundImage = `url("${img.src}")`;
  ghost.style.left   = `${desde.left}px`;
  ghost.style.top    = `${desde.top}px`;
  ghost.style.width  = `${desde.width}px`;
  ghost.style.height = `${desde.height}px`;
  document.body.appendChild(ghost);

  const dx = (hasta.left + hasta.width / 2) - (desde.left + desde.width / 2);
  const dy = (hasta.top + hasta.height / 2) - (desde.top + desde.height / 2);
  const vuelo = ghost.animate([
    { transform: "translate(0,0) scale(1)", opacity: .95, borderRadius: "14px" },
    // El punto medio sube un poco: en línea recta el recorrido se lee como un
    // salto de posición, con la curva se lee como algo que va hacia el carrito.
    { transform: `translate(${dx * .55}px, ${dy * .35 - 40}px) scale(.5)`, opacity: .9, offset: .55 },
    { transform: `translate(${dx}px, ${dy}px) scale(.12)`, opacity: .25, borderRadius: "50%" },
  ], { duration: 540, easing: "cubic-bezier(.4,.05,.4,1)", fill: "forwards" });

  // onfinish y no un setTimeout: si la pestaña se va a segundo plano el vuelo se
  // congela, y el temporizador dejaría el fantasma clavado sobre la pantalla.
  vuelo.onfinish = vuelo.oncancel = () => { ghost.remove(); bumpBadge(); };
  return true;
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
  // Un diálogo encadenado a otro (confirmar el alquiler abre el pop-up de meta
  // de agua) se abre en el mismo tick en que closeModal() quitó `show`: el
  // navegador nunca llega a pintar el estado cerrado, la transición se queda
  // sin fotograma inicial y el modal aparece de golpe. Releer el layout fuerza
  // ese "antes" para que la animación de entrada arranque siempre.
  void modalOverlay.offsetHeight;
  modalOverlay.classList.add("show");
  modalOk.focus();
}
function closeModal(){
  modalOverlay.classList.remove("show");
  onConfirmCb = null;
}

// El ahorro de agua ya no se muestra en un pop-up aparte: se integró en la
// pantalla de confirmación del pedido (renderDone en checkout.js).

/**
 * Pop-up de felicitación al cruzar una o más metas de agua.
 * Recibe las metas recién acreditadas por creditWaterGoals(); con lista vacía
 * no hace nada, así los llamadores no tienen que comprobarlo.
 */
function celebrateWaterGoals(goals){
  if(!goals || !goals.length) return;
  const detail = goals.map(g =>
    `<div class="goal-hit">${icon("droplet", { size: 16 })} “${escapeHTML(g.name)}” · ${fmtLiters(g.liters)} L · <b>+${g.points} pts</b></div>`
  ).join("");
  confirmDialog("Alcanzaste una meta de ahorro de agua. Los puntos ya son tuyos.",
    null, "award", { title: "¡Felicidades!", detailHTML: detail, okLabel: "Genial", infoOnly: true });
}
