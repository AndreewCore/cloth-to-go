/**
 * Pruebas de los cálculos derivados de js/state.js: subtotal, depósito, total y
 * los totales por pedido. Cada test refresca el estado con `setState`.
 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp } = require("./helpers/load-app.js");

const A = loadApp();

// Deja el carrito en un estado conocido: 1 día, sin envío ni devolución a domicilio.
beforeEach(() => {
  A.setState({
    cart: [],
    orders: [],
    delivery: null,
    returnMethod: null,
    rentalStart: A.isoOffset(0),
    rentalEnd: A.isoOffset(1) // daysBetween = 1
  });
});






test("paymentStatusLabel: settled = Cancelado, resto = Pendiente", () => {
  assert.equal(A.paymentStatusLabel({ status: "settled" }), "Cancelado");
  assert.equal(A.paymentStatusLabel({ status: "pending" }), "Pendiente");
});

test("rentalDays = días entre las fechas del carrito (mínimo 1)", () => {
  A.setState({ rentalStart: A.isoOffset(0), rentalEnd: A.isoOffset(3) });
  assert.equal(A.rentalDays(), 3);
  A.setState({ rentalStart: A.isoOffset(0), rentalEnd: A.isoOffset(0) });
  assert.equal(A.rentalDays(), 1); // mismo día → mínimo 1
});



test("isLate: entregada, sin devolver y con la fecha límite ya pasada", () => {
  const entregada = { deliveredAt: A.isoOffset(-5) };
  assert.ok(!A.isLate({ ...entregada, end: A.isoOffset(2) })); // vence en el futuro
  assert.ok(A.isLate({ ...entregada, end: A.isoOffset(-2) })); // venció hace 2 días
  assert.ok(!A.isLate({ ...entregada, end: A.isoOffset(-2), returned: true }), "ya volvió");
  assert.ok(!A.isLate({ end: A.isoOffset(-2) }), "lo que nunca salió no está atrasado");
});

test("isArchivedOrder: pagado Y con el período ya terminado", () => {
  assert.ok(A.isArchivedOrder({ status: "settled", end: A.isoOffset(-2) }));
  assert.ok(!A.isArchivedOrder({ status: "settled", end: A.isoOffset(2) })); // aún vigente
  assert.ok(!A.isArchivedOrder({ status: "pending", end: A.isoOffset(-2) })); // sin pagar
});

/* ---- Stock: prenda única fuera del catálogo mientras está alquilada ---- */
test("isRented: la prenda de un pedido vigente está alquilada; la de uno archivado no", () => {
  const vigente  = { items: [7], status: "pending",  end: A.isoOffset(2) };
  const devuelto = { items: [1], status: "settled",  end: A.isoOffset(-2) };
  A.setState({ orders: [vigente, devuelto] });
  assert.ok(A.isRented(7));    // sigue fuera
  assert.ok(!A.isRented(1));   // pedido archivado → vuelve al catálogo
  assert.ok(!A.isRented(3));   // nunca se alquiló
});

test("unitsAvailable: alquilada → 0; en el carrito → 0; libre → su stock", () => {
  const p = A.productById(7);
  A.setState({ orders: [{ items: [7], status: "settled", end: A.isoOffset(2) }], cart: [] });
  assert.equal(A.unitsAvailable(p), 0);          // alquilada
  A.setState({ orders: [], cart: [{ id: 7 }] });
  assert.equal(A.unitsAvailable(p), 0);          // reservada en el carrito
  A.setState({ orders: [], cart: [] });
  assert.equal(A.unitsAvailable(p), p.disponibles);
});

test("unitsAvailable nunca baja de 0 aunque coincidan alquiler y carrito", () => {
  const p = A.productById(7);
  A.setState({ orders: [{ items: [7], status: "settled", end: A.isoOffset(2) }], cart: [{ id: 7 }] });
  assert.equal(A.unitsAvailable(p), 0);
});

/* ---- Anulación de pedido ---- */
test("canCancelOrder: solo mientras las prendas no estén en manos del cliente", () => {
  const base = { items: [7], status: "pending", end: A.isoOffset(5) };
  // Sin entrega registrada se puede anular, aunque ya pasara el día de retiro:
  // si no vino a retirar, no alquiló.
  assert.ok(A.canCancelOrder({ ...base, start: A.isoOffset(2) }));
  assert.ok(A.canCancelOrder({ ...base, start: A.isoOffset(0) }));
  assert.ok(A.canCancelOrder({ ...base, start: A.isoOffset(-1) }));
  // El local registró la entrega → la prenda está con el cliente.
  assert.ok(!A.canCancelOrder({ ...base, start: A.isoOffset(-1), deliveredAt: A.isoOffset(-1) }));
  // Terminado (pagado y vencido) o ya anulado → tampoco.
  assert.ok(!A.canCancelOrder({ items: [7], status: "settled", start: A.isoOffset(-5), end: A.isoOffset(-2) }));
  assert.ok(!A.canCancelOrder({ ...base, start: A.isoOffset(2), status: "cancelled" }));
});

test("un pedido anulado libera sus prendas y se etiqueta 'Anulado'", () => {
  const anulado = { items: [7], status: "cancelled", start: A.isoOffset(0), end: A.isoOffset(3) };
  A.setState({ orders: [anulado], cart: [] });
  assert.ok(!A.isRented(7));                       // vuelve al catálogo
  assert.ok(A.isPastOrder(anulado));               // sale de los activos
  assert.ok(!A.isArchivedOrder(anulado));          // pero no es un alquiler cumplido
  // "Cancelado" aquí significa PAGADO: un pedido anulado no puede llamarse así.
  assert.equal(A.paymentStatusLabel(anulado), "Anulado");
});
