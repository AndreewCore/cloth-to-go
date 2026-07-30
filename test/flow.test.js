/**
 * Pruebas de FLUJO sobre un DOM real (jsdom): confirmación de pedido, la regla
 * de puntos (se acreditan al ENTREGAR, no al cobrar), anulación de pedidos, el
 * vaciado del carrito en placeOrder, estados de botones y el escape anti-XSS.
 * Cargan la app con test/helpers/load-dom.js.
 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadDom } = require("./helpers/load-dom.js");

let win, doc, app;

// DOM y estado nuevos por test: cada uno arranca con la app recién cargada.
beforeEach(() => {
  const env = loadDom();
  win = env.window;
  doc = env.document;
  app = env.app;
});

// Deja el checkout listo para pagar; el pago se elige por parámetro.
function readyCheckout(pay) {
  app.setCheckout({
    delivery: "pickup",
    returnMethod: "store",
    payMethod: pay,
    card: pay === "cash"
      ? { number: "", name: "", expiry: "", cvv: "" }
      : { number: "4111111111111111", name: "Ana Ruiz", expiry: "12/30", cvv: "123" },
    rentalStart: app.isoOffset(0),
    rentalEnd: app.isoOffset(3)
  });
  app.cart = [{ id: 7 }]; // Esmoquin, 3 días
}

/* ---- placeOrder: tarjeta ---- */
test("placeOrder con tarjeta: pedido settled, puntos reservados y carrito vacío", () => {
  readyCheckout("credit");
  const expectedPts = app.orderPoints(); // se calcula con el carrito aún lleno
  win.placeOrder();

  assert.equal(app.orders.length, 1);
  const o = app.orders[0];
  assert.equal(o.status, "settled");
  assert.equal(o.points, expectedPts);
  // El pedido empieza HOY, así que todavía se puede anular: mientras eso sea
  // cierto los puntos quedan reservados y no entran al saldo gastable.
  assert.ok(win.canCancelOrder(o));
  assert.ok(!o.pointsCredited);
  assert.equal(app.profile.points, 0);
  assert.equal(app.cart.length, 0);              // carrito vaciado en placeOrder
  assert.equal(app.view, "done");
  // La confirmación se pinta desde el pedido (no del carrito, ya vacío).
  assert.match(doc.getElementById("sheetBody").innerHTML, /Ganarás/);
});

/* ---- placeOrder: efectivo ---- */
test("efectivo ya firme: acredita puntos aunque el cobro siga pendiente", () => {
  readyCheckout("cash");
  // Alquiler empezado ayer: entregado y ya no anulable → puntos definitivos.
  app.setCheckout({ rentalStart: app.isoOffset(-1), rentalEnd: app.isoOffset(3) });
  win.placeOrder();

  const o = app.orders[0];
  assert.equal(o.status, "pending");        // el cobro sigue pendiente…
  assert.ok(o.pointsCredited);              // …pero el alquiler ya es firme
  assert.equal(app.profile.points, o.points);
  assert.match(doc.getElementById("sheetBody").innerHTML, /Ganaste/);
});

test("pedido que empieza más adelante: los puntos quedan reservados", () => {
  readyCheckout("credit");                  // pagado, pero aún no entregado
  app.setCheckout({ rentalStart: app.isoOffset(2), rentalEnd: app.isoOffset(5) });
  win.placeOrder();

  const o = app.orders[0];
  assert.equal(o.status, "settled");
  assert.ok(!o.pointsCredited);             // pagar no acredita: entregar sí
  assert.ok(o.points > 0);
  assert.equal(app.profile.points, 0);
  assert.match(doc.getElementById("sheetBody").innerHTML, /Ganarás/);
});

test("los puntos reservados se acreditan cuando el pedido deja de ser anulable", () => {
  readyCheckout("cash");
  app.setCheckout({ rentalStart: app.isoOffset(2), rentalEnd: app.isoOffset(5) });
  win.placeOrder();
  const o = app.orders[0];
  assert.equal(app.profile.points, 0);

  // Llegó el día de inicio: entregado, pero aún anulable → siguen reservados.
  o.start = app.isoOffset(0);
  assert.ok(win.isDelivered(o) && win.canCancelOrder(o));
  assert.equal(win.creditDeliveredPoints(), 0);
  assert.equal(app.profile.points, 0);

  // Pasado el día de inicio ya no hay vuelta atrás: ahí sí se acreditan.
  o.start = app.isoOffset(-1);
  assert.equal(win.creditDeliveredPoints(), o.points);
  assert.equal(app.profile.points, o.points);
  assert.equal(win.creditDeliveredPoints(), 0);   // no vuelve a acreditar
});

/* ---- Vaciado del carrito ---- */
test("tras confirmar, el carrito queda vacío: no permite repedir lo mismo", () => {
  readyCheckout("credit");
  win.placeOrder();
  win.renderCart();
  assert.match(doc.getElementById("sheetBody").innerHTML, /carrito está vacío/);
});

/* ---- El cliente NO puede confirmar su propio pago ---- */
test("un pedido en efectivo no expone acción de auto-confirmación al cliente", () => {
  readyCheckout("cash");
  win.placeOrder();
  win.renderProfile();
  const html = doc.getElementById("sheetBody").innerHTML;
  // No hay ningún control para que el cliente marque su pago como cobrado.
  assert.equal(doc.querySelectorAll('[data-action="confirmPayment"]').length, 0);
  assert.doesNotMatch(html, /Confirmar pago/);
  assert.equal(app.orders[0].status, "pending");
});

/* ---- Confirmación rediseñada: sin desglose + acceso a "Mis pedidos" ---- */
test("renderDone no desglosa la compra e integra el ahorro de agua", () => {
  readyCheckout("credit");
  win.placeOrder();
  const html = doc.getElementById("sheetBody").innerHTML;
  assert.match(html, /data-action="goToOrders"/);       // botón "Ver mis pedidos"
  assert.doesNotMatch(html, /Depósito reembolsable/);    // no se desglosa el pedido
  assert.doesNotMatch(html, /📅 Período/);
  assert.match(html, /litros<\/b> de agua/);             // agua integrada (ya no es pop-up)
});

test("no queda pop-up de agua en el DOM (se integró en la confirmación)", () => {
  assert.equal(doc.getElementById("waterPop"), null);
});

test("goToOrders abre el perfil en la sección de pedidos y limpia el checkout", () => {
  readyCheckout("cash");
  win.placeOrder();
  assert.equal(app.view, "done");

  win.goToOrders();
  assert.equal(app.view, "profile");
  assert.equal(app.lastOrder, null);   // estado de checkout restablecido
  assert.equal(app.payMethod, null);
  const body = doc.getElementById("sheetBody");
  assert.ok(body.querySelector("#misPedidos"));        // destino del scroll
  assert.match(body.innerHTML, /Pedido #/);            // el pedido aparece como activo
});

// Regresión: scrollIntoView() desplazaba TODOS los ancestros (incluido el marco
// .phone, que aun con overflow:hidden se puede desplazar por código), dejando el
// encabezado cortado y el panel asomando abajo. El scroll debe quedarse dentro
// del cuerpo del panel.
test("goToOrders solo desplaza el cuerpo del panel, nunca sus ancestros", () => {
  const intoView = [];
  win.Element.prototype.scrollIntoView = function () { intoView.push(this); };
  const body = doc.getElementById("sheetBody");
  const scrolled = [];
  body.scrollTo = opts => scrolled.push(opts);

  readyCheckout("cash");
  win.placeOrder();
  win.goToOrders();

  assert.equal(intoView.length, 0);                    // nadie desplaza ancestros
  assert.equal(scrolled.length, 1);                    // solo el .sheet-body
  assert.ok(scrolled[0].top >= 0);
});

/* ---- Estados de botón ---- */
test("botón de pago: deshabilitado sin datos de tarjeta, habilitado al completarlos", () => {
  app.cart = [{ id: 7 }];
  app.setCheckout({ delivery: "pickup", returnMethod: "store", payMethod: "credit",
    card: { number: "", name: "", expiry: "", cvv: "" } });
  win.renderPayment();
  let btn = doc.querySelector("#sheetFoot .pay-btn");
  // Robusto: chequeamos el estado (disabled) y la acción, no el texto exacto.
  assert.ok(btn.hasAttribute("disabled"));
  assert.equal(btn.dataset.action, "confirmOrder");

  app.setCheckout({ card: { number: "4111111111111111", name: "Ana", expiry: "12/30", cvv: "123" } });
  win.renderPayment();
  btn = doc.querySelector("#sheetFoot .pay-btn");
  assert.ok(!btn.hasAttribute("disabled")); // datos completos → habilitado
  assert.equal(btn.dataset.action, "confirmOrder");
});

test("botón de entrega: deshabilitado sin elegir método de recepción", () => {
  app.cart = [{ id: 7 }];
  app.setCheckout({ delivery: null, returnMethod: null });
  win.renderCheckout();
  const btn = doc.querySelector("#sheetFoot .pay-btn");
  assert.ok(btn.hasAttribute("disabled")); // sin método de entrega → bloqueado
  assert.equal(btn.dataset.action, "toPayment");
});

/* ---- XSS en la vista real ---- */
test("XSS: un nombre de perfil malicioso se escapa en el HTML renderizado", () => {
  app.profile = Object.assign(app.profile, { name: `<img src=x onerror="alert(1)">` });
  win.renderProfile();
  const html = doc.getElementById("sheetBody").innerHTML;
  assert.match(html, /&lt;img/);              // quedó escapado como texto
  assert.doesNotMatch(html, /<img src=x onerror/); // no se coló el atributo ejecutable
  // Y no se inyectó un nodo <img> con ese handler.
  assert.equal(doc.querySelectorAll('img[onerror="alert(1)"]').length, 0);
});

/* ---- Mensaje de error de validación ---- */
test("saveProfile con correo inválido muestra el error y no guarda", () => {
  win.editProfile(); // entra en modo edición → renderiza el formulario
  doc.getElementById("pfName").value = "Ana Ruiz";
  doc.getElementById("pfEmail").value = "correo-invalido";
  doc.getElementById("pfPhone").value = "0991234567";
  win.saveProfile();

  const err = doc.getElementById("errEmail");
  assert.notEqual(err.style.display, "none"); // visible
  assert.match(err.textContent, /correo válido/);
  assert.equal(app.profile.email, ""); // no persistió el correo inválido
});

/* ---- Stock del catálogo: la prenda alquilada desaparece ---- */
test("tras alquilar, la prenda sale del catálogo (prenda única)", () => {
  win.renderGrid();
  const grid = doc.getElementById("grid");
  assert.match(grid.innerHTML, /Esmoquin clásico/);        // id 7, visible al inicio
  const antes = win.filteredProducts().length;

  readyCheckout("cash");
  win.placeOrder();

  assert.doesNotMatch(grid.innerHTML, /Esmoquin clásico/); // ya alquilada
  assert.ok(!win.filteredProducts().some(p => p.id === 7));
  assert.equal(win.filteredProducts().length, antes - 1);  // el conteo baja en una
  assert.match(doc.getElementById("resultsBar").innerHTML, new RegExp(`>${antes - 1} prendas<`));
});

test("la prenda vuelve al catálogo cuando el pedido se archiva (devuelta y pagada)", () => {
  readyCheckout("cash");
  win.placeOrder();
  const o = app.orders[0];

  o.status = "settled";            // el negocio registró el cobro…
  o.end = app.isoOffset(-1);       // …y el período ya terminó → archivado
  win.renderGrid();

  assert.match(doc.getElementById("grid").innerHTML, /Esmoquin clásico/);
});

test("el detalle de una prenda alquilada no ofrece agregarla al carrito", () => {
  readyCheckout("cash");
  win.placeOrder();

  win.openDetail(7);
  assert.match(doc.getElementById("sheetBody").innerHTML, /Alquilada ahora mismo/);
  const btn = doc.querySelector("#sheetFoot .pay-btn");
  assert.equal(btn.dataset.action, "goProfile");   // no "addDetail"
});

test("addToCart ignora una prenda ya alquilada", () => {
  readyCheckout("cash");
  win.placeOrder();
  assert.equal(app.cart.length, 0);

  win.addToCart(7);
  assert.equal(app.cart.length, 0);                // no se puede volver a alquilar
});

/* ---- Anular un pedido ---- */
// Deja un pedido confirmado y devuelve su índice; `start` permite simular uno ya
// entregado (fecha de inicio pasada).
function placedOrder(start) {
  readyCheckout("cash");
  if (start) app.setCheckout({ rentalStart: start });
  win.placeOrder();
  return app.orders.length - 1;
}

test("anular un pedido devuelve sus prendas al catálogo", () => {
  win.renderGrid();
  const grid = doc.getElementById("grid");
  const i = placedOrder();
  assert.ok(!win.filteredProducts().some(p => p.id === 7));   // fuera del catálogo

  win.cancelOrder(i);
  app.confirmModalOk();                                        // el usuario confirma

  assert.equal(app.orders[i].status, "cancelled");
  assert.ok(win.filteredProducts().some(p => p.id === 7));      // volvió
  assert.match(grid.innerHTML, /Esmoquin clásico/);             // y ya está pintado
  assert.equal(app.cart.length, 0);                             // no se rearma el carrito
});

test("el diálogo resume pedido, prendas y período, sin explicaciones de logística", () => {
  const i = placedOrder();
  win.cancelOrder(i);
  const html = app.modalHTML;
  assert.match(html, /¿Anular este pedido\?/);
  assert.match(html, /#\d{4}/);                     // número de pedido
  assert.match(html, /Esmoquin clásico/);           // la prenda
  assert.match(html, /\d+ días/);                   // el período
  // El estado del envío no se le pregunta al cliente: si el botón existe,
  // el pedido todavía no salió.
  assert.doesNotMatch(html, /reparto|en camino|retiraste/i);
  app.confirmModalOk();
});

test("un efectivo pendiente no promete reembolso: no se ha cobrado nada", () => {
  const i = placedOrder();
  win.cancelOrder(i);
  assert.doesNotMatch(app.modalHTML, /Reembolso|devolverá/i);
  app.confirmModalOk();
});

test("un pedido ya cobrado muestra el monto a reembolsar", () => {
  readyCheckout("credit");                 // tarjeta → cobrado
  win.placeOrder();
  const total = app.orders[0].total.toFixed(2);
  win.cancelOrder(0);
  assert.match(app.modalHTML, /Reembolso a tu tarjeta/);
  assert.match(app.modalHTML, new RegExp(`\\$${total.replace(".", "\\.")}`));
});

test("sin confirmar el diálogo, el pedido sigue vigente", () => {
  const i = placedOrder();
  win.cancelOrder(i);                 // se abre el modal y no se acepta
  assert.equal(app.orders[i].status, "pending");
  assert.ok(!win.filteredProducts().some(p => p.id === 7));
});

test("la opción de anular desaparece si el alquiler ya está con el cliente", () => {
  placedOrder(app.isoOffset(-1));     // empezó ayer → entregado
  win.renderProfile();
  assert.equal(doc.querySelectorAll('[data-action="cancelOrder"]').length, 0);
});

test("la opción de anular desaparece cuando el pedido ya terminó", () => {
  const i = placedOrder();
  const o = app.orders[i];
  o.status = "settled";
  o.start = app.isoOffset(-5);
  o.end = app.isoOffset(-1);          // pagado y vencido → archivado
  win.renderProfile();
  assert.equal(doc.querySelectorAll('[data-action="cancelOrder"]').length, 0);
});

test("un pedido anulable nunca tiene puntos acreditados que revertir", () => {
  readyCheckout("credit");            // tarjeta → settled, pero empieza hoy
  win.placeOrder();
  const o = app.orders[0];
  // La invariante que cierra el agujero: acreditado ⟹ ya no anulable. Mientras
  // se pueda anular, esos puntos no existen en el saldo y no hay nada que canjear.
  assert.ok(!o.pointsCredited);
  assert.equal(app.profile.points, 0);

  win.cancelOrder(0);
  app.confirmModalOk();

  assert.equal(app.profile.points, 0);
  assert.ok(!app.orders[0].pointsCredited);
});

test("un pedido anulado se lista en el historial, no entre los activos", () => {
  const i = placedOrder();
  win.cancelOrder(i);
  app.confirmModalOk();
  win.renderProfile();
  const html = doc.getElementById("sheetBody").innerHTML;
  assert.match(html, /No tienes pedidos activos/);   // ya no está entre los vigentes
  assert.match(html, /Alquileres anteriores/);
  assert.match(html, /Anulado/);
});

test("anular un pedido descuenta sus litros de agua ahorrada", () => {
  const i = placedOrder();
  const conPedido = win.totalWaterSaved();
  assert.ok(conPedido > 0);

  win.cancelOrder(i);
  app.confirmModalOk();

  // El alquiler no llegó a ocurrir: no reutilizó ropa ni ahorró agua.
  assert.equal(win.totalWaterSaved(), 0);
  assert.match(doc.getElementById("sheetBody").innerHTML, /Agua ahorrada/);
});

test("la tarjeta del pedido muestra el depósito reembolsable junto al total", () => {
  const i = placedOrder();
  win.renderProfile();
  const dep = app.orderDeposit(app.orders[i]).toFixed(2);
  const html = doc.getElementById("sheetBody").innerHTML;
  // Se afirma el importe y su leyenda, no el icono que los precede: el set de
  // iconos puede cambiar sin que cambie lo que la tarjeta comunica.
  assert.match(html, new RegExp(`\\$${dep.replace(".", "\\.")} se te devuelve`));
});
