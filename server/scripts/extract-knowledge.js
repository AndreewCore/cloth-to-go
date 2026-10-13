/**
 * Extrae el texto de los PDF de `knowledge/` a un `.txt` hermano por cada uno
 * (`pnpm knowledge`). El servidor solo lee los `.txt`: así no carga una
 * librería de PDF en producción y el texto que ve el asistente queda revisable
 * en el diff.
 *
 * Usa `pdftotext` (poppler-utils), que se instala aparte del proyecto.
 */
import { readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { KNOWLEDGE_DIR } from "../src/chat.js";

const run = promisify(execFile);

/** Convierte cada PDF de la carpeta y avisa si no hay ninguno. */
async function main() {
  const pdfs = (await readdir(KNOWLEDGE_DIR)).filter((n) => n.toLowerCase().endsWith(".pdf"));
  if (!pdfs.length) {
    console.log(`No hay PDF en ${KNOWLEDGE_DIR}. Copia ahí los documentos y vuelve a correrlo.`);
    return;
  }
  for (const name of pdfs) {
    const src = path.join(KNOWLEDGE_DIR, name);
    const out = path.join(KNOWLEDGE_DIR, name.replace(/\.pdf$/i, ".txt"));
    try {
      // Sin -layout: el texto corrido le sirve más al modelo que las columnas
      // alineadas con espacios, que solo gastan tokens.
      await run("pdftotext", ["-enc", "UTF-8", src, out]);
      console.log(`✓ ${name} → ${path.basename(out)}`);
    } catch (err) {
      if (err.code === "ENOENT") {
        console.error("Falta `pdftotext`: instala poppler-utils (p. ej. `sudo pacman -S poppler`).");
        process.exit(1);
      }
      throw err;
    }
  }
}

main();
