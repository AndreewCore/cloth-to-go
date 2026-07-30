/**
 * La prenda alquilada se QUEDA en el catálogo, apagada y al final.
 *
 * Antes desaparecía del grid: se perdía el escaparate (nadie podía verla ni
 * volver a por ella) y el catálogo parecía más pequeño de lo que es. El cambio
 * es de presentación — sigue sin poder alquilarse—, y eso es justo lo que estas
 * pruebas vigilan: que "se ve" no se convierta en "se puede".
 *
 * El caso del carrito va aparte porque es el que se rompe solo al tocar esto:
 * una prenda en tu carrito también da `unitsAvailable === 0`, pero no está
 * alquilada por nadie y no debe pintarse apagada.
 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadDom } = require("./helpers/load-dom.js");

let win, doc, app;

beforeEach(() => {
  const env = loadDom();
  win = env.window;
  doc = env.document;
  app = env.app;
});

// Deja la prenda `id` alquilada en un pedido vigente, sin pasar por el checkout.
function alquilar(id) {
  app.orders = [{
    id: 1, date: app.isoOffset(), items: [id],
    start: app.isoOffset(), end: app.isoOffset(3),
    delivery: "pickup", ret: "local", retAddr: "",
    pay: "cash", status: "pending", total: 20,
  }];
}

const cardDe = nombre => [...doc.querySelectorAll("#grid .card")]
  .find(c => c.textContent.includes(nombre));

test("la prenda alquilada sigue visible, apagada y sin poder alquilarse", () => {
  const p = app.products[0];
  alquilar(p.id);
  win.renderGrid();

  const card = cardDe(p.name);
  assert.ok(card, "debe seguir en la grilla");
  assert.ok(card.classList.contains("card-off"));
  assert.match(card.querySelector(".off-tag").textContent, /No disponible/);
  assert.ok(card.querySelector(".add-btn").disabled);
});

test("va al final, detrás de todas las disponibles", () => {
  const p = app.products[0];        // la primera del catálogo
  alquilar(p.id);

  const ids = win.filteredProducts().map(x => x.id);
  assert.equal(ids[ids.length - 1], p.id);
});

test("varias alquiladas van al final y conservan su orden entre ellas", () => {
  const [a, b] = app.products;
  app.orders = [{
    id: 1, date: app.isoOffset(), items: [a.id, b.id],
    start: app.isoOffset(), end: app.isoOffset(3),
    delivery: "pickup", ret: "local", retAddr: "",
    pay: "cash", status: "pending", total: 40,
  }];

  // Array.from: el array viene del realm del vm y deepEqual compara prototipos.
  const ids = Array.from(win.filteredProducts(), x => x.id);
  assert.deepEqual(ids.slice(-2), [a.id, b.id]);
});

test("los filtros la siguen escondiendo cuando no le tocan", () => {
  // Verse no es colarse: si el filtro la excluye, no aparece por estar alquilada.
  const p = app.products[0];
  alquilar(p.id);

  const otraCat = app.products.find(x => x.cat !== p.cat).cat;
  app.setFilters({ activeCat: otraCat });

  assert.ok(!win.filteredProducts().some(x => x.id === p.id));
});

test("la búsqueda también la alcanza (sigue siendo escaparate)", () => {
  const p = app.products[0];
  alquilar(p.id);
  app.setFilters({ searchQuery: p.name });

  assert.ok(win.filteredProducts().some(x => x.id === p.id));
});

test("la prenda EN TU CARRITO no se pinta apagada", () => {
  // Da unitsAvailable === 0 igual que una alquilada, pero no lo está: pintarla
  // en gris diría que la perdiste justo después de elegirla.
  const p = app.products[0];
  app.cart = [{ id: p.id }];
  win.renderGrid();

  const card = cardDe(p.name);
  assert.ok(!card.classList.contains("card-off"));
  assert.equal(card.querySelector(".off-tag"), null);
  assert.match(card.querySelector(".add-btn").textContent, /En carrito/);
});

test("el detalle lo dice sin dar más explicaciones", () => {
  const p = app.products[0];
  alquilar(p.id);
  win.openDetail(p.id);

  const avail = doc.querySelector(".detail-avail").textContent;
  assert.match(avail, /No disponible por el momento/);
  // Ni logística ni fechas: el cliente no necesita saber por qué.
  assert.doesNotMatch(avail, /lavado|desinfec|vuelve|termine/i);
});

test("addToCart la sigue rechazando aunque ahora se vea", () => {
  const p = app.products[0];
  alquilar(p.id);

  win.addToCart(p.id);
  assert.equal(app.cart.length, 0);
});

test("al archivarse el pedido vuelve al frente, sin apagar", () => {
  const p = app.products[0];
  alquilar(p.id);
  app.orders[0].status = "settled";
  app.orders[0].end = app.isoOffset(-1);   // período terminado → archivado
  win.renderGrid();

  assert.ok(!win.isRented(p.id));
  assert.equal(win.filteredProducts()[0].id, p.id, "vuelve a su sitio");
  assert.ok(!cardDe(p.name).classList.contains("card-off"));
});
