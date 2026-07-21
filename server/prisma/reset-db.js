/**
 * Borra el archivo SQLite de desarrollo antes de recrear el esquema.
 *
 * Sustituye a `prisma db push --force-reset`, que en SQLite deja el archivo
 * truncado a 0 bytes y luego falla al releerlo ("database disk image is
 * malformed"). Borrar el archivo y dejar que `db push` lo cree de cero es
 * equivalente y no se atasca.
 *
 * Solo actúa sobre DATABASE_URL de tipo `file:`; con Postgres u otro motor
 * aborta, porque ahí el reseteo se hace con `prisma migrate reset`.
 */
import { readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Lee DATABASE_URL del .env sin depender de dotenv. */
function readDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(resolve(here, "..", ".env"), "utf8");
    const line = env.split("\n").find((l) => l.trim().startsWith("DATABASE_URL="));
    return line ? line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") : "";
  } catch {
    return "";
  }
}

const url = readDatabaseUrl();

if (!url.startsWith("file:")) {
  console.error(
    "reset-db: DATABASE_URL no es SQLite (file:). Usa `prisma migrate reset` en ese caso.",
  );
  process.exit(1);
}

// Las rutas `file:` de Prisma son relativas a la carpeta prisma/.
const dbPath = resolve(here, url.replace(/^file:/, ""));

for (const suffix of ["", "-journal", "-wal", "-shm"]) {
  rmSync(dbPath + suffix, { force: true });
}

console.log(`reset-db: eliminado ${dbPath}`);
