/**
 * Ventanas de devolución (§6.0 de DECISIONES), que sustituyen a los días de
 * gracia y a la multa fija de $15.
 *
 * - Retira lunes, martes o miércoles → devuelve hasta el viernes; jueves o
 *   viernes → hasta el lunes. Feriado en el cierre → siguiente día hábil.
 * - Solo extiende, nunca acorta.
 * - Sin retiros ni devoluciones en fin de semana ni feriado.
 *
 * Las reglas son puras (dates.js) y se prueban con fechas fijas; la API se
 * prueba con fechas reales calculadas, porque rechaza el pasado.
 *
 * Asume la base sembrada (`pnpm db:reset`), como el resto de la suite.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import prisma from "../src/db.js";
import {
  addDaysISO,
  isBusinessDay,
  nextBusinessDay,
  returnByDate,
  returnWindowClose,
  todayISO,
  weekdayOf,
} from "../src/dates.js";
import { demoItems, habil, loadHolidays, purge } from "./helpers/db.js";

const CLIENTE = "test-sub-ventanas";

let app;
let prendas;

/** Crea un pedido de retiro en el local con las fechas dadas. */
function pedir(start, end) {
  return app.inject({
    method: "POST",
    url: "/api/orders",
    headers: { authorization: `Bearer ${CLIENTE}` },
    payload: { items: [prendas[0].id], start, end, delivery: "pickup", ret: "store", pay: "credit" },
  });
}

/**
 * Próximo día (desde mañana) que cae en el día de la semana pedido.
 * @param {number} dow 0 = domingo.
 * @returns {string}
 */
function proximo(dow) {
  let d = addDaysISO(todayISO(), 1);
  while (weekdayOf(d) !== dow) d = addDaysISO(d, 1);
  return d;
}

before(async () => {
  await loadHolidays();
  app = buildApp({
    verifyGoogleToken: async (token) => ({ sub: token, email: `${token}@test`, name: token }),
  });
  await app.ready();
  prendas = await demoItems(app);
});

beforeEach(() => purge({ subs: [CLIENTE] }));

after(async () => {
  await purge({ subs: [CLIENTE] });
  await app.close();
  await prisma.$disconnect();
});

/* ---- Reglas puras, con una semana fija (lunes 2030-01-07) ---- */

test("lunes, martes y miércoles devuelven hasta el viernes", () => {
  for (const dia of ["2030-01-07", "2030-01-08", "2030-01-09"]) {
    assert.equal(returnWindowClose(dia), "2030-01-11", dia);
  }
});

test("jueves y viernes devuelven hasta el lunes", () => {
  for (const dia of ["2030-01-10", "2030-01-11"]) {
    assert.equal(returnWindowClose(dia), "2030-01-14", dia);
  }
});

test("un cierre en feriado pasa al siguiente día hábil", () => {
  // Viernes feriado → el lunes; lunes feriado tras un jueves → el martes.
  assert.equal(returnWindowClose("2030-01-07", new Set(["2030-01-11"])), "2030-01-14");
  assert.equal(returnWindowClose("2030-01-10", new Set(["2030-01-14"])), "2030-01-15");
});

test("la ventana solo extiende: una devolución elegida más tarde se respeta", () => {
  assert.equal(returnByDate("2030-01-07", "2030-01-08"), "2030-01-11");
  assert.equal(returnByDate("2030-01-07", "2030-01-16"), "2030-01-16");
});

test("fin de semana y feriado no son días hábiles", () => {
  assert.equal(isBusinessDay("2030-01-12"), false, "sábado");
  assert.equal(isBusinessDay("2030-01-13"), false, "domingo");
  assert.equal(isBusinessDay("2030-01-07", new Set(["2030-01-07"])), false, "feriado");
  assert.equal(nextBusinessDay("2030-01-12"), "2030-01-14");
});

/* ---- API ---- */

test("no se retira en sábado ni domingo", async () => {
  for (const dow of [6, 0]) {
    const dia = proximo(dow);
    const res = await pedir(dia, nextBusinessDay(addDaysISO(dia, 1)));
    assert.equal(res.statusCode, 400, `${dia}: ${res.body}`);
    assert.match(res.json().error, /día hábil/);
  }
});

test("no se devuelve en fin de semana", async () => {
  const sabado = proximo(6);
  const res = await pedir(habil(0) < sabado ? habil(0) : addDaysISO(sabado, -1), sabado);
  assert.equal(res.statusCode, 400, res.body);
});

test("no se retira en feriado", async () => {
  const feriado = await prisma.holiday.findFirst({
    where: { date: { gt: new Date(`${todayISO()}T00:00:00Z`) } },
    orderBy: { date: "asc" },
  });
  if (!feriado) return; // la semilla cubre hasta 2027; pasado eso no hay qué probar
  const dia = feriado.date.toISOString().slice(0, 10);
  if (!isBusinessDay(dia)) return; // feriado en fin de semana: ya lo cubre la prueba anterior
  const res = await pedir(dia, nextBusinessDay(addDaysISO(dia, 1), new Set([dia])));
  assert.equal(res.statusCode, 400, res.body);
});

test("el pedido trae su fecha límite y el precio sigue saliendo de los días elegidos", async () => {
  const corto = (await pedir(habil(1), habil(1))).json();
  assert.equal(corto.days, 1, "se cobra lo elegido, no la ventana");
  assert.ok(corto.returnBy > corto.end, "y se puede devolver más tarde sin costo");
});

test("GET /api/config dice qué días cierra el local", async () => {
  const res = await app.inject({ method: "GET", url: "/api/config" });
  assert.equal(res.statusCode, 200);
  const cfg = res.json();
  assert.deepEqual(cfg.closedWeekdays, [0, 6]);
  assert.equal(cfg.today, todayISO());
  assert.ok(cfg.holidays.every((h) => h.date >= cfg.today && typeof h.name === "string"));
});
