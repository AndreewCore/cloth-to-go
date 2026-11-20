/**
 * Valor de cada premio en un alquiler (server/src/rewards.js). Puro: sin base.
 *
 * Venían de test/rewards.test.js del frontend, cuando el navegador valoraba
 * los premios; desde la fase 3 solo los valora el servidor.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cents, rentalPrice } from "../src/pricing.js";
import { REWARDS, orderPoints, rewardById, rewardDiscountCents, rewardIssue } from "../src/rewards.js";
import { PRODUCTS } from "../prisma/seed.js";

const premium = PRODUCTS.find((p) => p.stars >= 5);
const otra = PRODUCTS.find((p) => p.id !== premium.id && p.stars < 5);
const ctx = (over = {}) => ({ items: [premium, otra], days: 4, delivery: "ship", ret: "home", ...over });
const suma = (items, d) => items.reduce((s, p) => s + cents(rentalPrice(p, d, items.length)), 0);

test("envío gratis cubre UNA tarifa de logística, y nada si no hay domicilio", () => {
  assert.equal(rewardDiscountCents(rewardById(1), ctx()), 450);
  assert.equal(rewardDiscountCents(rewardById(1), ctx({ delivery: "pickup", ret: "store" })), 0);
  assert.match(rewardIssue(rewardById(1), ctx({ delivery: "pickup", ret: "store" })), /domicilio/);
});

test("1 día gratis descuenta la diferencia con un día menos, y no aplica a un día", () => {
  const c = ctx();
  assert.equal(rewardDiscountCents(rewardById(2), c), suma(c.items, 4) - suma(c.items, 3));
  assert.equal(rewardDiscountCents(rewardById(2), ctx({ days: 1 })), 0);
  assert.match(rewardIssue(rewardById(2), ctx({ days: 1 })), /2 días/);
});

test("el 10 % va sobre el alquiler, no sobre la garantía ni el envío", () => {
  const c = ctx();
  assert.equal(rewardDiscountCents(rewardById(3), c), Math.round(suma(c.items, 4) * 0.1));
});

test("la prenda premium sale gratis solo por los días que cubre el premio", () => {
  const c = ctx({ days: 10 });
  const dos = cents(rentalPrice(premium, 2, 2));
  assert.equal(rewardDiscountCents(rewardById(4), c), dos);
  const sinDestacadas = ctx({ items: PRODUCTS.filter((p) => p.stars < 5).slice(0, 2) });
  assert.equal(rewardDiscountCents(rewardById(4), sinDestacadas), 0);
  assert.doesNotMatch(rewardIssue(rewardById(4), sinDestacadas), /[★☆]/, "en palabras, no con estrellas");
});

test("ningún premio deja el cobro por debajo de cero ni toca la garantía", () => {
  for (const rw of REWARDS) {
    for (const days of [1, 2, 5]) {
      const c = ctx({ days });
      const tope = suma(c.items, days) + 450 + 450;
      const d = rewardDiscountCents(rw, c);
      assert.ok(d >= 0 && d <= tope, `${rw.type} ${days}d: ${d} fuera de [0, ${tope}]`);
    }
  }
});

test("lo cubierto por un premio no vuelve a puntuar", () => {
  const sin = orderPoints({ spendCents: 5000, days: 3, itemCount: 2 });
  const con = orderPoints({ spendCents: 5000 - 450, days: 3, itemCount: 2 });
  assert.equal(sin - con, 45);
});
