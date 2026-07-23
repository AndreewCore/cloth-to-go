/* ============================================================
   CLOTH TO GO · api.js
   Puente OPCIONAL con el backend. Si el servidor está disponible,
   reemplaza el catálogo embebido por el de la base; si no (por
   ejemplo abriendo por file://), la app sigue funcionando con los
   datos locales de data.js. Se carga antes de main.js, que decide
   cuándo hidratar.
   ============================================================ */

// URL https del backend desplegado. Sigue en null mientras no exista.
const DEPLOYED_API = null;

// Puerto donde escucha el backend en desarrollo (el PORT de server/.env).
const LOCAL_API_PORT = 3000;

// Permite apuntar el sitio desplegado a un backend de prueba sin tocar el
// código: basta con escribir la clave en localStorage desde la consola.
const API_OVERRIDE_KEY = "clothToGo:apiBase";

// Motivo por el que no se consulta al backend. Se guarda junto al resultado
// para que el mensaje de consola diga *qué* pasó y no solo que no hubo API.
const API_OFF_REASONS = {
  file: "La app se abrió por file://, que no permite peticiones al backend.",
  override: `El valor de ${API_OVERRIDE_KEY} en localStorage no es una URL http(s) válida.`,
  undeployed: "No hay backend publicado para este dominio todavía.",
  mixed: "Una página https no puede consultar un backend http (mixed content).",
};

/**
 * Lee el origen forzado desde localStorage, aceptándolo solo si es una URL
 * http(s). Sin validar, un valor suelto como "hola" o "javascript:…" acabaría
 * usándose como destino de los fetch.
 * @returns {{ok: true, base: string}|{ok: false}|null} null si no hay override.
 */
function readApiOverride() {
  let raw;
  try {
    // Leer localStorage lanza si el almacenamiento está bloqueado (Safari en
    // modo privado, iframe con sandbox). Sin esto, la excepción subiría hasta
    // el nivel superior del script y dejaría la app sin arrancar.
    raw = localStorage.getItem(API_OVERRIDE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false };
    return { ok: true, base: url.origin };
  } catch {
    return { ok: false };
  }
}

/**
 * Backend que le corresponde al host actual, o null si no hay ninguno.
 *
 * En desarrollo se deriva del propio host en vez de fijar "localhost": así la
 * demo abierta desde el móvil (http://192.168.x.x:8000) apunta a la laptop que
 * la sirve y no al teléfono. Producción va siempre por https, de modo que una
 * prueba en la red local nunca puede acabar hablando con el backend real.
 *
 * @returns {string|null} Origen del backend.
 */
function backendForHost() {
  if (location.protocol === "https:") return DEPLOYED_API;
  return `http://${location.hostname}:${LOCAL_API_PORT}`;
}

/**
 * Indica si pedir a `base` sería contenido mixto. El navegador bloquea esas
 * peticiones antes de que salgan, así que conviene ni intentarlo.
 * @param {string} base Origen del backend.
 */
function isMixedContent(base) {
  return location.protocol === "https:" && base.startsWith("http://");
}

/**
 * Decide contra qué backend hablar según dónde se esté ejecutando la app.
 *
 * Devuelve el motivo cuando no hay backend alcanzable, en vez de un null mudo:
 * "file://", "sin desplegar" y "mixed content" son situaciones muy distintas a
 * la hora de diagnosticar por qué la demo se quedó con los datos locales.
 *
 * @returns {{enabled: true, base: string}|{enabled: false, reason: string}}
 */
function resolveApiBase() {
  const override = readApiOverride();
  if (override && !override.ok) return { enabled: false, reason: "override" };

  if (location.protocol === "file:") return { enabled: false, reason: "file" };

  // El override elige el destino, pero no exime de las reglas del navegador:
  // las comprobaciones siguientes valen para cualquier origen.
  const base = override ? override.base : backendForHost();
  if (!base) return { enabled: false, reason: "undeployed" };
  if (isMixedContent(base)) return { enabled: false, reason: "mixed" };

  return { enabled: true, base };
}

const backend = resolveApiBase();

/**
 * Reemplaza in situ el catálogo embebido (PRODUCTS y su índice PRODUCT_BY_ID)
 * conservando las mismas referencias globales que usa el resto de la app, para
 * no romper el modelo de ámbito global compartido.
 * @param {Array<object>} items Prendas provenientes de la API.
 */
function replaceCatalog(items) {
  PRODUCTS.length = 0;
  PRODUCTS.push(...items);
  PRODUCT_BY_ID.clear();
  for (const p of PRODUCTS) PRODUCT_BY_ID.set(p.id, p);
}

/**
 * Intenta traer el catálogo del backend y, si lo logra, refresca la vista.
 * Falla en silencio (sin romper la demo) cuando no hay servidor o red.
 * @returns {Promise<boolean>} true si el catálogo se hidrató desde la API.
 */
async function hydrateCatalog() {
  if (!backend.enabled) {
    console.info(`${API_OFF_REASONS[backend.reason]} Se usa el catálogo local.`);
    return false;
  }
  try {
    const res = await fetch(`${backend.base}/api/products`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = await res.json();
    if (Array.isArray(items) && items.length) {
      replaceCatalog(items);
      renderFilters();
      renderGrid();
      console.info(`Catálogo cargado desde el backend (${items.length} prendas).`);
      return true;
    }
  } catch (err) {
    console.info("Backend no disponible; se usa el catálogo local.", err.message);
  }
  return false;
}

/**
 * Verifica un ID token de Google contra el backend (POST /api/auth/google),
 * si hay uno disponible. Devuelve null cuando no hay backend o falla el
 * fetch, para que quien llame caiga sin sobresaltos al modo demo
 * (auth.js decodifica el token en el cliente sin comprobar la firma).
 * @param {string} credential ID token de Google recibido de GSI.
 * @returns {Promise<{sub:string,name:string,email:string,picture:string}|null>}
 */
async function verifyGoogleCredential(credential) {
  if (!backend.enabled) return null;
  try {
    const res = await fetch(`${backend.base}/api/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { user } = await res.json();
    return user ?? null;
  } catch (err) {
    console.info("No se pudo verificar el login con el backend; se usa el modo demo.", err.message);
    return null;
  }
}
