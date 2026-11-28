/**
 * Panel, rama 4: cambio de estado en lote (todo o nada) y ficha de cliente.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import prisma from "../src/db.js";
import { grant, habil, loadHolidays, markDelivered, purge } from "./helpers/db.js";

const CLIENTE = "test-sub-lote-cliente";
const MOSTRADOR = "test-sub-lote-mostrador";
const CAJA = "test-sub-lote-caja";
const INVENTARIO = "test-sub-lote-inventario";
const SUBS = [CLIENTE, MOSTRADOR, CAJA, INVENTARIO];

let app;
const creados = [];

/** Petición firmada como `sub`. */
const como = (sub, opts) => app.inject({ ...opts, headers: { ...opts.headers, authorization: `Bearer ${sub}` } });

/** Ejemplar nuevo del primer modelo, Disponible. */
async function nuevoEjemplar() {
  const molde = await prisma.item.findFirst({ orderBy: { id: "asc" } });
  const res = await como(INVENTARIO, {
    method: "POST", url: `/api/products/${molde.productId}/items`,
    payload: { size: molde.size, sizeScale: molde.sizeScale, color: molde.color },
  });
  assert.equal(res.statusCode, 201, res.body);
  creados.push(res.json().id);
  return res.json();
}

/** Mueve varias prendas como `sub`. */
const lote = (payload, sub = MOSTRADOR) => como(sub, { method: "POST", url: "/api/items/status-batch", payload });
const LAVADO = { kind: "EXTERNO", place: "Lavandería Sol" };

before(async () => {
  await loadHolidays();
  app = buildApp({ verifyGoogleToken: async (t) => ({ sub: t, email: `${t}@test`, name: t }) });
  await app.ready();
});

beforeEach(async () => {
  await purge({ subs: SUBS, itemIds: creados.splice(0) });
  await grant(MOSTRADOR, ["MOSTRADOR"]);
  await grant(CAJA, ["CAJA"]);
  await grant(INVENTARIO, ["INVENTARIO"]);
});

after(async () => {
  await purge({ subs: SUBS, itemIds: creados });
  await app.close();
  await prisma.$disconnect();
});

test("en lote: varias a lavado y de vuelta, cada una con su bitácora", async () => {
  const [a, b] = [await nuevoEjemplar(), await nuevoEjemplar()];
  assert.equal((await lote({ ids: [a.id, b.id], to: "EN_LAVADO", laundry: LAVADO }, CAJA)).statusCode, 403);
  const ida = await lote({ ids: [a.id, b.id], to: "EN_LAVADO", laundry: LAVADO });
  assert.equal(ida.statusCode, 200, ida.body);
  assert.deepEqual(ida.json().items.map((i) => i.status), ["EN_LAVADO", "EN_LAVADO"]);
  const vuelta = await lote({ ids: [a.id, b.id], to: "DISPONIBLE", note: "Salieron del lavado" });
  assert.equal(vuelta.statusCode, 200, vuelta.body);
  for (const it of [a, b]) {
    assert.equal(await prisma.itemLog.count({ where: { itemId: it.id, from: { not: null } } }), 2, "ida y vuelta en su bitácora");
  }
});

test("en lote es todo o nada: si una no puede, no se mueve ninguna y se dice cuál", async () => {
  const [a, b] = [await nuevoEjemplar(), await nuevoEjemplar()];
  await lote({ ids: [a.id], to: "EN_LAVADO", laundry: LAVADO });
  // b sigue Disponible: «Disponible → Disponible» no es un cambio válido.
  const res = await lote({ ids: [a.id, b.id], to: "DISPONIBLE" });
  assert.equal(res.statusCode, 409);
  assert.match(res.json().error, /No se movió ninguna/);
  assert.equal((await prisma.item.findUnique({ where: { id: a.id } })).status, "EN_LAVADO", "a no salió del lavado");
  assert.equal((await lote({ ids: [], to: "DISPONIBLE" })).statusCode, 400);
  assert.equal((await lote({ ids: [a.id, a.id], to: "DISPONIBLE" })).statusCode, 400, "sin repetir");
});

test("la ficha del cliente: pedidos, lo que debe y su garantía", async () => {
  const item = await nuevoEjemplar();
  const pedido = (await como(CLIENTE, {
    method: "POST", url: "/api/orders",
    payload: { items: [item.id], start: habil(0), end: habil(0), delivery: "pickup", ret: "store", pay: "cash" },
  })).json();
  await markDelivered(pedido.id);
  const panel = (await como(MOSTRADOR, { method: "GET", url: "/api/admin/orders" })).json().find((o) => o.id === pedido.id);
  const userId = panel.customer.id;
  assert.ok(userId, "el panel sabe quién es el cliente");

  const res = await como(CAJA, { method: "GET", url: `/api/admin/customers/${userId}` });
  assert.equal(res.statusCode, 200, res.body);
  const f = res.json();
  assert.equal(f.customer.email, `${CLIENTE}@test`);
  assert.equal(f.summary.orders, 1);
  assert.ok(f.summary.owedCents > 0, "en efectivo, debe el pedido");
  assert.ok(f.summary.depositHeldCents > 0);
  assert.equal(f.summary.lateReturns, 0);
  assert.deepEqual(f.orders.map((o) => o.id), [pedido.id]);
  assert.equal((await como(CLIENTE, { method: "GET", url: `/api/admin/customers/${userId}` })).statusCode, 403);
  assert.equal((await como(INVENTARIO, { method: "GET", url: `/api/admin/customers/${userId}` })).statusCode, 403);
  assert.equal((await como(CAJA, { method: "GET", url: "/api/admin/customers/99999999" })).statusCode, 404);
});
