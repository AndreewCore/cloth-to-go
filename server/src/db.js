/**
 * Cliente Prisma compartido por toda la app.
 *
 * Una sola instancia para todo el proceso: cada `new PrismaClient()` abre su
 * propio pool de conexiones, y con un Postgres gestionado —donde las conexiones
 * son un recurso contado— varios pools es la forma más rápida de agotarlas.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export default prisma;
