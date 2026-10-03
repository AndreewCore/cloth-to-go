/**
 * Huella hídrica de las prendas, del lado del servidor.
 *
 * COPIA DELIBERADA de `WATER_PER_KG` y `garmentWater()` de `js/data.js`, por
 * la misma razón que pricing.js: el frontend son classic scripts y el servidor
 * es ESM. Lo que mantiene las dos copias iguales es
 * `test/agua-paridad.test.js`, en la suite del frontend: si los litros de una
 * prenda difieren, el contador de todos y el de cada perfil contarían cosas
 * distintas.
 *
 * Puro: sin Prisma ni red, para que la suite del frontend pueda importarlo.
 */

/** Litros de agua por kg de tejido acabado, según el material (ver js/data.js). */
export const WATER_PER_KG = {
  algodon: 10000,
  lana: 11000,
  cuero: 17000,
  lino: 2900,
  sintetico: 120,
};

/**
 * Litros que se ahorran al reutilizar UNA prenda en vez de fabricarla nueva.
 * @param {{material: string, weightKg: number}} p Prenda.
 * @returns {number} Litros, redondeados.
 */
export function garmentWater(p) {
  const intensity = WATER_PER_KG[p.material] ?? WATER_PER_KG.algodon;
  return Math.round((p.weightKg || 0) * intensity);
}

/**
 * Metas del contador común, en litros. La primera es la meta de lanzamiento;
 * las demás aparecen al cruzar la anterior, para que el tanque nunca se quede
 * lleno y quieto.
 */
export const COMMUNITY_WATER_GOALS = [100_000_000, 250_000_000, 500_000_000, 1_000_000_000];

/**
 * Meta vigente y metas ya cruzadas para una cantidad de litros.
 *
 * Pasada la última de la lista se sigue de mil en mil millones: escribir metas
 * a mano para siempre no tiene sentido, y quedarse sin meta dejaría la barra
 * llena y sin nada que perseguir.
 * @param {number} liters Litros acumulados.
 * @returns {{goal: number, reached: number[]}} Meta a la que se apunta y las ya superadas.
 */
export function communityGoal(liters) {
  const reached = COMMUNITY_WATER_GOALS.filter((g) => liters >= g);
  const next = COMMUNITY_WATER_GOALS.find((g) => liters < g);
  if (next) return { goal: next, reached };
  const STEP = 1_000_000_000;
  const goal = (Math.floor(liters / STEP) + 1) * STEP;
  for (let g = 2 * STEP; g < goal; g += STEP) reached.push(g);
  return { goal, reached };
}
