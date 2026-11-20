/**
 * Los filtros de la app y la web se construyen con la taxonomía de la API
 * (fase 3): categorías, tallas por escala, materiales y colores son datos de
 * la base, no constantes del navegador.
 *
 * Se prueba con una taxonomía que el catálogo embebido no conoce (una categoría
 * nueva, un color nuevo, un material renombrado): si los filtros siguieran
 * leyendo las constantes, nada de eso aparecería.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadDom } = require("./helpers/load-dom.js");

/** Taxonomía de prueba: la de siempre más piezas que el navegador no conoce. */
function taxonomia() {
  return {
    categories: [
      { key: "formal", name: "Formal", prefix: "FOR" },
      { key: "playa", name: "Playa", prefix: "PLA" },
    ],
    colors: [
      { key: "negro", name: "Negro", hex: "#1e1e1e" },
      { key: "coral", name: "Coral", hex: "#ff7f50" },
      { key: "malo", name: "Malo", hex: "red;background:url(x)" },
    ],
    materials: [
      { key: "algodon", name: "Algodón orgánico" },
      { key: "lana", name: "Lana" },
    ],
    sizes: [
      { scale: "ROPA", label: "S" },
      { scale: "ROPA", label: "M" },
      { scale: "CALZADO", label: "38" },
    ],
  };
}

test("los chips de categoría salen de la API", async () => {
  const { app, fake, document } = loadDom();
  fake.state.taxonomy = taxonomia();
  assert.ok(await app.hydrateCatalog());
  app.renderFilters();
  const chips = [...document.querySelectorAll("#filters .chip")].map(b => b.textContent);
  assert.deepEqual(chips, ["Todo", "Formal", "Playa"]);
});

test("colores y materiales del filtro son los de la API, con sus nombres", async () => {
  const { app, fake, document } = loadDom();
  fake.state.taxonomy = taxonomia();
  await app.hydrateCatalog();
  app.view = "filters";
  app.renderSheet();
  const html = document.getElementById("sheetBody").innerHTML;
  assert.match(html, /Coral/, "un color nuevo de la base aparece en el filtro");
  assert.match(html, /Algodón orgánico/, "el nombre del material es el de la base");
  assert.doesNotMatch(html, /url\(x\)/, "una muestra que no es un hex no llega al style");
});

test("las tallas y materiales presentes se recalculan con el catálogo de la API", async () => {
  const { app, fake } = loadDom();
  fake.state.taxonomy = taxonomia();
  await app.hydrateCatalog();
  // Solo quedan las tallas que la taxonomía conoce Y alguna prenda usa.
  for (const s of app.SIZES) assert.ok(["S", "M", "38"].includes(s), `talla inesperada ${s}`);
  for (const m of app.MATERIALS) assert.ok(["algodon", "lana"].includes(m), `material inesperado ${m}`);
});

test("un nombre de categoría de la base se escapa", async () => {
  const { app, fake, document } = loadDom();
  const tax = taxonomia();
  tax.categories.push({ key: "x", name: '<img src=x onerror="alert(1)">', prefix: "XXX" });
  fake.state.taxonomy = tax;
  await app.hydrateCatalog();
  app.renderFilters();
  assert.equal(document.querySelectorAll('#filters img[onerror]').length, 0);
});

test("sin taxonomía de la API, los filtros siguen con las listas de respaldo", async () => {
  const { app, document } = loadDom();
  await app.hydrateCatalog();
  app.renderFilters();
  const chips = [...document.querySelectorAll("#filters .chip")].map(b => b.textContent);
  assert.ok(chips.includes("Calzado"), "la lista embebida sigue ahí");
});
