/**
 * RESEÑAS de clientes: bloque en el detalle y alta desde el historial.
 *
 * Dos cosas se vigilan por encima del resto:
 *
 * 1. **Solo se reseña lo ya cumplido.** Es el mismo umbral que los puntos y las
 *    metas de agua (`countsForRewards`). Reseñar algo que aún no se recibió es
 *    el agujero que se cerró en las metas, y aquí sería peor: queda publicado.
 * 2. **La media se deriva, nunca se almacena.** Igual que el precio y el
 *    descuento, para que editar o borrar una reseña no deje un promedio
 *    mintiendo.
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
  // Sesión real y no `currentUser` a mano: es activateUserSession quien fija la
  // clave de almacenamiento, y sin ella no hay nada que comprobar en disco.
  win.activateUserSession({ sub: "u1", name: "Ana" });
});

/**
 * Deja un pedido en el estado pedido.
 * @param {object} opts `cumplido` (entregado y ya no anulable) o pendiente.
 */
function pedido({ cumplido = true, items = [3], id = 1 } = {}) {
  const start = cumplido ? app.isoOffset(-2) : app.isoOffset(1);
  app.orders = [{
    id, date: app.isoOffset(-3), items,
    start, end: app.isoOffset(5),
    delivery: "pickup", ret: "local", retAddr: "",
    pay: "cash", status: "pending", total: 20, pointsCredited: true,
  }];
  return app.orders[0];
}

/* ---- El umbral: solo lo cumplido ---- */
test("un pedido aún no entregado no se puede reseñar", () => {
  const o = pedido({ cumplido: false });
  assert.deepEqual(Array.from(app.reviewableItems(o)), []);
  assert.equal(app.hasPendingReview(o), false);
});

test("un pedido cumplido sí ofrece reseñar sus prendas", () => {
  const o = pedido({ items: [3, 5] });
  assert.deepEqual(Array.from(app.reviewableItems(o)), [3, 5]);
  assert.equal(app.hasPendingReview(o), true);
});

test("un pedido anulado no se puede reseñar", () => {
  const o = pedido();
  o.status = "cancelled";
  assert.deepEqual(Array.from(app.reviewableItems(o)), []);
});

test("el botón solo aparece cuando hay algo que reseñar", () => {
  pedido({ cumplido: false });
  win.renderProfile();
  assert.equal(doc.querySelectorAll('[data-action="openReview"]').length, 0);

  pedido();
  win.renderProfile();
  assert.equal(doc.querySelectorAll('[data-action="openReview"]').length, 1);
});

/* ---- Alta ---- */
test("con una sola prenda pendiente, se preselecciona", () => {
  pedido({ items: [3] });
  app.openReview(1);
  assert.equal(app.reviewProductId, 3);
});

test("con varias prendas hay que elegir una", () => {
  pedido({ items: [3, 5] });
  app.openReview(1);

  assert.equal(app.reviewProductId, null, "ninguna preseleccionada");
  assert.equal(app.reviewValid(), false, "sin prenda no se puede publicar");
  assert.equal(doc.querySelectorAll('[data-action="pickReviewItem"]').length, 2);
});

test("no se publica sin estrellas", () => {
  pedido();
  app.openReview(1);
  assert.equal(app.reviewValid(), false);

  app.reviewRating = 4;
  assert.equal(app.reviewValid(), true);
});

test("publicar guarda la reseña y vuelve al perfil", () => {
  pedido({ items: [3] });
  app.openReview(1);
  app.reviewRating = 5;
  app.reviewText = "Quedó perfecta.";
  app.submitReview();

  assert.equal(app.reviews.length, 1);
  const r = app.reviews[0];
  assert.equal(r.productId, 3);
  assert.equal(r.orderId, 1);
  assert.equal(r.rating, 5);
  assert.equal(r.text, "Quedó perfecta.");
  assert.equal(app.view, "profile");
});

test("una prenda ya reseñada deja de ofrecerse en ese pedido", () => {
  const o = pedido({ items: [3, 5] });
  app.openReview(1);
  app.reviewProductId = 3;
  app.reviewRating = 4;
  app.submitReview();

  assert.deepEqual(Array.from(app.reviewableItems(o)), [3, 5], "el pedido no cambia");
  assert.ok(app.reviewFor(1, 3), "pero esa ya tiene reseña");
  assert.equal(app.hasPendingReview(o), true, "queda la otra");

  app.openReview(1);
  assert.equal(app.reviewProductId, 5, "se preselecciona la que falta");
});

test("reseñar la última prenda retira el botón del pedido", () => {
  pedido({ items: [3] });
  app.openReview(1);
  app.reviewRating = 4;
  app.submitReview();

  win.renderProfile();
  assert.equal(doc.querySelectorAll('[data-action="openReview"]').length, 0);
});

/* ---- El detalle ---- */
test("el detalle muestra las reseñas y su media derivada", () => {
  app.reviews = [
    { id: "a", productId: 3, orderId: 1, rating: 5, text: "Genial", date: "2026-07-01" },
    { id: "b", productId: 3, orderId: 2, rating: 3, text: "Correcta", date: "2026-07-02" },
  ];
  app.openDetail(3);

  assert.equal(app.productRating(3), 4);
  const bloque = doc.querySelector(".reviews");
  assert.match(bloque.textContent, /Genial/);
  assert.match(bloque.textContent, /Correcta/);
  assert.match(doc.querySelector(".rev-avg").textContent, /4\.0/);
});

test("la media se recalcula al borrar una reseña (no se almacena)", () => {
  app.reviews = [
    { id: "a", productId: 3, orderId: 1, rating: 5, date: "2026-07-01" },
    { id: "b", productId: 3, orderId: 2, rating: 1, date: "2026-07-02" },
  ];
  assert.equal(app.productRating(3), 3);

  app.deleteReview("b");
  assert.equal(app.productRating(3), 5);
});

test("una prenda sin reseñas lo dice, no muestra un bloque vacío", () => {
  const sinResenas = app.products.find(p => app.productReviews(p.id).length === 0);
  app.openDetail(sinResenas.id);

  assert.ok(doc.querySelector(".rev-empty"));
  assert.equal(doc.querySelector(".rev-avg"), null);
});

test("la reseña publicada se fecha hoy, y esa fecha se pinta legible", () => {
  // Se guardaba con `isoOffset()` sin argumento, o sea "NaN-NaN-NaN": el detalle
  // mostraba "NaN undefined" y el orden por fecha ponía siempre las del usuario
  // delante, porque "N" gana a "2" al comparar cadenas.
  pedido({ items: [1] });          // la 1 ya tiene una reseña de muestra
  app.openReview(1);
  app.reviewRating = 5;
  app.reviewText = "Recién publicada.";
  app.submitReview();

  assert.equal(app.reviews[0].date, app.isoOffset(0));

  // Lo persistido importa más que lo que hay en memoria: una fecha inválida en
  // localStorage sobrevive al arreglo y sigue mintiendo en cada recarga.
  const guardado = JSON.parse(win.localStorage.getItem(app.activeStorageKey));
  assert.equal(guardado.reviews[0].date, app.isoOffset(0));

  app.openDetail(1);
  const fechas = Array.from(doc.querySelectorAll(".rev-date"), e => e.textContent);
  assert.ok(fechas.length, "el detalle debe pintar las fechas");
  for (const f of fechas) assert.doesNotMatch(f, /NaN|undefined/);
});

test("las reseñas se ordenan de la más reciente a la más antigua", () => {
  app.reviews = [
    { id: "a", productId: 3, orderId: 1, rating: 5, text: "vieja", date: "2026-01-01" },
    { id: "b", productId: 3, orderId: 2, rating: 4, text: "nueva", date: "2026-07-01" },
  ];
  const textos = Array.from(app.productReviews(3), r => r.text);
  assert.deepEqual(textos, ["nueva", "vieja"]);
});

/* ---- Contenido de usuario ---- */
test("el texto de la reseña se escapa antes de pintarse", () => {
  // Es la superficie de XSS más grande de la app: texto de terceros en innerHTML.
  app.reviews = [{
    id: "x", productId: 3, orderId: 1, rating: 5,
    text: '<img src=x onerror="window.__hack=1">', date: "2026-07-01",
  }];
  app.openDetail(3);

  assert.equal(win.__hack, undefined, "no debe ejecutarse nada");
  assert.equal(doc.querySelector(".rev-text img"), null, "ni inyectar marcado");
  assert.match(doc.querySelector(".rev-text").textContent, /onerror/);
});

/* ---- Reseñas de muestra ---- */
test("las de muestra se ven sin haber alquilado nada", () => {
  // Un catálogo con el bloque de reseñas vacío en todas las prendas no deja
  // demostrar la feature.
  assert.ok(app.DEMO_REVIEWS.length > 0);
  const demo = app.DEMO_REVIEWS[0];
  assert.ok(app.productReviews(demo.productId).some(r => r.id === demo.id));
});

test("las de muestra NO se guardan en el almacenamiento del usuario", () => {
  // Viven en una constante y se mezclan al leer: el día del backend se retiran
  // vaciándola, sin tocar los datos de nadie.
  pedido({ items: [3] });
  app.openReview(1);
  app.reviewRating = 4;
  app.submitReview();

  const guardado = JSON.parse(win.localStorage.getItem(app.activeStorageKey));
  assert.equal(guardado.reviews.length, 1, "solo la del usuario");
  assert.ok(!guardado.reviews.some(r => r.demo));
});

test("las de muestra van marcadas para poder distinguirlas al migrar", () => {
  for (const r of app.DEMO_REVIEWS) {
    assert.equal(r.demo, true, `la reseña ${r.id} debe llevar demo:true`);
  }
});

test("borrar una de muestra no hace nada (no son de nadie)", () => {
  const demo = app.DEMO_REVIEWS[0];
  assert.equal(app.deleteReview(demo.id), false);
  assert.ok(app.productReviews(demo.productId).some(r => r.id === demo.id));
});

/* ---- Aislamiento entre cuentas ---- */
test("las reseñas de una cuenta no asoman en la sesión de otra", () => {
  pedido({ items: [3] });
  app.openReview(1);
  app.reviewRating = 5;
  app.submitReview();
  assert.equal(app.reviews.length, 1);

  win.activateUserSession({ sub: "otro", name: "Luis" });
  assert.equal(app.reviews.length, 0);
});
