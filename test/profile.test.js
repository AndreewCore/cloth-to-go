/**
 * Pruebas del PERFIL sobre un DOM real (jsdom): el editor del modo de devolución
 * (que recalcula el cobro del pedido), el canje de premios y el formulario de
 * donación. Es lógica que mueve dinero y puntos, y hasta ahora solo estaba
 * cubierta la validación del formulario de contacto.
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

// Confirma un pedido de una prenda y devuelve su índice.
function placeOrder(pay = "cash") {
  app.setCheckout({
    delivery: "pickup", returnMethod: "store", payMethod: pay,
    card: pay === "cash"
      ? { number: "", name: "", expiry: "", cvv: "" }
      : { number: "4111111111111111", name: "Ana Ruiz", expiry: "12/30", cvv: "123" },
    rentalStart: app.isoOffset(0), rentalEnd: app.isoOffset(3)
  });
  app.cart = [{ id: 7 }];
  win.placeOrder();
  return app.orders.length - 1;
}

/* ---- Editor del modo de devolución ---- */
test("openReturnEditor precarga el modo y la dirección del pedido", () => {
  const i = placeOrder();
  app.orders[i].ret = "home";
  app.orders[i].retAddr = "Av. Siempre Viva 742";

  win.openReturnEditor(i);

  assert.equal(app.editingOrder, i);
  assert.equal(doc.getElementById("editRetAddr").value, "Av. Siempre Viva 742");
  assert.ok(doc.querySelector('[data-action="pickReturn"][data-value="home"]').classList.contains("active"));
});

test("cambiar a domicilio cobra el retiro y sube el total del pedido", () => {
  const i = placeOrder();
  const o = app.orders[i];
  const antes = o.total;

  win.openReturnEditor(i);
  app.setReturnEdit({ editRet: "home", editRetAddr: "Av. Siempre Viva 742" });
  win.saveReturn(i);
  app.confirmModalOk();                       // el cambio de tarifa se confirma

  assert.equal(o.ret, "home");
  assert.equal(o.retAddr, "Av. Siempre Viva 742");
  assert.equal(o.total, app.orderTotal(o));   // recalculado, no el guardado antes
  assert.ok(o.total > antes, "el retiro a domicilio tiene cargo");
});

test("volver a devolución en local descuenta el cargo y borra la dirección", () => {
  const i = placeOrder();
  const o = app.orders[i];
  o.ret = "home";
  o.retAddr = "Av. Siempre Viva 742";
  o.total = app.orderTotal(o);
  const conCargo = o.total;

  win.openReturnEditor(i);
  app.setReturnEdit({ editRet: "store" });
  win.saveReturn(i);
  app.confirmModalOk();

  assert.equal(o.ret, "store");
  assert.equal(o.retAddr, "");                // ya no hay dónde ir a retirar
  assert.ok(o.total < conCargo);
});

test("saveReturn rechaza domicilio sin dirección válida y no toca el pedido", () => {
  const i = placeOrder();
  const o = app.orders[i];
  const antes = { ret: o.ret, total: o.total };

  win.openReturnEditor(i);
  app.setReturnEdit({ editRet: "home", editRetAddr: "abc" });   // dirección inválida
  win.saveReturn(i);

  assert.equal(o.ret, antes.ret);
  assert.equal(o.total, antes.total);
  assert.equal(app.editingOrder, i, "el editor sigue abierto para corregir");
});

test("cambiar solo la dirección no pide confirmar (no cambia la tarifa)", () => {
  const i = placeOrder();
  const o = app.orders[i];
  o.ret = "home";
  o.retAddr = "Dirección vieja 123";

  win.openReturnEditor(i);
  app.setReturnEdit({ editRetAddr: "Dirección nueva 456" });
  win.saveReturn(i);                          // se aplica directo, sin modal

  assert.equal(o.retAddr, "Dirección nueva 456");
  assert.equal(app.editingOrder, null, "el editor se cierra al guardar");
});

test("cancelar el editor deja el pedido intacto", () => {
  const i = placeOrder();
  const o = app.orders[i];

  win.openReturnEditor(i);
  app.setReturnEdit({ editRet: "home", editRetAddr: "Av. Siempre Viva 742" });
  win.closeReturnEditor();

  assert.equal(o.ret, "store");
  assert.equal(app.editingOrder, null);
});

/* ---- Premios (canje de puntos) ---- */
test("redeem descuenta los puntos y registra el canje", () => {
  app.profile.points = 5000;
  win.renderRewards();
  const btn = doc.querySelector('[data-action="redeem"]:not([disabled])');
  const id = +btn.dataset.id;
  const antes = app.profile.points;

  win.redeem(id);
  app.confirmModalOk();

  assert.ok(app.profile.points < antes);
  assert.equal(app.profile.redeemed.length, 1);
  assert.equal(app.profile.points, antes - app.profile.redeemed[0].cost);
});

test("redeem no hace nada si no alcanzan los puntos", () => {
  app.profile.points = 0;
  win.renderRewards();
  const btn = doc.querySelector("[data-action='redeem']");
  const id = btn ? +btn.dataset.id : 1;

  win.redeem(id);

  assert.equal(app.profile.points, 0);
  assert.equal(app.profile.redeemed.length, 0);
});

test("sin confirmar el canje, los puntos no se descuentan", () => {
  app.profile.points = 5000;
  win.renderRewards();
  const id = +doc.querySelector('[data-action="redeem"]:not([disabled])').dataset.id;

  win.redeem(id);                             // abre el modal y no se acepta

  assert.equal(app.profile.points, 5000);
  assert.equal(app.profile.redeemed.length, 0);
});

test("un premio inexistente no rompe ni descuenta", () => {
  app.profile.points = 5000;
  win.redeem(99999);
  assert.equal(app.profile.points, 5000);
});

/* ---- Donaciones ---- */
test("donateValid exige descripción y método de entrega", () => {
  win.openDonate();
  assert.ok(!win.donateValid());                          // vacío

  app.setDonation({ donName: "ab", donMethod: "store" }); // descripción muy corta
  assert.ok(!win.donateValid());

  app.setDonation({ donName: "Abrigo de lana, jeans y camisa" });
  assert.ok(win.donateValid());                           // en local basta con eso
});

test("la donación a domicilio exige dirección válida y fecha de cita", () => {
  win.openDonate();
  app.setDonation({ donName: "Abrigo de lana", donMethod: "home" });
  assert.ok(!win.donateValid());

  app.setDonation({ donAddr: "Av. Siempre Viva 742" });
  assert.ok(!win.donateValid(), "falta la fecha de la cita");

  app.setDonation({ donDate: app.isoOffset(3) });
  assert.ok(win.donateValid());
});

test("submitDonation registra la solicitud 'En revisión' y limpia el formulario", () => {
  win.openDonate();
  app.setDonation({
    donName: "Abrigo de lana", donMethod: "home",
    donAddr: "Av. Siempre Viva 742", donDate: app.isoOffset(3)
  });

  win.submitDonation();

  assert.equal(app.profile.donations.length, 1);
  const d = app.profile.donations[0];
  assert.equal(d.item, "Abrigo de lana");
  assert.equal(d.method, "home");
  assert.equal(d.status, "En revisión");
  // Los puntos se asignan al recibir y evaluar la prenda, no al solicitarla.
  assert.equal(d.points, null);
  assert.equal(app.profile.points, 0);
  assert.ok(!win.donateValid(), "el formulario queda vacío tras enviar");
});

test("submitDonation ignora una solicitud incompleta", () => {
  win.openDonate();
  app.setDonation({ donName: "Abrigo", donMethod: "home", donAddr: "x" });
  win.submitDonation();
  assert.equal(app.profile.donations.length, 0);
});

test("el botón de donar explica qué falta en cada paso", () => {
  win.openDonate();
  win.renderDonate();
  const label = () => doc.querySelector("#sheetFoot .pay-btn").textContent;

  assert.match(label(), /Describe la prenda/);
  app.setDonation({ donName: "Abrigo de lana" }); win.renderDonate();
  assert.match(label(), /Elige cómo entregarla/);
  app.setDonation({ donMethod: "home" }); win.renderDonate();
  assert.match(label(), /dirección de retiro/i);
  app.setDonation({ donAddr: "Av. Siempre Viva 742" }); win.renderDonate();
  assert.match(label(), /fecha de la cita/);
  app.setDonation({ donDate: app.isoOffset(3) }); win.renderDonate();
  assert.ok(!doc.querySelector("#sheetFoot .pay-btn").hasAttribute("disabled"));
});

test("XSS: la descripción de una donación se escapa al listarla", () => {
  win.openDonate();
  app.setDonation({ donName: `<img src=x onerror="alert(1)">`, donMethod: "store" });
  win.submitDonation();

  const html = doc.getElementById("sheetBody").innerHTML;
  assert.match(html, /&lt;img/);
  assert.equal(doc.querySelectorAll('img[onerror="alert(1)"]').length, 0);
});
