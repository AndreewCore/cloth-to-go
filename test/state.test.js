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

test("subtotal de una prenda = su tarifa del día", () => {
  A.setState({ cart: [{ id: 7 }] }); // Esmoquin, 1 día → 15.00
  assert.equal(A.subtotal(), 15.0);
});

test("grandTotal = subtotal + depósito + envío + devolución", () => {
  A.setState({ cart: [{ id: 7 }] });
  // Sin envío ni devolución a domicilio: 15 + depósito(25).
  assert.equal(A.grandTotal(), 15.0 + 25.0);
  A.setState({ delivery: "ship", returnMethod: "home" });
  assert.equal(A.grandTotal(), 15.0 + 25.0 + A.SHIPPING_FEE * 2);
});

test("el descuento por volumen reduce el subtotal del carrito", () => {
  A.setState({ cart: [{ id: 7 }, { id: 4 }] }); // Esmoquin + Abrigo (ambos por encima del piso)
  assert.ok(A.subtotal() < A.subtotalBeforeVolume());
  assert.ok(A.volumeSavings() > 0);
});

test("el depósito del carrito respeta el tope de pedido (40)", () => {
  A.setState({ cart: [{ id: 7 }, { id: 4 }] }); // 25 + 25 = 50 → 40
  assert.equal(A.depositTotal(), A.DEPOSIT_ORDER_MAX);
});

test("orderTotal incluye el depósito y cambia con el modo de devolución", () => {
  const base = {
    items: [7],
    start: A.isoOffset(0),
    end: A.isoOffset(3), // 3 días → tarifa 30.00
    delivery: "pickup",
    ret: "store"
  };
  // 30 (tarifa 3 días) + 25 (depósito) + 0 + 0.
  assert.equal(A.orderTotal(base), 30.0 + 25.0);
  // Devolución a domicilio suma la tarifa de envío.
  assert.equal(A.orderTotal({ ...base, ret: "home" }), 30.0 + 25.0 + A.SHIPPING_FEE);
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

test("orderPoints = gasto·10 + días·2 + prendas·5 (el depósito no puntúa)", () => {
  A.setState({
    cart: [{ id: 7 }], // Esmoquin, 3 días → subtotal 30
    delivery: null,
    returnMethod: null,
    rentalStart: A.isoOffset(0),
    rentalEnd: A.isoOffset(3)
  });
  // round(30·10) + 3·2 + 1·5 = 300 + 6 + 5. El depósito (reembolsable) no cuenta.
  assert.equal(A.orderPoints(), 311);
});

test("orderItemsSubtotal / orderDeposit: cálculos sobre un pedido confirmado", () => {
  const o = { items: [7], start: A.isoOffset(0), end: A.isoOffset(3) };
  assert.equal(A.orderItemsSubtotal(o), 30.0); // 3 días
  assert.equal(A.orderDeposit(o), 25.0); // depósito del esmoquin (tope por prenda)
});

test("isLate: la fecha límite del alquiler ya pasó", () => {
  assert.ok(!A.isLate({ end: A.isoOffset(2) })); // vence en el futuro
  assert.ok(A.isLate({ end: A.isoOffset(-2) })); // venció hace 2 días
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
  // Aún no empieza (o empieza hoy) → se puede anular.
  assert.ok(A.canCancelOrder({ ...base, start: A.isoOffset(2) }));
  assert.ok(A.canCancelOrder({ ...base, start: A.isoOffset(0) }));
  // Ya empezó → la prenda está con el cliente.
  assert.ok(!A.canCancelOrder({ ...base, start: A.isoOffset(-1) }));
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
