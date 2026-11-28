/**
 * El catálogo vive solo en la base (fase 4). `js/data.js` ya no trae prendas, y
 * sin servidor la app y la web lo dicen en vez de enseñar ropa que no se puede
 * alquilar ni tiene precio.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const { loadDom } = require("./helpers/load-dom.js");

const ROOT = path.join(__dirname, "..");

test("js/data.js no trae catálogo", () => {
  const ctx = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "data.js"), "utf8") + "\n;globalThis.__n = PRODUCTS.length;", ctx);
  assert.equal(ctx.__n, 0);
});

test("app sin servidor: la rejilla dice que falta la conexión", async () => {
  const { window: win, app, document: doc } = loadDom({ account: false, catalog: false, deployedApi: null });
  assert.equal(await app.hydrateCatalog(), false);
  win.renderGrid();
  assert.equal(doc.querySelectorAll("#grid .card").length, 0);
  const vacio = doc.getElementById("noResults");
  assert.notEqual(vacio.style.display, "none");
  assert.match(vacio.textContent, /con conexión al servidor/);
});

test("app con el servidor caído: deja de decir «Cargando» y explica qué pasa", async () => {
  const { window: win, app, document: doc, flush } = loadDom({ account: false, catalog: false, url: "http://localhost:8000/" });
  win.fetch = () => Promise.reject(new Error("sin red"));
  win.renderGrid();
  assert.match(doc.getElementById("noResults").textContent, /Cargando el catálogo/);
  assert.equal(await app.hydrateCatalog(), false);
  await flush();
  assert.match(doc.getElementById("noResults").textContent, /con conexión al servidor/);
});

test("app con catálogo y filtros sin resultados: el mensaje es el de la búsqueda", () => {
  const { window: win, app, document: doc } = loadDom();
  app.setFilters({ searchQuery: "zzzz-no-existe" });
  win.renderGrid();
  assert.match(doc.getElementById("noResults").textContent, /No encontramos prendas/);
});

test("web sin servidor: la rejilla dice que falta la conexión", () => {
  const html = fs.readFileSync(path.join(ROOT, "web", "index.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "file:///web/index.html" });
  const archivos = ["js/icons.js", "js/data.js", "js/state.js", "js/api.js", "web/js/session.js", "web/js/catalog.js"];
  dom.window.eval(archivos.map(f => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n;\n") + "\n;renderGrid();");
  const vacio = dom.window.document.getElementById("noResults");
  assert.equal(vacio.hidden, false);
  assert.match(vacio.textContent, /con conexión al servidor/);
});

test("un pedido con una prenda que aún no está en el catálogo se pinta igual", () => {
  const { app, document: doc } = loadDom();
  app.orders = [{ id: 7, date: app.isoOffset(-3), items: [99999], start: app.isoOffset(1), end: app.isoOffset(3),
    returnBy: app.isoOffset(4), delivery: "pickup", ret: "store", retAddr: "", pay: "cash", status: "pending", total: 20 }];
  app.view = "profile";
  assert.doesNotThrow(() => app.renderSheet());
  assert.ok(doc.querySelector(".order-item"), "la línea del pedido está");
});

test("al llegar el catálogo, el carrito suelta lo que ya no está a la venta", () => {
  const { window: win, app } = loadDom({ catalog: false });
  app.cart = [{ id: 1 }, { id: 424242 }];
  win.replaceCatalog([{ id: 1, name: "Blazer", cat: "Formal", value: 35, stars: 5, size: "M", color: "negro",
    material: "lino", weightKg: 0.5, imgs: [], desc: "", items: [{ id: 5001, available: true }] }]);
  assert.deepEqual(app.cart.map(c => c.id), [1]);
});

test("web: el carrito del invitado sobrevive a la recarga aunque el catálogo no haya llegado", () => {
  const html = fs.readFileSync(path.join(ROOT, "web", "index.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/web/" });
  dom.window.localStorage.setItem("clothToGo:web:guestCart", JSON.stringify([{ id: 3 }, { id: "x" }, null]));
  const archivos = ["js/icons.js", "js/data.js", "js/state.js", "js/api.js", "web/js/session.js"];
  dom.window.eval(archivos.map(f => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n;\n") +
    "\n;globalThis.__ids = readGuestCart().map(c => c.id);");
  assert.deepEqual([...dom.window.__ids], [3]);
});
