/**
 * Precio desde el panel (fase 4): ver de dónde sale, previsualizar un ajuste
 * sin guardarlo, ajustarlo con el suelo de siempre y dejar constancia de quién
 * lo cambió y por qué. Cada prueba usa un modelo propio.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import prisma from "../src/db.js";
import { grant, purge } from "./helpers/db.js";

const INVENTARIO = "test-sub-precio-inventario";
const ADMIN = "test-sub-precio-admin";
const MOSTRADOR = "test-sub-precio-mostrador";
const SUBS = [INVENTARIO, ADMIN, MOSTRADOR];

let app;
const modelos = [];

/** Petición firmada como `sub` (el verificador falso usa el token como identidad). */
function como(sub, opts) {
  return app.inject({ ...opts, headers: { ...opts.headers, authorization: `Bearer ${sub}` } });
}

/** Crea un modelo de $40, 3 estrellas, de algodón. */
async function nuevoModelo() {
  const res = await como(INVENTARIO, {
    method: "POST",
    url: "/api/products",
    payload: { name: "Camisa de prueba de precio", categoryKey: "casual", material: "algodon", value: 40, stars: 3, weightKg: 0.3 },
  });
  assert.equal(res.statusCode, 201, res.body);
  modelos.push(res.json().id);
  return res.json();
}

before(async () => {
  app = buildApp({ verifyGoogleToken: async (t) => ({ sub: t, email: `${t}@test`, name: t }) });
  await app.ready();
});

beforeEach(async () => {
  await purge({ subs: SUBS, productIds: modelos.splice(0) });
  await Promise.all([grant(INVENTARIO, ["INVENTARIO"]), grant(ADMIN, ["ADMINISTRACION"]), grant(MOSTRADOR, ["MOSTRADOR"])]);
});

after(async () => {
  await purge({ subs: SUBS, productIds: modelos });
  await app.close();
  await prisma.$disconnect();
});

test("el panel ve de dónde sale el precio: fórmula, coste, suelo, escalera y garantía", async () => {
  const m = await nuevoModelo();
  const url = `/api/products/${m.id}/pricing`;
  assert.equal((await como(MOSTRADOR, { method: "GET", url })).statusCode, 403);
  const v = (await como(INVENTARIO, { method: "GET", url })).json();
  assert.equal(v.formulaDay1, 2.4, "3 estrellas: 6 % de $40");
  assert.equal(v.priceOverride, null);
  assert.ok(v.floor > v.cycleCost, "el suelo deja margen sobre el coste");
  assert.equal(v.ladder.length, 14);
  assert.equal(v.ladder[0], Math.round(Math.max(v.formulaDay1, v.floor) * 100) / 100);
  assert.equal(v.deposit, 16, "40 % de $40");
  assert.deepEqual(v.history, []);
});

test("la vista previa calcula con el ajuste pedido y no guarda nada", async () => {
  const m = await nuevoModelo();
  const url = `/api/products/${m.id}/pricing`;
  const previa = (await como(INVENTARIO, { method: "GET", url: `${url}?priceOverride=9&depositOverride=20` })).json();
  assert.equal(previa.error, null);
  assert.equal(previa.ladder[0], 9);
  assert.equal(previa.deposit, 20);
  const baja = (await como(INVENTARIO, { method: "GET", url: `${url}?priceOverride=0.5` })).json();
  assert.match(baja.error, /coste por ciclo/);
  assert.equal(baja.priceOverride, null, "un ajuste inválido no se previsualiza");
  const guardado = await prisma.product.findUnique({ where: { id: m.id } });
  assert.equal(guardado.priceOverride, null);
  assert.equal(guardado.depositOverride, null);
});

test("ajustar es de Administración y queda en la bitácora con quién y por qué", async () => {
  const m = await nuevoModelo();
  const url = `/api/products/${m.id}/pricing`;
  assert.equal((await como(INVENTARIO, { method: "PATCH", url, payload: { priceOverride: 9 } })).statusCode, 403);
  const ok = await como(ADMIN, { method: "PATCH", url, payload: { priceOverride: 9, depositOverride: 20, note: "Prenda de diseñador" } });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().ladder[0], 9);

  const v = (await como(INVENTARIO, { method: "GET", url })).json();
  assert.equal(v.history.length, 1);
  assert.equal(v.history[0].by, ADMIN);
  assert.match(v.history[0].note, /1er día: fórmula \(\$2\.40\) → \$9\.00/);
  assert.match(v.history[0].note, /Garantía: fórmula \(\$16\) → \$20/);
  assert.match(v.history[0].note, /Motivo: Prenda de diseñador/);

  assert.equal((await como(ADMIN, { method: "PATCH", url, payload: { priceOverride: 9 } })).statusCode, 400, "sin cambios no se anota nada");
  const vuelta = await como(ADMIN, { method: "PATCH", url, payload: { priceOverride: null } });
  assert.equal(vuelta.statusCode, 200);
  const v2 = (await como(INVENTARIO, { method: "GET", url })).json();
  assert.equal(v2.history.length, 2);
  assert.match(v2.history[0].note, /\$9\.00 → fórmula/);
});

test("un ajuste por debajo del coste o una garantía rara se rechazan", async () => {
  const m = await nuevoModelo();
  const url = `/api/products/${m.id}/pricing`;
  for (const malo of [{ priceOverride: 0.5 }, { priceOverride: "caro" }, { depositOverride: 2.5 }, { depositOverride: -3 }, {}]) {
    assert.equal((await como(ADMIN, { method: "PATCH", url, payload: malo })).statusCode, 400, JSON.stringify(malo));
  }
  const fila = await prisma.financeLog.count({ where: { productId: m.id } });
  assert.equal(fila, 0, "lo rechazado no deja rastro");
});

test("cambiar valor o estrellas también queda en el historial de precio", async () => {
  const m = await nuevoModelo();
  const r = await como(ADMIN, { method: "PATCH", url: `/api/products/${m.id}`, payload: { value: 60, stars: 4 } });
  assert.equal(r.statusCode, 200, r.body);
  const v = (await como(INVENTARIO, { method: "GET", url: `/api/products/${m.id}/pricing` })).json();
  assert.match(v.history[0].note, /Valor de reposición: \$40 → \$60 · Estrellas: 3 → 4/);
  const renombre = await como(INVENTARIO, { method: "PATCH", url: `/api/products/${m.id}`, payload: { name: "Camisa renombrada" } });
  assert.equal(renombre.statusCode, 200);
  const v2 = (await como(INVENTARIO, { method: "GET", url: `/api/products/${m.id}/pricing` })).json();
  assert.equal(v2.history.length, 1, "renombrar no toca el precio");
});
