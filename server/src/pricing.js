/**
 * Modelo de precios del servidor.
 *
 * COPIA DELIBERADA del bloque de precios de `js/data.js`. Existe porque el
 * importe que se cobra lo tiene que calcular el servidor: si el checkout
 * enviara `{ discount: 4.50 }` o `{ total: 32.10 }`, esos números serían una
 * sugerencia hostil — cualquiera abre la consola y los cambia. El cliente
 * manda qué prendas, cuántos días y qué cupón; el dinero sale de aquí.
 *
 * Por qué copia y no un archivo compartido: el frontend son classic scripts
 * (sin `import`/`export`) para poder abrirse con `file://`, y el servidor es
 * ESM. Un único archivo que sirva a ambos tendría que declararse global y
 * exportarse a la vez, y esa doble personalidad se paga en cada lectura.
 *
 * Lo que evita que las dos copias se separen NO es la buena intención, es
 * `test/pricing-paridad.test.js`: recorre el catálogo entero por duraciones y
 * cantidades y falla al primer centavo de diferencia. Es la misma decisión que
 * se tomó con el catálogo duplicado (`test/catalogo-backend.test.js`).
 *
 * Todo lo de aquí es puro: sin Prisma, sin red y sin estado. Por eso la suite
 * del frontend puede importarlo sin levantar nada.
 */

/* ---- Cargos logísticos ---- */

/** Tarifa de envío/retiro a domicilio, en USD. */
export const SHIPPING_FEE = 4.5;

/** Penalización por no devolver dentro de los días de gracia, en USD. */
export const LATE_PENALTY = 15.0;

/** Días hábiles de gracia tras la fecha límite antes de penalizar. */
export const LATE_GRACE_DAYS = 3;

/** Cómo RECIBE el cliente el pedido. */
export const DELIVERY = Object.freeze({ SHIP: "ship", PICKUP: "pickup" });

/** Cómo lo DEVUELVE. */
export const RETURN_TO = Object.freeze({ HOME: "home", STORE: "store" });

/**
 * Cargo por recibir el pedido: solo el envío a domicilio cuesta.
 * @param {string} delivery `ship` | `pickup`.
 * @returns {number} USD.
 */
export function deliveryFeeFor(delivery) {
  return delivery === DELIVERY.SHIP ? SHIPPING_FEE : 0;
}

/**
 * Cargo por devolver el pedido: solo el retiro a domicilio cuesta.
 * @param {string} ret `home` | `store`.
 * @returns {number} USD.
 */
export function returnFeeFor(ret) {
  return ret === RETURN_TO.HOME ? SHIPPING_FEE : 0;
}

/* ---- Coste real de un ciclo de alquiler ---- */

// Coste de acondicionar la prenda entre un alquiler y el siguiente (USD,
// precios de lavandería en Guayaquil). Lana y cuero piden lavado en seco.
const LAUNDRY_BY_MATERIAL = { algodon: 1.5, sintetico: 1.5, lino: 2.5, lana: 5.0, cuero: 3.0 };

// Empaque, transporte interno y provisión por merma/no devolución, por ciclo.
const OVERHEAD_PER_CYCLE = 0.5;

// Ciclos de alquiler que le quedan a una prenda por cada estrella de calidad.
const CYCLES_PER_STAR = 6;

/** Margen sobre coste que debe dejar cualquier alquiler, por corto que sea. */
export const MIN_MARGIN = 0.35;

/**
 * Ciclos de alquiler que le quedan a la prenda antes de retirarla del catálogo.
 * @param {{stars: number}} p Prenda.
 * @returns {number} Ciclos restantes.
 */
export function garmentCycles(p) {
  return CYCLES_PER_STAR * p.stars;
}

/**
 * Coste de un alquiler para el negocio, sin importar cuántos días dure:
 * amortización + lavandería + gastos fijos del ciclo. Es POR CICLO, no por día
 * — lavar cuesta lo mismo si la prenda estuvo fuera 1 día o 10.
 * @param {{value: number, stars: number, material: string}} p Prenda.
 * @returns {number} USD por ciclo.
 */
export function cycleCost(p) {
  const laundry = LAUNDRY_BY_MATERIAL[p.material] ?? LAUNDRY_BY_MATERIAL.algodon;
  return p.value / garmentCycles(p) + laundry + OVERHEAD_PER_CYCLE;
}

/* ---- Tarifa de cara al cliente ---- */

// Tarifa de la prenda sin calidad reconocible (`stars` ausente o fuera de 1–5,
// que puede llegar de la base): se cobra como la más gastada, el lado seguro.
const DAY1_RATE_DEFAULT = 0.06;
const DAY1_RATE_BY_STARS = {
  5: 0.1,
  4: 0.08,
  3: DAY1_RATE_DEFAULT,
  2: DAY1_RATE_DEFAULT,
  1: DAY1_RATE_DEFAULT,
};

// Peso de cada día adicional respecto al primero. Alquilar dos semanas no puede
// costar catorce veces un día: el coste del negocio apenas crece con el tiempo.
const DAY_TRAMOS = [
  { hasta: 3, peso: 0.5 }, // días 2–3
  { hasta: 7, peso: 0.3 }, // días 4–7
  { hasta: Infinity, peso: 0.15 }, // días 8 en adelante
];

const VOLUME_DISCOUNT_PER_ITEM = 0.05; // 5% menos por cada prenda adicional
const VOLUME_DISCOUNT_MAX = 0.2; // tope: hasta 20%

/**
 * Descuento por alquilar varias prendas a la vez: el producto real no es una
 * prenda suelta sino un conjunto.
 * @param {number} itemCount Prendas en el pedido.
 * @returns {number} Tasa entre 0 y VOLUME_DISCOUNT_MAX.
 */
export function volumeDiscountRate(itemCount) {
  const extra = Math.max(0, itemCount - 1);
  return Math.min(extra * VOLUME_DISCOUNT_PER_ITEM, VOLUME_DISCOUNT_MAX);
}

/**
 * Precio de lista por `days` días, antes de descuentos y del piso de coste.
 * @param {object} p Prenda.
 * @param {number} days Días de alquiler.
 * @returns {number} USD.
 */
export function rentalListPrice(p, days) {
  const day1 = (DAY1_RATE_BY_STARS[p.stars] ?? DAY1_RATE_DEFAULT) * p.value;
  let total = day1;
  for (let d = 2; d <= days; d++) {
    total += day1 * DAY_TRAMOS.find((t) => d <= t.hasta).peso;
  }
  return total;
}

/**
 * Precio mínimo al que se puede alquilar la prenda sin perder dinero.
 * @param {object} p Prenda.
 * @returns {number} USD.
 */
export function rentalFloor(p) {
  return cycleCost(p) * (1 + MIN_MARGIN);
}

/**
 * Precio final de alquilar una prenda: tramos por día, menos el descuento por
 * volumen, con el piso de coste como suelo duro.
 * @param {object} p Prenda del catálogo.
 * @param {number} days Días de alquiler (mínimo 1).
 * @param {number} [itemCount=1] Prendas del pedido, para el descuento.
 * @returns {number} USD con 2 decimales.
 */
export function rentalPrice(p, days, itemCount = 1) {
  const d = Math.max(1, days);
  const listed = rentalListPrice(p, d) * (1 - volumeDiscountRate(itemCount));
  return Math.round(Math.max(listed, rentalFloor(p)) * 100) / 100;
}

/* ---- Depósito de garantía ----
   Cubre el riesgo de no recuperar la prenda, así que NO baja por volumen ni por
   duración: más prendas es más riesgo, no menos. */
const DEPOSIT_RATE = 0.4; // 40% del valor de reposición

/** Tope de depósito por prenda, en USD. */
export const DEPOSIT_MAX = 25;

/** Tope de depósito por pedido, en USD. */
export const DEPOSIT_ORDER_MAX = 40;

/**
 * Depósito reembolsable de una prenda, derivado de su valor de reposición.
 * @param {{value: number}} p Prenda.
 * @returns {number} USD redondeado a dólares enteros.
 */
export function depositFor(p) {
  return Math.min(Math.round(DEPOSIT_RATE * p.value), DEPOSIT_MAX);
}

/**
 * Depósito de un pedido completo, con tope propio.
 * @param {Array<object>} items Prendas del pedido.
 * @returns {number} USD.
 */
export function depositForItems(items) {
  const sum = items.reduce((s, p) => s + depositFor(p), 0);
  return Math.min(sum, DEPOSIT_ORDER_MAX);
}

/* ---- Dinero en centavos enteros ----
   Misma decisión que `cents()` en js/state.js, y por el mismo motivo: sumar
   en float arrastra un centavo de deriva. En la base es peor que en la
   pantalla, porque ahí el error queda escrito. */

/**
 * Convierte USD a centavos enteros.
 * @param {number} usd Importe en dólares.
 * @returns {number} Centavos.
 */
export function cents(usd) {
  return Math.round(usd * 100);
}

/**
 * Días de alquiler entre dos fechas `YYYY-MM-DD`, mínimo 1.
 *
 * Se calcula sobre las fechas en UTC a propósito: sumar días con horas locales
 * cambia de resultado en los cambios de horario, y aquí solo importa la
 * diferencia entre dos días de calendario.
 * @param {string} start Fecha de inicio (`YYYY-MM-DD`).
 * @param {string} end Fecha de devolución (`YYYY-MM-DD`).
 * @returns {number} Días, mínimo 1.
 */
export function rentalDays(start, end) {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86400000));
}
