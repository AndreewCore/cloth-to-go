/**
 * Pruebas del FILTRO POR COLOR: el dato en el catálogo, el filtrado, su lugar
 * en la búsqueda y el desplegable del panel.
 *
 * El color es el primer criterio con el que alguien descarta ropa —antes que la
 * talla y mucho antes que el material—, así que se cubre igual que el resto de
 * filtros: que aísle, que se combine con los demás y que se sepa limpiar.
 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadDom } = require("./helpers/load-dom.js");

let win, doc, app;

/** Primer color del banco que sí tiene prendas (los hay vacíos a propósito). */
const conPrendas = () => app.COLORS.find(c => app.colorCount(c) > 0);

beforeEach(() => {
  const env = loadDom();
  win = env.window;
  doc = env.document;
  app = env.app;
});

/* ---- El dato ---- */
test("toda prenda del catálogo declara un color del banco", () => {
  for (const p of app.products) {
    assert.ok(app.COLORS.includes(p.color),
      `la prenda ${p.id} (${p.name}) trae un color fuera del banco: "${p.color}"`);
  }
});

test("el banco trae los colores comunes, los tenga o no el catálogo", () => {
  // El banco es de donde se elige al dar de alta una prenda: si solo listara lo
  // que ya existe, cada prenda nueva estrenaría su propia clave y el filtro
  // acabaría con "azul" y "azul marino" como colores distintos.
  for (const c of ["blanco", "amarillo", "azul", "rojo", "verde", "rosa", "morado",
                   "naranja", "negro", "cafe", "beige", "gris", "turquesa", "celeste"]) {
    assert.ok(app.COLORS.includes(c), `falta ${c} en el banco de colores`);
  }
  assert.ok(app.COLORS.some(c => app.colorCount(c) === 0),
    "el banco debe poder ofrecer colores que hoy no tiene ninguna prenda");
});

test("colorCount cuenta las prendas de cada color", () => {
  for (const c of app.COLORS) {
    assert.equal(app.colorCount(c), app.products.filter(p => p.color === c).length);
  }
  assert.equal(app.colorCount("turquesa"), 0);
});

test("colorLabel y colorSwatch aguantan un color desconocido o ausente", () => {
  // Un catálogo hidratado por un backend viejo llega sin `color`; la app debe
  // degradar, no reventar (la búsqueda llama .toLowerCase() sobre la etiqueta).
  assert.equal(app.colorLabel("fucsia"), "fucsia");
  assert.equal(app.colorLabel(undefined), "");
  assert.equal(typeof app.colorSwatch("fucsia"), "string");
  assert.ok(app.colorSwatch(undefined));
});

/* ---- El filtrado ---- */
test("el filtro deja solo las prendas de ese color", () => {
  const color = conPrendas();
  app.setFilters({ colorFilter: color });
  const list = win.filteredProducts();

  assert.ok(list.length > 0);
  assert.ok(list.every(p => p.color === color));
  assert.ok(list.length < app.productCount, "debe descartar algo, si no no filtra");
});

test("'Todos' no descarta ninguna prenda", () => {
  app.setFilters({ colorFilter: "Todos" });
  assert.equal(win.filteredProducts().length, app.productCount);
});

test("el color se combina con los demás filtros (AND, no OR)", () => {
  const ref = win.filteredProducts()[0];
  app.setFilters({ colorFilter: ref.color, sizeFilter: ref.size });
  const list = win.filteredProducts();

  assert.ok(list.length > 0);
  assert.ok(list.every(p => p.color === ref.color && p.size === ref.size));
});

test("un color sin prendas en la categoría activa vacía la grilla", () => {
  // Combinación legítima y sin resultados: debe verse el aviso, no una grilla
  // a medias con prendas que no cumplen.
  const azules = app.products.filter(p => p.color === "azul");
  app.setFilters({ colorFilter: "azul", activeCat: "Formal" });
  assert.ok(azules.length > 0 && !azules.some(p => p.cat === "Formal"));

  win.renderGrid();
  assert.equal(win.filteredProducts().length, 0);
  assert.equal(doc.getElementById("noResults").style.display, "block");
});

/* ---- Estado de los filtros ---- */
test("el color cuenta en el badge y en anyFilterActive", () => {
  assert.ok(!win.anyFilterActive());
  app.setFilters({ colorFilter: conPrendas() });

  assert.ok(win.anyFilterActive());
  assert.equal(win.activeFilterCount(), 1);
});

test("clearFilters devuelve el color a 'Todos'", () => {
  app.setFilters({ colorFilter: conPrendas() });
  win.clearFilters();

  assert.equal(app.colorFilter, "Todos");
  assert.equal(win.filteredProducts().length, app.productCount);
});

/* ---- Búsqueda ---- */
test("buscar un color encuentra prendas que no lo nombran en su texto", () => {
  // El blazer es negro pero ni su nombre ni su descripción lo dicen: antes solo
  // aparecía por casualidad, cuando el color estaba escrito en el copy.
  const blazer = app.products.find(p => p.id === 1);
  assert.equal(blazer.color, "negro");
  assert.ok(!/negro/i.test(`${blazer.name} ${blazer.desc}`));

  app.setFilters({ searchQuery: "negro" });
  assert.ok(win.filteredProducts().some(p => p.id === blazer.id));
});

/* ---- Botonera del panel ---- */
/** Botones del filtro de color en el panel, en orden de render. */
const botonesColor = () => [...doc.querySelectorAll('[data-filter="color"]')];

test("la botonera ofrece el banco entero de colores más 'Todos'", () => {
  win.renderFilterSheet();
  const opciones = botonesColor();

  assert.equal(opciones.length, app.COLORS.length + 1);
  assert.equal(opciones[0].dataset.value, "Todos");
  // Array.from: `app.COLORS` vive en el contexto vm y su prototipo no es el de
  // este realm, así que deepEqual estricto lo rechazaría aun con el mismo
  // contenido.
  assert.deepEqual(opciones.slice(1).map(o => o.dataset.value), Array.from(app.COLORS),
    "los botones deben seguir el orden del banco");
});

test("el color va en botones a la vista, no dentro de un desplegable", () => {
  // Catorce opciones plegadas obligan a abrir y recorrer una lista larga para
  // lo que la vista resuelve de un vistazo, y un <option> no admite la muestra
  // de color dentro.
  win.renderFilterSheet();
  assert.equal(doc.getElementById("fColor"), null);
  for (const b of botonesColor()) assert.equal(b.closest(".fs-opts"), null);
});

test("cada botón lleva su muestra de color y cuántas prendas hay", () => {
  // Con el banco completo hay colores sin prendas: el conteo evita que elegir
  // uno parezca un filtro roto en vez de un catálogo sin ese tono.
  win.renderFilterSheet();
  for (const c of app.COLORS) {
    const b = doc.querySelector(`[data-filter="color"][data-value="${c}"]`);
    assert.match(b.textContent, new RegExp(`${app.colorLabel(c)}\\s*${app.colorCount(c)}`));
    assert.ok(b.querySelector(".color-dot").getAttribute("style").includes(app.colorSwatch(c)),
      `el botón de ${c} debe pintar su muestra`);
  }
});

test("la botonera marca el color vigente", () => {
  const color = conPrendas();
  app.setFilters({ colorFilter: color });
  win.renderFilterSheet();
  assert.equal(doc.querySelector('[data-filter="color"][aria-pressed="true"]').dataset.value, color);

  win.clearFilters();
  win.renderFilterSheet();
  assert.equal(doc.querySelector('[data-filter="color"][aria-pressed="true"]').dataset.value, "Todos");
});

test("pulsar un color lo aplica, y volver a pulsarlo lo quita", () => {
  // Equivocarse no debe obligar a buscar 'Todos' al principio de la lista.
  const color = conPrendas();
  win.renderFilterSheet();

  win.setFilterValue("color", color);
  assert.equal(app.colorFilter, color);
  win.setFilterValue("color", color);
  assert.equal(app.colorFilter, "Todos");
});

test("elegir un color sin prendas deja la grilla vacía, no a medias", () => {
  const vacio = app.COLORS.find(c => app.colorCount(c) === 0);
  app.setFilters({ colorFilter: vacio });
  win.renderGrid();

  assert.equal(win.filteredProducts().length, 0);
  assert.equal(doc.getElementById("grid").innerHTML, "");
  assert.equal(doc.getElementById("noResults").style.display, "block");
});

test("el botón 'Limpiar' del panel se habilita con solo el color puesto", () => {
  app.setFilters({ colorFilter: conPrendas() });
  win.renderFilterSheet();
  assert.ok(!doc.querySelector('[data-action="clearFiltersSheet"]').hasAttribute("disabled"));
});

/* ---- Detalle ---- */
test("el detalle muestra el color de la prenda", () => {
  const p = app.products[0];
  win.openDetail(p.id);
  const html = doc.getElementById("sheetBody").innerHTML;

  assert.match(html, /<div class="k">Color<\/div>/);
  assert.match(html, new RegExp(app.colorLabel(p.color)));
});

test("una prenda sin color no rompe el detalle ni la búsqueda", () => {
  // Escenario real: hydrateCatalog() reemplaza el catálogo con lo que devuelva
  // una API anterior a este campo.
  const p = app.products[0];
  delete p.color;

  win.openDetail(p.id);
  assert.ok(!/<div class="k">Color<\/div>/.test(doc.getElementById("sheetBody").innerHTML));

  app.setFilters({ searchQuery: "negro" });
  assert.doesNotThrow(() => win.filteredProducts());
});
