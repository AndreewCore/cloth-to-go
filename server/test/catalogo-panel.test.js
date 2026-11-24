/**
 * Catálogo desde el panel (fase 4): alta y edición de modelos, fotos de
 * catálogo y fotos de estado de cada ejemplar.
 *
 * Lo que más se vigila es la tubería de subida: el tipo por bytes mágicos, la
 * recodificación a WebP sin EXIF, los topes (tamaño, cantidad, píxeles) y que
 * lo privado solo se vea con un enlace firmado que caduca. Las fotos van a una
 * carpeta temporal: el conductor de disco es el mismo que en local.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32 } from "node:zlib";
import sharp from "sharp";
import { buildApp } from "../src/app.js";
import prisma from "../src/db.js";
import { createDiskStorage, createSupabaseStorage, isStorageKey } from "../src/storage.js";
import { sniffImage } from "../src/photos.js";
import { adminCsp } from "../src/admin.js";
import { grant, habil, loadHolidays, purge } from "./helpers/db.js";

const CLIENTE = "test-sub-cat-cliente";
const MOSTRADOR = "test-sub-cat-mostrador";
const INVENTARIO = "test-sub-cat-inventario";
const ADMIN = "test-sub-cat-admin";
const SUBS = [CLIENTE, MOSTRADOR, INVENTARIO, ADMIN];

let app;
let storage;
let dir;
let permitirSubidas = true;
const modelos = [];

/** Petición firmada como `sub` (el verificador falso usa el token como identidad). */
function como(sub, opts) {
  return app.inject({ ...opts, headers: { ...opts.headers, authorization: `Bearer ${sub}` } });
}

/**
 * Cuerpo multipart a mano: `app.inject` no trae un FormData que entienda.
 * @param {Record<string, string>} fields Campos de texto.
 * @param {{name?: string, type?: string, data: Buffer}[]} files Archivos.
 * @returns {{payload: Buffer, headers: object}}
 */
function multipart(fields, files) {
  const b = `----ctg${Math.random().toString(16).slice(2)}`;
  const partes = [];
  for (const [k, v] of Object.entries(fields)) {
    partes.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  for (const f of files) {
    partes.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="photo"; filename="${f.name ?? "foto.jpg"}"\r\nContent-Type: ${f.type ?? "image/jpeg"}\r\n\r\n`));
    partes.push(f.data, Buffer.from("\r\n"));
  }
  partes.push(Buffer.from(`--${b}--\r\n`));
  return { payload: Buffer.concat(partes), headers: { "content-type": `multipart/form-data; boundary=${b}` } };
}

/** Sube fotos como `sub` a una ruta. */
function subir(sub, url, files, fields = {}) {
  const { payload, headers } = multipart(fields, files);
  return como(sub, { method: "POST", url, payload, headers });
}

/** JPG pequeño con EXIF (copyright y GPS) que la tubería debe borrar. */
const jpgConExif = () => sharp({ create: { width: 64, height: 48, channels: 3, background: "#b33" } })
  .jpeg()
  .withExif({ IFD0: { Copyright: "dato-privado" }, IFD3: { GPSLatitudeRef: "S", GPSLatitude: "2/1 10/1 0/1" } })
  .toBuffer();
const png = (w = 32, h = 32) => sharp({ create: { width: w, height: h, channels: 3, background: "#3b3" } }).png().toBuffer();

/** Archivos que hay en una carpeta del almacenamiento. */
const archivos = async (sub) => readdir(path.join(dir, sub)).catch(() => []);

/** Crea un modelo válido como Inventario y lo apunta para limpiarlo. */
async function nuevoModelo(extra = {}) {
  const res = await como(INVENTARIO, {
    method: "POST",
    url: "/api/products",
    payload: { name: "Chaqueta de prueba", categoryKey: "casual", material: "algodon", value: 40, stars: 3, weightKg: 0.6, ...extra },
  });
  assert.equal(res.statusCode, 201, res.body);
  modelos.push(res.json().id);
  return res.json();
}

/** Da de alta un ejemplar del modelo con la talla y el color de uno de demostración. */
async function nuevoEjemplar(productId) {
  const molde = await prisma.item.findFirst({ orderBy: { id: "asc" } });
  const res = await como(INVENTARIO, {
    method: "POST",
    url: `/api/products/${productId}/items`,
    payload: { size: molde.size, sizeScale: molde.sizeScale, color: molde.color },
  });
  assert.equal(res.statusCode, 201, res.body);
  return res.json();
}

before(async () => {
  await loadHolidays();
  dir = await mkdtemp(path.join(tmpdir(), "ctg-fotos-"));
  storage = createDiskStorage({ dir, secret: "secreto-de-prueba" });
  app = buildApp({
    verifyGoogleToken: async (t) => ({ sub: t, email: `${t}@test`, name: t }),
    storage,
    allowUpload: () => permitirSubidas,
  });
  await app.ready();
});

beforeEach(async () => {
  permitirSubidas = true;
  // Se vacía antes del await: lo que se borra es la lista de la prueba anterior.
  await purge({ subs: SUBS, productIds: modelos.splice(0) });
  await Promise.all([
    grant(MOSTRADOR, ["MOSTRADOR"]),
    grant(INVENTARIO, ["INVENTARIO"]),
    grant(ADMIN, ["ADMINISTRACION"]),
  ]);
});

after(async () => {
  await purge({ subs: SUBS, productIds: modelos });
  await app.close();
  await prisma.$disconnect();
  await rm(dir, { recursive: true, force: true });
});

/* ---- Modelos ---- */

test("Inventario da de alta un modelo; el cliente y el mostrador no", async () => {
  const m = await nuevoModelo({ occasions: ["diario"], brand: "  Marca  " });
  assert.equal(m.category, "Casual");
  assert.deepEqual(m.occasions, ["diario"]);
  assert.equal(m.brand, "Marca");
  assert.deepEqual(m.imgs, []);
  const cuerpo = { name: "X de prueba", categoryKey: "casual", material: "algodon", value: 10, stars: 3, weightKg: 0.3 };
  assert.equal((await como(CLIENTE, { method: "POST", url: "/api/products", payload: cuerpo })).statusCode, 403);
  assert.equal((await como(MOSTRADOR, { method: "POST", url: "/api/products", payload: cuerpo })).statusCode, 403);
});

test("un modelo fuera de la taxonomía o con números absurdos es 400", async () => {
  const base = { name: "X de prueba", categoryKey: "casual", material: "algodon", value: 10, stars: 3, weightKg: 0.3 };
  for (const malo of [{ categoryKey: "inventada" }, { material: "kriptonita" }, { stars: 9 }, { stars: 2.5 },
    { value: -1 }, { weightKg: 0 }, { name: "" }, { occasions: ["nada"] }, { occasions: "casual" }]) {
    const res = await como(INVENTARIO, { method: "POST", url: "/api/products", payload: { ...base, ...malo } });
    assert.equal(res.statusCode, 400, JSON.stringify(malo));
  }
});

test("editar nombre es de Inventario; valor y estrellas, de Administración", async () => {
  const m = await nuevoModelo();
  const url = `/api/products/${m.id}`;
  const renombrado = await como(INVENTARIO, { method: "PATCH", url, payload: { name: "Chaqueta corregida" } });
  assert.equal(renombrado.statusCode, 200, renombrado.body);
  assert.equal(renombrado.json().name, "Chaqueta corregida");
  assert.equal((await como(INVENTARIO, { method: "PATCH", url, payload: { value: 99 } })).statusCode, 403);
  const admin = await como(ADMIN, { method: "PATCH", url, payload: { value: 99, stars: 4 } });
  assert.equal(admin.statusCode, 200, admin.body);
  assert.equal(admin.json().value, 99);
});

test("el panel lista también los modelos sin ejemplares, que el catálogo público esconde", async () => {
  const m = await nuevoModelo();
  const panel = (await como(INVENTARIO, { method: "GET", url: "/api/admin/products" })).json();
  assert.ok(panel.some((p) => p.id === m.id));
  const publico = (await app.inject({ method: "GET", url: "/api/products" })).json();
  assert.ok(!publico.some((p) => p.id === m.id), "sin ejemplares no hay nada que alquilar");
});

/* ---- Fotos de catálogo ---- */

test("una foto subida sale recodificada a WebP, sin EXIF, y aparece en la app con URL absoluta", async () => {
  const m = await nuevoModelo();
  await nuevoEjemplar(m.id);
  const res = await subir(INVENTARIO, `/api/products/${m.id}/photos`, [{ data: await jpgConExif() }, { data: await png(), type: "image/png", name: "b.png" }]);
  assert.equal(res.statusCode, 200, res.body);
  const { imgs } = res.json();
  assert.equal(imgs.length, 2);
  assert.ok(imgs.every(isStorageKey), "en la base solo hay claves, nunca el nombre original");

  const guardada = await storage.read(imgs[0]);
  const meta = await sharp(guardada).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.exif, undefined, "sin EXIF: ni copyright ni GPS");

  const publico = (await app.inject({ method: "GET", url: "/api/products" })).json().find((p) => p.id === m.id);
  assert.match(publico.imgs[0], /^https?:\/\/[^/]+\/media\/catalogo\/[0-9a-f-]+\.webp$/);
  const foto = await app.inject({ method: "GET", url: new URL(publico.imgs[0]).pathname });
  assert.equal(foto.statusCode, 200);
  assert.equal(foto.headers["content-type"], "image/webp");
  assert.equal(foto.headers["x-content-type-options"], "nosniff");
});

test("el tipo se decide por los bytes, no por la extensión ni el Content-Type", async () => {
  const m = await nuevoModelo();
  const antes = (await archivos("catalogo")).length;
  const disfrazado = Buffer.from("<svg onload=alert(1)></svg>                ");
  const res = await subir(INVENTARIO, `/api/products/${m.id}/photos`, [{ data: disfrazado, name: "foto.jpg", type: "image/jpeg" }]);
  assert.equal(res.statusCode, 415);
  assert.equal((await archivos("catalogo")).length, antes, "no se guardó nada");
  assert.equal(sniffImage(await png()), "png");
  assert.equal(sniffImage(Buffer.from("GIF89a......")), null);
});

test("más de 5 MB es 413, y un JPG dañado es 400", async () => {
  const m = await nuevoModelo();
  const grande = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(5 * 1024 * 1024)]);
  assert.equal((await subir(INVENTARIO, `/api/products/${m.id}/photos`, [{ data: grande }])).statusCode, 413);
  const roto = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("no soy una foto de verdad")]);
  assert.equal((await subir(INVENTARIO, `/api/products/${m.id}/photos`, [{ data: roto }])).statusCode, 400);
});

test("una bomba de descompresión (demasiados píxeles) se rechaza antes de decodificarla", async () => {
  const m = await nuevoModelo();
  // Como un ataque real: un PNG diminuto cuya cabecera declara 7000×7000 (49
  // MP). Si se decodificara, pediría cientos de MB; tiene que caer al leer
  // la cabecera.
  const bomba = Buffer.from(await png(1, 1));
  bomba.writeUInt32BE(7000, 16);
  bomba.writeUInt32BE(7000, 20);
  bomba.writeUInt32BE(crc32(bomba.subarray(12, 29)), 29);
  const res = await subir(INVENTARIO, `/api/products/${m.id}/photos`, [{ data: bomba, type: "image/png", name: "b.png" }]);
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /megapíxeles/);
});

test("un modelo tiene 6 fotos como máximo", async () => {
  const m = await nuevoModelo();
  const seis = await Promise.all(Array.from({ length: 6 }, () => png()));
  assert.equal((await subir(INVENTARIO, `/api/products/${m.id}/photos`, seis.map((data) => ({ data, type: "image/png" })))).statusCode, 200);
  const septima = await subir(INVENTARIO, `/api/products/${m.id}/photos`, [{ data: await png(), type: "image/png" }]);
  assert.equal(septima.statusCode, 409);
});

test("reordenar y quitar fotos: la lista sale de la actual y lo quitado se conserva para la bitácora", async () => {
  const m = await nuevoModelo();
  const { imgs } = (await subir(INVENTARIO, `/api/products/${m.id}/photos`, [{ data: await png() , type: "image/png" }, { data: await jpgConExif() }])).json();
  const url = `/api/products/${m.id}/photos`;
  const reordenado = await como(INVENTARIO, { method: "PUT", url, payload: { imgs: [imgs[1]] } });
  assert.equal(reordenado.statusCode, 200, reordenado.body);
  assert.deepEqual(reordenado.json().imgs, [imgs[1]]);
  assert.ok(await storage.read(imgs[0]), "la quitada sigue guardada: la bitácora la enseña");
  const registro = await prisma.activityLog.findFirst({ where: { productId: m.id, action: "FOTO_CATALOGO_QUITADA" } });
  assert.deepEqual(registro.detail.keys, [imgs[0]]);
  const ajena = await como(INVENTARIO, { method: "PUT", url, payload: { imgs: [imgs[1], "../../etc/passwd"] } });
  assert.equal(ajena.statusCode, 409);
});

test("las subidas tienen límite por persona", async () => {
  const m = await nuevoModelo();
  permitirSubidas = false;
  assert.equal((await subir(INVENTARIO, `/api/products/${m.id}/photos`, [{ data: await png(), type: "image/png" }])).statusCode, 429);
});

/* ---- Fotos de estado del ejemplar ---- */

test("las fotos de salida van con su pedido y se ven solo con un enlace firmado", async () => {
  const m = await nuevoModelo();
  const item = await nuevoEjemplar(m.id);
  const pedido = await como(CLIENTE, {
    method: "POST",
    url: "/api/orders",
    payload: { items: [item.id], start: habil(1), end: habil(1), delivery: "pickup", ret: "store", pay: "cash" },
  });
  assert.equal(pedido.statusCode, 201, pedido.body);
  const orderId = pedido.json().id;
  const url = `/api/items/${item.id}/photos`;

  assert.equal((await subir(MOSTRADOR, url, [{ data: await png(), type: "image/png" }], { kind: "SALIDA" })).statusCode, 400, "sin pedido");
  assert.equal((await subir(MOSTRADOR, url, [{ data: await png(), type: "image/png" }], { kind: "SALIDA", orderId: "999999" })).statusCode, 409);
  assert.equal((await subir(CLIENTE, url, [{ data: await png(), type: "image/png" }], { kind: "ESTADO" })).statusCode, 403);
  const ok = await subir(MOSTRADOR, url, [{ data: await jpgConExif() }], { kind: "SALIDA", orderId: String(orderId) });
  assert.equal(ok.statusCode, 201, ok.body);

  const lista = (await como(MOSTRADOR, { method: "GET", url })).json();
  assert.equal(lista.length, 1);
  assert.equal(lista[0].kind, "SALIDA");
  assert.equal(lista[0].orderId, orderId);
  assert.equal(lista[0].takenBy, MOSTRADOR);

  const firmada = new URL(lista[0].url);
  const ver = await app.inject({ method: "GET", url: `${firmada.pathname}${firmada.search}` });
  assert.equal(ver.statusCode, 200);
  assert.equal(ver.headers["cache-control"], "private, no-store");
  assert.equal((await app.inject({ method: "GET", url: firmada.pathname })).statusCode, 403, "sin firma no se ve");
  firmada.searchParams.set("sig", "x".repeat(43));
  assert.equal((await app.inject({ method: "GET", url: `${firmada.pathname}${firmada.search}` })).statusCode, 403);
  assert.equal((await como(CLIENTE, { method: "GET", url })).statusCode, 403);
});

test("un enlace firmado caduca", async () => {
  const key = "ejemplares/00000000-0000-4000-8000-000000000000.webp";
  const u = new URL(await storage.signedUrl(key, "http://x", 60, 0));
  const { exp, sig } = Object.fromEntries(u.searchParams);
  assert.equal(storage.verify(key, exp, sig, 30_000), true);
  assert.equal(storage.verify(key, exp, sig, 61_000), false);
  assert.equal(storage.verify("catalogo/../x", exp, sig, 30_000), false);
});

test("una foto de estado no se puede borrar ni editar: es evidencia", async () => {
  const m = await nuevoModelo();
  const item = await nuevoEjemplar(m.id);
  assert.equal((await subir(INVENTARIO, `/api/items/${item.id}/photos`, [{ data: await png(), type: "image/png" }], { kind: "ESTADO" })).statusCode, 201);
  const foto = await prisma.itemPhoto.findFirst({ where: { itemId: item.id } });
  await assert.rejects(prisma.itemPhoto.delete({ where: { id: foto.id } }), /solo de añadir|solo añadir|insufficient/i);
  await assert.rejects(prisma.itemPhoto.update({ where: { id: foto.id }, data: { kind: "LLEGADA" } }));
});

/* ---- Supabase y CSP ---- */

test("el conductor de Supabase sube, firma y publica con las URLs de su API", async () => {
  const llamadas = [];
  const fetchFalso = async (url, init) => {
    llamadas.push({ url, init });
    const body = url.includes("/object/sign/") ? { signedURL: "/object/sign/privado/k?token=t" } : {};
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const s = createSupabaseStorage({ url: "https://abc.supabase.co/", serviceKey: "svc", buckets: { public: "catalogo", private: "privado" }, fetchImpl: fetchFalso });
  const pub = "catalogo/00000000-0000-4000-8000-000000000000.webp";
  const priv = "ejemplares/00000000-0000-4000-8000-000000000000.webp";
  await s.put(pub, Buffer.from("x"));
  assert.equal(llamadas[0].url, `https://abc.supabase.co/storage/v1/object/catalogo/${pub}`);
  assert.equal(llamadas[0].init.headers.authorization, "Bearer svc");
  assert.equal(s.publicUrl(pub), `https://abc.supabase.co/storage/v1/object/public/catalogo/${pub}`);
  assert.equal(await s.signedUrl(priv), "https://abc.supabase.co/storage/v1/object/sign/privado/k?token=t");
  assert.match(llamadas[1].url, /\/object\/sign\/privado\/ejemplares\//);
  assert.throws(() => s.publicUrl("../secreto"), /no válida/);
});

test("con Supabase, la CSP del panel deja ver sus fotos y nada más", () => {
  const csp = adminCsp("https://abc.supabase.co");
  assert.match(csp, /img-src [^;]*https:\/\/abc\.supabase\.co/);
  assert.doesNotMatch(adminCsp(), /supabase/);
  assert.doesNotMatch(csp, /unsafe-inline/);
});
