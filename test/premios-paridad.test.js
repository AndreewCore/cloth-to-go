/**
 * Guardarraíl del catálogo de premios duplicado.
 *
 * Desde la fase 3 el valor de un premio lo calcula solo el servidor
 * (server/src/rewards.js), pero la app sigue pintando la lista (nombre, icono,
 * coste y descripción) desde `REWARDS` de js/data.js. Si las dos listas se
 * separan, el perfil ofrecería un premio con un coste y el servidor cobraría
 * otro. Mismo arreglo que agua-paridad.test.js.
 */
const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { loadApp } = require("./helpers/load-app.js");

const front = loadApp();
let server;

before(async () => {
  const ruta = path.join(__dirname, "..", "server", "src", "rewards.js");
  server = await import(pathToFileURL(ruta).href);
});

test("mismos premios, con el mismo id, tipo, coste, nombre y descripción", () => {
  const campos = (r) => ({ id: r.id, type: r.type, icon: r.icon, cost: r.cost, name: r.name, desc: r.desc });
  // JSON: los objetos del contexto vm traen el prototipo de otro realm.
  const plano = (v) => JSON.parse(JSON.stringify(v));
  assert.deepEqual(plano(front.REWARDS.map(campos)), plano(server.REWARDS.map(campos)));
});
