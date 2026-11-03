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
