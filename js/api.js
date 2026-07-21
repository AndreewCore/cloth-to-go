/* ============================================================
   CLOTH TO GO · api.js
   Puente OPCIONAL con el backend. Si el servidor está disponible,
   reemplaza el catálogo embebido por el de la base; si no (por
   ejemplo abriendo por file://), la app sigue funcionando con los
   datos locales de data.js. Se carga antes de main.js, que decide
   cuándo hidratar.
   ============================================================ */

// Origen del backend. Ajustar si el servidor corre en otra máquina o puerto.
const API_BASE = "http://localhost:3000";

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
