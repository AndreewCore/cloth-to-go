/**
 * Ayudantes de base compartidos por las pruebas del servidor.
 *
 * Las bitácoras son de solo añadir y la base lo impone con un disparador, así
 * que las pruebas ya no pueden borrar sus pedidos a pelo: una entrada de la
 * bitácora apuntando al pedido lo impide. `purge()` abre la única puerta
 * (`ctg.purge`, solo dentro de su transacción) para dejar la base como estaba.
 */
import prisma from "../../src/db.js";
import { holidaySet } from "../../src/calendar.js";
import { addDaysISO, nextBusinessDay, todayISO } from "../../src/dates.js";

/**
 * Borra lo que dejaron unas cuentas de prueba (pedidos, cargos, reservas,
 * entradas de bitácora) y los ejemplares creados por la prueba, y devuelve a
 * Disponible los ejemplares de demostración que tocaron.
 * @param {object} what Qué limpiar.
 * @param {string[]} [what.subs] `googleSub` de las cuentas de prueba.
 * @param {number[]} [what.itemIds] Ejemplares creados por la prueba (se borran).
 * @param {number[]} [what.productIds] Modelos creados por la prueba (se borran
 *   con todos sus ejemplares).
 */
export async function purge({ subs = [], itemIds: sueltos = [], productIds = [] } = {}) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('ctg.purge', 'on', true)`;
    const users = await tx.user.findMany({ where: { googleSub: { in: subs } }, select: { id: true } });
    const userIds = users.map((u) => u.id);
    const deModelos = await tx.item.findMany({ where: { productId: { in: productIds } }, select: { id: true } });
    const itemIds = [...new Set([...sueltos, ...deModelos.map((i) => i.id)])];
    const orders = await tx.order.findMany({
      where: { userId: { in: userIds } },
      select: { id: true, items: { select: { itemId: true } } },
    });
    const orderIds = orders.map((o) => o.id);
    const movidos = await tx.itemLog.findMany({ where: { actorId: { in: userIds } }, select: { itemId: true } });
    const tocados = new Set([...orders.flatMap((o) => o.items.map((i) => i.itemId)), ...movidos.map((m) => m.itemId)]);

    await tx.itemLog.deleteMany({
      where: { OR: [{ orderId: { in: orderIds } }, { actorId: { in: userIds } }, { itemId: { in: itemIds } }] },
    });
    await tx.financeLog.deleteMany({
      where: {
        OR: [{ orderId: { in: orderIds } }, { actorId: { in: userIds } }, { subjectUserId: { in: userIds } },
          { productId: { in: productIds } }],
      },
    });
    await tx.charge.deleteMany({ where: { OR: [{ orderId: { in: orderIds } }, { itemId: { in: itemIds } }] } });
    await tx.pointsEntry.deleteMany({ where: { userId: { in: userIds } } });
    await tx.coupon.deleteMany({ where: { userId: { in: userIds } } });
    await tx.session.deleteMany({ where: { userId: { in: userIds } } });
    // Reportes y moderaciones de las cuentas de prueba, antes que sus reseñas y
    // ellas mismas (las claves foráneas no dejan otro orden).
    await tx.reviewReport.deleteMany({ where: { userId: { in: userIds } } });
    await tx.review.updateMany({ where: { moderatedById: { in: userIds } }, data: { moderatedById: null } });
    await tx.review.deleteMany({
      where: { OR: [{ userId: { in: userIds } }, { orderId: { in: orderIds } }, { productId: { in: productIds } }] },
    });
    await tx.activityLog.deleteMany({
      where: {
        OR: [{ actorId: { in: userIds } }, { productId: { in: productIds } }, { itemId: { in: itemIds } }],
      },
    });
    await tx.itemPhoto.deleteMany({
      where: { OR: [{ orderId: { in: orderIds } }, { takenById: { in: userIds } }, { itemId: { in: itemIds } }] },
    });
    await tx.orderItem.deleteMany({ where: { OR: [{ orderId: { in: orderIds } }, { itemId: { in: itemIds } }] } });
    await tx.order.deleteMany({ where: { id: { in: orderIds } } });
    await tx.item.deleteMany({ where: { id: { in: itemIds } } });
    await tx.product.deleteMany({ where: { id: { in: productIds } } });
    await tx.user.deleteMany({ where: { id: { in: userIds } } });
    await tx.item.updateMany({
      where: { id: { in: [...tocados].filter((id) => !itemIds.includes(id)) } },
      data: { status: "DISPONIBLE", unrentableReason: null, laundryKind: null, laundryPlace: null },
    });
  });
}

/**
 * Crea (o actualiza) una cuenta de prueba con capacidades, como haría
 * `pnpm staff:grant`, sin pasar por la bitácora.
 * @param {string} sub `googleSub`, que en las pruebas es también el token.
 * @param {string[]} capabilities Capacidades.
 * @returns {Promise<object>} Fila de `users`.
 */
export function grant(sub, capabilities) {
  return prisma.user.upsert({
    where: { googleSub: sub },
    update: { capabilities },
    create: { googleSub: sub, email: `${sub}@test`, name: sub, capabilities },
  });
}

/**
 * Lee el catálogo público y lo aplana a ejemplares: cada entrada es el primer
 * ejemplar de un modelo, con `id` del ejemplar y `productId` del modelo. Es lo
 * que las pruebas de pedidos necesitan, porque un pedido reserva ejemplares.
 * @param {import("fastify").FastifyInstance} app App ya lista.
 * @returns {Promise<object[]>}
 */
export async function demoItems(app) {
  const res = await app.inject({ method: "GET", url: "/api/products" });
  return res.json().map((p) => ({ ...p, id: p.items[0].id, productId: p.id }));
}

/* ---- Días hábiles para las fechas de prueba ----
   La API rechaza retiros y devoluciones en fin de semana y feriado (§6.0). Una
   prueba que pidiera "hoy + 2" fallaría solo los días en que eso cae en sábado,
   o solo en diciembre; por eso las fechas de los pedidos se cuentan en días
   HÁBILES, con los feriados reales de la base. */
let feriados = null;

/** Lee los feriados de la base; llamar en el `before` de cada archivo. */
export async function loadHolidays() {
  feriados = await holidaySet();
}

/**
 * El n-ésimo día hábil a partir de mañana (n = 0 es el primero).
 * @param {number} n Índice, desde 0.
 * @returns {string} `YYYY-MM-DD`.
 */
export function habil(n) {
  if (!feriados) throw new Error("Llama a loadHolidays() en el before de la prueba.");
  let d = nextBusinessDay(addDaysISO(todayISO(), 1), feriados);
  for (let i = 0; i < n; i++) d = nextBusinessDay(addDaysISO(d, 1), feriados);
  return d;
}
