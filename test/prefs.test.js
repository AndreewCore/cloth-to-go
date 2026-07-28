/**
 * Pruebas de las preferencias de presentación (tema y accesibilidad).
 *
 * Lo que se comprueba no es que el CSS pinte bien —eso no se puede afirmar en
 * jsdom— sino el contrato del que depende el CSS: qué atributos quedan en
 * <html>, que la elección sobreviva a la recarga, y que no dependa de la sesión.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadDom } = require("./helpers/load-dom.js");

/** Atajo: el <html> del documento cargado. */
function root(env) {
  return env.document.documentElement;
}

/* ---- Valores por defecto ---- */

test("sin nada guardado arranca en automático y sin ajustes activos", () => {
  const env = loadDom();
  const p = env.app.getPrefs();
  assert.equal(p.theme, "auto");
  assert.equal(p.textSize, "normal");
  assert.equal(p.reduceMotion, false);
  assert.equal(p.highContrast, false);
});

test("el tema queda aplicado en <html> antes de cualquier render", () => {
  // Es lo que evita el parpadeo de tema claro al cargar en modo oscuro.
  const env = loadDom();
  assert.match(root(env).dataset.theme, /^(light|dark)$/);
  assert.equal(root(env).dataset.textSize, "normal");
  assert.equal(root(env).dataset.contrast, "normal");
});

/* ---- Persistencia ---- */

test("la preferencia guardada se respeta al cargar", () => {
  const env = loadDom({
    storage: { "clothToGo:prefs": JSON.stringify({ theme: "dark", textSize: "mayor" }) }
  });
  assert.equal(env.app.getPrefs().theme, "dark");
  assert.equal(root(env).dataset.theme, "dark");
  assert.equal(root(env).dataset.textSize, "mayor");
});

test("un JSON corrupto no impide arrancar: se cae a los valores por defecto", () => {
  const env = loadDom({ storage: { "clothToGo:prefs": "{ esto no es json" } });
  assert.equal(env.app.getPrefs().theme, "auto");
});

test("una preferencia nueva no rompe a quien guardó la versión anterior", () => {
  // Se mezcla con DEFAULT_PREFS en vez de reemplazar: los campos ausentes
  // toman su valor por defecto en lugar de quedar en undefined.
  const env = loadDom({ storage: { "clothToGo:prefs": JSON.stringify({ theme: "dark" }) } });
  assert.equal(env.app.getPrefs().textSize, "normal");
  assert.equal(env.app.getPrefs().reduceMotion, false);
});

test("setPref persiste en localStorage", () => {
  const env = loadDom();
  env.app.setPref("textSize", "grande");
  const guardado = JSON.parse(env.window.localStorage.getItem("clothToGo:prefs"));
  assert.equal(guardado.textSize, "grande");
  assert.equal(root(env).dataset.textSize, "grande");
});

/* ---- Independencia de la sesión ----
   Es la razón de que prefs.js no viva en state.js: quien sube la letra por baja
   visión no debe perderla al cerrar sesión ni al entrar como invitado. */

test("las preferencias no se guardan bajo la clave del usuario", () => {
  const env = loadDom();
  env.app.setPref("highContrast", true);
  assert.ok(env.window.localStorage.getItem("clothToGo:prefs"));
  assert.ok(
    !env.app.STORAGE_PREFIX || !"clothToGo:prefs".startsWith(env.app.STORAGE_PREFIX),
    "la clave de preferencias no debe colgar del prefijo por usuario"
  );
});

test("cerrar sesión no borra las preferencias", () => {
  const env = loadDom();
  env.app.setPref("textSize", "mayor");
  env.window.activateUserSession(null);   // reinicia el estado del usuario
  assert.equal(env.app.getPrefs().textSize, "mayor");
  assert.equal(root(env).dataset.textSize, "mayor");
});

/* ---- Interruptor de tema ---- */

test("toggleTheme sale de 'auto' y fija una elección explícita", () => {
  // Quedarse en automático haría que el sistema revirtiera al usuario la
  // decisión que acaba de tomar a mano.
  const env = loadDom();
  const antes = env.app.effectiveTheme();
  const nuevo = env.window.toggleTheme();
  assert.notEqual(nuevo, "auto");
  assert.notEqual(env.app.effectiveTheme(), antes);
});

test("toggleTheme alterna de ida y vuelta", () => {
  const env = loadDom();
  const inicial = env.app.effectiveTheme();
  env.window.toggleTheme();
  env.window.toggleTheme();
  assert.equal(env.app.effectiveTheme(), inicial);
});

test("el botón de tema anuncia el destino, no el estado actual", () => {
  const env = loadDom({ storage: { "clothToGo:prefs": JSON.stringify({ theme: "light" }) } });
  env.window.renderThemeButton();
  const btn = env.document.getElementById("toggleTheme");
  assert.match(btn.getAttribute("aria-label"), /oscuro/i);
  env.window.toggleTheme();
  assert.match(btn.getAttribute("aria-label"), /claro/i);
});

/* ---- Accesibilidad ---- */

test("reducir animaciones marca <html> para que el CSS las suprima", () => {
  const env = loadDom();
  env.app.setPref("reduceMotion", true);
  assert.equal(root(env).dataset.reduceMotion, "true");
});

test("el contraste alto se refleja en <html>", () => {
  const env = loadDom();
  env.app.setPref("highContrast", true);
  assert.equal(root(env).dataset.contrast, "high");
});

test("cada tamaño de texto fija su escala como variable CSS", () => {
  const env = loadDom();
  for (const [tam, escala] of [["normal", "1"], ["grande", "1.15"], ["mayor", "1.3"]]) {
    env.app.setPref("textSize", tam);
    assert.equal(root(env).style.getPropertyValue("--text-scale"), escala);
  }
});

/* ---- El botón de encuesta se retiró ---- */

test("ya no existe el botón de encuesta en el header", () => {
  const env = loadDom();
  assert.equal(env.document.getElementById("openSurvey"), null);
  assert.ok(env.document.getElementById("toggleTheme"), "su lugar lo ocupa el tema");
});

/* ---- La vista de ajustes ---- */

test("la vista de ajustes ofrece los cuatro controles", () => {
  const env = loadDom();
  env.window.renderSettings();
  const html = env.document.getElementById("sheetBody").innerHTML;
  assert.match(html, /data-pref="theme"/);
  assert.match(html, /data-pref="textSize"/);
  assert.match(html, /data-pref="reduceMotion"/);
  assert.match(html, /data-pref="highContrast"/);
});

test("la opción activa se marca con aria-pressed", () => {
  const env = loadDom({ storage: { "clothToGo:prefs": JSON.stringify({ textSize: "grande" }) } });
  env.window.renderSettings();
  const activa = env.document.querySelector('[data-pref="textSize"][data-value="grande"]');
  assert.equal(activa.getAttribute("aria-pressed"), "true");
  assert.ok(activa.classList.contains("active"));
});

test("los interruptores exponen su estado con role=switch", () => {
  const env = loadDom({ storage: { "clothToGo:prefs": JSON.stringify({ reduceMotion: true }) } });
  env.window.renderSettings();
  const sw = env.document.querySelector('[data-pref="reduceMotion"]');
  assert.equal(sw.getAttribute("role"), "switch");
  assert.equal(sw.getAttribute("aria-checked"), "true");
});

test("desde ajustes, el botón atrás vuelve al perfil", () => {
  const env = loadDom();
  assert.equal(env.app.SHEET_BACK.settings, "profile");
});

/* ---- Contrato del tema en CSS ----
   Estas pruebas nacen de un fallo real: el tema oscuro salió con campos de
   formulario ilegibles, el chip activo en blanco sobre blanco y el logo
   invisible. Ninguna prueba de DOM podía verlo, porque el fallo estaba en la
   hoja de estilos. Se comprueba el contrato que el CSS debe cumplir. */
const fs = require("node:fs");
const path = require("node:path");

const BASE_CSS = fs.readFileSync(path.join(__dirname, "..", "css", "base.css"), "utf8");
const COMP_CSS = fs.readFileSync(path.join(__dirname, "..", "css", "components.css"), "utf8");

/** Cuerpo de una regla CSS por su selector exacto. */
function bloque(css, selector) {
  const i = css.indexOf(selector + " {");
  assert.notEqual(i, -1, `no se encontró la regla ${selector}`);
  return css.slice(i, css.indexOf("}", i));
}

test("ambos temas declaran color-scheme", () => {
  // Sin esto el navegador pinta los controles nativos (inputs, selector de
  // fecha, scrollbars) con su estilo claro sobre fondo oscuro.
  assert.match(bloque(BASE_CSS, ":root"), /color-scheme:\s*light/);
  assert.match(bloque(BASE_CSS, ':root[data-theme="dark"]'), /color-scheme:\s*dark/);
});

test("cada variable del tema claro tiene su equivalente en el oscuro", () => {
  // Una variable sin par queda con el valor del tema claro sobre fondo oscuro,
  // que es exactamente cómo se colaron los campos ilegibles.
  const vars = (css) => new Set([...css.matchAll(/^\s*(--[a-z-]+):/gm)].map((m) => m[1]));
  const claro = vars(bloque(BASE_CSS, ":root"));
  const oscuro = vars(bloque(BASE_CSS, ':root[data-theme="dark"]'));
  // --text-scale la fija prefs.js en tiempo de ejecución, no el tema.
  const exentas = new Set(["--text-scale"]);
  const faltan = [...claro].filter((v) => !oscuro.has(v) && !exentas.has(v));
  assert.deepEqual(faltan, [], `sin equivalente en tema oscuro: ${faltan.join(", ")}`);
});

test("el chip activo se invierte con variables, no con blanco fijo", () => {
  const regla = bloque(COMP_CSS, ".chip.active");
  assert.match(regla, /background:\s*var\(--ink\)/);
  assert.match(regla, /color:\s*var\(--bg\)/);
  assert.doesNotMatch(regla, /#fff/);
});

test("ningún texto blanco fijo va sobre un relleno de --accent", () => {
  // --accent es verde CLARO en tema oscuro: el blanco encima desaparece.
  // Los degradados de --cta sí se mantienen oscuros en ambos temas.
  const sospechosas = [...COMP_CSS.matchAll(/\{[^}]*\}/g)]
    .map((m) => m[0])
    .filter((r) => /background:\s*var\(--accent\)/.test(r) && /color:\s*#fff/.test(r));
  assert.deepEqual(sospechosas, [], "usa var(--on-accent) en vez de #fff");
});

test("los campos de formulario fijan fondo y color propios", () => {
  // Heredar el estilo del navegador fue la causa de los inputs ilegibles.
  const i = COMP_CSS.indexOf(".ship-detail input,");
  assert.notEqual(i, -1, "debe existir el bloque común de campos");
  const regla = COMP_CSS.slice(i, COMP_CSS.indexOf("}", i));
  assert.match(regla, /background:\s*var\(--field\)/);
  assert.match(regla, /color:\s*var\(--ink\)/);
});

test("el logo recibe una base clara en tema oscuro", () => {
  // Es un PNG de trazo oscuro sobre fondo transparente: sin base, desaparece.
  assert.match(COMP_CSS, /:root\[data-theme="dark"\]\s*\.brand-logo\s*\{[^}]*background:/);
});

test("la bienvenida no lleva verdes fijos: es la primera pantalla del tema", () => {
  // Se quedaba en verde claro sobre una app en oscuro, delatando el tema antes
  // de que la app llegara a pintarse.
  const regla = bloque(COMP_CSS, ".login");
  assert.match(regla, /var\(--welcome-from\)/);
  assert.match(regla, /var\(--welcome-to\)/);
  assert.doesNotMatch(regla, /#[0-9a-fA-F]{6}/);
});
