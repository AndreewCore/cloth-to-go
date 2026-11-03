/**
 * Contador común de agua ahorrada (la sección de impacto de la web).
 *
 * La página lee UNA fila (`water_counter`) y no suma nada al cargar. La fila se
 * mueve en cortes de una hora: el primer `GET` de cada hora acredita los
 * pedidos que se cumplieron desde el corte anterior. Es un corte "perezoso"
 * porque Render (plan gratuito) duerme el proceso sin tráfico, así que un
 * temporizador interno no es fiable; y mientras nadie mira, no hace falta.
 *
 * Un pedido está cumplido con la misma regla que `countsForRewards()` del
 * frontend: no anulado y con la fecha de inicio ya pasada (el cliente puede
 * anular hasta el mismo día de inicio; ver la ruta de anulación).
 */
import prisma from "./db.js";
import { todayISO } from "./dates.js";
import { garmentWater, communityGoal } from "./water.js";

/** Id de la única fila del contador (la crea la migración). */
const COUNTER_ID = 1;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Inicio de la hora en curso. Ecuador está a una hora entera de UTC, así que la
 * hora UTC y la de Guayaquil cambian en el mismo instante.
 * @param {Date} now Instante de referencia.
 * @returns {Date}
 */
export function hourStart(now) {
  return new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
}

/**
 * Hace el corte horario si toca: acredita los pedidos recién cumplidos y
 * retira los que el local anuló después de acreditarlos.
 *
 * Todo va en una transacción que empieza "reclamando" el corte con un
 * `updateMany` condicionado sobre la fila del contador. Ese UPDATE bloquea la
 * fila: si dos lecturas llegan a la vez, la segunda espera, vuelve a evaluar la
 * condición con el corte ya hecho y no encuentra nada — así nadie suma dos
 * veces el mismo pedido.
 * @param {Date} [now] Instante del corte.
 * @returns {Promise<number|null>} Litros netos que movió el corte, o null si no tocaba.
 */
export async function runWaterCut(now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const claim = await tx.waterCounter.updateMany({
      where: { id: COUNTER_ID, cutAt: { lt: hourStart(now) } },
      data: { cutAt: now },
    });
    if (claim.count === 0) return null;

    const cumplidos = await tx.order.findMany({
      where: { cancelledAt: null, waterLiters: null, start: { lt: todayISO(now) } },
      include: { items: { include: { product: true } } },
    });
    let delta = 0;
    for (const o of cumplidos) {
      const litros = o.items.reduce((s, it) => s + garmentWater(it.product), 0);
      await tx.order.update({ where: { id: o.id }, data: { waterLiters: litros } });
      delta += litros;
    }

    // El local puede anular un alquiler ya empezado (el cliente no). Si ese
    // pedido ya había sumado, sus litros salen del contador: un alquiler que no
    // ocurrió no ahorró agua. Se deja `waterLiters` en 0 y no en null para que
    // el pedido no vuelva a parecer pendiente de acreditar.
    const anulados = await tx.order.findMany({
      where: { cancelledAt: { not: null }, waterLiters: { gt: 0 } },
      select: { id: true, waterLiters: true },
    });
    for (const o of anulados) {
      await tx.order.update({ where: { id: o.id }, data: { waterLiters: 0 } });
      delta -= o.waterLiters;
    }

    if (delta !== 0) {
      await tx.waterCounter.update({
        where: { id: COUNTER_ID },
        data: { liters: { increment: BigInt(delta) } },
      });
    }
    return delta;
  });
}

/**
 * Lee el contador, haciendo antes el corte si la hora cambió desde el último.
 * @param {Date} [now] Instante de la lectura.
 * @returns {Promise<{liters:number, goal:number, reached:number[], cutAt:string, nextCutAt:string}>}
 */
export async function readWaterCounter(now = new Date()) {
  let row = await prisma.waterCounter.findUnique({ where: { id: COUNTER_ID } });
  // Sin fila la base no tiene la migración aplicada: es un fallo de despliegue
  // y debe sonar como tal (500 registrado), no como un contador en cero.
  if (!row) throw new Error("Falta la fila de water_counter: ¿se aplicaron las migraciones?");

  if (row.cutAt < hourStart(now)) {
    await runWaterCut(now);
    row = await prisma.waterCounter.findUnique({ where: { id: COUNTER_ID } });
  }

  const liters = Number(row.liters);
  return {
    liters,
    ...communityGoal(liters),
    cutAt: row.cutAt.toISOString(),
    nextCutAt: new Date(hourStart(now).getTime() + HOUR_MS).toISOString(),
  };
}

/**
 * Registra la ruta pública del contador.
 * @param {import("fastify").FastifyInstance} app
 */
export function registerImpactRoutes(app) {
  // Pública: es la cifra de toda la comunidad, sin datos de nadie. La caché se
  // corta en el próximo corte para que navegador y CDN no sirvan una hora vieja.
  app.get("/api/impact/water", async (req, reply) => {
    const now = new Date();
    const snapshot = await readWaterCounter(now);
    const restante = Math.max(0, Math.floor((Date.parse(snapshot.nextCutAt) - now.getTime()) / 1000));
    reply.header("Cache-Control", `public, max-age=${restante}`);
    return snapshot;
  });
}
