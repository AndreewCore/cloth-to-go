/**
 * Catálogo de las pruebas del frontend. Desde que `js/data.js` ya no trae
 * catálogo (vive solo en la base), las vistas se prueban con el mismo que
 * siembra el servidor: `server/prisma/seed.js`, una sola fuente.
 *
 * La semilla es un módulo ESM que abre Prisma al cargarse; se evalúa solo el
 * literal `PRODUCTS` para no arrastrar la base a pruebas que no la necesitan.
 */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SEED = path.join(__dirname, "..", "..", "server", "prisma", "seed.js");

/**
 * Prendas tal como se siembran, más `disponibles: 1` (la semilla lo deja al
 * `@default(1)` del esquema).
 * @returns {object[]}
 */
function seedProducts() {
  const src = fs.readFileSync(SEED, "utf8");
  const desde = src.indexOf("const PRODUCTS = [");
  if (desde < 0) throw new Error("catalog-fixture: la semilla ya no declara `const PRODUCTS = [`");
  const hasta = src.indexOf("];", desde) + 2;
  return vm.runInNewContext(src.slice(desde, hasta) + " PRODUCTS", {}).map((p) => ({ ...p, disponibles: 1 }));
}

/**
 * Código que, ejecutado justo después de `js/data.js` en el mismo ámbito,
 * llena `PRODUCTS` con la semilla como si el catálogo hubiera llegado. No toca
 * `catalogFromApi`: eso lo decide cada prueba (la de cuenta usa replaceCatalog).
 */
const CATALOG_FIXTURE_JS = `
;PRODUCTS.push(...${JSON.stringify(seedProducts())});
for (const p of PRODUCTS) PRODUCT_BY_ID.set(p.id, p);
refreshCatalogLists();
`;

module.exports = { seedProducts, CATALOG_FIXTURE_JS };
