/* ============================================================
   CLOTH TO GO · auth.js
   Sesión de usuario con Google Identity Services (GSI).

   Con backend disponible, el ID token se manda a POST /api/auth/google, que
   verifica la firma de verdad con google-auth-library (ver server/). Sin
   backend (GitHub Pages sin desplegar, file://) se cae a decodeJwt(): el
   navegador solo LEE el token sin comprobar la firma, así que identifica
   (demo) pero no autoriza. onGoogleCredential decide cuál de los dos usar.

   Depende de state.js (activeStorageKey, storageKeyFor, resetStateToDefaults,
   loadState, profile) y de api.js (backend, verifyGoogleCredential). Se carga
   antes que main.js.
   ============================================================ */

// Client ID público de Google Cloud Console (no es secreto: la app se protege
// por la lista de orígenes autorizados). Rellenar con el ID real:
// "…….apps.googleusercontent.com".
const GOOGLE_CLIENT_ID = "115840486389-f3vitcouhua5eckn3grn1gk9kqb7ccjs.apps.googleusercontent.com";

// Usuario en sesión: null = invitado; si no, { sub, name, email, picture }.
let currentUser = null;

/**
 * Indica si el login con Google puede ofrecerse. GSI exige un origen http/https
 * autorizado; por `file://` no funciona, igual que el backend en api.js. En ese
 * caso la app degrada a "Entrar como invitado".
 * @returns {boolean}
 */
function authAvailable(){ return location.protocol !== "file:"; }

/**
 * Decodifica el payload (claims) de un JWT sin verificar la firma. Suficiente
 * para leer la identidad de demo; no da garantía de autenticidad.
 * @param {string} token ID token de Google (header.payload.signature).
 * @returns {object|null} Claims, o null si el token está mal formado.
 */
function decodeJwt(token){
  try {
    const payload = token.split(".")[1];
    // base64url → base64, y decodifica respetando UTF-8 (nombres con acentos/emoji).
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(b64).split("").map(c => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join(""),
    );
    return JSON.parse(json);
  } catch(e){
    return null;
  }
}

/**
 * Deja el estado listo para el usuario dado y carga sus datos guardados.
 * Arranque limpio (descarta lo que hubiera de una sesión anterior) y luego,
 * si el usuario ya tenía datos en este navegador, los recupera de su clave.
 * @param {{sub:string,name?:string,email?:string,picture?:string}|null} user
 *   Usuario a activar, o null para el invitado (sesión efímera sin registro).
 */
function activateUserSession(user){
  currentUser = user;
  resetStateToDefaults();
  activeStorageKey = storageKeyFor(user);
  loadState();
  // Liquida los puntos de los pedidos que se entregaron desde la última visita:
  // no hay tareas programadas, así que la puesta al día ocurre al abrir sesión.
  // Las metas se liquidan junto a los puntos por pedido: dependen de los mismos
  // pedidos y un perfil recién migrado puede traer metas ya ganadas sin cobrar.
  const goalsHit = creditWaterGoals();
  if(creditDeliveredPoints() || goalsHit.length) saveState();
  // Metas cruzadas mientras la app estaba cerrada: se felicitan al entrar.
  celebrateWaterGoals(goalsHit);
  // La identidad de Google rellena el perfil (el usuario puede editar el resto).
  if(user){
    if(user.name)    profile.name    = user.name;
    if(user.email)   profile.email   = user.email;
    if(user.picture) profile.picture = user.picture;
    saveState();
  }
}

/**
 * Cierra la sesión activa (invitado o usuario), descarta el estado en memoria
 * y regresa a la pantalla de bienvenida. En cuentas de Google desactiva la
 * selección automática para que la próxima vez se vuelva a elegir cuenta.
 */
function signOut(){
  if(currentUser && authAvailable() && typeof google !== "undefined" && google.accounts && google.accounts.id){
    google.accounts.id.disableAutoSelect();
  }
  closeSheet();
  activateUserSession(null);   // vacía carrito/perfil/pedidos de la sesión actual
  currentUser = null;
  greeting.textContent = "Moda circular · paga por día";
  loginHint("");               // un fallo anterior no debe recibir al que vuelve
  loginEl.classList.remove("hide");
  initGoogleAuth();            // repinta el botón de Google en la bienvenida
}

/**
 * Escribe (o borra) el aviso bajo el botón de Google, dentro de la propia
 * tarjeta de bienvenida.
 *
 * Existe porque el toast no basta ahí: dura 1,6 s y vive fuera de la tarjeta,
 * así que un fallo de login se lo pierde quien estaba mirando el botón. El
 * elemento ya tiene `role="status"`, de modo que un lector de pantalla lo
 * anuncia sin robar el foco.
 * @param {string} [msg] Texto del aviso; vacío o ausente lo oculta.
 */
function loginHint(msg){
  const el = document.getElementById("loginHint");
  if(!el) return;
  el.textContent = msg || "";
  el.hidden = !msg;
}

/**
 * Anuncia un fallo de inicio de sesión por los dos canales a la vez.
 *
 * El toast es lo que el usuario ya conoce del resto de la app; el hint es lo
 * que sigue ahí cuando el toast se va. Un fallo silencioso en esta pantalla
 * deja al usuario mirando un botón que "no hace nada", que es exactamente lo
 * que pasó en producción.
 * @param {string} msg Mensaje para el usuario.
 */
function loginFailed(msg){
  toast(msg);
  loginHint(msg);
}

/**
 * Callback de GSI al recibir la credencial: resuelve la identidad y entra.
 *
 * Si hay backend desplegado, la identidad DEBE venir verificada por el servidor
 * (firma comprobada): si la verificación falla o rechaza el token, NO se inicia
 * sesión — caer al decode local anularía justamente esa verificación. Sin
 * backend (file://, GitHub Pages sin API) se identifica con el decode local:
 * no hay nada que autorizar mientras el estado viva solo en el navegador.
 * @param {{credential:string}} resp Respuesta de Google con el ID token.
 */
async function onGoogleCredential(resp){
  const token = resp && resp.credential;
  let claims;
  loginHint("");
  if(backend.enabled){
    claims = await verifyGoogleCredential(token);
    if(!claims){
      loginFailed("No se pudo verificar tu sesión. Inténtalo de nuevo.");
      return;
    }
  } else {
    // Sin servidor no hay firma que comprobar: el token solo IDENTIFICA.
    //
    // Esto también aplica en producción, y es deliberado. Antes se rechazaba
    // aquí por miedo a la suplantación, pero rompía el único login de la demo
    // para protegerla de nada: la identidad solo elige la clave de
    // localStorage (storageKeyFor), así que falsificar un JWT únicamente abre
    // otra clave EN TU PROPIO navegador. No hay datos ajenos que leer ni nada
    // que autorizar mientras el estado no salga del cliente.
    //
    // El día que el backend guarde pedidos o dinero, esto deja de ser cierto
    // de golpe — pero ese día `backend.enabled` es true y la rama de arriba
    // exige la verificación del servidor. El riesgo y la defensa aparecen a la
    // vez; no hace falta anticiparla rompiendo la demo.
    if(backend.reason === "misconfigured") console.warn(API_OFF_REASONS.misconfigured);
    claims = decodeJwt(token);
  }
  if(!claims || !claims.sub){
    loginFailed("No se pudo iniciar sesión con Google.");
    return;
  }
  activateUserSession({
    sub: claims.sub,
    name: claims.name || claims.given_name || "",
    email: claims.email || "",
    picture: claims.picture || "",
  });
  enter(profile.name || "");
}

/**
 * Inicializa GSI y pinta el botón de Google en la bienvenida. Si el login no
 * está disponible (`file://`) o el SDK no cargó, oculta el contenedor y deja
 * únicamente el acceso como invitado.
 */
function initGoogleAuth(){
  const box = document.getElementById("googleBtn");
  if(!box) return;
  // Por file:// el login no aplica: ocultar y quedarse con el invitado.
  if(!authAvailable()){ box.hidden = true; return; }
  // El SDK carga async y puede no estar listo aún: reintentar cuando termine.
  if(typeof google === "undefined" || !google.accounts || !google.accounts.id){
    const sdk = document.querySelector('script[src^="https://accounts.google.com/gsi/client"]');
    if(sdk) sdk.addEventListener("load", initGoogleAuth, { once: true });
    return;
  }
  google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onGoogleCredential });
  renderGoogleButton();
}

/**
 * Pinta (o repinta) el botón de Google con el tema activo.
 *
 * El botón lo dibuja el SDK, no nuestro CSS, así que el tema hay que pasárselo
 * a él: `filled_black` en oscuro, `outline` en claro. Y como el marcado ya
 * generado no reacciona al cambio de tema, hay que volver a pedirlo — de ahí
 * que esto sea una función aparte y no una línea dentro de initGoogleAuth().
 */
function renderGoogleButton(){
  const box = document.getElementById("googleBtn");
  if(!box || box.hidden) return;
  if(typeof google === "undefined" || !google.accounts || !google.accounts.id) return;
  box.innerHTML = "";
  google.accounts.id.renderButton(box, {
    theme: effectiveTheme() === "dark" ? "filled_black" : "outline",
    size: "large", shape: "pill", text: "signin_with", width: 240
  });
}
