/* ============================================================
   CLOTH TO GO · api.js
   Puente OPCIONAL con el backend. Si el servidor está disponible,
   reemplaza el catálogo embebido por el de la base; si no (por
   ejemplo abriendo por file://), la app sigue funcionando con los
   datos locales de data.js. Se carga antes de main.js, que decide
   cuándo hidratar.
   ============================================================ */

// Origen del backend cuando se corre en local. Al desplegar el backend, poner
// aquí su URL https en DEPLOYED_API y quitar el null de resolveApiBase().
const LOCAL_API = "http://localhost:3000";
const DEPLOYED_API = null;

/**
 * Decide contra qué backend hablar según dónde se esté ejecutando la app.
 *
 * Devuelve null cuando no hay backend alcanzable (abierto por file://, o
 * desplegado sin API publicada); en ese caso no se intenta ningún fetch y la
 * app usa el catálogo embebido sin ensuciar la consola con errores de red.
 *
 * Se puede forzar un origen para pruebas guardando `clothToGo:apiBase` en
 * localStorage, útil para apuntar el sitio desplegado a un backend de prueba.
 *
 * @returns {string|null} Origen del backend, o null si no hay que consultarlo.
 */
function resolveApiBase() {
  const override = localStorage.getItem("clothToGo:apiBase");
  if (override) return override;

  // Sin origen HTTP no hay CORS posible: file:// se queda con los datos locales.
  if (location.protocol === "file:") return null;

  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const base = isLocal ? LOCAL_API : DEPLOYED_API;
  if (!base) return null;

  // Una página https no puede pedir a http (mixed content): el navegador lo
  // bloquea antes de salir. Mejor no intentarlo.
  if (location.protocol === "https:" && base.startsWith("http://")) return null;

  return base;
}

const API_BASE = resolveApiBase();

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
  if (!API_BASE) {
    console.info("Sin backend configurado para este origen; se usa el catálogo local.");
    return false;
  }
  try {
    const res = await fetch(`${API_BASE}/api/products`);
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
