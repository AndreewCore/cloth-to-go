/**
 * Simbología de CALIDAD: medidor de pastillas en lugar de estrellas.
 *
 * La calidad la fija el negocio al catalogar la prenda —y de ella depende la
 * tarifa del primer día—, mientras que una estrella significa "valoración de
 * usuarios" para cualquiera. Con las reseñas en camino, dibujar ambas cosas
 * igual pasaba de confuso a incorrecto.
 *
 * Estas pruebas cubren el medidor y, sobre todo, que **las ★ no vuelvan a
 * aparecer en un contexto de calidad**: es la clase de detalle que se cuela
 * sola en la siguiente vista que alguien escriba.
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

/* ---- El medidor ---- */
test("qualityMeter: cinco pastillas, llenas hasta el nivel", () => {
  const A = loadApp();
  for (let n = 1; n <= 5; n++) {
    const html = A.qualityMeter(n);
    const total = (html.match(/qm-seg/g) || []).length;
    const llenas = (html.match(/qm-seg on/g) || []).length;
    assert.equal(total, 5, `${n}: siempre cinco pastillas`);
    assert.equal(llenas, n, `${n}: ${n} llenas`);
  }
});

test("qualityMeter: lleva etiqueta accesible (no es solo decoración)", () => {
  const A = loadApp();
  // Sin esto, un lector de pantalla anuncia la ficha sin la calidad: los
  // <i> vacíos no dicen nada por sí mismos.
  assert.match(A.qualityMeter(4), /role="img"/);
  assert.match(A.qualityMeter(4), /aria-label="Calidad 4 de 5"/);
});

test("qualityMeter: un valor fuera de rango no rompe el medidor", () => {
  const A = loadApp();
  for (const raro of [0, -3, 9, null, undefined, "cuatro"]) {
    const html = A.qualityMeter(raro);
    assert.equal((html.match(/qm-seg/g) || []).length, 5, `${raro}: cinco pastillas`);
    const llenas = (html.match(/qm-seg on/g) || []).length;
    assert.ok(llenas >= 0 && llenas <= 5, `${raro}: entre 0 y 5 llenas`);
  }
});

test("qualityMeterText: cinco caracteres, para donde no cabe HTML", () => {
  const A = loadApp();
  assert.equal(A.qualityMeterText(5), "▰▰▰▰▰");
  assert.equal(A.qualityMeterText(2), "▰▰▱▱▱");
  assert.equal(A.qualityMeterText(0), "▱▱▱▱▱");
  assert.equal([...A.qualityMeterText(3)].length, 5);
});

/* ---- Las estrellas no vuelven ---- */
const sinEstrellas = (el, donde) => {
  assert.ok(el, `no se encontró ${donde}`);
  assert.doesNotMatch(el.textContent || "", /[★☆]/, `${donde} no debe usar estrellas`);
};

test("la tarjeta del catálogo muestra calidad sin estrellas", () => {
  win.renderGrid();
  const card = doc.querySelector("#grid .card .quality");
  sinEstrellas(card, "la tarjeta");
  assert.ok(card.querySelector(".qmeter"), "debe llevar el medidor");
  // La etiqueta en palabras gana peso al perder las estrellas.
  assert.match(card.textContent, /nuevo|Excelente|Buen estado|carácter|vivida/);
});

test("el detalle muestra calidad sin estrellas, medidor y chip", () => {
  const p = app.products[0];
  app.openDetail(p.id);

  sinEstrellas(doc.querySelector(".detail-quality"), "el detalle");
  sinEstrellas(doc.querySelector(".qm-fact"), "el chip de Calidad");
  assert.match(doc.querySelector(".qm-fact").textContent, new RegExp(`${p.stars}/5`));
});

test("el carrito muestra calidad sin estrellas", () => {
  app.cart = app.products.slice(0, 2).map(p => ({ id: p.id }));
  app.view = "cart";
  app.renderSheet();

  const fila = doc.querySelector("#sheet .ci-quality");
  sinEstrellas(fila, "la fila del carrito");
  assert.ok(fila.querySelector(".qmeter"));
});

test("el filtro de calidad usa el medidor en texto, no estrellas", () => {
  app.view = "filters";
  app.renderSheet();
  const select = doc.getElementById("fQuality");

  sinEstrellas(select, "el filtro de calidad");
  const opciones = [...select.options].map(o => o.textContent);
  assert.equal(opciones[0], "Todas");
  // Pastillas y palabras juntas: si la fuente no trae los glifos, el texto
  // sigue explicando la opción.
  assert.match(opciones[1], /▰{5}\s+Como nuevo/);
  assert.match(opciones[2], /▰{4}▱\s+Excelente o más/);
});

test("el filtro sigue filtrando por calidad después del cambio", () => {
  // El cambio es de presentación: el valor de la opción manda, y `stars` sigue
  // siendo el campo del que depende la tarifa.
  app.setFilters({ qualityFilter: 5 });
  const soloTop = win.filteredProducts();
  assert.ok(soloTop.length > 0);
  assert.ok(soloTop.every(p => p.stars >= 5));

  app.setFilters({ qualityFilter: 0 });
  assert.equal(win.filteredProducts().length, app.productCount);
});

/* ---- Las ★ quedan libres para las reseñas ---- */
test("starStr sigue existiendo, reservado para las reseñas", () => {
  const A = loadApp();
  assert.equal(A.starStr(3), "★★★☆☆");
});

test("el aviso de premio explica la calidad en palabras, no con ★", () => {
  const A = loadApp();
  const premium = A.REWARDS.find(r => r.type === "premiumDays");
  if (!premium) return;   // el catálogo de premios puede cambiar
  const msg = A.rewardIssue(premium.id, { items: [], days: 1, delivery: "pickup", ret: "local" });
  if (msg) assert.doesNotMatch(msg, /[★☆]/);
});
