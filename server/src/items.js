/**
 * Estados del ejemplar (§3 de DECISIONES): el sistema propone, la persona
 * confirma.
 *
 * - **Automático:** un pedido confirmado deja el ejemplar Reservado, y su
 *   anulación antes de la entrega lo devuelve a Disponible. No depende de que
 *   nadie se acuerde.
 * - **Manual:** todo lo físico (entregada, en lavado, disponible otra vez,
 *   desperfecto, retirada, perdida). Solo una persona sabe cómo volvió.
 *
 * Cada cambio, manual o automático, deja su entrada en la bitácora de prendas.
 */
import prisma from "./db.js";
import { CAPABILITY, hasCapability, httpError } from "./auth.js";
import { ITEM_STATUS, isoToDate, routeId } from "./catalog.js";
import { logItem } from "./logs.js";
import { todayISO } from "./dates.js";

const S = ITEM_STATUS;

/**
 * Cambios manuales permitidos, desde cada estado. Reservada no es destino de
 * nadie: la pone un pedido. Perdida es final: una prenda que aparece después
 * es un caso para el admin, no un clic.
 */
const MANUAL = Object.freeze({
  [S.DISPONIBLE]: [S.EN_LAVADO, S.NO_ALQUILABLE, S.PERDIDA],
  [S.RESERVADA]: [S.EN_ALQUILER, S.PERDIDA],
  [S.EN_ALQUILER]: [S.EN_LAVADO, S.NO_ALQUILABLE, S.PERDIDA],
  [S.EN_LAVADO]: [S.DISPONIBLE, S.NO_ALQUILABLE, S.PERDIDA],
  [S.NO_ALQUILABLE]: [S.EN_LAVADO, S.DISPONIBLE, S.PERDIDA],
  [S.PERDIDA]: [],
});

const LAUNDRY_KINDS = ["PROPIO", "EXTERNO"];
const REASONS = ["DESPERFECTO", "RETIRADA"];

/**
 * Decide si un cambio manual de estado es válido y qué hay que guardar.
 *
 * Es pura (no toca la base) para poder probar la tabla entera sin pedidos.
 * Mostrador mueve lo físico; retirar, marcar perdida y devolver al catálogo
 * algo retirado es solo de Administración (§2.1).
 * @param {object} item Ejemplar actual (`status`, `unrentableReason`).
 * @param {object} req Cambio pedido.
 * @param {string} req.to Estado destino.
 * @param {string} [req.note] Observación.
 * @param {string} [req.reason] DESPERFECTO | RETIRADA, al pasar a No Alquilable.
 * @param {{kind: string, place: string}} [req.laundry] Al pasar a En Lavado.
 * @param {object} user Quien lo pide (con `capabilities`).
 * @returns {{error: string, status: number}|{data: object, laundry: object|null, note: string|null}}
 */
export function planTransition(item, { to, note, reason, laundry }, user) {
  const nota = typeof note === "string" && note.trim() ? note.trim().slice(0, 500) : null;
  if (!Object.values(S).includes(to)) return { status: 400, error: "Estado no válido." };
  if (!MANUAL[item.status].includes(to)) {
    return { status: 409, error: `No se puede pasar de ${item.status} a ${to}.` };
  }

  const admin = hasCapability(user, CAPABILITY.ADMINISTRACION);
  const saleDeRetirada = item.status === S.NO_ALQUILABLE && item.unrentableReason === "RETIRADA";
  if ((to === S.PERDIDA || saleDeRetirada) && !admin) {
    return { status: 403, error: "Solo la administración puede hacer este cambio." };
  }

  const data = { status: to, statusSince: new Date(), unrentableReason: null, laundryKind: null, laundryPlace: null };
  let lavado = null;

  if (to === S.NO_ALQUILABLE) {
    if (!REASONS.includes(reason)) return { status: 400, error: "Indica si es desperfecto o retirada." };
    if (reason === "RETIRADA" && !admin) {
      return { status: 403, error: "Solo la administración retira prendas del inventario." };
    }
    data.unrentableReason = reason;
  }
  if (to === S.EN_LAVADO) {
    // Sin estos dos datos «en lavado desde hace dos días» no le dice a nadie
    // a quién llamar (§3).
    const place = typeof laundry?.place === "string" ? laundry.place.trim().slice(0, 120) : "";
    if (!LAUNDRY_KINDS.includes(laundry?.kind) || !place) {
      return { status: 400, error: "En lavado exige quién lava (propio o externo) y dónde está la prenda." };
    }
    lavado = { kind: laundry.kind, place };
    data.laundryKind = lavado.kind;
    data.laundryPlace = lavado.place;
  }
  if ((to === S.NO_ALQUILABLE || to === S.PERDIDA) && !nota) {
    return { status: 400, error: "Este cambio necesita una observación que lo explique." };
  }
  return { data, laundry: lavado, note: nota };
}

/**
 * Indica si el ejemplar tiene una reserva viva que todavía no empezó (o empieza
 * hoy). Es lo que convierte un «disponible otra vez» en «reservada»: la prenda
 * volvió al local, pero ya tiene el siguiente cliente esperando.
 * @param {object} tx Transacción Prisma.
 * @param {number} itemId Ejemplar.
 * @param {number} [exceptOrderId] Pedido que no cuenta (el que se está anulando).
 * @returns {Promise<boolean>}
 */
async function hasPendingReservation(tx, itemId, exceptOrderId) {
  const n = await tx.orderItem.count({
    where: {
      itemId,
      releasedAt: null,
      start: { gte: isoToDate(todayISO()) },
      ...(exceptOrderId ? { orderId: { not: exceptOrderId } } : {}),
    },
  });
  return n > 0;
}

/**
 * Deja Reservados los ejemplares de un pedido recién creado.
 *
 * Solo toca los que están Disponibles: uno que está En Alquiler o En Lavado
 * sigue físicamente donde está, y pasará a Reservada cuando el mostrador lo
 * dé por disponible (ver `hasPendingReservation`).
 * @param {object} tx Transacción Prisma.
 * @param {object[]} items Ejemplares del pedido (filas de `items`).
 * @param {number} orderId Pedido.
 */
export async function reserveForOrder(tx, items, orderId) {
  for (const it of items) {
    if (it.status !== S.DISPONIBLE) continue;
    await tx.item.update({ where: { id: it.id }, data: { status: S.RESERVADA, statusSince: new Date() } });
    await logItem(tx, {
      itemId: it.id,
      from: S.DISPONIBLE,
      to: S.RESERVADA,
      orderId,
      note: `Reservada por el pedido #${orderId}`,
    });
  }
}

/**
 * Libera las reservas de un pedido anulado.
 *
 * Las filas se conservan (son historia) con `releasedAt`, que es lo que las
 * saca de la restricción de solape. Un ejemplar Reservado vuelve a Disponible
 * solo (§3, excepción automática): no llegó a manos del cliente, así que no
 * hay nada físico que comprobar — salvo que otro pedido lo espere.
 * @param {object} tx Transacción Prisma.
 * @param {number} orderId Pedido anulado.
 */
export async function releaseForOrder(tx, orderId) {
  await tx.orderItem.updateMany({ where: { orderId, releasedAt: null }, data: { releasedAt: new Date() } });
  const filas = await tx.orderItem.findMany({ where: { orderId }, include: { item: true } });
  for (const { item } of filas) {
    if (item.status !== S.RESERVADA) continue;
    if (await hasPendingReservation(tx, item.id, orderId)) continue;
    await tx.item.update({ where: { id: item.id }, data: { status: S.DISPONIBLE, statusSince: new Date() } });
    await logItem(tx, {
      itemId: item.id,
      from: S.RESERVADA,
      to: S.DISPONIBLE,
      orderId,
      note: `Anulación del pedido #${orderId}`,
    });
  }
}

/**
 * Registra las rutas del mostrador sobre ejemplares.
 * @param {import("fastify").FastifyInstance} app Instancia Fastify.
 * @param {{requireCapability: Function}} guards preHandlers de autorización.
 */
export function registerItemRoutes(app, { requireCapability }) {
  // Ficha interna del ejemplar con su bitácora, del más reciente al más viejo.
  app.get(
    "/api/items/:id",
    { preHandler: requireCapability(CAPABILITY.MOSTRADOR, CAPABILITY.INVENTARIO) },
    async (req) => {
      const id = routeId(req.params.id, "Ejemplar");
      const item = await prisma.item.findUnique({
        where: { id },
        include: {
          product: { select: { id: true, name: true } },
          logs: { orderBy: { id: "desc" }, include: { actor: { select: { name: true } } } },
        },
      });
      if (!item) throw httpError(404, "Ejemplar no encontrado.");
      return item;
    },
  );

  // Cambio manual de estado. La tabla de permitidos y los permisos finos van
  // en planTransition(); aquí solo se aplica y se anota, en una transacción.
  app.post(
    "/api/items/:id/status",
    { preHandler: requireCapability(CAPABILITY.MOSTRADOR) },
    async (req) => {
      const id = routeId(req.params.id, "Ejemplar");
      return prisma.$transaction(async (tx) => {
        const item = await tx.item.findUnique({ where: { id } });
        if (!item) throw httpError(404, "Ejemplar no encontrado.");

        const plan = planTransition(item, req.body ?? {}, req.user);
        if (plan.error) throw httpError(plan.status, plan.error);

        if (plan.data.status === S.DISPONIBLE && (await hasPendingReservation(tx, id))) {
          plan.data.status = S.RESERVADA;
        }
        // Condición sobre el estado leído: si otro mostrador lo movió entre
        // medias, este cambio se basaba en algo que ya no es cierto.
        const { count } = await tx.item.updateMany({ where: { id, status: item.status }, data: plan.data });
        if (count === 0) throw httpError(409, "El ejemplar cambió de estado mientras tanto; vuelve a cargarlo.");

        await logItem(tx, {
          itemId: id,
          from: item.status,
          to: plan.data.status,
          actorId: req.user.id,
          note: plan.note,
          laundry: plan.laundry,
        });
        return tx.item.findUnique({ where: { id } });
      });
    },
  );
}
