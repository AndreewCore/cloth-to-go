/**
 * Avisos (fase 4): rechazar una reseña avisa a su autor con el motivo, en la
 * app y, si el correo está encendido, por correo. El correo va después de la
 * decisión y nunca la deshace.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildApp } from "../src/app.js";
import prisma from "../src/db.js";
import { createDiskStorage } from "../src/storage.js";
import { createResendMailer, disabledMailer, mailerFromEnv } from "../src/mail.js";
import { grant, loadHolidays, purge } from "./helpers/db.js";
import { reviewFixture } from "./helpers/reviews.js";

const AUTOR = "test-sub-aviso-autor";
const OTRO = "test-sub-aviso-otro";
const MODERA = "test-sub-aviso-moderacion";
const INVENTARIO = "test-sub-aviso-inventario";
const SUBS = [AUTOR, OTRO, MODERA, INVENTARIO];

let dir;
const modelos = [];
const apps = [];

/** Mailer falso que apunta lo enviado; con `falla` simula a Resend caído. */
function fakeMailer({ falla = false } = {}) {
  const sent = [];
  return { sent, enabled: true, async send(msg) { if (falla) throw new Error("Resend respondió 500"); sent.push(msg); return true; } };
}

/** App con el mailer dado y su ayudante de peticiones firmadas. */
async function montar(mailer) {
  const app = buildApp({
    verifyGoogleToken: async (t) => ({ sub: t, email: `${t}@test`, name: t }),
    storage: createDiskStorage({ dir }),
    allowUpload: () => true,
    mailer,
  });
  await app.ready();
  apps.push(app);
  const como = (sub, opts) => app.inject({ ...opts, headers: { ...opts.headers, ...(sub ? { authorization: `Bearer ${sub}` } : {}) } });
  return { app, como };
}

/** Reseña nueva rechazada por datos personales; devuelve la respuesta del rechazo. */
async function rechazada(como) {
  const r = await reviewFixture(como, { inventario: INVENTARIO, autor: AUTOR, modelos });
  const res = await como(MODERA, { method: "POST", url: `/api/reviews/${r.id}/moderate`, payload: { action: "reject", reason: "DATOS_PERSONALES" } });
  assert.equal(res.statusCode, 200, res.body);
  return { review: r, res: res.json() };
}

before(async () => {
  await loadHolidays();
  dir = await mkdtemp(path.join(tmpdir(), "ctg-avisos-"));
});

beforeEach(async () => {
  await purge({ subs: SUBS, productIds: modelos.splice(0) });
  await grant(INVENTARIO, ["INVENTARIO"]);
  await grant(MODERA, ["MODERACION"]);
});

after(async () => {
  await purge({ subs: SUBS, productIds: modelos });
  for (const app of apps) await app.close();
  await prisma.$disconnect();
  await rm(dir, { recursive: true, force: true });
});

test("rechazar crea un aviso con el motivo y manda el correo al autor", async () => {
  const mailer = fakeMailer();
  const { como } = await montar(mailer);
  const { res } = await rechazada(como);
  assert.ok(res.noticeId);

  const { unread, notices } = (await como(AUTOR, { method: "GET", url: "/api/me/notices" })).json();
  assert.equal(unread, 1);
  assert.equal(notices[0].kind, "RESENA_RECHAZADA");
  assert.match(notices[0].title, /Falda moderada/);
  assert.match(notices[0].body, /Motivo: Datos personales/);
  assert.equal(notices[0].read, false);

  assert.equal(mailer.sent.length, 1);
  assert.equal(mailer.sent[0].to, `${AUTOR}@test`);
  assert.equal(mailer.sent[0].subject, notices[0].title);
  assert.ok((await prisma.notice.findUnique({ where: { id: res.noticeId } })).emailedAt, "se apunta cuándo salió");
});

test("aprobar u ocultar no avisa", async () => {
  const mailer = fakeMailer();
  const { como } = await montar(mailer);
  const r = await reviewFixture(como, { inventario: INVENTARIO, autor: AUTOR, modelos });
  await como(MODERA, { method: "POST", url: `/api/reviews/${r.id}/moderate`, payload: { action: "approve" } });
  await como(MODERA, { method: "POST", url: `/api/reviews/${r.id}/moderate`, payload: { action: "hide" } });
  assert.equal((await como(AUTOR, { method: "GET", url: "/api/me/notices" })).json().notices.length, 0);
  assert.equal(mailer.sent.length, 0);
});

test("con el correo apagado el aviso se guarda igual, sin correo", async () => {
  const { como } = await montar(disabledMailer);
  const { res } = await rechazada(como);
  const n = await prisma.notice.findUnique({ where: { id: res.noticeId } });
  assert.ok(n);
  assert.equal(n.emailedAt, null);
});

test("si el correo falla, la decisión y el aviso se mantienen", async () => {
  const { como } = await montar(fakeMailer({ falla: true }));
  const { review, res } = await rechazada(como);
  assert.equal((await prisma.review.findUnique({ where: { id: review.id } })).status, "RECHAZADA");
  assert.equal((await prisma.notice.findUnique({ where: { id: res.noticeId } })).emailedAt, null);
});

test("cada cliente ve y marca solo sus avisos", async () => {
  const { como } = await montar(disabledMailer);
  const { res } = await rechazada(como);
  assert.equal((await como(null, { method: "GET", url: "/api/me/notices" })).statusCode, 401);
  assert.equal((await como(OTRO, { method: "GET", url: "/api/me/notices" })).json().notices.length, 0);

  const ajeno = await como(OTRO, { method: "POST", url: "/api/me/notices/read", payload: { ids: [res.noticeId] } });
  assert.equal(ajeno.json().marked, 0, "un id ajeno no cambia nada");
  assert.equal((await como(AUTOR, { method: "POST", url: "/api/me/notices/read", payload: { ids: ["x"] } })).statusCode, 400);

  const mio = await como(AUTOR, { method: "POST", url: "/api/me/notices/read", payload: {} });
  assert.equal(mio.json().marked, 1);
  const despues = (await como(AUTOR, { method: "GET", url: "/api/me/notices" })).json();
  assert.equal(despues.unread, 0);
  assert.equal(despues.notices[0].read, true);
});

test("retirar la reseña rechazada no borra el aviso", async () => {
  const { como } = await montar(disabledMailer);
  const { review, res } = await rechazada(como);
  assert.equal((await como(AUTOR, { method: "DELETE", url: `/api/reviews/${review.id}` })).statusCode, 204);
  const n = await prisma.notice.findUnique({ where: { id: res.noticeId } });
  assert.ok(n);
  assert.equal(n.reviewId, null);
});

test("el mailer de Resend manda solo texto al destinatario, y sin variables queda apagado", async () => {
  const llamadas = [];
  const m = createResendMailer({
    apiKey: "re_test", from: "CLOTH TO GO <avisos@ejemplo.com>",
    fetchImpl: async (url, init) => { llamadas.push({ url, init }); return { ok: true, status: 200 }; },
  });
  await m.send({ to: "ana@test", subject: "Hola", text: "Cuerpo" });
  assert.equal(llamadas[0].url, "https://api.resend.com/emails");
  assert.equal(llamadas[0].init.headers.authorization, "Bearer re_test");
  assert.deepEqual(JSON.parse(llamadas[0].init.body), { from: "CLOTH TO GO <avisos@ejemplo.com>", to: ["ana@test"], subject: "Hola", text: "Cuerpo" });

  const caido = createResendMailer({ apiKey: "k", from: "f", fetchImpl: async () => ({ ok: false, status: 422 }) });
  await assert.rejects(caido.send({ to: "a", subject: "s", text: "t" }), /422/);

  const antes = { key: process.env.RESEND_API_KEY, from: process.env.MAIL_FROM };
  delete process.env.RESEND_API_KEY;
  process.env.MAIL_FROM = "x@y.z";
  assert.equal(mailerFromEnv().enabled, false, "sin clave no hay correo");
  process.env.RESEND_API_KEY = "k";
  assert.equal(mailerFromEnv().enabled, true);
  for (const [k, v] of [["RESEND_API_KEY", antes.key], ["MAIL_FROM", antes.from]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
