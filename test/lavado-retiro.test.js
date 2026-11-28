/**
 * Una prenda que vuelve del lavado se puede reservar, pero solo para retirar
 * desde el día que dice el servidor (`availableFrom`): el calendario y las
 * fechas del carrito no bajan de ahí, y la ficha lo dice.
 *
 * El día lo calcula el servidor (`rentableFrom()` en server/src/catalog.js);
 * aquí solo se vigila que la app lo respete y no lo recalcule.
 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadDom } = require("./helpers/load-dom.js");

let doc, app;

beforeEach(() => {
  const env = loadDom();
  doc = env.document;
  app = env.app;
});

/** Primer día hábil a `n` o más días de hoy. */
function habilDesde(n) {
  let d = app.isoOffset(n);
  while (!app.isBusinessDayISO(d)) d = app.addDaysISO(d, 1);
  return d;
}

test("el carrito con una prenda que vuelve del lavado no se retira antes de ese día", () => {
  const p = app.products[0];
  const desde = habilDesde(10);
  p.items = [{ id: 9001, available: true, availableFrom: desde }];
  app.setCheckout({ rentalStart: app.isoOffset(0), rentalEnd: app.isoOffset(1) });

  app.addToCart(p.id);
  assert.equal(app.earliestStartISO(), desde);
  assert.ok(app.rentalStart >= desde, `el retiro (${app.rentalStart}) no puede ser antes de ${desde}`);
  assert.deepEqual([...app.cartItemIds()], [9001]);
});

test("entre un ejemplar libre ya y uno que vuelve del lavado, se reserva el libre", () => {
  const p = app.products[0];
  p.items = [{ id: 9001, available: true, availableFrom: habilDesde(10) }, { id: 9002, available: true, availableFrom: null }];
  app.addToCart(p.id);
  assert.equal(app.pickItem(p).id, 9002);
  assert.equal(app.earliestStartISO(), app.isoOffset(0), "nada retrasa el retiro");
});

test("la ficha dice desde cuándo se retira la prenda que está en lavado", () => {
  const p = app.products[0];
  const desde = habilDesde(10);
  p.items = [{ id: 9001, available: true, availableFrom: desde }];
  app.openDetail(p.id);
  const aviso = doc.querySelector("#sheet .detail-avail").textContent;
  assert.match(aviso, /Vuelve del lavado/);
  assert.match(aviso, new RegExp(app.fmtDate(desde)));
});
