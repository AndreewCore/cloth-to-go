/**
 * Pruebas del CANJE de puntos: que un premio canjeado se pueda aplicar a un
 * alquiler y rebaje de verdad el cobro.
 *
 * El foco está en las tres reglas que sostienen el programa:
 *   1. el descuento se DERIVA (nunca se guarda), así que sigue al pedido;
 *   2. el depósito es intocable — es dinero reembolsable, no ingreso;
 *   3. un canje se gasta una sola vez, y vuelve si el pedido se anula.
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

// Canjea un premio y devuelve su cupón (ya en profile.redeemed).
function canjear(rewardId) {
  app.profile.points = 1000;
  win.redeem(rewardId);
  app.confirmModalOk();
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
test("canjear guarda un cupón disponible con su premio asociado", () => {
  const c = canjear(3);
  assert.equal(app.profile.points, 1000 - 150);
  assert.equal(c.rewardId, 3);
  assert.equal(c.usedIn, null);
  assert.equal(app.availableCoupons().length, 1);
});

/* ---- Cada premio rebaja lo que promete ---- */
test("envío gratis descuenta exactamente una tarifa de logística", () => {
  carritoConEnvio();
  const c = canjear(1);
  const sinPremio = win.grandTotal();
  app.setCheckout({ appliedCoupon: c.id });

  assert.equal(app.couponDiscount(), app.SHIPPING_FEE);
  assert.equal(win.grandTotal().toFixed(2), (sinPremio - app.SHIPPING_FEE).toFixed(2));
});

test("envío gratis no descuenta nada si no hay envío ni retiro a domicilio", () => {
  carritoConEnvio();
  const c = canjear(1);
  app.setCheckout({ appliedCoupon: c.id, delivery: "pickup", returnMethod: "store" });

  assert.equal(app.couponDiscount(), 0);
  // Y se explica el motivo en vez de mostrar un "-$0.00" mudo.
  assert.match(app.couponIssue(), /envío a domicilio o retiro/);
});

test("1 día gratis descuenta la diferencia entre el período y un día menos", () => {
  carritoConEnvio(4);
  const c = canjear(2);
  const conCuatro = win.subtotal();
  app.setCheckout({ rentalEnd: app.isoOffset(3) });
  const conTres = win.subtotal();
  app.setCheckout({ rentalEnd: app.isoOffset(4), appliedCoupon: c.id });

  assert.equal(app.couponDiscount().toFixed(2), (conCuatro - conTres).toFixed(2));
});

test("1 día gratis no aplica a un alquiler de un solo día", () => {
  carritoConEnvio(0); // inicio = fin → 1 día
  const c = canjear(2);
  app.setCheckout({ appliedCoupon: c.id });

  assert.equal(win.rentalDays(), 1);
  assert.equal(app.couponDiscount(), 0);
});

test("el 10% se aplica al subtotal del alquiler, no al depósito ni al envío", () => {
  carritoConEnvio();
  const c = canjear(3);
  app.setCheckout({ appliedCoupon: c.id });

  const esperado = Math.round(win.subtotal() * 100 * 0.1) / 100;
  assert.equal(app.couponDiscount().toFixed(2), esperado.toFixed(2));
});

test("la prenda premium sale gratis solo por los días que cubre el premio", () => {
  const { premium } = carritoConEnvio(10); // 10 días, el premio cubre 2
  const c = canjear(4);
  app.setCheckout({ appliedCoupon: c.id });

  const dosDias = win.rentalPrice(premium, 2, app.cart.length);
  assert.equal(app.couponDiscount().toFixed(2), dosDias.toFixed(2));
  // Y nunca regala más de lo que esa prenda cuesta en el pedido.
  assert.ok(app.couponDiscount() <= win.rentalPrice(premium, 10, app.cart.length));
});

test("sin prendas destacadas, el premio premium no descuenta nada", () => {
  const normal = app.products.filter(p => p.stars < 5).slice(0, 2);
  app.cart = normal.map(p => ({ id: p.id }));
  app.setCheckout({
    delivery: "pickup",
    returnMethod: "store",
    payMethod: "cash",
    rentalStart: app.isoOffset(0),
    rentalEnd: app.isoOffset(4)
  });
  const c = canjear(4);
  app.setCheckout({ appliedCoupon: c.id });

  assert.equal(app.couponDiscount(), 0);
});

/* ---- El depósito es intocable ---- */
test("ningún premio rebaja el depósito ni deja el total por debajo de él", () => {
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
    const c = canjear(rw.id);
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

/* ---- El descuento se deriva: sigue al pedido cuando este cambia ---- */
test("editar la devolución recalcula el premio junto con el cobro", () => {
  carritoConEnvio();
  const c = canjear(1);
  app.setCheckout({ appliedCoupon: c.id, delivery: "pickup" }); // solo el retiro paga
  win.placeOrder();

  const o = app.orders[0];
  assert.equal(app.orderDiscount(o), app.SHIPPING_FEE);

  // Pasa a devolver en el local: ya no hay tarifa que cubrir → el premio no vale.
  o.ret = "store";
  o.retAddr = "";
  assert.equal(app.orderDiscount(o), 0);
  assert.equal(
    app.orderTotal(o).toFixed(2),
    (win.orderItemsSubtotal(o) + app.orderDeposit(o)).toFixed(2)
  );
});

/* ---- Un canje se gasta una sola vez ---- */
test("confirmar el pedido consume el cupón y lo saca de los disponibles", () => {
  carritoConEnvio();
  const c = canjear(1);
  app.setCheckout({ appliedCoupon: c.id });
  win.placeOrder();

  const o = app.orders[0];
  assert.equal(o.couponId, c.id);
  assert.equal(app.couponById(c.id).usedIn, o.id);
  assert.equal(app.availableCoupons().length, 0);
  // El total guardado ya viene rebajado.
  assert.equal(o.total.toFixed(2), app.orderTotal(o).toFixed(2));
});

test("un premio sin efecto no se consume: vuelve a estar disponible", () => {
  carritoConEnvio();
  const c = canjear(1);
  // Aplicado, pero luego el cliente elige local+local → el premio no rebaja nada.
  app.setCheckout({ appliedCoupon: c.id, delivery: "pickup", returnMethod: "store" });
  win.placeOrder();

  assert.equal(app.orders[0].couponId, null);
  assert.equal(app.availableCoupons().length, 1);
});

test("anular el pedido devuelve el premio a la cartera", () => {
  carritoConEnvio();
  const c = canjear(1);
  app.setCheckout({ appliedCoupon: c.id });
  win.placeOrder();
  assert.equal(app.availableCoupons().length, 0);

  win.cancelOrder(0);
  app.confirmModalOk();

  assert.equal(app.orders[0].status, "cancelled");
  assert.equal(app.availableCoupons().length, 1);
  assert.equal(app.couponById(c.id).usedIn, null);
});

/* ---- Puntos: lo cubierto por un premio no vuelve a puntuar ---- */
test("el premio reduce los puntos que otorga el pedido", () => {
  carritoConEnvio();
  const c = canjear(1);
  const sinPremio = win.orderPoints();
  app.setCheckout({ appliedCoupon: c.id });

  assert.ok(win.orderPoints() < sinPremio, "un alquiler más barato no puede dar los mismos puntos");
  assert.equal(win.orderPoints(), sinPremio - Math.round(app.SHIPPING_FEE * 10));
});

/* ---- Migración de canjes antiguos ---- */
test("los canjes viejos (sin id ni premio) se honran como cupones utilizables", () => {
  const KEY = app.STORAGE_PREFIX + "u1";
  win.localStorage.setItem(
    KEY,
    JSON.stringify({
      cart: [],
      orders: [],
      profile: {
        name: "Ana",
        email: "",
        phone: "",
        points: 0,
        donations: [],
        // Forma antigua: solo historial, sin forma de aplicarse.
        redeemed: [{ name: "Envío o retiro gratis", cost: 60, date: "01 ene" }]
      }
    })
  );
  app.loadFromKey(KEY);

  const c = app.profile.redeemed[0];
  assert.equal(c.rewardId, 1);
  assert.equal(c.usedIn, null);
  assert.equal(app.availableCoupons().length, 1, "el canje pagado debe poder usarse");
  assert.ok(c.id > 0);
});

test("un canje de un premio ya inexistente queda como historial, no como cupón", () => {
  const KEY = app.STORAGE_PREFIX + "u2";
  win.localStorage.setItem(
    KEY,
    JSON.stringify({
      cart: [],
      orders: [],
      profile: {
        name: "Ana",
        email: "",
        phone: "",
        points: 0,
        donations: [],
        redeemed: [{ name: "Premio retirado del catálogo", cost: 99, date: "01 ene" }]
      }
    })
  );
  app.loadFromKey(KEY);

  assert.equal(app.profile.redeemed[0].rewardId, null);
  assert.equal(app.availableCoupons().length, 0);
});
