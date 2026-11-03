/**
 * El conocimiento del chat (`knowledge/*.txt`) es lo que el modelo repite.
 *
 * Por posicionamiento, CLOTH TO GO no presenta sus prendas como «de segunda
 * mano» (ver `test/copy.test.js` del frontend): se habla de prendas únicas y
 * donadas. El chat solo puede decirlo si se lo preguntan, y para eso existe UNA
 * pregunta frecuente explícita. Esta prueba falla si la expresión aparece en
 * cualquier otro sitio de los documentos.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { KNOWLEDGE_DIR } from "../src/chat.js";

const FAQ = "¿La ropa es de segunda mano?";

test("«segunda mano» solo aparece en su pregunta frecuente", async () => {
  const names = (await readdir(KNOWLEDGE_DIR)).filter((n) => n.endsWith(".txt"));
  assert.ok(names.length > 0, "debe haber documentos de conocimiento");

  let enFaq = 0;
  for (const name of names) {
    // Une las líneas: pdftotext corta el texto y la expresión puede quedar partida.
    const text = (await readFile(path.join(KNOWLEDGE_DIR, name), "utf8")).replace(/\s+/g, " ");
    const sinFaq = text.replace(/¿La ropa es de segunda mano\?[^¿]*/g, () => { enFaq++; return ""; });
    assert.doesNotMatch(sinFaq, /segunda\s+mano/i, `${name} menciona «segunda mano» fuera de la pregunta frecuente`);
  }
  assert.equal(enFaq, 1, `debe existir exactamente una pregunta «${FAQ}»`);
});
