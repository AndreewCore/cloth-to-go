/**
 * Pruebas de la MIGRACIÓN de loadState (state.js): al cargar datos guardados de
 * antes de "puntos al pagar", los pedidos deben quedar marcados como acreditados
 * para no volver a sumar puntos (los recibieron con la lógica anterior), sin
 * tocar los pedidos del esquema nuevo. Corre sobre jsdom con localStorage real.
 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadDom } = require("./helpers/load-dom.js");

let win, app;

beforeEach(() => {
  const env = loadDom();
  win = env.window;
  app = env.app;
});

// Siembra localStorage bajo la clave de un usuario y la carga con la migración.
function seedAndLoad(saved) {
  const key = app.STORAGE_PREFIX + "u-test";
  win.localStorage.setItem(key, JSON.stringify(saved));
  app.loadFromKey(key);
  return key;
}

test("migración: un pedido histórico (sin los campos nuevos) queda acreditado", () => {
  // Esquema viejo: el pedido NO trae points/pointsCredited. Bajo la lógica
  // anterior ya sumó sus puntos, y esos puntos ya están en profile.points (50).
  seedAndLoad({
    cart: [],
    profile: { name: "Ana", email: "", phone: "", points: 50, redeemed: [], donations: [] },
    orders: [{ id: 1000, items: [7], start: "2026-01-01", end: "2026-01-04",
               delivery: "pickup", ret: "store", pay: "cash", status: "pending", total: 55 }]
  });

  const o = app.orders[0];
  assert.equal(o.pointsCredited, true); // marcado como ya acreditado
  assert.equal(o.points, 0);            // placeholder: no se recalcula el histórico
  assert.equal(app.profile.points, 50); // la migración NO toca el saldo
});

test("migración: confirmar el pago de un pedido histórico NO vuelve a sumar puntos", () => {
  seedAndLoad({
    cart: [],
    profile: { name: "Ana", email: "", phone: "", points: 50, redeemed: [], donations: [] },
    orders: [{ id: 1000, items: [7], start: "2026-01-01", end: "2026-01-04",
               delivery: "pickup", ret: "store", pay: "cash", status: "pending", total: 55 }]
  });

  win.confirmPayment(0);
  app.confirmModal();

  assert.equal(app.orders[0].status, "settled");
  assert.equal(app.profile.points, 50); // sigue en 50: no hubo doble conteo
});

test("migración: un pending del esquema NUEVO no se altera y sí acredita al pagar", () => {
  // Pedido nuevo persistido: trae los campos → la migración NO debe tocarlo.
  seedAndLoad({
    cart: [],
    profile: { name: "Ana", email: "", phone: "", points: 0, redeemed: [], donations: [] },
    orders: [{ id: 1000, items: [7], start: "2026-01-01", end: "2026-01-04",
               delivery: "pickup", ret: "store", pay: "cash", status: "pending", total: 55,
               points: 120, pointsCredited: false }]
  });

  assert.equal(app.orders[0].pointsCredited, false); // intacto (no lo "migró")
  assert.equal(app.orders[0].points, 120);

  win.confirmPayment(0);
  app.confirmModal();
  assert.equal(app.profile.points, 120); // acredita una vez

  // Confirmar de nuevo no duplica (ya está settled).
  win.confirmPayment(0);
  assert.ok(!app.isModalOpen());
  assert.equal(app.profile.points, 120);
});

test("migración: el centinela es 'undefined', no el valor (false no se pisa a true)", () => {
  // Blindaje explícito: un pending nuevo con pointsCredited:false NO debe volverse
  // true por la migración. Si el chequeo fuese por falsy en vez de undefined, este
  // pedido se marcaría acreditado y perdería sus puntos.
  seedAndLoad({
    cart: [],
    profile: { name: "", email: "", phone: "", points: 0, redeemed: [], donations: [] },
    orders: [{ id: 1000, items: [6], start: "2026-01-01", end: "2026-01-02",
               pay: "cash", status: "pending", total: 8, points: 30, pointsCredited: false }]
  });
  assert.equal(app.orders[0].pointsCredited, false);
});
