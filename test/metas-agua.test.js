/**
 * Metas de ahorro de agua: cuándo cuentan los litros de un pedido y cómo se
 * anuncian en su tarjeta del perfil.
 *
 * La regla que sostiene todo: un pedido solo aporta litros cuando el alquiler
 * ya es firme (entregado y fuera de la ventana de anulación), el mismo umbral
 * que rige los puntos. Ver countsForRewards() en state.js.
 */
const test = require("node:test");
const assert = require("node:assert");
const { loadDom } = require("./helpers/load-dom");

/** Monta la app con un pedido cuyo inicio fija si el alquiler ya es firme. */
function conPedido(env, { start, end, pointsCredited = false }) {
  const { app } = env;
  const p = app.products[0];
  app.orders = [{
    id: 1, date: app.isoOffset(-5), items: [p.id],
    start, end,
    delivery: "pickup", ret: "store", pay: "cash",
    status: "settled", points: 40, pointsCredited, total: 20,
  }];
  return p;
}

test("los litros solo cuentan con el alquiler cumplido", async (t) => {
  await t.test("un pedido que todavía se puede anular no aporta litros", () => {
    const env = loadDom();
    const { app } = env;
    // Empieza hoy: entregado, pero aún anulable durante el día de inicio.
    conPedido(env, { start: app.isoOffset(0), end: app.isoOffset(3) });
    assert.equal(app.countsForRewards(app.orders[0]), false);
    assert.equal(app.totalWaterSaved(), 0);
  });

  await t.test("un pedido futuro tampoco: la prenda ni siquiera salió", () => {
    const env = loadDom();
    const { app } = env;
    conPedido(env, { start: app.isoOffset(2), end: app.isoOffset(5) });
    assert.equal(app.totalWaterSaved(), 0);
  });

  await t.test("con el alquiler ya firme sí aportan", () => {
    const env = loadDom();
    const { app } = env;
    const p = conPedido(env, { start: app.isoOffset(-3), end: app.isoOffset(2) });
    assert.equal(app.countsForRewards(app.orders[0]), true);
    assert.equal(app.totalWaterSaved(), app.waterSavedForItems([p.id]));
  });

  await t.test("un pedido anulado nunca aporta, aunque sus fechas ya pasaran", () => {
    const env = loadDom();
    const { app } = env;
    conPedido(env, { start: app.isoOffset(-5), end: app.isoOffset(-1) });
    app.orders[0].status = "cancelled";
    assert.equal(app.totalWaterSaved(), 0);
  });

  await t.test("las metas se derivan de esos litros, así que tampoco se cobran antes", () => {
    const env = loadDom();
    const { app } = env;
    // Carrito entero en un pedido aún anulable: ni con todas las prendas se
    // cruza una meta mientras el alquiler pueda deshacerse.
    app.profile = { ...app.profile, points: 0, waterGoals: [] };
    app.orders = [{
      id: 1, date: app.isoOffset(0), items: app.products.map(p => p.id),
      start: app.isoOffset(0), end: app.isoOffset(3),
      delivery: "pickup", ret: "store", pay: "cash",
      status: "settled", points: 0, pointsCredited: false, total: 100,
    }];
    assert.deepEqual(app.creditWaterGoals(), []);
    assert.equal(app.profile.points, 0, "ninguna meta debió pagar sus puntos");
  });
});

test("la tarjeta del pedido informa los litros que aporta", async (t) => {
  await t.test("pendiente: los anuncia en futuro y los liga a las metas", () => {
    const env = loadDom();
    const { app, document } = env;
    const p = conPedido(env, { start: app.isoOffset(1), end: app.isoOffset(4) });
    app.view = "profile";
    app.renderSheet();
    const html = document.getElementById("sheetBody").innerHTML;
    assert.match(html, /Ahorrarás/);
    assert.match(html, new RegExp(`${app.fmtLiters(app.waterSavedForItems([p.id]))} L`));
    assert.match(html, /sumarán a tus metas/,
      "hay que decir para qué sirven esos litros, no solo cuántos son");
  });

  await t.test("ya acreditado: los da por hechos", () => {
    const env = loadDom();
    const { app, document } = env;
    conPedido(env, { start: app.isoOffset(-3), end: app.isoOffset(2), pointsCredited: true });
    app.view = "profile";
    app.renderSheet();
    const html = document.getElementById("sheetBody").innerHTML;
    assert.match(html, /Ahorraste/);
    assert.ok(!html.includes("Ahorrarás"));
  });

  await t.test("los litros del pedido acompañan a los puntos pendientes", () => {
    const env = loadDom();
    const { app, document } = env;
    conPedido(env, { start: app.isoOffset(1), end: app.isoOffset(4) });
    app.view = "profile";
    app.renderSheet();
    const html = document.getElementById("sheetBody").innerHTML;
    assert.match(html, /Ganarás 40 pts/);
    assert.ok(html.indexOf("points-pending") < html.indexOf("water-pending"),
      "los litros van debajo de los puntos, como una sola ficha");
  });
});
