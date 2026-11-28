/**
 * Moderación de reseñas (fase 4): la cola, las decisiones con su bitácora y
 * los reportes de los clientes, que con tres cuentas distintas devuelven una
 * reseña a la cola.
 *
 * Cada prueba crea su modelo y un pedido del autor ya cumplido, y la reseña se
 * da de alta por la API: así se prueba el mismo camino que usa la app.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildApp } from "../src/app.js";
import prisma from "../src/db.js";
import { createDiskStorage } from "../src/storage.js";
import { REPORTS_TO_HIDE } from "../src/moderation.js";
import { grant, loadHolidays, purge } from "./helpers/db.js";
import { reviewFixture } from "./helpers/reviews.js";

const AUTOR = "test-sub-mod-autor";
const MODERA = "test-sub-mod-moderacion";
const ADMIN = "test-sub-mod-admin";
const INVENTARIO = "test-sub-mod-inventario";
const LECTORES = ["test-sub-mod-l1", "test-sub-mod-l2", "test-sub-mod-l3"];
const SUBS = [AUTOR, MODERA, ADMIN, INVENTARIO, ...LECTORES];

let app;
let dir;
const modelos = [];

/** Petición firmada como `sub` (el verificador falso usa el token como identidad). */
function como(sub, opts) {
  const headers = sub ? { authorization: `Bearer ${sub}` } : {};
  return app.inject({ ...opts, headers: { ...opts.headers, ...headers } });
}

/** Reseña pendiente nueva del autor, sobre un modelo propio de la prueba. */
const resenaNueva = () => reviewFixture(como, { inventario: INVENTARIO, autor: AUTOR, modelos });

/** Decide sobre una reseña como `sub`. */
const decidir = (sub, id, payload) => como(sub, { method: "POST", url: `/api/reviews/${id}/moderate`, payload });
/** Reporta una reseña como `sub`. */
const reportar = (sub, id, reason = "SPAM") => como(sub, { method: "POST", url: `/api/reviews/${id}/report`, payload: { reason } });
/** Reseñas públicas de un modelo, vistas por `sub` (o por un invitado). */
const publicas = async (productId, sub = null) => (await como(sub, { method: "GET", url: `/api/products/${productId}/reviews` })).json();

before(async () => {
  await loadHolidays();
  dir = await mkdtemp(path.join(tmpdir(), "ctg-moderacion-"));
  app = buildApp({
    verifyGoogleToken: async (t) => ({ sub: t, email: `${t}@test`, name: t }),
    storage: createDiskStorage({ dir }),
    allowUpload: () => true,
  });
  await app.ready();
});

beforeEach(async () => {
  await purge({ subs: SUBS, productIds: modelos.splice(0) });
  await grant(INVENTARIO, ["INVENTARIO"]);
  await grant(MODERA, ["MODERACION"]);
  await grant(ADMIN, ["ADMINISTRACION"]);
});

after(async () => {
  await purge({ subs: SUBS, productIds: modelos });
  await app.close();
  await prisma.$disconnect();
  await rm(dir, { recursive: true, force: true });
});

test("la cola es de Moderación (o Administración) y trae lo pendiente", async () => {
  const r = await resenaNueva();
  assert.equal((await como(AUTOR, { method: "GET", url: "/api/admin/reviews" })).statusCode, 403);
  assert.equal((await como(INVENTARIO, { method: "GET", url: "/api/admin/reviews" })).statusCode, 403);
  assert.equal((await como(ADMIN, { method: "GET", url: "/api/admin/reviews" })).statusCode, 200);

  const cola = (await como(MODERA, { method: "GET", url: "/api/admin/reviews" })).json();
  const mia = cola.reviews.find((x) => x.id === r.id);
  assert.ok(mia, "la reseña nueva está en la cola");
  assert.equal(mia.status, "PENDIENTE");
  assert.equal(mia.author, AUTOR);
  assert.ok(cola.counts.PENDIENTE >= 1);
  assert.equal(cola.reasons.length, 4);
  assert.equal((await como(MODERA, { method: "GET", url: "/api/admin/reviews?status=RARO" })).statusCode, 400);
});

test("aprobar publica la reseña y queda en la bitácora", async () => {
  const r = await resenaNueva();
  assert.equal((await publicas(r.productId)).count, 0, "pendiente: el público no la ve");
  assert.equal((await decidir(AUTOR, r.id, { action: "approve" })).statusCode, 403);

  const res = await decidir(MODERA, r.id, { action: "approve" });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().status, "APROBADA");
  const vistas = await publicas(r.productId);
  assert.equal(vistas.count, 1);
  assert.equal(vistas.average, 4);

  assert.equal((await decidir(MODERA, r.id, { action: "approve" })).statusCode, 409, "ya aprobada");
  const log = await prisma.activityLog.findFirst({ where: { action: "RESENA_APROBADA", productId: r.productId } });
  assert.ok(log);
  assert.equal(log.detail.reviewId, r.id);
});

test("rechazar exige un motivo de la lista, y el autor lo ve", async () => {
  const r = await resenaNueva();
  assert.equal((await decidir(MODERA, r.id, { action: "reject" })).statusCode, 400);
  assert.equal((await decidir(MODERA, r.id, { action: "reject", reason: "me cae mal" })).statusCode, 400);
  assert.equal((await decidir(MODERA, r.id, { action: "borrar" })).statusCode, 400);

  const res = await decidir(MODERA, r.id, { action: "reject", reason: "DATOS_PERSONALES" });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal((await publicas(r.productId)).count, 0);

  const mias = (await como(AUTOR, { method: "GET", url: "/api/me/reviews" })).json();
  const mia = mias.find((x) => x.id === r.id);
  assert.equal(mia.status, "RECHAZADA");
  assert.equal(mia.rejectReason, "DATOS_PERSONALES");
  assert.ok(await prisma.activityLog.findFirst({ where: { action: "RESENA_RECHAZADA", productId: r.productId } }));
});

test("ocultar y volver a mostrar solo sobre lo que corresponde", async () => {
  const r = await resenaNueva();
  assert.equal((await decidir(MODERA, r.id, { action: "hide" })).statusCode, 409, "una pendiente no se oculta");
  await decidir(MODERA, r.id, { action: "approve" });
  assert.equal((await decidir(MODERA, r.id, { action: "hide" })).statusCode, 200);
  assert.equal((await publicas(r.productId)).count, 0);
  assert.equal((await decidir(MODERA, r.id, { action: "show" })).statusCode, 200);
  assert.equal((await publicas(r.productId)).count, 1);
  assert.equal((await decidir(MODERA, 99_999_999, { action: "show" })).statusCode, 404);
});

test("reportar: solo publicadas, nunca la propia, una vez por cuenta", async () => {
  const r = await resenaNueva();
  assert.equal((await reportar(LECTORES[0], r.id)).statusCode, 404, "pendiente: no se ve, no se reporta");
  await decidir(MODERA, r.id, { action: "approve" });

  assert.equal((await reportar(null, r.id)).statusCode, 401);
  assert.equal((await reportar(AUTOR, r.id)).statusCode, 409);
  assert.equal((await reportar(LECTORES[0], r.id, "INVENTADO")).statusCode, 400);
  const ok = await reportar(LECTORES[0], r.id);
  assert.equal(ok.statusCode, 201, ok.body);
  assert.equal(ok.json().hidden, false);
  assert.equal((await reportar(LECTORES[0], r.id, "OFENSIVO")).statusCode, 409, "segundo reporte de la misma cuenta");

  const vistas = await publicas(r.productId, LECTORES[0]);
  assert.equal(vistas.reviews[0].reported, true, "la app sabe que ya la reportó");
  assert.equal((await publicas(r.productId, LECTORES[1])).reviews[0].reported, undefined);
});

test(`${REPORTS_TO_HIDE} reportes de cuentas distintas la devuelven a la cola; aprobarla los resuelve`, async () => {
  const r = await resenaNueva();
  await decidir(MODERA, r.id, { action: "approve" });
  const [a, b, c] = await Promise.all(LECTORES.map((sub) => reportar(sub, r.id, "OFENSIVO")));
  for (const res of [a, b, c]) assert.equal(res.statusCode, 201, res.body);
  assert.equal([a, b, c].filter((res) => res.json().hidden).length, 1, "exactamente uno la oculta, aunque lleguen a la vez");
  assert.equal((await publicas(r.productId)).count, 0);

  const cola = (await como(MODERA, { method: "GET", url: "/api/admin/reviews" })).json();
  const enCola = cola.reviews.find((x) => x.id === r.id);
  assert.equal(enCola.openReports, REPORTS_TO_HIDE);
  const auto = await prisma.activityLog.findFirst({ where: { action: "RESENA_AUTO_OCULTA", productId: r.productId } });
  assert.equal(auto.actorId, null, "la hace el sistema");

  await decidir(MODERA, r.id, { action: "approve" });
  assert.equal((await publicas(r.productId)).count, 1);
  const abiertos = await prisma.reviewReport.count({ where: { reviewId: r.id, resolvedAt: null } });
  assert.equal(abiertos, 0, "los reportes viejos ya no cuentan");
});

test("la bitácora general filtra por la categoría de reseñas", async () => {
  const r = await resenaNueva();
  await decidir(MODERA, r.id, { action: "approve" });
  const res = await como(ADMIN, { method: "GET", url: `/api/admin/activity?category=resenas&product=${r.productId}` });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().entries.map((e) => e.action), ["RESENA_APROBADA"]);
});

test("/api/config publica los motivos de reporte", async () => {
  const cfg = (await app.inject({ method: "GET", url: "/api/config" })).json();
  assert.deepEqual(cfg.reviewReasons.map((x) => x.key), ["OFENSIVO", "SPAM", "DATOS_PERSONALES", "FUERA_DE_TEMA"]);
});
