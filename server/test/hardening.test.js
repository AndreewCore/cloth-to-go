/**
 * Pruebas de endurecimiento para producción (issues #16 y #18).
 *
 * Cubren dos formas de fallar callando, que es la peor: filtrar el interior del
 * servidor en un 500, y arrancar con CORS abierto a todo el mundo porque se
 * olvidó una variable de entorno.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";

/**
 * Ejecuta `fn` con las variables de entorno indicadas y las restaura después,
 * pase lo que pase. Sin esto, un test que falle a media asignación contamina
 * a los siguientes (el entorno es global al proceso).
 * @param {Record<string, string|undefined>} vars
 * @param {() => any} fn
 */
function withEnv(vars, fn) {
  const previo = {};
  for (const [k, v] of Object.entries(vars)) {
    previo[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(previo)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/* ---- #16: los errores internos no salen al cliente ---- */

test("un fallo interno responde 500 genérico, sin el mensaje del error", async () => {
  const app = buildApp();
  // Ruta que revienta como lo haría un fallo de Prisma: el mensaje lleva
  // nombres de columnas y constraints que no deben cruzar la frontera.
  app.get("/api/boom", async () => {
    throw new Error("Unique constraint failed on the fields: (`googleSub`)");
  });
  await app.ready();

  const res = await app.inject({ method: "GET", url: "/api/boom" });

  assert.equal(res.statusCode, 500);
  const body = res.body;
  assert.doesNotMatch(body, /googleSub/, "no debe filtrar nombres de columnas");
  assert.doesNotMatch(body, /constraint/i, "no debe filtrar detalles del esquema");
  assert.equal(res.json().error, "Error interno del servidor.");
  await app.close();
});

test("los 4xx sí conservan su mensaje (lo redacta la app, no el motor)", async () => {
  const app = buildApp();
  app.get("/api/nope", async () => {
    const err = new Error("Falta el parámetro `talla`.");
    err.statusCode = 400;
    throw err;
  });
  await app.ready();

  const res = await app.inject({ method: "GET", url: "/api/nope" });

  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "Falta el parámetro `talla`.");
  await app.close();
});

test("el 401 de auth sigue explicando el motivo al cliente", async () => {
  const app = buildApp({ verifyGoogleToken: async () => ({ sub: "x" }) });
  await app.ready();
  const res = await app.inject({ method: "POST", url: "/api/auth/google", payload: {} });
  assert.equal(res.statusCode, 401);
  assert.ok(res.json().error, "un 401 sin mensaje deja al cliente sin saber qué pasó");
  await app.close();
});

/* ---- #18: CORS_ORIGINS es obligatoria en producción ---- */

test("con NODE_ENV=production y sin CORS_ORIGINS, la app no arranca", () => {
  withEnv({ NODE_ENV: "production", CORS_ORIGINS: undefined }, () => {
    assert.throws(() => buildApp(), /CORS_ORIGINS es obligatoria/);
  });
});

test("con NODE_ENV=production y CORS_ORIGINS definida, la app arranca", async () => {
  const app = withEnv(
    { NODE_ENV: "production", CORS_ORIGINS: "https://andreewcore.github.io" },
    () => buildApp()
  );
  await app.ready();
  const res = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(res.statusCode, 200);
  await app.close();
});

test("fuera de producción, sin CORS_ORIGINS se sigue permitiendo cualquier origen", async () => {
  // Es lo que hace cómodo el desarrollo (y abrir la demo por file://); el
  // riesgo solo importa en un origen público.
  const app = withEnv({ NODE_ENV: "test", CORS_ORIGINS: undefined }, () => buildApp());
  await app.ready();
  const res = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(res.statusCode, 200);
  await app.close();
});
