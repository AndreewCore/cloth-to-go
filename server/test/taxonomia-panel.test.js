/**
 * Taxonomía desde el panel (fase 4): lo que se vigila es que editar no rompa
 * lo existente. La clave y el prefijo no cambian, lo usado no se borra, y el
 * coste de lavado (que mueve el precio mínimo) es de Administración.
 *
 * Todo lo que crean las pruebas empieza por «Zz» (clave `zz_…`) y se borra al
 * terminar; el orden de la semilla se restaura, porque otra prueba lo fija.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import prisma from "../src/db.js";
import { keyFromName } from "../src/taxonomyAdmin.js";
import { grant, purge } from "./helpers/db.js";

const INVENTARIO = "test-sub-tax-inventario";
const ADMIN = "test-sub-tax-admin";
const MOSTRADOR = "test-sub-tax-mostrador";
const SUBS = [INVENTARIO, ADMIN, MOSTRADOR];
const TALLAS_PRUEBA = ["ZZ9", "49.5"];

let app;
const modelos = [];

/** Petición firmada como `sub` (el verificador falso usa el token como identidad). */
function como(sub, opts) {
  return app.inject({ ...opts, headers: { ...opts.headers, authorization: `Bearer ${sub}` } });
}

/** Crea una entrada como `sub`. */
const crear = (sub, list, payload) => como(sub, { method: "POST", url: `/api/taxonomy/${list}`, payload });

/** Borra lo que crearon las pruebas, en orden para no chocar con claves foráneas. */
async function limpiar() {
  await purge({ subs: SUBS, productIds: modelos.splice(0) });
  const zz = { key: { startsWith: "zz_" } };
  for (const m of ["category", "color", "material", "occasion", "season", "audience"]) {
    await prisma[m].deleteMany({ where: zz });
  }
  await prisma.size.deleteMany({ where: { label: { in: TALLAS_PRUEBA } } });
}

before(async () => {
  app = buildApp({ verifyGoogleToken: async (t) => ({ sub: t, email: `${t}@test`, name: t }) });
  await app.ready();
});

beforeEach(async () => {
  await limpiar();
  await Promise.all([grant(INVENTARIO, ["INVENTARIO"]), grant(ADMIN, ["ADMINISTRACION"]), grant(MOSTRADOR, ["MOSTRADOR"])]);
});

after(async () => {
  await limpiar();
  await app.close();
  await prisma.$disconnect();
});

test("la clave sale del nombre: minúsculas, sin tildes, con _ entre palabras", () => {
  assert.equal(keyFromName("Día de Playa"), "dia_de_playa");
  assert.equal(keyFromName("  Azul   eléctrico! "), "azul_electrico");
  assert.equal(keyFromName("Ñandú"), "nandu");
});

test("Inventario crea entradas y aparecen en /api/taxonomy al final de su lista", async () => {
  const cat = await crear(INVENTARIO, "categories", { name: "Zz Playa", prefix: "zzp" });
  assert.equal(cat.statusCode, 201, cat.body);
  assert.equal(cat.json().key, "zz_playa");
  assert.equal(cat.json().prefix, "ZZP");
  assert.equal((await crear(INVENTARIO, "colors", { name: "Zz Turquesa", hex: "#30D5C8" })).json().hex, "#30d5c8");
  assert.equal((await crear(INVENTARIO, "occasions", { name: "Zz Playa" })).statusCode, 201, "otra lista, mismo nombre: vale");
  assert.equal((await crear(INVENTARIO, "sizes", { scale: "ROPA", label: "zz9" })).json().label, "ZZ9");

  const t = (await app.inject({ method: "GET", url: "/api/taxonomy" })).json();
  assert.equal(t.categories.at(-1).key, "zz_playa");
  assert.ok(t.colors.some((c) => c.key === "zz_turquesa"));
  assert.equal(t.sizes.filter((s) => s.scale === "ROPA").at(-1).label, "ZZ9");
});

test("el mostrador y el cliente no editan la taxonomía", async () => {
  assert.equal((await crear(MOSTRADOR, "colors", { name: "Zz Gris", hex: "#888888" })).statusCode, 403);
  assert.equal((await app.inject({ method: "POST", url: "/api/taxonomy/colors", payload: { name: "Zz Gris", hex: "#888888" } })).statusCode, 401);
  assert.equal((await como(MOSTRADOR, { method: "GET", url: "/api/admin/taxonomy" })).statusCode, 403);
});

test("datos malos o repetidos se rechazan con un motivo", async () => {
  const casos = [
    ["categories", { name: "Zz Sin prefijo" }, 400],
    ["categories", { name: "Zz Otra", prefix: "FIE" }, 409],
    ["categories", { name: "Fiesta", prefix: "ZZQ" }, 409],
    ["colors", { name: "Zz Raro", hex: "red" }, 400],
    ["colors", { name: "NEGRO", hex: "#000000" }, 409],
    ["sizes", { scale: "CALZADO", label: "XL" }, 400],
    ["sizes", { scale: "ROPA", label: "M" }, 409],
    ["occasions", { name: "x" }, 400],
    ["inventada", { name: "Zz Algo" }, 404],
  ];
  for (const [list, payload, status] of casos) {
    assert.equal((await crear(INVENTARIO, list, payload)).statusCode, status, `${list} ${JSON.stringify(payload)}`);
  }
});

test("el coste de lavado de un material es de Administración", async () => {
  assert.equal((await crear(INVENTARIO, "materials", { name: "Zz Seda", laundryCents: 400 })).statusCode, 403);
  const seda = await crear(ADMIN, "materials", { name: "Zz Seda", laundryCents: 400 });
  assert.equal(seda.statusCode, 201, seda.body);
  const url = "/api/taxonomy/materials/zz_seda";
  assert.equal((await como(INVENTARIO, { method: "PATCH", url, payload: { laundryCents: 100 } })).statusCode, 403);
  const renombrada = await como(INVENTARIO, { method: "PATCH", url, payload: { name: "Zz Seda natural" } });
  assert.equal(renombrada.statusCode, 200, "renombrar sí es de Inventario");
  assert.equal(renombrada.json().laundryCents, 400);
  const publico = (await app.inject({ method: "GET", url: "/api/taxonomy" })).json();
  assert.ok(publico.materials.every((m) => !("laundryCents" in m)), "el coste sigue sin salir al cliente");
});

test("la clave, el prefijo y la talla no se cambian; el nombre y el hex sí", async () => {
  await crear(INVENTARIO, "categories", { name: "Zz Playa", prefix: "ZZP" });
  const url = "/api/taxonomy/categories/zz_playa";
  for (const cambio of [{ prefix: "ZZX" }, { key: "zz_otra" }]) {
    assert.equal((await como(INVENTARIO, { method: "PATCH", url, payload: cambio })).statusCode, 400, JSON.stringify(cambio));
  }
  const ok = await como(INVENTARIO, { method: "PATCH", url, payload: { name: "Zz Playa y sol" } });
  assert.equal(ok.json().name, "Zz Playa y sol");
  assert.equal(ok.json().key, "zz_playa", "la clave se queda");
  await crear(INVENTARIO, "colors", { name: "Zz Ocre", hex: "#cc7722" });
  const hex = await como(INVENTARIO, { method: "PATCH", url: "/api/taxonomy/colors/zz_ocre", payload: { hex: "#CC7700" } });
  assert.equal(hex.json().hex, "#cc7700");
});

test("lo que se usa no se borra y se dice cuánto; lo libre, sí", async () => {
  await crear(INVENTARIO, "categories", { name: "Zz Playa", prefix: "ZZP" });
  const modelo = await como(INVENTARIO, {
    method: "POST",
    url: "/api/products",
    payload: { name: "Zz Pareo", categoryKey: "zz_playa", material: "algodon", value: 10, stars: 2, weightKg: 0.2 },
  });
  assert.equal(modelo.statusCode, 201, modelo.body);
  modelos.push(modelo.json().id);

  const usada = await como(INVENTARIO, { method: "DELETE", url: "/api/taxonomy/categories/zz_playa" });
  assert.equal(usada.statusCode, 409);
  assert.match(usada.json().error, /1 modelo/);
  const panel = (await como(INVENTARIO, { method: "GET", url: "/api/admin/taxonomy" })).json();
  assert.equal(panel.categories.find((c) => c.key === "zz_playa").uses, 1);
  assert.equal((await como(INVENTARIO, { method: "DELETE", url: "/api/taxonomy/sizes/ROPA%7CM" })).statusCode, 409, "una talla con ejemplares");

  await crear(INVENTARIO, "seasons", { name: "Zz Monzón" });
  assert.equal((await como(INVENTARIO, { method: "DELETE", url: "/api/taxonomy/seasons/zz_monzon" })).statusCode, 204);
  assert.equal(await prisma.season.findUnique({ where: { key: "zz_monzon" } }), null);
});

test("reordenar exige la lista entera y cambia el orden público", async () => {
  const antes = (await prisma.category.findMany({ orderBy: { sort: "asc" } })).map((c) => c.key);
  const url = "/api/taxonomy/categories/order";
  try {
    const invertido = [...antes].reverse();
    assert.equal((await como(INVENTARIO, { method: "PUT", url, payload: { keys: invertido } })).statusCode, 200);
    const t = (await app.inject({ method: "GET", url: "/api/taxonomy" })).json();
    assert.deepEqual(t.categories.map((c) => c.key), invertido);
    assert.equal((await como(INVENTARIO, { method: "PUT", url, payload: { keys: invertido.slice(1) } })).statusCode, 409, "falta una");
    assert.equal((await como(INVENTARIO, { method: "PUT", url, payload: { keys: [...invertido, invertido[0]] } })).statusCode, 400, "repetida");
  } finally {
    await como(INVENTARIO, { method: "PUT", url, payload: { keys: antes } });
  }
});
