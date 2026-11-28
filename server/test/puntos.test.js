/**
 * Puntos y canjes validados en el servidor (§2 de PENDIENTE).
 *
 * Las cinco invariantes que el navegador ya respetaba, ahora donde no se pueden
 * esquivar desde la consola:
 * 1. El descuento nunca toca el depósito.
 * 2. Un cupón que descuenta $0 no se consume.
 * 3. Los puntos se acreditan al entregar (al día siguiente del inicio, cuando
 *    el pedido ya no se puede anular), no al pagar.
 * 4. Anular revierte los puntos y libera el cupón.
 * 5. Un cupón se usa una sola vez, también con dos checkouts simultáneos.
 *
 * Asume la base sembrada (`pnpm db:reset`), como el resto de la suite.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import prisma from "../src/db.js";
import { todayISO, addDaysISO } from "../src/dates.js";
import { WATER_GOALS, orderPoints } from "../src/rewards.js";
import { demoItems, grant, habil, loadHolidays, markDelivered, purge } from "./helpers/db.js";

const CLIENTE = "test-sub-puntos";
const OTRO = "test-sub-puntos-otro";
const ADMIN = "test-sub-puntos-admin";
const SUBS = [CLIENTE, OTRO, ADMIN];

let app;
let prendas;

/** Petición firmada como `sub` (el token falso ES la identidad). */
function como(sub, opts) {
  return app.inject({ ...opts, headers: { ...opts.headers, authorization: `Bearer ${sub}` } });
}

/** Crea un pedido; devuelve la respuesta cruda. */
function pedir(over = {}, sub = CLIENTE) {
  return como(sub, {
    method: "POST",
    url: "/api/orders",
    payload: {
      items: [prendas[0].id],
      start: habil(1),
      end: habil(4),
      delivery: "pickup",
      ret: "store",
      pay: "credit",
      ...over,
    },
  });
}

/** Saldo y cupones de `sub`. */
async function puntos(sub = CLIENTE) {
  const res = await como(sub, { method: "GET", url: "/api/me/points" });
  assert.equal(res.statusCode, 200, res.body);
  return res.json();
}

/** Regala puntos a la cuenta sin pasar por un pedido (para poder canjear). */
async function regalar(sub, delta) {
  const u = await prisma.user.upsert({
    where: { googleSub: sub },
    update: {},
    create: { googleSub: sub, email: `${sub}@test`, name: sub },
  });
  // Una meta inventada (id alto) es la forma de sumar sin pedido que la clave
  // única deja repetir una sola vez por cuenta.
  await prisma.pointsEntry.create({ data: { userId: u.id, delta, reason: "WATER_GOAL", goalId: 900 + delta } });
}

/** Canjea el premio `rewardId`; devuelve la respuesta cruda. */
function canjear(rewardId, sub = CLIENTE) {
  return como(sub, { method: "POST", url: `/api/rewards/${rewardId}/redeem` });
}

/** Lleva el inicio de un pedido a ayer y registra su entrega: fuera de la anulación. */
async function entregar(orderId) {
  await prisma.order.update({ where: { id: orderId }, data: { start: addDaysISO(todayISO(), -1) } });
  await markDelivered(orderId);
}

before(async () => {
  await loadHolidays();
  app = buildApp({ verifyGoogleToken: async (token) => ({ sub: token, email: `${token}@test`, name: token }) });
  await app.ready();
  prendas = await demoItems(app);
});

beforeEach(async () => {
  await purge({ subs: SUBS });
  await grant(ADMIN, ["ADMINISTRACION"]);
});

after(async () => {
  await purge({ subs: SUBS });
  await app.close();
  await prisma.$disconnect();
});

/* ---- Acreditar ---- */

test("los puntos se fijan al crear el pedido y entran al saldo al entregarse, no antes", async () => {
  const pedido = (await pedir()).json();
  const esperados = orderPoints({ spendCents: pedido.revenueCents, days: pedido.days, itemCount: 1 });
  assert.equal(pedido.points, esperados);
  assert.equal(pedido.pointsCredited, false);
  assert.equal((await puntos()).balance, 0, "mientras se pueda anular, no está ganado");

  await entregar(pedido.id);
  assert.equal((await puntos()).balance, esperados);
  assert.equal((await puntos()).balance, esperados, "leer dos veces no acredita dos veces");
  const [listado] = (await como(CLIENTE, { method: "GET", url: "/api/orders" })).json();
  assert.equal(listado.pointsCredited, true);
});

test("las metas de agua pagan una sola vez cuando los litros cumplidos las alcanzan", async () => {
  const ids = [];
  for (const p of prendas.slice(0, 5)) {
    const r = await pedir({ items: [p.id] });
    assert.equal(r.statusCode, 201, r.body);
    ids.push(r.json().id);
  }
  for (const id of ids) await entregar(id);
  const { water, balance } = await puntos();
  const alcanzadas = WATER_GOALS.filter((g) => water.liters >= g.liters);
  assert.deepEqual(water.reached.sort(), alcanzadas.map((g) => g.id).sort());
  const deMetas = alcanzadas.reduce((s, g) => s + g.points, 0);
  const pedidos = (await como(CLIENTE, { method: "GET", url: "/api/orders" })).json();
  assert.equal(balance, deMetas + pedidos.reduce((s, o) => s + o.points, 0));
});

/* ---- Canjear ---- */

test("canjear sin puntos suficientes se rechaza", async () => {
  assert.equal((await canjear(1)).statusCode, 409);
});

test("canjear descuenta el coste y deja un cupón disponible", async () => {
  await regalar(CLIENTE, 200);
  const res = await canjear(3); // 10 %, 150 pts
  assert.equal(res.statusCode, 201, res.body);
  const cuerpo = res.json();
  assert.equal(cuerpo.balance, 50);
  assert.equal(cuerpo.coupon.rewardId, 3);
  assert.equal(cuerpo.coupon.usedIn, null);
});

test("dos canjes simultáneos no gastan dos veces el mismo saldo", async () => {
  await regalar(CLIENTE, 100);
  const res = await Promise.all([canjear(1), canjear(1)]); // 60 pts cada uno
  assert.deepEqual(res.map((r) => r.statusCode).sort(), [201, 409]);
  assert.equal((await puntos()).balance, 40);
});

test("el personal no canjea premios", async () => {
  assert.equal((await canjear(1, ADMIN)).statusCode, 403);
});

/* ---- Aplicar el cupón ---- */

test("el cupón rebaja el alquiler con una línea DISCOUNT y nunca toca el depósito", async () => {
  const sin = (await pedir({ items: [prendas[1].id] })).json();
  await regalar(CLIENTE, 200);
  const cupon = (await canjear(3)).json().coupon;
  const con = (await pedir({ items: [prendas[2].id], couponId: cupon.id })).json();

  const alquiler = con.charges.filter((c) => c.type === "RENTAL").reduce((s, c) => s + c.amountCents, 0);
  assert.equal(con.discountCents, Math.round(alquiler * 0.1));
  assert.equal(con.couponId, cupon.id);
  const deposito = (o) => o.charges.filter((c) => c.type === "DEPOSIT_HOLD").reduce((s, c) => s + c.amountCents, 0);
  assert.equal(con.depositHeldCents, deposito(con), "la garantía entra entera");
  assert.ok(sin.depositHeldCents > 0);
  assert.equal(con.points, orderPoints({ spendCents: con.revenueCents, days: con.days, itemCount: 1 }),
    "lo cubierto por el premio no vuelve a puntuar");

  const otra = await pedir({ items: [prendas[3].id], couponId: cupon.id });
  assert.equal(otra.statusCode, 409, "un cupón se usa una sola vez");
});

test("un cupón que no rebaja nada no se consume, y la respuesta dice por qué", async () => {
  await regalar(CLIENTE, 100);
  const cupon = (await canjear(1)).json().coupon; // envío gratis
  const res = await pedir({ couponId: cupon.id }); // retiro y devolución en el local
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().couponId, null);
  assert.equal(res.json().discountCents, 0);
  assert.match(res.json().couponIssue, /domicilio/);
  const { coupons } = await puntos();
  assert.equal(coupons.find((c) => c.id === cupon.id).usedIn, null);
});

test("dos checkouts simultáneos con el mismo cupón: solo uno se lo lleva", async () => {
  await regalar(CLIENTE, 200);
  const cupon = (await canjear(3)).json().coupon;
  const res = await Promise.all([
    pedir({ items: [prendas[1].id], couponId: cupon.id }),
    pedir({ items: [prendas[2].id], couponId: cupon.id }),
  ]);
  assert.deepEqual(res.map((r) => r.statusCode).sort(), [201, 409], res.map((r) => r.body).join(" | "));
});

test("el cupón de otra cuenta no se puede usar", async () => {
  await regalar(OTRO, 200);
  const ajeno = (await canjear(3, OTRO)).json().coupon;
  assert.equal((await pedir({ couponId: ajeno.id })).statusCode, 409);
});

test("un importe o descuento en el cuerpo se ignora", async () => {
  const res = await pedir({ discount: 999, discountCents: 99900, total: 1 });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().discountCents, 0);
});

test("cambiar la devolución revalora un premio de envío con una línea nueva", async () => {
  await regalar(CLIENTE, 100);
  const cupon = (await canjear(1)).json().coupon;
  const pedido = (await pedir({ ret: "home", retAddr: "Av. Principal 123 y Segunda", couponId: cupon.id })).json();
  assert.equal(pedido.discountCents, 450);

  const res = await como(CLIENTE, { method: "PATCH", url: `/api/orders/${pedido.id}/return`, payload: { ret: "store" } });
  const editado = res.json();
  assert.equal(editado.discountCents, 0, "sin domicilio, el premio de envío ya no rebaja");
  assert.equal(editado.charges.filter((c) => c.type === "DISCOUNT").length, 2, "no se edita la línea: se añade");
  assert.equal(editado.totalCents, pedido.totalCents, "el +$4.50 del retiro y el −$4.50 del premio se compensan");
});

/* ---- Anular ---- */

test("anular libera el cupón para otro pedido", async () => {
  await regalar(CLIENTE, 200);
  const cupon = (await canjear(3)).json().coupon;
  const pedido = (await pedir({ couponId: cupon.id })).json();
  await como(CLIENTE, { method: "POST", url: `/api/orders/${pedido.id}/cancel` });
  const { coupons } = await puntos();
  assert.equal(coupons.find((c) => c.id === cupon.id).usedIn, null);
  assert.equal((await pedir({ items: [prendas[1].id], couponId: cupon.id })).statusCode, 201);
});

test("anular un pedido ya premiado quita sus puntos, revocando canjes sin usar si hace falta", async () => {
  const pedido = (await pedir({ items: [prendas[4].id], end: habil(8) })).json();
  await entregar(pedido.id);
  const ganado = (await puntos()).balance;
  assert.ok(ganado >= 60, `el pedido de prueba debería dar al menos 60 pts (dio ${ganado})`);

  // Se gastan en un canje: el saldo ya no alcanza para devolverlos.
  assert.equal((await canjear(1)).statusCode, 201);
  const anulado = await como(ADMIN, { method: "POST", url: `/api/orders/${pedido.id}/cancel` });
  assert.equal(anulado.statusCode, 200, anulado.body);

  const despues = await puntos();
  assert.equal(despues.balance, 0, "los puntos del pedido salen; nada queda en negativo");
  assert.ok(despues.coupons.every((c) => c.revoked), "el canje que financiaron se revoca");
});
