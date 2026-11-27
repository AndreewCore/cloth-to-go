/**
 * Tabla de retención de garantía (§6.2 de DECISIONES), copiada tal cual.
 *
 * Los porcentajes son **sobre la garantía retenida**, no sobre el valor de la
 * prenda. Los casos se suman con techo de 100 %: no existe retención mayor que
 * la garantía (§6.1). Caja se mueve dentro de la tabla; un porcentaje fuera de
 * ella es solo de Administración y siempre con motivo escrito.
 *
 * El atraso no está aquí: desde la fase 4 se cobra en días extra con la
 * escalera normal (§6.0), nunca reteniendo garantía.
 */

/** Casos de la tabla, con el texto que ven Caja y el cliente. */
export const RETENTION_CASES = Object.freeze({
  MANCHA_ESPECIAL: { label: "Mancha que exige tratamiento especial", percent: 25 },
  DESPERFECTO_MENOR: { label: "Desperfecto menor enmendable (botón, costura, dobladillo)", percent: 25 },
  DESPERFECTO_MAYOR: { label: "Desperfecto mayor reparable (cremallera, rotura, descosido grande)", percent: 50 },
  IRREPARABLE: { label: "Daño irreparable (prenda inservible)", percent: 100 },
  INCOMPLETA: { label: "Devolución incompleta (falta cinturón, tocado, accesorio)", percent: 25 },
});

/**
 * Porcentaje que suman unos casos de la tabla, con su techo.
 * @param {string[]} cases Claves de `RETENTION_CASES`, sin repetir.
 * @returns {number} Entre 0 y 100.
 * @throws {Error} Si alguna clave no es de la tabla.
 */
export function retentionPercent(cases) {
  if (!Array.isArray(cases) || new Set(cases).size !== cases.length) throw new Error("Casos repetidos o no válidos.");
  const desconocido = cases.find((c) => !RETENTION_CASES[c]);
  if (desconocido) throw new Error(`Caso de retención desconocido: ${desconocido}.`);
  return Math.min(100, cases.reduce((s, c) => s + RETENTION_CASES[c].percent, 0));
}

/**
 * Centavos que se retienen de una garantía. Se redondea al centavo: la
 * diferencia de medio centavo va a favor del cliente (§6.3, regla 4).
 * @param {number} heldCents Garantía retenida.
 * @param {number} percent Porcentaje (0–100).
 * @returns {number}
 */
export function retainedCents(heldCents, percent) {
  return Math.floor((heldCents * percent) / 100);
}

/** Casos para quien los pinta (el panel), en el orden de la tabla. */
export const retentionCasesForApi = () =>
  Object.entries(RETENTION_CASES).map(([key, c]) => ({ key, label: c.label, percent: c.percent }));
