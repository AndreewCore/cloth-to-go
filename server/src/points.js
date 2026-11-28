/**
 * Puntos y canjes en la base (§2 de PENDIENTE): saldo, acreditado perezoso,
 * reversión al anular y las rutas del cliente.
 *
 * El saldo es `SUM(delta)` de `points_entries`, nunca un contador. Acreditar es
 * perezoso, como el contador de agua: no hay tareas programadas, así que cada
 * lectura de pedidos o de puntos liquida lo que ya toca. Las claves únicas de la
 * tabla hacen que dos lecturas simultáneas no acrediten dos veces.
 */
import prisma from "./db.js";
import { httpError, isStaff } from "./auth.js";
import { garmentWater } from "./water.js";
import { REWARDS, WATER_GOALS, rewardById } from "./rewards.js";

/** Vocabulario de `PointsReason` en la base. */
export const POINTS_REASON = Object.freeze({
  EARNED_DELIVERY: "EARNED_DELIVERY",
  WATER_GOAL: "WATER_GOAL",
  REDEEMED: "REDEEMED",
  REVOKED_CANCEL: "REVOKED_CANCEL",
  COUPON_REVOKED: "COUPON_REVOKED",
});

/**
 * ¿El pedido ya ganó sus recompensas? Cuando el local registró la entrega de
 * alguna de sus prendas: desde ese momento el cliente ya no puede anular, así
 * que premiar no es explotable (canjear, anular y quedarse con el premio era el
 * hallazgo #50). La fecha de retiro, por sí sola, ya no cuenta: un cliente que
 * no vino no alquiló nada.
 * @param {{cancelledAt: Date|null, items?: {deliveredAt: Date|null}[]}} order Pedido con sus líneas.
 * @returns {boolean}
 */
export function countsForRewards(order) {
  return !order.cancelledAt && isDelivered(order);
}

/**
 * ¿El local registró la entrega de alguna prenda del pedido?
 * @param {{items?: {deliveredAt: Date|null}[]}} order Pedido con sus líneas.
 * @returns {boolean}
 */
export function isDelivered(order) {
  return (order.items ?? []).some((i) => i.deliveredAt);
}

/**
 * Saldo de puntos de una cuenta.
 * @param {object} db Cliente o transacción Prisma.
 * @param {number} userId Usuario.
 * @returns {Promise<number>}
 */
export async function balanceOf(db, userId) {
  const r = await db.pointsEntry.aggregate({ where: { userId }, _sum: { delta: true } });
  return r._sum.delta ?? 0;
}

/**
 * Litros ahorrados por los alquileres cumplidos de una cuenta.
 * @param {object[]} orders Pedidos con `items.item.product`.
 * @returns {number}
 */
function litersOf(orders) {
  return orders
    .filter((o) => countsForRewards(o))
    .reduce((s, o) => s + o.items.reduce((t, i) => t + garmentWater(i.item.product), 0), 0);
}

/**
 * Acredita lo que ya toca: los puntos de los pedidos cumplidos y las metas de
 * agua alcanzadas. Idempotente (claves únicas + `skipDuplicates`).
 * @param {object} db Cliente o transacción Prisma.
 * @param {number} userId Usuario.
 * @returns {Promise<{liters: number}>} Litros cumplidos, para quien los quiera mostrar.
 */
export async function settleRewards(db, userId) {
  const orders = await db.order.findMany({
    where: { userId, cancelledAt: null },
    include: { items: { include: { item: { include: { product: true } } } } },
  });
  const ganados = orders
    .filter((o) => countsForRewards(o) && o.pointsEarned > 0)
    .map((o) => ({ userId, delta: o.pointsEarned, reason: POINTS_REASON.EARNED_DELIVERY, orderId: o.id }));
  const liters = litersOf(orders);
  const metas = WATER_GOALS.filter((g) => liters >= g.liters)
    .map((g) => ({ userId, delta: g.points, reason: POINTS_REASON.WATER_GOAL, goalId: g.id }));
  const filas = [...ganados, ...metas];
  if (filas.length) await db.pointsEntry.createMany({ data: filas, skipDuplicates: true });
  return { liters };
}

/**
 * Bloquea la fila del usuario hasta el fin de la transacción. Dos canjes o
 * dos reversiones simultáneas leerían el mismo saldo y gastarían dos veces lo
 * que hay una vez; así la segunda espera a que la primera escriba.
 * @param {object} tx Transacción Prisma.
 * @param {number} userId Usuario.
 */
export async function lockUser(tx, userId) {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
}

/**
 * Revierte los puntos de un pedido anulado y libera su cupón.
 *
 * Restar del saldo no basta: parte de esos puntos puede haberse convertido ya
 * en premios. Se revocan canjes sin usar (los más recientes primero, que son
 * los que esos puntos financiaron) hasta que el saldo alcance; si aun así no
 * alcanza, **el resto se perdona** — dejar al cliente en negativo o quitarle
 * un premio ya disfrutado no es defendible por un pedido que se le dejó anular.
 * @param {object} tx Transacción Prisma (con `lockUser` ya hecho).
 * @param {{id: number, userId: number}} order Pedido anulado.
 */
export async function revokeOrderRewards(tx, order) {
  // El cupón gastado en este pedido vuelve a la cartera: el pedido no existió.
  await tx.coupon.updateMany({ where: { usedInOrderId: order.id }, data: { usedInOrderId: null } });

  const ganado = await tx.pointsEntry.findUnique({
    where: { orderId_reason: { orderId: order.id, reason: POINTS_REASON.EARNED_DELIVERY } },
  });
  if (!ganado) return;

  let saldo = await balanceOf(tx, order.userId);
  if (saldo < ganado.delta) {
    const libres = await tx.coupon.findMany({
      where: { userId: order.userId, usedInOrderId: null, revokedAt: null },
      orderBy: { id: "desc" },
    });
    for (const c of libres) {
      if (saldo >= ganado.delta) break;
      await tx.coupon.update({ where: { id: c.id }, data: { revokedAt: new Date() } });
      await tx.pointsEntry.create({
        data: { userId: order.userId, delta: c.cost, reason: POINTS_REASON.COUPON_REVOKED, couponId: c.id },
      });
      saldo += c.cost;
    }
  }
  const delta = -Math.min(ganado.delta, Math.max(0, saldo));
  await tx.pointsEntry.create({
    data: { userId: order.userId, delta, reason: POINTS_REASON.REVOKED_CANCEL, orderId: order.id },
  });
}

/**
 * Cupón de la cuenta para la API.
 * @param {object} c Fila de `coupons`.
 * @returns {object}
 */
export function couponToApi(c) {
  const rw = rewardById(c.rewardId);
  return {
    id: c.id,
    rewardId: c.rewardId,
    name: rw?.name ?? "Premio retirado",
    type: rw?.type ?? null,
    cost: c.cost,
    issuedAt: c.issuedAt,
    usedIn: c.usedInOrderId,
    revoked: Boolean(c.revokedAt),
  };
}

/**
 * Estado del programa de puntos de una cuenta, ya liquidado.
 * @param {object} db Cliente Prisma.
 * @param {number} userId Usuario.
 * @returns {Promise<object>}
 */
export async function pointsSummary(db, userId) {
  const { liters } = await settleRewards(db, userId);
  const [balance, coupons, metas] = await Promise.all([
    balanceOf(db, userId),
    db.coupon.findMany({ where: { userId }, orderBy: { id: "desc" } }),
    db.pointsEntry.findMany({ where: { userId, reason: POINTS_REASON.WATER_GOAL }, select: { goalId: true } }),
  ]);
  return {
    balance,
    coupons: coupons.map(couponToApi),
    rewards: REWARDS,
    water: { liters, goals: WATER_GOALS, reached: metas.map((m) => m.goalId) },
  };
}

/**
 * Registra las rutas del programa de puntos.
 * @param {import("fastify").FastifyInstance} app Instancia Fastify.
 * @param {{requireUser: Function}} guards preHandlers de autenticación.
 */
export function registerPointsRoutes(app, { requireUser }) {
  // Saldo, canjes, premios disponibles y metas de agua de quien pregunta.
  app.get("/api/me/points", { preHandler: requireUser }, async (req) => pointsSummary(prisma, req.user.id));

  // Canjear un premio: descuenta los puntos y deja un cupón para el checkout.
  app.post("/api/rewards/:id/redeem", { preHandler: requireUser }, async (req, reply) => {
    // El personal no alquila (§2.1), así que tampoco canjea premios de alquiler.
    if (isStaff(req.user)) {
      throw httpError(403, "Las cuentas del personal no canjean premios.");
    }
    const rw = rewardById(Number(req.params.id));
    if (!rw) throw httpError(404, "Ese premio no existe.");

    const cupon = await prisma.$transaction(async (tx) => {
      await lockUser(tx, req.user.id);
      await settleRewards(tx, req.user.id);
      const saldo = await balanceOf(tx, req.user.id);
      if (saldo < rw.cost) throw httpError(409, "No tienes puntos suficientes para ese premio.");
      const c = await tx.coupon.create({ data: { userId: req.user.id, rewardId: rw.id, cost: rw.cost } });
      await tx.pointsEntry.create({
        data: { userId: req.user.id, delta: -rw.cost, reason: POINTS_REASON.REDEEMED, couponId: c.id },
      });
      return c;
    });
    return reply.code(201).send({ coupon: couponToApi(cupon), ...(await pointsSummary(prisma, req.user.id)) });
  });
}
