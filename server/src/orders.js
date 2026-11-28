/**
 * Rutas de pedidos y del libro de cargos.
 *
 * La regla que gobierna el archivo: **el cliente propone, el servidor decide**.
 * El checkout manda qué prendas, qué fechas y qué modo de entrega; ningún
 * importe que llegue en el cuerpo se usa jamás. Un importe enviado por el
 * cliente es una sugerencia hostil — se abre la consola y se cambia.
 *
 * Va en su propio módulo (y no en app.js) porque son seis rutas con reglas de
 * negocio propias: dejarlas dentro doblaba el archivo de arranque, que hasta
 * ahora se lee de un vistazo.
 */
import prisma from "./db.js";
import {
  cancellationCharges,
  depositReleaseCharge,
  paymentStatus,
  returnChangeAdjustment,
  CHARGE_STATUS,
  discountCents,
  discountCharge,
  heldDepositCents,
  revenueCents,
  totalCents,
  validateOrderVocabulary,
  validateOrderAddresses,
} from "./ledger.js";
import { DELIVERY, RETURN_TO, rentalDays } from "./pricing.js";
import { CAPABILITY, hasCapability, httpError, isStaff } from "./auth.js";
import { assertRentable, isoToDate, pricedItem } from "./catalog.js";
import { releaseForOrder, reserveForOrder } from "./items.js";
import { FINANCE_EVENT, logFinance } from "./logs.js";
import { isBusinessDay, returnByDate, todayISO } from "./dates.js";
import { holidaySet } from "./calendar.js";
import { rewardById, rewardDiscountCents } from "./rewards.js";
import { priceOrder } from "./quote.js";
import { countsForRewards, isDelivered, lockUser, revokeOrderRewards, settleRewards } from "./points.js";

/** Formato de fecha que acepta la API: día de calendario, sin hora ni zona. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Convierte un pedido de la base en la respuesta que ve el cliente.
 *
 * Los totales van **derivados del ledger**, nunca almacenados: `total` es la
 * suma de las líneas vivas, `revenue` la misma suma sin el depósito (que es
 * dinero en custodia, no facturación) y `status` sale de si queda algo
 * pendiente de cobro.
 * @param {object} order Pedido con `items` y `charges` incluidos.
 * @returns {object} Pedido para la API, con importes en USD y en centavos.
 */
export function orderToApi(order) {
  const charges = order.charges ?? [];
  return {
    id: order.id,
    start: order.start,
    end: order.end,
    // Hasta cuándo puede devolver sin costo extra (§6.0). Es el final de la
    // reserva y no se recalcula: si mañana cambian los feriados, la fecha que
    // se le prometió al cliente no se mueve.
    returnBy: order.items?.[0]?.end ? order.items[0].end.toISOString().slice(0, 10) : order.end,
    days: rentalDays(order.start, order.end),
    delivery: order.delivery,
    ret: order.ret,
    shipAddr: order.shipAddr,
    retAddr: order.retAddr,
    pay: order.pay,
    createdAt: order.createdAt,
    cancelledAt: order.cancelledAt,
    // `items` sigue siendo la lista de modelos, que es como el frontend guarda
    // un pedido; `itemIds` dice qué ejemplares concretos se reservaron.
    items: (order.items ?? []).map((i) => i.item.productId),
    itemIds: (order.items ?? []).map((i) => i.itemId),
    status: order.cancelledAt ? "cancelled" : paymentStatus(charges),
    // Cuándo el local registró la primera entrega; null = todavía «Reservado».
    // De esto dependen la etiqueta del cliente, si puede anular y sus premios.
    deliveredAt: firstDelivery(order.items),
    // Por ejemplar: el día real en que salió y en que volvió.
    lines: (order.items ?? []).map((i) => ({
      itemId: i.itemId,
      deliveredOn: i.deliveredOn ? i.deliveredOn.toISOString().slice(0, 10) : null,
      returnedOn: i.returnedOn ? i.returnedOn.toISOString().slice(0, 10) : null,
    })),
    // Premio aplicado y lo que rebaja hoy (las líneas DISCOUNT, en positivo).
    couponId: order.coupon?.id ?? null,
    discountCents: discountCents(charges),
    // Puntos que gana al entregarse y si ya entraron al saldo. Se acreditan
    // en cuanto el pedido cuenta (settleRewards corre antes de listar), así que
    // "acreditado" se deriva de la misma regla y no hace falta otra consulta.
    points: order.pointsEarned ?? 0,
    pointsCredited: (order.pointsEarned ?? 0) > 0 && countsForRewards(order),
    totalCents: totalCents(charges),
    total: totalCents(charges) / 100,
    revenueCents: revenueCents(charges),
    depositHeldCents: heldDepositCents(charges),
    charges: charges.map((c) => ({
      id: c.id,
      type: c.type,
      amountCents: c.amountCents,
      amount: c.amountCents / 100,
      status: c.status,
      method: c.method,
      itemId: c.itemId,
      note: c.note,
      createdAt: c.createdAt,
    })),
  };
}

/**
 * Confirma que entró el dinero pendiente de un pedido. Cambia el ESTADO de las
 * líneas, no su importe: la línea sigue diciendo lo mismo, lo que cambia es que
 * ese dinero ya entró. La usan «Confirmar cobro» y la entrega con cobro.
 * @param {object} tx Transacción Prisma.
 * @param {object} order Pedido con `charges` y `pay`.
 * @param {number} actorId Quién confirma (Caja).
 * @returns {Promise<number>} Centavos confirmados; 0 si no había nada.
 */
export async function settlePending(tx, order, actorId) {
  const cents = order.charges.filter((c) => c.status === CHARGE_STATUS.PENDING).reduce((s, c) => s + c.amountCents, 0);
  const { count } = await tx.charge.updateMany({
    where: { orderId: order.id, status: CHARGE_STATUS.PENDING },
    data: { status: CHARGE_STATUS.SETTLED },
  });
  if (!count) return 0;
  await logFinance(tx, {
    kind: FINANCE_EVENT.COBRO_CONFIRMADO,
    actorId,
    orderId: order.id,
    amountCents: cents,
    note: `Cobro confirmado en ${order.pay === "cash" ? "efectivo" : "caja"}`,
  });
  return cents;
}

/**
 * Primera entrega registrada de un pedido.
 * @param {{deliveredAt: Date|null}[]} [items] Líneas del pedido.
 * @returns {Date|null}
 */
function firstDelivery(items = []) {
  const fechas = items.map((i) => i.deliveredAt).filter(Boolean).sort((a, b) => a - b);
  return fechas[0] ?? null;
}

/** Qué relaciones hay que traer para poder derivar los totales. */
export const CON_LINEAS = {
  items: { include: { item: { select: { productId: true } } }, orderBy: { id: "asc" } },
  charges: { orderBy: { id: "asc" } },
  coupon: { select: { id: true, rewardId: true } },
};

/**
 * Busca un pedido y comprueba que quien pregunta puede verlo.
 *
 * 404 tanto si no existe como si es de otro: decirle a un extraño "existe pero
 * no es tuyo" ya le confirma que existe, y con los ids correlativos eso permite
 * contar los pedidos del negocio pidiéndolos uno a uno.
 * @param {number} id Id del pedido.
 * @param {object} user Usuario autenticado.
 * @param {boolean} [admin=false] Si puede ver pedidos ajenos.
 * @returns {Promise<object>} Pedido con líneas.
 */
async function findOrderFor(id, user, admin = false) {
  // Un id que no es número no llega a Prisma: `findUnique({ where: { id: NaN } })`
  // revienta con un 500, y "/api/orders/abc" es entrada del cliente, no un fallo
  // del servidor.
  if (!Number.isInteger(id)) throw httpError(404, "Pedido no encontrado.");
  const order = await prisma.order.findUnique({ where: { id }, include: CON_LINEAS });
  if (!order || (!admin && order.userId !== user.id)) {
    throw httpError(404, "Pedido no encontrado.");
  }
  return order;
}

/**
 * Valida el cuerpo de un pedido nuevo y devuelve sus datos ya normalizados.
 * @param {object} body Cuerpo de la petición.
 * @returns {object} Datos del pedido listos para el ledger.
 */
function parseOrderBody(body) {
  const { start, end, delivery, ret, pay } = body ?? {};

  const vocabulario = validateOrderVocabulary({ delivery, ret, pay });
  if (vocabulario) throw httpError(400, vocabulario);

  const direcciones = validateOrderAddresses({
    delivery,
    ret,
    shipAddr: body?.shipAddr,
    retAddr: body?.retAddr,
  });
  if (direcciones) throw httpError(400, direcciones);

  if (!ISO_DATE.test(start ?? "") || !ISO_DATE.test(end ?? "")) {
    throw httpError(400, "Las fechas deben venir como YYYY-MM-DD.");
  }
  if (end < start) throw httpError(400, "La devolución no puede ser anterior al inicio.");
  if (start < todayISO()) throw httpError(400, "El alquiler no puede empezar en el pasado.");

  const items = body?.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw httpError(400, "El pedido no lleva ninguna prenda.");
  }
  if (!items.every((id) => Number.isInteger(id))) {
    throw httpError(400, "Las prendas se identifican por el id numérico del ejemplar.");
  }
  // El premio viaja como id, nunca como importe: el descuento lo calcula el
  // servidor (§2 de PENDIENTE). Opcional.
  const couponId = body?.couponId ?? null;
  if (couponId !== null && !Number.isInteger(couponId)) {
    throw httpError(400, "El premio se identifica por su id numérico.");
  }
  if (new Set(items).size !== items.length) {
    // Un ejemplar es una pieza física: pedirlo dos veces no es un pedido de
    // dos unidades, es un error que además cobraría doble.
    throw httpError(400, "El pedido repite un ejemplar, y cada ejemplar es único.");
  }

  return {
    items,
    couponId,
    start,
    end,
    delivery,
    ret,
    pay,
    // La dirección solo se guarda cuando el modo la necesita: retirar en el
    // local no requiere saber dónde vive el cliente, y guardar un dato personal
    // que no hace falta es una fuga esperando a que alguien la lea.
    // Se guardan recortadas: los espacios de los extremos no son parte de la
    // dirección, y sin recortar "  " pasaría por dirección de dos caracteres.
    shipAddr: delivery === DELIVERY.SHIP ? body.shipAddr.trim() : null,
    retAddr: ret === RETURN_TO.HOME ? body.retAddr.trim() : null,
  };
}

/**
 * Ejemplares que ya tienen una reserva viva solapada con `[start, end]`.
 *
 * Es solo la comprobación amable, para responder con un mensaje claro en el
 * caso normal. La defensa de verdad es la restricción de exclusión de la base
 * (`order_items_sin_solape`): dos checkouts simultáneos pasan los dos esta
 * consulta, pero solo uno pasa la restricción (ver `isOverlapViolation`).
 * Extremos inclusivos, como la restricción: devolver el día X ocupa el día X.
 * @param {object} tx Transacción Prisma.
 * @param {number[]} itemIds Ejemplares pedidos.
 * @param {string} start Inicio (`YYYY-MM-DD`).
 * @param {string} end Devolución (`YYYY-MM-DD`).
 * @returns {Promise<boolean>}
 */
async function overlapsLiveReservation(tx, itemIds, start, end) {
  const n = await tx.orderItem.count({
    where: {
      itemId: { in: itemIds },
      releasedAt: null,
      start: { lte: isoToDate(end) },
      end: { gte: isoToDate(start) },
    },
  });
  return n > 0;
}

/**
 * Reconoce el error de Postgres por la restricción de solape (SQLSTATE 23P01).
 *
 * Prisma no tiene un código propio para las restricciones de exclusión y lo
 * entrega como error desconocido con el texto de Postgres; se mira el nombre
 * de la restricción para no confundirlo con ningún otro fallo.
 * @param {unknown} err Error capturado.
 * @returns {boolean}
 */
export function isOverlapViolation(err) {
  const texto = `${err?.message ?? ""} ${JSON.stringify(err?.meta ?? {})}`;
  return texto.includes("order_items_sin_solape") || texto.includes("23P01");
}

/**
 * Registra las rutas de pedidos.
 * @param {import("fastify").FastifyInstance} app Instancia Fastify.
 * @param {object} guards preHandlers de autenticación.
 * @param {Function} guards.requireUser Exige usuario autenticado.
 * @param {Function} guards.requireCapability Fabrica el guard de una capacidad.
 */
export function registerOrderRoutes(app, { requireUser, requireCapability }) {
  const requireCaja = requireCapability(CAPABILITY.CAJA);

  // Pedidos del usuario autenticado, del más reciente al más antiguo.
  app.get("/api/orders", { preHandler: requireUser }, async (req) => {
    // Liquida antes de listar: así `pointsCredited` dice la verdad del saldo.
    await settleRewards(prisma, req.user.id);
    const pedidos = await prisma.order.findMany({
      where: { userId: req.user.id },
      include: CON_LINEAS,
      orderBy: { id: "desc" },
    });
    return pedidos.map(orderToApi);
  });

  // Crear pedido: el servidor calcula TODOS los importes desde el catálogo.
  app.post("/api/orders", { preHandler: requireUser }, async (req, reply) => {
    // Un cliente no puede ser trabajador (§2.1): la cuenta del personal no
    // alquila. Así ninguna acción de caja recae nunca sobre un pedido propio.
    if (isStaff(req.user)) {
      throw httpError(403, "Las cuentas del personal no pueden alquilar; usa una cuenta de cliente.");
    }
    const datos = parseOrderBody(req.body);

    // Sin retiros ni devoluciones en fin de semana ni feriado (§6.0). El
    // calendario del cliente ya los deshabilita; esto es la comprobación real.
    const feriados = await holidaySet();
    if (!isBusinessDay(datos.start, feriados) || !isBusinessDay(datos.end, feriados)) {
      throw httpError(400, "El local no atiende ese día: elige un día hábil para retirar y devolver.");
    }
    // La prenda queda reservada hasta el cierre de la ventana, no hasta el día
    // elegido: el cliente puede quedársela sin costo extra hasta entonces, y
    // otro alquiler que empiece antes se quedaría sin ella.
    const returnBy = returnByDate(datos.start, datos.end, feriados);

    const crear = () => prisma.$transaction(async (tx) => {
      // Los ejemplares y su modelo se leen de la BASE, no del cuerpo: el precio
      // sale de `value`, y aceptar el del cliente sería regalarle la tarifa.
      const items = await tx.item.findMany({
        where: { id: { in: datos.items } },
        include: { product: { include: { materialRef: true } } },
      });
      if (items.length !== datos.items.length) {
        throw httpError(400, "Alguna de las prendas no existe en el catálogo.");
      }
      assertRentable(items, datos.start, feriados);
      if (items.some((i) => i.product.pricing !== "CTG")) {
        // Las tarifas de socio llegan con la fase 6; hasta entonces el servidor
        // no sabe cotizarlas y no cobra algo que no sabe cotizar.
        throw httpError(409, "Alguna de las prendas no está disponible.");
      }
      if (await overlapsLiveReservation(tx, datos.items, datos.start, returnBy)) {
        throw httpError(409, "Alguna de las prendas ya está reservada para esas fechas.");
      }

      // Mismo orden que pidió el cliente: las líneas RENTAL salen en ese orden.
      const porId = new Map(items.map((i) => [i.id, i]));
      const ordenados = datos.items.map((id) => porId.get(id));
      // El mismo cálculo que enseña la cotización (quote.js): lo que se cobra
      // no puede separarse de lo que se mostró, porque no hay dos cálculos.
      // Un premio que no rebaja nada NO se consume: el pedido sale sin él y la
      // respuesta dice por qué; uno que ya no existe para esta cuenta, 409.
      const { lineas, cupon, couponIssue, couponMissing, pointsEarned } =
        await priceOrder(tx, { ...datos, items: ordenados }, req.user.id);
      if (couponMissing) throw httpError(409, "Ese premio ya no está disponible.");

      const order = await tx.order.create({
        data: {
          userId: req.user.id,
          start: datos.start,
          end: datos.end,
          delivery: datos.delivery,
          ret: datos.ret,
          shipAddr: datos.shipAddr,
          retAddr: datos.retAddr,
          pay: datos.pay,
          pointsEarned,
          items: {
            create: datos.items.map((itemId) => ({
              itemId,
              start: isoToDate(datos.start),
              end: isoToDate(returnBy),
            })),
          },
          charges: { create: lineas },
        },
        include: CON_LINEAS,
      });
      if (cupon) {
        // Condicional: dos checkouts simultáneos con el mismo cupón pasan los
        // dos la lectura de arriba, pero solo uno lo encuentra libre aquí.
        const { count } = await tx.coupon.updateMany({
          where: { id: cupon.id, usedInOrderId: null, revokedAt: null },
          data: { usedInOrderId: order.id },
        });
        if (count === 0) throw httpError(409, "Ese premio ya no está disponible.");
      }
      await reserveForOrder(tx, ordenados, order.id);
      const creado = await tx.order.findUnique({ where: { id: order.id }, include: CON_LINEAS });
      return { order: creado, couponIssue };
    });

    try {
      const { order, couponIssue } = await crear();
      return reply.code(201).send({ ...orderToApi(order), couponIssue });
    } catch (err) {
      // Otro checkout ganó la carrera entre la comprobación y la escritura.
      if (isOverlapViolation(err)) {
        throw httpError(409, "Alguna de las prendas ya está reservada para esas fechas.");
      }
      throw err;
    }
  });

  // Cambiar el modo de devolución: NO edita la línea anterior, añade el ajuste.
  app.patch("/api/orders/:id/return", { preHandler: requireUser }, async (req) => {
    const id = Number(req.params.id);
    const order = await findOrderFor(id, req.user);
    if (order.cancelledAt) throw httpError(409, "El pedido está anulado.");

    const { ret } = req.body ?? {};
    if (!Object.values(RETURN_TO).includes(ret)) {
      throw httpError(400, "Modo de devolución no válido.");
    }

    // La dirección puede venir en la petición o heredarse de la que ya tenía el
    // pedido; se valida la que va a quedar guardada, no la que llegó. Sin esto,
    // pasar a domicilio un pedido que se retiraba en el local dejaba un envío
    // sin dirección: el modo cambia, el cargo se genera y no hay dónde llevarlo.
    const retAddr = ret === RETURN_TO.HOME ? (req.body.retAddr ?? order.retAddr) : null;
    const errorAddr = validateOrderAddresses({ ret, retAddr });
    if (errorAddr) throw httpError(400, errorAddr);

    const lineas = [];
    const ajuste = returnChangeAdjustment(order.ret, ret, order.pay);
    if (ajuste) lineas.push(ajuste);

    // Un premio de envío deja de valer si la devolución pasa al local (y al
    // revés): se revalora con el modo nuevo y la diferencia va en otra línea
    // DISCOUNT, sin tocar la anterior.
    if (order.coupon) {
      const rw = rewardById(order.coupon.rewardId);
      const items = await prisma.item.findMany({
        where: { id: { in: order.items.map((i) => i.itemId) } },
        include: { product: { include: { materialRef: true } } },
      });
      const ctx = { items: items.map(pricedItem), days: rentalDays(order.start, order.end), delivery: order.delivery, ret };
      const delta = rewardDiscountCents(rw, ctx) - discountCents(order.charges);
      if (delta !== 0) lineas.push(discountCharge(delta, order.pay, `Premio revalorado: cambio de devolución`));
    }

    const actualizado = await prisma.order.update({
      where: { id },
      data: {
        ret,
        retAddr: retAddr === null ? null : retAddr.trim(),
        ...(lineas.length ? { charges: { create: lineas } } : {}),
      },
      include: CON_LINEAS,
    });
    return orderToApi(actualizado);
  });

  // Solo caja: confirmar que el efectivo entró. El cliente nunca puede darse
  // por cobrado a sí mismo, que es la frontera entera de este endpoint.
  app.post("/api/orders/:id/settle", { preHandler: requireCaja }, async (req) => {
    const id = Number(req.params.id);
    const order = await findOrderFor(id, req.user, true);
    if (order.cancelledAt) throw httpError(409, "El pedido está anulado.");

    const pendientes = order.charges.filter((c) => c.status === CHARGE_STATUS.PENDING);
    if (pendientes.length === 0) throw httpError(409, "El pedido no tiene cobros pendientes.");

    await prisma.$transaction((tx) => settlePending(tx, order, req.user.id));
    return orderToApi(await findOrderFor(id, req.user, true));
  });

  // Solo caja: liberar el depósito al recibir la prenda en buen estado.
  app.post("/api/orders/:id/deposit-release", { preHandler: requireCaja }, async (req) => {
    const id = Number(req.params.id);
    const order = await findOrderFor(id, req.user, true);
    if (order.cancelledAt) throw httpError(409, "El pedido está anulado.");

    const linea = depositReleaseCharge(order.charges, req.body?.note);
    if (!linea) throw httpError(409, "El pedido no tiene depósito retenido.");

    await prisma.$transaction([
      prisma.charge.create({ data: { ...linea, orderId: id } }),
      logFinance(prisma, {
        kind: FINANCE_EVENT.GARANTIA_LIBERADA,
        actorId: req.user.id,
        orderId: id,
        amountCents: -linea.amountCents,
        note: linea.note ?? "Garantía liberada",
      }),
    ]);
    return orderToApi(await findOrderFor(id, req.user, true));
  });

  // Anular: revierte los cargos con líneas espejo y marca la fecha.
  app.post("/api/orders/:id/cancel", { preHandler: requireUser }, async (req) => {
    const id = Number(req.params.id);
    // Anular un pedido ajeno es de Administración (§2.1), no de cualquier
    // capacidad: es la frontera de las decisiones que hay que poder explicar.
    const admin = hasCapability(req.user, CAPABILITY.ADMINISTRACION);
    const order = await findOrderFor(id, req.user, admin);
    if (order.cancelledAt) throw httpError(409, "El pedido ya estaba anulado.");

    // Misma frontera que `canCancelOrder()` en el frontend: el cliente puede
    // anular mientras las prendas no estén en su poder, es decir, mientras el
    // local no haya registrado la entrega (aunque ya pasara el día de retiro:
    // si no vino, no alquiló). Después se resuelve hablando con el local, que
    // sí puede anular porque puede comprobarlo.
    if (!admin && isDelivered(order)) {
      throw httpError(409, "Ya recibiste las prendas: la anulación se gestiona con el local.");
    }

    const reversos = cancellationCharges(order.charges, req.body?.note);
    const anulado = await prisma.$transaction(async (tx) => {
      // Condición sobre `cancelledAt`: dos anulaciones simultáneas no pueden
      // escribir dos juegos de reversos.
      await lockUser(tx, order.userId);
      const { count } = await tx.order.updateMany({ where: { id, cancelledAt: null }, data: { cancelledAt: new Date() } });
      if (count === 0) throw httpError(409, "El pedido ya estaba anulado.");
      // Puntos fuera (si ya entraron) y cupón de vuelta a la cartera.
      await revokeOrderRewards(tx, order);
      if (reversos.length) {
        await tx.charge.createMany({ data: reversos.map((r) => ({ ...r, orderId: id })) });
      }
      await releaseForOrder(tx, id);
      await logFinance(tx, {
        kind: FINANCE_EVENT.ANULACION,
        actorId: req.user.id,
        orderId: id,
        amountCents: reversos.reduce((s, r) => s + r.amountCents, 0),
        note: req.body?.note
          ? String(req.body.note).slice(0, 500)
          : order.userId === req.user.id ? "Anulado por el cliente" : "Anulado por el local",
      });
      return tx.order.findUnique({ where: { id }, include: CON_LINEAS });
    });
    return orderToApi(anulado);
  });

  // Solo caja: la bitácora financiera de un pedido, de la más vieja a la más
  // nueva. Nunca la ve el cliente (§3.1).
  app.get("/api/orders/:id/finance-log", { preHandler: requireCaja }, async (req) => {
    const id = Number(req.params.id);
    await findOrderFor(id, req.user, true);
    return prisma.financeLog.findMany({
      where: { orderId: id },
      orderBy: { id: "asc" },
      include: { actor: { select: { name: true } } },
    });
  });
}
