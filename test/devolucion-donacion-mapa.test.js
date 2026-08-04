/**
 * Pruebas del arreglo v0.8.1: los cuatro sitios donde la app decía menos de lo
 * que sabía o pedía la dirección por el camino peor.
 *
 *   1. Devolver en el local no enseñaba QUÉ local (la misma pantalla sí lo
 *      enseñaba al retirar el pedido: informaba de un modo y no del otro).
 *   2. El editor del modo de devolución era un bloque dentro de la tarjeta del
 *      pedido; ahora es un pop-up.
 *   3. Ese editor y la donación pedían la dirección a mano aunque el mapa
 *      estuviera disponible, que es justo lo que el mapa vino a evitar.
 *
 * El SDK de Google no se carga en jsdom: se prueba el contrato de la app
 * (qué se pinta, qué se valida, dónde acaba el punto), no el mapa.
 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadDom } = require("./helpers/load-dom.js");

// Activa el selector por el mismo override que usa quien prueba en local: es la
// única vía de tener mapa sin commitear una clave.
const CON_MAPA = { storage: { "clothToGo:mapsKey": "CLAVE-DE-PRUEBA" } };
const PUNTO = { lat: -2.170998, lng: -79.922359, address: "Av. 9 de Octubre 100, Guayaquil" };

let win, doc, app;

beforeEach(() => {
  const env = loadDom();
  win = env.window;
  doc = env.document;
  app = env.app;
});

/** Pedido activo mínimo, devuelto en el local, para abrir el editor sobre él. */
function pedidoActivo(extra = {}) {
  return {
    id: 1001, date: app.isoOffset(0), items: [1],
    start: app.isoOffset(0), end: app.isoOffset(3),
    delivery: "pickup", ret: "store", retAddr: "", retCoords: null,
    pay: "cash", status: "pending", total: 21, points: 126,
    ...extra
  };
}

/* ============================================================
   1. La dirección del local al devolver en tienda
   ============================================================ */
test("elegir 'devolver en el local' muestra la dirección del local", () => {
  app.cart = [{ id: 7 }];
  app.setCheckout({ delivery: "ship", address: "Av. Principal 123 y Segunda", returnMethod: "store" });
  win.renderCheckout();

  const html = doc.getElementById("sheetBody").innerHTML;
  assert.ok(html.includes(app.LOCAL.direccion),
    "la dirección del local debe aparecer: aceptar ir a un sitio exige saber cuál");
  assert.ok(html.includes(app.LOCAL.horario), "y su horario, o el cliente no sabe cuándo ir");
});

test("con retiro a domicilio NO se cuela la ficha del local", () => {
  app.cart = [{ id: 7 }];
  app.setCheckout({
    delivery: "ship", address: "Av. Principal 123 y Segunda",
    returnMethod: "home", returnAddress: "Av. Segunda 456 y Tercera"
  });
  win.renderCheckout();

  // La ficha del local sale dos veces si además se retira en local; aquí la
  // entrega es a domicilio, así que no debe haber ninguna.
  const html = doc.getElementById("sheetBody").innerHTML;
  assert.ok(!html.includes(app.LOCAL.direccion),
    "nadie va al local en este pedido: su dirección solo distraería");
});

/* ============================================================
   2. El editor del modo de devolución es un pop-up
   ============================================================ */
test("el pop-up existe en el DOM y arranca cerrado", () => {
  const ov = doc.getElementById("retOverlay");
  assert.ok(ov, "debe existir para poder abrirse sin recargar");
  assert.ok(!ov.classList.contains("show"));
  assert.equal(app.retEditorOpen, false);
});

test("abrir el editor levanta el pop-up y NO mete nada en la tarjeta del pedido", () => {
  app.orders = [pedidoActivo()];
  app.openReturnEditor(0);

  assert.equal(app.retEditorOpen, true, "el pop-up debe estar visible");
  assert.match(app.retEditorHTML, /data-action="pickReturn"/);

  // La regresión que motivó el cambio: el editor crecía dentro de la tarjeta y
  // empujaba la lista, así que se abría fuera de la vista.
  win.renderProfile();
  assert.ok(!doc.getElementById("sheetBody").innerHTML.includes("ret-editor"),
    "el editor no debe volver a vivir dentro del panel");
});

test("el editor arranca con lo que el pedido ya tenía", () => {
  app.orders = [pedidoActivo({ ret: "home", retAddr: "Av. Segunda 456", retCoords: { lat: -2.1, lng: -79.9 } })];
  app.openReturnEditor(0);

  assert.equal(app.editRet, "home");
  assert.equal(app.editRetAddr, "Av. Segunda 456");
  assert.equal(app.editRetCoords.lat, -2.1, "el punto guardado se recupera para poder editarlo");
});

test("cancelar cierra el pop-up y no toca el pedido", () => {
  app.orders = [pedidoActivo()];
  app.openReturnEditor(0);
  app.setReturnEdit({ editRet: "home", editRetAddr: "Av. Segunda 456 y Tercera" });
  app.closeReturnEditor();

  assert.equal(app.retEditorOpen, false);
  assert.equal(app.editingOrder, null);
  assert.equal(app.orders[0].ret, "store", "cancelar no guarda");
});

test("cerrar el panel baja también el pop-up", () => {
  app.orders = [pedidoActivo()];
  app.openReturnEditor(0);
  app.closeSheet();
  assert.equal(app.retEditorOpen, false,
    "si no, quedaría flotando sobre el catálogo editando un pedido que ya no se ve");
});

test("anular el pedido en edición cierra su pop-up", () => {
  // Un editor abierto sobre un pedido que desaparece de la lista queda huérfano:
  // guarda un ÍNDICE, que tras la anulación puede apuntar a otro pedido.
  app.orders = [pedidoActivo({ start: app.isoOffset(2), end: app.isoOffset(5) })];
  app.openReturnEditor(0);
  win.cancelOrder(0);
  app.confirmModalOk();

  assert.equal(app.retEditorOpen, false);
  assert.equal(app.editingOrder, null);
});

test("el pop-up del local muestra la dirección, igual que el checkout", () => {
  app.orders = [pedidoActivo()];
  app.openReturnEditor(0);
  assert.ok(app.retEditorHTML.includes(app.LOCAL.direccion));
});

/* ============================================================
   3. El editor usa el mapa cuando lo hay
   ============================================================ */
test("con mapa, el editor ofrece el selector en vez del campo de texto", () => {
  const env = loadDom(CON_MAPA);
  env.app.orders = [pedidoActivo()];
  env.app.openReturnEditor(0);
  env.app.setReturnEdit({ editRet: "home" });
  env.app.renderReturnEditor();

  const html = env.app.retEditorHTML;
  assert.match(html, /data-action="pickLocation"/, "debe ofrecer el mapa");
  assert.match(html, /data-target="orderRet"/, "y devolver el punto a este campo, no al del checkout");
  assert.ok(!html.includes('id="editRetAddr"'),
    "con mapa no se ofrece escribir a mano: es la vía que el mapa vino a cerrar");
});

test("sin mapa, el editor mantiene el campo de texto de siempre", () => {
  app.orders = [pedidoActivo()];
  app.openReturnEditor(0);
  app.setReturnEdit({ editRet: "home" });
  app.renderReturnEditor();

  assert.ok(app.retEditorHTML.includes('id="editRetAddr"'),
    "sin mapa el texto es la única vía: bloquearlo rompería la demo por file://");
  assert.doesNotMatch(app.retEditorHTML, /data-action="pickLocation"/);
});

test("el punto elegido en el mapa aterriza en el editor, no en el checkout", () => {
  const env = loadDom(CON_MAPA);
  env.app.orders = [pedidoActivo()];
  env.app.openReturnEditor(0);
  env.app.setReturnEdit({ editRet: "home" });
  env.app.applyPickedLocation("orderRet", PUNTO);

  assert.equal(env.app.editRetAddr, PUNTO.address);
  assert.equal(env.app.editRetCoords.lat, PUNTO.lat);
  assert.equal(env.app.returnAddressCoords, null, "el retiro del checkout es otro campo");
});

test("con mapa, guardar sin marcar el punto no cambia el pedido", () => {
  const env = loadDom(CON_MAPA);
  env.app.orders = [pedidoActivo()];
  env.app.openReturnEditor(0);
  // Texto sí, punto no: es exactamente lo que el checkout rechaza, y este
  // editor aceptaba antes por validar con isValidAddress().
  env.app.setReturnEdit({ editRet: "home", editRetAddr: "Av. Segunda 456 y Tercera", editRetCoords: null });
  env.app.saveReturn(0);

  assert.equal(env.app.orders[0].ret, "store", "no debe guardarse");
  assert.equal(env.app.retEditorOpen, true, "el pop-up sigue abierto para corregir");
});

test("guardar con el punto marcado lo escribe en el pedido y recalcula el total", () => {
  const env = loadDom(CON_MAPA);
  const pedido = pedidoActivo();
  env.app.orders = [pedido];
  const totalPrevio = pedido.total;

  env.app.openReturnEditor(0);
  env.app.setReturnEdit({ editRet: "home" });
  env.app.applyPickedLocation("orderRet", PUNTO);
  env.app.saveReturn(0);
  env.app.confirmModalOk();          // cambiar de método pide confirmar el cargo

  const o = env.app.orders[0];
  assert.equal(o.ret, "home");
  assert.equal(o.retAddr, PUNTO.address);
  assert.equal(o.retCoords.lat, PUNTO.lat, "el punto viaja con la dirección");
  assert.equal(o.total, totalPrevio + env.app.SHIPPING_FEE);
  assert.equal(env.app.retEditorOpen, false, "guardar cierra el pop-up");
});

test("volver al local borra el punto de retiro del pedido", () => {
  const env = loadDom(CON_MAPA);
  env.app.orders = [pedidoActivo({ ret: "home", retAddr: PUNTO.address, retCoords: { lat: PUNTO.lat, lng: PUNTO.lng } })];
  env.app.openReturnEditor(0);
  env.app.setReturnEdit({ editRet: "store" });
  env.app.saveReturn(0);
  env.app.confirmModalOk();

  const o = env.app.orders[0];
  assert.equal(o.retAddr, "", "ya no vamos a ninguna dirección");
  assert.equal(o.retCoords, null, "un punto huérfano mandaría el retiro a la casa de siempre");
});

/* ============================================================
   4. La donación usa el mapa
   ============================================================ */
test("con mapa, la donación a domicilio ofrece el selector", () => {
  const env = loadDom(CON_MAPA);
  env.app.setDonation({ donName: "Abrigo, jeans y camisa", donMethod: "home" });
  env.app.view = "donate";
  env.app.renderSheet();

  const html = env.document.getElementById("sheetBody").innerHTML;
  assert.match(html, /data-action="pickLocation"/);
  assert.match(html, /data-target="donate"/, "el punto debe volver al campo de la donación");
  assert.ok(!html.includes('id="donAddr"'), "con mapa no se escribe a mano");
});

test("sin mapa, la donación conserva su campo de texto", () => {
  app.setDonation({ donName: "Abrigo, jeans y camisa", donMethod: "home" });
  app.view = "donate";
  app.renderSheet();
  assert.ok(doc.getElementById("donAddr"), "sin mapa el texto es la única vía");
});

test("con mapa, la donación no se envía sin punto marcado", () => {
  const env = loadDom(CON_MAPA);
  env.app.setDonation({
    donName: "Abrigo, jeans y camisa", donMethod: "home",
    donAddr: "Av. Segunda 456 y Tercera", donCoords: null, donDate: env.app.isoOffset(2)
  });
  assert.equal(env.app.donateValid(), false, "sin punto no hay puerta a la que llegar");

  env.app.applyPickedLocation("donate", PUNTO);
  assert.equal(env.app.donateValid(), true);
});

test("la donación guarda el punto junto a la dirección", () => {
  const env = loadDom(CON_MAPA);
  env.app.setDonation({ donName: "Abrigo, jeans y camisa", donMethod: "home", donDate: env.app.isoOffset(2) });
  env.app.applyPickedLocation("donate", PUNTO);
  env.app.submitDonation();

  const don = env.app.profile.donations[0];
  assert.equal(don.addr, PUNTO.address);
  assert.equal(don.coords.lat, PUNTO.lat);
  assert.equal(env.app.donCoords, null, "el formulario queda limpio para la siguiente");
});

test("donar en el local no arrastra dirección ni punto", () => {
  const env = loadDom(CON_MAPA);
  env.app.setDonation({ donName: "Abrigo, jeans y camisa", donMethod: "home" });
  env.app.applyPickedLocation("donate", PUNTO);
  // El usuario se arrepiente y decide llevarla él al local.
  env.app.setDonation({ donMethod: "store" });
  env.app.submitDonation();

  const don = env.app.profile.donations[0];
  assert.equal(don.addr, "");
  assert.equal(don.coords, null, "guardar un punto que nadie va a visitar confundiría al retiro");
});

/* ============================================================
   5. La tabla de campos de dirección (el registro de maps.js)
   ============================================================ */
test("cada campo de dirección conoce su input y su par de variables", () => {
  for(const clave of ["ship", "return", "orderRet", "donate"]){
    const campo = app.addressField(clave);
    assert.ok(campo, `${clave} debe estar registrado`);
    assert.equal(typeof campo.set, "function");
    assert.equal(app.addressFieldByInput(campo.inputId)[0], clave,
      "el id del input debe resolver de vuelta a su campo (lo usa la delegación de main.js)");
  }
});

test("una clave desconocida no rompe nada", () => {
  // Sin esta guarda, un data-target mal escrito reventaba a mitad de confirmar
  // la ubicación en vez de simplemente no hacer nada.
  assert.equal(app.addressField("noExiste"), null);
  assert.doesNotThrow(() => app.applyPickedLocation("noExiste", PUNTO));
  assert.doesNotThrow(() => app.clearPickedLocation("noExiste"));
});

test("escribir a mano invalida el punto en todos los campos, no solo en el checkout", () => {
  app.applyPickedLocation("orderRet", PUNTO);
  assert.ok(app.editRetCoords);
  app.clearPickedLocation("orderRet");
  assert.equal(app.editRetCoords, null, "texto y coordenadas no pueden apuntar a sitios distintos");
  assert.equal(app.editRetAddr, PUNTO.address, "pero el texto escrito se respeta");

  app.applyPickedLocation("donate", PUNTO);
  app.clearPickedLocation("donate");
  assert.equal(app.donCoords, null);
});
