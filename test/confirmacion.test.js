/**
 * Resumen de confirmación previo a registrar el pedido.
 *
 * Lo importante que se protege aquí: el diálogo es un PASO, no una operación.
 * Mientras no se acepte, nada se ha cobrado ni consumido; y lo que muestra
 * tiene que ser exactamente lo que placeOrder() acaba guardando, o el resumen
 * miente en el último punto donde el cliente puede echarse atrás.
 */
const test = require("node:test");
const assert = require("node:assert");
const { loadDom } = require("./helpers/load-dom");

/** Monta la app con un checkout completo y listo para confirmar. */
function listo(opts = {}) {
  const { window, document, app } = loadDom();
  app.cart = (opts.ids || [1, 7]).map(id => ({ id }));
  app.setCheckout({
    delivery: "pickup",
    returnMethod: "store",
    payMethod: "cash",
    ...opts.checkout,
  });
  return { window, document, app };
}

test("el botón de pago abre el resumen en vez de cobrar", async (t) => {
  await t.test("abre el diálogo y no crea el pedido todavía", () => {
    const { app } = listo();
    app.confirmOrder();
    assert.ok(app.modalOpen, "el diálogo debería estar abierto");
    assert.equal(app.orders.length, 0, "no puede haber pedido sin confirmar");
    assert.equal(app.cart.length, 2, "el carrito no se toca hasta confirmar");
  });

  await t.test("aceptar registra el pedido y vacía el carrito", () => {
    const { app } = listo();
    app.confirmOrder();
    app.confirmModalOk();
    assert.equal(app.orders.length, 1);
    assert.equal(app.cart.length, 0);
    assert.equal(app.view, "done");
  });

  await t.test("cerrar sin aceptar no deja rastro", () => {
    const { app, window } = listo();
    app.confirmOrder();
    window.closeModal();
    assert.equal(app.orders.length, 0);
    assert.equal(app.cart.length, 2);
    assert.notEqual(app.view, "done");
  });

  await t.test("ofrece 'Cancelar': es una decisión, no un aviso", () => {
    const { app } = listo();
    app.confirmOrder();
    assert.equal(app.modalCancelHidden, false);
  });

  await t.test("no se abre si el checkout está incompleto", () => {
    const { app } = listo({ checkout: { payMethod: null } });
    app.confirmOrder();
    assert.equal(app.modalOpen, false, "sin método de pago no hay nada que confirmar");
    assert.equal(app.orders.length, 0);
  });

  await t.test("no se abre con tarjeta a medio llenar", () => {
    const { app } = listo({
      checkout: { payMethod: "credit", card: { number: "4111", name: "", expiry: "", cvv: "" } },
    });
    app.confirmOrder();
    assert.equal(app.modalOpen, false);
  });
});

test("lo que el resumen enseña coincide con lo que se cobra", async (t) => {
  await t.test("el importe del botón es el total real del pedido", () => {
    const { app } = listo();
    const esperado = app.grandTotal();
    app.confirmOrder();
    assert.match(app.modalOkLabel, new RegExp(`\\$${esperado.toFixed(2)}\\b`));
  });

  await t.test("'Pagas ahora' cuadra con el total que se guarda en el pedido", () => {
    // La prueba de fuego del resumen: se compara contra el o.total que
    // placeOrder() acaba escribiendo, no contra un número recalculado a mano.
    const { app } = listo();
    const mostrado = app.grandTotal();
    app.confirmOrder();
    app.confirmModalOk();
    assert.equal(app.orders[0].total, mostrado);
  });

  await t.test("muestra el período elegido", () => {
    const { app } = listo();
    const html = app.confirmDetailHTML();
    assert.match(html, /oc-dates/);
    assert.ok(html.includes(app.fmtDate(app.rentalStart)));
    assert.ok(html.includes(app.fmtDate(app.rentalEnd)));
    assert.match(html, new RegExp(`${app.rentalDays()} días`));
  });

  await t.test("lista una fila por prenda con su precio", () => {
    const { app } = listo({ ids: [1, 2, 3] });
    const html = app.confirmDetailHTML();
    assert.equal((html.match(/class="oc-item"/g) || []).length, 3);
    for (const c of app.cart) {
      assert.ok(html.includes(app.productById(c.id).name.replace(/&/g, "&amp;")),
        `falta ${app.productById(c.id).name}`);
    }
  });

  await t.test("separa el depósito reembolsable del importe a pagar", () => {
    const { app } = listo();
    const html = app.confirmDetailHTML();
    const dep = app.depositTotal();
    assert.ok(dep > 0, "el caso de prueba necesita depósito");
    assert.match(html, /oc-refund/);
    assert.ok(html.includes(`$${dep.toFixed(2)}`));
    assert.match(html, /se te devuelven|Se te devuelven/);
  });

  await t.test("sin depósito no promete ninguna devolución", () => {
    const { app } = listo({ ids: [] });
    app.cart = [];
    const html = app.confirmDetailHTML();
    assert.ok(!html.includes("oc-refund"), "no hay nada que devolver");
  });

  await t.test("el envío solo aparece cuando se cobra", () => {
    const sinEnvio = listo({ checkout: { delivery: "pickup", returnMethod: "store" } });
    assert.ok(!sinEnvio.app.confirmDetailHTML().includes("Envío y retiro"));

    const conEnvio = listo({
      checkout: { delivery: "ship", address: "Av. Principal 123", returnMethod: "store" },
    });
    assert.ok(conEnvio.app.confirmDetailHTML().includes("Envío y retiro"));
  });
});

test("el resumen no consume nada por sí solo", async (t) => {
  await t.test("abrirlo y cerrarlo no gasta el premio canjeado", () => {
    // El canje solo debe marcarse usado al confirmar. Si mirar el resumen lo
    // quemara, el cliente perdería el premio por curiosear.
    const { app } = listo();
    const r = app.REWARDS.find(x => x.type === "shipping") || app.REWARDS[0];
    app.profile = { ...app.profile, points: 100000, redeemed: [] };
    app.redeem(r.id);
    app.confirmModalOk();          // redeem() pide confirmación antes de canjear
    const cupon = app.availableCoupons()[0];
    assert.ok(cupon, "el canje debería haber dejado un cupón disponible");
    app.setCheckout({ appliedCoupon: cupon.id, delivery: "ship", address: "Av. Principal 123" });

    app.confirmOrder();
    assert.equal(app.couponById(cupon.id).usedIn, null, "el canje sigue disponible");
  });

  await t.test("abrirlo dos veces no duplica pedidos", () => {
    const { app } = listo();
    app.confirmOrder();
    app.confirmOrder();
    app.confirmModalOk();
    assert.equal(app.orders.length, 1);
  });
});

test("seguridad del marcado del resumen", async (t) => {
  await t.test("los nombres de prenda se escapan", () => {
    const { app } = listo({ ids: [1] });
    app.products[0].name = '<img src=x onerror="alert(1)">';
    app.cart = [{ id: app.products[0].id }];
    const html = app.confirmDetailHTML();
    // Ojo: imgPlaceholder() trae su propio onerror= legítimo, así que buscar
    // "onerror=" a secas da falso positivo. Lo que importa es que la etiqueta
    // inyectada no sobreviva como marcado.
    assert.ok(!html.includes("<img src=x"), "inyección sin escapar en el resumen");
    assert.ok(html.includes("&lt;img"), "debería venir escapado");
  });
});
