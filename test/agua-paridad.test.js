/**
 * Guardarraíl de la huella hídrica duplicada.
 *
 * Los litros de una prenda viven en `js/data.js` (los que ve cada perfil y
 * alimentan sus metas) y en `server/src/water.js` (los que suma el contador
 * común de la web). Si difieren, la suma de los perfiles y el contador de todos
 * contarían agua distinta por el mismo alquiler. Mismo arreglo que
 * `pricing-paridad.test.js`: vive en esta suite porque quien toca un material
 * lo toca en `js/data.js` y corre `pnpm test`.
 */
const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { loadApp } = require("./helpers/load-app.js");

const front = loadApp();
let server;

before(async () => {
  const ruta = path.join(__dirname, "..", "server", "src", "water.js");
  server = await import(pathToFileURL(ruta).href);
});

test("misma intensidad hídrica por material", () => {
  assert.deepEqual({ ...server.WATER_PER_KG }, { ...front.WATER_PER_KG });
});

test("mismos litros por prenda en todo el catálogo", () => {
  for (const p of front.PRODUCTS) {
    assert.equal(server.garmentWater(p), front.garmentWater(p), `prenda ${p.id}`);
  }
  // Un material desconocido cae al algodón en los dos lados.
  const rara = { material: "seda", weightKg: 0.4 };
  assert.equal(server.garmentWater(rara), front.garmentWater(rara));
});
