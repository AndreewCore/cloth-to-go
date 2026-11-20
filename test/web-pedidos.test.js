/**
 * El «hecho cuando» de la fase 3: un pedido hecho en la web aparece en la app
 * porque lo guarda la base, no `localStorage`.
 *
 * Se montan las dos superficies en dos DOM distintos (dos navegadores, sin
 * almacenamiento compartido) y una sola «base»: el arreglo de pedidos de la API
 * falsa, que es lo único que comparten. Si la web siguiera guardando en el
 * navegador, la app no vería nada.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { loadDom } = require("./helpers/load-dom.js");
const { installFakeApi, ITEM_BASE } = require("./helpers/fake-api.js");

const ROOT = path.join(__dirname, "..");

/** Carga el sitio web (sin main.js) con la API falsa y una sesión iniciada. */
function cargarWeb() {
  const html = fs.readFileSync(path.join(ROOT, "web", "index.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/web/", pretendToBeVisual: true });
  const win = dom.window;
  const fake = installFakeApi(win);
  const archivos = ["js/icons.js", "js/data.js", "js/state.js", "js/api.js",
    "web/js/session.js", "web/js/catalog.js", "web/js/cart.js"];
  const src = archivos.map(f => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n;\n");
  win.eval(`${src}
    ;globalThis.__APP__ = { get products(){ return PRODUCTS; }, REWARDS, WATER_GOALS };
    // toast() vive en web/js/main.js, que no se carga (arrastra el arranque).
    function toast(m){ globalThis.__lastToast = m; }
    storeSessionToken("sesion-web");
    webUser = { sub: "test-user", name: "Ana Ruiz", email: "ana@test.com" };
    replaceCatalog(PRODUCTS.map(p => ({ ...p, items: [{ id: ${ITEM_BASE} + p.id, available: true }] })));
    globalThis.__WEB__ = {
      setCheckout(p){ delivery = p.delivery; returnMethod = p.ret; payMethod = p.pay;
        card = { number: "4111111111111111", name: "Ana Ruiz", expiry: "12/30", cvv: "123" }; },
      setCart(ids){ cart = ids.map(id => ({ id })); },
      get orders(){ return orders; },
    };`);
  return { win, fake };
}

test("un pedido hecho en la web aparece en «Mis pedidos» de la app", async () => {
  const web = cargarWeb();
  web.win.__WEB__.setCart([7]);
  web.win.__WEB__.setCheckout({ delivery: "pickup", ret: "store", pay: "credit" });
  assert.equal(await web.win.placeWebOrder(), true);

  const post = web.fake.calls.find(c => c.method === "POST" && c.path === "/api/orders");
  assert.deepEqual([...post.body.items], [ITEM_BASE + 7], "la web reserva ejemplares, como la app");
  assert.equal(web.win.localStorage.getItem("clothToGo:v4:user:test-user"), null,
    "sin cuenta activa en el almacenamiento: el pedido no vive en el navegador");

  // La app, en otro navegador, lee la misma base.
  const app = loadDom();
  app.fake.state.orders = web.fake.state.orders;
  assert.ok(await app.app.syncAccount());
  assert.equal(app.app.orders.length, 1);
  assert.equal(app.app.orders[0].id, web.win.__WEB__.orders[0].id);
  assert.deepEqual([...app.app.orders[0].items], [7]);
});

test("la web sin sesión de la API no crea pedidos", async () => {
  const web = cargarWeb();
  web.win.clearSessionToken();
  web.win.__WEB__.setCart([7]);
  web.win.__WEB__.setCheckout({ delivery: "pickup", ret: "store", pay: "credit" });
  assert.equal(await web.win.placeWebOrder(), false);
  assert.equal(web.fake.calls.filter(c => c.path === "/api/orders").length, 0);
  assert.match(web.win.__lastToast, /conexión/);
});
