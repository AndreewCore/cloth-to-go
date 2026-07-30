/**
 * Guardarraíl del COPY de cara al cliente: ninguna pantalla debe presentar las
 * prendas como ropa de segunda mano.
 *
 * Es una decisión de posicionamiento, no de estilo: lo que se vende es la
 * exclusividad de una prenda única, no que venga usada. El modelo sigue
 * calculando sobre `value` (coste de reposición de segunda mano en Ecuador), y
 * los comentarios del código siguen llamándolo por su nombre — esta prueba solo
 * mira el texto RENDERIZADO, así que no choca con la documentación interna.
 *
 * Se prueba sobre el DOM real y no sobre el código fuente a propósito: un
 * grep del fuente daría falsos positivos en cada comentario, y lo que importa
 * es lo que acaba en pantalla.
 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadDom } = require("./helpers/load-dom.js");

// "segunda mano" y sus variantes de reventa. `usado/usada` entra porque era el
// vocabulario de las etiquetas de condición; se excluye la forma verbal
// ("se usa", "usado en") con el límite de palabra sobre el adjetivo.
const PROHIBIDO = /segunda mano|segundamano|de reventa|reacondicionad[oa]|\busad[oa]s?\b/i;

let win, doc, app;

beforeEach(() => {
  const env = loadDom();
  win = env.window;
  doc = env.document;
  app = env.app;
});

/**
 * Texto visible de un nodo, normalizado para que el assert sea legible cuando
 * falla (el innerHTML crudo llenaría la salida de marcado).
 */
function visibleText(el) {
  return (el.textContent || "").replace(/\s+/g, " ").trim();
}

test("la grilla del catálogo no presenta las prendas como usadas", () => {
  win.renderGrid();
  const texto = visibleText(doc.getElementById("grid"));

  assert.ok(texto.length > 0, "la grilla debe renderizar algo");
  assert.doesNotMatch(texto, PROHIBIDO);
});

test("el detalle de TODAS las prendas evita el vocabulario de segunda mano", () => {
  // Una por una: la línea de disponibilidad cambia según el stock y la
  // etiqueta de condición según las estrellas, así que un solo producto no
  // ejercita las dos ramas.
  for (const p of app.products) {
    app.openDetail(p.id);
    const texto = visibleText(doc.getElementById("sheet"));
    assert.doesNotMatch(texto, PROHIBIDO, `detalle de "${p.name}"`);
  }
});

test("la línea de disponibilidad del detalle habla de prenda única", () => {
  const p = app.products[0];
  app.openDetail(p.id);
  const avail = visibleText(doc.querySelector(".detail-avail"));

  assert.match(avail, /prenda única/i);
  assert.doesNotMatch(avail, PROHIBIDO);
});

test("el carrito tampoco lo dice al listar las prendas", () => {
  app.cart = app.products.slice(0, 3).map(p => ({ id: p.id }));
  app.view = "cart";
  app.renderSheet();

  const texto = visibleText(doc.getElementById("sheet"));
  assert.ok(texto.length > 0, "el carrito debe renderizar algo");
  assert.doesNotMatch(texto, PROHIBIDO);
});

test("el catálogo embebido no lo dice en nombres ni descripciones", () => {
  // Cierra la puerta por donde volvería más fácil: una prenda nueva descrita
  // como "blazer de segunda mano" se cuela sin tocar ninguna vista.
  for (const p of app.products) {
    assert.doesNotMatch(p.name, PROHIBIDO, `nombre de la prenda ${p.id}`);
    assert.doesNotMatch(p.desc, PROHIBIDO, `descripción de "${p.name}"`);
  }
});

test("el marcado estático de index.html está limpio", () => {
  // El texto del HTML antes de que la app pinte nada: bienvenida, cabecera y
  // los rótulos fijos del panel.
  const { document: docLimpio } = loadDom();
  assert.doesNotMatch(visibleText(docLimpio.body), PROHIBIDO);
});
