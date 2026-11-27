/**
 * Retención de garantía (§6.2): la tabla, el libro de cargos y la ruta.
 *
 * Lo que más se vigila: que la garantía se cierre entera y lo retenido cuente
 * como ingreso (no como garantía), que los casos se sumen con techo de 100 %,
 * que Caja no salga de la tabla y que anular lo deshaga todo.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import prisma from "../src/db.js";
import { RETENTION_CASES, retainedCents, retentionPercent } from "../src/retention.js";
import { cancellationCharges, heldDepositCents, retentionCharges, revenueCents } from "../src/ledger.js";
import { grant, habil, loadHolidays, markDelivered, purge } from "./helpers/db.js";

const CLIENTE = "test-sub-ret-cliente";
const CAJA = "test-sub-ret-caja";
const ADMIN = "test-sub-ret-admin";
const INVENTARIO = "test-sub-ret-inventario";
const SUBS = [CLIENTE, CAJA, ADMIN, INVENTARIO];

let app;
const creados = [];

/** Petición firmada como `sub`. */
const como = (sub, opts) => app.inject({ ...opts, headers: { ...opts.headers, authorization: `Bearer ${sub}` } });

/**
 * Pedido en efectivo de un ejemplar nuevo, entregado, recibido y cobrado:
 * listo para decidir la garantía.
 */
async function listoParaGarantia({ cobrar = true } = {}) {
  const molde = await prisma.item.findFirst({ orderBy: { id: "asc" } });
  const item = (await como(INVENTARIO, {
    method: "POST", url: `/api/products/${molde.productId}/items`,
    payload: { size: molde.size, sizeScale: molde.sizeScale, color: molde.color },
  })).json();
  creados.push(item.id);
  const order = (await como(CLIENTE, {
    method: "POST", url: "/api/orders",
    payload: { items: [item.id], start: habil(0), end: habil(0), delivery: "pickup", ret: "store", pay: "cash" },
  })).json();
  await markDelivered(order.id);
  await prisma.orderItem.updateMany({ where: { orderId: order.id }, data: { receivedAt: new Date(), releasedAt: new Date() } });
  if (cobrar) assert.equal((await como(CAJA, { method: "POST", url: `/api/orders/${order.id}/settle` })).statusCode, 200);
  return order;
}

/** Devuelve la garantía de un pedido como `sub`. */
const devolver = (orderId, payload, sub = CAJA) =>
  como(sub, { method: "POST", url: `/api/orders/${orderId}/deposit-release`, payload });

before(async () => {
  await loadHolidays();
  app = buildApp({ verifyGoogleToken: async (t) => ({ sub: t, email: `${t}@test`, name: t }) });
  await app.ready();
});

beforeEach(async () => {
  await purge({ subs: SUBS, itemIds: creados.splice(0) });
  await grant(CAJA, ["CAJA"]);
  await grant(ADMIN, ["ADMINISTRACION"]);
  await grant(INVENTARIO, ["INVENTARIO"]);
});

after(async () => {
  await purge({ subs: SUBS, itemIds: creados });
  await app.close();
  await prisma.$disconnect();
});

/* ---- La tabla y el libro, puros ---- */

test("los casos se suman con techo de 100 %", () => {
  assert.equal(retentionPercent([]), 0);
  assert.equal(retentionPercent(["MANCHA_ESPECIAL"]), 25);
  assert.equal(retentionPercent(["MANCHA_ESPECIAL", "DESPERFECTO_MAYOR"]), 75);
  assert.equal(retentionPercent(["IRREPARABLE", "INCOMPLETA"]), 100, "nunca más que la garantía");
  assert.throws(() => retentionPercent(["MANCHA_ESPECIAL", "MANCHA_ESPECIAL"]));
  assert.throws(() => retentionPercent(["ATRASO"]), /desconocido/, "el atraso se cobra en días extra, no aquí");
  assert.equal(retainedCents(4001, 25), 1000, "el medio centavo va a favor del cliente");
  assert.equal(Object.keys(RETENTION_CASES).length, 5);
});

test("retener cierra la garantía entera y lo retenido es ingreso; anular lo deshace", () => {
  const base = [
    { type: "RENTAL", amountCents: 1500, status: "SETTLED", method: "CASH" },
    { type: "DEPOSIT_HOLD", amountCents: 4000, status: "SETTLED", method: "CASH" },
  ];
  const lineas = retentionCharges(base, { retainedCents: 1000, note: "Cremallera rota" });
  const todas = [...base, ...lineas];
  assert.equal(heldDepositCents(todas), 0, "la custodia se cierra");
  assert.equal(revenueCents(todas), 2500, "alquiler más lo retenido");
  assert.equal(lineas.find((l) => l.type === "RETENTION").amountCents, 1000);
  const anulado = [...todas, ...cancellationCharges(todas)];
  assert.equal(heldDepositCents(anulado), 0);
  assert.equal(revenueCents(anulado), 0, "anular revierte también lo retenido");
});

/* ---- La ruta ---- */

test("devolver entera sigue igual y avisa al cliente", async () => {
  const order = await listoParaGarantia();
  const res = await devolver(order.id, {});
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().deposit.retainedCents, 0);
  assert.equal(res.json().depositHeldCents, 0);
  const aviso = await prisma.notice.findFirst({ where: { orderId: order.id, kind: "GARANTIA" } });
  assert.match(aviso.body, /completa/);
});

test("Caja retiene dentro de la tabla, con observación, y el cliente ve por qué", async () => {
  const order = await listoParaGarantia();
  assert.equal((await devolver(order.id, { cases: ["DESPERFECTO_MAYOR"] })).statusCode, 400, "sin observación no");
  assert.equal((await devolver(order.id, { cases: ["INVENTADO"], note: "x" })).statusCode, 400);
  assert.equal((await devolver(order.id, { percent: 30, note: "x" })).statusCode, 403, "fuera de la tabla, solo Administración");

  const res = await devolver(order.id, { cases: ["DESPERFECTO_MAYOR", "INCOMPLETA"], note: "Falta el cinturón y la cremallera no cierra" });
  assert.equal(res.statusCode, 200, res.body);
  const d = res.json().deposit;
  assert.equal(d.percent, 75);
  assert.equal(d.retainedCents, Math.floor((d.heldCents * 75) / 100));
  assert.equal(d.refundedCents + d.retainedCents, d.heldCents);
  assert.equal(res.json().depositHeldCents, 0);
  assert.equal(res.json().revenueCents - order.revenueCents, d.retainedCents, "lo retenido es ingreso");

  assert.ok(await prisma.financeLog.findFirst({ where: { orderId: order.id, kind: "RETENCION", amountCents: d.retainedCents } }));
  const aviso = await prisma.notice.findFirst({ where: { orderId: order.id, kind: "GARANTIA" } });
  assert.match(aviso.body, /cinturón/);
  assert.match(aviso.body, /Desperfecto mayor reparable/);
  assert.equal((await devolver(order.id, {})).statusCode, 409, "ya no queda garantía");
});

test("Administración puede salirse de la tabla; nadie retiene antes de cobrar", async () => {
  const sinCobrar = await listoParaGarantia({ cobrar: false });
  assert.equal((await devolver(sinCobrar.id, { cases: ["MANCHA_ESPECIAL"], note: "x" })).statusCode, 409);

  const order = await listoParaGarantia();
  assert.equal((await devolver(order.id, { percent: 130, note: "x" }, ADMIN)).statusCode, 400);
  assert.equal((await devolver(order.id, { cases: ["MANCHA_ESPECIAL"], percent: 10, note: "x" }, ADMIN)).statusCode, 400);
  const res = await devolver(order.id, { percent: 10, note: "Acordado con la clienta" }, ADMIN);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().deposit.percent, 10);
});
