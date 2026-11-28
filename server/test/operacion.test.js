/**
 * Operación del panel (fase 4): servir `/admin/`, las listas del mostrador,
 * las rezagadas y recibir una prenda devuelta con sus días extra.
 *
 * Lo que más se vigila: que pasarse de la fecha límite cueste días extra de la
 * escalera (no una multa), que los días se cuenten desde el día REAL de
 * devolución y no desde el registro (§6.3), que solo el mostrador reciba, y
 * que una prenda recibida vaya a lavado y no vuelva sola al catálogo (§3).
 *
 * Cada prueba usa un ejemplar recién creado: mover un pedido al pasado sobre
 * una prenda de demostración podría chocar con reservas que no son suyas.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import prisma from "../src/db.js";
import { holidaySet } from "../src/calendar.js";
import { LAUNDRY_READY_DAYS, pricedItem, rentableFrom } from "../src/catalog.js";
import { addDaysISO, isBusinessDay, nextBusinessDay, returnByDate, todayISO } from "../src/dates.js";
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

/** Destino de lavado propio en el local, el más común al recibir. */
const aLavado = (itemId) => ({ itemId, to: "EN_LAVADO", laundry: { kind: "PROPIO", place: "Local" } });

/**
 * Registra la devolución. Sin `extra.items`, todas las prendas del pedido van
 * a lavado en el local.
 */
async function recibir(orderId, returnedOn, sub = MOSTRADOR, extra = {}) {
  const items = extra.items
    ?? (await prisma.orderItem.findMany({ where: { orderId }, select: { itemId: true } })).map((x) => aLavado(x.itemId));
  return como(sub, { method: "POST", url: `/api/orders/${orderId}/receive`, payload: { returnedOn, ...extra, items } });
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

test("/admin/fotos/ sirve las fotos del catálogo en el mismo origen, y nada más", async () => {
  const foto = await app.inject({ method: "GET", url: "/admin/fotos/1.webp" });
  assert.equal(foto.statusCode, 200);
  assert.equal(foto.headers["content-security-policy"], ADMIN_CSP);
  const fuera = await app.inject({ method: "GET", url: "/admin/fotos/../../src/db.js" });
  assert.notEqual(fuera.statusCode, 200, "no se sale de la carpeta de fotos");
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
  assert.ok(visto.lines[0].imgs.length > 0, "trae las fotos para saber qué prenda es");
});

test("la lista de ejemplares dice a qué estados se puede mover cada uno", async () => {
  const item = await nuevoEjemplar();
  const lista = (await como(MOSTRADOR, { method: "GET", url: "/api/admin/items" })).json();
  const visto = lista.find((i) => i.id === item.id);
  assert.equal(visto.status, "DISPONIBLE");
  assert.deepEqual(visto.next, ["EN_LAVADO", "NO_ALQUILABLE", "PERDIDA"]);
  assert.ok(Array.isArray(visto.imgs));
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
  assert.equal(o.lines[0].status, "EN_LAVADO", "recibir la lleva a lavado en el mismo acto");
  assert.deepEqual(o.receipt, {
    extraCents: 0,
    items: [{ itemId: item.id, code: item.code, productName: o.receipt.items[0].productName, to: "EN_LAVADO", laundryPlace: "Local", extraDays: 0 }],
  });

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
  assert.equal(o.receipt.extraCents, esperado.amountCents, "el panel recibe lo cobrado para decirlo");
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

  // Hoy recibir ya la lleva a lavado y libera la reserva; esta rezagada queda
  // para lo recibido antes de ese cambio, que se simula como entonces: En
  // Alquiler y con la reserva sin liberar.
  await prisma.item.update({ where: { id: item.id }, data: { status: "EN_ALQUILER", laundryKind: null, laundryPlace: null } });
  await prisma.orderItem.updateMany({ where: { orderId: order.id }, data: { receivedAt: new Date(Date.now() - 2 * 86_400_000), releasedAt: null } });
  r = (await como(MOSTRADOR, { method: "GET", url: "/api/admin/stragglers" })).json();
  assert.ok(r.receivedNotWashed.some((x) => x.orderId === order.id), "más de un día recibida y sin lavar");
  assert.equal((await como(CAJA, { method: "GET", url: "/api/admin/stragglers" })).statusCode, 403);
});

/* ---- Recepción con destino y vuelta al catálogo ---- */

test("recibir lleva cada prenda a lavado (con quién y dónde) en una sola entrada de bitácora", async () => {
  const { order, item } = await pedido({ diasAtras: 1 });
  await entregar(item.id);
  const res = await recibir(order.id, todayISO(), MOSTRADOR, {
    items: [{ itemId: item.id, to: "EN_LAVADO", laundry: { kind: "EXTERNO", place: "Lavandería Sol" } }],
  });
  assert.equal(res.statusCode, 200, res.body);
  const fila = await prisma.item.findUnique({ where: { id: item.id } });
  assert.equal(fila.status, "EN_LAVADO");
  assert.equal(fila.laundryKind, "EXTERNO");
  assert.equal(fila.laundryPlace, "Lavandería Sol");

  const logs = await prisma.itemLog.findMany({ where: { itemId: item.id, orderId: order.id, note: { startsWith: "Recibida" } } });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].from, "EN_ALQUILER");
  assert.equal(logs[0].to, "EN_LAVADO");
  assert.equal(logs[0].laundryPlace, "Lavandería Sol");
  const reserva = await prisma.orderItem.findFirst({ where: { orderId: order.id } });
  assert.ok(reserva.releasedAt, "la reserva se libera: sus días ya no bloquean pedidos nuevos");

  // Sale del lavado: Disponible, no «Reservada» por su propio pedido ya devuelto.
  const sale = await como(MOSTRADOR, { method: "POST", url: `/api/items/${item.id}/status`, payload: { to: "DISPONIBLE" } });
  assert.equal(sale.json().status, "DISPONIBLE");
});

test("recibir como desperfecto exige observación; lavado exige lugar; nunca directo a Disponible", async () => {
  const { order, item } = await pedido({ diasAtras: 1 });
  await entregar(item.id);
  const con = (dest) => recibir(order.id, todayISO(), MOSTRADOR, { items: [{ itemId: item.id, ...dest }] });
  assert.equal((await con({ to: "NO_ALQUILABLE" })).statusCode, 400, "desperfecto sin observación");
  assert.equal((await con({ to: "EN_LAVADO", laundry: { kind: "PROPIO", place: " " } })).statusCode, 400, "lavado sin lugar");
  assert.equal((await con({ to: "DISPONIBLE" })).statusCode, 400, "no vuelve al catálogo sin lavar");
  assert.equal((await prisma.orderItem.findFirst({ where: { orderId: order.id } })).receivedAt, null, "nada quedó a medias");

  const ok = await con({ to: "NO_ALQUILABLE", note: "Cremallera rota" });
  assert.equal(ok.statusCode, 200, ok.body);
  const fila = await prisma.item.findUnique({ where: { id: item.id } });
  assert.equal(fila.status, "NO_ALQUILABLE");
  assert.equal(fila.unrentableReason, "DESPERFECTO");
});

test(`en lavado se retira desde ${LAUNDRY_READY_DAYS} días después, corrido al siguiente hábil`, () => {
  // Hora de Guayaquil (UTC−5): las 15:00 del viernes 27 son las 20:00 UTC.
  const lavado = (iso) => ({ status: "EN_LAVADO", statusSince: new Date(`${iso}T20:00:00Z`) });
  const hoy = "2026-11-20";
  assert.deepEqual(rentableFrom(lavado("2026-11-27"), new Set(), hoy), { rentable: true, from: "2026-11-30" }, "viernes → lunes");
  assert.deepEqual(rentableFrom(lavado("2026-11-30"), new Set(), hoy), { rentable: true, from: "2026-12-03" }, "lunes → jueves");
  assert.equal(rentableFrom(lavado("2026-12-22"), new Set(["2026-12-25"]), hoy).from, "2026-12-28", "el feriado lo corre");
  assert.deepEqual(rentableFrom(lavado("2026-11-02"), new Set(), hoy), { rentable: true, from: null }, "ya pasó: desde hoy");
  assert.deepEqual(rentableFrom({ status: "EN_ALQUILER" }), { rentable: false, from: null }, "fuera, no se ofrece");
  assert.deepEqual(rentableFrom({ status: "DISPONIBLE" }), { rentable: true, from: null });
});

test("el catálogo y el pedido respetan el lavado; lo que está fuera no se ofrece", async () => {
  const item = await nuevoEjemplar();
  const enCatalogo = async () => (await app.inject({ method: "GET", url: "/api/products" })).json()
    .flatMap((p) => p.items).find((i) => i.id === item.id);

  await prisma.item.update({ where: { id: item.id }, data: { status: "EN_ALQUILER" } });
  assert.equal((await enCatalogo()).available, false, "en alquiler sin reserva viva tampoco se ofrece");

  await prisma.item.update({ where: { id: item.id }, data: { status: "EN_LAVADO", statusSince: new Date(), laundryKind: "PROPIO", laundryPlace: "Local" } });
  const desde = nextBusinessDay(addDaysISO(todayISO(), LAUNDRY_READY_DAYS), await holidaySet());
  const visto = await enCatalogo();
  assert.equal(visto.available, true);
  assert.equal(visto.availableFrom, desde);

  const pedir = (start) => como(CLIENTE, {
    method: "POST",
    url: "/api/orders",
    payload: { items: [item.id], start, end: start, delivery: "pickup", ret: "store", pay: "cash" },
  });
  const pronto = await pedir(habil(0));
  assert.equal(pronto.statusCode, 409);
  assert.match(pronto.json().error, /vuelve del lavado/);
  const cotiza = await app.inject({
    method: "POST", url: "/api/quote",
    payload: { items: [item.id], start: habil(0), end: habil(0), delivery: "pickup", ret: "store" },
  });
  assert.equal(cotiza.statusCode, 409, "la cotización avisa antes de pagar");
  assert.equal((await pedir(desde)).statusCode, 201, "desde el día prometido, sí");
});

/* ---- Historial y recorrido ---- */

/** Lleva un pedido hasta el final: entregado, recibido a lavado, cobrado y con la garantía devuelta. */
async function pedidoTerminado() {
  const { order, item } = await pedido({ diasAtras: 1 });
  await entregar(item.id);
  assert.equal((await recibir(order.id, todayISO())).statusCode, 200);
  assert.equal((await como(CAJA, { method: "POST", url: `/api/orders/${order.id}/settle` })).statusCode, 200);
  const garantia = await como(CAJA, { method: "POST", url: `/api/orders/${order.id}/deposit-release` });
  assert.equal(garantia.statusCode, 200, garantia.body);
  return { order, item };
}

test("el historial trae los pedidos terminados, que ya no están en curso", async () => {
  const { order } = await pedidoTerminado();
  const enCurso = (await como(MOSTRADOR, { method: "GET", url: "/api/admin/orders" })).json();
  assert.ok(!enCurso.some((o) => o.id === order.id), "terminado: fuera de la lista en curso");

  const hist = (await como(CAJA, { method: "GET", url: "/api/admin/orders?scope=history" })).json();
  assert.equal(hist.days, 30);
  const visto = hist.orders.find((o) => o.id === order.id);
  assert.ok(visto, "aparece en el historial");
  assert.ok(visto.finishedAt);
  assert.ok(hist.orders.every((o) => o.cancelledAt || o.status !== "pending"), "solo terminados");

  const { order: vivo } = await pedido();
  const hist2 = (await como(MOSTRADOR, { method: "GET", url: "/api/admin/orders?scope=history&days=9999" })).json();
  assert.equal(hist2.days, 365, "con tope");
  assert.ok(!hist2.orders.some((o) => o.id === vivo.id), "lo que sigue en curso no es historia");
  assert.equal((await como(CLIENTE, { method: "GET", url: "/api/admin/orders?scope=history" })).statusCode, 403);
});

test("el recorrido de un pedido sigue a la prenda hasta que vuelve a Disponible", async () => {
  const { order, item } = await pedidoTerminado();
  // Salir del lavado no lleva número de pedido, pero es parte de su historia.
  assert.equal((await como(MOSTRADOR, { method: "POST", url: `/api/items/${item.id}/status`, payload: { to: "DISPONIBLE" } })).statusCode, 200);

  const res = await como(CAJA, { method: "GET", url: `/api/orders/${order.id}/timeline` });
  assert.equal(res.statusCode, 200, res.body);
  const pasos = res.json().entries.map((e) => e.action);
  assert.equal(pasos[0], "PEDIDO", "empieza con el pedido");
  const en = (a) => pasos.indexOf(a);
  for (const a of ["RECEPCION", "COBRO_CONFIRMADO", "GARANTIA_LIBERADA"]) assert.ok(en(a) > 0, `falta ${a}`);
  const recepcion = res.json().entries.find((e) => e.action === "RECEPCION");
  assert.match(recepcion.note, /lavado propio: Local/);
  const vuelta = res.json().entries.findLast((e) => e.action === "ESTADO");
  assert.match(vuelta.note, /En lavado → Disponible/);
  assert.ok(pasos.lastIndexOf("ESTADO") > en("RECEPCION"), "en orden cronológico");

  assert.equal((await como(CLIENTE, { method: "GET", url: `/api/orders/${order.id}/timeline` })).statusCode, 403);
  assert.equal((await como(INVENTARIO, { method: "GET", url: `/api/orders/${order.id}/timeline` })).statusCode, 403);
  assert.equal((await como(CAJA, { method: "GET", url: "/api/orders/99999999/timeline" })).statusCode, 404);
});
