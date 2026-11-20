/**
 * Programa de puntos: premios, su valor en un alquiler y los puntos que gana
 * un pedido (§2 de PENDIENTE).
 *
 * Hasta la fase 3 todo esto vivía en el navegador (js/data.js y js/state.js) y
 * cualquiera podía escribir `profile.points = 999999` en la consola. Ahora **el
 * cliente propone, el servidor decide**: el checkout manda `couponId`, nunca un
 * importe, y el descuento sale de aquí. Es puro (sin Prisma ni HTTP); las rutas
 * que lo usan están en points.js y orders.js.
 *
 * Invariantes que se conservan de la versión del navegador:
 * 1. El descuento nunca toca el depósito (es reembolsable, no ingreso).
 * 2. Un cupón que descuenta $0 no se consume.
 * 3. Los puntos se acreditan al entregar, no al pagar.
 * 4. Anular un pedido revierte sus puntos y libera el cupón.
 * 5. Un cupón se usa una sola vez (índice único en la base).
 */
import {
  DELIVERY,
  RETURN_TO,
  SHIPPING_FEE,
  cents,
  deliveryFeeFor,
  rentalPrice,
  returnFeeFor,
} from "./pricing.js";

/**
 * Premios canjeables. `cost` en puntos; `type` decide cómo se traduce a dinero
 * en REWARD_GROSS. Los ids son estables: quedan grabados en los cupones.
 */
export const REWARDS = Object.freeze([
  { id: 1, type: "shipping", icon: "truck", cost: 60, name: "Envío o retiro gratis", desc: "Un envío a domicilio o retiro sin costo en tu próximo alquiler." },
  { id: 2, type: "freeDay", icon: "ticket", cost: 100, name: "1 día de alquiler gratis", desc: "Te regalamos un día en el período de tu próximo alquiler." },
  { id: 3, type: "percent", icon: "tag", cost: 150, name: "10% de descuento", desc: "10% de descuento sobre el subtotal de tu próximo alquiler.", rate: 0.1 },
  { id: 4, type: "premiumDays", icon: "crown", cost: 300, name: "Prenda premium 2 días gratis", desc: "Alquila una prenda destacada por 2 días sin costo.", days: 2, minStars: 5 },
]);

/** Premio por id, o undefined. */
export function rewardById(id) {
  return REWARDS.find((r) => r.id === id);
}

/**
 * Metas de agua: litros acumulados por los alquileres cumplidos de una cuenta,
 * y los puntos que paga cada una (una sola vez).
 */
export const WATER_GOALS = Object.freeze([
  { id: 1, liters: 5000, points: 50, name: "Primer ahorro" },
  { id: 2, liters: 20000, points: 150, name: "Ahorro constante" },
  { id: 3, liters: 50000, points: 400, name: "Impacto real" },
  { id: 4, liters: 100000, points: 900, name: "Leyenda circular" },
]);

/**
 * Prenda destacada más cara del alquiler, o null. El premio premium se aplica a
 * la de mayor precio que califica: es la lectura que el cliente espera de
 * "gratis" y la única que no sorprende.
 */
function premiumItem(items, days, minStars) {
  const candidatos = items.filter((p) => p.stars >= minStars);
  if (!candidatos.length) return null;
  return candidatos.reduce((mejor, p) =>
    rentalPrice(p, days, items.length) > rentalPrice(mejor, days, items.length) ? p : mejor);
}

/**
 * Tarifa del alquiler, en centavos, para valorar un premio. El descuento por
 * volumen va siempre sobre el pedido entero: un premio no cambia cuántas
 * prendas se llevan.
 */
function rewardQuote(items) {
  const n = items.length;
  const precio = (p, d) => rentalPrice(p, Math.max(1, d), n);
  return { precio, suma: (d) => items.reduce((s, p) => s + cents(precio(p, d)), 0) };
}

/** Valor BRUTO de cada tipo de premio, en centavos y antes del tope. */
const REWARD_GROSS = {
  // Cubre UNA tarifa de logística: el premio dice "envío O retiro", no ambos.
  shipping: (rw, ctx) =>
    (deliveryFeeFor(ctx.delivery) || returnFeeFor(ctx.ret)) ? cents(SHIPPING_FEE) : 0,
  // Un día menos. Con un solo día no hay nada que regalar sin dejarlo en cero.
  freeDay: (rw, ctx, q) => (ctx.days >= 2 ? q.suma(ctx.days) - q.suma(ctx.days - 1) : 0),
  percent: (rw, ctx, q) => Math.round(q.suma(ctx.days) * rw.rate),
  // La destacada sale gratis hasta `rw.days` días; si dura menos, se regala lo cobrado.
  premiumDays: (rw, ctx, q) => {
    const p = premiumItem(ctx.items, ctx.days, rw.minStars);
    return p ? cents(q.precio(p, Math.min(ctx.days, rw.days))) : 0;
  },
};

/**
 * Descuento de un premio sobre un alquiler concreto, en centavos.
 *
 * El tope se calcula aquí, fuera de REWARD_GROSS, porque es común a todos: el
 * premio puede dejar el alquiler y la logística en $0, nunca en negativo (que
 * sería devolver parte del depósito).
 * @param {object} rw Premio de REWARDS.
 * @param {{items: object[], days: number, delivery: string, ret: string}} ctx
 *   Prendas (con `value`, `stars`… como `pricedItem()`), días y modos.
 * @returns {number} Centavos (0 si no aplica).
 */
export function rewardDiscountCents(rw, ctx) {
  if (!rw || !ctx.items.length) return 0;
  const q = rewardQuote(ctx.items);
  const calc = REWARD_GROSS[rw.type];
  const bruto = calc ? calc(rw, ctx, q) : 0;
  const cobrable = q.suma(ctx.days) + cents(deliveryFeeFor(ctx.delivery)) + cents(returnFeeFor(ctx.ret));
  return Math.max(0, Math.min(bruto, cobrable));
}

/**
 * Por qué un premio no rebajaría nada en este alquiler, o null si sí aplica.
 * Es lo que el checkout enseña en vez de un "-$0.00" mudo.
 * @param {object} rw Premio de REWARDS.
 * @param {{items: object[], days: number, delivery: string, ret: string}} ctx
 * @returns {string|null}
 */
export function rewardIssue(rw, ctx) {
  if (!rw) return null;
  if (rw.type === "shipping" && ctx.delivery !== DELIVERY.SHIP && ctx.ret !== RETURN_TO.HOME) {
    return "Solo aplica si eliges envío a domicilio o retiro a domicilio.";
  }
  if (rw.type === "freeDay" && ctx.days < 2) return "Necesitas un alquiler de 2 días o más para regalar uno.";
  if (rw.type === "premiumDays" && !premiumItem(ctx.items, ctx.days, rw.minStars)) {
    return `Ninguna prenda del carrito es destacada (calidad ${rw.minStars}/5 o más).`;
  }
  return null;
}

/**
 * Puntos que gana un pedido: por lo que se pagó de verdad (alquiler +
 * logística − premio, sin depósito), los días y las prendas. Lo cubierto por un
 * premio no vuelve a puntuar: si lo hiciera, canjear alimentaría el siguiente
 * canje. Misma fórmula que tenía el navegador.
 * @param {{spendCents: number, days: number, itemCount: number}} o
 * @returns {number}
 */
export function orderPoints({ spendCents, days, itemCount }) {
  return Math.round(Math.max(0, spendCents) / 10) + days * 2 + itemCount * 5;
}
