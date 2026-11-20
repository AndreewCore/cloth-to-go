/**
 * Sesiones propias (fase 3): el login entrega un token opaco que dura 30 días,
 * la base guarda solo su hash, y caducar o cerrar sesión lo deja sin valor.
 *
 * El verificador de Google de estas pruebas es ESTRICTO (solo acepta un token
 * concreto): con el verificador permisivo de las otras suites, un token de
 * sesión caducado caería al camino del ID token y entraría como otro usuario,
 * y la prueba no estaría probando nada.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import prisma from "../src/db.js";
import { hashToken } from "../src/sessions.js";
import { purge } from "./helpers/db.js";

const SUB = "test-sub-sesiones";
const GOOGLE_OK = "id-token-de-google-valido";

let app;

/** Inicia sesión con el ID token aceptado y devuelve el cuerpo. */
async function login() {
  const res = await app.inject({ method: "POST", url: "/api/auth/google", payload: { credential: GOOGLE_OK } });
  assert.equal(res.statusCode, 200, res.body);
  return res.json();
}

/** GET /api/orders con el token dado. */
function misPedidos(token) {
  return app.inject({ method: "GET", url: "/api/orders", headers: { authorization: `Bearer ${token}` } });
}

before(async () => {
  app = buildApp({
    verifyGoogleToken: async (t) => {
      if (t !== GOOGLE_OK) throw new Error("token inválido");
      return { sub: SUB, email: `${SUB}@test`, name: "Sesiones" };
    },
  });
  await app.ready();
});

after(async () => {
  await purge({ subs: [SUB] });
  await app.close();
  await prisma.$disconnect();
});

test("el login entrega un token de sesión que abre las rutas del cliente", async () => {
  const { token } = await login();
  assert.equal((await misPedidos(token)).statusCode, 200);
});

test("en la base solo queda el hash del token, nunca el token", async () => {
  const { token } = await login();
  assert.equal(await prisma.session.count({ where: { tokenHash: token } }), 0);
  assert.equal(await prisma.session.count({ where: { tokenHash: hashToken(token) } }), 1);
});

test("una sesión caducada ya no vale", async () => {
  const { token } = await login();
  await prisma.session.update({ where: { tokenHash: hashToken(token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await misPedidos(token)).statusCode, 401);
});

test("cerrar sesión revoca el token, y repetirlo no es un error", async () => {
  const { token } = await login();
  const auth = { authorization: `Bearer ${token}` };
  assert.equal((await app.inject({ method: "POST", url: "/api/auth/logout", headers: auth })).statusCode, 204);
  assert.equal((await misPedidos(token)).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: "/api/auth/logout", headers: auth })).statusCode, 204);
});

test("un token inventado no entra", async () => {
  assert.equal((await misPedidos("no-es-un-token")).statusCode, 401);
});

test("el ID token de Google sigue valiendo en la cabecera", async () => {
  assert.equal((await misPedidos(GOOGLE_OK)).statusCode, 200);
});
