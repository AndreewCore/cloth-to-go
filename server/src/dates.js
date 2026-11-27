/**
 * Fechas del negocio, en hora de Guayaquil.
 *
 * Sale de orders.js porque el contador de agua (impact.js) necesita la misma
 * noción de "hoy" para decidir qué alquiler ya está cumplido: dos copias de
 * este cálculo podrían discrepar justo en la frontera de medianoche.
 */

// Ecuador continental es UTC−5 todo el año (sin horario de verano). Se fija a
// mano en vez de confiar en la zona del proceso: en producción el contenedor
// corre en UTC, y con `new Date()` el día del negocio cambiaría a las 19:00
// hora de Guayaquil — los alquileres empezarían "mañana" toda la tarde.
const EC_OFFSET_MIN = -5 * 60;

/**
 * Fecha de hoy en Guayaquil, como `YYYY-MM-DD`.
 * @param {number|Date} [now=Date.now()] Instante de referencia (para pruebas).
 * @returns {string} Día de calendario local.
 */
export function todayISO(now = Date.now()) {
  // Se desplaza el instante UTC y se lee con toISOString: así el día sale de
  // una cuenta explícita y no de la zona horaria en que corra el proceso.
  return new Date(Number(now) + EC_OFFSET_MIN * 60000).toISOString().slice(0, 10);
}

/* ======================================================================
   Días hábiles y ventanas de devolución (§6.0 de DECISIONES).
   Funciones puras: los feriados llegan como un Set de `YYYY-MM-DD`, que quien
   llama lee de la tabla `holidays`. Así se prueban sin base y la regla vive en
   un solo sitio.
   ====================================================================== */

/** Días de la semana sin atención (0 = domingo, 6 = sábado): no hay retiros ni
 * entregas en fin de semana. El panel (fase 4) los hará configurables. */
export const CLOSED_WEEKDAYS = [0, 6];

/**
 * Día de la semana de una fecha de calendario (0 = domingo).
 * @param {string} iso `YYYY-MM-DD`.
 * @returns {number}
 */
export function weekdayOf(iso) {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/**
 * Suma días de calendario a una fecha, sin pasar por la zona del proceso.
 * @param {string} iso `YYYY-MM-DD`.
 * @param {number} n Días (puede ser negativo).
 * @returns {string} `YYYY-MM-DD`.
 */
export function addDaysISO(iso, n) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

/**
 * ¿Abre el local ese día? Ni fin de semana ni feriado.
 * @param {string} iso `YYYY-MM-DD`.
 * @param {Set<string>} [holidays] Feriados.
 * @returns {boolean}
 */
export function isBusinessDay(iso, holidays = new Set()) {
  return !CLOSED_WEEKDAYS.includes(weekdayOf(iso)) && !holidays.has(iso);
}

/**
 * El mismo día si es hábil; si no, el siguiente que lo sea.
 * @param {string} iso `YYYY-MM-DD`.
 * @param {Set<string>} [holidays] Feriados.
 * @returns {string}
 */
export function nextBusinessDay(iso, holidays = new Set()) {
  let d = iso;
  // Tope de seguridad: ningún calendario real cierra 30 días seguidos, y un
  // bucle sin tope ante datos corruptos colgaría la petición.
  for (let i = 0; i < 30 && !isBusinessDay(d, holidays); i++) d = addDaysISO(d, 1);
  return d;
}

/**
 * Cierre de la ventana de devolución sin costo extra para un retiro en `start`.
 *
 * Retira lunes, martes o miércoles → devuelve hasta el viernes; jueves o viernes
 * → hasta el lunes. Si el cierre cae en feriado pasa al siguiente día hábil.
 * Con envío, `start` ya es la fecha de entrega: la ventana cuenta desde ahí.
 * @param {string} start Día de retiro o entrega (`YYYY-MM-DD`).
 * @param {Set<string>} [holidays] Feriados.
 * @returns {string} `YYYY-MM-DD`.
 */
export function returnWindowClose(start, holidays = new Set()) {
  const dow = weekdayOf(start);
  // lun(1)…mié(3) → viernes(5) de esa semana; jue(4)/vie(5) → lunes siguiente.
  // Un inicio en fin de semana no debería llegar (se rechaza antes); si llega,
  // se trata como el lunes siguiente para no producir una fecha absurda.
  const salto = dow >= 1 && dow <= 3 ? 5 - dow : dow >= 4 && dow <= 5 ? 8 - dow : (8 - dow) % 7 + 4;
  return nextBusinessDay(addDaysISO(start, salto), holidays);
}

/**
 * Fecha límite de devolución: la ventana **solo extiende, nunca acorta**, así
 * que es la más tardía entre la que eligió el cliente y el cierre de la ventana.
 * @param {string} start Inicio (`YYYY-MM-DD`).
 * @param {string} end Devolución elegida (`YYYY-MM-DD`).
 * @param {Set<string>} [holidays] Feriados.
 * @returns {string} `YYYY-MM-DD`.
 */
export function returnByDate(start, end, holidays = new Set()) {
  const cierre = returnWindowClose(start, holidays);
  return end > cierre ? end : cierre;
}

const DIAS_CORTOS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/**
 * «lun 30 nov» de un día `YYYY-MM-DD`: es como lo leen el cliente y el
 * mostrador en los mensajes y avisos que escribe el servidor.
 * @param {string} iso `YYYY-MM-DD`.
 * @returns {string}
 */
export function fmtDayEs(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${DIAS_CORTOS[d.getUTCDay()]} ${d.getUTCDate()} ${MESES_CORTOS[d.getUTCMonth()]}`;
}
