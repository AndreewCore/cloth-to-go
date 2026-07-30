/**
 * Guardarraíl de las IMÁGENES del repositorio.
 *
 * Todo lo que la app sirve va en webp: pesa la mitad que un PNG equivalente y
 * el proyecto ya dependía de ese formato para las fotos del catálogo, así que
 * mantener un PNG suelto solo sumaba peso sin ganar compatibilidad.
 *
 * La prueba mira el disco y el marcado, no el DOM renderizado: un enlace roto a
 * una imagen no lanza ningún error en jsdom — simplemente no se ve nada, que es
 * la clase de fallo que llega hasta producción.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

/** Rutas de imagen que aparecen en un archivo de texto del proyecto. */
function imagenesCitadas(rel) {
  const txt = fs.readFileSync(path.join(ROOT, rel), "utf8");
  return [...txt.matchAll(/(?:src=|url\()["']?(img\/[^"')\s]+)/g)].map(m => m[1]);
}

test("no queda ninguna imagen que no sea webp en img/", () => {
  const sueltas = [];
  const recorrer = dir => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) recorrer(rel);
      else if (!/\.webp$/i.test(e.name)) sueltas.push(rel);
    }
  };
  recorrer("img");
  assert.deepEqual(sueltas, [], "todo lo de img/ debe ser webp");
});

test("las imágenes citadas en index.html existen en disco", () => {
  // Un src equivocado no falla en jsdom: se ve un hueco y nada más.
  for (const ruta of imagenesCitadas("index.html")) {
    assert.ok(fs.existsSync(path.join(ROOT, decodeURIComponent(ruta))),
      `index.html apunta a ${ruta}, que no existe`);
  }
});

test("las fotos del catálogo existen en disco", () => {
  const data = fs.readFileSync(path.join(ROOT, "js", "data.js"), "utf8");
  const rutas = [...data.matchAll(/"(img\/products\/[^"]+)"/g)].map(m => m[1]);

  assert.ok(rutas.length >= 10, "debe haber al menos una foto por prenda");
  for (const ruta of rutas) {
    assert.ok(fs.existsSync(path.join(ROOT, ruta)), `falta la foto ${ruta}`);
  }
});

test("el nombre del logo no necesita escaparse en una URL", () => {
  // Se llamaba "Cloth To Go Logo.png" y obligaba a escribir %20 en cada
  // referencia; un espacio olvidado dejaba la marca sin logo.
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.doesNotMatch(html, /%20/, "ninguna ruta debería llevar espacios");
});
