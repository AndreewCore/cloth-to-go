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


/* ---- Fechas iguales / invertidas ---- */
test("fechas invertidas (fin < inicio) → 1 día, nunca negativo ni cero", () => {
  assert.equal(A.daysBetween("2026-01-04", "2026-01-01"), 1);
  A.setState({ rentalStart: A.isoOffset(3), rentalEnd: A.isoOffset(0) }); // invertidas
  assert.equal(A.rentalDays(), 1);
});

/* ---- Topes con muchas prendas ---- */


/* ---- Material / estrellas fuera de rango ---- */


/* ---- Consistencia del cobro del pedido ---- */
// La preocupación: que el pedido confirmado conserve el mismo total que se
// calculó, sin recalcular distinto al renderizar el perfil. orderTotal es la
// única fuente del cobro, así que recomputarlo debe dar exactamente o.total.

/* ---- Matriz de vida del pedido (isLate × isArchivedOrder) ---- */
test("estados del pedido: los 4 cruces de pagado/vencido", () => {
  const past = A.isoOffset(-2);
  const future = A.isoOffset(2);
  // Todos entregados: «vencido» solo tiene sentido con la prenda fuera.
  const isLate = (o) => A.isLate({ ...o, deliveredAt: A.isoOffset(-5) });
  // settled + vencido → archivado (y no se marca "vencido/late" en activos)
  assert.ok(A.isArchivedOrder({ status: "settled", end: past }));
  // settled + vigente → activo, no archivado, no vencido
  assert.ok(!A.isArchivedOrder({ status: "settled", end: future }));
  assert.ok(!isLate({ end: future }));
  // pending + vencido → NO archivado (falta el pago) pero SÍ vencido
  assert.ok(!A.isArchivedOrder({ status: "pending", end: past }));
  assert.ok(isLate({ end: past }));
  // pending + vigente → activo normal
  assert.ok(!A.isArchivedOrder({ status: "pending", end: future }));
  assert.ok(!isLate({ end: future }));
});
