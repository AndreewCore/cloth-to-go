/**
 * Pruebas del CATÁLOGO sobre un DOM real (jsdom): filtros (categoría, búsqueda,
 * calidad, talla, material), ordenamiento, la barra de resultados y el panel de
 * filtros. Es la primera pantalla que ve cualquier usuario y hasta ahora solo
 * estaba cubierta de refilón por las pruebas de stock.
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

/* ---- Filtro por categoría ---- */
test("la categoría activa deja solo prendas de esa categoría", () => {
  const todas = win.filteredProducts();
  app.setFilters({ activeCat: "Formal" });
  const formal = win.filteredProducts();

  assert.ok(formal.length > 0 && formal.length < todas.length);
  assert.ok(formal.every(p => p.cat === "Formal"));
});

test("'Todo' no descarta ninguna prenda", () => {
  app.setFilters({ activeCat: "Todo" });
  assert.equal(win.filteredProducts().length, app.productCount);
});

/* ---- Búsqueda ---- */
test("la búsqueda mira nombre, categoría y descripción", () => {
  const p = win.filteredProducts()[0];

  app.setFilters({ searchQuery: p.name });
  assert.ok(win.filteredProducts().some(x => x.id === p.id));

  // Una palabra suelta de la descripción también encuentra la prenda.
  const palabra = p.desc.split(" ").find(w => w.length > 5);
  app.setFilters({ searchQuery: palabra });
  assert.ok(win.filteredProducts().some(x => x.id === p.id));
});

test("la búsqueda ignora mayúsculas y espacios sobrantes", () => {
  const p = win.filteredProducts()[0];
  app.setFilters({ searchQuery: `   ${p.name.toUpperCase()}   ` });
  assert.ok(win.filteredProducts().some(x => x.id === p.id));
});

test("una búsqueda sin resultados vacía la grilla y muestra el aviso", () => {
  app.setFilters({ searchQuery: "zzzzz-no-existe" });
  win.renderGrid();

  assert.equal(win.filteredProducts().length, 0);
  assert.equal(doc.getElementById("grid").innerHTML, "");
  assert.equal(doc.getElementById("noResults").style.display, "block");
  assert.match(doc.getElementById("resultsBar").innerHTML, />0 prendas</);
});

/* ---- Filtros del panel ---- */
test("el filtro de calidad descarta las prendas por debajo del mínimo", () => {
  app.setFilters({ qualityFilter: 4 });
  const list = win.filteredProducts();
  assert.ok(list.length > 0);
  assert.ok(list.every(p => p.stars >= 4));
});

test("los filtros de talla y material se combinan (AND, no OR)", () => {
  const ref = win.filteredProducts()[0];
  app.setFilters({ sizeFilter: ref.size, materialFilter: ref.material });
  const list = win.filteredProducts();

  assert.ok(list.length > 0);
  assert.ok(list.every(p => p.size === ref.size && p.material === ref.material));
});

/* ---- Ordenamiento ---- */
test("sortProducts ordena por precio ascendente y descendente", () => {
  const precio = p => win.rentalPrice(p, 1);

  app.setFilters({ sortBy: "price-asc" });
  const asc = win.filteredProducts().map(precio);
  assert.deepEqual(asc, asc.slice().sort((a, b) => a - b));

  app.setFilters({ sortBy: "price-desc" });
  const desc = win.filteredProducts().map(precio);
  assert.deepEqual(desc, desc.slice().sort((a, b) => b - a));
});

test("el orden por calidad pone las mejores primero y desempata por precio", () => {
  app.setFilters({ sortBy: "stars-desc" });
  const list = win.filteredProducts();

  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1], b = list[i];
    assert.ok(a.stars >= b.stars, "las estrellas deben ir de mayor a menor");
    if (a.stars === b.stars) {
      assert.ok(win.rentalPrice(a, 1) <= win.rentalPrice(b, 1), "a igual calidad, más barato primero");
    }
  }
});

test("sortProducts no muta el catálogo original", () => {
  const antes = win.filteredProducts().map(p => p.id);
  app.setFilters({ sortBy: "price-desc" });
  win.filteredProducts();
  app.setFilters({ sortBy: "default" });

  assert.deepEqual(win.filteredProducts().map(p => p.id), antes);
});

/* ---- Estado de los filtros ---- */
test("anyFilterActive detecta cualquier filtro, incluido el orden", () => {
  assert.ok(!win.anyFilterActive());
  for (const patch of [
    { activeCat: "Formal" }, { searchQuery: "x" }, { qualityFilter: 3 },
    { sizeFilter: "M" }, { materialFilter: "algodon" }, { sortBy: "price-asc" }
  ]) {
    app.setFilters({ activeCat: "Todo", searchQuery: "", qualityFilter: 0,
      sizeFilter: "Todas", materialFilter: "Todos", sortBy: "default" });
    app.setFilters(patch);
    assert.ok(win.anyFilterActive(), `no detectó ${Object.keys(patch)[0]}`);
  }
});

test("activeFilterCount solo cuenta los filtros del panel", () => {
  app.setFilters({ qualityFilter: 3, sizeFilter: "M" });
  assert.equal(win.activeFilterCount(), 2);

  // Categoría y orden tienen sus propios controles: no suman al badge.
  app.setFilters({ activeCat: "Formal", sortBy: "price-asc" });
  assert.equal(win.activeFilterCount(), 2);

  app.setFilters({ materialFilter: "algodon" });
  assert.equal(win.activeFilterCount(), 3);
});

test("el badge del botón Filtros se oculta cuando no hay ninguno activo", () => {
  const badge = doc.getElementById("filterCount");

  app.setFilters({ qualityFilter: 5 });
  win.renderGrid();
  assert.equal(badge.textContent, "1");
  assert.equal(badge.style.display, "grid");

  app.setFilters({ qualityFilter: 0 });
  win.renderGrid();
  assert.equal(badge.style.display, "none");
});

test("clearFilters restablece todo y vacía el buscador", () => {
  doc.getElementById("searchInput").value = "esmoquin";
  app.setFilters({ activeCat: "Formal", searchQuery: "esmoquin", qualityFilter: 4,
    sizeFilter: "M", materialFilter: "algodon", sortBy: "price-asc" });

  win.clearFilters();

  assert.ok(!win.anyFilterActive());
  assert.equal(win.activeFilterCount(), 0);
  assert.equal(doc.getElementById("searchInput").value, "");
  assert.equal(win.filteredProducts().length, app.productCount);
});

test("'Limpiar filtros' solo aparece en la barra si hay algo que limpiar", () => {
  win.renderGrid();
  assert.equal(doc.getElementById("clearFilters"), null);

  app.setFilters({ activeCat: "Formal" });
  win.renderGrid();
  assert.ok(doc.getElementById("clearFilters"));
});

/* ---- Panel de filtros (sheet) ---- */
test("el panel refleja los filtros vigentes en sus selects", () => {
  app.setFilters({ qualityFilter: 4, sizeFilter: "M" });
  win.renderFilterSheet();

  assert.equal(doc.getElementById("fQuality").value, "4");
  assert.equal(doc.getElementById("fSize").value, "M");
  assert.equal(doc.getElementById("fMaterial").value, "Todos");
});

test("el botón del panel anuncia cuántas prendas se verán", () => {
  app.setFilters({ activeCat: "Formal" });
  win.renderFilterSheet();

  const n = win.filteredProducts().length;
  const btn = doc.querySelector('[data-action="closeSheet"]');
  assert.match(btn.textContent, new RegExp(`Ver ${n} prendas?`));
});

test("el botón 'Limpiar' del panel se deshabilita sin filtros del panel", () => {
  win.renderFilterSheet();
  assert.ok(doc.querySelector('[data-action="clearFiltersSheet"]').hasAttribute("disabled"));

  app.setFilters({ sizeFilter: "M" });
  win.renderFilterSheet();
  assert.ok(!doc.querySelector('[data-action="clearFiltersSheet"]').hasAttribute("disabled"));
});

/* ---- Grilla ---- */
test("la tarjeta de una prenda en el carrito muestra 'En carrito'", () => {
  const p = win.filteredProducts()[0];
  win.addToCart(p.id);
  win.renderGrid();

  const btn = doc.querySelector(`[data-add="${p.id}"]`);
  assert.match(btn.textContent, /En carrito/);
  assert.ok(btn.classList.contains("in-cart"));
});

test("el detalle de una prenda del carrito lleva al carrito, no a agregarla", () => {
  const p = win.filteredProducts()[0];
  win.addToCart(p.id);
  win.openDetail(p.id);

  assert.match(doc.getElementById("sheetBody").innerHTML, /Ya está en tu carrito/);
  assert.equal(doc.querySelector("#sheetFoot .pay-btn").dataset.action, "goCart");
});

test("addToCart no duplica una prenda ya añadida", () => {
  const p = win.filteredProducts()[0];
  win.addToCart(p.id);
  win.addToCart(p.id);
  assert.equal(app.cart.length, 1);
});
