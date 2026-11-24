/**
 * Calendario desde el panel (fase 4): el horario que leen la app y la web, y
 * los cierres que quitan días de retiro y devolución. Lo que se vigila: que
 * el texto del horario lo redacte el servidor, que un cierre bloquee ese día
 * y avise de los pedidos que ya caían en él, y que el pasado no se toque.
 *
 * Todo lo que cambia (horario, cierres) se restaura al terminar.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import prisma from "../src/db.js";
import { hoursSummary } from "../src/calendar.js";
import { addDaysISO, todayISO } from "../src/dates.js";
import { grant, habil, loadHolidays, purge } from "./helpers/db.js";

const ADMIN = "test-sub-cal-admin";
const INVENTARIO = "test-sub-cal-inventario";
const CLIENTE = "test-sub-cal-cliente";
const SUBS = [ADMIN, INVENTARIO, CLIENTE];
const ESPERADO = "Lun–Vie 10:00–20:00 · Sáb 10:00–20:00 (sin retiros ni devoluciones)";

let app;
let horarioOriginal;
const cierres = [];
const modelos = [];

/** Petición firmada como `sub` (el verificador falso usa el token como identidad). */
function como(sub, opts) {
  return app.inject({ ...opts, headers: { ...opts.headers, authorization: `Bearer ${sub}` } });
}

/** Añade un cierre y lo apunta para quitarlo al final. */
async function cerrar(date, name = "Cierre de prueba") {
  cierres.push(date);
  return como(ADMIN, { method: "POST", url: "/api/admin/holidays", payload: { date, name } });
}

before(async () => {
  await loadHolidays();
  app = buildApp({ verifyGoogleToken: async (t) => ({ sub: t, email: `${t}@test`, name: t }) });
  await app.ready();
  horarioOriginal = await prisma.businessHours.findMany();
});

beforeEach(async () => {
  await purge({ subs: SUBS, productIds: modelos.splice(0) });
  await Promise.all([grant(ADMIN, ["ADMINISTRACION"]), grant(INVENTARIO, ["INVENTARIO"])]);
});

after(async () => {
  for (const f of horarioOriginal) await prisma.businessHours.update({ where: { weekday: f.weekday }, data: { open: f.open, close: f.close } });
  await prisma.holiday.deleteMany({ where: { date: { in: cierres.map((d) => new Date(`${d}T00:00:00Z`)) } } });
  await purge({ subs: SUBS, productIds: modelos });
  await app.close();
  await prisma.$disconnect();
});

test("el horario se resume agrupando días seguidos iguales", () => {
  const dia = (weekday, open, close, pickups = true) => ({ weekday, open, close, pickups });
  const semana = [dia(1, "10:00", "20:00"), dia(2, "10:00", "20:00"), dia(3, "10:00", "20:00"), dia(4, "10:00", "20:00"),
    dia(5, "10:00", "20:00"), dia(6, "10:00", "20:00", false), dia(0, null, null, false)];
  assert.equal(hoursSummary(semana), ESPERADO);
  semana[2] = dia(3, null, null);
  assert.equal(hoursSummary(semana), "Lun–Mar 10:00–20:00 · Jue–Vie 10:00–20:00 · Sáb 10:00–20:00 (sin retiros ni devoluciones)");
  assert.equal(hoursSummary(semana.map((d) => ({ ...d, open: null, close: null }))), "Cerrado");
});

test("/api/config trae el horario y su texto, que es lo que dice la app", async () => {
  const cfg = (await app.inject({ method: "GET", url: "/api/config" })).json();
  assert.equal(cfg.hours.length, 7);
  assert.equal(cfg.hours[0].weekday, 1, "lunes primero");
  assert.equal(cfg.hoursText, ESPERADO);
  assert.equal(cfg.hours.find((d) => d.weekday === 6).pickups, false, "el sábado abre, sin retiros");
});

test("cambiar el horario es de Administración, se valida y queda en la bitácora", async () => {
  const hours = (await app.inject({ method: "GET", url: "/api/config" })).json().hours.map(({ weekday, open, close }) => ({ weekday, open, close }));
  const sabado = hours.find((d) => d.weekday === 6);
  sabado.close = "14:00";
  assert.equal((await como(INVENTARIO, { method: "PUT", url: "/api/admin/hours", payload: { hours } })).statusCode, 403);
  const ok = await como(ADMIN, { method: "PUT", url: "/api/admin/hours", payload: { hours } });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.match(ok.json().hoursText, /Sáb 10:00–14:00 \(sin retiros ni devoluciones\)/);
  assert.match((await app.inject({ method: "GET", url: "/api/config" })).json().hoursText, /Sáb 10:00–14:00/);
  const log = await prisma.activityLog.findFirst({ where: { action: "HORARIO", actor: { googleSub: ADMIN } } });
  assert.match(log.note, /Sáb 10:00–20:00.*→.*Sáb 10:00–14:00/);

  for (const malo of [hours.slice(1), hours.map((d) => (d.weekday === 1 ? { ...d, close: "09:00" } : d)),
    hours.map((d) => (d.weekday === 1 ? { ...d, open: "9am" } : d)), hours.map((d) => (d.weekday === 1 ? { ...d, weekday: 2 } : d))]) {
    assert.equal((await como(ADMIN, { method: "PUT", url: "/api/admin/hours", payload: { hours: malo } })).statusCode, 400);
  }
});

test("un cierre quita ese día para retirar, y se puede editar y quitar", async () => {
  const dia = habil(9);
  const res = await cerrar(dia, "Inventario anual");
  assert.equal(res.statusCode, 201, res.body);
  const cfg = (await app.inject({ method: "GET", url: "/api/config" })).json();
  assert.ok(cfg.holidays.some((x) => x.date === dia && x.name === "Inventario anual"));
  assert.equal((await cerrar(dia)).statusCode, 409, "dos veces el mismo día no");

  const url = `/api/admin/holidays/${dia}`;
  assert.equal((await como(ADMIN, { method: "PATCH", url, payload: { name: "Inventario de fin de año" } })).statusCode, 200);
  const panel = (await como(ADMIN, { method: "GET", url: "/api/admin/calendar" })).json();
  assert.equal(panel.holidays.find((x) => x.date === dia).name, "Inventario de fin de año");
  assert.equal((await como(ADMIN, { method: "DELETE", url })).statusCode, 204);
  assert.ok(!(await app.inject({ method: "GET", url: "/api/config" })).json().holidays.some((x) => x.date === dia));
  const acciones = (await prisma.activityLog.findMany({ where: { actor: { googleSub: ADMIN }, action: { in: ["FERIADO_ALTA", "FERIADO_EDICION", "FERIADO_BAJA"] } } })).map((a) => a.action);
  assert.deepEqual(acciones.sort(), ["FERIADO_ALTA", "FERIADO_BAJA", "FERIADO_EDICION"]);
});

test("cerrar un día con pedidos avisa de cuáles, sin moverlos", async () => {
  const m = (await como(INVENTARIO, {
    method: "POST",
    url: "/api/products",
    payload: { name: "Saco de calendario", categoryKey: "formal", material: "lana", value: 30, stars: 3, weightKg: 0.8 },
  })).json();
  modelos.push(m.id);
  const molde = await prisma.item.findFirst({ orderBy: { id: "asc" } });
  const item = (await como(INVENTARIO, {
    method: "POST",
    url: `/api/products/${m.id}/items`,
    payload: { size: molde.size, sizeScale: molde.sizeScale, color: molde.color },
  })).json();
  const dia = habil(12);
  const pedido = await como(CLIENTE, {
    method: "POST",
    url: "/api/orders",
    payload: { items: [item.id], start: dia, end: dia, delivery: "pickup", ret: "store", pay: "cash" },
  });
  assert.equal(pedido.statusCode, 201, pedido.body);

  const res = await cerrar(dia, "Corte de luz programado");
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.json().orders.map((o) => [o.id, o.what]), [[pedido.json().id, "retira"]]);
  const sigue = await prisma.order.findUnique({ where: { id: pedido.json().id } });
  assert.equal(sigue.start, dia, "el pedido no se mueve solo");

  const otro = await como(CLIENTE, {
    method: "POST",
    url: "/api/orders",
    payload: { items: [item.id], start: dia, end: dia, delivery: "pickup", ret: "store", pay: "cash" },
  });
  assert.equal(otro.statusCode, 400, "un pedido nuevo ya no puede retirar ese día");
});

test("los cierres pasados no se tocan, y solo Administración edita", async () => {
  const ayer = addDaysISO(todayISO(), -1);
  assert.equal((await cerrar(ayer)).statusCode, 409);
  assert.equal((await como(ADMIN, { method: "DELETE", url: `/api/admin/holidays/${ayer}` })).statusCode, 409);
  assert.equal((await como(INVENTARIO, { method: "POST", url: "/api/admin/holidays", payload: { date: habil(9), name: "x de prueba" } })).statusCode, 403);
  assert.equal((await como(INVENTARIO, { method: "GET", url: "/api/admin/calendar" })).statusCode, 403);
  assert.equal((await cerrar(habil(9), "x")).statusCode, 400, "motivo demasiado corto");
});
