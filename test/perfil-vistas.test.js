/**
 * Pruebas de los TROZOS DE VISTA del perfil y los ajustes que ninguna prueba
 * tocaba: el editor de perfil (entrar y descartar), el editor in-line de
 * devolución, el desplegable de recargo por retraso, la lista de cupones y los
 * controles de preferencias.
 *
 * Son constructores de marcado: hoy no hay nada que diga qué deben pintar, y
 * son justo lo que `feature/refactor-vistas` va a partir en piezas. Lo que se
 * fija aquí es el contrato visible —qué botones aparecen, qué estado marcan— y
 * no el HTML literal, que puede cambiar sin que cambie el comportamiento.
 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadDom } = require("./helpers/load-dom.js");

let win, doc, app;

/** Pedido cumplido, base de las vistas del historial. */
function pedidoEntregado(extra = {}) {
  return {
    id: 1001, date: "2026-07-01", items: [app.products[0].id],
    start: "2026-07-02", end: "2026-07-05",
    delivery: "pickup", ret: "store", retAddr: "",
    pay: "cash", status: "settled", total: 30, ...extra,
  };
}

beforeEach(() => {
  const env = loadDom();
  win = env.window;
  doc = env.document;
  app = env.app;
  win.activateUserSession({ sub: "111", name: "Ana Ruiz", email: "ana@example.com" });
});

/* ---- Editor de perfil ---- */
test("editar y descartar deja los datos como estaban", () => {
  // Cancelar tiene que ser una salida de verdad: si dejara a medias lo escrito,
  // el usuario no sabría con qué datos se quedó.
  app.profile.phone = "0999999999";
  win.editProfile();
  assert.ok(doc.querySelector("#sheetBody input"), "el editor muestra campos");

  win.cancelProfileEdit();
  assert.equal(app.profile.phone, "0999999999");
  assert.equal(doc.querySelector("#pfName, #sheetBody input"), null,
    "al descartar se vuelve a la ficha, no al formulario");
});

/* ---- Editor in-line de devolución ---- */
test("el editor de devolución ofrece las dos opciones y marca la vigente", () => {
  app.setReturnEdit({ editRet: "store", editRetAddr: "" });
  const html = win.returnEditorHTML(0);

  assert.match(html, /data-action="pickReturn" data-value="store"/);
  assert.match(html, /data-action="pickReturn" data-value="home"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, new RegExp(`\\+\\$${app.SHIPPING_FEE.toFixed(2)}`),
    "la devolución a domicilio anuncia su cargo");
});

test("solo la devolución a domicilio pide dirección de retiro", () => {
  app.setReturnEdit({ editRet: "store" });
  assert.doesNotMatch(win.returnEditorHTML(0), /id="editRetAddr"/);

  app.setReturnEdit({ editRet: "home", editRetAddr: "Cdla. Kennedy Norte 45" });
  const html = win.returnEditorHTML(0);
  assert.match(html, /id="editRetAddr"/);
  assert.match(html, /Cdla\. Kennedy Norte 45/);
});

test("la dirección de retiro se escapa antes de pintarse", () => {
  // Es texto que escribe el usuario y va a innerHTML: la regla de la casa.
  app.setReturnEdit({ editRet: "home", editRetAddr: '<img src=x onerror="alert(1)">' });
  const html = win.returnEditorHTML(0);

  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img/);
});

test("guardar y cancelar llevan el índice del pedido que editan", () => {
  // Sin el índice correcto, guardar tocaría otro pedido del historial.
  app.setReturnEdit({ editRet: "store" });
  assert.match(win.returnEditorHTML(3), /data-action="saveReturn" data-idx="3"/);
  assert.match(win.returnEditorHTML(3), /data-action="cancelReturn"/);
});

/* ---- Aviso de recargo por retraso ---- */
test("el detalle del recargo se pliega y se despliega", () => {
  // Vencido y SIN saldar: un pedido ya pagado y terminado queda archivado, y el
  // historial archivado no ofrece acciones — el recargo solo tiene sentido
  // mientras la prenda sigue fuera.
  app.orders = [pedidoEntregado({ end: "2020-01-01", status: "pending" })];
  win.renderProfile();

  const info = doc.getElementById("lateInfo0");
  assert.ok(info, "un alquiler vencido explica su recargo");
  assert.equal(info.classList.contains("show"), false, "arranca plegado");

  win.toggleLateInfo(0);
  assert.equal(info.classList.contains("show"), true);
  win.toggleLateInfo(0);
  assert.equal(info.classList.contains("show"), false);
});

/* ---- Lista de cupones ---- */
test("la lista de cupones distingue disponible, usado y anulado", () => {
  const lista = [
    { id: 1, rewardId: 1, name: "Envío gratis", cost: 100, date: "2026-07-01", usedIn: null },
    { id: 2, rewardId: 1, name: "Día extra",    cost: 200, date: "2026-07-02", usedIn: 1001 },
    { id: 3, rewardId: 1, name: "Descuento",    cost: 300, date: "2026-07-03", usedIn: null, revoked: true },
  ];
  const html = win.couponListHTML(lista, "Mis premios");

  assert.match(html, /Mis premios/);
  assert.match(html, /pedido #1001/, "el usado dice en qué pedido se gastó");
  assert.match(html, /anulado con el pedido/, "el anulado se explica");
  // Dos inactivos (usado y anulado) y uno vivo.
  assert.equal((html.match(/redeemed-item used/g) || []).length, 2);
});

test("sin cupones no se pinta ni el título de la sección", () => {
  assert.equal(win.couponListHTML([], "Mis premios"), "");
});

test("el nombre del premio se escapa", () => {
  const html = win.couponListHTML(
    [{ id: 1, name: '<b>Premio</b>', cost: 10, date: "2026-07-01", usedIn: null }], "Premios");
  assert.doesNotMatch(html, /<b>Premio<\/b>/);
});

/* ---- Controles de preferencias ---- */
test("las opciones de preferencia marcan la activa y llevan su acción", () => {
  const html = win.prefOptionsHTML("theme", "dark", [["auto", "Automático"], ["dark", "Oscuro"]]);

  assert.match(html, /data-action="setPref" data-pref="theme" data-value="dark"[\s\S]*?aria-pressed="true"/);
  assert.match(html, /data-value="auto"[\s\S]*?aria-pressed="false"/);
});

test("el interruptor declara su estado como switch accesible", () => {
  // El despachador lee aria-checked para saber a qué conmutar: si deja de
  // pintarse, el toggle se queda pegado en una posición.
  assert.match(win.prefToggleHTML("reduceMotion", true), /role="switch"[\s\S]*?aria-checked="true"/);
  assert.match(win.prefToggleHTML("reduceMotion", false), /aria-checked="false"/);
  assert.match(win.prefToggleHTML("reduceMotion", true), /data-action="togglePref" data-pref="reduceMotion"/);
});

test("Ajustes pinta un control por cada preferencia que existe", () => {
  win.renderSettings();
  const prefs = [...doc.querySelectorAll("[data-pref]")].map(el => el.dataset.pref);

  for (const p of Object.keys(app.DEFAULT_PREFS)) {
    assert.ok(prefs.includes(p), `la preferencia "${p}" no tiene control en Ajustes`);
  }
});
