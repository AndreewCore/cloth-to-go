/**
 * GALERÍA de fotos de la prenda: varias imágenes por prenda, navegables desde
 * el detalle.
 *
 * Lo que más se vigila aquí no es el carrusel en sí, sino sus dos bordes: que
 * con UNA sola foto no aparezca ningún control (unas flechas que no llevan a
 * ninguna parte son peores que su ausencia) y que la portada siga siendo la que
 * usan tarjeta, carrito y pedidos, que es donde el cambio de modelo podía
 * colarse sin avisar.
 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadDom } = require("./helpers/load-dom.js");
const { loadApp } = require("./helpers/load-app.js");

let win, doc, app;

beforeEach(() => {
  const env = loadDom();
  win = env.window;
  doc = env.document;
  app = env.app;
});

const conVarias = () => app.products.find(p => app.productImages(p).length > 1);
const conUna    = () => app.products.find(p => app.productImages(p).length === 1);

/* ---- Normalización de las fotos ---- */
test("productImages: devuelve la lista tal cual cuando existe", () => {
  const A = loadApp();
  assert.deepEqual(
    Array.from(A.productImages({ imgs: ["a.webp", "b.webp"] })), ["a.webp", "b.webp"]);
});

test("productImages: acepta una entrada antigua con `img` suelto", () => {
  // El backend viejo o un dato a medio migrar no deben romper la vista.
  const A = loadApp();
  assert.deepEqual(Array.from(A.productImages({ img: "a.webp" })), ["a.webp"]);
});

test("productImages: sin fotos devuelve una entrada vacía, no una lista vacía", () => {
  // Así el marcado se pinta igual y queda el placeholder; una lista vacía
  // obligaría a cada vista a comprobar antes de leer [0].
  const A = loadApp();
  for (const raro of [{}, { imgs: [] }, { imgs: null }, null]) {
    assert.equal(A.productImages(raro).length, 1);
  }
});

test("coverImage: la portada es la primera de la lista", () => {
  const A = loadApp();
  assert.equal(A.coverImage({ imgs: ["portada.webp", "otra.webp"] }), "portada.webp");
});

/* ---- Una sola foto: sin controles ---- */
test("con una sola foto no se dibuja ningún control", () => {
  const p = conUna();
  assert.ok(p, "el catálogo debe tener alguna prenda de una sola foto");
  app.openDetail(p.id);

  assert.equal(doc.querySelector(".gal-nav"), null, "sin flechas");
  assert.equal(doc.querySelector(".gal-dots"), null, "sin puntos");
  assert.equal(doc.querySelector(".gal-count"), null, "sin contador");
  assert.ok(doc.querySelector(".detail-img"), "pero la foto sigue ahí");
});

/* ---- Varias fotos: carrusel ---- */
test("con varias fotos aparecen flechas, puntos y contador", () => {
  const p = conVarias();
  assert.ok(p, "alguna prenda debe traer varias fotos");
  app.openDetail(p.id);
  const total = app.productImages(p).length;

  assert.ok(doc.querySelector(".gal-prev") && doc.querySelector(".gal-next"));
  assert.equal(doc.querySelectorAll(".gal-dot").length, total);
  assert.match(doc.querySelector(".gal-count").textContent, new RegExp(`1 / ${total}`));
});

test("solo se monta la foto visible, no las demás", () => {
  // Precargar todas multiplicaría el peso de la vista por el número de fotos
  // sin que nadie las haya pedido.
  const p = conVarias();
  app.openDetail(p.id);
  assert.equal(doc.querySelectorAll(".detail-img img").length, 1);
});

test("avanzar y retroceder cambia la foto y el punto activo", () => {
  const p = conVarias();
  app.openDetail(p.id);
  const fotos = app.productImages(p);

  app.moveGallery(1);
  assert.match(doc.querySelector(".detail-img img").getAttribute("src"), new RegExp(fotos[1]));
  assert.equal(doc.querySelectorAll(".gal-dot")[1].classList.contains("on"), true);
  assert.match(doc.querySelector(".gal-count").textContent, /2 \//);

  app.moveGallery(-1);
  assert.match(doc.querySelector(".detail-img img").getAttribute("src"), new RegExp(fotos[0]));
});

test("da la vuelta en los extremos", () => {
  // En un carrusel de tres fotos, toparse con una flecha muerta se siente roto.
  const p = conVarias();
  app.openDetail(p.id);
  const total = app.productImages(p).length;

  app.moveGallery(-1);                       // desde la primera, hacia atrás
  assert.equal(app.detailImg, total - 1);
  app.moveGallery(1);                        // desde la última, hacia delante
  assert.equal(app.detailImg, 0);
});

test("los puntos saltan a una foto concreta", () => {
  const p = conVarias();
  app.openDetail(p.id);

  app.showGalleryImage(2);
  assert.equal(app.detailImg, 2);
  assert.match(doc.querySelector(".gal-count").textContent, /3 \//);
});

test("un índice fuera de rango se recorta en vez de romper la vista", () => {
  const p = conVarias();
  app.openDetail(p.id);
  const total = app.productImages(p).length;

  app.showGalleryImage(99);
  assert.equal(app.detailImg, total - 1);
  app.showGalleryImage(-5);
  assert.equal(app.detailImg, 0);
});

test("abrir otra prenda vuelve a su portada", () => {
  const p = conVarias();
  app.openDetail(p.id);
  app.moveGallery(1);
  assert.notEqual(app.detailImg, 0);

  app.openDetail(conUna().id);
  assert.equal(app.detailImg, 0, "cada prenda se abre por su portada");
});

/* ---- La portada manda fuera del detalle ---- */
test("la tarjeta del catálogo usa la portada, no la segunda foto", () => {
  const p = conVarias();
  win.renderGrid();
  const card = [...doc.querySelectorAll("#grid .card")]
    .find(c => c.textContent.includes(p.name));

  const src = card.querySelector(".thumb img").getAttribute("src");
  assert.equal(src, app.productImages(p)[0]);
});

test("el carrito también usa la portada", () => {
  const p = conVarias();
  app.cart = [{ id: p.id }];
  app.view = "cart";
  app.renderSheet();

  const src = doc.querySelector("#sheet .ci-thumb img").getAttribute("src");
  assert.equal(src, app.productImages(p)[0]);
});

/* ---- Accesibilidad ---- */
test("los controles se anuncian y el punto activo se distingue", () => {
  const p = conVarias();
  app.openDetail(p.id);

  assert.equal(doc.querySelector(".gal-prev").getAttribute("aria-label"), "Foto anterior");
  assert.equal(doc.querySelector(".gal-next").getAttribute("aria-label"), "Foto siguiente");
  const dots = doc.querySelectorAll(".gal-dot");
  assert.equal(dots[0].getAttribute("aria-current"), "true");
  assert.equal(dots[1].getAttribute("aria-current"), "false");
  assert.match(dots[1].getAttribute("aria-label"), /Foto 2 de/);
});
