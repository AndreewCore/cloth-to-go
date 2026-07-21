/**
 * Cliente Prisma compartido por toda la app.
 *
 * Se activa el modo WAL de SQLite para permitir lecturas concurrentes mientras
 * se escribe — importante cuando varios clientes consultan a la vez. En
 * producción (Postgres) esta sentencia es inofensiva y simplemente no aplica.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Activa WAL en SQLite; se ignora silenciosamente en otros motores. */
export async function initDb() {
  try {
    await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL;");
  } catch {
    // No es SQLite (p. ej. Postgres): el pragma no existe y no pasa nada.
  }
}

export default prisma;
