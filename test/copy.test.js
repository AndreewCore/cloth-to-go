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

/* ---- El sitio web (web/) ----
   Es otra superficie con su propio texto: el HTML de la portada y sus vistas.
   La regla es la misma; antes de cubrirla aquí, «Prendas de segunda mano» llegó
   a producción en la cabecera del catálogo. */

const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

/**
 * Carga web/index.html con los scripts que no tienen efectos de arranque (todo
 * menos chat, water y main, que piden red y cablean eventos).
 *
 * Todo va en un único eval con un trailer que expone lo que las pruebas
 * necesitan: los `let`/`const` de un eval indirecto no se ven desde otro.
 * @returns {Window} Ventana de jsdom; `window.__WEB__` da acceso al estado.
 */
function loadWeb() {
  const ROOT = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(ROOT, "web", "index.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/web/" });
  const archivos = ["js/icons.js", "js/data.js", "js/state.js", "js/api.js",
                    "web/js/session.js", "web/js/catalog.js", "web/js/cart.js"];
  const trailer = `
    globalThis.__WEB__ = {
      ids: () => PRODUCTS.map(p => p.id),
      renderGrid, renderFilters, renderDetail,
      showDetail(id){ detailId = id; detailImg = 0; renderDetail(); },
      // Un pedido vigente con la prenda la marca como alquilada (isRented).
      rent(id){ orders = id == null ? [] : [{ id: 1, items: [id], start: isoOffset(-1), end: isoOffset(5), status: "pending" }]; },
    };`;
  dom.window.eval(archivos.map(f => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n;\n") + trailer);
  return dom.window;
}

test("web: el marcado estático (portada, quiénes somos, contacto) está limpio", () => {
  const w = loadWeb();
  // Sin los <script>: su código no es texto que se vea.
  w.document.querySelectorAll("script").forEach(s => s.remove());
  assert.doesNotMatch(visibleText(w.document.body), PROHIBIDO);
});

test("web: la grilla y el detalle de TODAS las prendas, libres o alquiladas", () => {
  const w = loadWeb();
  const web = w.__WEB__;
  web.renderFilters();
  web.renderGrid();
  assert.doesNotMatch(visibleText(w.document.getElementById("grid")), PROHIBIDO);

  for (const id of web.ids()) {
    for (const alquilada of [false, true]) {
      web.rent(alquilada ? id : null);
      web.showDetail(id);
      const texto = visibleText(w.document.getElementById("detailBody"));
      assert.ok(texto.length > 0, `el detalle de ${id} debe renderizar algo`);
      if (alquilada) assert.match(texto, /alquilada ahora mismo/i, `${id}: debe pintar la rama de prenda alquilada`);
      assert.doesNotMatch(texto, PROHIBIDO, `detalle de ${id}${alquilada ? " (alquilada)" : ""}`);
    }
  }
});
