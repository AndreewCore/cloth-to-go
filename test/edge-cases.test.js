/**
 * Casos LÍMITE del modelo puro (data.js + state.js), sin DOM: bordes de los
 * tramos de precio, fechas iguales/invertidas, topes con muchas prendas,
 * material/estrellas fuera de rango y la consistencia del total del pedido.
 * No cubren el flujo de UI (checkout/perfil/placeOrder): eso vive con su feature.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp } = require("./helpers/load-app.js");

const A = loadApp();
const byId = A.productById;

/* ---- Bordes de los tramos de precio ---- */
// El peso del día cambia en los límites (hasta inclusivo): 2–3 ×0.50,
// 4–7 ×0.30, 8+ ×0.15. Un error de "<" vs "<=" se colaría aquí.
test("borde de tramo día 3→4: el día 4 pesa 0.30, no 0.50", () => {
  const p = byId(7); // día 1 = 15
  const inc = A.rentalListPrice(p, 4) - A.rentalListPrice(p, 3);
  assert.equal(inc, 4.5); // 0.30 · 15 (no 7.5)
});

test("borde de tramo día 7→8: el día 8 pesa 0.15, no 0.30", () => {
  const p = byId(7);
  const inc = A.rentalListPrice(p, 8) - A.rentalListPrice(p, 7);
  assert.equal(inc, 2.25); // 0.15 · 15 (no 4.5)
});

/* ---- Fechas iguales / invertidas ---- */
test("fechas invertidas (fin < inicio) → 1 día, nunca negativo ni cero", () => {
  assert.equal(A.daysBetween("2026-01-04", "2026-01-01"), 1);
  A.setState({ rentalStart: A.isoOffset(3), rentalEnd: A.isoOffset(0) }); // invertidas
  assert.equal(A.rentalDays(), 1);
});

/* ---- Topes con muchas prendas ---- */
test("depósito de pedido: muchas prendas caras siguen capadas al tope (40)", () => {
  const carro = Array(10).fill(byId(7)); // 10 esmoquines, depósito 25 c/u
  assert.equal(A.depositForItems(carro), A.DEPOSIT_ORDER_MAX); // 250 → 40
});

test("descuento por volumen no supera su tope aunque el carrito sea enorme", () => {
  assert.equal(A.volumeDiscountRate(50), 0.2);
});

/* ---- Material / estrellas fuera de rango ---- */
test("material desconocido cae al coste de lavandería del algodón", () => {
  // value 100, 5★ (30 ciclos), lavandería fallback 1.50, overhead 0.50.
  const raro = { value: 100, stars: 5, material: "desconocido" };
  assert.equal(A.cycleCost(raro), 100 / 30 + 1.5 + 0.5);
});

test("estrellas fuera de rango: DAY1 cae a 0.06 y 0★ deja el ciclo indefinido", () => {
  // Ningún producto real tiene 0★; el modelo no lo blinda. Se documenta el borde:
  // garmentCycles(0) = 0 ⇒ cycleCost divide por cero ⇒ Infinity. Un producto con
  // stars:0 romperría el precio; este test lo hace visible en revisión.
  assert.equal(A.garmentCycles({ stars: 0 }), 0);
  assert.equal(A.cycleCost({ value: 100, stars: 0, material: "algodon" }), Infinity);
  // Estrella alta desconocida (p. ej. 6★) usa el fallback de tarifa día-1 (0.06).
  assert.equal(A.rentalListPrice({ value: 100, stars: 6, material: "algodon" }, 1), 6);
});

/* ---- Consistencia del cobro del pedido ---- */
// La preocupación: que el pedido confirmado conserve el mismo total que se
// calculó, sin recalcular distinto al renderizar el perfil. orderTotal es la
// única fuente del cobro, así que recomputarlo debe dar exactamente o.total.
test("orderTotal es reproducible: recomputar da el mismo cobro guardado", () => {
  const o = {
    items: [7, 4],
    start: A.isoOffset(0),
    end: A.isoOffset(3),
    delivery: "ship",
    ret: "home"
  };
  const total = A.orderTotal(o); // lo que placeOrder guardaría en o.total
  assert.equal(A.orderTotal({ ...o, total }), total); // el perfil lo recomputa igual
});

/* ---- Matriz de vida del pedido (isLate × isArchivedOrder) ---- */
test("estados del pedido: los 4 cruces de pagado/vencido", () => {
  const past = A.isoOffset(-2);
  const future = A.isoOffset(2);
  // settled + vencido → archivado (y no se marca "vencido/late" en activos)
  assert.ok(A.isArchivedOrder({ status: "settled", end: past }));
  // settled + vigente → activo, no archivado, no vencido
  assert.ok(!A.isArchivedOrder({ status: "settled", end: future }));
  assert.ok(!A.isLate({ end: future }));
  // pending + vencido → NO archivado (falta el pago) pero SÍ vencido
  assert.ok(!A.isArchivedOrder({ status: "pending", end: past }));
  assert.ok(A.isLate({ end: past }));
  // pending + vigente → activo normal
  assert.ok(!A.isArchivedOrder({ status: "pending", end: future }));
  assert.ok(!A.isLate({ end: future }));
});
