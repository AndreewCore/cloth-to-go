/**
 * Las dos bitácoras (§3.1 de DECISIONES): la de prendas y la financiera.
 *
 * Son de solo añadir y la base lo impone con un disparador; aquí solo están
 * los dos puntos de escritura, para que cada entrada lleve siempre quién,
 * cuándo y por qué. Ninguna de las dos se devuelve nunca a un cliente.
 */

/** Tipos de entrada de la bitácora financiera, como los nombra la base. */
export const FINANCE_EVENT = Object.freeze({
  COBRO_CONFIRMADO: "COBRO_CONFIRMADO",
  GARANTIA_LIBERADA: "GARANTIA_LIBERADA",
  PENALIZACION: "PENALIZACION",
  ANULACION: "ANULACION",
  CAPACIDADES: "CAPACIDADES",
});

/**
 * Anota un cambio de estado de un ejemplar.
 * @param {object} tx Cliente Prisma o transacción.
 * @param {object} entry Entrada.
 * @param {number} entry.itemId Ejemplar.
 * @param {string|null} entry.from Estado anterior (null en el alta).
 * @param {string} entry.to Estado nuevo.
 * @param {number|null} [entry.actorId] Quién; null = el sistema.
 * @param {string|null} [entry.note] Por qué.
 * @param {number|null} [entry.orderId] Pedido que lo provocó.
 * @param {{kind: string, place: string}|null} [entry.laundry] Solo al entrar a lavado.
 * @returns {Promise<object>} Fila creada.
 */
export function logItem(tx, { itemId, from, to, actorId = null, note = null, orderId = null, laundry = null }) {
  return tx.itemLog.create({
    data: {
      itemId,
      from,
      to,
      actorId,
      note,
      orderId,
      laundryKind: laundry?.kind ?? null,
      laundryPlace: laundry?.place ?? null,
    },
  });
}

/**
 * Anota un hecho de dinero o de personal.
 * @param {object} tx Cliente Prisma o transacción.
 * @param {object} entry Entrada.
 * @param {string} entry.kind Uno de FINANCE_EVENT.
 * @param {string} entry.note Por qué, en lenguaje humano. Obligatorio: una
 *   entrada financiera sin motivo no le explica nada a quien reclama.
 * @param {number|null} [entry.actorId] Quién; null = consola o sistema.
 * @param {number|null} [entry.orderId] Pedido afectado.
 * @param {number|null} [entry.subjectUserId] Persona afectada (altas de personal).
 * @param {number|null} [entry.amountCents] Importe implicado, si lo hay.
 * @returns {Promise<object>} Fila creada.
 */
export function logFinance(tx, { kind, note, actorId = null, orderId = null, subjectUserId = null, amountCents = null }) {
  return tx.financeLog.create({ data: { kind, note, actorId, orderId, subjectUserId, amountCents } });
}
