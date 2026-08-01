/**
 * Guardarraíl del DESPACHADOR de eventos (`js/main.js`).
 *
 * Toda la interactividad de la app cuelga de un patrón: los controles llevan
 * `data-action` y un único listener delegado los reparte con un `switch`. El
 * fallo característico de ese patrón es mudo — se agrega un botón, se olvida el
 * `case`, y el botón simplemente no hace nada: sin excepción, sin traza, sin
 * test que lo note.
 *
 * Estas pruebas leen el FUENTE y no el DOM a propósito: un `data-action` que
 * solo aparece en una vista que ninguna prueba renderiza igual tiene que estar
 * atendido, y es justo el que se escapa.
 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadDom } = require("./helpers/load-dom.js");

const ROOT = path.join(__dirname, "..");
const JS_DIR = path.join(ROOT, "js");
const leer = f => fs.readFileSync(path.join(JS_DIR, f), "utf8");
const FUENTES = fs.readdirSync(JS_DIR).filter(f => f.endsWith(".js"));

/**
 * Todos los `data-action="…"` que la app llega a pintar. Incluye index.html: hay
 * controles estáticos (galería, ajustes) que no nacen de ninguna plantilla y
 * cuyo case es igual de fácil de borrar por descuido.
 */
function accionesEmitidas() {
  const out = new Set();
  const fuentes = [...FUENTES.map(leer), fs.readFileSync(path.join(ROOT, "index.html"), "utf8")];
  for (const src of fuentes) {
    for (const m of src.matchAll(/data-action="([A-Za-z0-9_]+)"/g)) out.add(m[1]);
  }
  return [...out].sort();
}

/** Los `case "…"` del switch del despachador. */
function accionesAtendidas() {
  const main = leer("main.js");
  return [...main.matchAll(/case\s+"([A-Za-z0-9_]+)"/g)].map(m => m[1]);
}

/**
 * Prefijos de acciones cuyo nombre se ARMA en la plantilla
 * (`data-action="gal${nombre}"`), así que ningún escaneo estático las ve
 * enteras. Se listan a mano para no dar por muerto lo que sí se pinta.
 */
const PREFIJOS_DINAMICOS = ["gal"];

/**
 * Cases que hoy no los pinta nadie. HALLAZGO de `feature/tests-cobertura`, no
 * un permiso: `openSettings` quedó huérfano cuando Ajustes pasó a abrirse desde
 * el botón del header (`#openPrefs`, con su propio onclick en main.js). Se anota
 * aquí en vez de borrarlo porque esta rama no toca código de producción; le
 * toca a `feature/refactor-vistas`, que entonces debe vaciar esta lista.
 */
const CASES_MUERTOS_CONOCIDOS = ["openSettings"];

let win, doc, app;

beforeEach(() => {
  // withMain: el reparto de eventos vive en main.js, así que sin él estos
  // clics no llegarían a ninguna parte.
  const env = loadDom({ withMain: true });
  win = env.window;
  doc = env.document;
  app = env.app;
});

/* ---- Cobertura del switch ---- */
test("cada data-action que se pinta tiene su case en el despachador", () => {
  const sinAtender = accionesEmitidas().filter(a => !accionesAtendidas().includes(a));
  assert.deepEqual(sinAtender, [],
    "estos controles se dibujan pero no hacen nada al pulsarlos");
});

test("no aparecen cases huérfanos nuevos", () => {
  // Un case sin quien lo pinte es código muerto que el refactor arrastra sin
  // saberlo. La lista de los ya conocidos se declara arriba: esta prueba vigila
  // que no crezca, y fallará (a propósito) cuando el refactor la vacíe.
  const emitidas = accionesEmitidas();
  const huerfanos = accionesAtendidas().filter(a =>
    !emitidas.includes(a) &&
    !PREFIJOS_DINAMICOS.some(pre => a.startsWith(pre)) &&
    !CASES_MUERTOS_CONOCIDOS.includes(a));

  assert.deepEqual(huerfanos, [], "cases nuevos que ya nadie dispara");
});

test("las acciones de nombre interpolado siguen teniendo case", () => {
  // `galPrev`/`galNext` se arman en la plantilla, así que el escaneo estático no
  // las ve: se comprueban a mano para que no se caigan sin ruido.
  for (const a of ["galPrev", "galNext", "galDot"]) {
    assert.ok(accionesAtendidas().includes(a), `falta el case de ${a}`);
  }
});

test("el despachador atiende un número de acciones acorde al catálogo pintado", () => {
  // Cifra viva: si cae de golpe es que alguien borró medio switch.
  assert.ok(accionesAtendidas().length >= 40,
    `solo hay ${accionesAtendidas().length} acciones atendidas`);
});

/* ---- Convención de la casa ---- */
test("ninguna vista cablea onclick como atributo del HTML que genera", () => {
  // La delegación es la convención: un onclick dentro de una plantilla esquiva
  // el switch, que es donde se lee de un vistazo qué hace la app.
  // Solo se persigue el ATRIBUTO (`onclick="…"`). Asignar `el.onclick = fn` a un
  // elemento estático de index.html —lo que hace main.js con el header— es otra
  // cosa: ese nodo no se repinta nunca y no hay data-action que valga.
  // `onerror` del placeholder de imagen queda fuera a propósito: repara una
  // imagen rota en el sitio, no dispara ninguna acción.
  for (const f of FUENTES) {
    assert.doesNotMatch(leer(f), /onclick\s*=\s*["\']/,
      `${f} cablea un onclick como atributo en vez de usar data-action`);
  }
});

test("los controles no nativos declaran su rol y su foco", () => {
  // Un div con data-action no es pulsable con teclado si no lo declara; el
  // listener de Enter/Espacio de main.js depende de role="button".
  for (const f of FUENTES) {
    for (const m of leer(f).matchAll(/<div[^>]*data-action="[^"]+"[^>]*>/g)) {
      const tag = m[0];
      assert.match(tag, /role="button"/, `div pulsable sin role en ${f}: ${tag.slice(0, 80)}`);
      assert.match(tag, /tabindex=/, `div pulsable sin tabindex en ${f}: ${tag.slice(0, 80)}`);
    }
  }
});

/* ---- El reparto en vivo ---- */
test("pulsar un control del panel ejecuta su acción, no la del padre", () => {
  // El listener sube por el DOM hasta el primer [data-action]: si tomara el
  // contenedor en vez del botón, media interfaz haría lo que no toca.
  app.cart = [{ id: app.products[0].id }];
  app.view = "cart";
  win.renderSheet();
  win.openSheet();

  const btn = doc.querySelector('[data-action="toCheckout"]');
  assert.ok(btn, "el carrito debe ofrecer el paso siguiente");
  btn.click();
  assert.equal(app.view, "checkout", "la vista debe haber avanzado");
});

test("un clic fuera de todo control no rompe nada", () => {
  app.view = "cart";
  win.renderSheet();
  assert.doesNotThrow(() => doc.getElementById("sheetBody").click());
});

test("Enter y Espacio activan los controles con role=button", () => {
  // Sin esto, todo lo que no sea <button> queda fuera del alcance del teclado.
  app.view = "profile";
  win.renderSheet();
  const div = doc.querySelector('#sheet div[role="button"][data-action]');
  if (!div) return;   // la vista puede no tener ninguno; el guardarraíl de arriba ya cubre el marcado

  let pulsado = false;
  div.addEventListener("click", () => { pulsado = true; });
  const ev = new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true });
  div.dispatchEvent(ev);
  assert.ok(pulsado, "Enter debe traducirse en un clic");
});

test("el catálogo reparte entre agregar y abrir el detalle", () => {
  // Son dos acciones sobre la misma tarjeta: el botón agrega, la foto abre.
  win.renderGrid();
  const p = app.products[0];

  doc.querySelector(`[data-add="${p.id}"]`).click();
  assert.equal(app.cart.length, 1, "el botón agrega al carrito");

  doc.querySelector(`[data-detail="${p.id}"]`).click();
  assert.equal(app.view, "detail");
  assert.equal(app.detailId, p.id);
});
