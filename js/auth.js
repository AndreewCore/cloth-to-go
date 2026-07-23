/* ============================================================
   CLOTH TO GO · auth.js
   Sesión de usuario con Google Identity Services (GSI).

   En GitHub Pages no hay backend: el navegador recibe un ID token FIRMADO por
   Google y de ahí sacamos la identidad (nombre, email, foto, sub). NO se
   verifica la firma aquí — sin servidor no hay con qué, y por eso el token
   sirve para IDENTIFICAR (demo), no para AUTORIZAR. La verificación real llega
   en la fase de backend (feature/auth-verify).

   Depende de state.js (activeStorageKey, storageKeyFor, resetStateToDefaults,
   loadState, profile). Se carga antes que main.js.
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
  greeting.textContent = "Moda circular · paga por día 🌱";
  loginEl.classList.remove("hide");
  initGoogleAuth();            // repinta el botón de Google en la bienvenida
}

/**
 * Callback de GSI al recibir la credencial: extrae la identidad, activa la
 * sesión del usuario y entra a la app.
 * @param {{credential:string}} resp Respuesta de Google con el ID token.
 */
function onGoogleCredential(resp){
  const claims = decodeJwt(resp && resp.credential);
  if(!claims || !claims.sub){
    toast("No se pudo iniciar sesión con Google");
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
  google.accounts.id.renderButton(box, { theme: "outline", size: "large", shape: "pill", text: "signin_with", width: 240 });
}
