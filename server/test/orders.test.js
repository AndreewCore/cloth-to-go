/**
 * Pruebas de los pedidos y del libro de cargos, con `app.inject()` (sin red).
 *
 * Lo que más se vigila aquí no son los códigos HTTP sino **quién decide el
 * dinero**: que los importes salgan del catálogo y no del cuerpo de la
 * petición, que el depósito no se cuele como ingreso, que un cambio añada una
 * línea en vez de editar la anterior, y que confirmar un cobro sea del local y
 * no del cliente.
 *
 * Asume la base sembrada (`pnpm db:reset`), como el resto de la suite.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import prisma from "../src/db.js";

const CLIENTE = "test-sub-cliente";
const OTRO = "test-sub-otro-cliente";
const ADMIN = "test-sub-admin";
const SUBS = [CLIENTE, OTRO, ADMIN];

let app;
let prendas;
let adminSubsPrevio;

/**
 * Fecha en formato `YYYY-MM-DD` desplazada `dias` desde hoy (hora de Guayaquil).
 * @param {number} dias Días a sumar; negativo para el pasado.
 * @returns {string} Fecha ISO de solo día.
 */
function fecha(dias) {
  return new Date(Date.now() + (dias * 24 * 60 - 5 * 60) * 60000).toISOString().slice(0, 10);
}

/**
 * Petición autenticada como uno de los subs de prueba.
 *
 * El verificador falso devuelve el token tal cual como `sub`, así que el token
 * ES la identidad: basta con mandar "test-sub-admin" para ser el admin.
 * @param {object} opts Opciones de `app.inject()`.
 * @param {string} sub Identidad con la que firmar la petición.
 * @returns {Promise<object>} Respuesta de inject.
 */
function como(sub, opts) {
  return app.inject({ ...opts, headers: { ...opts.headers, authorization: `Bearer ${sub}` } });
}

/**
 * Crea un pedido de prueba y devuelve el cuerpo ya parseado.
 * @param {object} [over] Campos a sobrescribir del pedido por defecto.
 * @param {string} [sub=CLIENTE] Quién lo crea.
 * @returns {Promise<object>} Pedido creado.
 */
async function crearPedido(over = {}, sub = CLIENTE) {
  const res = await como(sub, {
    method: "POST",
    url: "/api/orders",
    payload: {
      items: [prendas[0].id],
      start: fecha(1),
      end: fecha(4),
      delivery: "pickup",
      ret: "store",
      pay: "credit",
      ...over,
    },
  });
  assert.equal(res.statusCode, 201, res.body);
  return res.json();
}

/** Borra todo lo que dejaron los tests, respetando las claves foráneas. */
async function limpiar() {
  const users = await prisma.user.findMany({ where: { googleSub: { in: SUBS } } });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return;
  const orders = await prisma.order.findMany({ where: { userId: { in: ids } }, select: { id: true } });
  const orderIds = orders.map((o) => o.id);
  await prisma.charge.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

before(async () => {
  adminSubsPrevio = process.env.ADMIN_SUBS;
  process.env.ADMIN_SUBS = ADMIN;
  // El token falso es su propio `sub`: determinista y sin red, igual que en
  // auth.test.js.
  app = buildApp({ verifyGoogleToken: async (token) => ({ sub: token, email: `${token}@test`, name: token }) });
  await app.ready();
  const res = await app.inject({ method: "GET", url: "/api/products" });
  prendas = res.json();
  assert.ok(prendas.length >= 3, "la base de pruebas necesita al menos tres prendas sembradas");
});

beforeEach(limpiar);

after(async () => {
  await limpiar();
  if (adminSubsPrevio === undefined) delete process.env.ADMIN_SUBS;
  else process.env.ADMIN_SUBS = adminSubsPrevio;
  await app.close();
  await prisma.$disconnect();
});

/* ---- Credenciales ---- */

test("sin credencial no se listan ni se crean pedidos", async () => {
  const listar = await app.inject({ method: "GET", url: "/api/orders" });
  assert.equal(listar.statusCode, 401);

  const crear = await app.inject({ method: "POST", url: "/api/orders", payload: {} });
  assert.equal(crear.statusCode, 401);
});

test("una credencial que no verifica es 401, sin filtrar el motivo", async () => {
  const roto = buildApp({
    verifyGoogleToken: async () => {
      throw new Error("token expired at 12:00");
    },
  });
  await roto.ready();
  const res = await roto.inject({
    method: "GET",
    url: "/api/orders",
    headers: { authorization: "Bearer lo-que-sea" },
  });
  assert.equal(res.statusCode, 401);
  assert.ok(!res.body.includes("token expired"));
  await roto.close();
});

/* ---- El servidor decide el dinero ---- */

test("el importe lo calcula el servidor y el del cliente se ignora", async () => {
  const prenda = prendas[0];
  const honesto = await crearPedido({ items: [prenda.id] });

  await limpiar();
  const hostil = await crearPedido({
    items: [prenda.id],
    // Todo esto es exactamente lo que un cliente manipulado enviaría.
    total: 0.01,
    totalCents: 1,
    discount: 999,
    charges: [{ type: "RENTAL", amountCents: 1 }],
  });

  assert.equal(hostil.totalCents, honesto.totalCents);
  assert.ok(hostil.totalCents > 0, "un pedido no puede costar cero");
  assert.equal(hostil.charges.length, honesto.charges.length);
});

test("el total es la suma de las líneas y el depósito no cuenta como ingreso", async () => {
  const pedido = await crearPedido();

  const suma = pedido.charges.reduce((s, c) => s + c.amountCents, 0);
  assert.equal(pedido.totalCents, suma);

  const deposito = pedido.charges.find((c) => c.type === "DEPOSIT_HOLD");
  assert.ok(deposito.amountCents > 0, "el pedido debe retener depósito");
  assert.equal(pedido.depositHeldCents, deposito.amountCents);
  assert.equal(pedido.revenueCents, pedido.totalCents - deposito.amountCents);
});

test("las líneas iniciales cubren alquiler, logística y depósito", async () => {
  const pedido = await crearPedido({
    items: [prendas[0].id, prendas[1].id],
    delivery: "ship",
    ret: "home",
    shipAddr: "Av. 9 de Octubre 1234",
    retAddr: "Av. 9 de Octubre 1234",
  });

  const tipos = pedido.charges.map((c) => c.type);
  assert.equal(tipos.filter((t) => t === "RENTAL").length, 2, "una línea de alquiler por prenda");
  assert.ok(tipos.includes("SHIPPING"));
  assert.ok(tipos.includes("RETURN"));
  assert.ok(tipos.includes("DEPOSIT_HOLD"));

  // Cada alquiler queda atado a su prenda: sin eso el desglose no se puede leer.
  const rentals = pedido.charges.filter((c) => c.type === "RENTAL");
  assert.deepEqual(
    rentals.map((c) => c.productId).sort((a, b) => a - b),
    [prendas[0].id, prendas[1].id].sort((a, b) => a - b)
  );
});

test("retirar y devolver en el local no genera cargos logísticos", async () => {
  const pedido = await crearPedido({ delivery: "pickup", ret: "store" });
  const tipos = pedido.charges.map((c) => c.type);
  assert.ok(!tipos.includes("SHIPPING"));
  assert.ok(!tipos.includes("RETURN"));
});

test("en efectivo el pedido queda pendiente; con tarjeta, saldado", async () => {
  const efectivo = await crearPedido({ pay: "cash" });
  assert.equal(efectivo.status, "pending");
  assert.ok(efectivo.charges.every((c) => c.status === "PENDING"));

  await limpiar();
  const tarjeta = await crearPedido({ pay: "credit" });
  assert.equal(tarjeta.status, "settled");
  assert.ok(tarjeta.charges.every((c) => c.status === "SETTLED"));
});

/* ---- Validación de entrada ---- */

test("el pedido rechaza vocabulario, fechas y prendas imposibles", async () => {
  const casos = [
    [{ delivery: "avion" }, "entrega inventada"],
    [{ ret: "paloma" }, "devolución inventada"],
    [{ pay: "cheque" }, "pago inventado"],
    [{ start: "ayer" }, "fecha sin formato"],
    [{ start: fecha(-3), end: fecha(-1) }, "alquiler en el pasado"],
    [{ start: fecha(5), end: fecha(2) }, "devolución antes del inicio"],
    [{ items: [] }, "pedido vacío"],
    [{ items: [prendas[0].id, prendas[0].id] }, "prenda repetida"],
    [{ items: ["1"] }, "id que no es número"],
    [{ items: [999999] }, "prenda que no existe"],
  ];

  for (const [over, motivo] of casos) {
    const res = await como(CLIENTE, {
      method: "POST",
      url: "/api/orders",
      payload: {
        items: [prendas[0].id],
        start: fecha(1),
        end: fecha(4),
        delivery: "pickup",
        ret: "store",
        pay: "credit",
        ...over,
      },
    });
    assert.equal(res.statusCode, 400, `debería rechazar: ${motivo}`);
  }
});

test("la dirección solo se guarda cuando el modo la necesita", async () => {
  const pedido = await crearPedido({
    delivery: "pickup",
    ret: "store",
    shipAddr: "Calle que no hace falta 123",
    retAddr: "Otra que tampoco 456",
  });
  assert.equal(pedido.shipAddr, null);
  assert.equal(pedido.retAddr, null);
});

test("una prenda ya alquilada no se puede volver a alquilar", async () => {
  await crearPedido({ items: [prendas[0].id] });

  const res = await como(OTRO, {
    method: "POST",
    url: "/api/orders",
    payload: {
      items: [prendas[0].id],
      start: fecha(1),
      end: fecha(4),
      delivery: "pickup",
      ret: "store",
      pay: "credit",
    },
  });
  assert.equal(res.statusCode, 409);
});

/* ---- Aislamiento entre clientes ---- */

test("cada cliente solo ve sus pedidos, y los ajenos son 404", async () => {
  const mio = await crearPedido({ items: [prendas[0].id] }, CLIENTE);
  await crearPedido({ items: [prendas[1].id] }, OTRO);

  const lista = await como(CLIENTE, { method: "GET", url: "/api/orders" });
  assert.equal(lista.statusCode, 200);
  assert.equal(lista.json().length, 1);
  assert.equal(lista.json()[0].id, mio.id);

  // 404 y no 403: confirmar que existe ya deja contar los pedidos del negocio.
  const ajeno = await como(OTRO, { method: "PATCH", url: `/api/orders/${mio.id}/return`, payload: { ret: "home" } });
  assert.equal(ajeno.statusCode, 404);
});

/* ---- Cambio de devolución: se añade, no se edita ---- */

test("cambiar la devolución añade un ajuste en vez de editar la línea", async () => {
  const pedido = await crearPedido({ ret: "store" });
  const antes = pedido.totalCents;

  const res = await como(CLIENTE, {
    method: "PATCH",
    url: `/api/orders/${pedido.id}/return`,
    payload: { ret: "home", retAddr: "Av. 9 de Octubre 1234" },
  });
  assert.equal(res.statusCode, 200);
  const cambiado = res.json();

  assert.equal(cambiado.ret, "home");
  assert.equal(cambiado.retAddr, "Av. 9 de Octubre 1234");
  assert.equal(cambiado.totalCents, antes + 450);

  const ajustes = cambiado.charges.filter((c) => c.type === "ADJUSTMENT");
  assert.equal(ajustes.length, 1);
  assert.equal(ajustes[0].amountCents, 450);
  assert.match(ajustes[0].note, /local → domicilio/);

  // Las líneas originales siguen intactas: el ledger es un historial, no un
  // estado que se sobrescribe.
  for (const original of pedido.charges) {
    const sigue = cambiado.charges.find((c) => c.id === original.id);
    assert.equal(sigue.amountCents, original.amountCents, `la línea ${original.type} fue editada`);
  }
});

test("ir y volver deja las dos líneas y el total como al principio", async () => {
  const pedido = await crearPedido({ ret: "store" });
  const antes = pedido.totalCents;

  await como(CLIENTE, { method: "PATCH", url: `/api/orders/${pedido.id}/return`, payload: { ret: "home" } });
  const vuelta = await como(CLIENTE, {
    method: "PATCH",
    url: `/api/orders/${pedido.id}/return`,
    payload: { ret: "store" },
  });

  const final = vuelta.json();
  assert.equal(final.totalCents, antes);
  assert.equal(final.charges.filter((c) => c.type === "ADJUSTMENT").length, 2);
  assert.equal(final.retAddr, null);
});

test("cambiar al mismo modo de devolución no genera ajuste de cero", async () => {
  const pedido = await crearPedido({ ret: "store" });
  const res = await como(CLIENTE, {
    method: "PATCH",
    url: `/api/orders/${pedido.id}/return`,
    payload: { ret: "store" },
  });
  assert.equal(res.json().charges.filter((c) => c.type === "ADJUSTMENT").length, 0);
});

/* ---- Frontera del negocio: cobrar es del local ---- */

test("el cliente no puede darse por cobrado a sí mismo", async () => {
  const pedido = await crearPedido({ pay: "cash" });
  const res = await como(CLIENTE, { method: "POST", url: `/api/orders/${pedido.id}/settle` });
  assert.equal(res.statusCode, 403);

  // Y el pedido sigue pendiente, que es lo que de verdad importa.
  const sigue = await como(CLIENTE, { method: "GET", url: "/api/orders" });
  assert.equal(sigue.json()[0].status, "pending");
});

test("el local confirma el efectivo y el pedido queda saldado", async () => {
  const pedido = await crearPedido({ pay: "cash" });
  const res = await como(ADMIN, { method: "POST", url: `/api/orders/${pedido.id}/settle` });
  assert.equal(res.statusCode, 200);

  const saldado = res.json();
  assert.equal(saldado.status, "settled");
  assert.ok(saldado.charges.every((c) => c.status === "SETTLED"));
  // Confirmar el cobro no cambia el importe: solo dice que ese dinero entró.
  assert.equal(saldado.totalCents, pedido.totalCents);

  const repetido = await como(ADMIN, { method: "POST", url: `/api/orders/${pedido.id}/settle` });
  assert.equal(repetido.statusCode, 409);
});

test("liberar el depósito lo devuelve entero y no toca el ingreso", async () => {
  const pedido = await crearPedido();
  const ingresoAntes = pedido.revenueCents;

  const res = await como(ADMIN, { method: "POST", url: `/api/orders/${pedido.id}/deposit-release` });
  assert.equal(res.statusCode, 200);
  const liberado = res.json();

  assert.equal(liberado.depositHeldCents, 0);
  assert.equal(liberado.revenueCents, ingresoAntes, "devolver la garantía no puede mover la facturación");
  assert.equal(liberado.totalCents, ingresoAntes);

  const otraVez = await como(ADMIN, { method: "POST", url: `/api/orders/${pedido.id}/deposit-release` });
  assert.equal(otraVez.statusCode, 409, "el depósito no se devuelve dos veces");
});

test("solo el local libera el depósito y cobra el atraso", async () => {
  const pedido = await crearPedido();
  for (const ruta of ["deposit-release", "late-penalty"]) {
    const res = await como(CLIENTE, { method: "POST", url: `/api/orders/${pedido.id}/${ruta}` });
    assert.equal(res.statusCode, 403, `${ruta} no puede ser del cliente`);
  }
});

test("la penalización por atraso se cobra de verdad y queda pendiente", async () => {
  const pedido = await crearPedido();
  const res = await como(ADMIN, {
    method: "POST",
    url: `/api/orders/${pedido.id}/late-penalty`,
    payload: { note: "Devuelto 5 días tarde" },
  });
  assert.equal(res.statusCode, 200);

  const penalizado = res.json();
  const multa = penalizado.charges.find((c) => c.type === "LATE_PENALTY");
  assert.equal(multa.amountCents, 1500);
  assert.equal(multa.status, "PENDING", "la multa la cobra el local, no la tarjeta guardada");
  assert.equal(multa.note, "Devuelto 5 días tarde");
  assert.equal(penalizado.totalCents, pedido.totalCents + 1500);
  assert.equal(penalizado.status, "pending");
});

/* ---- Anulación ---- */

test("anular deja el pedido en cero sin borrar una sola línea", async () => {
  const pedido = await crearPedido();
  const lineasAntes = pedido.charges.length;

  const res = await como(CLIENTE, { method: "POST", url: `/api/orders/${pedido.id}/cancel` });
  assert.equal(res.statusCode, 200);
  const anulado = res.json();

  assert.equal(anulado.status, "cancelled");
  assert.ok(anulado.cancelledAt);
  assert.equal(anulado.totalCents, 0, "todo lo cobrado se devuelve");
  assert.equal(anulado.charges.length, lineasAntes * 2, "cada línea tiene su reverso");
  // Un pedido anulado también es contabilidad: hubo cobro y hubo devolución.
  assert.ok(anulado.charges.some((c) => /reverso de RENTAL/.test(c.note ?? "")));
});

test("anular devuelve el depósito y no deja devolverlo dos veces", async () => {
  // El reverso de una retención tiene que ser una LIBERACIÓN, no un ajuste
  // genérico: con un ajuste, el pedido anulado seguía contando garantía
  // retenida y el local podía devolver un depósito ya devuelto.
  const pedido = await crearPedido();
  const res = await como(CLIENTE, { method: "POST", url: `/api/orders/${pedido.id}/cancel` });

  assert.equal(res.json().depositHeldCents, 0);
  assert.equal(res.json().revenueCents, 0);

  const otraVez = await como(ADMIN, { method: "POST", url: `/api/orders/${pedido.id}/deposit-release` });
  assert.equal(otraVez.statusCode, 409);
});

test("anular después de liberar el depósito deja igualmente el pedido en cero", async () => {
  const pedido = await crearPedido();
  await como(ADMIN, { method: "POST", url: `/api/orders/${pedido.id}/deposit-release` });
  const res = await como(CLIENTE, { method: "POST", url: `/api/orders/${pedido.id}/cancel` });

  assert.equal(res.json().totalCents, 0);
  assert.equal(res.json().depositHeldCents, 0);
});

test("un cargo no puede señalar a una prenda que no existe", async () => {
  // La línea RENTAL es el desglose que se le enseña a quien reclama. Si puede
  // apuntar a una prenda inexistente, es un cargo que nadie sabe explicar
  // justo cuando hace falta explicarlo. Lo impide la base, no el código.
  const pedido = await crearPedido();
  await assert.rejects(() =>
    prisma.charge.create({
      data: {
        orderId: pedido.id,
        type: "RENTAL",
        amountCents: 100,
        status: "SETTLED",
        productId: 999999,
      },
    })
  );
});

test("un id de pedido que no es número es 404, no un error del servidor", async () => {
  const res = await como(CLIENTE, { method: "GET", url: "/api/orders" });
  assert.equal(res.statusCode, 200);

  const basura = await como(CLIENTE, {
    method: "PATCH",
    url: "/api/orders/abc/return",
    payload: { ret: "home" },
  });
  assert.equal(basura.statusCode, 404);
});

test("anular libera la prenda para otro cliente", async () => {
  const pedido = await crearPedido({ items: [prendas[0].id] });
  await como(CLIENTE, { method: "POST", url: `/api/orders/${pedido.id}/cancel` });

  const res = await como(OTRO, {
    method: "POST",
    url: "/api/orders",
    payload: {
      items: [prendas[0].id],
      start: fecha(1),
      end: fecha(4),
      delivery: "pickup",
      ret: "store",
      pay: "credit",
    },
  });
  assert.equal(res.statusCode, 201);
});

test("un pedido anulado no se anula, ni se cobra, ni se modifica otra vez", async () => {
  const pedido = await crearPedido();
  await como(CLIENTE, { method: "POST", url: `/api/orders/${pedido.id}/cancel` });

  const repetido = await como(CLIENTE, { method: "POST", url: `/api/orders/${pedido.id}/cancel` });
  assert.equal(repetido.statusCode, 409);

  const cambio = await como(CLIENTE, {
    method: "PATCH",
    url: `/api/orders/${pedido.id}/return`,
    payload: { ret: "home" },
  });
  assert.equal(cambio.statusCode, 409);

  const multa = await como(ADMIN, { method: "POST", url: `/api/orders/${pedido.id}/late-penalty` });
  assert.equal(multa.statusCode, 409);
});

test("empezado el alquiler el cliente ya no anula solo, pero el local sí", async () => {
  // Se crea con fecha válida y se retrasa el inicio en la base: la API impide a
  // propósito crear un pedido que empiece ayer, y es justo el caso a probar.
  const pedido = await crearPedido();
  await prisma.order.update({ where: { id: pedido.id }, data: { start: fecha(-1) } });

  const cliente = await como(CLIENTE, { method: "POST", url: `/api/orders/${pedido.id}/cancel` });
  assert.equal(cliente.statusCode, 409);

  const local = await como(ADMIN, { method: "POST", url: `/api/orders/${pedido.id}/cancel` });
  assert.equal(local.statusCode, 200, "el local sí puede: puede comprobar dónde está la prenda");
});
