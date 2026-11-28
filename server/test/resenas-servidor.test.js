/**
 * Reseñas en el servidor (fase 4): solo de alquileres verificados, todas
 * pendientes de moderación, y la foto por la tubería de siempre.
 *
 * Cada prueba usa un modelo y un pedido propios. Para que el pedido cuente
 * como cumplido se mueve su inicio al pasado: la API no acepta fechas pasadas.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { buildApp } from "../src/app.js";
import prisma from "../src/db.js";
import { createDiskStorage } from "../src/storage.js";
import { publicAuthor } from "../src/reviews.js";
import { addDaysISO, todayISO } from "../src/dates.js";
import { grant, habil, loadHolidays, markDelivered, purge } from "./helpers/db.js";

const CLIENTE = "test-sub-resena-cliente";
const OTRO = "test-sub-resena-otro";
const INVENTARIO = "test-sub-resena-inventario";
const SUBS = [CLIENTE, OTRO, INVENTARIO];

let app;
let dir;
let storage;
const modelos = [];

/** Petición firmada como `sub` (el verificador falso usa el token como identidad). */
function como(sub, opts) {
  const headers = sub ? { authorization: `Bearer ${sub}` } : {};
  return app.inject({ ...opts, headers: { ...opts.headers, ...headers } });
}

/** Envía una reseña como multipart, con foto opcional. */
async function resenar(sub, fields, foto = null) {
  const b = "----ctgresena";
  const partes = Object.entries(fields).map(([k, v]) => Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  if (foto) partes.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="photo"; filename="f.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), foto, Buffer.from("\r\n"));
  partes.push(Buffer.from(`--${b}--\r\n`));
  return como(sub, { method: "POST", url: "/api/reviews", payload: Buffer.concat(partes), headers: { "content-type": `multipart/form-data; boundary=${b}` } });
}

/**
 * Crea un modelo con un ejemplar y un pedido del cliente sobre él.
 * @param {{cumplido?: boolean}} [o] Si el pedido ya empezó (y por tanto se puede reseñar).
 */
async function alquiler({ cumplido = true } = {}) {
  const m = (await como(INVENTARIO, {
    method: "POST",
    url: "/api/products",
    payload: { name: "Blusa de reseña", categoryKey: "casual", material: "algodon", value: 20, stars: 3, weightKg: 0.2 },
  })).json();
  modelos.push(m.id);
  const molde = await prisma.item.findFirst({ orderBy: { id: "asc" } });
  const item = (await como(INVENTARIO, {
    method: "POST",
    url: `/api/products/${m.id}/items`,
    payload: { size: molde.size, sizeScale: molde.sizeScale, color: molde.color },
  })).json();
  const res = await como(CLIENTE, {
    method: "POST",
    url: "/api/orders",
    payload: { items: [item.id], start: habil(1), end: habil(1), delivery: "pickup", ret: "store", pay: "cash" },
  });
  assert.equal(res.statusCode, 201, res.body);
  const order = res.json();
  if (cumplido) {
    await prisma.order.update({ where: { id: order.id }, data: { start: addDaysISO(todayISO(), -3) } });
    await markDelivered(order.id);
  }
  return { productId: m.id, orderId: order.id };
}

const jpg = () => sharp({ create: { width: 40, height: 30, channels: 3, background: "#a55" } })
  .jpeg().withExif({ IFD0: { Copyright: "privado" } }).toBuffer();

before(async () => {
  await loadHolidays();
  dir = await mkdtemp(path.join(tmpdir(), "ctg-resenas-"));
  storage = createDiskStorage({ dir });
  app = buildApp({ verifyGoogleToken: async (t) => ({ sub: t, email: `${t}@test`, name: t === CLIENTE ? "Cliente Prueba Reseñas" : t }), storage, allowUpload: () => true });
  await app.ready();
});

beforeEach(async () => {
  await purge({ subs: SUBS, productIds: modelos.splice(0) });
  await grant(INVENTARIO, ["INVENTARIO"]);
});

after(async () => {
  await purge({ subs: SUBS, productIds: modelos });
  await app.close();
  await prisma.$disconnect();
  await rm(dir, { recursive: true, force: true });
});

test("el autor público es nombre e inicial del apellido", () => {
  assert.equal(publicAuthor({ name: "Ana María Rodríguez" }), "Ana R.");
  assert.equal(publicAuthor({ name: "Ana" }), "Ana");
  assert.equal(publicAuthor({ name: "" }), "Cliente");
});

test("solo reseña quien alquiló de verdad, con el pedido ya cumplido", async () => {
  const { productId, orderId } = await alquiler({ cumplido: false });
  assert.equal((await resenar(null, { orderId, productId, rating: 5 })).statusCode, 401);
  const pronto = await resenar(CLIENTE, { orderId, productId, rating: 5 });
  assert.equal(pronto.statusCode, 409);
  assert.match(pronto.json().error, /cuando hayas recibido/);

  // Pasar la fecha no basta: hace falta que el local registre la entrega.
  await prisma.order.update({ where: { id: orderId }, data: { start: addDaysISO(todayISO(), -3) } });
  assert.equal((await resenar(CLIENTE, { orderId, productId, rating: 5 })).statusCode, 409, "sin entrega registrada, no");
  await markDelivered(orderId);
  assert.equal((await resenar(OTRO, { orderId, productId, rating: 5 })).statusCode, 404, "un pedido ajeno no existe");
  assert.equal((await resenar(CLIENTE, { orderId, productId: productId + 100000, rating: 5 })).statusCode, 409, "prenda que no es del pedido");
  await prisma.order.update({ where: { id: orderId }, data: { cancelledAt: new Date() } });
  assert.equal((await resenar(CLIENTE, { orderId, productId, rating: 5 })).statusCode, 409, "un pedido anulado no se reseña");
});

test("datos malos son 400", async () => {
  const { productId, orderId } = await alquiler();
  for (const malo of [{ rating: 0 }, { rating: 6 }, { rating: "x" }, { rating: 4, text: "a".repeat(501) }, { rating: 4, orderId: "" }]) {
    assert.equal((await resenar(CLIENTE, { orderId, productId, ...malo })).statusCode, 400, JSON.stringify(malo).slice(0, 60));
  }
});

test("la reseña nace pendiente, con su foto limpia, y una por prenda y pedido", async () => {
  const { productId, orderId } = await alquiler();
  const res = await resenar(CLIENTE, { orderId, productId, rating: 4, text: "  Me quedó perfecta  " }, await jpg());
  assert.equal(res.statusCode, 201, res.body);
  const r = res.json();
  assert.equal(r.status, "PENDIENTE");
  assert.equal(r.text, "Me quedó perfecta");
  assert.equal(r.author, "Cliente R.");
  assert.match(r.photo, /\/media\/resenas\/[0-9a-f-]+\.webp\?exp=\d+&sig=/, "foto privada, con enlace firmado");
  const fila = await prisma.review.findUnique({ where: { id: r.id } });
  const meta = await sharp(await storage.read(fila.photoKey)).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.exif, undefined);
  const ver = await app.inject({ method: "GET", url: new URL(r.photo).pathname + new URL(r.photo).search });
  assert.equal(ver.statusCode, 200);

  assert.equal((await resenar(CLIENTE, { orderId, productId, rating: 2 })).statusCode, 409, "dos veces la misma no");
  const disfrazada = await resenar(CLIENTE, { orderId, productId, rating: 2 }, Buffer.from("<svg>no soy una foto</svg>       "));
  assert.equal(disfrazada.statusCode, 415);
});

test("el público solo ve lo aprobado; el autor ve también lo suyo pendiente", async () => {
  const { productId, orderId } = await alquiler();
  const r = (await resenar(CLIENTE, { orderId, productId, rating: 4, text: "Muy linda" })).json();
  const url = `/api/products/${productId}/reviews`;

  const publico = (await app.inject({ method: "GET", url })).json();
  assert.equal(publico.count, 0);
  assert.deepEqual(publico.mine, []);
  const autor = (await como(CLIENTE, { method: "GET", url })).json();
  assert.equal(autor.count, 0);
  assert.equal(autor.mine.length, 1);
  assert.equal(autor.mine[0].status, "PENDIENTE");
  assert.deepEqual((await como(OTRO, { method: "GET", url })).json().mine, []);

  await prisma.review.update({ where: { id: r.id }, data: { status: "APROBADA" } });
  const aprobado = (await app.inject({ method: "GET", url })).json();
  assert.equal(aprobado.count, 1);
  assert.equal(aprobado.average, 4);
  assert.equal(aprobado.reviews[0].author, "Cliente R.");
  assert.equal(aprobado.reviews[0].text, "Muy linda");
  assert.equal(aprobado.reviews[0].status, undefined, "al público no le llega el estado");
  assert.equal(aprobado.reviews[0].orderId, undefined, "ni el pedido");
});

test("el cliente lista sus reseñas y puede retirar la suya, con su foto", async () => {
  const { productId, orderId } = await alquiler();
  const r = (await resenar(CLIENTE, { orderId, productId, rating: 5 }, await jpg())).json();
  const mias = (await como(CLIENTE, { method: "GET", url: "/api/me/reviews" })).json();
  assert.deepEqual(mias.map((x) => [x.orderId, x.productId, x.status]), [[orderId, productId, "PENDIENTE"]]);

  const clave = (await prisma.review.findUnique({ where: { id: r.id } })).photoKey;
  assert.equal((await como(OTRO, { method: "DELETE", url: `/api/reviews/${r.id}` })).statusCode, 404, "la de otro no");
  assert.equal((await como(CLIENTE, { method: "DELETE", url: `/api/reviews/${r.id}` })).statusCode, 204);
  assert.equal(await prisma.review.findUnique({ where: { id: r.id } }), null);
  assert.equal(await storage.read(clave), null, "la foto se va con la reseña");
  assert.equal((await resenar(CLIENTE, { orderId, productId, rating: 3 })).statusCode, 201, "puede volver a escribirla");
});
