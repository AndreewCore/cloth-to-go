/**
 * Pruebas de la fase 2: modelo y ejemplar, estados, código de inventario,
 * capacidades, bitácoras, taxonomía y ajuste de precio.
 *
 * El criterio de «hecho» de la fase está en las dos primeras secciones: dos
 * pedidos que se solapan sobre el mismo ejemplar se rechazan EN LA BASE (no
 * solo en el código), y la taxonomía sale de la API.
 *
 * Asume la base migrada y sembrada, como el resto de la suite.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import prisma from "../src/db.js";
import { todayISO } from "../src/dates.js";
import { isoToDate } from "../src/catalog.js";
import { planTransition } from "../src/items.js";
import { parseCapabilities, setCapabilities } from "../src/staff.js";
import { cycleCost, depositFor, rentalPrice, validatePriceOverride } from "../src/pricing.js";
import { demoItems, grant, purge } from "./helpers/db.js";

const CLIENTE = "test-sub-fase2-cliente";
const OTRO = "test-sub-fase2-otro";
const ADMIN = "test-sub-fase2-admin";
const CAJA = "test-sub-fase2-caja";
const MOSTRADOR = "test-sub-fase2-mostrador";
const INVENTARIO = "test-sub-fase2-inventario";
const SUBS = [CLIENTE, OTRO, ADMIN, CAJA, MOSTRADOR, INVENTARIO];

let app;
let prendas;
/** Ejemplares creados por las pruebas (con código): se borran al limpiar. */
let creados = [];

/**
 * Día `YYYY-MM-DD` desplazado `dias` desde hoy, en hora de Guayaquil.
 * @param {number} dias Días a sumar.
 * @returns {string}
 */
function fecha(dias) {
  return todayISO(Date.now() + dias * 86400000);
}

/**
 * Petición firmada como uno de los subs de prueba (el token falso ES el sub).
 * @param {string} sub Identidad.
 * @param {object} opts Opciones de `app.inject()`.
 * @returns {Promise<object>} Respuesta.
 */
function como(sub, opts) {
  return app.inject({ ...opts, headers: { ...opts.headers, authorization: `Bearer ${sub}` } });
}

/**
 * Pide un pedido por la API y devuelve la respuesta sin comprobarla.
 * @param {object} over Campos a pisar.
 * @param {string} [sub=CLIENTE] Quién lo pide.
 * @returns {Promise<object>}
 */
function pedir(over, sub = CLIENTE) {
  return como(sub, {
    method: "POST",
    url: "/api/orders",
    payload: { delivery: "pickup", ret: "store", pay: "cash", ...over },
  });
}

/**
 * Da de alta un ejemplar nuevo desde Inventario y lo apunta para borrarlo.
 * @param {number} productId Modelo.
 * @param {object} [body] Talla, color…
 * @returns {Promise<object>} Respuesta de inject.
 */
async function altaEjemplar(productId, body = { size: "M", color: "negro" }) {
  const res = await como(INVENTARIO, { method: "POST", url: `/api/products/${productId}/items`, payload: body });
  if (res.statusCode === 201) creados.push(res.json().id);
  return res;
}

/**
 * Cambia el estado de un ejemplar como un sub dado.
 * @param {string} sub Quién.
 * @param {number} itemId Ejemplar.
 * @param {object} payload `to`, `note`, `reason`, `laundry`.
 * @returns {Promise<object>} Respuesta de inject.
 */
function mover(sub, itemId, payload) {
  return como(sub, { method: "POST", url: `/api/items/${itemId}/status`, payload });
}

/** Deja la base como estaba: cuentas, pedidos, bitácoras, ejemplares y precios. */
async function limpiar() {
  await purge({ subs: SUBS, itemIds: creados });
  creados = [];
  await prisma.product.update({ where: { id: prendas[3].productId }, data: { priceOverride: null, depositOverride: null } });
  await grant(ADMIN, ["ADMINISTRACION"]);
  await grant(CAJA, ["CAJA"]);
  await grant(MOSTRADOR, ["MOSTRADOR"]);
  await grant(INVENTARIO, ["INVENTARIO"]);
}

before(async () => {
  app = buildApp({ verifyGoogleToken: async (t) => ({ sub: t, email: `${t}@test`, name: t }) });
  await app.ready();
  prendas = await demoItems(app);
  assert.ok(prendas.length >= 6, "la base de pruebas necesita el catálogo sembrado");
});

beforeEach(limpiar);

after(async () => {
  await purge({ subs: SUBS, itemIds: creados });
  await prisma.product.update({ where: { id: prendas[3].productId }, data: { priceOverride: null, depositOverride: null } });
  await app.close();
  await prisma.$disconnect();
});

/* ---- Hecho cuando (1): el solape se rechaza en el servidor ---- */

test("dos pedidos que se solapan sobre el mismo ejemplar: el segundo se rechaza", async () => {
  const item = prendas[3].id;
  const primero = await pedir({ items: [item], start: fecha(2), end: fecha(5) });
  assert.equal(primero.statusCode, 201, primero.body);

  const solapado = await pedir({ items: [item], start: fecha(4), end: fecha(8) }, OTRO);
  assert.equal(solapado.statusCode, 409);
  assert.match(solapado.json().error, /reservada para esas fechas/);
});

test("fechas que no se tocan sobre el mismo ejemplar se aceptan las dos", async () => {
  const item = prendas[3].id;
  assert.equal((await pedir({ items: [item], start: fecha(2), end: fecha(4) })).statusCode, 201);
  assert.equal((await pedir({ items: [item], start: fecha(10), end: fecha(12) }, OTRO)).statusCode, 201);
});

test("el día de devolución está ocupado: el siguiente alquiler empieza al día siguiente", async () => {
  const item = prendas[3].id;
  assert.equal((await pedir({ items: [item], start: fecha(2), end: fecha(4) })).statusCode, 201);
  assert.equal((await pedir({ items: [item], start: fecha(4), end: fecha(6) }, OTRO)).statusCode, 409);
  assert.equal((await pedir({ items: [item], start: fecha(5), end: fecha(6) }, OTRO)).statusCode, 201);
});

test("dos checkouts simultáneos sobre el mismo ejemplar: uno entra y el otro no", async () => {
  const item = prendas[4].id;
  const res = await Promise.all([
    pedir({ items: [item], start: fecha(3), end: fecha(6) }),
    pedir({ items: [item], start: fecha(5), end: fecha(9) }, OTRO),
  ]);
  const codigos = res.map((r) => r.statusCode).sort();
  assert.deepEqual(codigos, [201, 409], res.map((r) => r.body).join(" | "));
});

test("la base rechaza el solape aunque nadie pase por la API", async () => {
  // La comprobación del código es solo la amable; esta es la defensa.
  const item = prendas[4].id;
  const creado = await pedir({ items: [item], start: fecha(3), end: fecha(6) });
  assert.equal(creado.statusCode, 201);
  const user = await prisma.user.findUnique({ where: { googleSub: CLIENTE } });
  await assert.rejects(
    prisma.order.create({
      data: {
        userId: user.id, start: fecha(6), end: fecha(7), delivery: "pickup", ret: "store", pay: "cash",
        items: { create: { itemId: item, start: isoToDate(fecha(6)), end: isoToDate(fecha(7)) } },
      },
    }),
    /order_items_sin_solape|exclusion/,
  );
});

test("anular libera la reserva: las mismas fechas vuelven a poder pedirse", async () => {
  const item = prendas[5].id;
  const p = (await pedir({ items: [item], start: fecha(2), end: fecha(4) })).json();
  await como(CLIENTE, { method: "POST", url: `/api/orders/${p.id}/cancel` });
  assert.equal((await pedir({ items: [item], start: fecha(2), end: fecha(4) }, OTRO)).statusCode, 201);
});

/* ---- Hecho cuando (2): la taxonomía sale de la API ---- */

test("GET /api/taxonomy devuelve todas las listas, ordenadas", async () => {
  const res = await app.inject({ method: "GET", url: "/api/taxonomy" });
  assert.equal(res.statusCode, 200);
  const t = res.json();
  for (const k of ["categories", "colors", "materials", "sizes", "occasions", "seasons", "audiences", "conditions"]) {
    assert.ok(Array.isArray(t[k]) && t[k].length > 0, `falta la lista ${k}`);
  }
  assert.deepEqual(t.categories.map((c) => c.prefix), ["FOR", "FIE", "CAS", "INV", "DIS", "CAL"]);
  assert.ok(t.colors.every((c) => /^#[0-9a-f]{6}$/.test(c.hex)));
  assert.ok(t.sizes.some((s) => s.scale === "CALZADO" && s.label === "39"));
  // El coste de lavado es interno: no viaja al cliente.
  assert.ok(t.materials.every((m) => !("laundryCents" in m)));
});

test("cada prenda del catálogo usa claves que existen en la taxonomía", async () => {
  const t = (await app.inject({ method: "GET", url: "/api/taxonomy" })).json();
  const cats = new Set(t.categories.map((c) => c.name));
  const colores = new Set(t.colors.map((c) => c.key));
  const materiales = new Set(t.materials.map((m) => m.key));
  for (const p of prendas) {
    assert.ok(cats.has(p.cat), p.cat);
    assert.ok(materiales.has(p.material), p.material);
    for (const i of p.items) assert.ok(colores.has(i.color), i.color);
  }
});

/* ---- El catálogo habla en modelos ---- */

test("el cliente ve Disponible o No Disponible, nunca el estado interno ni el código", async () => {
  const item = prendas[3].id;
  await pedir({ items: [item], start: fecha(1), end: fecha(3) });
  const p = (await demoItems(app)).find((x) => x.id === item);
  assert.equal(p.items[0].available, false);
  assert.equal(p.disponibles, 0);
  for (const i of p.items) {
    assert.ok(!("status" in i) && !("code" in i), "se filtró un dato interno del ejemplar");
  }
  assert.equal(p.official, true);
  assert.equal(p.owner.kind, "OFICIAL");
});

test("un modelo con varios ejemplares los enseña todos, cada uno con su talla y color", async () => {
  const modelo = prendas[0].productId;
  await altaEjemplar(modelo, { size: "L", color: "azul" });
  const p = (await demoItems(app)).find((x) => x.productId === modelo);
  assert.equal(p.items.length, 2);
  assert.equal(p.disponibles, 2);
  assert.ok(p.items.some((i) => i.size === "L" && i.color === "azul"));
});

/* ---- Estados del ejemplar ---- */

test("un pedido deja el ejemplar Reservado y anularlo lo devuelve a Disponible, con bitácora", async () => {
  const item = prendas[3].id;
  const p = (await pedir({ items: [item], start: fecha(2), end: fecha(4) })).json();
  assert.equal((await prisma.item.findUnique({ where: { id: item } })).status, "RESERVADA");

  await como(CLIENTE, { method: "POST", url: `/api/orders/${p.id}/cancel` });
  assert.equal((await prisma.item.findUnique({ where: { id: item } })).status, "DISPONIBLE");

  const log = await prisma.itemLog.findMany({ where: { itemId: item, orderId: p.id }, orderBy: { id: "asc" } });
  assert.deepEqual(log.map((l) => [l.from, l.to, l.actorId]), [
    ["DISPONIBLE", "RESERVADA", null],
    ["RESERVADA", "DISPONIBLE", null],
  ]);
});

test("anular un pedido no libera el ejemplar si otro pedido lo espera", async () => {
  const item = prendas[3].id;
  const a = (await pedir({ items: [item], start: fecha(2), end: fecha(3) })).json();
  await pedir({ items: [item], start: fecha(6), end: fecha(7) }, OTRO);
  await como(CLIENTE, { method: "POST", url: `/api/orders/${a.id}/cancel` });
  assert.equal((await prisma.item.findUnique({ where: { id: item } })).status, "RESERVADA");
});

test("En Lavado exige quién lava y dónde, y queda en la bitácora", async () => {
  const item = (await altaEjemplar(prendas[0].productId)).json().id;
  const sinDatos = await mover(MOSTRADOR, item, { to: "EN_LAVADO" });
  assert.equal(sinDatos.statusCode, 400);

  const ok = await mover(MOSTRADOR, item, { to: "EN_LAVADO", laundry: { kind: "EXTERNO", place: "Lavandería Sur" } });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().laundryPlace, "Lavandería Sur");

  const ultimo = await prisma.itemLog.findFirst({ where: { itemId: item }, orderBy: { id: "desc" } });
  assert.equal(ultimo.laundryKind, "EXTERNO");
  assert.equal(ultimo.from, "DISPONIBLE");

  const vuelta = await mover(MOSTRADOR, item, { to: "DISPONIBLE" });
  assert.equal(vuelta.json().laundryKind, null, "el lavado se describe solo mientras dura");
});

test("Disponible otra vez con un alquiler esperando queda Reservada", async () => {
  const item = (await altaEjemplar(prendas[0].productId)).json().id;
  await mover(MOSTRADOR, item, { to: "EN_LAVADO", laundry: { kind: "PROPIO", place: "Local CTG" } });
  assert.equal((await pedir({ items: [item], start: fecha(3), end: fecha(5) })).statusCode, 201);
  const res = await mover(MOSTRADOR, item, { to: "DISPONIBLE" });
  assert.equal(res.json().status, "RESERVADA");
});

test("una reserva que ya empezó también espera: la prenda devuelta tarde queda Reservada", async () => {
  // El cliente anterior devolvió tarde y el siguiente alquiler empezó ayer sin
  // la prenda. Sigue esperándola, así que no puede volver como Disponible.
  const item = (await altaEjemplar(prendas[0].productId)).json().id;
  await mover(MOSTRADOR, item, { to: "EN_LAVADO", laundry: { kind: "PROPIO", place: "Local CTG" } });
  const pedido = await pedir({ items: [item], start: fecha(0), end: fecha(2) });
  assert.equal(pedido.statusCode, 201);
  // La API no acepta inicios en el pasado: se adelanta la reserva a mano.
  await prisma.orderItem.updateMany({ where: { orderId: pedido.json().id }, data: { start: isoToDate(fecha(-1)) } });
  const res = await mover(MOSTRADOR, item, { to: "DISPONIBLE" });
  assert.equal(res.json().status, "RESERVADA");
});

test("perdida y retirada son de Administración; el mostrador anota desperfectos", async () => {
  const item = (await altaEjemplar(prendas[0].productId)).json().id;
  assert.equal((await mover(MOSTRADOR, item, { to: "PERDIDA", note: "no aparece" })).statusCode, 403);
  assert.equal(
    (await mover(MOSTRADOR, item, { to: "NO_ALQUILABLE", reason: "RETIRADA", note: "vieja" })).statusCode,
    403,
  );
  assert.equal((await mover(MOSTRADOR, item, { to: "NO_ALQUILABLE", reason: "DESPERFECTO" })).statusCode, 400,
    "un desperfecto sin observación no explica nada");
  assert.equal(
    (await mover(MOSTRADOR, item, { to: "NO_ALQUILABLE", reason: "DESPERFECTO", note: "cierre roto" })).statusCode,
    200,
  );
  assert.equal((await mover(ADMIN, item, { to: "PERDIDA", note: "no apareció tras revisar" })).statusCode, 200);
  assert.equal((await mover(ADMIN, item, { to: "DISPONIBLE" })).statusCode, 409, "perdida es final");
});

test("un ejemplar no alquilable no se puede pedir, y uno retirado sale del catálogo", async () => {
  const item = (await altaEjemplar(prendas[0].productId)).json().id;
  await mover(ADMIN, item, { to: "NO_ALQUILABLE", reason: "RETIRADA", note: "fin de su vida útil" });
  const res = await pedir({ items: [item], start: fecha(2), end: fecha(3) });
  assert.equal(res.statusCode, 409);
  const p = (await demoItems(app)).find((x) => x.productId === prendas[0].productId);
  assert.ok(!p.items.some((i) => i.id === item));
});

test("la tabla de transiciones: Reservada no se pone a mano", () => {
  const admin = { capabilities: ["ADMINISTRACION"] };
  assert.equal(planTransition({ status: "DISPONIBLE" }, { to: "RESERVADA" }, admin).status, 409);
  assert.equal(planTransition({ status: "DISPONIBLE" }, { to: "INVENTADO" }, admin).status, 400);
  assert.ok(planTransition({ status: "RESERVADA" }, { to: "EN_ALQUILER" }, admin).data);
});

test("la base rechaza En Lavado sin lavado descrito aunque nadie pase por la API", async () => {
  const item = (await altaEjemplar(prendas[0].productId)).json().id;
  await assert.rejects(prisma.item.update({ where: { id: item }, data: { status: "EN_LAVADO" } }));
});

/* ---- Código de inventario ---- */

test("el alta de un ejemplar le da un código CAT-AA-NNNN correlativo", async () => {
  const aa = todayISO().slice(2, 4);
  const formal = prendas.find((p) => p.cat === "Formal").productId;
  const a = (await altaEjemplar(formal)).json();
  const b = (await altaEjemplar(formal)).json();
  assert.match(a.code, new RegExp(`^FOR-${aa}-\\d{4}$`));
  assert.equal(Number(b.code.slice(-4)), Number(a.code.slice(-4)) + 1);

  const calzado = prendas.find((p) => p.cat === "Calzado").productId;
  const c = (await altaEjemplar(calzado, { size: "40", color: "negro" })).json();
  assert.match(c.code, new RegExp(`^CAL-${aa}-\\d{4}$`));
  assert.equal(c.sizeScale, "CALZADO");
});

test("altas simultáneas no repiten código", async () => {
  const formal = prendas.find((p) => p.cat === "Formal").productId;
  const res = await Promise.all(Array.from({ length: 5 }, () => altaEjemplar(formal)));
  const codigos = res.map((r) => r.json().code);
  assert.equal(new Set(codigos).size, 5, codigos.join(", "));
});

test("solo Inventario da de alta, y con talla y color de la taxonomía", async () => {
  const modelo = prendas[0].productId;
  const cliente = await como(CLIENTE, { method: "POST", url: `/api/products/${modelo}/items`, payload: { size: "M", color: "negro" } });
  assert.equal(cliente.statusCode, 403);
  const mostrador = await como(MOSTRADOR, { method: "POST", url: `/api/products/${modelo}/items`, payload: { size: "M", color: "negro" } });
  assert.equal(mostrador.statusCode, 403);
  assert.equal((await altaEjemplar(modelo, { size: "M", color: "azul marino" })).statusCode, 400);
  assert.equal((await altaEjemplar(modelo, { size: "XXXL", color: "negro" })).statusCode, 400);
  assert.equal((await altaEjemplar(999999, { size: "M", color: "negro" })).statusCode, 404);
  assert.equal(
    (await altaEjemplar(modelo, { size: "M", color: "negro", measurements: { pecho: "mucho" } })).statusCode,
    400,
  );
});

/* ---- Capacidades ---- */

test("Caja confirma cobros; Mostrador no", async () => {
  const p = (await pedir({ items: [prendas[3].id], start: fecha(2), end: fecha(3) })).json();
  assert.equal((await como(MOSTRADOR, { method: "POST", url: `/api/orders/${p.id}/settle` })).statusCode, 403);
  assert.equal((await como(CAJA, { method: "POST", url: `/api/orders/${p.id}/settle` })).statusCode, 200);
});

test("anular un pedido ajeno es de Administración, no de Caja", async () => {
  const p = (await pedir({ items: [prendas[3].id], start: fecha(2), end: fecha(3) })).json();
  assert.equal((await como(CAJA, { method: "POST", url: `/api/orders/${p.id}/cancel` })).statusCode, 404);
  assert.equal((await como(ADMIN, { method: "POST", url: `/api/orders/${p.id}/cancel` })).statusCode, 200);
});

test("una cuenta del personal no alquila", async () => {
  const res = await pedir({ items: [prendas[3].id], start: fecha(2), end: fecha(3) }, CAJA);
  assert.equal(res.statusCode, 403);
});

test("quitar una capacidad surte efecto en la siguiente petición, sin reiniciar", async () => {
  const p = (await pedir({ items: [prendas[3].id], start: fecha(2), end: fecha(3) })).json();
  await grant(CAJA, []);
  assert.equal((await como(CAJA, { method: "POST", url: `/api/orders/${p.id}/settle` })).statusCode, 403);
});

test("parseCapabilities entiende plantillas, listas y rechaza lo inventado", () => {
  assert.deepEqual(parseCapabilities("admin"), ["ADMINISTRACION"]);
  assert.deepEqual(parseCapabilities("trabajador"), ["MOSTRADOR", "CAJA"]);
  assert.deepEqual(parseCapabilities("ninguna"), []);
  assert.deepEqual(parseCapabilities("mostrador, inventario,MOSTRADOR"), ["MOSTRADOR", "INVENTARIO"]);
  assert.throws(() => parseCapabilities("JEFE"), /desconocida/);
});

test("staff:grant anota el alta en la bitácora y no convierte a un cliente con pedidos", async () => {
  await pedir({ items: [prendas[3].id], start: fecha(2), end: fecha(3) });
  await assert.rejects(
    setCapabilities(prisma, { who: `${CLIENTE}@test`, capabilities: ["MOSTRADOR"] }),
    /un cliente no puede ser trabajador/,
  );

  await como(OTRO, { method: "GET", url: "/api/orders" }); // crea la cuenta
  const { user } = await setCapabilities(prisma, { who: `${OTRO}@TEST`, capabilities: ["MOSTRADOR", "CAJA"] });
  assert.deepEqual(user.capabilities, ["MOSTRADOR", "CAJA"]);
  const entrada = await prisma.financeLog.findFirst({ where: { subjectUserId: user.id, kind: "CAPACIDADES" } });
  assert.match(entrada.note, /ninguna → MOSTRADOR, CAJA/);

  await assert.rejects(setCapabilities(prisma, { who: "nadie@test", capabilities: [] }), /No hay ninguna cuenta/);
});

/* ---- Bitácoras ---- */

test("cobrar y anular escriben en la bitácora financiera, que el cliente no puede leer", async () => {
  const p = (await pedir({ items: [prendas[3].id], start: fecha(2), end: fecha(3) })).json();
  await como(CAJA, { method: "POST", url: `/api/orders/${p.id}/settle` });
  await como(ADMIN, { method: "POST", url: `/api/orders/${p.id}/cancel` });

  const res = await como(CAJA, { method: "GET", url: `/api/orders/${p.id}/finance-log` });
  assert.equal(res.statusCode, 200);
  const caja = await prisma.user.findUnique({ where: { googleSub: CAJA } });
  assert.deepEqual(res.json().map((e) => e.kind), ["COBRO_CONFIRMADO", "ANULACION"]);
  assert.equal(res.json()[0].actorId, caja.id);
  assert.equal(res.json()[0].amountCents, p.totalCents);

  assert.equal((await como(CLIENTE, { method: "GET", url: `/api/orders/${p.id}/finance-log` })).statusCode, 403);
});

test("las dos bitácoras son de solo añadir: la base no deja editar ni borrar", async () => {
  const p = (await pedir({ items: [prendas[3].id], start: fecha(2), end: fecha(3) })).json();
  await como(CAJA, { method: "POST", url: `/api/orders/${p.id}/settle` });
  const deItem = await prisma.itemLog.findFirst({ where: { orderId: p.id } });
  const financiera = await prisma.financeLog.findFirst({ where: { orderId: p.id } });

  await assert.rejects(prisma.itemLog.update({ where: { id: deItem.id }, data: { note: "retocada" } }), /solo añadir/);
  await assert.rejects(prisma.itemLog.delete({ where: { id: deItem.id } }), /solo añadir/);
  await assert.rejects(prisma.financeLog.update({ where: { id: financiera.id }, data: { amountCents: 0 } }), /solo añadir/);
  await assert.rejects(prisma.financeLog.delete({ where: { id: financiera.id } }), /solo añadir/);
});

/* ---- Precio: ajuste manual con suelo y garantía fija ---- */

test("el ajuste manual no baja del coste por ciclo y se cobra en el pedido", async () => {
  const prenda = prendas[3];
  const url = `/api/products/${prenda.productId}/pricing`;
  assert.equal((await como(CAJA, { method: "PATCH", url, payload: { priceOverride: 50 } })).statusCode, 403);
  assert.equal((await como(ADMIN, { method: "PATCH", url, payload: { priceOverride: 0.5 } })).statusCode, 400);

  const ok = await como(ADMIN, { method: "PATCH", url, payload: { priceOverride: 20, depositOverride: 7 } });
  assert.equal(ok.statusCode, 200, ok.body);

  const p = (await pedir({ items: [prenda.id], start: fecha(2), end: fecha(2) })).json();
  const alquiler = p.charges.find((c) => c.type === "RENTAL");
  const deposito = p.charges.find((c) => c.type === "DEPOSIT_HOLD");
  assert.equal(alquiler.amountCents, 2000);
  assert.equal(deposito.amountCents, 700);
});

test("pricing.js: el lavado de la base, el ajuste y la garantía fija", () => {
  const base = { value: 40, stars: 4, material: "lana" };
  assert.equal(cycleCost({ ...base, laundryCost: 1 }), cycleCost(base) - 4, "lana: 5 de la constante → 1 de la tabla");
  assert.equal(rentalPrice({ ...base, priceOverride: 10 }, 1), 10);
  // Un ajuste por debajo del suelo nunca se cobra por debajo de él.
  assert.ok(rentalPrice({ ...base, priceOverride: 0.01 }, 1) >= cycleCost(base));
  assert.equal(depositFor({ ...base, depositOverride: 60 }), 60, "la garantía fija no lleva el tope por prenda");
  assert.equal(validatePriceOverride(base, null), null);
  assert.match(validatePriceOverride(base, -3), /positivo/);
  assert.match(validatePriceOverride(base, cycleCost(base) - 0.01), /coste por ciclo/);
});
