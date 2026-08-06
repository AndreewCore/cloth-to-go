/**
 * Pruebas de la semilla del catálogo (`prisma/seed.js`).
 *
 * El fallo que originó estas pruebas: la semilla empezaba con `deleteMany()`
 * sobre `products`, así que dejaba de funcionar en cuanto existía un pedido —y
 * `DEPLOY.md` manda ejecutarla en producción—. Lo que se vigila aquí es que se
 * pueda correr sobre una base viva, tantas veces como haga falta, sin tocar el
 * historial.
 *
 * Usa el cliente compartido de `src/db.js` y limpia lo que crea.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import prisma from "../src/db.js";
import { seedCatalog, PRODUCTS } from "../prisma/seed.js";

const SUB = "test-sub-semilla";
/** Id fuera del catálogo, para la prenda que simula una retirada del listado. */
const ID_SOBRANTE = 990001;

/** Borra el usuario de prueba con sus pedidos, cargos y la prenda sobrante. */
async function limpiar() {
  const user = await prisma.user.findUnique({ where: { googleSub: SUB } });
  if (user) {
    const orders = await prisma.order.findMany({ where: { userId: user.id }, select: { id: true } });
    const orderIds = orders.map((o) => o.id);
    await prisma.charge.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.user.delete({ where: { id: user.id } });
  }
  await prisma.product.deleteMany({ where: { id: ID_SOBRANTE } });
}

before(limpiar);

after(async () => {
  await limpiar();
  // Deja el catálogo tal como lo espera el resto de la suite.
  await seedCatalog(prisma);
  await prisma.$disconnect();
});

test("sembrar dos veces seguidas no falla y no duplica", async () => {
  const primera = await seedCatalog(prisma);
  const segunda = await seedCatalog(prisma);

  assert.equal(primera.creadas + primera.actualizadas, PRODUCTS.length);
  // La segunda corrida no crea nada: todas existían ya.
  assert.equal(segunda.creadas, 0);
  assert.equal(segunda.actualizadas, PRODUCTS.length);

  const enBase = await prisma.product.count({ where: { id: { in: PRODUCTS.map((p) => p.id) } } });
  assert.equal(enBase, PRODUCTS.length);
});

test("sembrar con un pedido vivo no revienta ni se lleva el historial por delante", async () => {
  // Este es el caso exacto que rompía: un OrderItem y un Charge apuntando a una
  // prenda del catálogo impiden borrarla.
  const prenda = PRODUCTS[0];
  const user = await prisma.user.create({
    data: { googleSub: SUB, email: "semilla@test", name: "Semilla" },
  });
  const order = await prisma.order.create({
    data: {
      userId: user.id,
      start: "2026-08-10",
      end: "2026-08-13",
      delivery: "pickup",
      ret: "store",
      pay: "credit",
      items: { create: { productId: prenda.id } },
      charges: {
        create: {
          type: "RENTAL",
          amountCents: 1234,
          status: "SETTLED",
          method: "CARD",
          productId: prenda.id,
          note: "alquiler de prueba",
        },
      },
    },
  });

  await seedCatalog(prisma);

  // El pedido, su línea y su cargo siguen enteros y apuntando a la misma prenda.
  const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
  assert.equal(items.length, 1);
  assert.equal(items[0].productId, prenda.id);

  const charges = await prisma.charge.findMany({ where: { orderId: order.id } });
  assert.equal(charges.length, 1);
  assert.equal(charges[0].productId, prenda.id, "el cargo se quedó sin prenda: ya no se puede explicar");
  assert.equal(charges[0].amountCents, 1234);
});

test("corrige a la lista una prenda editada a mano en la base", async () => {
  const prenda = PRODUCTS[0];
  await prisma.product.update({ where: { id: prenda.id }, data: { name: "Nombre equivocado", value: 999 } });

  await seedCatalog(prisma);

  const tras = await prisma.product.findUnique({ where: { id: prenda.id } });
  assert.equal(tras.name, prenda.name);
  assert.equal(tras.value, prenda.value);
});

test("una prenda fuera de la lista se conserva y se reporta como sobrante", async () => {
  const modelo = PRODUCTS[0];
  await prisma.product.create({
    data: { ...modelo, id: ID_SOBRANTE, name: "Prenda retirada del listado" },
  });

  const { sobrantes } = await seedCatalog(prisma);

  const sigueAhi = await prisma.product.findUnique({ where: { id: ID_SOBRANTE } });
  assert.ok(sigueAhi, "la semilla borró una prenda que podría tener pedidos");
  assert.ok(
    sobrantes.some((s) => s.id === ID_SOBRANTE),
    "la prenda sobrante no se reportó, así que nadie se entera de que está",
  );
});

test("importar la semilla no siembra por sí solo", async () => {
  // Si importarla ejecutara main(), el guardarraíl del catálogo del frontend
  // abriría una conexión a la base cada vez que lee el listado.
  await prisma.product.update({ where: { id: PRODUCTS[0].id }, data: { name: "Centinela" } });
  const mod = await import("../prisma/seed.js");
  assert.ok(typeof mod.seedCatalog === "function");

  const tras = await prisma.product.findUnique({ where: { id: PRODUCTS[0].id } });
  assert.equal(tras.name, "Centinela", "el módulo sembró al importarse");

  await seedCatalog(prisma);
});
