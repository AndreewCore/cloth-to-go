/**
 * Ayudantes de base compartidos por las pruebas del servidor.
 *
 * Las bitácoras son de solo añadir y la base lo impone con un disparador, así
 * que las pruebas ya no pueden borrar sus pedidos a pelo: una entrada de la
 * bitácora apuntando al pedido lo impide. `purge()` abre la única puerta
 * (`ctg.purge`, solo dentro de su transacción) para dejar la base como estaba.
 */
import prisma from "../../src/db.js";

/**
 * Borra lo que dejaron unas cuentas de prueba (pedidos, cargos, reservas,
 * entradas de bitácora) y los ejemplares creados por la prueba, y devuelve a
 * Disponible los ejemplares de demostración que tocaron.
 * @param {object} what Qué limpiar.
 * @param {string[]} [what.subs] `googleSub` de las cuentas de prueba.
 * @param {number[]} [what.itemIds] Ejemplares creados por la prueba (se borran).
 */
export async function purge({ subs = [], itemIds = [] } = {}) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('ctg.purge', 'on', true)`;
    const users = await tx.user.findMany({ where: { googleSub: { in: subs } }, select: { id: true } });
    const userIds = users.map((u) => u.id);
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
      where: { OR: [{ orderId: { in: orderIds } }, { actorId: { in: userIds } }, { subjectUserId: { in: userIds } }] },
    });
    await tx.charge.deleteMany({ where: { OR: [{ orderId: { in: orderIds } }, { itemId: { in: itemIds } }] } });
    await tx.orderItem.deleteMany({ where: { OR: [{ orderId: { in: orderIds } }, { itemId: { in: itemIds } }] } });
    await tx.order.deleteMany({ where: { id: { in: orderIds } } });
    await tx.item.deleteMany({ where: { id: { in: itemIds } } });
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
