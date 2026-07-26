/**
 * Pruebas del MODELO DE PRECIOS (js/data.js): tarifa por tramos, descuento por
 * volumen, piso de coste y depósitos. Bloquea las invariantes documentadas en
 * data.js para que un cambio de fórmula no las rompa en silencio.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp } = require("./helpers/load-app.js");

const A = loadApp();
const byId = A.productById;

test("cycleCost = amortización + lavandería + overhead", () => {
  // Esmoquin: value 150, 5★ (30 ciclos), lana (lavandería 5.00), overhead 0.50.
  assert.equal(A.cycleCost(byId(7)), 150 / 30 + 5 + 0.5); // 10.5
});

test("garmentCycles = 6 ciclos por estrella", () => {
  assert.equal(A.garmentCycles(byId(7)), 30); // 5★
  assert.equal(A.garmentCycles(byId(8)), 12); // 2★
});

test("tarifa por tramos en una prenda premium (sin tocar el piso)", () => {
  const p = byId(7); // Esmoquin 150, 5★ → día 1 = 0.10·150 = 15
  assert.equal(A.rentalPrice(p, 1), 15.0);
  assert.equal(A.rentalPrice(p, 2), 22.5); // +50%
  assert.equal(A.rentalPrice(p, 3), 30.0); // +50%
  assert.equal(A.rentalPrice(p, 4), 34.5); // +30%
});

test("descuento por volumen: 5% por prenda extra, tope 20%", () => {
  assert.equal(A.volumeDiscountRate(1), 0);
  assert.equal(A.volumeDiscountRate(2), 0.05);
  assert.equal(A.volumeDiscountRate(3), 0.1);
  assert.equal(A.volumeDiscountRate(5), 0.2);
  assert.equal(A.volumeDiscountRate(10), 0.2); // capado
});

test("el volumen abarata una prenda premium", () => {
  const p = byId(7);
  // 15 · (1 - 0.05) = 14.25, aún por encima del piso.
  assert.equal(A.rentalPrice(p, 1, 2), 14.25);
});

test("INVARIANTE: ningún alquiler baja del coste de ciclo, en ninguna duración", () => {
  for (const p of A.PRODUCTS) {
    for (const days of [1, 2, 3, 5, 7, 14, 30]) {
      for (const items of [1, 3, 10]) {
        const price = A.rentalPrice(p, days, items);
        assert.ok(
          price >= A.cycleCost(p) - 1e-9,
          `prenda ${p.id} ${days}d x${items}: ${price} < cycleCost ${A.cycleCost(p)}`
        );
        // El piso duro es cycleCost · (1 + margen); se admite el redondeo a centavos.
        assert.ok(
          price >= A.rentalFloor(p) - 0.005,
          `prenda ${p.id} ${days}d x${items}: ${price} < rentalFloor ${A.rentalFloor(p)}`
        );
      }
    }
  }
});

test("prenda barata queda anclada al piso en TODA duración", () => {
  const falda = byId(6); // value 12, 3★, sintético → piso 3.60
  const floor = Math.round(A.rentalFloor(falda) * 100) / 100;
  for (const days of [1, 2, 3, 5, 7, 10]) {
    assert.equal(A.rentalPrice(falda, days), floor);
  }
  // Anclada ⇒ un día extra no encarece nada.
  assert.equal(A.nextDayPrice(falda), 0);
});

test("el piso se aplica DESPUÉS del descuento por volumen", () => {
  const p = byId(7); // Esmoquin, piso ≈ 14.175
  // 15 · (1 - 0.10) = 13.50 < piso ⇒ se sube al piso, no se queda en 13.50.
  const price = A.rentalPrice(p, 1, 3);
  assert.ok(Math.abs(price - A.rentalFloor(p)) < 0.02, `esperaba ≈ piso, got ${price}`);
  assert.ok(price > 13.5);
});

test("depositFor: 40% del valor, tope de 25 por prenda", () => {
  assert.equal(A.depositFor(byId(6)), 5); // 0.4·12 = 4.8 → 5
  assert.equal(A.depositFor(byId(1)), 14); // 0.4·35 = 14
  assert.equal(A.depositFor(byId(7)), A.DEPOSIT_MAX); // 0.4·150 = 60 → 25
});

test("depositForItems: tope de pedido de 40", () => {
  // Esmoquin (25) + Abrigo (0.4·55=22→25) = 50 → capado a 40.
  assert.equal(A.depositForItems([7, 4].map(byId)), A.DEPOSIT_ORDER_MAX);
  // El depósito NO baja por volumen: dos prendas suman más que una.
  assert.ok(A.depositForItems([1, 4].map(byId)) > A.depositForItems([1].map(byId)));
});

test("rentalListPrice: precio de lista por tramos, antes de piso y descuento", () => {
  const p = byId(7); // Esmoquin, día 1 = 15
  assert.equal(A.rentalListPrice(p, 1), 15);
  assert.equal(A.rentalListPrice(p, 3), 30); // 15 + 7.5 + 7.5
  // No aplica el piso: una prenda barata SÍ baja por debajo de su piso aquí.
  assert.ok(A.rentalListPrice(byId(6), 1) < A.rentalFloor(byId(6)));
});

test("rentalFloor = cycleCost · (1 + margen mínimo)", () => {
  const p = byId(7);
  assert.equal(A.rentalFloor(p), A.cycleCost(p) * (1 + A.MIN_MARGIN)); // 10.5 · 1.35 = 14.175
});
