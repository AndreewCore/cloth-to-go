/**
 * Calendario del negocio: feriados, horario de atención y las rutas que los
 * sirven y los editan.
 *
 * La regla (qué día es hábil, cuándo cierra una ventana) vive en dates.js y es
 * pura; aquí solo se leen las tablas `holidays` y `business_hours`. La app y la
 * web deshabilitan en su calendario los días que `/api/config` dice cerrados, y
 * el servidor vuelve a comprobarlo al crear el pedido: el calendario del
 * cliente es una ayuda, no la defensa.
 *
 * Dos cosas distintas que conviene no mezclar:
 * - **Días de retiro y devolución** (`CLOSED_WEEKDAYS` + feriados): fijan las
 *   ventanas de devolución (§6.0), así que no se editan desde el panel.
 * - **Horario de atención** (`business_hours`): cuándo está abierto el local.
 *   El sábado abre sin retiros ni devoluciones.
 */
import prisma from "./db.js";
import { CAPABILITY, httpError } from "./auth.js";
import { CLOSED_WEEKDAYS, addDaysISO, todayISO, weekdayOf } from "./dates.js";
import { ACTIVITY, logActivity } from "./logs.js";
import { SHIPPING_FEE, VOLUME_DISCOUNT_MAX } from "./pricing.js";
import { REVIEW_REASONS } from "./moderation.js";
import { retentionCasesForApi } from "./retention.js";

/** Cuánto calendario se sirve hacia delante: el checkout no reserva más lejos. */
const HORIZONTE_DIAS = 400;

const DAY_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const DAY_LONG = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
/** Lunes primero, como se lee un horario. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Feriados como `YYYY-MM-DD`, en un Set para preguntar en O(1).
 * @param {object} [db=prisma] Cliente o transacción Prisma.
 * @returns {Promise<Set<string>>}
 */
export async function holidaySet(db = prisma) {
  const filas = await db.holiday.findMany({ select: { date: true } });
  return new Set(filas.map((f) => f.date.toISOString().slice(0, 10)));
}

/** Horario de los siete días, lunes primero; un día sin fila cuenta como cerrado. */
async function readHours(db = prisma) {
  const filas = await db.businessHours.findMany();
  return WEEK_ORDER.map((weekday) => {
    const f = filas.find((x) => x.weekday === weekday);
    return { weekday, open: f?.open ?? null, close: f?.close ?? null, pickups: !CLOSED_WEEKDAYS.includes(weekday) };
  });
}

/**
 * Horario en una línea, agrupando días seguidos iguales: «Lun–Vie 10:00–20:00 ·
 * Sáb 10:00–20:00 (sin retiros ni devoluciones)». Los días cerrados no salen.
 * Lo redacta el servidor para que la app y la web digan exactamente lo mismo.
 * @param {{weekday: number, open: string|null, close: string|null, pickups: boolean}[]} hours Lunes primero.
 * @returns {string}
 */
export function hoursSummary(hours) {
  const grupos = [];
  for (const d of hours) {
    if (!d.open || !d.close) continue;
    const ultimo = grupos.at(-1);
    const seguido = ultimo && WEEK_ORDER.indexOf(d.weekday) === WEEK_ORDER.indexOf(ultimo.to) + 1;
    if (seguido && ultimo.open === d.open && ultimo.close === d.close && ultimo.pickups === d.pickups) ultimo.to = d.weekday;
    else grupos.push({ from: d.weekday, to: d.weekday, open: d.open, close: d.close, pickups: d.pickups });
  }
  if (!grupos.length) return "Cerrado";
  return grupos.map((g) => {
    const dias = g.from === g.to ? DAY_SHORT[g.from] : `${DAY_SHORT[g.from]}–${DAY_SHORT[g.to]}`;
    return `${dias} ${g.open}–${g.close}${g.pickups ? "" : " (sin retiros ni devoluciones)"}`;
  }).join(" · ");
}

/** Día `YYYY-MM-DD` de una columna `@db.Date`. */
const isoDe = (d) => d.toISOString().slice(0, 10);

/**
 * Pedidos vivos que retiran o vencen ese día: un cierre nuevo no los mueve
 * (sus fechas ya se fijaron), pero alguien tiene que llamar a esos clientes.
 * @param {string} iso Día.
 * @returns {Promise<{id: number, customer: string, what: string}[]>}
 */
async function ordersOn(iso) {
  const dia = new Date(`${iso}T00:00:00Z`);
  const filas = await prisma.orderItem.findMany({
    where: {
      releasedAt: null,
      receivedAt: null,
      order: { cancelledAt: null },
      OR: [{ start: dia }, { end: dia }],
    },
    select: { orderId: true, start: true, order: { select: { user: { select: { name: true, email: true } } } } },
  });
  const porPedido = new Map();
  for (const f of filas) {
    const what = isoDe(f.start) === iso ? "retira" : "devuelve";
    porPedido.set(f.orderId, { id: f.orderId, customer: f.order.user.name || f.order.user.email, what });
  }
  return [...porPedido.values()];
}

/** Valida el nombre de un feriado o cierre. */
function parseHolidayName(v) {
  const n = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  if (n.length < 2 || n.length > 80) throw httpError(400, "El motivo del cierre va entre 2 y 80 caracteres.");
  return n;
}

/**
 * Lee la fecha de un feriado de la ruta o del cuerpo. Solo hoy o después: un
 * cierre pasado ya decidió días extra cobrados y fechas límite, y cambiarlo
 * reescribiría la historia de esos pedidos.
 */
function parseFutureDate(v) {
  if (typeof v !== "string" || !ISO_DATE.test(v) || Number.isNaN(Date.parse(v))) throw httpError(400, "La fecha va como AAAA-MM-DD.");
  if (v < todayISO()) throw httpError(409, "Ese día ya pasó: los cierres pasados no se cambian (ya decidieron cobros y fechas límite).");
  return v;
}

/**
 * Registra `GET /api/config` (pública) y las rutas de Administración que
 * editan el horario y los feriados.
 * @param {import("fastify").FastifyInstance} app Instancia Fastify.
 * @param {{requireCapability: Function}} [guards] preHandlers de autorización.
 */
export function registerCalendarRoutes(app, { requireCapability } = {}) {
  // Lo que el cliente necesita saber del negocio para pintar su calendario y
  // decir cuándo ir. Pública y sin datos personales.
  app.get("/api/config", async () => {
    const hoy = todayISO();
    const [filas, hours] = await Promise.all([
      prisma.holiday.findMany({
        where: { date: { gte: new Date(`${hoy}T00:00:00Z`), lte: new Date(`${addDaysISO(hoy, HORIZONTE_DIAS)}T00:00:00Z`) } },
        orderBy: { date: "asc" },
      }),
      readHours(),
    ]);
    return {
      today: hoy,
      closedWeekdays: CLOSED_WEEKDAYS,
      holidays: filas.map((f) => ({ date: isoDe(f.date), name: f.name })),
      hours,
      hoursText: hoursSummary(hours),
      // Para los textos del cliente ("envío $4.50", "hasta un 20 % por
      // volumen"): se dicen, pero el cálculo es siempre del servidor.
      shippingFee: SHIPPING_FEE,
      volumeDiscountMax: VOLUME_DISCOUNT_MAX,
      // Motivos para reportar una reseña: la app los pinta de aquí y no
      // guarda su propia copia de la lista.
      reviewReasons: Object.entries(REVIEW_REASONS).map(([key, label]) => ({ key, label })),
      // La tabla del §6.2, para el panel (y para explicarle al cliente su aviso).
      retentionCases: retentionCasesForApi(),
    };
  });

  if (!requireCapability) return;
  // Los cierres mueven qué días se puede retirar y devolver: es de
  // Administración, como el precio.
  const admin = requireCapability(CAPABILITY.ADMINISTRACION);

  // Calendario para el panel: horario y feriados desde hace un mes (para ver
  // lo reciente) hasta el horizonte, con los pedidos que caen en cada uno.
  app.get("/api/admin/calendar", { preHandler: admin }, async () => {
    const hoy = todayISO();
    const [filas, hours] = await Promise.all([
      prisma.holiday.findMany({
        where: { date: { gte: new Date(`${addDaysISO(hoy, -31)}T00:00:00Z`) } },
        orderBy: { date: "asc" },
      }),
      readHours(),
    ]);
    const holidays = await Promise.all(filas.map(async (f) => {
      const date = isoDe(f.date);
      return { date, name: f.name, weekday: weekdayOf(date), past: date < hoy, orders: date < hoy ? [] : await ordersOn(date) };
    }));
    return { today: hoy, hours, hoursText: hoursSummary(hours), closedWeekdays: CLOSED_WEEKDAYS, holidays };
  });

  // Horario de los siete días de una vez.
  app.put("/api/admin/hours", { preHandler: admin }, async (req) => {
    const lista = req.body?.hours;
    if (!Array.isArray(lista) || lista.length !== 7) throw httpError(400, "Envía el horario de los siete días.");
    const vistos = new Set();
    const datos = lista.map((d) => {
      if (!Number.isInteger(d?.weekday) || d.weekday < 0 || d.weekday > 6 || vistos.has(d.weekday)) {
        throw httpError(400, "Cada día de la semana va una vez (0 = domingo).");
      }
      vistos.add(d.weekday);
      const cerrado = d.open == null && d.close == null;
      if (!cerrado && !(HHMM.test(d.open ?? "") && HHMM.test(d.close ?? "") && d.open < d.close)) {
        throw httpError(400, `El ${DAY_LONG[d.weekday]}: apertura y cierre como HH:MM, y el cierre después de la apertura.`);
      }
      return { weekday: d.weekday, open: cerrado ? null : d.open, close: cerrado ? null : d.close };
    });
    const antes = hoursSummary(await readHours());
    await prisma.$transaction(async (tx) => {
      for (const d of datos) {
        await tx.businessHours.upsert({ where: { weekday: d.weekday }, update: d, create: d });
      }
      const ahora = hoursSummary(await readHours(tx));
      if (ahora !== antes) {
        await logActivity(tx, { action: ACTIVITY.HORARIO, actorId: req.user.id, note: `Horario: ${antes} → ${ahora}` });
      }
    });
    const hours = await readHours();
    return { hours, hoursText: hoursSummary(hours) };
  });

  // Alta de un feriado o cierre puntual. Devuelve los pedidos que caen ese día
  // para avisarles: sus fechas no se mueven solas.
  app.post("/api/admin/holidays", { preHandler: admin }, async (req, reply) => {
    const date = parseFutureDate(req.body?.date);
    const name = parseHolidayName(req.body?.name);
    const dia = new Date(`${date}T00:00:00Z`);
    if (await prisma.holiday.findUnique({ where: { date: dia } })) throw httpError(409, "Ese día ya está cerrado.");
    await prisma.$transaction(async (tx) => {
      await tx.holiday.create({ data: { date: dia, name } });
      await logActivity(tx, { action: ACTIVITY.FERIADO_ALTA, actorId: req.user.id, note: `Cierre el ${date}: ${name}`, detail: { date } });
    });
    return reply.code(201).send({ date, name, orders: await ordersOn(date) });
  });

  // Cambiar el motivo de un cierre (no la fecha: eso es quitar uno y poner otro).
  app.patch("/api/admin/holidays/:date", { preHandler: admin }, async (req) => {
    const date = parseFutureDate(req.params.date);
    const name = parseHolidayName(req.body?.name);
    const dia = new Date(`${date}T00:00:00Z`);
    const actual = await prisma.holiday.findUnique({ where: { date: dia } });
    if (!actual) throw httpError(404, "Ese día no está cerrado.");
    await prisma.$transaction(async (tx) => {
      await tx.holiday.update({ where: { date: dia }, data: { name } });
      await logActivity(tx, { action: ACTIVITY.FERIADO_EDICION, actorId: req.user.id, note: `Cierre del ${date}: «${actual.name}» → «${name}»`, detail: { date } });
    });
    return { date, name };
  });

  // Quitar un cierre futuro: ese día vuelve a ser hábil.
  app.delete("/api/admin/holidays/:date", { preHandler: admin }, async (req, reply) => {
    const date = parseFutureDate(req.params.date);
    const dia = new Date(`${date}T00:00:00Z`);
    const actual = await prisma.holiday.findUnique({ where: { date: dia } });
    if (!actual) throw httpError(404, "Ese día no está cerrado.");
    await prisma.$transaction(async (tx) => {
      await tx.holiday.delete({ where: { date: dia } });
      await logActivity(tx, { action: ACTIVITY.FERIADO_BAJA, actorId: req.user.id, note: `Se abre el ${date} (era «${actual.name}»)`, detail: { date } });
    });
    return reply.code(204).send();
  });
}
