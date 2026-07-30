/**
 * Pruebas del endpoint de catálogo usando el runner nativo (node:test) y
 * `app.inject()` — no abre puertos ni hace red. Asume que la base fue sembrada
 * (`pnpm db:reset`) antes de correr los tests.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import prisma from "../src/db.js";

let app;

before(async () => {
  app = buildApp();
  await app.ready();
});

after(async () => {
  await app.close();
  await prisma.$disconnect();
});

test("GET /api/health responde ok", async () => {
  const res = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: "ok" });
});

test("GET /api/products devuelve las 10 prendas sembradas", async () => {
  const res = await app.inject({ method: "GET", url: "/api/products" });
  assert.equal(res.statusCode, 200);
  const products = res.json();
  assert.equal(products.length, 10);
});

test("cada prenda trae los campos que el frontend espera", async () => {
  const res = await app.inject({ method: "GET", url: "/api/products" });
  const [first] = res.json();
  for (const field of [
    "id", "name", "cat", "value", "stars",
    "size", "disponibles", "material", "weightKg", "imgs", "desc",
  ]) {
    assert.ok(field in first, `falta el campo "${field}"`);
  }
});

test("imgs llega como array, no como el JSON que guarda SQLite", async () => {
  // El formato del almacén no debe filtrarse al cliente: si esto se rompe, el
  // frontend recibe una cadena y la galería la recorre carácter a carácter.
  const res = await app.inject({ method: "GET", url: "/api/products" });
  for (const p of res.json()) {
    assert.ok(Array.isArray(p.imgs), `la prenda ${p.id} debe traer imgs como array`);
    assert.ok(p.imgs.length >= 1, `la prenda ${p.id} debe traer al menos una foto`);
    assert.ok(p.imgs.every(s => typeof s === "string"));
  }
});

test("alguna prenda trae varias fotos (la galería tiene qué mostrar)", async () => {
  const res = await app.inject({ method: "GET", url: "/api/products" });
  assert.ok(res.json().some(p => p.imgs.length > 1));
});

test("el catálogo viene ordenado por id ascendente", async () => {
  const res = await app.inject({ method: "GET", url: "/api/products" });
  const ids = res.json().map((p) => p.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
});
