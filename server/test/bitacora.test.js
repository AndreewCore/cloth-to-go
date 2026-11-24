/**
 * Bitácora general del panel (fase 4): todo lo que hace el personal queda
 * con quién y cuándo, también lo que antes no dejaba rastro (quitar una foto),
 * y se puede filtrar y paginar. Solo la ve Administración.
 *
 * Una sola persona de Administración hace un recorrido completo en `before`
 * (el color de prueba empieza por «Qq», para no chocar con la limpieza «Zz» de
 * la prueba de taxonomía si corren a la vez);
 * cada prueba filtra por ella, así no la estorba lo que haya en la base.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { buildApp } from "../src/app.js";
import prisma from "../src/db.js";
import { createDiskStorage } from "../src/storage.js";
import { grant, purge } from "./helpers/db.js";

const ADMIN = "test-sub-bitacora-admin";
const INVENTARIO = "test-sub-bitacora-inventario";
const SUBS = [ADMIN, INVENTARIO];

let app;
let dir;
let adminId;
let modelo;
let item;
let quitada;
const modelos = [];

/** Petición firmada como `sub` (el verificador falso usa el token como identidad). */
function como(sub, opts) {
  return app.inject({ ...opts, headers: { ...opts.headers, authorization: `Bearer ${sub}` } });
}

/** Sube fotos PNG como multipart a una ruta. */
async function subir(url, n, fields = {}) {
  const b = "----ctgbitacora";
  const partes = Object.entries(fields).map(([k, v]) => Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  for (let i = 0; i < n; i++) {
    const png = await sharp({ create: { width: 20 + i, height: 20, channels: 3, background: "#468" } }).png().toBuffer();
    partes.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="photo"; filename="f.png"\r\nContent-Type: image/png\r\n\r\n`), png, Buffer.from("\r\n"));
  }
  partes.push(Buffer.from(`--${b}--\r\n`));
  return como(ADMIN, { method: "POST", url, payload: Buffer.concat(partes), headers: { "content-type": `multipart/form-data; boundary=${b}` } });
}

/** Lee la bitácora como Administración con estos filtros. */
async function bitacora(params = {}) {
  const res = await como(ADMIN, { method: "GET", url: `/api/admin/activity?${new URLSearchParams({ actor: adminId, ...params })}` });
  assert.equal(res.statusCode, 200, res.body);
  return res.json();
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ctg-bitacora-"));
  app = buildApp({
    verifyGoogleToken: async (t) => ({ sub: t, email: `${t}@test`, name: t }),
    storage: createDiskStorage({ dir }),
    allowUpload: () => true,
  });
  await app.ready();
  await purge({ subs: SUBS });
  adminId = (await grant(ADMIN, ["ADMINISTRACION"])).id;
  await grant(INVENTARIO, ["INVENTARIO"]);

  // Recorrido: un poco de todo, siempre la misma persona.
  modelo = (await como(ADMIN, {
    method: "POST",
    url: "/api/products",
    payload: { name: "Poncho de bitácora", categoryKey: "invierno", material: "lana", value: 50, stars: 4, weightKg: 0.9 },
  })).json();
  modelos.push(modelo.id);
  const { imgs } = (await subir(`/api/products/${modelo.id}/photos`, 2)).json();
  quitada = imgs[0];
  await como(ADMIN, { method: "PUT", url: `/api/products/${modelo.id}/photos`, payload: { imgs: [imgs[1]] } });
  const molde = await prisma.item.findFirst({ orderBy: { id: "asc" } });
  item = (await como(ADMIN, {
    method: "POST",
    url: `/api/products/${modelo.id}/items`,
    payload: { size: molde.size, sizeScale: molde.sizeScale, color: molde.color },
  })).json();
  await como(ADMIN, { method: "PATCH", url: `/api/items/${item.id}`, payload: { condition: "BUENA" } });
  await como(ADMIN, { method: "PATCH", url: `/api/products/${modelo.id}/pricing`, payload: { priceOverride: 9, note: "Prueba de bitácora" } });
  await como(ADMIN, { method: "POST", url: "/api/taxonomy/colors", payload: { name: "Qq Bitácora", hex: "#abcdef" } });
  await como(ADMIN, { method: "DELETE", url: "/api/taxonomy/colors/qq_bitacora" });
  await subir(`/api/items/${item.id}/photos`, 1, { kind: "ESTADO" });
});

after(async () => {
  await purge({ subs: SUBS, productIds: modelos });
  await prisma.color.deleteMany({ where: { key: { startsWith: "qq_" } } });
  await app.close();
  await prisma.$disconnect();
  await rm(dir, { recursive: true, force: true });
});

test("solo Administración ve la bitácora general", async () => {
  assert.equal((await como(INVENTARIO, { method: "GET", url: "/api/admin/activity" })).statusCode, 403);
  assert.equal((await app.inject({ method: "GET", url: "/api/admin/activity" })).statusCode, 401);
  assert.equal((await como(INVENTARIO, { method: "GET", url: "/api/admin/activity/meta" })).statusCode, 403);
});

test("quitar una foto deja rastro, con la foto quitada a la vista", async () => {
  const { entries } = await bitacora({ action: "FOTO_CATALOGO_QUITADA" });
  assert.equal(entries.length, 1);
  const e = entries[0];
  assert.equal(e.actor.name, ADMIN);
  assert.equal(e.product.id, modelo.id);
  assert.match(e.note, /1 foto quitada de «Poncho de bitácora»/);
  assert.equal(e.photos.length, 1);
  assert.ok(e.photos[0].endsWith(path.basename(quitada)));
  const foto = await app.inject({ method: "GET", url: new URL(e.photos[0]).pathname });
  assert.equal(foto.statusCode, 200, "la foto quitada se sigue pudiendo ver");
});

test("junta las cuatro bitácoras en una, de lo más nuevo a lo más viejo", async () => {
  const { entries } = await bitacora();
  const acciones = entries.map((e) => e.action);
  for (const a of ["MODELO_ALTA", "FOTO_CATALOGO_SUBIDA", "FOTO_CATALOGO_QUITADA", "EJEMPLAR_ALTA", "EJEMPLAR_EDICION",
    "PRECIO", "TAXONOMIA_ALTA", "TAXONOMIA_BAJA", "FOTO_ESTADO"]) {
    assert.ok(acciones.includes(a), `falta ${a}`);
  }
  for (let i = 1; i < entries.length; i++) assert.ok(new Date(entries[i - 1].at) >= new Date(entries[i].at), "orden descendente");
  assert.equal(acciones.at(-1), "MODELO_ALTA", "lo primero que pasó va al final");
  const precio = entries.find((e) => e.action === "PRECIO");
  assert.match(precio.note, /Motivo: Prueba de bitácora/);
  assert.equal(precio.category, "precio");
  assert.equal(precio.label, "Cambio de precio");
  const estado = entries.find((e) => e.action === "FOTO_ESTADO");
  assert.match(estado.photos[0], /\/media\/ejemplares\/.+\?exp=\d+&sig=/, "la foto privada llega firmada");
});

test("filtra por categoría, acción, texto y modelo", async () => {
  const taxonomia = await bitacora({ category: "taxonomia" });
  assert.deepEqual(taxonomia.entries.map((e) => e.action).sort(), ["TAXONOMIA_ALTA", "TAXONOMIA_BAJA"]);
  const fotos = await bitacora({ category: "fotos" });
  assert.ok(fotos.entries.every((e) => e.category === "fotos"));
  assert.ok(fotos.entries.some((e) => e.action === "FOTO_ESTADO"));
  const texto = await bitacora({ q: "qq bitácora" });
  assert.ok(texto.entries.length >= 2 && texto.entries.every((e) => e.category === "taxonomia"));
  const porNombre = await bitacora({ q: "poncho de bit" });
  assert.ok(porNombre.entries.some((e) => e.action === "EJEMPLAR_ALTA"), "el texto también busca en el nombre de la prenda");
  const delModelo = await bitacora({ product: String(modelo.id) });
  assert.ok(delModelo.entries.length >= 6);
  assert.ok(delModelo.entries.every((e) => e.product?.id === modelo.id));
});

test("pagina sin repetir ni perder entradas", async () => {
  const completa = (await bitacora({ limit: "200" })).entries.map((e) => e.key);
  const vistas = [];
  let cursor = {};
  for (let vuelta = 0; vuelta < 20; vuelta++) {
    const { entries, next } = await bitacora({ limit: "3", ...cursor });
    vistas.push(...entries.map((e) => e.key));
    if (!next) break;
    cursor = next;
  }
  assert.deepEqual(vistas, completa);
  assert.equal(new Set(vistas).size, vistas.length);
});

test("los filtros raros son 400 y el meta trae lo necesario para pintarlos", async () => {
  for (const malo of [{ category: "nada" }, { action: "NADA" }, { from: "ayer" }, { actor: "x" }]) {
    assert.equal((await como(ADMIN, { method: "GET", url: `/api/admin/activity?${new URLSearchParams(malo)}` })).statusCode, 400, JSON.stringify(malo));
  }
  const meta = (await como(ADMIN, { method: "GET", url: "/api/admin/activity/meta" })).json();
  assert.ok(meta.categories.some((c) => c.key === "fotos"));
  assert.ok(meta.actions.some((a) => a.key === "FOTO_CATALOGO_QUITADA" && a.category === "fotos"));
  assert.ok(meta.actors.some((a) => a.id === adminId));
});

test("la bitácora de acciones es de solo añadir", async () => {
  const fila = await prisma.activityLog.findFirst({ where: { actorId: adminId } });
  await assert.rejects(prisma.activityLog.update({ where: { id: fila.id }, data: { note: "retocada" } }), /solo añadir/);
  await assert.rejects(prisma.activityLog.delete({ where: { id: fila.id } }), /solo añadir/);
});
