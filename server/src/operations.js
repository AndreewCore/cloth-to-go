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
import { CAPABILITY, httpError } from "./auth.js";
import { ITEM_STATUS, pricedItem, routeId } from "./catalog.js";
import { CHARGE_TYPE, settlementFor } from "./ledger.js";
import { cents, rentalDays, rentalPrice } from "./pricing.js";
import { addDaysISO, isBusinessDay, todayISO } from "./dates.js";
import { holidaySet } from "./calendar.js";
import { manualTargets, planTransition } from "./items.js";
import { FINANCE_EVENT, logFinance, logItem } from "./logs.js";
import { CON_LINEAS, orderToApi } from "./orders.js";
import { panelPhotoUrl } from "./catalogAdmin.js";
import { requestOrigin } from "./storage.js";

const S = ITEM_STATUS;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DIA_MS = 86_400_000;

/** Umbrales de rezagadas del §3, en días. */
export const STRAGGLER_DAYS = Object.freeze({ RECEIVED_NOT_WASHED: 1, IN_LAUNDRY: 2 });

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

/** Días enteros transcurridos desde un instante hasta ahora. */
const diasDesde = (fecha, now = Date.now()) => Math.floor((now - new Date(fecha).getTime()) / DIA_MS);

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
 * @param {{storage: object}} deps Almacenamiento, para las URLs de las fotos.
 */
export function registerOperationRoutes(app, { requireUser, requireCapability }, { storage }) {
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
  // también los cerrados, los más recientes primero.
  app.get("/api/admin/orders", { preHandler: mostradorOCaja }, async (req) => {
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

  // Rezagadas (§3): lo que el sistema esperaba ver moverse y nadie movió. Son
  // alertas para el local, nunca cargos para el cliente (§6.3).
  app.get("/api/admin/stragglers", { preHandler: mostrador }, async (req) => {
    const hoy = todayISO();
    const foto = fotosPara(req);
    const vivas = await prisma.orderItem.findMany({
      where: { releasedAt: null, order: { cancelledAt: null } },
      include: { item: { include: { product: { select: FICHA_PRODUCTO } } }, order: { select: { id: true, user: { select: { name: true } } } } },
    });
    const ficha = (oi, extra) => ({
      orderId: oi.orderId,
      customer: oi.order.user.name,
      itemId: oi.itemId,
      code: oi.item.code,
      productName: oi.item.product.name,
      imgs: oi.item.product.imgs.map(foto),
      status: oi.item.status,
      ...extra,
    });

    // Vencido y sin recepción: al instante, en cuanto pasa la fecha límite.
    const sinRecibir = vivas
      .filter((oi) => !oi.receivedAt && isoDe(oi.end) < hoy && [S.RESERVADA, S.EN_ALQUILER].includes(oi.item.status))
      .map((oi) => ficha(oi, { returnBy: isoDe(oi.end), daysLate: rentalDays(isoDe(oi.end), hoy) }));

    // Recibida y sigue En Alquiler: nadie la llevó a lavado.
    const sinLavar = vivas
      .filter((oi) => oi.receivedAt && oi.item.status === S.EN_ALQUILER
        && diasDesde(oi.receivedAt) >= STRAGGLER_DAYS.RECEIVED_NOT_WASHED)
      .map((oi) => ficha(oi, { receivedAt: oi.receivedAt }));

    const lavado = await prisma.item.findMany({
      where: { status: S.EN_LAVADO, statusSince: { lte: new Date(Date.now() - STRAGGLER_DAYS.IN_LAUNDRY * DIA_MS) } },
      include: { product: { select: FICHA_PRODUCTO } },
      orderBy: { statusSince: "asc" },
    });
    const enLavado = lavado.map((it) => ({
      itemId: it.id,
      code: it.code,
      productName: it.product.name,
      imgs: it.product.imgs.map(foto),
      since: it.statusSince,
      laundryKind: it.laundryKind,
      laundryPlace: it.laundryPlace,
    }));

    return { notReceived: sinRecibir, receivedNotWashed: sinLavar, inLaundry: enLavado };
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
      // Solo vuelve lo que se entregó: una prenda Reservada nunca salió del
      // local, y recibirla escondería que nadie registró la entrega.
      const noEntregada = datos.items.map((x) => pendientes.get(x.itemId)).find((oi) => oi.item.status !== S.EN_ALQUILER);
      if (noEntregada) {
        throw httpError(409, `La prenda ${noEntregada.item.code ?? `#${noEntregada.itemId}`} no consta como entregada; márcala En Alquiler primero.`);
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
      return resumen;
    });

    const actualizado = await prisma.order.findUnique({ where: { id }, include: PARA_PANEL });
    return { ...orderForPanel(actualizado, fotosPara(req)), receipt };
  });
}

