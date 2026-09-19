/* ============================================================
   CLOTH TO GO · web/js/session.js
   Sesión de la web: carrito de invitado y puerta de Google.

   La regla del sitio: mirar el catálogo y llenar el carrito no pide
   nada; alquilar sí. Es la misma frontera de la app móvil (allí el
   invitado navega pero no deja rastro), solo que aquí el carrito del
   invitado SÍ sobrevive a la recarga —una web se cierra y se vuelve
   por un enlace, no se "abre como app"— y se adopta en la cuenta al
   iniciar sesión, para que nadie pierda lo que ya eligió.

   Depende de js/state.js (activeStorageKey, storageKeyFor, loadState,
   saveState, resetStateToDefaults, cart) y de js/api.js (backend,
   verifyGoogleCredential). Se carga antes que catalog/cart/main.
   ============================================================ */

/* Misma aplicación de Google Cloud que la app móvil: es el valor de
   GOOGLE_CLIENT_ID en js/auth.js, duplicado porque auth.js no puede
   cargarse aquí (arrastra el DOM del teléfono). Si se cambia allí, hay
   que cambiarlo aquí: son la misma cuenta de Google. */
const WEB_GOOGLE_CLIENT_ID = "115840486389-f3vitcouhua5eckn3grn1gk9kqb7ccjs.apps.googleusercontent.com";

/* Carrito de quien todavía no entra. Va en su propia clave: las de la app
   (STORAGE_PREFIX + sub) son de una cuenta, y este carrito aún no tiene
   dueño. Al entrar se vuelca en la cuenta y la clave se borra. */
const GUEST_CART_KEY = "clothToGo:web:guestCart";

// Usuario en sesión ({sub,name,email,picture}) o null si es invitado.
let webUser = null;

// ¿Está desplegado el menú que cuelga de la foto de perfil?
let userMenuOpen = false;

// Acción aplazada por la puerta de sesión: lo que el usuario intentaba hacer
// cuando se le pidió entrar. Se ejecuta sola al volver con sesión, para que el
// login no le cueste repetir el clic.
let pendingAfterLogin = null;

/**
 * ¿Puede ofrecerse el login de Google? GSI exige un origen http(s)
 * autorizado, así que por `file://` no hay nada que ofrecer y la web queda
 * como escaparate: catálogo y carrito, sin alquilar.
 * @returns {boolean}
 */
function webAuthAvailable(){ return location.protocol !== "file:"; }

/**
 * Lee los claims de un ID token sin verificar la firma. Copia de decodeJwt()
 * de js/auth.js (mismo motivo que el client id) y con la misma advertencia:
 * identifica, no autoriza. Solo se usa cuando NO hay backend; con backend
 * manda verifyGoogleCredential().
 * @param {string} token ID token de Google.
 * @returns {object|null} Claims, o null si el token está mal formado.
 */
function webDecodeJwt(token){
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(b64).split("").map(c => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join(""),
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/* ---------------- Carrito del invitado ---------------- */

/**
 * Guarda el carrito donde corresponda según quién esté: la cuenta si hay
 * sesión (misma clave y mismo formato que la app, de modo que el carrito
 * empezado en la web aparece en el teléfono), o la clave de invitado si no.
 *
 * Todas las mutaciones de `cart` pasan por aquí en vez de llamar a saveState()
 * directamente: saveState() no escribe nada sin sesión, y así el invitado
 * perdía el carrito en cada recarga.
 */
function persistCart(){
  if(activeStorageKey){ saveState(); return; }
  try {
    localStorage.setItem(GUEST_CART_KEY, JSON.stringify(cart));
  } catch(e){ /* almacenamiento bloqueado: la sesión sigue, sin recordar */ }
}

/**
 * Recupera el carrito de invitado guardado en este navegador.
 * @returns {Array<{id:number}>} Líneas del carrito; vacío si no hay o está corrupto.
 */
function readGuestCart(){
  try {
    const raw = localStorage.getItem(GUEST_CART_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter(c => productById(c && c.id)) : [];
  } catch(e){
    return [];
  }
}

/** Borra el carrito de invitado (ya adoptado por una cuenta, o descartado). */
function clearGuestCart(){
  try { localStorage.removeItem(GUEST_CART_KEY); } catch(e){ /* nada que limpiar */ }
}

/* ---------------- Entrar y salir ---------------- */

/**
 * Deja el estado listo para `user` y adopta el carrito del invitado.
 *
 * El orden importa: primero se lee lo que el invitado había elegido, luego se
 * carga la cuenta (que sobrescribe `cart` con el suyo) y al final se suman las
 * prendas nuevas. Al revés, entrar borraría el carrito recién hecho, que es
 * justo lo que la puerta de sesión no debe costarle a nadie.
 * @param {{sub:string,name?:string,email?:string,picture?:string}} user
 */
function startWebSession(user){
  const guest = readGuestCart();
  webUser = user;
  resetStateToDefaults();
  activeStorageKey = storageKeyFor(user);
  loadState();
  // Una prenda ya alquilada (por este pedido u otro) no vuelve al carrito: es
  // ropa de segunda mano, hay una sola unidad de cada una.
  for(const linea of guest){
    if(!inCart(linea.id) && !isRented(linea.id)) cart.push({ id: linea.id });
  }
  clearGuestCart();
  // Puestas al día que la app hace al abrir sesión: puntos de pedidos ya
  // entregados y metas de agua cruzadas mientras tanto.
  creditDeliveredPoints();
  creditWaterGoals();
  if(user.name && !profile.nameChangedAt) profile.name = user.name;
  if(user.email) profile.email = user.email;
  if(user.picture) profile.picture = user.picture;
  saveState();
  renderSession();
  renderGrid();      // las prendas de sus pedidos vigentes salen del catálogo
  renderCart();
}

/**
 * Cierra la sesión: vacía el estado en memoria y deja la web como la ve
 * cualquiera que llega por primera vez. Lo guardado en la cuenta no se toca;
 * sigue ahí para el próximo inicio de sesión (y para la app).
 */
function signOutWeb(){
  if(webUser && webAuthAvailable() && typeof google !== "undefined" && google.accounts && google.accounts.id){
    google.accounts.id.disableAutoSelect();
  }
  webUser = null;
  userMenuOpen = false;
  resetStateToDefaults();
  activeStorageKey = null;
  closeCart();
  renderSession();
  renderGrid();
  renderCart();
  initWebAuth();     // repinta el botón de Google para el siguiente
  toast("Sesión cerrada");
}

/* ---------------- Puerta de sesión ---------------- */

/**
 * Exige sesión antes de seguir. Si ya la hay, ejecuta la acción; si no, abre
 * el diálogo de Google y la deja aplazada para después del login.
 * @param {Function} action Lo que se quería hacer.
 * @returns {boolean} true si la acción se ejecutó ya.
 */
function requireSession(action){
  if(webUser){ action(); return true; }
  pendingAfterLogin = action;
  openLogin();
  return false;
}

/**
 * Callback de GSI. Mismo criterio que onGoogleCredential() en js/auth.js: con
 * backend desplegado la identidad DEBE venir verificada por el servidor; sin
 * backend se decodifica el token en el navegador, que identifica para la demo
 * pero no autoriza nada (el estado no sale de este localStorage).
 * @param {{credential:string}} resp Respuesta de Google con el ID token.
 */
async function onWebGoogleCredential(resp){
  const token = resp && resp.credential;
  showLoginHint("");
  let claims;
  if(backend.enabled){
    claims = await verifyGoogleCredential(token);
    if(!claims){
      showLoginHint("No se pudo verificar tu sesión. Inténtalo de nuevo.");
      return;
    }
  } else {
    claims = webDecodeJwt(token);
  }
  if(!claims || !claims.sub){
    showLoginHint("No se pudo iniciar sesión con Google.");
    return;
  }
  startWebSession({
    sub: claims.sub,
    name: claims.name || claims.given_name || "",
    email: claims.email || "",
    picture: claims.picture || "",
  });
  closeLogin();
  toast(`Hola, ${profile.name || "bienvenido"}`);
  const next = pendingAfterLogin;
  pendingAfterLogin = null;
  if(next) next();
}

/**
 * Inicializa GSI y pinta el botón dentro del diálogo. Si el SDK todavía no
 * cargó (va `async defer`), se reintenta cuando termine; si no puede cargar
 * nunca —`file://`, sin red— el diálogo explica por qué no hay botón en vez
 * de dejar un hueco mudo.
 */
function initWebAuth(){
  const box = document.getElementById("googleBtn");
  if(!box) return;
  if(!webAuthAvailable()){
    box.innerHTML = `<p class="note">El inicio de sesión de Google necesita que la página
      se abra por http(s). Ábrela desde el servidor del proyecto para poder alquilar.</p>`;
    return;
  }
  if(typeof google === "undefined" || !google.accounts || !google.accounts.id){
    const sdk = document.querySelector('script[src^="https://accounts.google.com/gsi/client"]');
    if(sdk) sdk.addEventListener("load", initWebAuth, { once: true });
    return;
  }
  google.accounts.id.initialize({ client_id: WEB_GOOGLE_CLIENT_ID, callback: onWebGoogleCredential });
  box.innerHTML = "";
  google.accounts.id.renderButton(box, {
    theme: "outline", size: "large", shape: "pill", text: "signin_with", width: 280,
  });
}

/**
 * Escribe (o borra) el aviso del diálogo de sesión. Tiene `role="status"`, así
 * que un lector de pantalla lo anuncia sin robar el foco.
 * @param {string} [msg] Texto; vacío lo oculta.
 */
function showLoginHint(msg){
  const el = document.getElementById("loginHint");
  if(!el) return;
  el.textContent = msg || "";
  el.hidden = !msg;
}

/**
 * Pinta el rincón de sesión de la cabecera: el botón de entrar cuando no hay
 * nadie, y la FOTO DE PERFIL cuando sí. La foto es la señal de "estás dentro"
 * que la gente ya conoce de cualquier otro sitio; un botón que sigue diciendo
 * "Iniciar sesión" después de entrar es el mismo botón mintiendo.
 *
 * La foto de Google puede fallar (el enlace caduca), así que detrás va siempre
 * la inicial del nombre: un hueco roto es peor que ninguna foto.
 */
function renderSession(){
  const box = document.getElementById("sessionBox");
  if(!box) return;
  if(!webUser){
    box.innerHTML = `<button class="ghost-btn" data-action="openLogin">Iniciar sesión</button>`;
    return;
  }
  const nombre = profile.name || profile.email || "Tu cuenta";
  const inicial = escapeHTML(nombre.trim().charAt(0).toUpperCase() || "?");
  const foto = profile.picture
    ? `<img src="${escapeHTML(profile.picture)}" alt="" referrerpolicy="no-referrer"
            onerror="this.remove()">`
    : "";
  box.innerHTML = `
    <button class="avatar-btn" data-action="toggleUserMenu"
            aria-label="Tu cuenta: ${escapeHTML(nombre)}" aria-expanded="${userMenuOpen}">
      ${inicial}${foto}
    </button>
    ${userMenuOpen ? `
      <div class="user-menu">
        <div class="u-name">${escapeHTML(nombre)}</div>
        ${profile.email ? `<div class="u-mail">${escapeHTML(profile.email)}</div>` : ""}
        <hr>
        <p class="note" style="margin:0 0 10px">Tus pedidos, puntos y reseñas están en la app.</p>
        <button class="ghost-btn" data-action="signOut">Cerrar sesión</button>
      </div>` : ""}`;
}

/** Abre o cierra el menú de la cuenta (el que cuelga de la foto de perfil). */
function toggleUserMenu(){
  userMenuOpen = !userMenuOpen;
  renderSession();
}

/** Cierra el menú de la cuenta si estaba abierto (al pulsar fuera, o con Esc). */
function closeUserMenu(){
  if(!userMenuOpen) return;
  userMenuOpen = false;
  renderSession();
}
