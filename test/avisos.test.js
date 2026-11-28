/**
 * AVISOS del local en la app (fase 4): el rechazo de una reseña llega con su
 * motivo al perfil, el botón de perfil enciende un punto mientras haya avisos
 * sin leer, y marcarlos como leídos lo apaga en el servidor y aquí.
 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadDom } = require("./helpers/load-dom.js");

let win, doc, app, fake, flush;

/** Siembra un aviso en la API falsa. */
function aviso(extra = {}) {
  const n = {
    id: fake.state.notices.length + 1, kind: "RESENA_RECHAZADA",
    title: "Tu reseña de «Blazer de lino» no se publicó",
    body: "Motivo: Datos personales. Puedes retirarla y escribir otra desde Mis pedidos.",
    createdAt: "2026-11-20T15:00:00.000Z", read: false, ...extra,
  };
  fake.state.notices.push(n);
  return n;
}

beforeEach(async () => {
  ({ window: win, document: doc, app, fake, flush } = loadDom());
  win.activateUserSession({ sub: "u1", name: "Ana" });
  await flush();
});

test("sin avisos el perfil no pinta la sección ni el punto", async () => {
  await app.loadNotices();
  app.view = "profile";
  app.renderSheet();
  assert.equal(doc.querySelector(".notices"), null);
  assert.equal(doc.getElementById("noticeDot").hidden, true);
});

test("un rechazo llega al perfil con su motivo y enciende el punto", async () => {
  aviso();
  assert.equal(await app.loadNotices(), true);
  assert.equal(doc.getElementById("noticeDot").hidden, false);
  assert.match(doc.getElementById("openProfile").getAttribute("aria-label"), /1 aviso sin leer/);

  app.view = "profile";
  app.renderSheet();
  const lista = doc.querySelector(".notices");
  assert.ok(lista);
  assert.match(lista.textContent, /Blazer de lino/);
  assert.match(lista.textContent, /Motivo: Datos personales/);
  assert.ok(doc.querySelector(".notice.unread"));
  assert.ok(doc.querySelector('[data-action="markNoticesRead"]'));
});

test("marcar como leídos apaga el punto y el botón", async () => {
  aviso();
  await app.loadNotices();
  assert.equal(await app.markNoticesRead(), true);
  assert.equal(fake.state.notices[0].read, true, "llega al servidor");
  assert.equal(doc.getElementById("noticeDot").hidden, true);
  app.view = "profile";
  app.renderSheet();
  assert.equal(doc.querySelector(".notice.unread"), null);
  assert.equal(doc.querySelector('[data-action="markNoticesRead"]'), null);
});

test("el texto del aviso se escapa", async () => {
  aviso({ title: '<img src=x onerror="window.__hack=1">' });
  await app.loadNotices();
  app.view = "profile";
  app.renderSheet();
  assert.equal(win.__hack, undefined);
  assert.equal(doc.querySelector(".notice-title img"), null);
});

test("los avisos llegan al sincronizar la cuenta y no pasan a otra sesión", async () => {
  aviso();
  win.activateUserSession({ sub: "u1", name: "Ana" });
  await flush();
  assert.equal(app.unreadNotices, 1, "syncAccount los trae");

  win.activateUserSession({ sub: "u2", name: "Otra" });
  assert.equal(app.notices.length, 0, "al cambiar de cuenta se vacían");
  assert.equal(doc.getElementById("noticeDot").hidden, true);
});
