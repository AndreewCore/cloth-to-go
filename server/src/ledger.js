/**
 * Libro de cargos: qué líneas genera cada hecho del pedido y cómo se leen.
 *
 * La regla que ordena todo el archivo: **no se guarda un total, se guardan
 * líneas y se suman**. Un importe cobrado es un hecho histórico; recalcularlo
 * con las reglas de hoy haría mentir a los pedidos de ayer en cuanto cambie una
 * tarifa. Por eso nada de aquí edita una línea existente — los cambios se
 * expresan añadiendo líneas nuevas.
 *
 * Es puro: recibe prendas y datos del pedido, devuelve líneas. No toca Prisma
 * ni HTTP, así que se puede probar sin base y sin servidor.
 */
import {
  DELIVERY,
  RETURN_TO,
  LATE_PENALTY,
  cents,
  deliveryFeeFor,
  depositForItems,
  rentalDays,
  rentalPrice,
  returnFeeFor,
} from "./pricing.js";

/**
 * Tipos de línea del ledger.
 *
 * Es el vocabulario del código; desde el paso a Postgres la base los declara
 * como `enum`, así que un tipo inventado tampoco entra por una consulta a mano.
 * Mientras el motor fue SQLite —sin enums— esta constante era la única defensa.
 */
export const CHARGE_TYPE = Object.freeze({
  RENTAL: "RENTAL",
  SHIPPING: "SHIPPING",
  RETURN: "RETURN",
  DEPOSIT_HOLD: "DEPOSIT_HOLD",
  DEPOSIT_RELEASE: "DEPOSIT_RELEASE",
  LATE_PENALTY: "LATE_PENALTY",
  DISCOUNT: "DISCOUNT",
  ADJUSTMENT: "ADJUSTMENT",
});

/** Estados de una línea. VOID = anulada, no cuenta para nada. */
export const CHARGE_STATUS = Object.freeze({
  PENDING: "PENDING",
  SETTLED: "SETTLED",
  VOID: "VOID",
});

/** Cómo se movió el dinero de la línea. */
export const CHARGE_METHOD = Object.freeze({ CASH: "CASH", CARD: "CARD" });

/** Métodos de pago que acepta un pedido, tal como los manda el frontend. */
export const PAY_METHOD = Object.freeze({ CASH: "cash", CREDIT: "credit", DEBIT: "debit" });

/**
 * Tipos que representan retención o devolución del depósito.
 *
 * El depósito **se cobra pero no se gana**: entra como DEPOSIT_HOLD y sale como
 * DEPOSIT_RELEASE al devolver la prenda en buen estado. Mezclarlo con los
 * ingresos infla la facturación un 40 % y lleva a decidir sobre un número falso,
 * así que hay una función aparte (`revenueCents`) que lo excluye.
 */
const DEPOSIT_TYPES = new Set([CHARGE_TYPE.DEPOSIT_HOLD, CHARGE_TYPE.DEPOSIT_RELEASE]);

/**
 * Con tarjeta el cobro es inmediato; en efectivo queda pendiente hasta que el
 * local confirme que recibió el dinero. Confirmar que entró dinero es un acto
 * del negocio, nunca del cliente: por eso `settle` es una ruta de admin y no
 * algo que el checkout pueda darse a sí mismo.
 * @param {string} pay Método de pago del pedido (`cash`|`credit`|`debit`).
 * @returns {{status: string, method: string}} Estado y método de las líneas.
 */
export function settlementFor(pay) {
  return pay === PAY_METHOD.CASH
    ? { status: CHARGE_STATUS.PENDING, method: CHARGE_METHOD.CASH }
    : { status: CHARGE_STATUS.SETTLED, method: CHARGE_METHOD.CARD };
}

/**
 * Líneas iniciales de un pedido: el alquiler de cada prenda, la logística de
 * ida y vuelta, y la retención del depósito.
 *
 * Los importes salen de `pricing.js`, NUNCA del cliente. El checkout dice qué
 * prendas y qué fechas; cuánto cuesta eso lo decide el servidor.
 *
 * @param {object} pedido Datos ya validados del pedido.
 * @param {Array<object>} pedido.items Prendas del catálogo (filas de Product).
 * @param {string} pedido.start Inicio del alquiler (`YYYY-MM-DD`).
 * @param {string} pedido.end Devolución (`YYYY-MM-DD`).
 * @param {string} pedido.delivery `ship` | `pickup`.
 * @param {string} pedido.ret `home` | `store`.
 * @param {string} pedido.pay `cash` | `credit` | `debit`.
 * @returns {Array<object>} Líneas listas para insertar (sin `orderId`).
 */
export function initialCharges({ items, start, end, delivery, ret, pay }) {
  const dias = rentalDays(start, end);
  const { status, method } = settlementFor(pay);
  const lineas = [];

  for (const p of items) {
    lineas.push({
      type: CHARGE_TYPE.RENTAL,
      amountCents: cents(rentalPrice(p, dias, items.length)),
      status,
      method,
      productId: p.id,
      note: `Alquiler de ${p.name} · ${dias} día(s)`,
    });
  }

  const envio = deliveryFeeFor(delivery);
  if (envio > 0) {
    lineas.push({
      type: CHARGE_TYPE.SHIPPING,
      amountCents: cents(envio),
      status,
      method,
      productId: null,
      note: "Envío a domicilio",
    });
  }

  const retiro = returnFeeFor(ret);
  if (retiro > 0) {
    lineas.push({
      type: CHARGE_TYPE.RETURN,
      amountCents: cents(retiro),
      status,
      method,
      productId: null,
      note: "Retiro a domicilio",
    });
  }

  // El depósito se retiene siempre con el mismo método que el resto: si el
  // cliente paga en efectivo, tampoco ha dejado la garantía todavía.
  lineas.push({
    type: CHARGE_TYPE.DEPOSIT_HOLD,
    amountCents: cents(depositForItems(items)),
    status,
    method,
    productId: null,
    note: "Depósito de garantía (reembolsable)",
  });

  return lineas;
}

/**
 * Ajuste por cambiar el modo de devolución de un pedido ya confirmado.
 *
 * No edita la línea RETURN existente: **añade** la diferencia. Un pedido que
 * pasó de local a domicilio y volvió al local deja tres líneas y se lee la
 * historia entera; editando quedaría un cero que no cuenta nada.
 *
 * @param {string} antes Modo de devolución anterior.
 * @param {string} ahora Modo nuevo.
 * @param {string} pay Método de pago del pedido.
 * @returns {object|null} Línea de ajuste, o null si el importe no cambia.
 */
export function returnChangeAdjustment(antes, ahora, pay) {
  const delta = cents(returnFeeFor(ahora)) - cents(returnFeeFor(antes));
  if (delta === 0) return null;

  const { status, method } = settlementFor(pay);
  const etiqueta = (m) => (m === RETURN_TO.HOME ? "domicilio" : "local");
  return {
    type: CHARGE_TYPE.ADJUSTMENT,
    amountCents: delta,
    status,
    method,
    productId: null,
    note: `Cambio de devolución: ${etiqueta(antes)} → ${etiqueta(ahora)}`,
  };
}

/**
 * Línea de penalización por devolución fuera de plazo.
 * @param {string} note Motivo, con la fecha real de devolución si se conoce.
 * @returns {object} Línea de penalización, siempre PENDING: la cobra el local.
 */
export function latePenaltyCharge(note) {
  return {
    type: CHARGE_TYPE.LATE_PENALTY,
    amountCents: cents(LATE_PENALTY),
    status: CHARGE_STATUS.PENDING,
    method: null,
    productId: null,
    note: note ?? "Devolución fuera del plazo de gracia",
  };
}

/**
 * Línea de liberación del depósito, por el importe realmente retenido.
 *
 * Se calcula sobre lo que dice el ledger, no sobre `depositForItems()` de hoy:
 * si el tope del depósito cambió después del pedido, hay que devolver lo que se
 * retuvo entonces. Es el motivo entero por el que existe el libro.
 *
 * @param {Array<object>} charges Líneas del pedido.
 * @param {string} [note] Motivo.
 * @returns {object|null} Línea de devolución, o null si no hay nada retenido.
 */
export function depositReleaseCharge(charges, note) {
  const retenido = sumCents(charges, (c) => DEPOSIT_TYPES.has(c.type));
  if (retenido <= 0) return null;
  return {
    type: CHARGE_TYPE.DEPOSIT_RELEASE,
    amountCents: -retenido,
    status: CHARGE_STATUS.SETTLED,
    method: null,
    productId: null,
    note: note ?? "Depósito devuelto: prenda recibida en buen estado",
  };
}

/**
 * Suma centavos de las líneas vivas que cumplan un filtro.
 *
 * Las VOID nunca cuentan: anular es dejar constancia de que una línea no debió
 * existir, no borrarla.
 * @param {Array<object>} charges Líneas del pedido.
 * @param {(c: object) => boolean} [filtro] Qué líneas entran en la suma.
 * @returns {number} Centavos.
 */
export function sumCents(charges, filtro = () => true) {
  return charges.reduce(
    (s, c) => (c.status !== CHARGE_STATUS.VOID && filtro(c) ? s + c.amountCents : s),
    0
  );
}

/**
 * Total cobrado al cliente, depósito incluido: es lo que se le carga a la
 * tarjeta o lo que paga en el mostrador.
 * @param {Array<object>} charges Líneas del pedido.
 * @returns {number} Centavos.
 */
export function totalCents(charges) {
  return sumCents(charges);
}

/**
 * Ingreso real del pedido: el total SIN el depósito, que es dinero del cliente
 * en custodia y no facturación.
 * @param {Array<object>} charges Líneas del pedido.
 * @returns {number} Centavos.
 */
export function revenueCents(charges) {
  return sumCents(charges, (c) => !DEPOSIT_TYPES.has(c.type));
}

/**
 * Depósito retenido ahora mismo: lo que entró menos lo ya devuelto.
 * @param {Array<object>} charges Líneas del pedido.
 * @returns {number} Centavos, 0 si ya se liberó.
 */
export function heldDepositCents(charges) {
  return sumCents(charges, (c) => DEPOSIT_TYPES.has(c.type));
}

/**
 * Estado de pago del pedido, DERIVADO del ledger.
 *
 * El frontend guardaba `settled`/`pending` en el pedido; aquí no hace falta —
 * un pedido está saldado cuando no le queda ninguna línea pendiente de cobro.
 * @param {Array<object>} charges Líneas del pedido.
 * @returns {"settled"|"pending"} Estado.
 */
export function paymentStatus(charges) {
  const pendientes = charges.some((c) => c.status === CHARGE_STATUS.PENDING);
  return pendientes ? "pending" : "settled";
}

/**
 * Anular un pedido: cada línea viva se compensa con su contraria.
 *
 * No se borra ni se marca VOID el original. Se añaden líneas espejo, porque un
 * pedido anulado también es un hecho contable: hubo un cobro y hubo su
 * devolución, y ambos tienen que poder leerse.
 * @param {Array<object>} charges Líneas del pedido.
 * @param {string} [motivo] Nota para las líneas de reverso.
 * @returns {Array<object>} Líneas de compensación (puede ir vacío).
 */
export function cancellationCharges(charges, motivo) {
  const nota = motivo ?? "Anulación del pedido";
  return charges
    .filter((c) => c.status !== CHARGE_STATUS.VOID && c.amountCents !== 0)
    .map((c) => ({
      type: reverseType(c.type),
      amountCents: -c.amountCents,
      status: CHARGE_STATUS.SETTLED,
      method: c.method,
      productId: c.productId ?? null,
      note: `${nota} · reverso de ${c.type}`,
    }));
}

/**
 * Tipo de la línea que compensa a otra.
 *
 * Casi todo se revierte como ADJUSTMENT, pero el depósito NO: si el reverso de
 * un DEPOSIT_HOLD fuera un ajuste, el pedido anulado seguiría contando garantía
 * retenida (`heldDepositCents` mira los tipos, no los importes) y el local
 * podría devolver un depósito ya devuelto. El reverso de una retención es una
 * liberación, y decirlo así mantiene la cuenta del depósito cuadrada sola.
 * @param {string} type Tipo de la línea original.
 * @returns {string} Tipo de la línea de reverso.
 */
function reverseType(type) {
  if (type === CHARGE_TYPE.DEPOSIT_HOLD) return CHARGE_TYPE.DEPOSIT_RELEASE;
  if (type === CHARGE_TYPE.DEPOSIT_RELEASE) return CHARGE_TYPE.DEPOSIT_HOLD;
  return CHARGE_TYPE.ADJUSTMENT;
}

/**
 * Valida el vocabulario de un pedido entrante.
 *
 * Vive aquí y no en las rutas porque son los mismos valores que el ledger
 * asume al calcular: un `delivery` con una errata no cobraría envío y nadie se
 * enteraría hasta cuadrar caja.
 * @param {object} body Cuerpo de la petición.
 * @returns {string|null} Mensaje de error para el cliente, o null si es válido.
 */
export function validateOrderVocabulary({ delivery, ret, pay }) {
  if (!Object.values(DELIVERY).includes(delivery)) return "Modo de entrega no válido.";
  if (!Object.values(RETURN_TO).includes(ret)) return "Modo de devolución no válido.";
  if (!Object.values(PAY_METHOD).includes(pay)) return "Método de pago no válido.";
  return null;
}

/// Mínimo de una dirección: mismo umbral que `isValidAddress()` en js/data.js
/// ("calle + número"). Si los dos números divergen, el checkout deja escribir
/// algo que la API luego rechaza, y el cliente no entiende por qué.
export const ADDRESS_MIN = 6;
/// Máximo. El frontend hoy no tiene tope, así que este es el único: sin él, el
/// cuerpo de la petición manda lo que quiera y la base lo guarda entero.
export const ADDRESS_MAX = 200;

/**
 * Valida una dirección que el pedido SÍ necesita.
 *
 * Se comprueba el tipo antes que la longitud a propósito: sin esto, un valor
 * que no es texto llega hasta Prisma y sale como error 500 —una caída del
 * servidor— en vez de como un rechazo de entrada.
 * @param {unknown} valor Lo que vino en el cuerpo.
 * @param {string} campo Nombre del campo, para el mensaje.
 * @returns {string|null} Mensaje de error para el cliente, o null si es válida.
 */
function validateAddress(valor, campo) {
  if (typeof valor !== "string") return `${campo} debe ser texto.`;
  const limpia = valor.trim();
  if (limpia.length < ADDRESS_MIN) return `${campo} está incompleta.`;
  if (limpia.length > ADDRESS_MAX) return `${campo} no puede pasar de ${ADDRESS_MAX} caracteres.`;
  return null;
}

/**
 * Valida las direcciones que el modo elegido exige.
 *
 * Solo se exige la que hace falta: quien retira en el local no tiene por qué
 * decir dónde vive, y pedir un dato personal que no se necesita es una fuga
 * esperando a que alguien la lea. La que no hace falta se ignora, no se valida:
 * la ruta la descarta después.
 * @param {object} datos Modos y direcciones del cuerpo.
 * @returns {string|null} Mensaje de error para el cliente, o null si son válidas.
 */
export function validateOrderAddresses({ delivery, ret, shipAddr, retAddr }) {
  if (delivery === DELIVERY.SHIP) {
    const error = validateAddress(shipAddr, "La dirección de envío");
    if (error) return error;
  }
  if (ret === RETURN_TO.HOME) {
    const error = validateAddress(retAddr, "La dirección de retiro");
    if (error) return error;
  }
  return null;
}
