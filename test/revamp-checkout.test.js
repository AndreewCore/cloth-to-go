/**
 * Pruebas del último revamp de interfaz: dónde cuelga el detalle de cada
 * opción, y qué se enseña de un punto marcado en el mapa.
 *
 * Los tres arreglos que fija este archivo:
 *
 *   1. El detalle (dirección o ficha del local) va **pegado a la opción
 *      elegida**, dentro de la lista. Colgado debajo de las dos, no se sabía a
 *      cuál pertenecía.
 *   2. El punto marcado ya no repite sus coordenadas dos veces, y cuando la
 *      geocodificación no da calle se dice con palabras en vez de enseñar
 *      "Ubicación -2.16396, -79.89318" como si fuera una dirección.
 *   3. La nota del depósito desaparece de los resúmenes: el total ya trae el
 *      "$X se te devuelve" al lado, y repetirlo debajo era decir dos veces lo
 *      mismo en una pantalla que ya iba cargada de texto.
 *
 * El SDK de Google no se carga en jsdom: se prueba el contrato de la app (qué
 * se pinta y en qué orden), no el mapa.
 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadDom } = require("./helpers/load-dom.js");

// Misma vía que el resto de pruebas de mapa: el override de localStorage es la
// única forma de tener clave sin commitear una.
const CON_MAPA = { storage: { "clothToGo:mapsKey": "CLAVE-DE-PRUEBA" } };
const COORDS = { lat: -2.16396, lng: -79.89318 };

let win, doc, app;

beforeEach(() => {
  const env = loadDom();
  win = env.window;
  doc = env.document;
  app = env.app;
});

/** Monta el checkout con un carrito y el estado que se le pase. */
function checkoutCon(estado, env) {
  const e = env ?? { win, doc, app };
  e.app.cart = [{ id: 7 }];
  e.app.setCheckout(estado);
  e.win.renderCheckout();
  return e.doc.getElementById("sheetBody").innerHTML;
}

/* ============================================================
   1. El detalle cuelga de la opción elegida
   ============================================================ */
test("la dirección de envío va DENTRO de la lista de opciones, no debajo de ambas", () => {
  const html = checkoutCon({
    delivery: "ship", address: "Av. Principal 123 y Segunda", returnMethod: "store",
  });

  const opts = doc.querySelector(".delivery-opts");
  assert.ok(opts.querySelector(".opt-detail"),
    "el detalle debe vivir dentro del grupo de opciones para que se lea como parte de una");
  assert.ok(html.includes("Dirección de envío"));
});

test("el detalle se pinta pegado a su opción y antes de la otra", () => {
  checkoutCon({ delivery: "ship", address: "Av. Principal 123 y Segunda", returnMethod: "store" });

  // Orden esperado dentro del primer grupo: [Envío] [detalle] [Retiro].
  const hijos = [...doc.querySelector(".delivery-opts").children];
  const iElegida = hijos.findIndex(h => h.classList.contains("delivery-opt") && h.classList.contains("active"));
  const iDetalle = hijos.findIndex(h => h.classList.contains("opt-detail"));

  assert.notEqual(iElegida, -1, "debe haber una opción activa");
  assert.notEqual(iDetalle, -1, "debe haber un detalle");
  assert.equal(iDetalle, iElegida + 1,
    "el detalle debe ir inmediatamente después de la opción elegida, no al final");
});

test("al elegir retiro en local, la ficha del local cuelga de ESA opción", () => {
  checkoutCon({ delivery: "pickup", returnMethod: "store" });

  const grupos = doc.querySelectorAll(".delivery-opts");
  const hijos = [...grupos[0].children];
  const iElegida = hijos.findIndex(h => h.classList.contains("delivery-opt") && h.classList.contains("active"));
  const iDetalle = hijos.findIndex(h => h.classList.contains("opt-detail"));

  assert.equal(iDetalle, iElegida + 1);
  assert.ok(hijos[iDetalle].innerHTML.includes(app.LOCAL.direccion),
    "el detalle de 'retiro en local' es la ficha del local");
});

test("la devolución sigue la misma regla: el detalle cuelga de la opción activa", () => {
  checkoutCon({
    delivery: "pickup", returnMethod: "home", returnAddress: "Av. Segunda 456 y Tercera",
  });

  const grupoDevolucion = doc.querySelectorAll(".delivery-opts")[1];
  const hijos = [...grupoDevolucion.children];
  const iElegida = hijos.findIndex(h => h.classList.contains("delivery-opt") && h.classList.contains("active"));
  const iDetalle = hijos.findIndex(h => h.classList.contains("opt-detail"));

  assert.equal(iDetalle, iElegida + 1);
  assert.ok(hijos[iDetalle].innerHTML.includes("Dirección de retiro"));
});

test("sin opción elegida no se cuela ningún detalle", () => {
  checkoutCon({ delivery: null, returnMethod: null });
  assert.equal(doc.querySelectorAll(".opt-detail").length, 0,
    "un detalle sin opción activa no pertenece a nada");
});

/* ============================================================
   2. El punto marcado no repite coordenadas
   ============================================================ */
test("el punto guardado no enseña las coordenadas dos veces", () => {
  const env = loadDom(CON_MAPA);
  checkoutCon({
    delivery: "ship",
    address: "Av. 9 de Octubre 1234, Guayaquil",
    addressCoords: COORDS,
    returnMethod: "store",
  }, { win: env.window, doc: env.document, app: env.app });

  // Se mira el TEXTO visible, no el HTML: la URL de la miniatura lleva las
  // coordenadas por necesidad, y ahí no las lee nadie.
  const visible = env.document.querySelector(".addr-picked").textContent;
  assert.ok(visible.includes("Punto exacto guardado"), "la confirmación se mantiene");
  assert.ok(!visible.includes(COORDS.lat.toFixed(5)),
    "las cifras crudas ya no se leen en la tarjeta: no le dicen nada al cliente y salían dos veces");
});

test("sin calle, una sola línea: ni coordenadas ni la misma idea dos veces", () => {
  const env = loadDom(CON_MAPA);
  // Es exactamente lo que guarda readMapCenter() cuando la geocodificación
  // inversa no responde OK — el caso NORMAL con una clave sin facturación.
  checkoutCon({
    delivery: "ship",
    address: `Ubicación ${COORDS.lat.toFixed(5)}, ${COORDS.lng.toFixed(5)}`,
    addressCoords: COORDS,
    returnMethod: "store",
  }, { win: env.window, doc: env.document, app: env.app });

  const tarjeta = env.document.querySelector(".addr-picked");
  const visible = tarjeta.textContent.trim();
  assert.ok(visible.includes("Ubicación marcada en el mapa"));
  assert.ok(!visible.includes(COORDS.lat.toFixed(5)),
    "una coordenada con formato de dirección sigue sin ser una dirección");
  assert.ok(!visible.includes("Punto exacto guardado"),
    "sin calle, 'ubicación marcada' y 'punto guardado' dicen lo mismo: sobra una");
  assert.equal(tarjeta.children.length, 1, "una sola línea, no dos apiladas");
});

test("con calle de verdad, se muestra la calle", () => {
  const env = loadDom(CON_MAPA);
  const html = checkoutCon({
    delivery: "ship",
    address: "Av. 9 de Octubre 1234, Guayaquil",
    addressCoords: COORDS,
    returnMethod: "store",
  }, { win: env.window, doc: env.document, app: env.app });

  assert.ok(html.includes("Av. 9 de Octubre 1234, Guayaquil"));
});

test("la tarjeta no pide ninguna imagen ni mapa a Google", () => {
  // Decisión de coste, no de estilo: la cuenta no tiene Maps Static API, y un
  // mapa incrustado se recrearía —y se facturaría— en cada clic del checkout,
  // porque la hoja se repinta entera con innerHTML.
  const env = loadDom(CON_MAPA);
  const html = checkoutCon({
    delivery: "ship",
    address: "Av. 9 de Octubre 1234, Guayaquil",
    addressCoords: COORDS,
    returnMethod: "store",
  }, { win: env.window, doc: env.document, app: env.app });

  assert.ok(!html.includes("staticmap"), "nada de Maps Static API: no está habilitada");
  assert.equal(env.document.querySelectorAll(".addr-picked img, .addr-picked iframe").length, 0,
    "ni imagen ni iframe: cada carga de mapa se cobra");
});

/* ============================================================
   3. La nota del depósito ya no se repite
   ============================================================ */
test("el resumen del checkout no repite lo que ya dice el total", () => {
  const html = checkoutCon({
    delivery: "ship", address: "Av. Principal 123 y Segunda", returnMethod: "store",
  });

  assert.ok(html.includes("se te devuelve"), "el total sigue diciendo cuánto vuelve");
  assert.ok(!html.includes("El depósito se devuelve al regresar las prendas"),
    "y ya no se repite debajo con otras palabras");
});

test("el carrito tampoco repite la nota, pero sí conserva el ahorro conseguido", () => {
  app.cart = [{ id: 7 }, { id: 8 }, { id: 9 }];
  win.renderCart();
  const html = doc.getElementById("sheetBody").innerHTML;

  assert.ok(!html.includes("El depósito se devuelve al regresar las prendas"));
  assert.ok(!html.includes("más barato sale cada día"),
    "el consejo genérico hablaba del modelo de precios, no de este carrito");
  // El ahorro por volumen es un número concreto de ESTE carrito y no aparece en
  // ninguna otra parte de la pantalla: por eso sobrevive al recorte.
  assert.ok(html.includes("Ahorras"), "el ahorro ya conseguido sí informa");
});
