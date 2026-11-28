/**
 * Moderación de reseñas (fase 4). Toda reseña nace PENDIENTE (reviews.js) y
 * aquí se decide su suerte:
 *
 * - **Moderación** aprueba, rechaza con un motivo de la lista cerrada, oculta o
 *   vuelve a mostrar. Cada decisión queda en `activity_logs`.
 * - **Los clientes** reportan reseñas publicadas, una vez por cuenta. Con
 *   `REPORTS_TO_HIDE` reportes abiertos de cuentas distintas la reseña vuelve
 *   sola a la cola; aprobarla otra vez da esos reportes por resueltos.
 */
import prisma from "./db.js";
import { CAPABILITY, httpError } from "./auth.js";
import { routeId } from "./catalog.js";
import { ACTIVITY, logActivity } from "./logs.js";
import { requestOrigin } from "./storage.js";

/** Motivos de rechazo y de reporte, con el texto que ve la gente. */
export const REVIEW_REASONS = Object.freeze({
  OFENSIVO: "Ofensivo o discriminatorio",
  SPAM: "Spam o publicidad",
  DATOS_PERSONALES: "Datos personales",
  FUERA_DE_TEMA: "Fuera de tema o foto inapropiada",
});

/** Reportes abiertos, de cuentas distintas, que devuelven una reseña a la cola. */
export const REPORTS_TO_HIDE = 3;

const STATUSES = ["PENDIENTE", "APROBADA", "RECHAZADA", "OCULTA"];
const QUEUE_LIMIT = 100;

/**
 * Qué puede hacer Moderación con una reseña según su estado. Volver a aprobar
 * una rechazada cubre el «me equivoqué»; ocultar es para lo ya publicado.
 */
export const MOVES = Object.freeze({
  approve: { from: ["PENDIENTE", "RECHAZADA"], to: "APROBADA", action: ACTIVITY.RESENA_APROBADA, label: "aprobada" },
  reject: { from: ["PENDIENTE", "OCULTA"], to: "RECHAZADA", action: ACTIVITY.RESENA_RECHAZADA, label: "rechazada" },
  hide: { from: ["APROBADA"], to: "OCULTA", action: ACTIVITY.RESENA_OCULTA, label: "oculta" },
  show: { from: ["OCULTA"], to: "APROBADA", action: ACTIVITY.RESENA_MOSTRADA, label: "mostrada" },
});

/**
 * Valida un motivo de la lista.
 * @param {unknown} reason Lo que llegó en el cuerpo.
 * @returns {string} Clave del motivo.
 */
function parseReason(reason) {
  if (typeof reason !== "string" || !REVIEW_REASONS[reason]) throw httpError(400, "Elige un motivo de la lista.");
  return reason;
}

/**
 * Aplica una decisión de Moderación. El cambio es condicional al estado de
 * partida, así dos moderadores a la vez no se pisan: el segundo recibe 409.
 * @param {number} id Reseña.
 * @param {{action: string, reason?: string}} body Decisión.
 * @param {number} actorId Quién decide.
 * @param {{onReject?: (tx: object, review: object) => Promise<void>}} [hooks]
 *   Lo que debe pasar dentro de la misma transacción al rechazar (avisos).
 * @returns {Promise<object>} Reseña actualizada.
 */
export async function moderate(id, body, actorId, { onReject } = {}) {
  const move = MOVES[body?.action];
  if (!move) throw httpError(400, "Acción de moderación desconocida.");
  const reason = body.action === "reject" ? parseReason(body.reason) : null;

  return prisma.$transaction(async (tx) => {
    const { count } = await tx.review.updateMany({
      where: { id, status: { in: move.from } },
      data: { status: move.to, rejectReason: reason, moderatedById: actorId, moderatedAt: new Date() },
    });
    const r = await tx.review.findUnique({ where: { id }, include: { product: { select: { name: true } } } });
    if (!r) throw httpError(404, "Reseña no encontrada.");
    if (!count) throw httpError(409, `Esta reseña ya está ${r.status.toLowerCase()}: recarga la cola.`);

    // Publicarla de nuevo da por atendidos los reportes que la habían ocultado;
    // si no, el siguiente reporte la volvería a esconder con los viejos.
    if (move.to === "APROBADA") {
      await tx.reviewReport.updateMany({ where: { reviewId: id, resolvedAt: null }, data: { resolvedAt: new Date() } });
    }
    await logActivity(tx, {
      action: move.action,
      actorId,
      productId: r.productId,
      note: `Reseña #${id} de ${r.product.name} ${move.label}${reason ? `: ${REVIEW_REASONS[reason]}` : ""}`,
      detail: { reviewId: id, reason },
    });
    if (move.to === "RECHAZADA" && onReject) await onReject(tx, r);
    return r;
  });
}

/**
 * Registra el reporte de un cliente y, si con él se juntan los suficientes,
 * devuelve la reseña a la cola. La fila de la reseña se bloquea para que dos
 * reportes simultáneos no se queden ambos en «faltan uno».
 * @param {number} id Reseña.
 * @param {unknown} reason Motivo de la lista.
 * @param {number} userId Quién reporta.
 * @returns {Promise<{hidden: boolean}>} Si la reseña dejó de verse.
 */
export async function report(id, reason, userId) {
  const motivo = parseReason(reason);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM reviews WHERE id = ${id} FOR UPDATE`;
    const r = await tx.review.findUnique({ where: { id }, include: { product: { select: { name: true } } } });
    // Solo lo publicado se reporta: lo demás el cliente no lo ve.
    if (!r || r.status !== "APROBADA") throw httpError(404, "Reseña no encontrada.");
    if (r.userId === userId) throw httpError(409, "No puedes reportar tu propia reseña.");
    try {
      await tx.reviewReport.create({ data: { reviewId: id, userId, reason: motivo } });
    } catch (err) {
      if (err.code === "P2002") throw httpError(409, "Ya reportaste esta reseña.");
      throw err;
    }
    const abiertos = await tx.reviewReport.count({ where: { reviewId: id, resolvedAt: null } });
    if (abiertos < REPORTS_TO_HIDE) return { hidden: false };

    await tx.review.update({ where: { id }, data: { status: "PENDIENTE" } });
    await logActivity(tx, {
      action: ACTIVITY.RESENA_AUTO_OCULTA,
      productId: r.productId,
      note: `Reseña #${id} de ${r.product.name} vuelve a la cola: ${abiertos} reportes`,
      detail: { reviewId: id },
    });
    return { hidden: true };
  });
}

/**
 * Registra las rutas de moderación.
 * @param {import("fastify").FastifyInstance} app Instancia Fastify.
 * @param {{requireUser: Function, requireCapability: Function}} guards preHandlers.
 * @param {{storage: object, onReject?: Function}} deps Fotos firmadas y avisos.
 */
export function registerModerationRoutes(app, { requireUser, requireCapability }, { storage, onReject }) {
  const moderacion = requireCapability(CAPABILITY.MODERACION);

  // La cola. Lo pendiente sale del más viejo al más nuevo (se atiende en
  // orden); el resto, lo último primero.
  app.get("/api/admin/reviews", { preHandler: moderacion }, async (req) => {
    const status = req.query.status ?? "PENDIENTE";
    if (!STATUSES.includes(status)) throw httpError(400, "Estado desconocido.");
    const origin = requestOrigin(req);
    const [filas, porEstado] = await Promise.all([
      prisma.review.findMany({
        where: { status },
        orderBy: { createdAt: status === "PENDIENTE" ? "asc" : "desc" },
        take: QUEUE_LIMIT,
        include: {
          user: { select: { name: true, email: true } },
          product: { select: { id: true, name: true } },
          moderatedBy: { select: { name: true } },
          reports: { select: { reason: true, resolvedAt: true } },
        },
      }),
      prisma.review.groupBy({ by: ["status"], _count: true }),
    ]);
    return {
      counts: Object.fromEntries(STATUSES.map((s) => [s, porEstado.find((g) => g.status === s)?._count ?? 0])),
      reasons: Object.entries(REVIEW_REASONS).map(([key, label]) => ({ key, label })),
      reviews: await Promise.all(filas.map(async (r) => {
        const abiertos = r.reports.filter((x) => !x.resolvedAt);
        return {
          id: r.id,
          status: r.status,
          rating: r.rating,
          text: r.text,
          photo: r.photoKey ? await storage.signedUrl(r.photoKey, origin) : null,
          author: r.user.name || r.user.email,
          product: r.product,
          orderId: r.orderId,
          createdAt: r.createdAt,
          rejectReason: r.rejectReason,
          moderatedBy: r.moderatedBy?.name ?? null,
          moderatedAt: r.moderatedAt,
          openReports: abiertos.length,
          reportReasons: abiertos.map((x) => x.reason),
        };
      })),
    };
  });

  app.post("/api/reviews/:id/moderate", { preHandler: moderacion }, async (req) => {
    const r = await moderate(routeId(req.params.id, "Reseña"), req.body, req.user.id, { onReject });
    return { id: r.id, status: r.status, rejectReason: r.rejectReason };
  });

  app.post("/api/reviews/:id/report", { preHandler: requireUser }, async (req, reply) => {
    const res = await report(routeId(req.params.id, "Reseña"), req.body?.reason, req.user.id);
    return reply.code(201).send(res);
  });
}
