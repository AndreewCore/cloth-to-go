/**
 * Guardarraíl del modelo de precios duplicado.
 *
 * El precio vive DOS veces: `js/data.js` (lo que ve el cliente, classic script)
 * y `server/src/pricing.js` (lo que se COBRA, ESM). La copia es deliberada —el
 * front no puede usar `import` sin perder el arranque por `file://`—, pero un
 * precio mostrado y un precio cobrado que difieren es la peor clase de bug de
 * dinero: silencioso, de un centavo, y descubierto por el cliente.
 *
 * Esta prueba no opina sobre cuál manda. Exige que digan lo mismo mientras haya
 * dos, igual que `test/catalogo-backend.test.js` hace con el catálogo.
 *
 * Vive en la suite del FRONTEND aunque la mitad de lo que compara sea del
 * servidor: quien toca una tarifa la toca en `js/data.js` y corre `pnpm test`.
 * Aquí el fallo le llega cuando todavía puede arreglarlo. `pricing.js` es puro
 * (sin Prisma, sin red), así que importarlo no levanta nada.
 */
const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { loadApp } = require("./helpers/load-app.js");

const front = loadApp();
let server;

before(async () => {
  const ruta = path.join(__dirname, "..", "server", "src", "pricing.js");
  server = await import(pathToFileURL(ruta).href);
});

// Duraciones a barrer. Cubren los tres tramos (día 1, días 2–3, 4–7, 8+) y se
// pasan de largo hasta 30 para que un tramo nuevo mal cerrado no pase de puntillas.
const DIAS = Array.from({ length: 30 }, (_, i) => i + 1);

// Cantidades: 1 sin descuento, 5 en el tope de volumen (20%) y 9 pasado el tope.
const CANTIDADES = [1, 2, 3, 4, 5, 6, 9];

test("las constantes de tarifa son las mismas en ambos lados", () => {
  assert.equal(server.SHIPPING_FEE, front.SHIPPING_FEE);
  assert.equal(server.DEPOSIT_MAX, front.DEPOSIT_MAX);
  assert.equal(server.DEPOSIT_ORDER_MAX, front.DEPOSIT_ORDER_MAX);
  assert.equal(server.MIN_MARGIN, front.MIN_MARGIN);
});

test("mismo coste de ciclo y mismo piso para cada prenda del catálogo", () => {
  for (const p of front.PRODUCTS) {
    assert.equal(server.garmentCycles(p), front.garmentCycles(p), `ciclos · prenda ${p.id}`);
    assert.equal(server.cycleCost(p), front.cycleCost(p), `cycleCost · prenda ${p.id}`);
    assert.equal(server.rentalFloor(p), front.rentalFloor(p), `piso · prenda ${p.id}`);
  }
});

test("mismo descuento por volumen en cada cantidad", () => {
  for (const n of [0, ...CANTIDADES, 40]) {
    assert.equal(server.volumeDiscountRate(n), front.volumeDiscountRate(n), `volumen · ${n} prendas`);
  }
});

test("mismo precio de alquiler en todo el catálogo × duración × cantidad", () => {
  for (const p of front.PRODUCTS) {
    for (const dias of DIAS) {
      for (const n of CANTIDADES) {
        assert.equal(
          server.rentalPrice(p, dias, n),
          front.rentalPrice(p, dias, n),
          `prenda ${p.id} · ${dias} día(s) · ${n} prenda(s) en el pedido`
        );
      }
    }
  }
});

test("mismo depósito por prenda y mismo tope por pedido", () => {
  for (const p of front.PRODUCTS) {
    assert.equal(server.depositFor(p), front.depositFor(p), `depósito · prenda ${p.id}`);
  }
  // Pedidos crecientes: el tope de pedido tiene que morder en el mismo punto.
  for (let n = 1; n <= front.PRODUCTS.length; n++) {
    const items = front.PRODUCTS.slice(0, n);
    assert.equal(server.depositForItems(items), front.depositForItems(items), `depósito de ${n} prenda(s)`);
  }
});

test("los cargos logísticos coinciden, incluido el modo desconocido", () => {
  // El valor basura importa: si un lado cobrara envío por defecto y el otro no,
  // un `delivery` corrupto en la base cobraría de más solo en producción.
  for (const modo of ["ship", "pickup", "", null, "SHIP"]) {
    assert.equal(server.deliveryFeeFor(modo), front.SHIPPING_FEE * (modo === "ship" ? 1 : 0), `entrega · ${modo}`);
  }
  for (const modo of ["home", "store", "", null, "HOME"]) {
    assert.equal(server.returnFeeFor(modo), front.SHIPPING_FEE * (modo === "home" ? 1 : 0), `devolución · ${modo}`);
  }
});

test("una prenda con `stars` fuera de escala se tarifa igual en ambos lados", () => {
  // `stars` llega de la base, y la base no es infalible. Ambos deben caer en la
  // tarifa de la prenda más gastada, que es el lado seguro.
  const raros = [
    { value: 40, stars: 0, material: "algodon" },
    { value: 40, stars: 9, material: "algodon" },
    { value: 40, stars: undefined, material: "algodon" },
    { value: 40, stars: 3, material: "material-que-no-existe" },
  ];
  for (const p of raros) {
    for (const dias of [1, 5, 12]) {
      assert.equal(
        server.rentalPrice(p, dias, 1),
        front.rentalPrice(p, dias, 1),
        `prenda rara (stars=${p.stars}, material=${p.material}) · ${dias} día(s)`
      );
    }
  }
});

test("`rentalDays` cuenta los mismos días que `daysBetween` del front", () => {
  const casos = [
    ["2026-08-01", "2026-08-02"],
    ["2026-08-01", "2026-08-01"], // mismo día → mínimo 1
    ["2026-08-01", "2026-08-15"],
    ["2026-11-01", "2026-11-05"], // cruza el cambio de horario del hemisferio norte
    ["2026-12-28", "2027-01-04"], // cruza el año
  ];
  for (const [a, b] of casos) {
    assert.equal(server.rentalDays(a, b), front.daysBetween(a, b), `${a} → ${b}`);
  }
});

test("`cents` redondea igual que el del front", () => {
  for (const usd of [0, 0.1, 0.005, 4.5, 12.345, 99.999, 1234.56]) {
    assert.equal(server.cents(usd), front.cents(usd), `cents(${usd})`);
  }
});
