/**
 * Pruebas de FLUJO sobre un DOM real (jsdom): confirmación de pedido, la nueva
 * regla de puntos (solo al pagar) + "Confirmar pago", el vaciado del carrito en
 * placeOrder, estados de botones y el escape anti-XSS en la vista renderizada.
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
test("placeOrder con tarjeta: pedido settled, puntos acreditados y carrito vacío", () => {
  readyCheckout("credit");
  const expectedPts = app.orderPoints(); // se calcula con el carrito aún lleno
  win.placeOrder();

  assert.equal(app.orders.length, 1);
  const o = app.orders[0];
  assert.equal(o.status, "settled");
  assert.ok(o.pointsCredited);
  assert.equal(app.profile.points, expectedPts); // sí se sumaron
  assert.equal(app.cart.length, 0);              // carrito vaciado en placeOrder
  assert.equal(app.view, "done");
  // La confirmación se pinta desde el pedido (no del carrito, ya vacío).
  assert.match(doc.getElementById("sheetBody").innerHTML, /Ganaste/);
});

/* ---- placeOrder: efectivo ---- */
test("placeOrder en efectivo: pedido pending, NO acredita puntos aún", () => {
  readyCheckout("cash");
  win.placeOrder();

  const o = app.orders[0];
  assert.equal(o.status, "pending");
  assert.ok(!o.pointsCredited);
  assert.ok(o.points > 0);                 // los guarda, pero…
  assert.equal(app.profile.points, 0);     // …no los acredita todavía
  assert.match(doc.getElementById("sheetBody").innerHTML, /Ganarás/); // "Ganarás …"
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
  // Sí ve, de forma pasiva, los puntos que quedaron reservados.
  assert.match(html, /Ganarás \d+ pts cuando se registre tu pago/);
  assert.equal(app.orders[0].status, "pending");
  assert.equal(app.profile.points, 0);
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
  assert.equal(btn.dataset.action, "placeOrder");

  app.setCheckout({ card: { number: "4111111111111111", name: "Ana", expiry: "12/30", cvv: "123" } });
  win.renderPayment();
  btn = doc.querySelector("#sheetFoot .pay-btn");
  assert.ok(!btn.hasAttribute("disabled")); // datos completos → habilitado
  assert.equal(btn.dataset.action, "placeOrder");
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
