/**
 * Pruebas de las PUERTAS del checkout: `checkoutValid()`, `paymentValid()` y el
 * borrado del estado al terminar (`resetCheckoutState()`).
 *
 * Son las tres funciones que deciden si se puede avanzar y qué se lleva puesto
 * el siguiente pedido. Nada de esto se ve al usarlas bien: el fallo aparece
 * cuando alguien pasa a pagar sin dirección, o cuando el segundo alquiler nace
 * con la tarjeta y la dirección del primero ya escritas.
 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadDom } = require("./helpers/load-dom.js");

let win, doc, app;

const TARJETA_OK = { number: "4111111111111111", name: "Ana Ruiz", expiry: "12/30", cvv: "123" };

beforeEach(() => {
  const env = loadDom();
  win = env.window;
  doc = env.document;
  app = env.app;
  app.cart = [{ id: app.products[0].id }];
});

/* ---- Entrega y devolución ---- */
test("sin elegir entrega ni devolución no se puede avanzar", () => {
  app.setCheckout({ delivery: null, returnMethod: null });
  // Se comprueba la VERACIDAD y no `=== false`: la función devuelve el propio
  // valor de `delivery` cuando está sin elegir (null), no un booleano. Es lo que
  // consume el `disabled` del botón, así que funciona; queda anotado como
  // hallazgo de tipo para la rama de refactor.
  assert.ok(!win.checkoutValid());
});

test("retiro en local + devolución en local no piden dirección", () => {
  app.setCheckout({ delivery: "pickup", returnMethod: "store" });
  assert.equal(win.checkoutValid(), true);
});

test("envío a domicilio exige dirección utilizable", () => {
  app.setCheckout({ delivery: "ship", address: "", returnMethod: "store" });
  assert.equal(win.checkoutValid(), false, "sin dirección no avanza");

  app.setCheckout({ address: "abc" });
  assert.equal(win.checkoutValid(), false, "una dirección de tres letras no es una dirección");

  app.setCheckout({ address: "Av. Francisco de Orellana 123 y Justino Cornejo" });
  assert.equal(win.checkoutValid(), true);
});

test("la devolución a domicilio exige SU propia dirección", () => {
  // Son dos direcciones distintas a propósito: te lo traen a casa y lo devuelves
  // desde la oficina, o al revés.
  app.setCheckout({
    delivery: "ship", address: "Av. Francisco de Orellana 123 y Justino Cornejo",
    returnMethod: "home", returnAddress: "",
  });
  assert.equal(win.checkoutValid(), false);

  app.setCheckout({ returnAddress: "Cdla. Kennedy Norte, calle San Roque 45" });
  assert.equal(win.checkoutValid(), true);
});

test("con el selector de mapa disponible manda el punto, no el texto", () => {
  // Dos reglas distintas según haya mapa o no, y conviene que se vean juntas:
  // sin mapa la dirección escrita es lo único que hay; con mapa, exigir además
  // un texto largo obligaría a escribir lo que se acaba de señalar con el dedo.
  const conMapa = loadDom({ storage: { "clothToGo:mapsKey": "CLAVE-DE-PRUEBA" } });
  assert.equal(conMapa.app.mapsAvailable(), true);
  assert.equal(conMapa.app.addressReady("Casa", { lat: -2.17, lng: -79.92 }), true,
    "el punto marcado basta");
  assert.equal(conMapa.app.addressReady("Av. Francisco de Orellana 123 y Justino Cornejo", null), false,
    "sin punto no se da por lista, aunque el texto sea largo");

  // El entorno por defecto no trae clave: se cae al texto.
  assert.equal(app.mapsAvailable(), false);
  assert.equal(app.addressReady("Casa", { lat: -2.17, lng: -79.92 }), false);
  assert.equal(app.addressReady("Av. Francisco de Orellana 123 y Justino Cornejo", null), true);
});

/* ---- Pago ---- */
test("el efectivo no pide más datos", () => {
  app.setCheckout({ payMethod: "cash" });
  assert.equal(win.paymentValid(), true);
});

test("sin método de pago elegido no se confirma", () => {
  app.setCheckout({ payMethod: null });
  assert.equal(win.paymentValid(), false);
});

test("la tarjeta exige sus cuatro campos válidos", () => {
  app.setCheckout({ payMethod: "credit", card: { ...TARJETA_OK } });
  assert.equal(win.paymentValid(), true);

  const rotas = {
    "número corto":      { number: "4111" },
    "nombre vacío":      { name: "" },
    "caducidad inválida": { expiry: "13/30" },
    "cvv de dos cifras": { cvv: "12" },
  };
  for (const [caso, parche] of Object.entries(rotas)) {
    app.setCheckout({ card: { ...TARJETA_OK, ...parche } });
    assert.equal(win.paymentValid(), false, `debería rechazar: ${caso}`);
  }
});

test("débito y crédito se validan igual", () => {
  app.setCheckout({ payMethod: "debit", card: { ...TARJETA_OK } });
  assert.equal(win.paymentValid(), true);
  app.setCheckout({ card: { ...TARJETA_OK, cvv: "1" } });
  assert.equal(win.paymentValid(), false);
});

/* ---- El botón refleja la puerta ---- */
test("el botón de pago aparece deshabilitado mientras falte algo", () => {
  app.setCheckout({ delivery: "ship", address: "", returnMethod: null });
  app.view = "checkout";
  win.renderSheet();

  const btn = doc.querySelector('[data-action="toPayment"]');
  assert.ok(btn.hasAttribute("disabled"), "no debe dejar pasar a pagar");

  app.setCheckout({
    address: "Av. Francisco de Orellana 123 y Justino Cornejo", returnMethod: "store",
  });
  win.renderSheet();
  assert.ok(!doc.querySelector('[data-action="toPayment"]').hasAttribute("disabled"));
});

/* ---- Lo que queda después de comprar ---- */
test("terminar un pedido no deja nada del anterior", () => {
  // El segundo alquiler no puede nacer con la dirección y la tarjeta del
  // primero ya puestas: son datos de UN pedido, no del usuario.
  app.setCheckout({
    delivery: "ship", address: "Av. Francisco de Orellana 123 y Justino Cornejo",
    addressCoords: { lat: -2.17, lng: -79.92 },
    returnMethod: "home", returnAddress: "Cdla. Kennedy Norte, calle San Roque 45",
    payMethod: "credit", card: { ...TARJETA_OK },
  });

  win.resetCheckoutState();

  assert.equal(app.delivery, null);
  assert.equal(app.address, "");
  assert.equal(app.addressCoords, null);
  assert.equal(app.returnMethod, null);
  assert.equal(app.returnAddress, "");
  assert.equal(app.returnAddressCoords, null);
  assert.equal(app.payMethod, null);
  assert.equal(app.appliedCoupon, null);
  assert.equal(app.card.number, "", "la tarjeta no sobrevive al pedido");
  assert.equal(app.card.cvv, "");
});

test("los datos de la tarjeta nunca se persisten", () => {
  // Regla de la casa: se puede guardar el carrito, jamás el medio de pago.
  app.setCheckout({ payMethod: "credit", card: { ...TARJETA_OK } });
  win.activateUserSession({ sub: "111", name: "Ana", email: "ana@example.com" });
  app.setCheckout({ payMethod: "credit", card: { ...TARJETA_OK } });
  win.saveState();

  const guardado = win.localStorage.getItem(app.STORAGE_PREFIX + "111") || "";
  assert.doesNotMatch(guardado, /4111111111111111/);
  assert.doesNotMatch(guardado, /"cvv"/);
});

test("finishOrder limpia el checkout y devuelve la vista al carrito", () => {
  app.setCheckout({ delivery: "pickup", returnMethod: "store", payMethod: "cash" });
  app.view = "done";

  win.finishOrder();

  assert.equal(app.view, "cart");
  assert.equal(app.delivery, null);
  assert.equal(app.payMethod, null);
});
