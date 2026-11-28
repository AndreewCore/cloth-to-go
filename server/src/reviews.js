/**
 * Reseñas de clientes (fase 4). Antes vivían en el navegador de cada uno; ahora
 * en la base, con dos garantías que el navegador no podía dar:
 *
 * - **Alquiler verificado.** Solo reseña quien alquiló ese modelo en un pedido
 *   suyo ya cumplido (la misma regla que los puntos, `countsForRewards`):
 *   reseñar algo que aún no se recibió quedaría publicado.
 * - **Moderación.** Toda reseña nace PENDIENTE y solo la ve el público cuando
 *   Moderación la aprueba (moderation.js). El autor ve las suyas siempre, con
 *   su estado y, si se rechazó, el motivo.
 *
 * La foto pasa por la tubería de photos.js y va al cubo privado: hasta que se
 * aprueba no es de nadie más que de su autor.
 */
import prisma from "./db.js";
import { httpError } from "./auth.js";
import { routeId } from "./catalog.js";
import { countsForRewards } from "./points.js";
import { readPhotoUpload } from "./photos.js";
import { BUCKET, newKey, requestOrigin } from "./storage.js";

const TEXT_MAX = 500;

/**
 * Nombre con el que se firma una reseña pública: nombre y la inicial del
 * apellido («Ana R.»). Es lo que la gente espera ver, sin publicar el nombre
 * completo ni el correo de nadie.
 * @param {{name?: string|null}} user Autor.
 * @returns {string}
 */
export function publicAuthor(user) {
  const partes = String(user?.name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "Cliente";
  return partes.length > 1 ? `${partes[0]} ${partes.at(-1)[0].toUpperCase()}.` : partes[0];
}

/** Media de una lista de reseñas, con un decimal; 0 si no hay. */
const average = (rs) => (rs.length ? Math.round((rs.reduce((s, r) => s + r.rating, 0) / rs.length) * 10) / 10 : 0);

/**
 * Valida los campos de una reseña nueva.
 * @param {Record<string, string>} f Campos del formulario.
 * @returns {{orderId: number, productId: number, rating: number, text: string}}
 */
export function parseReview(f) {
  const orderId = Number(f.orderId);
  const productId = Number(f.productId);
  const rating = Number(f.rating);
  if (!Number.isInteger(orderId) || orderId <= 0 || !Number.isInteger(productId) || productId <= 0) {
    throw httpError(400, "Falta el pedido o la prenda de la reseña.");
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw httpError(400, "La valoración va de 1 a 5 estrellas.");
  const text = typeof f.text === "string" ? f.text.trim().replace(/\r\n/g, "\n") : "";
  if (text.length > TEXT_MAX) throw httpError(400, `La reseña puede tener hasta ${TEXT_MAX} caracteres.`);
  return { orderId, productId, rating, text };
}

/**
 * Registra las rutas de reseñas.
 * @param {import("fastify").FastifyInstance} app Instancia Fastify.
 * @param {{requireUser: Function, optionalUser: Function}} guards preHandlers.
 * @param {{storage: object, allowUpload: (userId: number) => boolean}} deps
 */
export function registerReviewRoutes(app, { requireUser, optionalUser }, { storage, allowUpload }) {
  /** Reseña con la forma que consume la app; la foto llega con enlace firmado. */
  const toApi = async (r, origin, { own = false, reported = false } = {}) => ({
    id: r.id,
    productId: r.productId,
    orderId: own ? r.orderId : undefined,
    rating: r.rating,
    text: r.text,
    author: publicAuthor(r.user),
    date: r.createdAt.toISOString().slice(0, 10),
    photo: r.photoKey ? await storage.signedUrl(r.photoKey, origin) : null,
    status: own ? r.status : undefined,
    // Solo el autor sabe por qué se rechazó la suya.
    rejectReason: own ? r.rejectReason ?? null : undefined,
    reported: reported || undefined,
  });

  // Reseñas publicadas de un modelo, con su media. Con sesión, también las
  // del propio cliente que aún no se publicaron, para que vea las suyas.
  app.get("/api/products/:id/reviews", { preHandler: optionalUser }, async (req) => {
    const productId = routeId(req.params.id, "Modelo");
    const origin = requestOrigin(req);
    const publicadas = await prisma.review.findMany({
      where: { productId, status: "APROBADA" },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { user: { select: { name: true } } },
    });
    const mias = req.user
      ? await prisma.review.findMany({
        where: { productId, userId: req.user.id, status: { not: "APROBADA" } },
        orderBy: { createdAt: "desc" },
        include: { user: { select: { name: true } } },
      })
      : [];
    // Lo que este cliente ya reportó: la app no le ofrece reportarlo dos veces.
    const reportadas = req.user
      ? new Set((await prisma.reviewReport.findMany({
        where: { userId: req.user.id, reviewId: { in: publicadas.map((r) => r.id) } },
        select: { reviewId: true },
      })).map((x) => x.reviewId))
      : new Set();
    return {
      average: average(publicadas),
      count: publicadas.length,
      reviews: await Promise.all(publicadas.map((r) => toApi(r, origin, { own: r.userId === req.user?.id, reported: reportadas.has(r.id) }))),
      mine: await Promise.all(mias.map((r) => toApi(r, origin, { own: true }))),
    };
  });

  // Todas las reseñas del cliente, en cualquier estado: la app sabe así qué
  // prendas de cada pedido ya reseñó.
  app.get("/api/me/reviews", { preHandler: requireUser }, async (req) => {
    const rs = await prisma.review.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { name: true } } },
    });
    return Promise.all(rs.map((r) => toApi(r, requestOrigin(req), { own: true })));
  });

  // Alta de una reseña (multipart: campos y, opcional, una foto).
  app.post("/api/reviews", { preHandler: requireUser }, async (req, reply) => {
    if (!allowUpload(req.user.id)) throw httpError(429, "Demasiadas reseñas seguidas. Espera un minuto.");
    const { fields, photos } = await readPhotoUpload(req, { optional: true, maxFiles: 1 });
    const datos = parseReview(fields);

    const pedido = await prisma.order.findUnique({
      where: { id: datos.orderId },
      include: { items: { include: { item: { select: { productId: true } } } } },
    });
    // Un pedido ajeno responde igual que uno inexistente: no se confirma que exista.
    if (!pedido || pedido.userId !== req.user.id) throw httpError(404, "Pedido no encontrado.");
    if (!pedido.items.some((oi) => oi.item.productId === datos.productId)) {
      throw httpError(409, "Esa prenda no es de este pedido.");
    }
    if (!countsForRewards(pedido)) {
      throw httpError(409, "Podrás reseñarla cuando hayas recibido la prenda.");
    }
    if (await prisma.review.findUnique({ where: { orderId_productId: { orderId: datos.orderId, productId: datos.productId } } })) {
      throw httpError(409, "Ya reseñaste esta prenda en este pedido.");
    }

    let photoKey = null;
    if (photos.length) {
      photoKey = newKey(BUCKET.PRIVATE, "resenas");
      await storage.put(photoKey, photos[0]);
    }
    try {
      const r = await prisma.review.create({
        data: { ...datos, userId: req.user.id, photoKey },
        include: { user: { select: { name: true } } },
      });
      return reply.code(201).send(await toApi(r, requestOrigin(req), { own: true }));
    } catch (err) {
      if (photoKey) await storage.remove(photoKey).catch(() => {});
      // Dos envíos a la vez: el segundo choca con la clave única.
      if (err.code === "P2002") throw httpError(409, "Ya reseñaste esta prenda en este pedido.");
      throw err;
    }
  });

  // El autor puede retirar su reseña (con su foto). Moderación la oculta por
  // otro camino; esto es el derecho del autor sobre lo que escribió.
  app.delete("/api/reviews/:id", { preHandler: requireUser }, async (req, reply) => {
    const id = routeId(req.params.id, "Reseña");
    const r = await prisma.review.findUnique({ where: { id } });
    if (!r || r.userId !== req.user.id) throw httpError(404, "Reseña no encontrada.");
    await prisma.review.delete({ where: { id } });
    if (r.photoKey) await storage.remove(r.photoKey).catch((err) => req.log.error({ err }, "No se pudo borrar la foto de una reseña"));
    return reply.code(204).send();
  });
}
