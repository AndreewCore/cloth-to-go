/**
 * Pruebas del anuncio "Pon tu armario en alquiler".
 *
 * La función no existe todavía: lo único que debe garantizarse es que el botón
 * esté visible, que se anuncie como pendiente y —lo importante— que NO cambie
 * nada del estado del usuario, para que el aviso no se confunda con un alta.
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

test("el perfil ofrece el botón para poner el armario en alquiler", () => {
  win.renderProfile();
  const btn = doc.querySelector('[data-action="openWardrobe"]');
  assert.ok(btn, "la tarjeta debe existir en el perfil");
  assert.match(btn.textContent, /Pon tu armario en alquiler/);
});

test("se anuncia como pendiente, no como algo ya disponible", () => {
  win.renderProfile();
  const btn = doc.querySelector('[data-action="openWardrobe"]');
  assert.match(btn.textContent, /Próximamente/);
  assert.match(btn.getAttribute("aria-label"), /próximamente/i);
});

test("al pulsarlo se abre un aviso de que la función llegará más adelante", () => {
  win.openWardrobe();
  assert.ok(doc.getElementById("modalOverlay").classList.contains("show"));
  assert.match(app.modalHTML, /Muy pronto/);
  assert.match(app.modalHTML, /publiques tu propio armario/);
});

test("el aviso solo informa: no ofrece 'Cancelar' ni acción destructiva", () => {
  win.openWardrobe();
  // Nada que rechazar → un botón de cancelar sugeriría una decisión que no existe.
  assert.ok(doc.getElementById("modalCancel").classList.contains("is-hidden"));
  assert.equal(doc.getElementById("modalOk").textContent, "Entendido");
  assert.ok(!doc.getElementById("modalOk").classList.contains("danger"));
});

test("confirmar el aviso no altera el perfil, los pedidos ni el carrito", () => {
  app.profile.name = "Ana";
  app.profile.points = 40;
  const antes = JSON.stringify({ p: app.profile, o: app.orders, c: app.cart });

  win.openWardrobe();
  app.confirmModalOk();

  assert.equal(JSON.stringify({ p: app.profile, o: app.orders, c: app.cart }), antes);
  assert.ok(!doc.getElementById("modalOverlay").classList.contains("show"));
});

test("el diálogo de anular pedido sigue mostrando 'Cancelar' (no es informativo)", () => {
  // Regresión de infoOnly: ocultar el botón es opt-in y no debe filtrarse a
  // los diálogos que sí piden una decisión.
  app.cart = [{ id: 7 }];
  app.setCheckout({
    delivery: "pickup", returnMethod: "store", payMethod: "cash",
    rentalStart: app.isoOffset(0), rentalEnd: app.isoOffset(3)
  });
  win.placeOrder();
  win.cancelOrder(0);

  assert.ok(!doc.getElementById("modalCancel").classList.contains("is-hidden"));
});
