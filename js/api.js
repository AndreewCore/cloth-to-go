/* ============================================================
   CLOTH TO GO · api.js
   Puente OPCIONAL con el backend. Si el servidor está disponible,
   reemplaza el catálogo embebido por el de la base; si no (por
   ejemplo abriendo por file://), la app sigue funcionando con los
   datos locales de data.js. Se carga antes de main.js, que decide
   cuándo hidratar.
   ============================================================ */

// URL https del backend desplegado (Render), sin barra final. Si vuelve a
// null, en un host de producción el despliegue queda `misconfigured` y el login
// se deshabilita a propósito (#17). Paso 4.1 de server/DEPLOY.md.
const DEPLOYED_API = "https://cloth-to-go-api.onrender.com";

// Puerto donde escucha el backend en desarrollo (el PORT de server/.env).
const LOCAL_API_PORT = 3000;

// Hosts donde la app se publica de cara al público. Existen para distinguir un
// "todavía no hay backend" (legítimo: la demo corre con datos locales) de un
// "producción quedó sin configurar", que es un fallo y no debe pasar callado.
const PRODUCTION_HOSTS = ["andreewcore.github.io"];

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
  misconfigured:
    "DEPLOYED_API sigue en null en un origen de producción: el despliegue " +
    "quedó sin configurar. El login real está deshabilitado a propósito.",
};

/**
 * ¿La app se está sirviendo desde un origen de producción?
 * @returns {boolean}
 */
function isProductionHost() {
  return PRODUCTION_HOSTS.includes(location.hostname);
}

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
  // Sin backend en un host de producción no es "todavía no": es un despliegue
  // mal configurado. Se separa del caso legítimo para que auth.js pueda negarse
  // a caer al modo demo, en vez de validar identidades sin verificar firma.
  if (!base) {
    return { enabled: false, reason: isProductionHost() ? "misconfigured" : "undeployed" };
  }
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
  // Desde aquí el catálogo trae ejemplares (`items`) con su id: es lo único
  // que un pedido puede reservar. Con el embebido no se puede alquilar.
  catalogFromApi = true;
}

/** true cuando PRODUCTS vino de la API (trae ids de ejemplar); ver replaceCatalog. */
let catalogFromApi = false;

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
 * Trae el calendario del negocio (GET /api/config: días cerrados y feriados) y
 * vuelve a encajar las fechas elegidas en días hábiles. Sin backend se queda el
 * calendario local, que solo cierra fines de semana: el servidor rechaza un
 * feriado de todos modos, y esto es solo para no ofrecerlo.
 * @param {boolean} [endAfterStart=false] La web exige devolver al menos un día
 *   después del inicio; la app admite un alquiler de un día que empieza y acaba
 *   el mismo día (ver snapRentalDates).
 * @returns {Promise<boolean>} true si el calendario llegó de la API.
 */
async function hydrateCalendar(endAfterStart = false) {
  if (!backend.enabled) return false;
  try {
    const res = await fetch(`${backend.base}/api/config`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setBusinessCalendar(await res.json());
    snapRentalDates(endAfterStart);
    return true;
  } catch (err) {
    console.info("Calendario del negocio no disponible; se cierran solo los fines de semana.", err.message);
    return false;
  }
}

/**
 * Pide al backend el contador común de agua ahorrada (GET /api/impact/water).
 * Sin backend o con fallo devuelve null: quien llama esconde la sección en vez
 * de inventar una cifra, porque es un dato de toda la comunidad y no tiene un
 * equivalente local honesto.
 * @returns {Promise<{liters:number, goal:number, reached:number[], cutAt:string, nextCutAt:string}|null>}
 */
async function fetchWaterImpact() {
  if (!backend.enabled) return null;
  try {
    const res = await fetch(`${backend.base}/api/impact/water`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Number.isFinite(data?.liters) && data.goal > 0 ? data : null;
  } catch (err) {
    console.info("No se pudo leer el contador de agua; la sección queda oculta.", err.message);
    return null;
  }
}

/**
 * Pregunta al backend si el asistente informativo está encendido
 * (GET /api/chat/status). Sin backend o con fallo devuelve null y la web no
 * muestra la burbuja: el asistente no tiene versión local.
 * @returns {Promise<{enabled:boolean, foundation:string}|null>}
 */
async function fetchChatStatus() {
  if (!backend.enabled) return null;
  try {
    const res = await fetch(`${backend.base}/api/chat/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data?.enabled ? data : null;
  } catch (err) {
    console.info("Asistente no disponible; la burbuja queda oculta.", err.message);
    return null;
  }
}

/**
 * Envía una pregunta al asistente (POST /api/chat). Nunca lanza: el panel
 * pinta lo que vuelva, sea la respuesta o el motivo del fallo, que el
 * servidor ya redacta para el visitante (límite, ocupado, pregunta inválida).
 * @param {string} message Pregunta del visitante.
 * @param {{role:"user"|"model", text:string}[]} history Turnos anteriores.
 * @returns {Promise<{reply:string}|{error:string}>}
 */
async function askChatbot(message, history) {
  const offline = { error: "No pude conectarme con el asistente. Revisa tu conexión e inténtalo de nuevo." };
  if (!backend.enabled) return offline;
  try {
    const res = await fetch(`${backend.base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && typeof data.reply === "string") return { reply: data.reply };
    return { error: data.error || offline.error };
  } catch {
    return offline;
  }
}

/**
 * Verifica un ID token de Google contra el backend (POST /api/auth/google).
 * Devuelve la identidad verificada, o null si la verificación no fue posible
 * (sin backend, fetch fallido, o token rechazado). Con backend presente, quien
 * llama trata ese null como fallo de sesión — NO como permiso para entrar sin
 * verificar; el modo demo (decode local) solo aplica cuando no hay backend.
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
    const { user, token } = await res.json();
    // La sesión propia del servidor: es lo que viaja en adelante, no el ID
    // token de Google, que caduca en una hora (ver server/src/sessions.js).
    if (token) storeSessionToken(token);
    return user ?? null;
  } catch (err) {
    // El mensaje decía "se usa el modo demo", que es justo lo que NO pasa:
    // devolver null aquí aborta el login. Dejarlo así mandaba a buscar el fallo
    // al sitio equivocado.
    console.warn("No se pudo verificar el login con el backend; no se inicia sesión.", err.message);
    return null;
  }
}


/* ============================================================
   Cuenta: sesión, pedidos y puntos (fase 3)
   Los pedidos, el saldo y los canjes viven en la base. El navegador guarda
   solo el token de sesión que entrega POST /api/auth/google, y todo lo demás
   lo pide a la API: el cliente propone, el servidor decide.
   ============================================================ */

// Clave del token de sesión en localStorage. Es un token opaco del servidor
// (no el de Google) y caduca a los 30 días.
const SESSION_KEY = "clothToGo:session";

/** Token de sesión guardado, o null. */
function readSessionToken() {
  try { return localStorage.getItem(SESSION_KEY); } catch { return null; }
}
/** Guarda el token de sesión recién emitido. */
function storeSessionToken(token) {
  try { localStorage.setItem(SESSION_KEY, token); } catch { /* sin almacenamiento: dura lo que la pestaña */ }
}
/** Olvida el token de sesión. */
function clearSessionToken() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* nada que borrar */ }
}

/**
 * ¿Se puede alquilar ahora? Hace falta API, catálogo de la API (con ids de
 * ejemplar) y una sesión de la API. Sin cualquiera de las tres, un pedido no
 * tiene dónde guardarse.
 * @returns {boolean}
 */
function canRentOnline() {
  return backend.enabled && catalogFromApi && !!readSessionToken();
}

/**
 * Petición a la API con la sesión en `Authorization`.
 *
 * Nunca lanza: devuelve `{ok, status, data}` y, sin red, `status: 0` con un
 * mensaje para el cliente. Un 401 significa que la sesión caducó o se revocó:
 * se olvida el token y se avisa a la superficie (`onSessionExpired`, que define
 * auth.js en la app y session.js en la web) para que vuelva a pedir el login.
 * @param {string} path Ruta, p. ej. "/api/orders".
 * @param {{method?: string, body?: object}} [opts]
 * @returns {Promise<{ok: boolean, status: number, data: any}>}
 */
async function apiFetch(path, { method = "GET", body } = {}) {
  if (!backend.enabled) return { ok: false, status: 0, data: { error: "Hace falta conexión con el servidor." } };
  const headers = {};
  const token = readSessionToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  try {
    const res = await fetch(`${backend.base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (res.status === 401 && token) {
      clearSessionToken();
      if (typeof onSessionExpired === "function") onSessionExpired();
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "No hay conexión con el servidor. Inténtalo de nuevo." } };
  }
}

/** Mensaje de error de una respuesta de apiFetch, listo para un toast. */
function apiErrorText(r) {
  return (r && r.data && r.data.error) || "No se pudo completar. Inténtalo de nuevo.";
}

/**
 * Cierra la sesión en el servidor y la olvida aquí. No espera la respuesta:
 * el token se borra igual, y un fallo de red no puede dejar a nadie dentro.
 */
function logoutSession() {
  const token = readSessionToken();
  clearSessionToken();
  if (!token || !backend.enabled) return;
  fetch(`${backend.base}/api/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } })
    .catch(() => { /* el token ya no está aquí; si sigue vivo, caduca solo */ });
}

/**
 * Día de calendario local (`YYYY-MM-DD`) de un instante ISO de la API.
 * @param {string|null} iso Instante, p. ej. `createdAt`.
 * @returns {string}
 */
function localDayOf(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = v => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Traduce un pedido de la API a la forma que pintan el perfil y la
 * confirmación. Los importes vienen del libro de cargos del servidor; aquí no
 * se recalcula ninguno.
 * @param {object} o Pedido de GET/POST /api/orders.
 * @returns {object} Pedido para `orders`.
 */
function orderFromApi(o) {
  // Precio cobrado por cada prenda: las líneas RENTAL llevan el ejemplar.
  const porEjemplar = new Map((o.charges || []).filter(c => c.type === "RENTAL").map(c => [c.itemId, c.amountCents]));
  const itemPrices = {};
  (o.itemIds || []).forEach((itemId, i) => { itemPrices[o.items[i]] = (porEjemplar.get(itemId) || 0) / 100; });
  return {
    id: o.id,
    date: localDayOf(o.createdAt),
    items: o.items.slice(),
    itemIds: (o.itemIds || []).slice(),
    itemPrices,
    start: o.start,
    end: o.end,
    returnBy: o.returnBy || o.end,
    delivery: o.delivery,
    ret: o.ret,
    retAddr: o.retAddr || "",
    shipAddr: o.shipAddr || "",
    shipCoords: null,
    retCoords: null,
    pay: o.pay,
    status: o.status,
    cancelledAt: o.cancelledAt ? localDayOf(o.cancelledAt) : null,
    total: o.totalCents / 100,
    deposit: o.depositHeldCents / 100,
    discount: (o.discountCents || 0) / 100,
    couponId: o.couponId ?? null,
    points: o.points || 0,
    pointsCredited: !!o.pointsCredited,
  };
}

/**
 * Traduce un cupón de la API a la forma de `profile.redeemed`.
 * @param {object} c Cupón de GET /api/me/points.
 * @returns {object}
 */
function couponFromApi(c) {
  return {
    id: c.id,
    rewardId: c.rewardId,
    name: c.name,
    cost: c.cost,
    date: fmtDate(localDayOf(c.issuedAt)),
    usedIn: c.usedIn,
    revoked: !!c.revoked,
  };
}

/**
 * Trae de la API los pedidos y el estado de puntos de la sesión y los adopta
 * (applyAccount). Sin sesión o sin red no toca nada.
 * @returns {Promise<{goals: object[]}|null>} Metas de agua recién cobradas, o
 *   null si no se pudo sincronizar.
 */
async function refreshAccount() {
  if (!readSessionToken()) return null;
  const [o, p] = await Promise.all([apiFetch("/api/orders"), apiFetch("/api/me/points")]);
  if (!o.ok || !p.ok || !Array.isArray(o.data)) return null;
  return { goals: applyAccount({ orders: o.data.map(orderFromApi), points: p.data }) };
}

/* ============================================================
   Cotización del carrito (fase 3): solo el servidor pone precio.
   ============================================================ */

// Clave del carrito que se está cotizando ahora mismo y su petición: quien pida
// la misma cotización mientras la primera no ha vuelto espera a esa, en vez de
// lanzar otra.
let quoteInFlight = "";
let quotePromise = null;

/**
 * Pide al servidor la cotización del carrito tal como está, si la vigente no
 * es la suya. Las vistas la llaman al pintarse y enseñan "—" mientras tanto;
 * al llegar, `onQuoteUpdated` (cada superficie define el suyo) las repinta.
 * Una respuesta vieja —el carrito cambió mientras viajaba— se descarta.
 * @returns {Promise<boolean>} true si llegó una cotización nueva.
 */
async function requestQuote() {
  if (!cart.length || quoteReady() || !catalogFromApi || !backend.enabled) return false;
  const body = cartQuoteBody();
  if (!body.items) return false;              // alguna prenda sin ejemplar libre
  const key = JSON.stringify(body);
  if (key === quoteInFlight) return quotePromise;
  quoteInFlight = key;
  quotePromise = (async () => {
    const r = await apiFetch("/api/quote", { method: "POST", body });
    if (quoteInFlight === key) quoteInFlight = "";
    if (!r.ok || key !== currentQuoteKey()) return false;
    quote = r.data;
    quoteKey = key;
    if (typeof onQuoteUpdated === "function") onQuoteUpdated();
    return true;
  })();
  return quotePromise;
}
