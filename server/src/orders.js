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
  initialCharges,
  latePenaltyCharge,
  paymentStatus,
  returnChangeAdjustment,
  CHARGE_STATUS,
  CHARGE_TYPE,
  heldDepositCents,
  revenueCents,
  totalCents,
  validateOrderVocabulary,
  validateOrderAddresses,
} from "./ledger.js";
import { DELIVERY, RETURN_TO, rentalDays } from "./pricing.js";
import { CAPABILITY, hasCapability, httpError, isStaff } from "./auth.js";
import { UNRENTABLE, isoToDate, pricedItem } from "./catalog.js";
import { releaseForOrder, reserveForOrder } from "./items.js";
import { FINANCE_EVENT, logFinance } from "./logs.js";
import { todayISO } from "./dates.js";

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
function orderToApi(order) {
  const charges = order.charges ?? [];
  return {
    id: order.id,
    start: order.start,
    end: order.end,
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

/** Qué relaciones hay que traer para poder derivar los totales. */
const CON_LINEAS = {
  items: { include: { item: { select: { productId: true } } }, orderBy: { id: "asc" } },
  charges: { orderBy: { id: "asc" } },
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
  if (new Set(items).size !== items.length) {
    // Un ejemplar es una pieza física: pedirlo dos veces no es un pedido de
    // dos unidades, es un error que además cobraría doble.
    throw httpError(400, "El pedido repite un ejemplar, y cada ejemplar es único.");
  }

  return {
    items,
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
      // Mismo mensaje para «no alquilable» que para «ocupada»: el cliente solo
      // distingue Disponible de No Disponible (§3).
      if (items.some((i) => UNRENTABLE.includes(i.status))) {
        throw httpError(409, "Alguna de las prendas no está disponible.");
      }
      if (items.some((i) => i.product.pricing !== "CTG")) {
        // Las tarifas de socio llegan con la fase 6; hasta entonces el servidor
        // no sabe cotizarlas y no cobra algo que no sabe cotizar.
        throw httpError(409, "Alguna de las prendas no está disponible.");
      }
      if (await overlapsLiveReservation(tx, datos.items, datos.start, datos.end)) {
        throw httpError(409, "Alguna de las prendas ya está reservada para esas fechas.");
      }

      // Mismo orden que pidió el cliente: las líneas RENTAL salen en ese orden.
      const porId = new Map(items.map((i) => [i.id, i]));
      const ordenados = datos.items.map((id) => porId.get(id));

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
          items: {
            create: datos.items.map((itemId) => ({
              itemId,
              start: isoToDate(datos.start),
              end: isoToDate(datos.end),
            })),
          },
          charges: { create: initialCharges({ ...datos, items: ordenados.map(pricedItem) }) },
        },
        include: CON_LINEAS,
      });
      await reserveForOrder(tx, ordenados, order.id);
      return order;
    });

    try {
      return reply.code(201).send(orderToApi(await crear()));
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

    const ajuste = returnChangeAdjustment(order.ret, ret, order.pay);
    const actualizado = await prisma.order.update({
      where: { id },
      data: {
        ret,
        retAddr: retAddr === null ? null : retAddr.trim(),
        ...(ajuste ? { charges: { create: ajuste } } : {}),
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

    // Cambia el ESTADO de las líneas, no su importe: la línea sigue diciendo lo
    // mismo, lo que cambia es que ese dinero ya entró.
    await prisma.$transaction(async (tx) => {
      await tx.charge.updateMany({
        where: { orderId: id, status: CHARGE_STATUS.PENDING },
        data: { status: CHARGE_STATUS.SETTLED },
      });
      await logFinance(tx, {
        kind: FINANCE_EVENT.COBRO_CONFIRMADO,
        actorId: req.user.id,
        orderId: id,
        amountCents: pendientes.reduce((s, c) => s + c.amountCents, 0),
        note: `Cobro confirmado en ${order.pay === "cash" ? "efectivo" : "caja"}`,
      });
    });
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

  // Solo caja: cobrar la penalización por devolución fuera de plazo. Existía
  // en la interfaz desde el principio y no se cobraba en ninguna parte.
  app.post("/api/orders/:id/late-penalty", { preHandler: requireCaja }, async (req) => {
    const id = Number(req.params.id);
    const order = await findOrderFor(id, req.user, true);
    if (order.cancelledAt) throw httpError(409, "El pedido está anulado.");

    // Dos clics del mostrador no son dos atrasos: son $30 donde había $15, en
    // dos líneas idénticas que nadie sabría distinguir después. Un segundo
    // atraso real existe —la prenda vuelve tarde dos veces si se prorroga— pero
    // entonces trae su propia nota, y eso sí se puede explicar a un cliente.
    // Se compara contra la línea que se iba a crear, no contra el cuerpo: sin
    // nota, `latePenaltyCharge` pone la suya por defecto, así que mirar el
    // cuerpo dejaría pasar el caso más común —dos clics sin nota ninguna—.
    const linea = latePenaltyCharge(req.body?.note);
    const yaCobrada = order.charges.some(
      (c) =>
        c.type === CHARGE_TYPE.LATE_PENALTY &&
        c.status !== CHARGE_STATUS.VOID &&
        c.note === linea.note,
    );
    if (yaCobrada) throw httpError(409, "Esa penalización ya está cobrada en el pedido.");

    await prisma.$transaction([
      prisma.charge.create({ data: { ...linea, orderId: id } }),
      logFinance(prisma, {
        kind: FINANCE_EVENT.PENALIZACION,
        actorId: req.user.id,
        orderId: id,
        amountCents: linea.amountCents,
        note: linea.note,
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
    // anular mientras las prendas no estén en su poder. Pasada la fecha de
    // inicio ya se entregaron, y eso se resuelve hablando con el local — que
    // sí puede anular, porque puede comprobarlo.
    if (!admin && todayISO() > order.start) {
      throw httpError(409, "El alquiler ya empezó: la anulación se gestiona con el local.");
    }

    const reversos = cancellationCharges(order.charges, req.body?.note);
    const anulado = await prisma.$transaction(async (tx) => {
      // Condición sobre `cancelledAt`: dos anulaciones simultáneas no pueden
      // escribir dos juegos de reversos.
      const { count } = await tx.order.updateMany({ where: { id, cancelledAt: null }, data: { cancelledAt: new Date() } });
      if (count === 0) throw httpError(409, "El pedido ya estaba anulado.");
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
