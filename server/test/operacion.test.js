/**
 * Operación del panel (fase 4): servir `/admin/`, las listas del mostrador,
 * las rezagadas y recibir una prenda devuelta con sus días extra.
 *
 * Lo que más se vigila: que pasarse de la fecha límite cueste días extra de la
 * escalera (no una multa), que los días se cuenten desde el día REAL de
 * devolución y no desde el registro (§6.3), y que solo el mostrador reciba.
 *
 * Cada prueba usa un ejemplar recién creado: mover un pedido al pasado sobre
 * una prenda de demostración podría chocar con reservas que no son suyas.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import prisma from "../src/db.js";
import { holidaySet } from "../src/calendar.js";
import { pricedItem } from "../src/catalog.js";
import { addDaysISO, isBusinessDay, returnByDate, todayISO } from "../src/dates.js";
import { lateCharge, lateDays } from "../src/operations.js";
import { cents, rentalDays, rentalPrice } from "../src/pricing.js";
import { ADMIN_CSP } from "../src/admin.js";
import { grant, habil, loadHolidays, purge } from "./helpers/db.js";

const CLIENTE = "test-sub-op-cliente";
const MOSTRADOR = "test-sub-op-mostrador";
const CAJA = "test-sub-op-caja";
const INVENTARIO = "test-sub-op-inventario";
const SUBS = [CLIENTE, MOSTRADOR, CAJA, INVENTARIO];

let app;
const creados = [];

/** Petición firmada como `sub` (el verificador falso usa el token como identidad). */
function como(sub, opts) {
  return app.inject({ ...opts, headers: { ...opts.headers, authorization: `Bearer ${sub}` } });
}

/** Crea un ejemplar nuevo del primer modelo, con talla y color válidos. */
async function nuevoEjemplar() {
  const molde = await prisma.item.findFirst({ orderBy: { id: "asc" } });
  const res = await como(INVENTARIO, {
    method: "POST",
    url: `/api/products/${molde.productId}/items`,
    payload: { size: molde.size, sizeScale: molde.sizeScale, color: molde.color, note: "Prueba de operación" },
  });
  assert.equal(res.statusCode, 201, res.body);
  creados.push(res.json().id);
  return res.json();
}

/**
 * Crea un pedido en efectivo sobre un ejemplar nuevo y, si se pide, lo mueve
 * al pasado para que ya haya empezado (la API no acepta fechas pasadas).
 * @param {object} [o] Opciones.
 * @param {number} [o.diasAtras] Hábiles hacia atrás del inicio; 0 = no se mueve.
 * @returns {Promise<{order: object, item: object, returnBy: string}>}
 */
async function pedido({ diasAtras = 0 } = {}) {
  const item = await nuevoEjemplar();
  const res = await como(CLIENTE, {
    method: "POST",
    url: "/api/orders",
    payload: { items: [item.id], start: habil(0), end: habil(0), delivery: "pickup", ret: "store", pay: "cash" },
  });
  assert.equal(res.statusCode, 201, res.body);
  const order = res.json();
  let returnBy = order.returnBy;
  if (diasAtras > 0) {
    const feriados = await holidaySet();
    let start = todayISO();
    for (let i = 0; i < diasAtras; i++) {
      do start = addDaysISO(start, -1); while (!isBusinessDay(start, feriados));
    }
    // Mismo día de retiro y devolución elegida; la ventana da el resto.
    returnBy = returnByDate(start, start, feriados);
    await prisma.order.update({ where: { id: order.id }, data: { start, end: start } });
    await prisma.orderItem.updateMany({
      where: { orderId: order.id },
      data: { start: new Date(`${start}T00:00:00Z`), end: new Date(`${returnBy}T00:00:00Z`) },
    });
  }
  return { order, item, returnBy };
}

/** Marca entregado (Reservada → En Alquiler) por el mostrador. */
async function entregar(itemId) {
  const res = await como(MOSTRADOR, { method: "POST", url: `/api/items/${itemId}/status`, payload: { to: "EN_ALQUILER" } });
  assert.equal(res.statusCode, 200, res.body);
}

/** Registra la devolución de todo el pedido. */
function recibir(orderId, returnedOn, sub = MOSTRADOR, extra = {}) {
  return como(sub, { method: "POST", url: `/api/orders/${orderId}/receive`, payload: { returnedOn, ...extra } });
}

before(async () => {
  await loadHolidays();
  app = buildApp({ verifyGoogleToken: async (t) => ({ sub: t, email: `${t}@test`, name: t }) });
  await app.ready();
});

beforeEach(async () => {
  // Se vacía antes del await: lo que se borra es la lista de la prueba anterior.
  const previos = creados.splice(0);
  await purge({ subs: SUBS, itemIds: previos });
  await grant(MOSTRADOR, ["MOSTRADOR"]);
  await grant(CAJA, ["CAJA"]);
  await grant(INVENTARIO, ["INVENTARIO"]);
});

after(async () => {
  await purge({ subs: SUBS, itemIds: creados });
  await app.close();
  await prisma.$disconnect();
});

/* ---- Días extra: puros ---- */

test("los días extra son hábiles: del viernes al lunes es uno, no tres", () => {
  // 2026-11-27 es viernes; 2026-11-30, lunes.
  assert.equal(lateDays("2026-11-27", "2026-11-27"), 0, "a tiempo no cuesta");
  assert.equal(lateDays("2026-11-27", "2026-11-26"), 0, "antes de tiempo tampoco");
  assert.equal(lateDays("2026-11-27", "2026-11-30"), 1);
  assert.equal(lateDays("2026-11-27", "2026-12-02"), 3);
  assert.equal(lateDays("2026-12-24", "2026-12-28", new Set(["2026-12-25"])), 1, "el feriado no cuenta");
});

test("los días extra continúan la escalera del pedido, no la reinician", () => {
  const p = { itemId: 1, name: "Vestido", value: 200, stars: 5, material: "algodon", weightKg: 0.5, laundryCost: 1.5 };
  const tarde = lateCharge(p, { days: 3, extra: 2, itemCount: 1, pay: "cash", returnBy: "2026-11-27" });
  // Tres días y dos extra cuestan lo mismo que cinco seguidos (§7).
  assert.equal(tarde.amountCents, cents(rentalPrice(p, 5)) - cents(rentalPrice(p, 3)));
  assert.equal(tarde.type, "RENTAL");
  assert.equal(tarde.status, "PENDING", "en efectivo queda por cobrar");
  assert.equal(lateCharge(p, { days: 1, extra: 0, itemCount: 1, pay: "cash", returnBy: "x" }), null);
});

/* ---- Panel servido ---- */

test("/admin/ sirve el panel con CSP estricta y sin caché", async () => {
  const res = await app.inject({ method: "GET", url: "/admin/" });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /text\/html/);
  assert.equal(res.headers["content-security-policy"], ADMIN_CSP);
  assert.doesNotMatch(ADMIN_CSP, /unsafe-inline|unsafe-eval/);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal((await app.inject({ method: "GET", url: "/admin" })).statusCode, 302);
  assert.equal((await app.inject({ method: "GET", url: "/admin/admin.js" })).statusCode, 200);
});

test("/api/me dice las capacidades de la sesión", async () => {
  assert.equal((await app.inject({ method: "GET", url: "/api/me" })).statusCode, 401);
  const me = (await como(MOSTRADOR, { method: "GET", url: "/api/me" })).json();
  assert.deepEqual(me.capabilities, ["MOSTRADOR"]);
});

/* ---- Listas del mostrador ---- */

test("un cliente no ve los pedidos del local; el mostrador sí, con quién y qué ejemplar", async () => {
  const { order, item } = await pedido();
  assert.equal((await como(CLIENTE, { method: "GET", url: "/api/admin/orders" })).statusCode, 403);
  const lista = (await como(MOSTRADOR, { method: "GET", url: "/api/admin/orders" })).json();
  const visto = lista.find((o) => o.id === order.id);
  assert.ok(visto, "un pedido con prendas por recibir está en curso");
  assert.equal(visto.customer.email, `${CLIENTE}@test`);
  assert.equal(visto.lines[0].code, item.code);
  assert.equal(visto.lines[0].status, "RESERVADA");
});

test("la lista de ejemplares dice a qué estados se puede mover cada uno", async () => {
  const item = await nuevoEjemplar();
  const lista = (await como(MOSTRADOR, { method: "GET", url: "/api/admin/items" })).json();
  const visto = lista.find((i) => i.id === item.id);
  assert.equal(visto.status, "DISPONIBLE");
  assert.deepEqual(visto.next, ["EN_LAVADO", "NO_ALQUILABLE", "PERDIDA"]);
  assert.equal((await como(CAJA, { method: "GET", url: "/api/admin/items" })).statusCode, 403);
});

/* ---- Recepción ---- */

test("no se recibe lo que no consta como entregado", async () => {
  const { order } = await pedido({ diasAtras: 1 });
  const res = await recibir(order.id, todayISO());
  assert.equal(res.statusCode, 409);
  assert.match(res.json().error, /En Alquiler/);
});

test("recibir es del mostrador, no de caja ni del cliente", async () => {
  const { order, item } = await pedido({ diasAtras: 1 });
  await entregar(item.id);
  assert.equal((await recibir(order.id, todayISO(), CAJA)).statusCode, 403);
  assert.equal((await recibir(order.id, todayISO(), CLIENTE)).statusCode, 403);
});

test("a tiempo: se anota el día real y no se cobra nada más", async () => {
  const { order, item } = await pedido({ diasAtras: 1 });
  await entregar(item.id);
  const res = await recibir(order.id, todayISO(), MOSTRADOR, { note: "Llegó bien" });
  assert.equal(res.statusCode, 200, res.body);
  const o = res.json();
  assert.equal(o.lines[0].returnedOn, todayISO());
  assert.ok(o.lines[0].receivedAt);
  assert.equal(o.totalCents, order.totalCents, "sin días extra");
  assert.equal(o.lines[0].status, "EN_ALQUILER", "el estado físico lo cambia otro acto");

  const otra = await recibir(order.id, todayISO());
  assert.equal(otra.statusCode, 409, "no se recibe dos veces");
});

test("tarde: se cobran los días hábiles extra desde el día REAL de devolución", async () => {
  const { order, item, returnBy } = await pedido({ diasAtras: 12 });
  await entregar(item.id);
  const feriados = await holidaySet();
  // Volvió hace dos días hábiles aunque se registre hoy (§6.3).
  let volvio = todayISO();
  for (let i = 0; i < 2; i++) do volvio = addDaysISO(volvio, -1); while (!isBusinessDay(volvio, feriados));
  const extra = lateDays(returnBy, volvio, feriados);
  assert.ok(extra > 0, "el escenario debe estar fuera de plazo");

  const res = await recibir(order.id, volvio);
  assert.equal(res.statusCode, 200, res.body);
  const o = res.json();
  const fila = await prisma.item.findUnique({ where: { id: item.id }, include: { product: { include: { materialRef: true } } } });
  const esperado = lateCharge(pricedItem(fila), {
    days: rentalDays(o.start, o.end), extra, itemCount: 1, pay: "cash", returnBy,
  });
  const linea = o.charges.find((c) => c.note?.startsWith("Días extra"));
  assert.ok(linea, "hay una línea de días extra");
  assert.equal(linea.type, "RENTAL");
  assert.equal(linea.amountCents, esperado.amountCents);
  assert.equal(o.totalCents, order.totalCents + esperado.amountCents);

  const log = await prisma.financeLog.findFirst({ where: { orderId: order.id, kind: "DIAS_EXTRA" } });
  assert.equal(log.amountCents, esperado.amountCents);

  // En efectivo la línea queda pendiente y caja la confirma con lo demás.
  const cobro = await como(CAJA, { method: "POST", url: `/api/orders/${order.id}/settle` });
  assert.equal(cobro.statusCode, 200, cobro.body);
  assert.equal(cobro.json().status, "settled");
});

test("la fecha de devolución no puede ser futura ni anterior al alquiler", async () => {
  const { order, item } = await pedido({ diasAtras: 3 });
  await entregar(item.id);
  assert.equal((await recibir(order.id, addDaysISO(todayISO(), 1))).statusCode, 400);
  assert.equal((await recibir(order.id, addDaysISO(todayISO(), -60))).statusCode, 400);
  assert.equal((await recibir(order.id, "ayer")).statusCode, 400);
});

/* ---- Rezagadas ---- */

test("rezagadas: vencida sin recibir, y recibida que nadie llevó a lavado", async () => {
  const { order, item } = await pedido({ diasAtras: 12 });
  await entregar(item.id);
  let r = (await como(MOSTRADOR, { method: "GET", url: "/api/admin/stragglers" })).json();
  assert.ok(r.notReceived.some((x) => x.orderId === order.id), "vencida y sin recibir aparece al instante");

  assert.equal((await recibir(order.id, todayISO())).statusCode, 200);
  r = (await como(MOSTRADOR, { method: "GET", url: "/api/admin/stragglers" })).json();
  assert.ok(!r.notReceived.some((x) => x.orderId === order.id));
  assert.ok(!r.receivedNotWashed.some((x) => x.orderId === order.id), "recién recibida todavía no es rezagada");

  await prisma.orderItem.updateMany({ where: { orderId: order.id }, data: { receivedAt: new Date(Date.now() - 2 * 86_400_000) } });
  r = (await como(MOSTRADOR, { method: "GET", url: "/api/admin/stragglers" })).json();
  assert.ok(r.receivedNotWashed.some((x) => x.orderId === order.id), "más de un día recibida y sin lavar");
  assert.equal((await como(CAJA, { method: "GET", url: "/api/admin/stragglers" })).statusCode, 403);
});
