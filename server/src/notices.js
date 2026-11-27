/**
 * Avisos a clientes (fase 4). Las decisiones transversales piden que un
 * rechazo se avise con su motivo, en la app/web **y** por correo.
 *
 * El aviso se crea dentro de la transacción de la decisión (si la decisión no
 * se guarda, no hay aviso) y el correo sale después del commit: un Resend
 * lento o caído no puede deshacer una moderación. Si el correo falla, el aviso
 * sigue en la app y `emailedAt` queda en null.
 */
import prisma from "./db.js";
import { httpError } from "./auth.js";

const LIST_LIMIT = 50;

/**
 * Texto del aviso de una reseña rechazada.
 * @param {string} productName Modelo reseñado.
 * @param {string} reasonLabel Motivo, ya en palabras.
 * @returns {{title: string, body: string}}
 */
export function rejectedReviewText(productName, reasonLabel) {
  return {
    title: `Tu reseña de «${productName}» no se publicó`,
    body: `Motivo: ${reasonLabel}. Puedes retirarla y escribir otra desde Mis pedidos.`,
  };
}

/**
 * Texto del aviso de una entrega registrada.
 * @param {number} orderId Pedido.
 * @param {string[]} names Prendas entregadas.
 * @param {string} returnBy Fecha límite sin costo, ya en palabras.
 * @returns {{title: string, body: string}}
 */
export function deliveredText(orderId, names, returnBy) {
  return {
    title: `Entregamos tu pedido #${orderId}`,
    body: `${names.join(", ")}. Puedes devolver${names.length === 1 ? "la" : "las"} sin costo extra hasta el ${returnBy}. ¡Que lo disfrutes!`,
  };
}

/**
 * Texto del aviso de una devolución registrada.
 * @param {number} orderId Pedido.
 * @param {string[]} names Prendas recibidas.
 * @param {{extraCents: number, extraDays: number}} late Días extra cobrados.
 * @returns {{title: string, body: string}}
 */
export function returnedText(orderId, names, { extraCents, extraDays }) {
  const extra = extraCents > 0
    ? ` Volvió${names.length === 1 ? "" : "eron"} ${extraDays} día${extraDays === 1 ? "" : "s"} hábil${extraDays === 1 ? "" : "es"} después de la fecha límite: se cobraron $${(extraCents / 100).toFixed(2)} por esos días.`
    : " A tiempo, sin cobros extra.";
  return {
    title: `Recibimos tu devolución del pedido #${orderId}`,
    body: `${names.join(", ")}.${extra} La garantía se revisa y se devuelve en los próximos días.`,
  };
}

/**
 * Guarda un aviso.
 * @param {object} tx Cliente Prisma o transacción.
 * @param {{userId: number, kind: string, title: string, body: string, reviewId?: number, orderId?: number}} data
 * @returns {Promise<object>} Fila creada.
 */
export function createNotice(tx, data) {
  return tx.notice.create({ data });
}

/**
 * Manda el correo de un aviso ya guardado y apunta cuándo salió. Nunca lanza:
 * el aviso ya existe y es lo que importa.
 * @param {object} notice Fila de `notices`.
 * @param {{enabled: boolean, send: Function}} mailer Ver mail.js.
 * @param {{error: Function}} log Logger de la petición.
 * @returns {Promise<boolean>} true si el correo salió.
 */
export async function deliverNotice(notice, mailer, log) {
  if (!mailer.enabled) return false;
  try {
    const user = await prisma.user.findUnique({ where: { id: notice.userId }, select: { email: true } });
    if (!user?.email) return false;
    await mailer.send({ to: user.email, subject: notice.title, text: `${notice.body}\n\n— CLOTH TO GO` });
    await prisma.notice.update({ where: { id: notice.id }, data: { emailedAt: new Date() } });
    return true;
  } catch (err) {
    // Sin el texto ni el destinatario: el log no guarda datos del cliente.
    log.error({ noticeId: notice.id, err: err.message }, "No se pudo enviar el correo de un aviso");
    return false;
  }
}

/** Aviso con la forma que leen la app y la web. */
const toApi = (n) => ({
  id: n.id, kind: n.kind, title: n.title, body: n.body, reviewId: n.reviewId, orderId: n.orderId,
  createdAt: n.createdAt, read: !!n.readAt,
});

/**
 * Registra las rutas de avisos del cliente.
 * @param {import("fastify").FastifyInstance} app Instancia Fastify.
 * @param {{requireUser: Function}} guards preHandlers.
 */
export function registerNoticeRoutes(app, { requireUser }) {
  app.get("/api/me/notices", { preHandler: requireUser }, async (req) => {
    const [filas, unread] = await Promise.all([
      prisma.notice.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: "desc" }, take: LIST_LIMIT }),
      prisma.notice.count({ where: { userId: req.user.id, readAt: null } }),
    ]);
    return { unread, notices: filas.map(toApi) };
  });

  // Sin `ids` marca todos. Solo toca los del propio cliente: un id ajeno no
  // cambia nada, y la respuesta no dice si existía.
  app.post("/api/me/notices/read", { preHandler: requireUser }, async (req) => {
    const ids = req.body?.ids;
    if (ids !== undefined && (!Array.isArray(ids) || ids.length > 200 || !ids.every((x) => Number.isInteger(x) && x > 0))) {
      throw httpError(400, "Lista de avisos no válida.");
    }
    const { count } = await prisma.notice.updateMany({
      where: { userId: req.user.id, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() },
    });
    return { marked: count };
  });
}
