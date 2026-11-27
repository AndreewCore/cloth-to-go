/**
 * Arma, por la API, una reseña lista para moderar: modelo y ejemplar nuevos,
 * un pedido del autor ya cumplido y su reseña PENDIENTE. Lo comparten las
 * pruebas de moderación y de avisos.
 */
import assert from "node:assert/strict";
import prisma from "../../src/db.js";
import { addDaysISO, todayISO } from "../../src/dates.js";
import { habil, markDelivered } from "./db.js";

/**
 * Crea la reseña.
 * @param {(sub: string, opts: object) => Promise<object>} como Petición firmada como `sub`.
 * @param {{inventario: string, autor: string, modelos: number[]}} who Cuentas y
 *   la lista donde se apunta el modelo creado (para `purge()`).
 * @returns {Promise<object>} Reseña de la API, con `productId`.
 */
export async function reviewFixture(como, { inventario, autor, modelos }) {
  const m = (await como(inventario, {
    method: "POST",
    url: "/api/products",
    payload: { name: "Falda moderada", categoryKey: "casual", material: "algodon", value: 20, stars: 3, weightKg: 0.2 },
  })).json();
  modelos.push(m.id);
  const molde = await prisma.item.findFirst({ orderBy: { id: "asc" } });
  const item = (await como(inventario, {
    method: "POST",
    url: `/api/products/${m.id}/items`,
    payload: { size: molde.size, sizeScale: molde.sizeScale, color: molde.color },
  })).json();
  const order = (await como(autor, {
    method: "POST",
    url: "/api/orders",
    payload: { items: [item.id], start: habil(1), end: habil(1), delivery: "pickup", ret: "store", pay: "cash" },
  })).json();
  // La API no acepta fechas pasadas: se mueve el inicio y se da por entregado
  // para que cuente como cumplido.
  await prisma.order.update({ where: { id: order.id }, data: { start: addDaysISO(todayISO(), -3) } });
  await markDelivered(order.id);

  const b = "----ctgmod";
  const campos = { orderId: order.id, productId: m.id, rating: 4, text: "Me quedó perfecta" };
  const cuerpo = Object.entries(campos).map(([k, v]) => `--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join("") + `--${b}--\r\n`;
  const res = await como(autor, { method: "POST", url: "/api/reviews", payload: cuerpo, headers: { "content-type": `multipart/form-data; boundary=${b}` } });
  assert.equal(res.statusCode, 201, res.body);
  return { ...res.json(), productId: m.id };
}
