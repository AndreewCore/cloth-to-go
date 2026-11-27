/**
 * Pruebas de FLUJO sobre un DOM real (jsdom): confirmación de pedido, la regla
 * de puntos (se acreditan al ENTREGAR, no al cobrar), anulación de pedidos, el
 * vaciado del carrito en placeOrder, estados de botones y el escape anti-XSS.
 * Cargan la app con test/helpers/load-dom.js.
 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadDom } = require("./helpers/load-dom.js");
const { ITEM_BASE } = require("./helpers/fake-api.js");

let win, doc, app, flush, fake;

// DOM y estado nuevos por test: cada uno arranca con la app recién cargada.
beforeEach(() => {
  const env = loadDom();
  win = env.window;
  doc = env.document;
  app = env.app;
  flush = env.flush;
  fake = env.fake;
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
  return app.requestQuote();   // los importes los pone el servidor (fase 3)
}

/* ---- placeOrder: tarjeta ---- */
test("placeOrder con tarjeta: pedido settled, puntos reservados y carrito vacío", async () => {
  await readyCheckout("credit");
  const expectedPts = app.orderPoints(); // se calcula con el carrito aún lleno
  await win.placeOrder();

  assert.equal(app.orders.length, 1);
  const o = app.orders[0];
  assert.equal(o.status, "settled");
  assert.equal(o.points, expectedPts);
  // El pedido empieza HOY, así que todavía se puede anular: mientras eso sea
  // cierto los puntos quedan reservados y no entran al saldo gastable.
  assert.ok(win.canCancelOrder(o));
  assert.ok(!o.pointsCredited);
  assert.equal(app.profile.points, app.waterPointsCredited());
  assert.equal(app.cart.length, 0);              // carrito vaciado en placeOrder
  assert.equal(app.view, "done");
  // La confirmación se pinta desde el pedido (no del carrito, ya vacío).
  assert.match(doc.getElementById("sheetBody").innerHTML, /Ganarás/);
});

/* ---- placeOrder: lo que viaja y lo que se pinta ---- */
test("placeOrder manda ejemplares, fechas y modos, y ningún importe", async () => {
  await readyCheckout("cash");
  await win.placeOrder();
  const post = fake.calls.find(c => c.method === "POST" && c.path === "/api/orders");
  assert.ok(post, "el pedido se crea en la API");
  assert.deepEqual(Object.keys(post.body).sort(),
    ["delivery", "end", "items", "pay", "ret", "start"].sort());
  assert.deepEqual([...post.body.items], [ITEM_BASE + 7], "ids de EJEMPLAR, no de modelo");
});

test("efectivo: la confirmación pinta lo que respondió el servidor", async () => {
  await readyCheckout("cash");
  await win.placeOrder();
  const o = app.orders[0];
  const guardado = fake.state.orders[0];
  assert.equal(o.id, guardado.id, "el número es el de la base, no uno inventado aquí");
  assert.equal(o.status, "pending");
  assert.equal(o.total, guardado.totalCents / 100);
  assert.equal(o.returnBy, guardado.returnBy);
  assert.match(doc.getElementById("sheetBody").innerHTML, /Ganarás/);
});

test("los puntos y el saldo llegan del servidor, no se acreditan aquí", async () => {
  // El servidor decide cuándo un pedido ya ganó sus puntos; la app solo los
  // adopta al sincronizar la cuenta.
  fake.state.orders.push({ id: 1999, createdAt: new Date().toISOString(), items: [3], itemIds: [5003],
    start: app.isoOffset(-2), end: app.isoOffset(1), returnBy: app.isoOffset(1), delivery: "pickup", deliveredAt: new Date().toISOString(),
    ret: "store", pay: "cash", status: "pending", cancelledAt: null, couponId: null, discountCents: 0,
    points: 42, totalCents: 1000, depositHeldCents: 500, charges: [] });
  assert.ok(await app.syncAccount());
  assert.equal(app.profile.points, 42);
  assert.ok(app.orders[0].pointsCredited);
});

test("un error del servidor no crea nada y deja el carrito intacto", async () => {
  await readyCheckout("cash");
  fake.failNext = { status: 409, error: "Alguna de las prendas ya está reservada para esas fechas." };
  assert.equal(await win.placeOrder(), false);
  assert.equal(app.orders.length, 0);
  assert.equal(app.cart.length, 1);
  assert.match(doc.getElementById("toast").textContent, /reservada/);
});

test("sin sesión no se alquila: se pide iniciarla y el carrito se conserva", async () => {
  await readyCheckout("cash");
  app.currentUser = null;
  assert.equal(await win.placeOrder(), false);
  assert.match(app.modalHTML, /Inicia sesión para alquilar/);
  app.confirmModalOk(); await flush();
  assert.equal(app.pendingRental.cart.length, 1);
  assert.equal(fake.calls.filter(c => c.path === "/api/orders").length, 0);
});

/* ---- Vaciado del carrito ---- */
test("tras confirmar, el carrito queda vacío: no permite repedir lo mismo", async () => {
  await readyCheckout("credit");
  await win.placeOrder();
  win.renderCart();
  assert.match(doc.getElementById("sheetBody").innerHTML, /carrito está vacío/);
});

/* ---- El cliente NO puede confirmar su propio pago ---- */
test("un pedido en efectivo no expone acción de auto-confirmación al cliente", async () => {
  await readyCheckout("cash");
  await win.placeOrder();
  win.renderProfile();
  const html = doc.getElementById("sheetBody").innerHTML;
  // No hay ningún control para que el cliente marque su pago como cobrado.
  assert.equal(doc.querySelectorAll('[data-action="confirmPayment"]').length, 0);
  assert.doesNotMatch(html, /Confirmar pago/);
  assert.equal(app.orders[0].status, "pending");
});

/* ---- Confirmación rediseñada: sin desglose + acceso a "Mis pedidos" ---- */
test("renderDone no desglosa la compra e integra el ahorro de agua", async () => {
  await readyCheckout("credit");
  await win.placeOrder();
  const html = doc.getElementById("sheetBody").innerHTML;
  assert.match(html, /data-action="goToOrders"/);       // botón "Ver mis pedidos"
  assert.doesNotMatch(html, /Depósito reembolsable/);    // no se desglosa el pedido
  assert.doesNotMatch(html, /📅 Período/);
  assert.match(html, /litros<\/b> de agua/);             // agua integrada (ya no es pop-up)
});

test("no queda pop-up de agua en el DOM (se integró en la confirmación)", () => {
  assert.equal(doc.getElementById("waterPop"), null);
});

test("goToOrders abre el perfil en la sección de pedidos y limpia el checkout", async () => {
  await readyCheckout("cash");
  await win.placeOrder();
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
test("goToOrders solo desplaza el cuerpo del panel, nunca sus ancestros", async () => {
  const intoView = [];
  win.Element.prototype.scrollIntoView = function () { intoView.push(this); };
  const body = doc.getElementById("sheetBody");
  const scrolled = [];
  body.scrollTo = opts => scrolled.push(opts);

  await readyCheckout("cash");
  await win.placeOrder();
  win.goToOrders();

  assert.equal(intoView.length, 0);                    // nadie desplaza ancestros
  assert.equal(scrolled.length, 1);                    // solo el .sheet-body
  assert.ok(scrolled[0].top >= 0);
});

/* ---- Estados de botón ---- */
test("botón de pago: deshabilitado sin datos de tarjeta, habilitado al completarlos", async () => {
  app.cart = [{ id: 7 }];
  app.setCheckout({ delivery: "pickup", returnMethod: "store", payMethod: "credit",
    card: { number: "", name: "", expiry: "", cvv: "" } });
  win.renderPayment();
  // Sin cotización todavía, el botón espera aunque la tarjeta esté completa.
  assert.match(doc.querySelector("#sheetFoot .pay-btn").textContent, /Completa los datos|Calculando/);
  await app.requestQuote();
  win.renderPayment();
  let btn = doc.querySelector("#sheetFoot .pay-btn");
  // Robusto: chequeamos el estado (disabled) y la acción, no el texto exacto.
  assert.ok(btn.hasAttribute("disabled"));
  assert.equal(btn.dataset.action, "confirmOrder");

  app.setCheckout({ card: { number: "4111111111111111", name: "Ana", expiry: "12/30", cvv: "123" } });
  win.renderPayment();
  btn = doc.querySelector("#sheetFoot .pay-btn");
  assert.ok(!btn.hasAttribute("disabled")); // datos completos y cotizado → habilitado
  assert.equal(btn.dataset.action, "confirmOrder");
});

test("sin cotización vigente no se puede confirmar: el botón dice que está calculando", () => {
  app.cart = [{ id: 7 }];
  app.setCheckout({ delivery: "pickup", returnMethod: "store", payMethod: "cash" });
  app.setCheckout({ rentalEnd: app.isoOffset(9) });   // la cotización que hubiera ya no vale
  win.renderPayment();
  const btn = doc.querySelector("#sheetFoot .pay-btn");
  assert.ok(btn.hasAttribute("disabled"));
  assert.match(btn.textContent, /Calculando el precio/);
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

/* ---- Stock del catálogo: la prenda alquilada se queda, pero apagada ---- */
test("tras alquilar, la prenda sigue en el catálogo pero no disponible", async () => {
  win.renderGrid();
  const grid = doc.getElementById("grid");
  assert.match(grid.innerHTML, /Esmoquin clásico/);        // id 7, visible al inicio
  const antes = win.filteredProducts().length;

  await readyCheckout("cash");
  await win.placeOrder();

  // Sigue visible: desaparecer costaba el escaparate. Lo que no puede es
  // alquilarse otra vez.
  assert.match(grid.innerHTML, /Esmoquin clásico/);
  assert.ok(win.filteredProducts().some(p => p.id === 7));
  assert.equal(win.filteredProducts().length, antes);      // el conteo no baja
  assert.match(doc.getElementById("resultsBar").innerHTML, new RegExp(`>${antes} prendas<`));

  const card = [...grid.querySelectorAll(".card")]
    .find(c => c.textContent.includes("Esmoquin clásico"));
  assert.ok(card.classList.contains("card-off"), "debe pintarse apagada");
  assert.match(card.textContent, /No disponible/);
  assert.ok(card.querySelector(".add-btn").disabled, "no se puede alquilar");
});

test("la prenda alquilada se ordena al final de la grilla", async () => {
  await readyCheckout("cash");
  await win.placeOrder();

  const ids = win.filteredProducts().map(p => p.id);
  assert.equal(ids[ids.length - 1], 7, "la alquilada va al final");
  // Y solo ella: el resto conserva el orden del catálogo.
  assert.ok(ids.slice(0, -1).every(id => id !== 7));
});

test("la prenda vuelve al catálogo cuando el pedido se archiva (devuelta y pagada)", async () => {
  await readyCheckout("cash");
  await win.placeOrder();
  const o = app.orders[0];

  o.status = "settled";            // el negocio registró el cobro…
  o.end = app.isoOffset(-1);       // …y el período ya terminó → archivado
  win.renderGrid();

  assert.match(doc.getElementById("grid").innerHTML, /Esmoquin clásico/);
});

test("el detalle de una prenda alquilada no ofrece agregarla al carrito", async () => {
  await readyCheckout("cash");
  await win.placeOrder();

  win.openDetail(7);
  assert.match(doc.getElementById("sheetBody").innerHTML, /No disponible por el momento/);
  const btn = doc.querySelector("#sheetFoot .pay-btn");
  assert.equal(btn.dataset.action, "goProfile");   // no "addDetail"
});

test("addToCart ignora una prenda ya alquilada", async () => {
  await readyCheckout("cash");
  await win.placeOrder();
  assert.equal(app.cart.length, 0);

  win.addToCart(7);
  assert.equal(app.cart.length, 0);                // no se puede volver a alquilar
});

/* ---- Anular un pedido ---- */
// Deja un pedido confirmado y devuelve su índice; `start` permite simular uno ya
// entregado (fecha de inicio pasada).
async function placedOrder(start) {
  await readyCheckout("cash");
  if (start) app.setCheckout({ rentalStart: start });
  await win.placeOrder();
  return app.orders.length - 1;
}

// Sigue en la grilla en ambos casos, así que lo que distingue "alquilada" de
// "libre" es si se puede alquilar, no si se ve.
const alquilada = id => win.filteredProducts().some(p => p.id === id && win.isRented(id));

test("anular un pedido devuelve sus prendas al catálogo", async () => {
  win.renderGrid();
  const grid = doc.getElementById("grid");
  const i = await placedOrder();
  assert.ok(alquilada(7));                                      // apagada en la grilla

  win.cancelOrder(i);
  app.confirmModalOk(); await flush();                                        // el usuario confirma

  assert.equal(app.orders[i].status, "cancelled");
  assert.ok(!alquilada(7));                                     // vuelve a ofrecerse
  assert.match(grid.innerHTML, /Esmoquin clásico/);             // y ya está pintado
  assert.doesNotMatch(grid.innerHTML, /card-off/);              // sin la capa de apagado
  assert.equal(app.cart.length, 0);                             // no se rearma el carrito
});

test("el diálogo resume pedido, prendas y período, sin explicaciones de logística", async () => {
  const i = await placedOrder();
  win.cancelOrder(i);
  const html = app.modalHTML;
  assert.match(html, /¿Anular este pedido\?/);
  assert.match(html, /#\d{4}/);                     // número de pedido
  assert.match(html, /Esmoquin clásico/);           // la prenda
  assert.match(html, /\d+ días/);                   // el período
  // El estado del envío no se le pregunta al cliente: si el botón existe,
  // el pedido todavía no salió.
  assert.doesNotMatch(html, /reparto|en camino|retiraste/i);
  app.confirmModalOk(); await flush();
});

test("un efectivo pendiente no promete reembolso: no se ha cobrado nada", async () => {
  const i = await placedOrder();
  win.cancelOrder(i);
  assert.doesNotMatch(app.modalHTML, /Reembolso|devolverá/i);
  app.confirmModalOk(); await flush();
});

test("un pedido ya cobrado muestra el monto a reembolsar", async () => {
  await readyCheckout("credit");                 // tarjeta → cobrado
  await win.placeOrder();
  const total = app.orders[0].total.toFixed(2);
  win.cancelOrder(0);
  assert.match(app.modalHTML, /Reembolso a tu tarjeta/);
  assert.match(app.modalHTML, new RegExp(`\\$${total.replace(".", "\\.")}`));
});

test("sin confirmar el diálogo, el pedido sigue vigente", async () => {
  const i = await placedOrder();
  win.cancelOrder(i);                 // se abre el modal y no se acepta
  assert.equal(app.orders[i].status, "pending");
  assert.ok(alquilada(7));            // la prenda sigue retenida por el pedido
});

test("la opción de anular desaparece si el alquiler ya está con el cliente", async () => {
  const i = await placedOrder();
  app.orders[i].deliveredAt = app.isoOffset(0);   // el local registró la entrega
  win.renderProfile();
  assert.equal(doc.querySelectorAll('[data-action="cancelOrder"]').length, 0);
});

test("la opción de anular desaparece cuando el pedido ya terminó", async () => {
  const i = await placedOrder();
  const o = app.orders[i];
  o.status = "settled";
  o.start = app.isoOffset(-5);
  o.end = o.returnBy = app.isoOffset(-1);   // pagado y vencido → archivado
  o.deliveredAt = o.start;
  win.renderProfile();
  assert.equal(doc.querySelectorAll('[data-action="cancelOrder"]').length, 0);
});

test("un pedido anulable nunca tiene puntos acreditados que revertir", async () => {
  await readyCheckout("credit");            // tarjeta → settled, pero empieza hoy
  await win.placeOrder();
  const o = app.orders[0];
  // La invariante que cierra el agujero: acreditado ⟹ ya no anulable. Mientras
  // se pueda anular, esos puntos no existen en el saldo y no hay nada que canjear.
  assert.ok(!o.pointsCredited);
  assert.equal(app.profile.points, app.waterPointsCredited());

  win.cancelOrder(0);
  app.confirmModalOk(); await flush();

  assert.equal(app.profile.points, app.waterPointsCredited());
  assert.ok(!app.orders[0].pointsCredited);
});

test("un pedido anulado se lista en el historial, no entre los activos", async () => {
  const i = await placedOrder();
  win.cancelOrder(i);
  app.confirmModalOk(); await flush();
  win.renderProfile();
  const html = doc.getElementById("sheetBody").innerHTML;
  assert.match(html, /No tienes pedidos activos/);   // ya no está entre los vigentes
  assert.match(html, /Alquileres anteriores/);
  assert.match(html, /Anulado/);
});

test("un pedido todavía anulable no suma litros de agua", async () => {
  await placedOrder();
  // Contarlos antes de que el alquiler sea firme era explotable: bastaba
  // confirmar el pedido para cruzar una meta, cobrar sus puntos y anularlo
  // después — los puntos del pedido se revierten, los de la meta no.
  assert.equal(win.totalWaterSaved(), 0);
});

test("un alquiler ya entregado suma sus litros", async () => {
  const i = await placedOrder();
  app.orders[i].deliveredAt = app.isoOffset(0);   // el local registró la entrega
  assert.ok(win.totalWaterSaved() > 0, "un alquiler cumplido sí reutilizó ropa");
});

test("anular un pedido lo deja fuera de la cuenta de agua ahorrada", async () => {
  const i = await placedOrder();
  win.cancelOrder(i);
  app.confirmModalOk(); await flush();

  // El alquiler no llegó a ocurrir: no reutilizó ropa ni ahorró agua.
  assert.equal(win.totalWaterSaved(), 0);
  assert.match(doc.getElementById("sheetBody").innerHTML, /Agua ahorrada/);
});

test("la tarjeta del pedido muestra el depósito reembolsable junto al total", async () => {
  const i = await placedOrder();
  win.renderProfile();
  const dep = app.orderDeposit(app.orders[i]).toFixed(2);
  const html = doc.getElementById("sheetBody").innerHTML;
  // Se afirma el importe y su leyenda, no el icono que los precede: el set de
  // iconos puede cambiar sin que cambie lo que la tarjeta comunica.
  assert.match(html, new RegExp(`\\$${dep.replace(".", "\\.")} se te devuelve`));
});
