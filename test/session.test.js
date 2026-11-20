/**
 * Pruebas de SESIÓN y PERSISTENCIA: que cada cuenta de Google tenga su propio
 * almacenamiento (dos cuentas en el mismo navegador no deben pisarse), que el
 * invitado no deje registro, y el decodeJwt de auth.js.
 *
 * Los pedidos y los puntos ya no se guardan aquí: viven en la base (fase 3).
 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadDom } = require("./helpers/load-dom.js");

let win, app, fake, flush;

beforeEach(() => {
  const env = loadDom();
  win = env.window;
  app = env.app;
  fake = env.fake;
  flush = env.flush;
});

// Los objetos creados dentro del contexto vm llevan el prototipo de ESE realm,
// así que deepEqual (estricto con los prototipos) los rechaza aunque coincidan.
// Copiarlos al realm de las pruebas los vuelve comparables.
const plain = v => JSON.parse(JSON.stringify(v));

const ANA  = { sub: "111", name: "Ana Ruiz",  email: "ana@example.com" };
const LUIS = { sub: "222", name: "Luis Paz",  email: "luis@example.com" };

/* ---- Clave de almacenamiento por usuario ---- */
test("storageKeyFor: una clave por cuenta; el invitado no tiene ninguna", () => {
  assert.equal(app.storageKeyFor(ANA), app.STORAGE_PREFIX + "111");
  assert.notEqual(app.storageKeyFor(ANA), app.storageKeyFor(LUIS));
  assert.equal(app.storageKeyFor(null), null);
  assert.equal(app.storageKeyFor({}), null);   // sin sub no hay identidad
});

/* ---- Aislamiento entre cuentas ---- */
test("dos cuentas en el mismo navegador no se pisan los datos", () => {
  win.activateUserSession(ANA);
  app.cart = [{ id: 7 }];
  app.profile.phone = "0991111111";
  win.saveState();

  win.activateUserSession(LUIS);
  assert.equal(app.cart.length, 0, "Luis no hereda el carrito de Ana");
  assert.equal(app.profile.phone, "");
  app.cart = [{ id: 1 }];
  win.saveState();

  win.activateUserSession(ANA);
  assert.deepEqual(plain(app.cart), [{ id: 7 }]);   // Ana recupera lo suyo
  assert.equal(app.profile.phone, "0991111111");
});

test("activateUserSession rellena el perfil con la identidad de Google", () => {
  win.activateUserSession(ANA);
  assert.equal(app.profile.name, "Ana Ruiz");
  assert.equal(app.profile.email, "ana@example.com");
  assert.equal(app.currentUser.sub, "111");
});

test("los datos editados por el usuario sobreviven al re-login", () => {
  win.activateUserSession(ANA);
  app.profile.phone = "0991234567";
  win.saveState();

  win.activateUserSession(LUIS);
  win.activateUserSession(ANA);
  assert.equal(app.profile.phone, "0991234567");
});

/* ---- El invitado no deja registro ---- */
test("el invitado no persiste: nada se escribe ni se recupera", () => {
  win.activateUserSession(null);
  app.cart = [{ id: 7 }];
  app.profile.points = 99;
  win.saveState();

  assert.equal(app.activeStorageKey, null);
  // La única clave es la de la sesión del servidor que dejó el arnés de pruebas.
  const claves = Object.keys(win.localStorage).filter(k => k !== "clothToGo:session");
  assert.deepEqual(claves, [], "no debe quedar rastro del invitado");

  win.activateUserSession(null);
  assert.equal(app.cart.length, 0);
  assert.equal(app.profile.points, 0);
});

test("entrar como invitado descarta los datos de la cuenta anterior", () => {
  win.activateUserSession(ANA);
  app.cart = [{ id: 7 }];
  win.saveState();

  win.activateUserSession(null);
  assert.equal(app.cart.length, 0);
  assert.equal(app.profile.name, "");
});

/* ---- El home refleja la sesión que está abierta ---- */
test("cambiar de cuenta repinta la parrilla y el contador del carrito", () => {
  // activateUserSession() cambia el estado entero, pero el home solo se pinta
  // al arrancar: sin repintar aquí, el catálogo y el badge se quedaban con los
  // datos de la sesión anterior hasta recargar la página.
  win.activateUserSession(ANA);
  app.cart = [{ id: 7 }];
  app.orders = [{ id: 1, date: "2026-08-01", items: [1], start: "2026-08-01",
                  end: "2999-12-31", delivery: "pickup", ret: "store",
                  pay: "cash", status: "settled" }];
  win.saveState();
  win.renderGrid();
  win.updateBadge();

  win.activateUserSession(LUIS);   // Luis no tiene ni carrito ni pedidos

  const doc = win.document;
  assert.equal(doc.getElementById("badge").textContent, "0");
  assert.doesNotMatch(doc.getElementById("grid").innerHTML, /No disponible/,
    "la prenda que retenía Ana está libre para Luis");
});

/* ---- Puesta al día de puntos al abrir sesión ---- */
test("al abrir sesión, los pedidos y los puntos llegan de la API", async () => {
  // Nada se acredita aquí: el servidor liquida lo entregado entre visitas y la
  // app adopta el resultado.
  fake.state.balance = 75;
  fake.seed({ id: 2100, items: [7], start: app.isoOffset(-2), end: app.isoOffset(1), points: 0, total: 12 });
  win.activateUserSession(ANA);
  await flush();
  assert.ok(fake.calls.some(c => c.method === "GET" && c.path === "/api/orders"));
  assert.ok(fake.calls.some(c => c.method === "GET" && c.path === "/api/me/points"));
  assert.equal(app.profile.points, 75);
  assert.deepEqual(app.orders.map(o => o.id), [2100]);
});

test("ni los pedidos ni los puntos se guardan en el navegador", () => {
  win.activateUserSession(ANA);
  app.orders = [{ id: 1001, items: [7], start: app.isoOffset(1), end: app.isoOffset(4), status: "pending", total: 10 }];
  app.profile.points = 500;
  win.saveState();
  const guardado = JSON.parse(win.localStorage.getItem(app.storageKeyFor(ANA)));
  assert.equal(guardado.orders, undefined);
  assert.equal(guardado.profile.points, undefined);
  assert.equal(guardado.profile.redeemed, undefined);
});

test("una sesión caducada (401) devuelve a la bienvenida", async () => {
  win.activateUserSession(ANA);
  fake.failNext = { status: 401, error: "Credencial inválida o expirada." };
  await app.syncAccount();
  assert.equal(app.currentUser, null);
  assert.equal(app.readSessionToken(), null, "el token caducado se olvida");
});

/* ---- decodeJwt ---- */
// Construye un JWT de mentira (solo el payload importa: la firma no se verifica).
function fakeJwt(claims) {
  const b64 = Buffer.from(JSON.stringify(claims), "utf8")
    .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `header.${b64}.signature`;
}

test("decodeJwt lee los claims de identidad", () => {
  const claims = { sub: "111", name: "Ana Ruiz", email: "ana@example.com" };
  assert.deepEqual(plain(app.decodeJwt(fakeJwt(claims))), claims);
});

test("decodeJwt respeta UTF-8 en nombres con acentos y emoji", () => {
  const claims = { sub: "1", name: "Andrée Núñez 🌱" };
  assert.equal(app.decodeJwt(fakeJwt(claims)).name, "Andrée Núñez 🌱");
});

test("decodeJwt devuelve null ante un token malformado, sin lanzar", () => {
  for (const bad of ["", "no-es-un-jwt", "a.b", "a.!!!.c", "a." + "eyJhIjo" + ".c"]) {
    assert.equal(app.decodeJwt(bad), null, `debería rechazar: ${bad}`);
  }
});

/* ---- Degradación sin origen http ---- */
test("por file:// no se ofrece el login con Google", () => {
  const { window: w } = loadDom({ url: "file:///home/user/index.html" });
  assert.equal(w.authAvailable(), false);
});

test("sobre http(s) el login con Google sí se ofrece", () => {
  assert.equal(win.authAvailable(), true);
});
