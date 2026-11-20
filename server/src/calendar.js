/**
 * Calendario del negocio: feriados de la base y la ruta pública que lo sirve.
 *
 * La regla (qué día es hábil, cuándo cierra una ventana) vive en dates.js y es
 * pura; aquí solo se lee la tabla `holidays` y se expone. La app y la web
 * deshabilitan en su calendario los días que esta ruta dice cerrados, y el
 * servidor vuelve a comprobarlo al crear el pedido: el calendario del cliente
 * es una ayuda, no la defensa.
 */
import prisma from "./db.js";
import { CLOSED_WEEKDAYS, addDaysISO, todayISO } from "./dates.js";

/** Cuánto calendario se sirve hacia delante: el checkout no reserva más lejos. */
const HORIZONTE_DIAS = 400;

/**
 * Feriados como `YYYY-MM-DD`, en un Set para preguntar en O(1).
 * @param {object} [db=prisma] Cliente o transacción Prisma.
 * @returns {Promise<Set<string>>}
 */
export async function holidaySet(db = prisma) {
  const filas = await db.holiday.findMany({ select: { date: true } });
  return new Set(filas.map((f) => f.date.toISOString().slice(0, 10)));
}

/**
 * Registra `GET /api/config`: lo que el cliente necesita saber del negocio para
 * pintar su calendario. Pública y sin datos personales.
 * @param {import("fastify").FastifyInstance} app Instancia Fastify.
 */
export function registerCalendarRoutes(app) {
  app.get("/api/config", async () => {
    const hoy = todayISO();
    const filas = await prisma.holiday.findMany({
      where: { date: { gte: new Date(`${hoy}T00:00:00Z`), lte: new Date(`${addDaysISO(hoy, HORIZONTE_DIAS)}T00:00:00Z`) } },
      orderBy: { date: "asc" },
    });
    return {
      today: hoy,
      closedWeekdays: CLOSED_WEEKDAYS,
      holidays: filas.map((f) => ({ date: f.date.toISOString().slice(0, 10), name: f.name })),
    };
  });
}
