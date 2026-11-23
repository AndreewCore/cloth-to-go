/**
 * Solo el servidor cotiza (fase 3): el catálogo trae el precio de cada prenda
 * y `POST /api/quote` cotiza el carrito con la MISMA función que después cobra
 * `POST /api/orders`. Lo que se enseña y lo que se cobra no pueden separarse.
 *
 * Asume la base sembrada (`pnpm db:reset`), como el resto de la suite.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import prisma from "../src/db.js";
import { demoItems, habil, loadHolidays, purge } from "./helpers/db.js";

const CLIENTE = "test-sub-cotizacion";

let app;
let prendas;

/** Petición firmada como el cliente de prueba (o sin firmar). */
function inject(opts, sub = CLIENTE) {
  const headers = sub ? { authorization: `Bearer ${sub}` } : {};
  return app.inject({ ...opts, headers: { ...opts.headers, ...headers } });
}

/** Cotiza; devuelve la respuesta cruda. */
function cotizar(body, sub = CLIENTE) {
  return inject({ method: "POST", url: "/api/quote", payload: body }, sub);
}

const BASE = () => ({
  items: [prendas[0].id, prendas[3].id],
  start: habil(1),
  end: habil(4),
  delivery: "ship",
  ret: "home",
});

before(async () => {
  await loadHolidays();
  app = buildApp({ verifyGoogleToken: async (t) => ({ sub: t, email: `${t}@test`, name: t }) });
  await app.ready();
  prendas = await demoItems(app);
});

beforeEach(() => purge({ subs: [CLIENTE] }));

after(async () => {
  await purge({ subs: [CLIENTE] });
  await app.close();
  await prisma.$disconnect();
});

test("cada prenda del catálogo trae su escalera de precios y su garantía", async () => {
  const productos = (await app.inject({ method: "GET", url: "/api/products" })).json();
  for (const p of productos) {
    assert.equal(p.price.ladder.length, 14, `prenda ${p.id}`);
    for (let d = 1; d < 14; d++) assert.ok(p.price.ladder[d] >= p.price.ladder[d - 1], "más días nunca cuesta menos");
    assert.equal(p.price.nextDay, Math.round((p.price.ladder[1] - p.price.ladder[0]) * 100) / 100);
    assert.ok(p.price.deposit > 0);
  }
});

test("lo cotizado es exactamente lo que se cobra al pedir", async () => {
  const body = BASE();
  const q = (await cotizar(body, null)).json();
  const pedido = await inject({
    method: "POST",
    url: "/api/orders",
    payload: { ...body, pay: "credit", shipAddr: "Av. Principal 123 y Segunda", retAddr: "Av. Principal 123 y Segunda" },
  });
  assert.equal(pedido.statusCode, 201, pedido.body);
  const o = pedido.json();
  assert.equal(q.totalCents, o.totalCents);
  assert.equal(q.depositCents, o.depositHeldCents);
  assert.equal(q.points, o.points);
  assert.equal(q.returnBy, o.returnBy);
});

test("desglosa alquiler, logística, garantía y ahorro por volumen", async () => {
  const base = BASE();
  const q = (await cotizar(base, null)).json();
  // Días naturales entre las fechas: según el día en que corra la prueba, los
  // hábiles 1 → 4 cruzan o no un fin de semana, así que no es un número fijo.
  assert.equal(q.days, (Date.parse(base.end) - Date.parse(base.start)) / 86_400_000);
  assert.equal(q.shippingCents, 450);
  assert.equal(q.returnCents, 450);
  assert.equal(q.totalCents, q.rentalCents + q.shippingCents + q.returnCents + q.depositCents - q.discountCents);
  assert.ok(q.volumeSavingsCents >= 0);
  assert.equal(q.ladderCents.length, 60);
  assert.equal(q.ladderCents[q.days - 1], q.rentalCents, "la escalera del carrito cuadra con el alquiler");
  const solo = (await cotizar({ ...BASE(), items: [prendas[0].id] }, null)).json();
  assert.equal(solo.volumeSavingsCents, 0, "una prenda sola no tiene descuento por volumen");
});

test("sin modos elegidos cotiza retiro y devolución en el local", async () => {
  const { delivery, ret, ...sinModos } = BASE();
  const q = (await cotizar(sinModos, null)).json();
  assert.equal(q.shippingCents + q.returnCents, 0);
  assert.ok(delivery && ret);
});

test("con sesión, la cotización valora el premio; sin ella, lo explica", async () => {
  const u = await prisma.user.create({ data: { googleSub: CLIENTE, email: "c@test", name: "C" } });
  const c = await prisma.coupon.create({ data: { userId: u.id, rewardId: 1, cost: 60 } }); // envío gratis
  const con = (await cotizar({ ...BASE(), couponId: c.id })).json();
  assert.equal(con.discountCents, 450);
  assert.equal(con.couponId, c.id);
  const sin = (await cotizar({ ...BASE(), couponId: c.id }, null)).json();
  assert.equal(sin.discountCents, 0);
  assert.match(sin.couponIssue, /no está disponible/);
  const usado = await prisma.coupon.findUnique({ where: { id: c.id } });
  assert.equal(usado.usedInOrderId, null, "cotizar no gasta el premio");
});

test("un cuerpo malformado es 400, no 500", async () => {
  for (const malo of [{}, { ...BASE(), items: [] }, { ...BASE(), items: ["x"] }, { ...BASE(), start: "ayer" },
    { ...BASE(), delivery: "dron" }, { ...BASE(), items: [prendas[0].id, prendas[0].id] }]) {
    assert.equal((await cotizar(malo, null)).statusCode, 400, JSON.stringify(malo));
  }
});

test("GET /api/config dice las tarifas que el cliente enseña en sus textos", async () => {
  const cfg = (await app.inject({ method: "GET", url: "/api/config" })).json();
  assert.equal(cfg.shippingFee, 4.5);
  assert.equal(cfg.volumeDiscountMax, 0.2);
});
