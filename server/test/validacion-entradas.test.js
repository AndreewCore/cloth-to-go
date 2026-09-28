/**
 * Pruebas de validación de entrada en los campos que NO son vocabulario
 * cerrado. El vocabulario (`delivery`/`ret`/`pay`), los ids de prenda y las
 * fechas ya los vigila `orders.test.js`; lo que faltaba eran las direcciones,
 * que llegaban como texto libre y se guardaban tal cual.
 *
 * Lo que se defiende aquí:
 * - Un valor que no es texto se rechaza con **400**, no se cuela hasta Prisma y
 *   sale como **500** — un error de entrada no puede parecer una caída.
 * - Un envío a domicilio **sin dirección** deja de ser un pedido válido.
 * - La dirección tiene tope de longitud: sin él, el cuerpo de la petición
 *   escribe lo que quiera en la base (medido: 100 000 caracteres entraban).
 *
 * Asume la base sembrada (`pnpm db:reset`), como el resto de la suite.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import prisma from "../src/db.js";
import { ADDRESS_MAX } from "../src/ledger.js";

const CLIENTE = "test-sub-validacion";
const DIRECCION = "Av. Principal 123 y Segunda";

let app;
let prendas;

/** Fecha `YYYY-MM-DD` desplazada `dias` desde hoy (hora de Guayaquil). */
function fecha(dias) {
  return new Date(Date.now() + (dias * 24 * 60 - 5 * 60) * 60000).toISOString().slice(0, 10);
}

/** Petición autenticada como el cliente de prueba. */
function como(opts) {
  return app.inject({ ...opts, headers: { ...opts.headers, authorization: `Bearer ${CLIENTE}` } });
}

/** Crea un pedido con los campos por defecto, sobrescribiendo lo que se pida. */
function crear(over = {}) {
  return como({
    method: "POST",
    url: "/api/orders",
    payload: {
      items: [prendas[0].id],
      start: fecha(1),
      end: fecha(4),
      delivery: "ship",
      ret: "home",
      pay: "credit",
      shipAddr: DIRECCION,
      retAddr: DIRECCION,
      ...over,
    },
  });
}

/** Borra lo que dejaron las pruebas, respetando las claves foráneas. */
async function limpiar() {
  const user = await prisma.user.findUnique({ where: { googleSub: CLIENTE } });
  if (!user) return;
  const orders = await prisma.order.findMany({ where: { userId: user.id }, select: { id: true } });
  const ids = orders.map((o) => o.id);
  await prisma.charge.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.order.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.delete({ where: { id: user.id } });
}

before(async () => {
  app = buildApp({
    verifyGoogleToken: async (token) => ({ sub: token, email: `${token}@test`, name: token }),
  });
  await app.ready();
  const res = await app.inject({ method: "GET", url: "/api/products" });
  prendas = res.json();
});

beforeEach(limpiar);

after(async () => {
  await limpiar();
  await app.close();
  await prisma.$disconnect();
});

test("una dirección que no es texto se rechaza con 400, no revienta con 500", async () => {
  // Antes llegaba hasta Prisma: el error de entrada se registraba como caída
  // del servidor, que es lo que uno mira cuando algo va mal de verdad.
  for (const valor of [12345, { $ne: null }, ["Calle 1"], true]) {
    const res = await crear({ shipAddr: valor });
    assert.equal(res.statusCode, 400, `aceptó ${JSON.stringify(valor)}: ${res.body}`);
  }
});

test("un envío a domicilio sin dirección no es un pedido válido", async () => {
  for (const [valor, motivo] of [
    [undefined, "ausente"],
    [null, "nula"],
    ["", "vacía"],
    ["   ", "solo espacios"],
    ["Av 1", "demasiado corta"],
  ]) {
    const res = await crear({ shipAddr: valor });
    assert.equal(res.statusCode, 400, `aceptó una dirección ${motivo}: ${res.body}`);
  }
});

test("la devolución a domicilio exige su propia dirección", async () => {
  const res = await crear({ ret: "home", retAddr: "" });
  assert.equal(res.statusCode, 400, res.body);
});

test("retirar y devolver en el local no exige ninguna dirección", async () => {
  // La dirección solo se pide cuando el modo la necesita: pedir un dato
  // personal que no hace falta es una fuga esperando a que alguien la lea.
  const res = await crear({ delivery: "pickup", ret: "store", shipAddr: undefined, retAddr: undefined });
  assert.equal(res.statusCode, 201, res.body);
  const creado = res.json();
  assert.equal(creado.shipAddr, null);
  assert.equal(creado.retAddr, null);
});

test("la dirección tiene tope de longitud", async () => {
  const largo = await crear({ shipAddr: "A".repeat(ADDRESS_MAX + 1) });
  assert.equal(largo.statusCode, 400, "entró una dirección por encima del tope");

  const justo = await crear({ shipAddr: "A".repeat(ADDRESS_MAX) });
  assert.equal(justo.statusCode, 201, justo.body);
});

test("la dirección se guarda recortada", async () => {
  const res = await crear({ shipAddr: `   ${DIRECCION}   ` });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(res.json().shipAddr, DIRECCION);
});

test("una dirección con marcado se acepta y vuelve tal cual: el servidor no sanea", async () => {
  // A propósito. El servidor NO recorta ni escapa marcado: la defensa contra
  // XSS es `escapeHTML()` al pintar (js/data.js, con sus pruebas), y esa es la
  // única que funciona en todos los destinos —HTML, atributo, PDF, correo—.
  // Sanear aquí daría una falsa sensación de seguridad y además rompería
  // direcciones legítimas: en Guayaquil "Calle 5 & 6" o "Mz. 3 <esquina>" son
  // texto válido que un filtro ingenuo destrozaría.
  const marcado = '<script>alert(1)</script> y Calle 5 & 6';
  const res = await crear({ shipAddr: marcado });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(res.json().shipAddr, marcado, "el servidor alteró la dirección");
});

test("cambiar la devolución a domicilio sin dirección se rechaza", async () => {
  // El pedido se retiraba en el local, así que no tiene dirección heredada:
  // aceptarlo generaría el cargo del envío sin un sitio donde llevarlo.
  const pedido = (await crear({ delivery: "pickup", ret: "store", shipAddr: undefined, retAddr: undefined })).json();

  const sinDir = await como({ method: "PATCH", url: `/api/orders/${pedido.id}/return`, payload: { ret: "home" } });
  assert.equal(sinDir.statusCode, 400, sinDir.body);

  const conDir = await como({
    method: "PATCH",
    url: `/api/orders/${pedido.id}/return`,
    payload: { ret: "home", retAddr: DIRECCION },
  });
  assert.equal(conDir.statusCode, 200, conDir.body);
  assert.equal(conDir.json().retAddr, DIRECCION);
});

test("al cambiar la devolución se hereda la dirección que ya tenía el pedido", async () => {
  const pedido = (await crear({ ret: "home" })).json();

  const aLocal = await como({ method: "PATCH", url: `/api/orders/${pedido.id}/return`, payload: { ret: "store" } });
  assert.equal(aLocal.statusCode, 200, aLocal.body);
  assert.equal(aLocal.json().retAddr, null);

  // Vuelve a domicilio sin mandar dirección: no hay ninguna guardada (el paso
  // anterior la borró), así que tampoco vale heredarla.
  const aCasa = await como({ method: "PATCH", url: `/api/orders/${pedido.id}/return`, payload: { ret: "home" } });
  assert.equal(aCasa.statusCode, 400, aCasa.body);
});

test("una dirección inválida en el PATCH tampoco pasa", async () => {
  const pedido = (await crear({ ret: "home" })).json();
  for (const valor of [12345, "", "Av 1", "A".repeat(ADDRESS_MAX + 1)]) {
    const res = await como({
      method: "PATCH",
      url: `/api/orders/${pedido.id}/return`,
      payload: { ret: "home", retAddr: valor },
    });
    assert.equal(res.statusCode, 400, `aceptó ${JSON.stringify(valor).slice(0, 30)}: ${res.body}`);
  }
});
