/**
 * Pruebas de la BAJA DE CUENTA en la demo.
 *
 * En la demo no hay cuenta en ningún servidor: lo que se borra son los datos de
 * esa cuenta en ESTE dispositivo. Por eso lo que se vigila aquí es el alcance
 * del borrado —que llegue a lo suyo y no un byte más— y que la acción sea
 * deliberada: sin confirmar no se borra nada, y al invitado, que no tiene datos
 * guardados, ni siquiera se le ofrece.
 *
 * Cuando exista el backend, deleteAccount() será el punto donde entre la
 * llamada de baja (§3 de README-BACKEND-PENDIENTE.md: `deletedAt` +
 * anonimización). Estas pruebas fijan lo que ese cambio no debe romper.
 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadDom } = require("./helpers/load-dom.js");

let win, doc, app;

const ANA  = { sub: "111", name: "Ana Ruiz", email: "ana@example.com" };
const LUIS = { sub: "222", name: "Luis Paz", email: "luis@example.com" };

/** Clave de almacenamiento de una cuenta. */
const claveDe = u => app.STORAGE_PREFIX + u.sub;

/** Deja una cuenta con datos guardados y la sesión abierta en ella. */
function sesionConDatos(user, { points = 40 } = {}) {
  win.activateUserSession(user);
  app.cart = [{ id: 1 }];
  app.profile.points = points;
  win.saveState();
}

beforeEach(() => {
  const env = loadDom();
  win = env.window;
  doc = env.document;
  app = env.app;
});

/* ---- El alcance del borrado ---- */
test("borra los datos de la cuenta activa", () => {
  sesionConDatos(ANA);
  assert.ok(win.localStorage.getItem(claveDe(ANA)), "la cuenta debe partir con datos");

  win.deleteAccount();
  assert.equal(win.localStorage.getItem(claveDe(ANA)), null);
});

test("no toca los datos de otras cuentas del mismo navegador", () => {
  // Borrar la sesión del vecino desde la propia cuenta es justo lo que no debe
  // poder pasar, ni en una demo que corre en el equipo de la feria.
  sesionConDatos(LUIS, { points: 99 });
  sesionConDatos(ANA);

  win.deleteAccount();

  assert.equal(win.localStorage.getItem(claveDe(ANA)), null);
  assert.ok(win.localStorage.getItem(claveDe(LUIS)), "Luis conserva lo suyo");
  win.activateUserSession(LUIS);
  assert.equal(app.profile.points, 99);
});

test("las preferencias del dispositivo sobreviven", () => {
  // Ajustes promete que se mantienen aunque cierres sesión: son del aparato, no
  // de la cuenta, y quien demuestra con tema oscuro no debe perderlo a mitad.
  sesionConDatos(ANA);
  app.setPref("theme", "dark");
  app.setPref("textSize", "grande");

  win.deleteAccount();

  assert.ok(win.localStorage.getItem(app.PREFS_KEY), "las preferencias siguen guardadas");
  assert.equal(app.getPrefs().theme, "dark");
  assert.equal(app.getPrefs().textSize, "grande");
});

/* ---- El estado después de la baja ---- */
test("deja la sesión cerrada y el estado en blanco", () => {
  sesionConDatos(ANA);
  app.orders = [{ id: 1, items: [1], status: "settled" }];
  win.saveState();

  win.deleteAccount();

  assert.equal(app.currentUser, null);
  assert.equal(app.activeStorageKey, null);
  assert.equal(app.cart.length, 0);
  assert.equal(app.orders.length, 0);
  assert.equal(app.reviews.length, 0);
  assert.equal(app.profile.points, 0);
  assert.equal(app.profile.email, "");
});

test("volver a entrar con esa cuenta la encuentra vacía, no restaurada", () => {
  sesionConDatos(ANA, { points: 250 });
  win.deleteAccount();

  win.activateUserSession(ANA);
  assert.equal(app.profile.points, 0);
  assert.equal(app.cart.length, 0);
});

test("el catálogo suelta las prendas alquiladas sin recargar la página", () => {
  // El home no se repinta solo. Sin repintar, las prendas del pedido borrado
  // seguían marcadas «No disponible» —retenidas por un pedido que ya no
  // existe— hasta que el usuario recargaba, que es justo lo que nadie hace.
  sesionConDatos(ANA);
  app.orders = [{ id: 1, date: "2026-08-01", items: [1], start: "2026-08-01",
                  end: "2999-12-31", delivery: "pickup", ret: "store",
                  pay: "cash", status: "settled" }];
  win.saveState();
  win.renderGrid();
  assert.match(doc.getElementById("grid").innerHTML, /No disponible/,
    "precondición: la prenda del pedido sale como alquilada");

  win.deleteAccount();

  assert.doesNotMatch(doc.getElementById("grid").innerHTML, /No disponible/);
  assert.equal(win.isRented(1), false);
});

test("el contador del carrito queda en cero a la vista", () => {
  sesionConDatos(ANA);          // deja una prenda en el carrito
  win.updateBadge();
  assert.equal(doc.getElementById("badge").textContent, "1");

  win.deleteAccount();

  assert.equal(doc.getElementById("badge").textContent, "0");
});

/* ---- La acción es deliberada ---- */
test("el diálogo avisa de lo que se pierde y no borra por sí solo", () => {
  sesionConDatos(ANA);
  win.askDeleteAccount();

  assert.ok(app.modalOpen, "debe pedir confirmación");
  assert.match(app.modalMessage, /este dispositivo/i);
  assert.match(app.modalMessage, /no se puede deshacer/i);
  assert.equal(app.modalOkLabel, "Eliminar");
  assert.equal(app.modalCancelHidden, false, "una acción destructiva ofrece salida");
  // Nada borrado mientras el diálogo sigue en pantalla.
  assert.ok(win.localStorage.getItem(claveDe(ANA)));
});

test("el diálogo no promete un borrado remoto que en la demo no ocurre", () => {
  // No hay cuenta en ningún servidor: el copy habla de los datos de este
  // dispositivo, que es lo único que se borra de verdad.
  sesionConDatos(ANA);
  win.askDeleteAccount();
  assert.doesNotMatch(app.modalMessage, /servidor|nuestros sistemas|para siempre/i);
});

test("confirmar el diálogo sí borra", () => {
  sesionConDatos(ANA);
  win.askDeleteAccount();
  app.confirmModalOk();

  assert.equal(win.localStorage.getItem(claveDe(ANA)), null);
  assert.equal(app.currentUser, null);
});

/* ---- Quién ve la opción ---- */
test("Ajustes ofrece la baja cuando hay una cuenta abierta", () => {
  win.activateUserSession(ANA);
  win.renderSettings();

  const btn = doc.querySelector('[data-action="deleteAccount"]');
  assert.ok(btn, "la fila debe estar en Ajustes");
  assert.ok(btn.closest(".danger-row"), "va marcada como destructiva");
});

test("al invitado no se le ofrece: no tiene datos que borrar", () => {
  // Su sesión no persiste (activeStorageKey es null). Un botón que promete
  // borrar algo inexistente enseña un modelo mental falso de dónde viven los
  // datos.
  win.activateUserSession(null);
  win.renderSettings();

  assert.equal(app.activeStorageKey, null);
  assert.equal(doc.querySelector('[data-action="deleteAccount"]'), null);
});

/* ---- Degradación ---- */
test("sin localStorage disponible la sesión se cierra igual", () => {
  // Mismo criterio que saveState(): el almacenamiento puede fallar (modo
  // privado, cuota), y eso no puede dejar al usuario dentro de una cuenta que
  // acaba de pedir borrar.
  sesionConDatos(ANA);
  const original = win.localStorage.removeItem;
  win.localStorage.removeItem = () => { throw new Error("almacenamiento no disponible"); };

  assert.doesNotThrow(() => win.deleteAccount());
  assert.equal(app.currentUser, null);
  assert.equal(app.cart.length, 0);

  win.localStorage.removeItem = original;
});
