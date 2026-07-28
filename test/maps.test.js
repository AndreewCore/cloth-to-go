/**
 * Pruebas del selector de ubicación con Google Maps.
 *
 * El SDK de Google no existe en jsdom (ni debería: las pruebas no salen a la
 * red), así que aquí NO se prueba el mapa en sí. Se prueba lo que sí es
 * responsabilidad de la app y lo que romperia la demo si fallara:
 *   1. que sin clave/red la app degrade al campo de texto de siempre;
 *   2. que una ubicación elegida llegue bien al checkout y al pedido;
 *   3. que escribir a mano invalide el punto, para no mandar el reparto
 *      a la ubicación anterior.
 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadDom } = require("./helpers/load-dom.js");

let win, doc, app;

beforeEach(() => {
  const env = loadDom();
  win = env.window;
  doc = env.document;
  app = env.app;
});

const PUNTO = { lat: -2.170998, lng: -79.922359, address: "Av. 9 de Octubre 100, Guayaquil" };

// Los objetos nacen dentro del contexto de jsdom, con otro Object.prototype que
// el de este archivo: deepStrictEqual los rechazaría aunque el contenido sea
// idéntico. Se comparan los campos, que es lo que de verdad importa aquí.
function assertPunto(coords, esperado, msg) {
  assert.ok(coords, msg || "debe haber coordenadas");
  assert.equal(coords.lat, esperado.lat);
  assert.equal(coords.lng, esperado.lng);
}

/* ---- Degradación: sin clave configurada la app no pierde nada ---- */
test("sin clave de Maps el selector no se ofrece", () => {
  assert.equal(app.hardcodedMapsKey, "", "el repo no debe llevar una clave hardcodeada");
  assert.equal(app.mapsApiKey(), "");
  assert.equal(app.mapsAvailable(), false);
  assert.equal(app.mapPickerButtonHTML("ship", null), "");
});

/* ---- Override local: la única vía admitida para probar con una clave real ---- */
test("la clave del localStorage activa el selector sin tocar el código", () => {
  const env = loadDom({ storage: { "clothToGo:mapsKey": "CLAVE-DE-PRUEBA" } });
  assert.equal(env.app.hardcodedMapsKey, "", "el override no debe ensuciar el código");
  assert.equal(env.app.mapsApiKey(), "CLAVE-DE-PRUEBA");
  assert.equal(env.app.mapsAvailable(), true);
  assert.match(env.app.mapPickerButtonHTML("ship", null), /data-action="pickLocation"/);
});

test("?mapskey= guarda la clave y desaparece de la URL", () => {
  const env = loadDom({ url: "https://cloth.test/?mapskey=CLAVE-URL" });
  env.app.adoptMapsKeyFromUrl();
  assert.equal(env.window.localStorage.getItem("clothToGo:mapsKey"), "CLAVE-URL");
  // Una clave en el query string se filtra por historial y por Referer.
  assert.equal(env.window.location.search, "");
  assert.equal(env.app.mapsApiKey(), "CLAVE-URL");
});

test("sin ?mapskey= no se pisa el override ya guardado", () => {
  const env = loadDom({
    url: "https://cloth.test/",
    storage: { "clothToGo:mapsKey": "CLAVE-PREVIA" }
  });
  env.app.adoptMapsKeyFromUrl();
  assert.equal(env.app.mapsApiKey(), "CLAVE-PREVIA");
});

test("sin mapa, el campo de dirección escrito a mano sigue siendo válido", () => {
  app.cart = [{ id: 7 }];
  app.setCheckout({ delivery: "ship", address: "Av. Principal 123 y Segunda", returnMethod: "store" });
  win.renderCheckout();

  const html = doc.getElementById("sheetBody").innerHTML;
  assert.ok(doc.getElementById("addr"), "el input de dirección debe seguir ahí");
  assert.doesNotMatch(html, /data-action="pickLocation"/);
  // Y el flujo continúa: el botón de pago no queda bloqueado por no haber mapa.
  assert.ok(!doc.querySelector("#sheetFoot .pay-btn").hasAttribute("disabled"));
});

test("el marco del mapa existe en el DOM pero arranca oculto", () => {
  const ov = doc.getElementById("mapOverlay");
  assert.ok(ov, "el overlay debe existir para poder abrirse sin recargar");
  assert.ok(!ov.classList.contains("show"));
});

/* ---- Una ubicación elegida llega al checkout ---- */
test("elegir un punto rellena la dirección de envío y guarda las coordenadas", () => {
  app.applyPickedLocation("ship", PUNTO);
  assert.equal(app.address, PUNTO.address);
  assertPunto(app.addressCoords, PUNTO);
  // El campo de retiro no se toca: son direcciones independientes.
  assert.equal(app.returnAddressCoords, null);
});

test("elegir un punto para el retiro no pisa la dirección de envío", () => {
  app.setCheckout({ address: "Av. Principal 123 y Segunda" });
  app.applyPickedLocation("return", PUNTO);
  assert.equal(app.returnAddress, PUNTO.address);
  assertPunto(app.returnAddressCoords, PUNTO);
  assert.equal(app.address, "Av. Principal 123 y Segunda");
});

test("sin dirección legible, el punto se guarda igual con sus coordenadas", () => {
  // La geocodificación inversa puede fallar; el reparto se guía por el punto,
  // así que un fallo de texto no puede invalidar una ubicación válida.
  app.applyPickedLocation("ship", { lat: -2.5, lng: -79.5, address: "" });
  assert.match(app.address, /-2\.50000, -79\.50000/);
  assertPunto(app.addressCoords, { lat: -2.5, lng: -79.5 });
  assert.ok(app.isValidAddress(app.address), "debe pasar la validación del checkout");
});

/* ---- El punto viaja con el pedido ---- */
test("placeOrder guarda las coordenadas del envío y del retiro", () => {
  app.cart = [{ id: 7 }];
  app.setCheckout({
    delivery: "ship", returnMethod: "home", payMethod: "cash",
    rentalStart: app.isoOffset(0), rentalEnd: app.isoOffset(3)
  });
  app.applyPickedLocation("ship", PUNTO);
  app.applyPickedLocation("return", PUNTO);
  win.placeOrder();

  const o = app.orders[0];
  assertPunto(o.shipCoords, PUNTO);
  assertPunto(o.retCoords, PUNTO);
});

test("un pedido con retiro en el local no arrastra coordenadas de retiro", () => {
  app.cart = [{ id: 7 }];
  app.setCheckout({
    delivery: "pickup", returnMethod: "store", payMethod: "cash",
    rentalStart: app.isoOffset(0), rentalEnd: app.isoOffset(3)
  });
  // Aunque quedaran de un intento anterior, no deben viajar al pedido.
  app.applyPickedLocation("ship", PUNTO);
  win.placeOrder();

  const o = app.orders[0];
  assert.equal(o.shipCoords, null);
  assert.equal(o.retCoords, null);
});

test("terminar el pedido limpia las coordenadas del checkout", () => {
  app.cart = [{ id: 7 }];
  app.setCheckout({
    delivery: "ship", returnMethod: "store", payMethod: "cash",
    rentalStart: app.isoOffset(0), rentalEnd: app.isoOffset(3)
  });
  app.applyPickedLocation("ship", PUNTO);
  win.placeOrder();
  win.finishOrder();

  assert.equal(app.addressCoords, null);
  assert.equal(app.returnAddressCoords, null);
});

/* ---- Escribir a mano invalida el punto ---- */
test("editar la dirección a mano descarta el punto del mapa", () => {
  app.applyPickedLocation("ship", PUNTO);
  assert.ok(app.addressCoords);

  // Lo que hace el listener de main.js al teclear en #addr.
  win.clearPickedLocation("ship");

  assert.equal(app.addressCoords, null,
    "el texto y las coordenadas no pueden apuntar a sitios distintos");
});

test("descartar el punto de un campo no toca el del otro", () => {
  app.applyPickedLocation("ship", PUNTO);
  app.applyPickedLocation("return", PUNTO);

  win.clearPickedLocation("ship");

  assert.equal(app.addressCoords, null);
  assert.ok(app.returnAddressCoords, "el retiro conserva su punto");
});

/* ---- Con mapa, marcar el punto es la ÚNICA vía ----
   El valor del mapa está en la coordenada; si se puede seguir escribiendo la
   dirección a mano, la mayoría lo hará y el reparto vuelve al problema que el
   mapa vino a resolver. */
test("con mapa no se ofrece campo de texto para la dirección", () => {
  const env = loadDom({ storage: { "clothToGo:mapsKey": "CLAVE-DE-PRUEBA" } });
  env.app.cart = [{ id: 7 }];
  env.app.setCheckout({ delivery: "ship", returnMethod: "store" });
  env.window.renderCheckout();

  assert.equal(env.document.getElementById("addr"), null, "no debe haber input de dirección");
  const html = env.document.getElementById("sheetBody").innerHTML;
  assert.match(html, /data-action="pickLocation"/);
  assert.match(html, /addr-empty/, "debe pedir marcar el punto");
});

test("con mapa, sin punto marcado no se puede continuar al pago", () => {
  const env = loadDom({ storage: { "clothToGo:mapsKey": "CLAVE-DE-PRUEBA" } });
  env.app.cart = [{ id: 7 }];
  // Dirección escrita pero SIN coordenadas: antes bastaba, ahora no.
  env.app.setCheckout({ delivery: "ship", address: "Av. Principal 123", returnMethod: "store" });
  env.window.renderCheckout();

  assert.equal(env.app.addressReady("Av. Principal 123", null), false);
  const btn = env.document.querySelector("#sheetFoot .pay-btn");
  assert.ok(btn.hasAttribute("disabled"));
  assert.match(btn.textContent, /Marca la ubicación de envío en el mapa/);
});

test("con el punto marcado el checkout continúa y muestra la dirección", () => {
  const env = loadDom({ storage: { "clothToGo:mapsKey": "CLAVE-DE-PRUEBA" } });
  env.app.cart = [{ id: 7 }];
  env.app.setCheckout({ delivery: "ship", returnMethod: "store" });
  env.window.applyPickedLocation("ship", PUNTO);
  env.window.renderCheckout();

  const html = env.document.getElementById("sheetBody").innerHTML;
  assert.match(html, /addr-picked/);
  assert.match(html, /Av\. 9 de Octubre 100/);
  assert.ok(!env.document.querySelector("#sheetFoot .pay-btn").hasAttribute("disabled"));
});
