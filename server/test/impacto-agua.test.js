/**
 * Pruebas del contador común de agua (`GET /api/impact/water`).
 *
 * Lo que se vigila: que la página lea un acumulado y no una suma, que el corte
 * sea uno por hora y no sume dos veces el mismo pedido, que solo cuenten los
 * alquileres cumplidos, y que una anulación tardía del local reste lo que sumó.
 *
 * Los pedidos se crean directo en la base porque `POST /api/orders` no admite
 * fechas pasadas, y un pedido cumplido es justamente uno que ya empezó.
 * Asume la base sembrada (`pnpm db:reset`), como el resto de la suite.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import prisma from "../src/db.js";
import { readWaterCounter, runWaterCut, hourStart } from "../src/impact.js";
import { garmentWater, communityGoal } from "../src/water.js";
import { todayISO } from "../src/dates.js";

const SUB = "test-sub-agua";
const HORA = 60 * 60 * 1000;

let app;
let prendas;
let usuario;
let filaPrevia;

/**
 * Día `dias` desplazado desde hoy, en hora de Guayaquil.
 * @param {number} dias Negativo para el pasado.
 * @returns {string} `YYYY-MM-DD`.
 */
function fecha(dias) {
  return todayISO(Date.now() + dias * 24 * HORA);
}

/**
 * Crea un pedido del usuario de prueba sin pasar por la API.
 * @param {object} datos `start`, `end`, `items` (ids) y lo que se quiera pisar.
 * @returns {Promise<object>} Pedido creado.
 */
function pedido({ items, ...datos }) {
  return prisma.order.create({
    data: {
      userId: usuario.id,
      delivery: "pickup",
      ret: "store",
      pay: "cash",
      ...datos,
      items: { create: items.map((productId) => ({ productId })) },
    },
  });
}

/** Deja el contador en 0 con el corte vencido, para que cada prueba lo provoque. */
async function contadorVencido() {
  await prisma.waterCounter.update({ where: { id: 1 }, data: { liters: 0n, cutAt: new Date(0) } });
}

/** Borra los pedidos del usuario de prueba. */
async function limpiar() {
  const orders = await prisma.order.findMany({ where: { userId: usuario.id }, select: { id: true } });
  const ids = orders.map((o) => o.id);
  await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.order.deleteMany({ where: { id: { in: ids } } });
}

before(async () => {
  app = buildApp({ verifyGoogleToken: async (t) => ({ sub: t }) });
  await app.ready();
  prendas = await prisma.product.findMany({ orderBy: { id: "asc" } });
  usuario = await prisma.user.upsert({
    where: { googleSub: SUB },
    update: {},
    create: { googleSub: SUB, email: "agua@test", name: "Agua" },
  });
  // La fila es compartida con quien use esta base para desarrollar: se guarda y
  // se devuelve tal cual al terminar.
  filaPrevia = await prisma.waterCounter.findUnique({ where: { id: 1 } });
  assert.ok(filaPrevia, "falta la fila del contador: aplica las migraciones");
});

beforeEach(async () => {
  await limpiar();
  await contadorVencido();
});

after(async () => {
  await limpiar();
  await prisma.user.delete({ where: { id: usuario.id } });
  await prisma.waterCounter.update({ where: { id: 1 }, data: filaPrevia });
  await app.close();
});

test("la ruta es pública y devuelve el acumulado con la meta de 100 M", async () => {
  const res = await app.inject({ method: "GET", url: "/api/impact/water" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.liters, 0);
  assert.equal(body.goal, 100_000_000);
  assert.deepEqual(body.reached, []);
  assert.ok(Date.parse(body.nextCutAt) > Date.now(), "el próximo corte va en el futuro");
  assert.match(res.headers["cache-control"], /max-age=\d+/);
});

test("un alquiler ya empezado suma los litros de sus prendas", async () => {
  const [a, b] = prendas;
  await pedido({ items: [a.id, b.id], start: fecha(-2), end: fecha(1) });
  const { liters } = await readWaterCounter();
  assert.equal(liters, garmentWater(a) + garmentWater(b));
});

test("no cuentan los que empiezan hoy o después, ni los anulados", async () => {
  // Hoy todavía se puede anular: premiarlo antes sería explotable (mismo
  // umbral que countsForRewards() en el frontend).
  await pedido({ items: [prendas[0].id], start: fecha(0), end: fecha(3) });
  await pedido({ items: [prendas[1].id], start: fecha(2), end: fecha(5) });
  await pedido({ items: [prendas[2].id], start: fecha(-3), end: fecha(-1), cancelledAt: new Date() });
  const { liters } = await readWaterCounter();
  assert.equal(liters, 0);
});

test("el corte es uno por hora: dentro de la misma hora no se vuelve a sumar", async () => {
  const ahora = new Date();
  const p = prendas[0];
  await pedido({ items: [p.id], start: fecha(-1), end: fecha(2) });
  assert.equal((await readWaterCounter(ahora)).liters, garmentWater(p));

  // Un pedido que se cumple a mitad de hora espera al corte siguiente.
  const q = prendas[1];
  await pedido({ items: [q.id], start: fecha(-1), end: fecha(2) });
  assert.equal((await readWaterCounter(ahora)).liters, garmentWater(p));
  assert.equal(await runWaterCut(ahora), null, "el corte de esta hora ya estaba hecho");

  const siguiente = new Date(hourStart(ahora).getTime() + HORA + 1000);
  assert.equal((await readWaterCounter(siguiente)).liters, garmentWater(p) + garmentWater(q));
});

test("dos lecturas simultáneas no acreditan dos veces el mismo pedido", async () => {
  const p = prendas[0];
  await pedido({ items: [p.id], start: fecha(-1), end: fecha(2) });
  const ahora = new Date();
  await Promise.all([runWaterCut(ahora), runWaterCut(ahora), runWaterCut(ahora)]);
  const fila = await prisma.waterCounter.findUnique({ where: { id: 1 } });
  assert.equal(Number(fila.liters), garmentWater(p));
});

test("si el local anula un alquiler ya acreditado, sus litros salen en el corte siguiente", async () => {
  const ahora = new Date();
  const p = prendas[0];
  const o = await pedido({ items: [p.id], start: fecha(-1), end: fecha(2) });
  assert.equal((await readWaterCounter(ahora)).liters, garmentWater(p));

  await prisma.order.update({ where: { id: o.id }, data: { cancelledAt: new Date() } });
  const siguiente = new Date(hourStart(ahora).getTime() + HORA + 1000);
  assert.equal((await readWaterCounter(siguiente)).liters, 0);

  // Y no se resta dos veces.
  const otra = new Date(siguiente.getTime() + HORA);
  assert.equal((await readWaterCounter(otra)).liters, 0);
});

test("al cruzar una meta aparece la siguiente", () => {
  assert.deepEqual(communityGoal(0), { goal: 100_000_000, reached: [] });
  assert.deepEqual(communityGoal(100_000_000), { goal: 250_000_000, reached: [100_000_000] });
  assert.equal(communityGoal(999_999_999).goal, 1_000_000_000);
  const lejos = communityGoal(3_200_000_000);
  assert.equal(lejos.goal, 4_000_000_000);
  assert.deepEqual(lejos.reached.slice(-3), [1_000_000_000, 2_000_000_000, 3_000_000_000]);
});
