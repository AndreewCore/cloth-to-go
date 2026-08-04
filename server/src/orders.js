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
} from "./ledger.js";
import { DELIVERY, RETURN_TO, rentalDays } from "./pricing.js";
import { isAdmin } from "./auth.js";

// Ecuador continental es UTC−5 todo el año (sin horario de verano). Se fija a
// mano en vez de confiar en la zona del proceso: en producción el contenedor
// corre en UTC, y con `new Date()` el día del negocio cambiaría a las 19:00
// hora de Guayaquil — los alquileres empezarían "mañana" toda la tarde.
const EC_OFFSET_MIN = -5 * 60;

/**
 * Fecha de hoy en Guayaquil, como `YYYY-MM-DD`.
 * @returns {string} Día de calendario local.
 */
function todayISO() {
  // Se desplaza el instante UTC y se lee con toISOString: así el día sale de
  // una cuenta explícita y no de la zona horaria en que corra el proceso.
  return new Date(Date.now() + EC_OFFSET_MIN * 60000).toISOString().slice(0, 10);
}

/** Formato de fecha que acepta la API: día de calendario, sin hora ni zona. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Error con código HTTP para el `setErrorHandler` de app.js.
 * @param {number} status Código HTTP.
 * @param {string} message Mensaje para el cliente.
 * @returns {Error} Error con `statusCode`.
 */
function httpError(status, message) {
  const err = new Error(message);
  err.statusCode = status;
  return err;
}

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
    items: (order.items ?? []).map((i) => i.productId),
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
      productId: c.productId,
      note: c.note,
      createdAt: c.createdAt,
    })),
  };
}

/** Qué relaciones hay que traer para poder derivar los totales. */
const CON_LINEAS = { items: true, charges: { orderBy: { id: "asc" } } };

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
    throw httpError(400, "Las prendas se identifican por id numérico.");
  }
  if (new Set(items).size !== items.length) {
    // Cada prenda es única (`disponibles` = 1): pedirla dos veces no es un
    // pedido de dos unidades, es un error que además cobraría doble.
    throw httpError(400, "El pedido repite una prenda, y cada prenda es única.");
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
    shipAddr: delivery === DELIVERY.SHIP ? (body?.shipAddr ?? null) : null,
    retAddr: ret === RETURN_TO.HOME ? (body?.retAddr ?? null) : null,
  };
}

/**
 * Ids de prendas que ya están comprometidas en otro pedido vigente.
 *
 * Un pedido deja de retener prendas cuando se anula o cuando su período
 * termina. Es casi `isPastOrder()` del frontend, con una diferencia buscada:
 * allí un pedido cuyo período acabó pero sigue sin cobrar (efectivo pendiente)
 * TODAVÍA retiene la prenda. Aquí no. La prenda ya volvió físicamente al local,
 * y bloquear el catálogo porque falta confirmar un cobro castiga al siguiente
 * cliente por una gestión de mostrador.
 * @param {object} tx Cliente Prisma (o transacción).
 * @param {number[]} ids Prendas a comprobar.
 * @returns {Promise<Set<number>>} Ids no disponibles.
 */
async function heldProductIds(tx, ids) {
  const ocupadas = await tx.orderItem.findMany({
    where: {
      productId: { in: ids },
      order: { cancelledAt: null, end: { gte: todayISO() } },
    },
    select: { productId: true },
  });
  return new Set(ocupadas.map((o) => o.productId));
}

/**
 * Registra las rutas de pedidos.
 * @param {import("fastify").FastifyInstance} app Instancia Fastify.
 * @param {object} guards preHandlers de autenticación.
 * @param {Function} guards.requireUser Exige usuario autenticado.
 * @param {Function} guards.requireAdmin Exige usuario administrador.
 */
export function registerOrderRoutes(app, { requireUser, requireAdmin }) {
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
    const datos = parseOrderBody(req.body);

    const creado = await prisma.$transaction(async (tx) => {
      // Las prendas se leen de la BASE, no del cuerpo: el precio sale de
      // `value`, y aceptar el `value` del cliente sería regalarle la tarifa.
      const prendas = await tx.product.findMany({ where: { id: { in: datos.items } } });
      if (prendas.length !== datos.items.length) {
        throw httpError(400, "Alguna de las prendas no existe en el catálogo.");
      }

      // La comprobación va DENTRO de la transacción porque dos checkouts
      // simultáneos sobre la misma prenda es una carrera real: mirar antes y
      // escribir después deja una ventana en la que ambos la ven libre.
      const ocupadas = await heldProductIds(tx, datos.items);
      if (ocupadas.size > 0) {
        throw httpError(409, "Alguna de las prendas ya está alquilada.");
      }

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
          items: { create: datos.items.map((productId) => ({ productId })) },
          charges: { create: initialCharges({ ...datos, items: prendas }) },
        },
        include: CON_LINEAS,
      });
      return order;
    });

    return reply.code(201).send(orderToApi(creado));
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

    const ajuste = returnChangeAdjustment(order.ret, ret, order.pay);
    const actualizado = await prisma.order.update({
      where: { id },
      data: {
        ret,
        retAddr: ret === RETURN_TO.HOME ? (req.body.retAddr ?? order.retAddr) : null,
        ...(ajuste ? { charges: { create: ajuste } } : {}),
      },
      include: CON_LINEAS,
    });
    return orderToApi(actualizado);
  });

  // Solo admin: confirmar que el efectivo entró. El cliente nunca puede darse
  // por cobrado a sí mismo, que es la frontera entera de este endpoint.
  app.post("/api/orders/:id/settle", { preHandler: requireAdmin }, async (req) => {
    const id = Number(req.params.id);
    const order = await findOrderFor(id, req.user, true);
    if (order.cancelledAt) throw httpError(409, "El pedido está anulado.");

    const pendientes = order.charges.filter((c) => c.status === CHARGE_STATUS.PENDING);
    if (pendientes.length === 0) throw httpError(409, "El pedido no tiene cobros pendientes.");

    // Cambia el ESTADO de las líneas, no su importe: la línea sigue diciendo lo
    // mismo, lo que cambia es que ese dinero ya entró.
    await prisma.charge.updateMany({
      where: { orderId: id, status: CHARGE_STATUS.PENDING },
      data: { status: CHARGE_STATUS.SETTLED },
    });
    return orderToApi(await findOrderFor(id, req.user, true));
  });

  // Solo admin: liberar el depósito al recibir la prenda en buen estado.
  app.post("/api/orders/:id/deposit-release", { preHandler: requireAdmin }, async (req) => {
    const id = Number(req.params.id);
    const order = await findOrderFor(id, req.user, true);
    if (order.cancelledAt) throw httpError(409, "El pedido está anulado.");

    const linea = depositReleaseCharge(order.charges, req.body?.note);
    if (!linea) throw httpError(409, "El pedido no tiene depósito retenido.");

    await prisma.charge.create({ data: { ...linea, orderId: id } });
    return orderToApi(await findOrderFor(id, req.user, true));
  });

  // Solo admin: cobrar la penalización por devolución fuera de plazo. Existía
  // en la interfaz desde el principio y no se cobraba en ninguna parte.
  app.post("/api/orders/:id/late-penalty", { preHandler: requireAdmin }, async (req) => {
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

    await prisma.charge.create({ data: { ...linea, orderId: id } });
    return orderToApi(await findOrderFor(id, req.user, true));
  });

  // Anular: revierte los cargos con líneas espejo y marca la fecha.
  app.post("/api/orders/:id/cancel", { preHandler: requireUser }, async (req) => {
    const id = Number(req.params.id);
    const admin = isAdmin(req.user.googleSub);
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
    const anulado = await prisma.order.update({
      where: { id },
      data: {
        cancelledAt: new Date(),
        ...(reversos.length ? { charges: { create: reversos } } : {}),
      },
      include: CON_LINEAS,
    });
    return orderToApi(anulado);
  });
}
