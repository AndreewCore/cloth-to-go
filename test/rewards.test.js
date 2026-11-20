/**
 * Pruebas del CANJE de puntos: que un premio canjeado se pueda aplicar a un
 * alquiler y rebaje de verdad el cobro.
 *
 * El foco está en las tres reglas que sostienen el programa:
 *   1. el descuento se DERIVA (nunca se guarda), así que sigue al pedido;
 *   2. el depósito es intocable — es dinero reembolsable, no ingreso;
 *   3. un canje se gasta una sola vez, y vuelve si el pedido se anula.
 *
 * Desde la fase 3 el saldo, los canjes y el descuento que se COBRA los decide
 * el servidor (server/test/puntos.test.js prueba esas reglas). Aquí queda lo
 * del navegador: la vista previa del descuento en el checkout y que la app
 * adopte lo que la API responde.
 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadDom } = require("./helpers/load-dom.js");

let win, app, fake, flush;

beforeEach(() => {
  const env = loadDom();
  win = env.window;
  app = env.app;
  fake = env.fake;
  flush = env.flush;
});

// Canjea un premio contra la API (con saldo de sobra) y devuelve su cupón.
async function canjear(rewardId) {
  fake.state.balance = 1000;
  await app.syncAccount();
  win.redeem(rewardId);
  app.confirmModalOk(); await flush();
  await flush();
  return app.profile.redeemed[0];
}

// Carrito de 2 prendas (una destacada de 5★) con envío y retiro a domicilio.
function carritoConEnvio(dias = 4) {
  const premium = app.products.find(p => p.stars >= 5);
  const otra = app.products.find(p => p.id !== premium.id);
  app.cart = [{ id: premium.id }, { id: otra.id }];
  app.setCheckout({
    delivery: "ship",
    address: "Av. Principal 123 y Segunda",
    returnMethod: "home",
    returnAddress: "Av. Principal 123 y Segunda",
    payMethod: "cash",
    rentalStart: app.isoOffset(0),
    rentalEnd: app.isoOffset(dias)
  });
  return { premium, otra };
}

/* ---- El canje deja un premio utilizable, no solo una línea de historial ---- */
test("canjear guarda un cupón disponible con su premio asociado", async () => {
  const c = await canjear(3);
  assert.equal(app.profile.points, 1000 - 150);
  assert.equal(c.rewardId, 3);
  assert.equal(c.usedIn, null);
  assert.equal(app.availableCoupons().length, 1);
});

/* ---- Cada premio rebaja lo que promete ---- */
test("envío gratis descuenta exactamente una tarifa de logística", async () => {
  carritoConEnvio();
  const c = await canjear(1);
  const sinPremio = win.grandTotal();
  app.setCheckout({ appliedCoupon: c.id });

  assert.equal(app.couponDiscount(), app.SHIPPING_FEE);
  assert.equal(win.grandTotal().toFixed(2), (sinPremio - app.SHIPPING_FEE).toFixed(2));
});

test("envío gratis no descuenta nada si no hay envío ni retiro a domicilio", async () => {
  carritoConEnvio();
  const c = await canjear(1);
  app.setCheckout({ appliedCoupon: c.id, delivery: "pickup", returnMethod: "store" });

  assert.equal(app.couponDiscount(), 0);
  // Y se explica el motivo en vez de mostrar un "-$0.00" mudo.
  assert.match(app.couponIssue(), /envío a domicilio o retiro/);
});

test("1 día gratis descuenta la diferencia entre el período y un día menos", async () => {
  carritoConEnvio(4);
  const c = await canjear(2);
  const conCuatro = win.subtotal();
  app.setCheckout({ rentalEnd: app.isoOffset(3) });
  const conTres = win.subtotal();
  app.setCheckout({ rentalEnd: app.isoOffset(4), appliedCoupon: c.id });

  assert.equal(app.couponDiscount().toFixed(2), (conCuatro - conTres).toFixed(2));
});

test("1 día gratis no aplica a un alquiler de un solo día", async () => {
  carritoConEnvio(0); // inicio = fin → 1 día
  const c = await canjear(2);
  app.setCheckout({ appliedCoupon: c.id });

  assert.equal(win.rentalDays(), 1);
  assert.equal(app.couponDiscount(), 0);
});

test("el 10% se aplica al subtotal del alquiler, no al depósito ni al envío", async () => {
  carritoConEnvio();
  const c = await canjear(3);
  app.setCheckout({ appliedCoupon: c.id });

  const esperado = Math.round(win.subtotal() * 100 * 0.1) / 100;
  assert.equal(app.couponDiscount().toFixed(2), esperado.toFixed(2));
});

test("la prenda premium sale gratis solo por los días que cubre el premio", async () => {
  const { premium } = carritoConEnvio(10); // 10 días, el premio cubre 2
  const c = await canjear(4);
  app.setCheckout({ appliedCoupon: c.id });

  const dosDias = win.rentalPrice(premium, 2, app.cart.length);
  assert.equal(app.couponDiscount().toFixed(2), dosDias.toFixed(2));
  // Y nunca regala más de lo que esa prenda cuesta en el pedido.
  assert.ok(app.couponDiscount() <= win.rentalPrice(premium, 10, app.cart.length));
});

test("sin prendas destacadas, el premio premium no descuenta nada", async () => {
  const normal = app.products.filter(p => p.stars < 5).slice(0, 2);
  app.cart = normal.map(p => ({ id: p.id }));
  app.setCheckout({
    delivery: "pickup",
    returnMethod: "store",
    payMethod: "cash",
    rentalStart: app.isoOffset(0),
    rentalEnd: app.isoOffset(4)
  });
  const c = await canjear(4);
  app.setCheckout({ appliedCoupon: c.id });

  assert.equal(app.couponDiscount(), 0);
});

/* ---- El depósito es intocable ---- */
test("ningún premio rebaja el depósito ni deja el total por debajo de él", async () => {
  // Carrito barato + premio caro: el descuento se topa en lo cobrable.
  const barata = app.products.reduce((m, p) => (p.value < m.value ? p : m));
  app.cart = [{ id: barata.id }];
  app.setCheckout({
    delivery: "pickup",
    returnMethod: "store",
    payMethod: "cash",
    rentalStart: app.isoOffset(0),
    rentalEnd: app.isoOffset(1)
  });
  for (const rw of app.REWARDS) {
    const c = await canjear(rw.id);
    app.setCheckout({ appliedCoupon: c.id });
    assert.ok(
      app.couponDiscount() <= win.subtotal() + 0.001,
      `${rw.name} descuenta más que el alquiler`
    );
    assert.ok(
      win.grandTotal() >= win.depositTotal() - 0.001,
      `${rw.name} deja el total por debajo del depósito`
    );
  }
});

/* ---- Un canje se gasta una sola vez ---- */
test("confirmar el pedido consume el cupón y lo saca de los disponibles", async () => {
  carritoConEnvio();
  const c = await canjear(1);
  app.setCheckout({ appliedCoupon: c.id });
  await win.placeOrder();

  await flush();
  const o = app.orders[0];
  assert.equal(fake.calls.find(x => x.method === "POST" && x.path === "/api/orders").body.couponId, c.id, "viaja el id, no un importe");
  assert.equal(o.couponId, c.id);
  assert.equal(app.couponById(c.id).usedIn, o.id);
  assert.equal(app.availableCoupons().length, 0);
});

test("un premio sin efecto no se consume: vuelve a estar disponible", async () => {
  carritoConEnvio();
  const c = await canjear(1);
  // Aplicado, pero luego el cliente elige local+local → el premio no rebaja nada.
  app.setCheckout({ appliedCoupon: c.id, delivery: "pickup", returnMethod: "store" });
  await win.placeOrder();

  await flush();
  assert.equal(app.orders[0].couponId, null);
  assert.equal(app.availableCoupons().length, 1);
});

test("anular el pedido devuelve el premio a la cartera", async () => {
  carritoConEnvio();
  const c = await canjear(1);
  app.setCheckout({ appliedCoupon: c.id });
  await win.placeOrder();
  await flush();
  assert.equal(app.availableCoupons().length, 0);

  win.cancelOrder(0);
  app.confirmModalOk(); await flush();

  assert.equal(app.orders[0].status, "cancelled");
  assert.equal(app.availableCoupons().length, 1);
  assert.equal(app.couponById(c.id).usedIn, null);
});

/* ---- Puntos: lo cubierto por un premio no vuelve a puntuar ---- */
test("el premio reduce los puntos que otorga el pedido", async () => {
  carritoConEnvio();
  const c = await canjear(1);
  const sinPremio = win.orderPoints();
  app.setCheckout({ appliedCoupon: c.id });

  assert.ok(win.orderPoints() < sinPremio, "un alquiler más barato no puede dar los mismos puntos");
  assert.equal(win.orderPoints(), sinPremio - Math.round(app.SHIPPING_FEE * 10));
});

/* ---- Lo guardado en el navegador ya no compra nada ---- */
test("los puntos y canjes guardados en el navegador no se adoptan: los da el servidor", () => {
  const KEY = app.STORAGE_PREFIX + "u1";
  win.localStorage.setItem(KEY, JSON.stringify({
    cart: [],
    orders: [{ id: 1001, items: [1], start: "2026-01-05", end: "2026-01-08", status: "settled", total: 10 }],
    profile: { name: "Ana", points: 999999, waterGoals: [1, 2],
      redeemed: [{ id: 1, rewardId: 1, name: "Envío o retiro gratis", cost: 60, usedIn: null }] },
  }));
  app.loadFromKey(KEY);
  assert.equal(app.profile.name, "Ana", "el resto del perfil sí se conserva");
  assert.equal(app.profile.points, 0);
  assert.equal(app.availableCoupons().length, 0);
  assert.equal(app.orders.length, 0, "los pedidos viven en la base");
});

/* ---- El agujero del "canje por un pedido que nunca se cumplió" ----
   Los puntos se acreditaban el día de inicio, cuando el pedido TODAVÍA era
   anulable: bastaba con canjearlos y anular para quedarse con el premio. */
test("un pedido anulable no acredita puntos: no hay nada que canjear", async () => {
  carritoConEnvio();
  app.setCheckout({ payMethod: "credit",
    card: { number: "4111111111111111", name: "Ana Ruiz", expiry: "12/30", cvv: "123" },
    rentalStart: app.isoOffset(0), rentalEnd: app.isoOffset(6) });
  await win.placeOrder();

  const o = app.orders[0];
  assert.ok(o.points > 0, "el pedido sí genera puntos…");
  assert.ok(win.canCancelOrder(o));
  assert.ok(!o.pointsCredited, "…pero no se acreditan mientras se pueda anular");
  assert.equal(app.profile.points, 0);
});

test("no se puede farmear premios pidiendo, canjeando y anulando", async () => {
  for (let i = 0; i < 3; i++) {
    carritoConEnvio();
    app.setCheckout({ payMethod: "credit",
      card: { number: "4111111111111111", name: "Ana Ruiz", expiry: "12/30", cvv: "123" },
      rentalStart: app.isoOffset(0), rentalEnd: app.isoOffset(6) });
    await win.placeOrder();
    win.redeem(1);                       // 60 pts: sin saldo, no debe canjear
    win.cancelOrder(app.orders.length - 1);
    app.confirmModalOk(); await flush();
  }
  assert.equal(app.profile.points, 0);
  assert.equal(app.profile.redeemed.length, 0, "ningún premio salió de la nada");
  assert.equal(app.availableCoupons().length, 0);
});
