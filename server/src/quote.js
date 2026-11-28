/**
 * Cotización: el único sitio donde se pone precio a un alquiler (fase 3).
 *
 * Hasta la fase 3 el navegador cotizaba con su propia copia del modelo de
 * precios (js/data.js) y el servidor cobraba con la suya, atadas por una prueba
 * de paridad. Ahora **solo el servidor cotiza**: la API devuelve el precio de
 * cada prenda con el catálogo y `POST /api/quote` cotiza el carrito, y la app y
 * la web solo muestran. `priceOrder()` es la misma función que usa
 * `POST /api/orders` para escribir las líneas: lo que se enseña y lo que se
 * cobra no pueden separarse porque no hay dos cálculos.
 */
import prisma from "./db.js";
import { httpError } from "./auth.js";
import { DELIVERY, RETURN_TO, cents, rentalDays, rentalPrice } from "./pricing.js";
import { discountCharge, initialCharges, revenueCents, CHARGE_TYPE } from "./ledger.js";
import { orderPoints, rewardById, rewardDiscountCents, rewardIssue } from "./rewards.js";
import { assertRentable, pricedItem } from "./catalog.js";
import { returnByDate } from "./dates.js";
import { holidaySet } from "./calendar.js";

/** Días que cubre la escalera del carrito (el calendario del checkout). */
export const CART_LADDER_DAYS = 60;

/** Formato de fecha: día de calendario, sin hora ni zona. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Pone precio a un pedido: líneas del libro de cargos, premio y puntos.
 *
 * La comparten la cotización y la creación del pedido. El premio se valida
 * contra la base (de esa cuenta, sin usar, no revocado); uno que no rebajaría
 * nada no se aplica y se dice por qué.
 * @param {object} db Cliente o transacción Prisma.
 * @param {object} datos `{ items: object[] (ejemplares con product.materialRef),
 *   start, end, delivery, ret, pay, couponId }`.
 * @param {number|null} userId Dueño del cupón; sin cuenta no hay premio.
 * @returns {Promise<object>} `{ priced, lineas, cupon, couponIssue, couponMissing, pointsEarned }`.
 */
export async function priceOrder(db, datos, userId) {
  const priced = datos.items.map(pricedItem);
  const lineas = initialCharges({ ...datos, items: priced });
  const days = rentalDays(datos.start, datos.end);

  let cupon = null;
  let couponIssue = null;
  // El cupón pedido no existe para esta cuenta (o ya se gastó): el pedido lo
  // rechaza con 409; la cotización solo lo explica.
  let couponMissing = false;
  if (datos.couponId != null) {
    cupon = userId == null
      ? null
      : await db.coupon.findFirst({
        where: { id: datos.couponId, userId, usedInOrderId: null, revokedAt: null },
      });
    if (!cupon) {
      couponMissing = true;
      couponIssue = "Ese premio ya no está disponible.";
    } else {
      const rw = rewardById(cupon.rewardId);
      const ctx = { items: priced, days, delivery: datos.delivery, ret: datos.ret };
      const rebaja = rewardDiscountCents(rw, ctx);
      if (rebaja > 0) {
        lineas.push(discountCharge(rebaja, datos.pay, `Premio: ${rw.name}`));
      } else {
        couponIssue = rewardIssue(rw, ctx) ?? "El premio no rebaja nada en este alquiler.";
        cupon = null;
      }
    }
  }

  // Puntos por lo pagado de verdad: sin depósito y sin lo que cubrió el premio.
  const pointsEarned = orderPoints({ spendCents: revenueCents(lineas), days, itemCount: priced.length });
  return { priced, lineas, cupon, couponIssue, couponMissing, pointsEarned };
}

/**
 * Suma las líneas de un tipo.
 * @param {object[]} lineas Líneas del pedido.
 * @param {string} type Tipo de línea.
 * @returns {number} Centavos.
 */
function sumType(lineas, type) {
  return lineas.filter((l) => l.type === type).reduce((s, l) => s + l.amountCents, 0);
}

/**
 * Lee y valida el cuerpo de una cotización. Más laxo que el de un pedido: no
 * pide pago ni direcciones, porque cotizar no compromete nada.
 * @param {object} body Cuerpo de la petición.
 * @returns {object} Datos normalizados.
 */
function parseQuoteBody(body) {
  const { items, start, end, delivery, ret } = body ?? {};
  if (!Array.isArray(items) || items.length === 0) throw httpError(400, "La cotización no lleva ninguna prenda.");
  if (items.length > 50 || !items.every((id) => Number.isInteger(id))) {
    throw httpError(400, "Las prendas se identifican por el id numérico del ejemplar.");
  }
  if (new Set(items).size !== items.length) throw httpError(400, "La cotización repite un ejemplar.");
  if (!ISO_DATE.test(start ?? "") || !ISO_DATE.test(end ?? "") || end < start) {
    throw httpError(400, "Las fechas deben venir como YYYY-MM-DD, y la devolución no antes del inicio.");
  }
  // Modos opcionales: el carrito cotiza antes de que se elijan.
  if (delivery != null && !Object.values(DELIVERY).includes(delivery)) throw httpError(400, "Modo de entrega no válido.");
  if (ret != null && !Object.values(RETURN_TO).includes(ret)) throw httpError(400, "Modo de devolución no válido.");
  const couponId = body.couponId ?? null;
  if (couponId !== null && !Number.isInteger(couponId)) throw httpError(400, "El premio se identifica por su id numérico.");
  return { items, start, end, delivery: delivery ?? DELIVERY.PICKUP, ret: ret ?? RETURN_TO.STORE, couponId };
}

/**
 * Registra `POST /api/quote`. Pública: un invitado también ve cuánto cuesta su
 * carrito. Con sesión, además valora su premio.
 * @param {import("fastify").FastifyInstance} app Instancia Fastify.
 * @param {{optionalUser: Function}} guards preHandlers de autenticación.
 */
export function registerQuoteRoutes(app, { optionalUser }) {
  app.post("/api/quote", { preHandler: optionalUser }, async (req) => {
    const datos = parseQuoteBody(req.body);
    const items = await prisma.item.findMany({
      where: { id: { in: datos.items } },
      include: { product: { include: { materialRef: true } } },
    });
    if (items.length !== datos.items.length) throw httpError(400, "Alguna de las prendas no existe en el catálogo.");
    if (items.some((i) => i.product.pricing !== "CTG")) {
      throw httpError(409, "Alguna de las prendas no está disponible.");
    }
    const feriados = await holidaySet();
    // Lo mismo que comprobará el pedido: mejor enterarse al cotizar que al pagar.
    assertRentable(items, datos.start, feriados);
    const porId = new Map(items.map((i) => [i.id, i]));
    const ordenados = datos.items.map((id) => porId.get(id));

    // Cotizar es comprometer el mismo cálculo que cobrar: se usa `pay: credit`
    // solo para el estado de las líneas, que aquí no se guardan.
    const { priced, lineas, cupon, couponIssue, pointsEarned } = await priceOrder(
      prisma,
      { ...datos, items: ordenados, pay: "credit" },
      req.user?.id ?? null,
    );
    const n = priced.length;
    const days = rentalDays(datos.start, datos.end);
    const rentalCents = sumType(lineas, CHARGE_TYPE.RENTAL);
    const listCents = priced.reduce((s, p) => s + cents(rentalPrice(p, days, 1)), 0);

    return {
      days,
      returnBy: returnByDate(datos.start, datos.end, feriados),
      lines: lineas.map((l) => ({ type: l.type, amountCents: l.amountCents, itemId: l.itemId, note: l.note })),
      rentalCents,
      volumeSavingsCents: listCents - rentalCents,
      shippingCents: sumType(lineas, CHARGE_TYPE.SHIPPING),
      returnCents: sumType(lineas, CHARGE_TYPE.RETURN),
      depositCents: sumType(lineas, CHARGE_TYPE.DEPOSIT_HOLD),
      discountCents: -sumType(lineas, CHARGE_TYPE.DISCOUNT) || 0,
      totalCents: lineas.reduce((s, l) => s + l.amountCents, 0),
      points: pointsEarned,
      couponId: cupon ? cupon.id : null,
      couponIssue: datos.couponId != null ? couponIssue : null,
      // Subtotal del carrito si durase 1, 2, … días: el calendario lo pinta.
      ladderCents: Array.from({ length: CART_LADDER_DAYS }, (_, i) =>
        priced.reduce((s, p) => s + cents(rentalPrice(p, i + 1, n)), 0)),
    };
  });
}
