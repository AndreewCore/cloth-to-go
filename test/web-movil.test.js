/**
 * El sitio `web/` en el teléfono.
 *
 * jsdom no maqueta, así que el aspecto se comprobó con capturas a 360, 390, 768
 * y 1024 px. Lo que sí se puede fijar aquí son las reglas que lo sostienen,
 * para que un cambio de estilos no las borre sin que nadie lo note. Cada una
 * corresponde a algo que estaba roto:
 * - a 768 px los enlaces y «Iniciar sesión» se partían en dos líneas;
 * - a 360 px la cabecera no cabía y el catálogo iba en una sola columna;
 * - el botón «Instalar la app» del menú tenía el texto gris sobre verde;
 * - el filtro de calidad usaba glifos (▰▱) que muchos teléfonos no tienen.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const CSS = fs.readFileSync(path.join(ROOT, "web", "css", "web.css"), "utf8");

/**
 * Devuelve el cuerpo de un bloque `@media` por su condición exacta.
 * Cuenta llaves en vez de usar una expresión regular porque los bloques llevan
 * reglas anidadas dentro.
 * @param {string} condicion Texto entre paréntesis, p. ej. "max-width: 760px".
 * @returns {string} El CSS de dentro del bloque, o "" si no existe.
 */
function mediaBlock(condicion){
  const inicio = CSS.indexOf(`@media (${condicion}) {`);
  if(inicio < 0) return "";
  let i = CSS.indexOf("{", inicio) + 1;
  const desde = i;
  for(let prof = 1; prof > 0; i++){
    if(CSS[i] === "{") prof++;
    else if(CSS[i] === "}") prof--;
  }
  return CSS.slice(desde, i - 1);
}

/**
 * Busca las declaraciones de un selector que abre línea en un trozo de CSS.
 * @param {string} css Trozo donde buscar.
 * @param {string} selector Selector exacto, tal como está escrito.
 * @returns {string} Las declaraciones, o "" si el selector no aparece.
 */
function rule(css, selector){
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Al principio de línea: así `.ghost-btn` no se confunde con el final de
  // `.top.over .ghost-btn`, que es otra regla.
  const m = css.match(new RegExp(`(?:^|\\n)[ \\t]*${esc}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : "";
}

test("el menú pasa a hamburguesa a 1000 px, antes de que los enlaces se partan", () => {
  const b = mediaBlock("max-width: 1000px");
  assert.match(rule(b, ".burger"), /display:\s*flex/);
  assert.match(rule(b, ".nav:not(.open)"), /display:\s*none/);
});

test("los textos de la cabecera no se parten en dos líneas", () => {
  assert.match(rule(CSS, ".ghost-btn"), /white-space:\s*nowrap/);
  assert.match(rule(CSS, ".nav a"), /white-space:\s*nowrap/);
});

test("en el teléfono el catálogo va a dos columnas", () => {
  const b = mediaBlock("max-width: 760px");
  assert.match(rule(b, ".grid"), /repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  // Una columna 1fr no baja de su contenido mínimo e impedía las dos.
  assert.match(rule(mediaBlock("max-width: 1000px"), ".layout"), /minmax\(0,\s*1fr\)/);
});

test("a 420 px el logotipo pierde la palabra para que quepan los botones", () => {
  assert.match(rule(mediaBlock("max-width: 420px"), ".brand span"), /display:\s*none/);
});

test("«Instalar la app» del menú gana a `.nav a` y lleva texto blanco", () => {
  assert.match(rule(mediaBlock("max-width: 760px"), ".nav .nav-install"), /color:\s*#fff/);
});

test("el filtro de calidad dibuja el medidor, no los glifos ▰▱", () => {
  const html = fs.readFileSync(path.join(ROOT, "web", "index.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/web/" });
  const archivos = ["js/icons.js", "js/data.js", "js/state.js", "js/api.js", "web/js/session.js", "web/js/catalog.js"];
  const src = archivos.map(f => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n;\n");
  dom.window.eval(src + "\n;renderFilters();");

  const panel = dom.window.document.getElementById("filterPanel");
  const chips = [...panel.querySelectorAll('[data-action="quality"]')];
  assert.ok(chips.length > 1, "debe haber pastillas de calidad");
  for(const chip of chips.filter(c => c.dataset.value !== "0")){
    assert.ok(chip.querySelector(".qmeter"), "cada nivel lleva el medidor dibujado");
    assert.doesNotMatch(chip.textContent, /[▰▱]/);
  }
});
