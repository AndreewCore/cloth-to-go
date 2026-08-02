/**
 * Pruebas de las categorías DISFRACES y CALZADO.
 *
 * Son categorías demostrativas: enseñan que el catálogo no se agota en la ropa
 * de vestir. Lo que hay que vigilar no es que existan, sino lo que arrastran:
 * el calzado trae una escala de tallas propia (numérica), y las piezas nuevas
 * todavía no tienen foto, así que dependen del placeholder para no salir como
 * una tarjeta rota.
 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadDom } = require("./helpers/load-dom.js");

let win, doc, app;

/** Prendas del catálogo de una categoría. */
const enCat = cat => app.products.filter(p => p.cat === cat);

beforeEach(() => {
  const env = loadDom();
  win = env.window;
  doc = env.document;
  app = env.app;
});

/* ---- Las categorías ---- */
test("el catálogo ofrece disfraces y calzado, y ambas tienen prendas", () => {
  for (const cat of ["Disfraces", "Calzado"]) {
    assert.ok(app.CATS.includes(cat), `falta la categoría ${cat}`);
    assert.ok(enCat(cat).length >= 3, `${cat} necesita prendas de muestra`);
  }
});

test("las prendas nuevas declaran todo lo que el resto del catálogo exige", () => {
  // Un campo que falte no revienta al renderizar: deja el precio, el ahorro de
  // agua o el filtro mintiendo en silencio, que es peor.
  for (const p of [...enCat("Disfraces"), ...enCat("Calzado")]) {
    assert.ok(app.COLORS.includes(p.color), `${p.name} trae un color fuera del banco`);
    assert.ok(p.material && p.weightKg > 0, `${p.name} necesita material y peso`);
    assert.equal(p.disponibles, 1);
    assert.ok(app.garmentWater(p) > 0, `${p.name} debe aportar ahorro de agua`);
  }
});

test("el chip de categoría aparece en la barra de filtros", () => {
  win.renderFilters();
  const chips = [...doc.querySelectorAll("[data-cat]")].map(c => c.dataset.cat);
  assert.ok(chips.includes("Disfraces"));
  assert.ok(chips.includes("Calzado"));
});

test("filtrar por categoría deja solo esas prendas", () => {
  for (const cat of ["Disfraces", "Calzado"]) {
    app.setFilters({ activeCat: cat });
    const list = win.filteredProducts();
    assert.ok(list.length > 0);
    assert.ok(list.every(p => p.cat === cat));
  }
});

/* ---- Dos escalas de talla ---- */
test("sizeScale distingue el calzado por la talla, no por la categoría", () => {
  // Un disfraz puede traer botas: manda lo que declara la prenda.
  assert.equal(app.sizeScale("39"), "calzado");
  assert.equal(app.sizeScale("M"), "ropa");
  // Una talla desconocida (catálogo hidratado por una API vieja) no debe dejar
  // la prenda fuera de las dos escalas.
  assert.equal(app.sizeScale("única"), "ropa");
  assert.equal(app.sizeScale(undefined), "ropa");
});

test("el calzado no usa S/M/L", () => {
  for (const p of enCat("Calzado")) {
    assert.equal(app.sizeScale(p.size), "calzado", `${p.name} debería numerarse`);
  }
});

test("sizesInScale solo ofrece tallas que el catálogo tiene, en su orden", () => {
  for (const escala of app.SIZE_SCALES) {
    const tallas = app.sizesInScale(escala.id);
    assert.ok(tallas.every(s => app.products.some(p => p.size === s)),
      `${escala.id} ofrece una talla sin prendas`);
    // Array.from en los dos lados: las listas nacen en el contexto vm y su
    // prototipo no es el de este realm, así que deepEqual estricto las rechaza
    // aun con el mismo contenido.
    assert.deepEqual(Array.from(tallas), Array.from(escala.order).filter(s => tallas.includes(s)),
      `${escala.id} debe seguir el orden de su escala`);
  }
  assert.ok(app.sizesInScale("calzado").length > 0);
  assert.equal(app.sizesInScale("inventada").length, 0);
});

test("filtrar por una talla de calzado no arrastra ropa de esa categoría", () => {
  const zapato = enCat("Calzado")[0];
  app.setFilters({ sizeFilter: zapato.size });
  const list = win.filteredProducts();

  assert.ok(list.length > 0);
  assert.ok(list.every(p => p.size === zapato.size));
  assert.ok(list.every(p => app.sizeScale(p.size) === "calzado"));
});

/* ---- El panel de filtros ---- */
test("el grupo de talla separa las escalas con su rótulo", () => {
  // "M" y "39" en una sola fila corrida parecen la misma regla con un salto
  // raro a la mitad.
  win.renderFilterSheet();
  const grupo = doc.querySelector('.fs-group[data-group="size"]');
  const rotulos = [...grupo.querySelectorAll(".fs-sub")].map(s => s.textContent);

  assert.deepEqual(rotulos, ["Ropa", "Calzado"]);
});

test("cada bloque solo lista las tallas de su escala", () => {
  win.renderFilterSheet();
  const grupo = doc.querySelector('.fs-group[data-group="size"]');
  const bloques = [...grupo.querySelectorAll(".fs-chips")];
  // El primer bloque es "Todas", suelto; luego va uno por escala.
  const calzado = [...bloques.at(-1).querySelectorAll("[data-filter='size']")]
    .map(b => b.dataset.value);

  assert.deepEqual(calzado, Array.from(app.sizesInScale("calzado")));
  assert.ok(calzado.every(s => app.sizeScale(s) === "calzado"));
});

test("el cabezal nombra la escala cuando la talla es de calzado", () => {
  // Un "39" suelto no dice si filtra pies o cinturas.
  const zapato = enCat("Calzado")[0];
  app.setFilters({ sizeFilter: zapato.size });
  win.renderFilterSheet();
  assert.equal(doc.querySelector('.fs-group[data-group="size"] .fs-head-v').textContent,
    `Calzado ${zapato.size}`);

  app.setFilters({ sizeFilter: "M" });
  win.renderFilterSheet();
  assert.equal(doc.querySelector('.fs-group[data-group="size"] .fs-head-v').textContent, "M");
});

/* ---- Las fotos ---- */
test("cada pieza de muestra trae su foto, como el resto del catálogo", () => {
  // Estas categorías existen para demostrar amplitud de catálogo: una tarjeta
  // sin foto demuestra lo contrario, y seis marcos vacíos junto a diez prendas
  // fotografiadas se leen como una sección a medio hacer.
  for (const p of [...enCat("Disfraces"), ...enCat("Calzado")]) {
    assert.ok(win.coverImage(p), `${p.name} debe tener portada`);
    assert.match(win.coverImage(p), /^img\/products\/\d+\.webp$/);
  }
});

test("la tarjeta pinta la foto y conserva el placeholder de respaldo", () => {
  // El placeholder no se va: sigue siendo lo que queda si la imagen no carga.
  const p = enCat("Calzado")[0];
  win.renderGrid();
  const card = [...doc.querySelectorAll(".card")]
    .find(c => c.textContent.includes(p.name));

  assert.equal(card.querySelector("img").getAttribute("src"), win.coverImage(p));
  assert.ok(card.querySelector(".img-ph"), "el respaldo debe seguir ahí");
});

/* ---- El precio sigue siendo honesto ---- */
test("ningún disfraz ni zapato se alquila por debajo de su coste de ciclo", () => {
  // La invariante del modelo de precios: el lavado cuesta lo mismo salga la
  // prenda un día o diez.
  for (const p of [...enCat("Disfraces"), ...enCat("Calzado")]) {
    for (const dias of [1, 3, 7, 14]) {
      assert.ok(win.rentalPrice(p, dias) >= win.cycleCost(p) - 1e-9,
        `${p.name} baja del coste de ciclo a ${dias} días`);
    }
  }
});
