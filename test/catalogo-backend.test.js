/**
 * El catálogo vive DOS veces y nada obligaba a que coincidieran.
 *
 * `js/data.js` lo trae embebido (es lo que se ve en `file://` y cuando el
 * backend no responde) y `server/prisma/seed.js` lo siembra en la base. En
 * medio, `hydrateCatalog()` sustituye el primero por el segundo **en silencio**
 * si la API contesta: esa es la degradación que hace que la demo abra con doble
 * clic, y también lo que convierte una divergencia en un fantasma — la misma
 * prenda con otro precio o otra foto según si el servidor estaba levantado, sin
 * un solo error por ninguna parte.
 *
 * Esta prueba no opina sobre cuál de los dos debe ser la fuente de verdad (hoy
 * la transición apunta a la base). Solo exige que digan lo mismo mientras haya
 * dos, que es el estado en el que el proyecto lleva desde que existe el
 * servidor.
 *
 * Vive en la suite del FRONTEND a propósito, aunque hable de la semilla: quien
 * añade una prenda casi siempre lo hace en `js/data.js` y corre `pnpm test`,
 * no la suite de `server/`. Aquí el fallo le llega en el momento en que puede
 * arreglarlo. No toca Prisma ni la base: son dos archivos leídos y comparados.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { loadApp } = require("./helpers/load-app.js");

const ROOT = path.join(__dirname, "..");
const SEED = path.join(ROOT, "server", "prisma", "seed.js");

/**
 * Extrae el array PRODUCTS de la semilla sin importarla.
 *
 * `seed.js` es un módulo ESM que abre una conexión de Prisma al cargarse; se
 * evalúa solo el literal del catálogo para no arrastrar la base a una prueba
 * que no la necesita.
 * @returns {object[]} Prendas tal como se siembran.
 */
function seedProducts() {
  const src = fs.readFileSync(SEED, "utf8");
  const desde = src.indexOf("const PRODUCTS = [");
  assert.notEqual(desde, -1, "la semilla ya no declara `const PRODUCTS = [`");
  const hasta = src.indexOf("];", desde) + 2;
  return vm.runInNewContext(src.slice(desde, hasta) + " PRODUCTS", { JSON });
}

// Campos que ambos lados declaran igual. `disponibles` va aparte: la semilla lo
// omite y se apoya en el `@default(1)` del esquema.
const CAMPOS = ["name", "cat", "value", "stars", "size", "color", "material", "weightKg", "desc"];

test("el catálogo embebido y la semilla del backend tienen las mismas prendas", () => {
  const front = loadApp().PRODUCTS;
  const seed = seedProducts();

  // Array.from: `front` viene del realm del `vm` y deepEqual compara también
  // el prototipo, así que dos arrays con el mismo contenido no serían iguales.
  assert.deepEqual(
    Array.from(seed, (p) => p.id).sort((a, b) => a - b),
    Array.from(front, (p) => p.id).sort((a, b) => a - b),
    "las listas de ids no coinciden: sobra o falta una prenda en un lado",
  );
});

test("cada prenda coincide campo por campo", () => {
  const front = loadApp().PRODUCTS;
  const porId = new Map(seedProducts().map((p) => [p.id, p]));

  for (const f of front) {
    const s = porId.get(f.id);
    if (!s) continue;   // lo reporta la prueba anterior, con mejor mensaje
    for (const c of CAMPOS) {
      assert.equal(s[c], f[c], `prenda ${f.id} (${f.name}): ${c} difiere entre data.js y la semilla`);
    }
  }
});

test("las fotos coinciden, incluidas las secundarias", () => {
  // `imgs` es una lista de verdad en la base desde el paso a Postgres, así que
  // la comparación es array contra array. Con SQLite iba serializado y había
  // que comparar contra el JSON.
  const front = loadApp().PRODUCTS;
  const porId = new Map(seedProducts().map((p) => [p.id, p]));

  for (const f of front) {
    const s = porId.get(f.id);
    if (!s) continue;
    // Los dos arrays vienen de contextos `vm` distintos (la semilla y la app),
    // con el prototipo de SU realm: deepEqual es estricto con los prototipos y
    // los rechazaría aunque el contenido coincida. Copiarlos los hace comparables.
    assert.deepEqual([...s.imgs], [...f.imgs],
      `prenda ${f.id} (${f.name}): las fotos difieren entre data.js y la semilla`);
  }
});

test("ninguna prenda del catálogo depende de un `disponibles` que la semilla no siembra", () => {
  // La semilla no escribe `disponibles` y confía en el @default(1) del esquema.
  // Es correcto mientras toda prenda sea única; el día que una tenga 2 unidades,
  // la base la serviría con 1 y el stock del front sería otro.
  for (const p of loadApp().PRODUCTS) {
    assert.equal(p.disponibles, 1,
      `prenda ${p.id} (${p.name}) tiene disponibles=${p.disponibles}: la semilla ` +
      "debe escribir el campo en vez de apoyarse en el valor por defecto");
  }
});
