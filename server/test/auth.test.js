/**
 * Pruebas de POST /api/auth/google usando `app.inject()` (sin red real).
 *
 * No hay forma de obtener un ID token de Google real y firmado fuera del
 * navegador, así que la ruta feliz inyecta un `verifyGoogleToken` falso vía
 * `buildApp({ verifyGoogleToken })` — buildApp lo usa en vez de construir el
 * verificador real contra GOOGLE_CLIENT_ID, dejando el test determinista.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import prisma from "../src/db.js";

const FAKE_SUB = "test-google-sub-12345";

after(async () => {
  // No dejar rastro del usuario de prueba en la base compartida por los tests.
  await prisma.user.deleteMany({ where: { googleSub: FAKE_SUB } });
  await prisma.$disconnect();
});

test("POST /api/auth/google sin credential responde 401", async () => {
  const app = buildApp({ verifyGoogleToken: async () => ({ sub: FAKE_SUB }) });
  await app.ready();
  const res = await app.inject({ method: "POST", url: "/api/auth/google", payload: {} });
  assert.equal(res.statusCode, 401);
  assert.ok(res.json().error);
  await app.close();
});

test("POST /api/auth/google con credential que no verifica responde 401", async () => {
  const app = buildApp({
    verifyGoogleToken: async () => {
      throw new Error("audience mismatch");
    },
  });
  await app.ready();
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/google",
    payload: { credential: "credencial-basura" },
  });
  assert.equal(res.statusCode, 401);
  assert.ok(res.json().error);
  // El motivo interno del rechazo no debe filtrarse al cliente.
  assert.ok(!JSON.stringify(res.json()).includes("audience mismatch"));
  await app.close();
});

test("POST /api/auth/google sin GOOGLE_CLIENT_ID configurado responde 500", async () => {
  const previous = process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_ID;
  try {
    const app = buildApp(); // sin verifyGoogleToken inyectado: usa el real por env
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/google",
      payload: { credential: "algo" },
    });
    assert.equal(res.statusCode, 500);
    await app.close();
  } finally {
    if (previous !== undefined) process.env.GOOGLE_CLIENT_ID = previous;
  }
});

test("POST /api/auth/google con credential válida registra y devuelve al usuario", async () => {
  const payload = {
    sub: FAKE_SUB,
    email: "demo@example.com",
    name: "Demo Usuaria",
    picture: "https://example.com/foto.jpg",
  };
  const app = buildApp({ verifyGoogleToken: async () => payload });
  await app.ready();

  const res = await app.inject({
    method: "POST",
    url: "/api/auth/google",
    payload: { credential: "token-de-prueba" },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), {
    user: { sub: payload.sub, name: payload.name, email: payload.email, picture: payload.picture },
  });

  const stored = await prisma.user.findUnique({ where: { googleSub: FAKE_SUB } });
  assert.ok(stored, "el usuario debería quedar guardado en la base");
  assert.equal(stored.email, payload.email);

  await app.close();
});

test("un segundo login con el mismo sub actualiza en vez de duplicar (upsert)", async () => {
  const first = { sub: FAKE_SUB, email: "demo@example.com", name: "Demo Usuaria", picture: null };
  const second = { sub: FAKE_SUB, email: "demo@example.com", name: "Nombre Actualizado", picture: null };

  let app = buildApp({ verifyGoogleToken: async () => first });
  await app.ready();
  await app.inject({ method: "POST", url: "/api/auth/google", payload: { credential: "a" } });
  await app.close();

  app = buildApp({ verifyGoogleToken: async () => second });
  await app.ready();
  const res = await app.inject({ method: "POST", url: "/api/auth/google", payload: { credential: "b" } });
  await app.close();

  assert.equal(res.json().user.name, "Nombre Actualizado");
  const count = await prisma.user.count({ where: { googleSub: FAKE_SUB } });
  assert.equal(count, 1);
});
