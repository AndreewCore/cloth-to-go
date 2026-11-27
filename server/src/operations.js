/**
 * Operación del local (fase 4, pestaña «Operación» del panel): las listas que
 * mira el mostrador y el acto de recibir una prenda devuelta.
 *
 * Recibir es donde se cobran los días extra (§6.0): pasarse de la ventana no
 * es multa, es seguir subiendo la escalera de precios. Y se cobra aquí, en el
 * acto de recepción, porque es cuando alguien tiene la prenda delante (§6.3):
 * el tiempo, por sí solo, nunca le cobra nada al cliente.
 */
import prisma from "./db.js";
import { CAPABILITY, hasCapability, httpError } from "./auth.js";
import { ITEM_STATUS, assertRentable, pricedItem, rentableFrom, routeId } from "./catalog.js";
import { CHARGE_TYPE, settlementFor } from "./ledger.js";
import { cents, rentalDays, rentalPrice } from "./pricing.js";
import { addDaysISO, fmtDayEs, isBusinessDay, nextBusinessDay, returnByDate, todayISO } from "./dates.js";
import { holidaySet } from "./calendar.js";
import { manualTargets, planTransition } from "./items.js";
import { ACTIVITY, FINANCE_EVENT, logActivity, logFinance, logItem } from "./logs.js";
import { CON_LINEAS, isOverlapViolation, orderToApi, settlePending } from "./orders.js";
import { panelPhotoUrl } from "./catalogAdmin.js";
import { requestOrigin } from "./storage.js";
import { parseFilters, readActivity } from "./activity.js";
import { createNotice, deliverNotice, deliveredText, rescheduledText, returnedText } from "./notices.js";
import { disabledMailer } from "./mail.js";

const S = ITEM_STATUS;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DIA_MS = 86_400_000;

/** Días de pedidos terminados que trae cada tanda del historial. */
export const HISTORY_DAYS = 30;
/** Tope de días hacia atrás del historial: más viejo, en la Bitácora. */
const HISTORY_MAX_DAYS = 365;

/**
 * Indica si un pedido del panel ya terminó: anulado, o con todo recibido, nada
 * por cobrar y sin garantía retenida. Es lo contrario de «en curso».
 * @param {object} o Pedido de `orderForPanel()`.
 * @returns {boolean}
 */
export function isFinished(o) {
  if (o.cancelledAt) return true;
  return o.status !== "pending" && o.depositHeldCents === 0 && o.lines.every((l) => l.receivedAt);
}

/**
 * Cuándo terminó un pedido: la anulación, o lo último que le pasó (la última
 * prenda recibida o el último movimiento de dinero, que suele ser la garantía).
 * @param {object} o Pedido de `orderForPanel()`.
 * @returns {Date}
 */
export function finishedAt(o) {
  if (o.cancelledAt) return new Date(o.cancelledAt);
  const marcas = [o.createdAt, ...o.lines.map((l) => l.receivedAt), ...o.charges.map((c) => c.createdAt)]
    .filter(Boolean).map((d) => new Date(d).getTime());
  return new Date(Math.max(...marcas));
}

/** Umbral de «Recibidas sin lavar» (§3), en días. Lo que lleva tiempo en lavado lo dice `rentableFrom()`: lista para salir. */
export const STRAGGLER_DAYS = Object.freeze({ RECEIVED_NOT_WASHED: 1 });

/**
 * Días extra de una devolución tardía: los días HÁBILES después de la fecha
 * límite hasta el día real de devolución, inclusive.
 *
 * Solo cuentan los hábiles porque el local no recibe en fin de semana ni
 * feriado: quien tenía hasta el viernes y devuelve el lunes se pasó un día, no
 * tres, ya que el sábado y el domingo no tenía dónde devolverla.
 * @param {string} returnBy Fecha límite sin costo (`YYYY-MM-DD`).
 * @param {string} returnedOn Día real de devolución (`YYYY-MM-DD`).
 * @param {Set<string>} [holidays] Feriados.
 * @returns {number} 0 si volvió a tiempo.
 */
export function lateDays(returnBy, returnedOn, holidays = new Set()) {
  let n = 0;
  // Tope de un año: una fecha corrupta no puede colgar la petición.
  for (let d = addDaysISO(returnBy, 1), i = 0; d <= returnedOn && i < 366; d = addDaysISO(d, 1), i++) {
    if (isBusinessDay(d, holidays)) n++;
  }
  return n;
}

/**
 * Línea RENTAL por los días extra de una prenda. Continúa la escalera del
 * pedido (§7): se cobra `precio(días + extra) − precio(días)`, así devolver
 * tarde cuesta lo mismo que haber alquilado esos días desde el principio.
 * @param {object} p Prenda con datos de precio (`pricedItem()`).
 * @param {object} ctx Pedido.
 * @param {number} ctx.days Días que ya pagó.
 * @param {number} ctx.extra Días extra.
 * @param {number} ctx.itemCount Prendas del pedido (descuento por volumen).
 * @param {string} ctx.pay Método de pago del pedido.
 * @param {string} ctx.returnBy Fecha límite, para la nota.
 * @returns {object|null} Línea sin `orderId`, o null si no hay nada que cobrar.
 */
export function lateCharge(p, { days, extra, itemCount, pay, returnBy }) {
  if (extra <= 0) return null;
  const amountCents = cents(rentalPrice(p, days + extra, itemCount)) - cents(rentalPrice(p, days, itemCount));
  if (amountCents <= 0) return null;
  return {
    type: CHARGE_TYPE.RENTAL,
    amountCents,
    ...settlementFor(pay),
    itemId: p.itemId,
    note: `Días extra de ${p.name} · ${extra} día(s) hábil(es) después del ${returnBy}`,
  };
}

/** Día `YYYY-MM-DD` de una columna `@db.Date`. */
const isoDe = (d) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * Pedido para el panel: lo que ve el cliente más quién es y, por prenda, su
 * código, estado interno y recepción. Nada de esto sale nunca hacia un cliente.
 * @param {object} order Pedido con `user`, `charges` e `items.item.product`.
 * @param {(img: string) => string} photo URL de una foto para el panel.
 * @returns {object}
 */
function orderForPanel(order, photo) {
  const base = orderToApi(order);
  return {
    ...base,
    customer: { name: order.user.name, email: order.user.email },
    lines: order.items.map((oi) => ({
      itemId: oi.itemId,
      code: oi.item.code,
      productName: oi.item.product.name,
      imgs: oi.item.product.imgs.map(photo),
      size: oi.item.size,
      color: oi.item.color,
      status: oi.item.status,
      returnedOn: isoDe(oi.returnedOn),
      receivedAt: oi.receivedAt,
      deliveredOn: isoDe(oi.deliveredOn),
      deliveredAt: oi.deliveredAt,
    })),
  };
}

/**
 * Lo que el panel necesita del modelo: nombre y fotos. Las fotos son lo que
 * permite al mostrador saber qué prenda tiene delante sin fiarse del código.
 */
const FICHA_PRODUCTO = { name: true, imgs: true };

/** Relaciones que necesita `orderForPanel`. */
const PARA_PANEL = {
  ...CON_LINEAS,
  user: { select: { name: true, email: true } },
  items: {
    include: { item: { include: { product: { select: FICHA_PRODUCTO } } } },
    orderBy: { id: "asc" },
  },
};

/**
 * Valida el cuerpo de una entrega.
 * @param {object} body Cuerpo de la petición.
 * @param {string} today Hoy (`YYYY-MM-DD`).
 * @returns {{deliveredOn: string, itemIds: number[]|null, settle: boolean, note: string|null}}
 */
function parseDelivery(body, today) {
  const b = body ?? {};
  if (typeof b.deliveredOn !== "string" || !ISO_DATE.test(b.deliveredOn) || Number.isNaN(Date.parse(b.deliveredOn))) {
    throw httpError(400, "Indica el día en que la prenda salió (AAAA-MM-DD).");
  }
  // Como al recibir: una fecha futura es un error de tecleo, no una entrega.
  if (b.deliveredOn > today) throw httpError(400, "La fecha de entrega no puede ser futura.");
  let itemIds = null;
  if (b.items != null) {
    if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > 50
      || !b.items.every((n) => Number.isInteger(n) && n > 0)) {
      throw httpError(400, "Lista de prendas no válida.");
    }
    itemIds = [...new Set(b.items)];
  }
  const note = typeof b.note === "string" && b.note.trim() ? b.note.trim().slice(0, 500) : null;
  return { deliveredOn: b.deliveredOn, itemIds, settle: b.settle === true, note };
}

/** Adónde puede ir una prenda al recibirla: nunca directo al catálogo (§3). */
export const RECEIVE_TARGETS = Object.freeze([S.EN_LAVADO, S.NO_ALQUILABLE]);

/**
 * Valida el cuerpo de una recepción.
 *
 * Cada prenda dice adónde va: a lavado (con quién lava y dónde está) o a
 * desperfecto (con observación). Así la recepción y el lavado son un solo
 * registro, y una prenda devuelta no puede volver a ofrecerse sin lavar.
 * @param {object} body Cuerpo de la petición.
 * @param {string} today Hoy (`YYYY-MM-DD`).
 * @returns {{returnedOn: string, items: object[], note: string|null}}
 */
function parseReceipt(body, today) {
  const b = body ?? {};
  if (typeof b.returnedOn !== "string" || !ISO_DATE.test(b.returnedOn) || Number.isNaN(Date.parse(b.returnedOn))) {
    throw httpError(400, "Indica el día en que la prenda volvió (AAAA-MM-DD).");
  }
  // Una fecha futura no es «cuándo volvió»: es un error de tecleo que cobraría
  // días que todavía no pasaron.
  if (b.returnedOn > today) throw httpError(400, "La fecha de devolución no puede ser futura.");
  if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > 50) {
    throw httpError(400, "Indica qué prendas volvieron y adónde va cada una.");
  }
  const vistos = new Set();
  const items = b.items.map((x) => {
    if (!Number.isInteger(x?.itemId) || x.itemId <= 0 || vistos.has(x.itemId)) throw httpError(400, "Lista de prendas no válida.");
    if (!RECEIVE_TARGETS.includes(x.to)) throw httpError(400, "Cada prenda va a lavado o a desperfecto.");
    vistos.add(x.itemId);
    return { itemId: x.itemId, to: x.to, laundry: x.laundry, reason: x.reason ?? "DESPERFECTO", note: x.note };
  });
  const note = typeof b.note === "string" && b.note.trim() ? b.note.trim().slice(0, 500) : null;
  return { returnedOn: b.returnedOn, items, note };
}

/**
 * Registra las rutas de operación del panel.
 * @param {import("fastify").FastifyInstance} app Instancia Fastify.
 * @param {{requireUser: Function, requireCapability: Function}} guards preHandlers.
 * @param {{storage: object, mailer?: object}} deps Almacenamiento (URLs de las
 *   fotos) y correo de los avisos al cliente.
 */
export function registerOperationRoutes(app, { requireUser, requireCapability }, { storage, mailer = disabledMailer }) {
  /** URLs de fotos para el panel, vistas desde el origen de la petición. */
  const fotosPara = (req) => (img) => panelPhotoUrl(storage, img, requestOrigin(req));

  const mostradorOCaja = requireCapability(CAPABILITY.MOSTRADOR, CAPABILITY.CAJA);
  const mostrador = requireCapability(CAPABILITY.MOSTRADOR);

  // Quién soy y qué puedo hacer: el panel decide qué pestañas enseñar. La
  // comprobación real sigue en cada ruta; esto es solo para no mostrar botones
  // que darían 403.
  app.get("/api/me", { preHandler: requireUser }, async (req) => ({
    sub: req.user.googleSub,
    name: req.user.name,
    email: req.user.email,
    picture: req.user.picture,
    capabilities: req.user.capabilities ?? [],
  }));

  // Pedidos en curso: no anulados y con algo pendiente (una prenda sin
  // recibir, dinero sin confirmar o garantía retenida). `?scope=all` trae
  // también los cerrados, los más recientes primero. `?scope=history&days=N`
  // trae los TERMINADOS en los últimos N días, del último en terminar al
  // primero, y dice si hay más atrás.
  app.get("/api/admin/orders", { preHandler: mostradorOCaja }, async (req) => {
    if (req.query?.scope === "history") {
      const dias = Math.min(Math.max(Number(req.query.days) || HISTORY_DAYS, 1), HISTORY_MAX_DAYS);
      const corte = new Date(Date.now() - dias * DIA_MS);
      // Candidatos: lo que se anuló, se recibió o se movió dentro de la
      // ventana. Un alquiler largo que terminó ayer se creó hace semanas.
      const pedidos = await prisma.order.findMany({
        where: {
          OR: [
            { createdAt: { gte: corte } },
            { cancelledAt: { gte: corte } },
            { items: { some: { receivedAt: { gte: corte } } } },
            { charges: { some: { createdAt: { gte: corte } } } },
          ],
        },
        include: PARA_PANEL,
      });
      const terminados = pedidos.map((o) => orderForPanel(o, fotosPara(req)))
        .filter(isFinished)
        .map((o) => ({ ...o, finishedAt: finishedAt(o) }))
        .filter((o) => o.finishedAt >= corte)
        .sort((a, b) => b.finishedAt - a.finishedAt || b.id - a.id);
      const masViejos = dias < HISTORY_MAX_DAYS
        && (await prisma.order.count({ where: { createdAt: { lt: corte } } })) > 0;
      return { days: dias, orders: terminados, hasMore: masViejos };
    }
    const todos = req.query?.scope === "all";
    const pedidos = await prisma.order.findMany({
      where: todos ? {} : { cancelledAt: null },
      include: PARA_PANEL,
      orderBy: { id: "desc" },
      take: todos ? 200 : undefined,
    });
    const vista = pedidos.map((o) => orderForPanel(o, fotosPara(req)));
    if (todos) return vista;
    return vista.filter((o) => o.status === "pending" || o.depositHeldCents > 0 || o.lines.some((l) => !l.receivedAt));
  });

  // Ejemplares con su estado interno y a qué estados se pueden mover a mano.
  app.get(
    "/api/admin/items",
    { preHandler: requireCapability(CAPABILITY.MOSTRADOR, CAPABILITY.INVENTARIO) },
    async (req) => {
      const foto = fotosPara(req);
      const items = await prisma.item.findMany({
        include: { product: { select: FICHA_PRODUCTO } },
        orderBy: { id: "asc" },
      });
      return items.map((it) => ({
        id: it.id,
        code: it.code,
        productId: it.productId,
        productName: it.product.name,
        imgs: it.product.imgs.map(foto),
        size: it.size,
        color: it.color,
        status: it.status,
        statusSince: it.statusSince,
        unrentableReason: it.unrentableReason,
        laundryKind: it.laundryKind,
        laundryPlace: it.laundryPlace,
        next: manualTargets(it.status),
      }));
    },
  );

  // «Hoy» (pestaña del panel): todo lo que el local tiene que hacer o
  // registrar, por urgencia. Absorbe las rezagadas del §3: lo vencido sin
  // registrar va primero. Son alertas para el local, nunca cargos para el
  // cliente (§6.3).
  app.get("/api/admin/today", { preHandler: mostradorOCaja }, async (req) => {
    const hoy = todayISO();
    const foto = fotosPara(req);
    const feriados = await holidaySet();
    const pedidos = await prisma.order.findMany({ where: { cancelledAt: null }, include: PARA_PANEL, orderBy: { id: "asc" } });
    const vivos = pedidos.map((o) => orderForPanel(o, foto))
      .filter((o) => o.status === "pending" || o.depositHeldCents > 0 || o.lines.some((l) => !l.receivedAt));
    const porEntregar = (o) => o.lines.some((l) => !l.deliveredAt);
    const fuera = (o) => o.lines.some((l) => l.deliveredAt && !l.receivedAt);

    const lavado = await prisma.item.findMany({
      where: { status: S.EN_LAVADO },
      include: { product: { select: FICHA_PRODUCTO } },
      orderBy: { statusSince: "asc" },
    });
    const listas = lavado
      .filter((it) => !rentableFrom(it, feriados).from)
      .map((it) => ({
        itemId: it.id,
        code: it.code,
        productName: it.product.name,
        imgs: it.product.imgs.map(foto),
        since: it.statusSince,
        laundryKind: it.laundryKind,
        laundryPlace: it.laundryPlace,
      }));

    // Recibidas antes de que recibir llevara a lavado, y que nadie llevó.
    const sinLavar = await prisma.orderItem.findMany({
      where: {
        releasedAt: null,
        receivedAt: { lte: new Date(Date.now() - STRAGGLER_DAYS.RECEIVED_NOT_WASHED * DIA_MS) },
        item: { status: S.EN_ALQUILER },
        order: { cancelledAt: null },
      },
      include: { item: { include: { product: { select: FICHA_PRODUCTO } } } },
    });

    const secciones = {
      pickupsOverdue: vivos.filter((o) => o.start < hoy && porEntregar(o)),
      returnsOverdue: vivos.filter((o) => o.returnBy < hoy && fuera(o)),
      pickupsToday: vivos.filter((o) => o.start === hoy && porEntregar(o)),
      returnsToday: vivos.filter((o) => (o.returnBy === hoy || o.end === hoy) && fuera(o)),
      toClose: vivos.filter((o) => o.lines.every((l) => l.receivedAt) && (o.status === "pending" || o.depositHeldCents > 0)),
      laundryReady: listas,
      receivedNotWashed: sinLavar.map((oi) => ({
        orderId: oi.orderId, itemId: oi.itemId, code: oi.item.code, productName: oi.item.product.name,
        imgs: oi.item.product.imgs.map(foto), receivedAt: oi.receivedAt,
      })),
    };
    return {
      today: hoy,
      ...secciones,
      // Lo vencido sin registrar: el número rojo de la pestaña.
      urgent: secciones.pickupsOverdue.length + secciones.returnsOverdue.length + secciones.receivedNotWashed.length,
    };
  });

  // Mover el retiro de un cliente que no vino: se corre todo el alquiler los
  // mismos días, así que el precio no cambia (no se toca ninguna línea). Si la
  // devolución nueva cae en un día cerrado se pasa al siguiente hábil, a
  // favor del cliente.
  app.post("/api/orders/:id/reschedule", { preHandler: mostrador }, async (req) => {
    const id = routeId(req.params.id, "Pedido");
    const start = req.body?.start;
    if (typeof start !== "string" || !ISO_DATE.test(start) || Number.isNaN(Date.parse(start))) {
      throw httpError(400, "Indica el día nuevo de retiro (AAAA-MM-DD).");
    }
    if (start < todayISO()) throw httpError(400, "El retiro nuevo no puede ser en el pasado.");
    const feriados = await holidaySet();
    if (!isBusinessDay(start, feriados)) throw httpError(400, "Ese día el local no entrega: elige un día hábil.");

    let movido;
    try {
      movido = await prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id },
          include: { items: { include: { item: { include: { product: { select: { name: true } } } } } } },
        });
        if (!order) throw httpError(404, "Pedido no encontrado.");
        if (order.cancelledAt) throw httpError(409, "El pedido está anulado.");
        if (order.items.some((oi) => oi.deliveredAt)) throw httpError(409, "Ya se entregó: el retiro no se mueve.");
        if (start === order.start) throw httpError(400, "Es el mismo día de retiro.");

        const largo = Math.round((Date.parse(order.end) - Date.parse(order.start)) / DIA_MS);
        const end = nextBusinessDay(addDaysISO(start, largo), feriados);
        const returnBy = returnByDate(start, end, feriados);
        assertRentable(order.items.map((oi) => oi.item), start, feriados);
        const choca = await tx.orderItem.count({
          where: {
            itemId: { in: order.items.map((oi) => oi.itemId) },
            orderId: { not: id },
            releasedAt: null,
            start: { lte: new Date(`${returnBy}T00:00:00Z`) },
            end: { gte: new Date(`${start}T00:00:00Z`) },
          },
        });
        if (choca) throw httpError(409, "Alguna prenda ya está reservada por otro pedido en esas fechas.");

        await tx.order.update({ where: { id }, data: { start, end } });
        await tx.orderItem.updateMany({
          where: { orderId: id },
          data: { start: new Date(`${start}T00:00:00Z`), end: new Date(`${returnBy}T00:00:00Z`) },
        });
        await logActivity(tx, {
          action: ACTIVITY.RETIRO_MOVIDO,
          actorId: req.user.id,
          orderId: id,
          note: `Pedido #${id}: retiro del ${order.start} al ${start}; devuelve hasta el ${returnBy}`,
          detail: { from: { start: order.start, end: order.end }, to: { start, end, returnBy } },
        });
        const notice = await createNotice(tx, {
          userId: order.userId, kind: "RETIRO_MOVIDO", orderId: id, ...rescheduledText(id, fmtDayEs(start), fmtDayEs(returnBy)),
        });
        return { notice, reschedule: { from: order.start, start, end, returnBy } };
      });
    } catch (err) {
      // La base es la última palabra sobre el solape, por si dos lo mueven a la vez.
      if (isOverlapViolation(err)) throw httpError(409, "Alguna prenda ya está reservada por otro pedido en esas fechas.");
      throw err;
    }
    await deliverNotice(movido.notice, mailer, req.log);
    const actualizado = await prisma.order.findUnique({ where: { id }, include: PARA_PANEL });
    return { ...orderForPanel(actualizado, fotosPara(req)), reschedule: movido.reschedule };
  });

  // Entregar: el mostrador registra que las prendas salieron, con el día real
  // (puede ser anterior al registro, como al recibir) y quién. Es lo que pasa
  // la prenda a En Alquiler y lo que hace que el pedido cuente como entregado:
  // desde aquí el cliente ya no anula y gana sus puntos y litros. Si quien
  // entrega es también Caja, puede confirmar en el mismo acto el cobro en
  // efectivo.
  app.post("/api/orders/:id/deliver", { preHandler: mostrador }, async (req) => {
    const id = routeId(req.params.id, "Pedido");
    const datos = parseDelivery(req.body, todayISO());
    if (datos.settle && !hasCapability(req.user, CAPABILITY.CAJA)) {
      throw httpError(403, "Confirmar el cobro es de Caja.");
    }
    const feriados = await holidaySet();
    if (!isBusinessDay(datos.deliveredOn, feriados)) {
      throw httpError(400, "Ese día el local no entrega: elige el día hábil en que salió la prenda.");
    }

    const resultado = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        include: { charges: true, items: { include: { item: { include: { product: { select: { name: true } } } } } } },
      });
      if (!order) throw httpError(404, "Pedido no encontrado.");
      if (order.cancelledAt) throw httpError(409, "El pedido está anulado.");
      if (datos.deliveredOn < order.start) {
        throw httpError(400, `El retiro es desde el ${fmtDayEs(order.start)}: la prenda no pudo salir antes.`);
      }
      const pendientes = order.items.filter((oi) => !oi.deliveredAt);
      if (pendientes.length === 0) throw httpError(409, "Todas las prendas de este pedido ya se entregaron.");
      const elegidas = datos.itemIds ? pendientes.filter((oi) => datos.itemIds.includes(oi.itemId)) : pendientes;
      if (datos.itemIds && elegidas.length !== datos.itemIds.length) {
        throw httpError(409, "Alguna de esas prendas no es de este pedido o ya se entregó.");
      }
      // Solo sale lo que está apartado para este pedido: una prenda En Lavado
      // o todavía con el cliente anterior no puede estar en el mostrador.
      const noLista = elegidas.find((oi) => oi.item.status !== S.RESERVADA);
      if (noLista) {
        throw httpError(409, `${noLista.item.product.name} (${noLista.item.code ?? `#${noLista.itemId}`}) no está Reservada; revisa su estado antes de entregarla.`);
      }

      const ahora = new Date();
      for (const oi of elegidas) {
        const { count } = await tx.orderItem.updateMany({
          where: { id: oi.id, deliveredAt: null },
          data: { deliveredOn: new Date(`${datos.deliveredOn}T00:00:00Z`), deliveredAt: ahora, deliveredById: req.user.id },
        });
        if (count === 0) throw httpError(409, "Otra persona registró esta entrega mientras tanto; vuelve a cargar.");
        const movida = await tx.item.updateMany({
          where: { id: oi.itemId, status: S.RESERVADA },
          data: { status: S.EN_ALQUILER, statusSince: ahora },
        });
        if (movida.count === 0) throw httpError(409, "La prenda cambió de estado mientras tanto; vuelve a cargar.");
        // La nota empieza por «Entregada»: así la bitácora general distingue la
        // entrega de un cambio manual de estado.
        await logItem(tx, {
          itemId: oi.itemId,
          from: S.RESERVADA,
          to: S.EN_ALQUILER,
          actorId: req.user.id,
          orderId: id,
          note: [`Entregada; salió el ${datos.deliveredOn}`, datos.note].filter(Boolean).join(" · "),
        });
      }
      const settledCents = datos.settle ? await settlePending(tx, order, req.user.id) : 0;
      const returnBy = isoDe(order.items[0].end);
      const nombres = elegidas.map((oi) => oi.item.product.name);
      const notice = await createNotice(tx, {
        userId: order.userId, kind: "ENTREGA", orderId: id, ...deliveredText(id, nombres, fmtDayEs(returnBy)),
      });
      return {
        notice,
        delivery: {
          deliveredOn: datos.deliveredOn,
          returnBy,
          settledCents,
          items: elegidas.map((oi) => ({ itemId: oi.itemId, code: oi.item.code, productName: oi.item.product.name })),
        },
      };
    });

    await deliverNotice(resultado.notice, mailer, req.log);
    const actualizado = await prisma.order.findUnique({ where: { id }, include: PARA_PANEL });
    return { ...orderForPanel(actualizado, fotosPara(req)), delivery: resultado.delivery };
  });

  // Recorrido de un pedido: lo que lleva su número (reserva, entrega con
  // fotos, recepción, días extra, cobro, garantía, anulación) y lo que les pasó
  // a sus prendas hasta que otro pedido las tomó (lavado, vuelta a Disponible).
  app.get("/api/orders/:id/timeline", { preHandler: mostradorOCaja }, async (req) => {
    const id = routeId(req.params.id, "Pedido");
    const order = await prisma.order.findUnique({
      where: { id },
      include: { user: { select: { name: true, email: true } }, items: { select: { itemId: true } } },
    });
    if (!order) throw httpError(404, "Pedido no encontrado.");
    const itemIds = order.items.map((x) => x.itemId);
    const siguientes = await prisma.orderItem.findMany({
      where: { itemId: { in: itemIds }, orderId: { not: id }, order: { createdAt: { gt: order.createdAt } } },
      select: { itemId: true, order: { select: { createdAt: true } } },
    });
    const hasta = new Map();
    for (const x of siguientes) {
      const prev = hasta.get(x.itemId);
      if (!prev || x.order.createdAt < prev) hasta.set(x.itemId, x.order.createdAt);
    }
    const f = parseFilters({ limit: "200" });
    f.order = { orderId: id, items: itemIds.map((itemId) => ({ itemId, from: order.createdAt, to: hasta.get(itemId) ?? null })) };
    const origin = requestOrigin(req);
    const { entries } = await readActivity(f, {
      signed: (key) => storage.signedUrl(key, origin),
      catalog: (img) => panelPhotoUrl(storage, img, origin),
    });
    const alta = {
      key: `o:${id}`, at: order.createdAt, action: "PEDIDO", label: "Pedido creado", category: "dinero",
      actor: { name: order.user.name || order.user.email },
      note: `${itemIds.length} prenda${itemIds.length === 1 ? "" : "s"} · del ${order.start} al ${order.end}`,
      product: null, item: null, orderId: id, photos: [],
    };
    return { orderId: id, entries: [alta, ...entries.reverse()] };
  });

  // Recibir prendas devueltas: anota el día real, quién y cuándo lo registró,
  // cobra los días extra si se pasó de la fecha límite y lleva cada prenda a
  // lavado o a desperfecto. Todo en una transacción: una prenda recibida
  // nunca queda «En alquiler» esperando a que alguien se acuerde de lavarla.
  app.post("/api/orders/:id/receive", { preHandler: mostrador }, async (req) => {
    const id = routeId(req.params.id, "Pedido");
    const hoy = todayISO();
    const datos = parseReceipt(req.body, hoy);
    const feriados = await holidaySet();

    const receipt = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        include: { items: { include: { item: { include: { product: { include: { materialRef: true } } } } } } },
      });
      if (!order) throw httpError(404, "Pedido no encontrado.");
      if (order.cancelledAt) throw httpError(409, "El pedido está anulado.");
      if (datos.returnedOn < order.start) {
        throw httpError(400, "La prenda no puede volver antes de que empezara el alquiler.");
      }

      const pendientes = new Map(order.items.filter((oi) => !oi.receivedAt).map((oi) => [oi.itemId, oi]));
      if (pendientes.size === 0) throw httpError(409, "Todas las prendas de este pedido ya se recibieron.");
      if (datos.items.some((x) => !pendientes.has(x.itemId))) {
        throw httpError(409, "Alguna de esas prendas no es de este pedido o ya se recibió.");
      }
      // Solo vuelve lo que se entregó: una prenda sin entrega registrada nunca
      // salió del local, y recibirla escondería que nadie registró la entrega.
      const noEntregada = datos.items.map((x) => pendientes.get(x.itemId))
        .find((oi) => !oi.deliveredAt || oi.item.status !== S.EN_ALQUILER);
      if (noEntregada) {
        throw httpError(409, `La prenda ${noEntregada.item.code ?? `#${noEntregada.itemId}`} no consta como entregada; registra la entrega primero.`);
      }

      const dias = rentalDays(order.start, order.end);
      const resumen = { extraCents: 0, items: [] };
      for (const pedida of datos.items) {
        const oi = pendientes.get(pedida.itemId);
        // El destino se valida con la misma tabla que el cambio manual: lavado
        // exige quién y dónde; desperfecto, una observación.
        const plan = planTransition(oi.item, { ...pedida, note: pedida.note ?? datos.note }, req.user);
        if (plan.error) throw httpError(plan.status, `${oi.item.product.name}: ${plan.error}`);

        // Condición sobre `receivedAt`: dos mostradores que reciben a la vez no
        // pueden cobrar dos veces los mismos días extra. Y la reserva se libera
        // (`releasedAt`): la prenda ya volvió, así que sus días hasta la fecha
        // límite no deben frenar ni la vuelta a Disponible ni un pedido nuevo
        // desde que sale del lavado.
        const ahora = new Date();
        const { count } = await tx.orderItem.updateMany({
          where: { id: oi.id, receivedAt: null },
          data: { returnedOn: new Date(`${datos.returnedOn}T00:00:00Z`), receivedAt: ahora, receivedById: req.user.id, releasedAt: ahora },
        });
        if (count === 0) throw httpError(409, "Otra persona registró esta devolución mientras tanto; vuelve a cargar.");
        const movida = await tx.item.updateMany({ where: { id: oi.itemId, status: S.EN_ALQUILER }, data: plan.data });
        if (movida.count === 0) throw httpError(409, "La prenda cambió de estado mientras tanto; vuelve a cargar.");

        const returnBy = isoDe(oi.end);
        const extra = lateDays(returnBy, datos.returnedOn, feriados);
        const linea = lateCharge(pricedItem(oi.item), {
          days: dias, extra, itemCount: order.items.length, pay: order.pay, returnBy,
        });
        if (linea) {
          await tx.charge.create({ data: { ...linea, orderId: id } });
          await logFinance(tx, {
            kind: FINANCE_EVENT.DIAS_EXTRA,
            actorId: req.user.id,
            orderId: id,
            amountCents: linea.amountCents,
            note: linea.note,
          });
          resumen.extraCents += linea.amountCents;
        }
        // Una sola entrada: la nota empieza por «Recibida», que es como la
        // bitácora general distingue la recepción de un cambio manual.
        await logItem(tx, {
          itemId: oi.itemId,
          from: S.EN_ALQUILER,
          to: plan.data.status,
          actorId: req.user.id,
          orderId: id,
          laundry: plan.laundry,
          note: [`Recibida; volvió el ${datos.returnedOn}`, extra ? `${extra} día(s) extra` : null, plan.note]
            .filter(Boolean).join(" · "),
        });
        resumen.items.push({
          itemId: oi.itemId,
          code: oi.item.code,
          productName: oi.item.product.name,
          to: plan.data.status,
          laundryPlace: plan.data.laundryPlace,
          extraDays: extra,
        });
      }
      const notice = await createNotice(tx, {
        userId: order.userId,
        kind: "DEVOLUCION",
        orderId: id,
        ...returnedText(id, resumen.items.map((x) => x.productName), {
          extraCents: resumen.extraCents, extraDays: Math.max(0, ...resumen.items.map((x) => x.extraDays)),
        }),
      });
      return { ...resumen, notice };
    });
    // Después del commit: el correo nunca deshace el registro.
    await deliverNotice(receipt.notice, mailer, req.log);
    delete receipt.notice;

    const actualizado = await prisma.order.findUnique({ where: { id }, include: PARA_PANEL });
    return { ...orderForPanel(actualizado, fotosPara(req)), receipt };
  });
}

