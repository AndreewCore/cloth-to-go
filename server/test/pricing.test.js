/**
 * Modelo de precios (server/src/pricing.js): tarifa por tramos, descuento por
 * volumen, piso de coste y garantías.
 *
 * Hasta la fase 3 estas pruebas vivían en la suite del frontend, contra la
 * copia de js/data.js, y una prueba de paridad ataba las dos copias. Desde que
 * solo el servidor cotiza ya no hay copia: las invariantes se vigilan aquí,
 * sobre el único cálculo que existe.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEPOSIT_MAX,
  DEPOSIT_ORDER_MAX,
  MIN_MARGIN,
  cycleCost,
  depositFor,
  depositForItems,
  garmentCycles,
  rentalFloor,
  rentalListPrice,
  rentalPrice,
  volumeDiscountRate,
} from "../src/pricing.js";
import { PRODUCTS } from "../prisma/seed.js";

const byId = (id) => PRODUCTS.find((p) => p.id === id);

test("cycleCost = amortización + lavandería + overhead", () => {
  // Esmoquin: value 150, 5★ (30 ciclos), lana (lavandería 5.00), overhead 0.50.
  assert.equal(cycleCost(byId(7)), 150 / 30 + 5 + 0.5);
});

test("garmentCycles = 6 ciclos por estrella", () => {
  assert.equal(garmentCycles(byId(7)), 30);
  assert.equal(garmentCycles(byId(8)), 12);
});

test("tarifa por tramos en una prenda premium (sin tocar el piso)", () => {
  const p = byId(7); // día 1 = 0.10 · 150 = 15
  assert.equal(rentalPrice(p, 1), 15.0);
  assert.equal(rentalPrice(p, 2), 22.5);
  assert.equal(rentalPrice(p, 3), 30.0);
  assert.equal(rentalPrice(p, 4), 34.5);
});

test("descuento por volumen: 5 % por prenda extra, tope 20 %", () => {
  assert.equal(volumeDiscountRate(1), 0);
  assert.equal(volumeDiscountRate(2), 0.05);
  assert.equal(volumeDiscountRate(3), 0.1);
  assert.equal(volumeDiscountRate(5), 0.2);
  assert.equal(volumeDiscountRate(10), 0.2);
  assert.equal(rentalPrice(byId(7), 1, 2), 14.25, "15 · 0.95, aún sobre el piso");
});

test("INVARIANTE: ningún alquiler baja del coste de ciclo, en ninguna duración", () => {
  for (const p of PRODUCTS) {
    for (const days of [1, 2, 3, 5, 7, 14, 30]) {
      for (const items of [1, 3, 10]) {
        const price = rentalPrice(p, days, items);
        assert.ok(price >= cycleCost(p) - 1e-9, `prenda ${p.id} ${days}d x${items}: ${price} < ${cycleCost(p)}`);
        assert.ok(price >= rentalFloor(p) - 0.005, `prenda ${p.id} ${days}d x${items}: ${price} < piso`);
      }
    }
  }
});

test("una prenda barata queda anclada al piso en toda duración", () => {
  const falda = byId(6);
  const floor = Math.round(rentalFloor(falda) * 100) / 100;
  for (const days of [1, 2, 3, 5, 7, 10]) assert.equal(rentalPrice(falda, days), floor);
});

test("el piso se aplica DESPUÉS del descuento por volumen", () => {
  const price = rentalPrice(byId(7), 1, 3); // 15 · 0.90 = 13.50 < piso ≈ 14.175
  assert.ok(Math.abs(price - rentalFloor(byId(7))) < 0.02, `esperaba ≈ piso, salió ${price}`);
});

test("garantía: 40 % del valor, tope por prenda y por pedido", () => {
  assert.equal(depositFor(byId(6)), 5);
  assert.equal(depositFor(byId(1)), 14);
  assert.equal(depositFor(byId(7)), DEPOSIT_MAX);
  assert.equal(depositForItems([7, 4].map(byId)), DEPOSIT_ORDER_MAX);
  assert.ok(depositForItems([1, 4].map(byId)) > depositForItems([1].map(byId)), "no baja por volumen");
});

test("precio de lista y piso", () => {
  assert.equal(rentalListPrice(byId(7), 3), 30);
  assert.ok(rentalListPrice(byId(6), 1) < rentalFloor(byId(6)), "la lista sí baja del piso");
  assert.equal(rentalFloor(byId(7)), cycleCost(byId(7)) * (1 + MIN_MARGIN));
});

/* ---- Casos límite (venían de test/edge-cases.test.js del frontend) ---- */

test("bordes de tramo: el día 4 pesa 0.30 y el día 8 pesa 0.15", () => {
  const p = byId(7); // día 1 = 15
  assert.equal(rentalListPrice(p, 4) - rentalListPrice(p, 3), 4.5);
  assert.equal(rentalListPrice(p, 8) - rentalListPrice(p, 7), 2.25);
});

test("topes con carritos enormes: garantía 40 y volumen 20 %", () => {
  assert.equal(depositForItems(Array(10).fill(byId(7))), DEPOSIT_ORDER_MAX);
  assert.equal(volumeDiscountRate(50), 0.2);
});

test("material desconocido cae a la lavandería del algodón", () => {
  assert.equal(cycleCost({ value: 100, stars: 5, material: "desconocido" }), 100 / 30 + 1.5 + 0.5);
});

test("estrellas fuera de rango: el día 1 cae a 0.06 y 0★ deja el ciclo indefinido", () => {
  assert.equal(garmentCycles({ stars: 0 }), 0);
  assert.equal(cycleCost({ value: 100, stars: 0, material: "algodon" }), Infinity);
  assert.equal(rentalListPrice({ value: 100, stars: 6, material: "algodon" }, 1), 6);
});
