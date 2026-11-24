/**
 * Taxonomía desde el panel (fase 4): crear, renombrar, reordenar y borrar
 * categorías, colores, materiales, tallas, ocasiones, temporadas y públicos.
 *
 * La app y la web ya construyen sus filtros con `GET /api/taxonomy`, así que un
 * cambio aquí les llega sin tocarlas. Lo que se protege es lo que ya existe:
 * - **La clave no cambia nunca**: la guardan modelos y ejemplares.
 * - **El prefijo de una categoría tampoco**: va dentro de los códigos
 *   `CAT-AA-NNNN` ya emitidos y de su contador.
 * - **Solo se borra lo que nada usa**; si algo lo usa, se dice cuánto.
 * - **El coste de lavado** de un material mueve el suelo de precio
 *   (`cycleCost()`): fijarlo o cambiarlo es de Administración.
 */
import prisma from "./db.js";
import { CAPABILITY, hasCapability, httpError } from "./auth.js";
import { ACTIVITY, logActivity } from "./logs.js";

const SCALES = ["ROPA", "CALZADO"];

/** Nombre de cada lista en singular, para las notas de la bitácora. */
const LIST_LABEL = {
  categories: "Categoría", colors: "Color", materials: "Material", sizes: "Talla",
  occasions: "Ocasión", seasons: "Temporada", audiences: "Público",
};

/** Cómo se llama una fila en la nota: su nombre o, en tallas, escala y talla. */
const rowName = (list, r) => (list === "sizes" ? `${r.label} (${r.scale === "CALZADO" ? "calzado" : "ropa"})` : r.name);

/**
 * Cada lista: su modelo Prisma y cuántos modelos o ejemplares usan una
 * entrada (lo que impide borrarla).
 */
const LISTS = {
  categories: { model: "category", uses: (k) => prisma.product.count({ where: { categoryKey: k } }), what: "modelo" },
  colors: { model: "color", uses: (k) => prisma.item.count({ where: { color: k } }), what: "ejemplar" },
  materials: { model: "material", uses: (k) => prisma.product.count({ where: { material: k } }), what: "modelo" },
  occasions: { model: "occasion", uses: (k) => prisma.product.count({ where: { occasions: { some: { key: k } } } }), what: "modelo" },
  seasons: { model: "season", uses: (k) => prisma.product.count({ where: { seasonKey: k } }), what: "modelo" },
  audiences: { model: "audience", uses: (k) => prisma.product.count({ where: { audienceKey: k } }), what: "modelo" },
  sizes: {
    model: "size",
    uses: (k) => {
      const [scale, label] = k.split("|");
      return prisma.item.count({ where: { sizeScale: scale, size: label } });
    },
    what: "ejemplar",
  },
};

/** Lista pedida en la ruta, o 404. */
function listOf(raw) {
  const cfg = LISTS[raw];
  if (!cfg) throw httpError(404, "Lista de taxonomía desconocida.");
  return { name: raw, ...cfg };
}

/**
 * Clave a partir de un nombre: minúsculas, sin tildes y con `_` entre
 * palabras («Día de playa» → `dia_de_playa`). Es estable: se fija al crear.
 * @param {string} name Nombre visible.
 * @returns {string}
 */
export function keyFromName(name) {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32);
}

/** Nombre visible validado (2–40 caracteres). */
function parseName(v) {
  const n = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  if (n.length < 2 || n.length > 40) throw httpError(400, "El nombre va entre 2 y 40 caracteres.");
  return n;
}

/** Hex de un color: `#rrggbb`, que es lo único que la app acepta pintar. */
function parseHex(v) {
  if (typeof v !== "string" || !/^#[0-9a-fA-F]{6}$/.test(v)) throw httpError(400, "El color va como #RRGGBB.");
  return v.toLowerCase();
}

/** Coste de lavado en centavos (0 a $50). */
function parseLaundry(v) {
  if (!Number.isInteger(v) || v < 0 || v > 5000) throw httpError(400, "El coste de lavado va en centavos enteros, de 0 a 5000.");
  return v;
}

/**
 * Talla de una escala. Calzado son números (con medio punto opcional); ropa,
 * letras o números cortos en mayúsculas, como las guarda el alta de ejemplares.
 */
function parseSize(scale, label) {
  if (!SCALES.includes(scale)) throw httpError(400, "Escala de talla no válida.");
  const l = typeof label === "string" ? label.trim().toUpperCase() : "";
  const ok = scale === "CALZADO" ? /^\d{1,2}(\.5)?$/.test(l) : /^[A-Z0-9]{1,6}$/.test(l);
  if (!ok) throw httpError(400, scale === "CALZADO" ? "Talla de calzado: un número (p. ej. 38 o 38.5)." : "Talla de ropa: hasta 6 letras o números (p. ej. XXL).");
  return l;
}

/** Clave de una fila tal como la usan las rutas (`scale|label` para tallas). */
const rowKey = (list, row) => (list === "sizes" ? `${row.scale}|${row.label}` : row.key);

/** `where` de Prisma para una fila por su clave de ruta. */
function whereFor(list, key) {
  if (list !== "sizes") return { key };
  const [scale, label] = key.split("|");
  if (!SCALES.includes(scale) || !label) throw httpError(404, "Talla no encontrada.");
  return { scale_label: { scale, label } };
}

/** Exige Administración para tocar el coste de lavado. */
function requireAdminForLaundry(req) {
  if (!hasCapability(req.user, CAPABILITY.ADMINISTRACION)) {
    throw httpError(403, "El coste de lavado mueve el precio mínimo: lo fija la administración.");
  }
}

/**
 * Comprueba que no haya ya otra entrada con el mismo nombre (sin distinguir
 * mayúsculas ni tildes): dos «Azul» en un filtro serían indistinguibles.
 */
async function assertNameFree(list, name, exceptKey = null) {
  const filas = await prisma[LISTS[list].model].findMany();
  const norm = keyFromName(name);
  const choca = filas.find((r) => keyFromName(r.name ?? r.label) === norm && rowKey(list, r) !== exceptKey);
  if (choca) throw httpError(409, `Ya existe «${choca.name ?? choca.label}» en esta lista.`);
}

/**
 * Registra las rutas de administración de la taxonomía.
 * @param {import("fastify").FastifyInstance} app Instancia Fastify.
 * @param {{requireCapability: Function}} guards preHandlers de autorización.
 */
export function registerTaxonomyAdminRoutes(app, { requireCapability }) {
  const inventario = requireCapability(CAPABILITY.INVENTARIO);

  // Todas las listas con lo que el panel necesita y el público no: el coste
  // de lavado y cuántos usan cada entrada (para saber qué se puede borrar).
  app.get("/api/admin/taxonomy", { preHandler: inventario }, async () => {
    const out = {};
    for (const [name, cfg] of Object.entries(LISTS)) {
      const orden = name === "sizes" ? [{ scale: "asc" }, { sort: "asc" }] : [{ sort: "asc" }];
      const filas = await prisma[cfg.model].findMany({ orderBy: orden });
      out[name] = await Promise.all(filas.map(async (r) => ({ ...r, id: rowKey(name, r), uses: await cfg.uses(rowKey(name, r)) })));
    }
    return out;
  });

  // Alta de una entrada al final de su lista.
  app.post("/api/taxonomy/:list", { preHandler: inventario }, async (req, reply) => {
    const list = listOf(req.params.list);
    const b = req.body ?? {};
    const data = {};
    if (list.name === "sizes") {
      data.scale = b.scale;
      data.label = parseSize(b.scale, b.label);
      if (await prisma.size.findUnique({ where: { scale_label: { scale: data.scale, label: data.label } } })) {
        throw httpError(409, "Esa talla ya existe.");
      }
    } else {
      data.name = parseName(b.name);
      data.key = keyFromName(data.name);
      if (!data.key) throw httpError(400, "El nombre necesita alguna letra o número.");
      if (await prisma[list.model].findUnique({ where: { key: data.key } })) throw httpError(409, "Ya existe una entrada con esa clave.");
      await assertNameFree(list.name, data.name);
    }
    if (list.name === "categories") {
      const prefix = typeof b.prefix === "string" ? b.prefix.trim().toUpperCase() : "";
      if (!/^[A-Z]{3}$/.test(prefix)) throw httpError(400, "El prefijo de inventario son 3 letras (p. ej. FIE).");
      if (await prisma.category.findUnique({ where: { prefix } })) throw httpError(409, `El prefijo ${prefix} ya es de otra categoría.`);
      data.prefix = prefix;
    }
    if (list.name === "colors") data.hex = parseHex(b.hex);
    if (list.name === "materials") {
      requireAdminForLaundry(req);
      data.laundryCents = parseLaundry(b.laundryCents);
    }

    // Al final de su lista (de su escala, en tallas).
    const ultima = await prisma[list.model].aggregate({
      _max: { sort: true },
      ...(list.name === "sizes" ? { where: { scale: data.scale } } : {}),
    });
    data.sort = (ultima._max.sort ?? 0) + 1;
    const fila = await prisma.$transaction(async (tx) => {
      const creada = await tx[list.model].create({ data });
      const extra = list.name === "categories" ? ` · prefijo ${creada.prefix}`
        : list.name === "colors" ? ` · ${creada.hex}`
          : list.name === "materials" ? ` · lavado $${(creada.laundryCents / 100).toFixed(2)}` : "";
      await logActivity(tx, {
        action: ACTIVITY.TAXONOMIA_ALTA, actorId: req.user.id,
        note: `${LIST_LABEL[list.name]} nueva: «${rowName(list.name, creada)}»${extra}`,
        detail: { list: list.name, key: rowKey(list.name, creada) },
      });
      return creada;
    });
    return reply.code(201).send({ ...fila, id: rowKey(list.name, fila), uses: 0 });
  });

  // Cambio de nombre, hex o coste de lavado. La clave, el prefijo y la talla
  // misma no se cambian (ver cabecera).
  app.patch("/api/taxonomy/:list/:key", { preHandler: inventario }, async (req) => {
    const list = listOf(req.params.list);
    const key = req.params.key;
    const b = req.body ?? {};
    if ("key" in b || "prefix" in b || "label" in b || "scale" in b) {
      throw httpError(400, "La clave, el prefijo y la talla no se cambian: los usan códigos y prendas ya dados de alta.");
    }
    const actual = await prisma[list.model].findUnique({ where: whereFor(list.name, key) });
    if (!actual) throw httpError(404, "Entrada no encontrada.");

    const data = {};
    if ("name" in b) {
      if (list.name === "sizes") throw httpError(400, "Una talla no tiene nombre aparte.");
      data.name = parseName(b.name);
      await assertNameFree(list.name, data.name, key);
    }
    if ("hex" in b) {
      if (list.name !== "colors") throw httpError(400, "Solo los colores llevan hex.");
      data.hex = parseHex(b.hex);
    }
    if ("laundryCents" in b) {
      if (list.name !== "materials") throw httpError(400, "Solo los materiales llevan coste de lavado.");
      requireAdminForLaundry(req);
      data.laundryCents = parseLaundry(b.laundryCents);
    }
    if (!Object.keys(data).length) throw httpError(400, "No hay nada que cambiar.");
    const fila = await prisma.$transaction(async (tx) => {
      const nueva = await tx[list.model].update({ where: whereFor(list.name, key), data });
      const partes = [];
      if ("name" in data && data.name !== actual.name) partes.push(`«${actual.name}» → «${data.name}»`);
      if ("hex" in data && data.hex !== actual.hex) partes.push(`${actual.hex} → ${data.hex}`);
      if ("laundryCents" in data && data.laundryCents !== actual.laundryCents) {
        partes.push(`lavado $${(actual.laundryCents / 100).toFixed(2)} → $${(data.laundryCents / 100).toFixed(2)}`);
      }
      await logActivity(tx, {
        action: ACTIVITY.TAXONOMIA_EDICION, actorId: req.user.id,
        note: `${LIST_LABEL[list.name]} «${rowName(list.name, actual)}»: ${partes.join(" · ") || "sin cambios visibles"}`,
        detail: { list: list.name, key, changes: data },
      });
      return nueva;
    });
    return { ...fila, id: rowKey(list.name, fila), uses: await list.uses(key) };
  });

  // Nuevo orden de una lista entera (de una escala, en tallas): la lista
  // enviada tiene que tener exactamente las mismas entradas.
  app.put("/api/taxonomy/:list/order", { preHandler: inventario }, async (req) => {
    const list = listOf(req.params.list);
    const keys = req.body?.keys;
    if (!Array.isArray(keys) || !keys.every((k) => typeof k === "string") || new Set(keys).size !== keys.length) {
      throw httpError(400, "Envía las claves en el orden nuevo, sin repetir.");
    }
    const scale = list.name === "sizes" ? keys[0]?.split("|")[0] : null;
    const filas = await prisma[list.model].findMany(scale ? { where: { scale } } : {});
    const actuales = new Set(filas.map((r) => rowKey(list.name, r)));
    if (keys.length !== actuales.size || !keys.every((k) => actuales.has(k))) {
      throw httpError(409, "La lista cambió mientras tanto; vuelve a cargar.");
    }
    await prisma.$transaction([
      ...keys.map((k, i) => prisma[list.model].update({ where: whereFor(list.name, k), data: { sort: i + 1 } })),
      prisma.activityLog.create({
        data: {
          action: ACTIVITY.TAXONOMIA_ORDEN, actorId: req.user.id,
          note: `Nuevo orden de ${list.name === "sizes" ? `tallas de ${scale === "CALZADO" ? "calzado" : "ropa"}` : LIST_LABEL[list.name].toLowerCase()}`,
          detail: { list: list.name, keys },
        },
      }),
    ]);
    return { ok: true };
  });

  // Borrado, solo si nada lo usa. Lo usado se puede renombrar, no borrar: un
  // modelo no puede quedarse sin categoría ni un ejemplar sin talla.
  app.delete("/api/taxonomy/:list/:key", { preHandler: inventario }, async (req, reply) => {
    const list = listOf(req.params.list);
    const key = req.params.key;
    const actual = await prisma[list.model].findUnique({ where: whereFor(list.name, key) });
    if (!actual) throw httpError(404, "Entrada no encontrada.");
    const n = await list.uses(key);
    if (n > 0) {
      throw httpError(409, `No se puede borrar: la usa${n === 1 ? "" : "n"} ${n} ${list.what}${n === 1 ? "" : "s"}. Puedes renombrarla.`);
    }
    await prisma.$transaction(async (tx) => {
      await tx[list.model].delete({ where: whereFor(list.name, key) });
      await logActivity(tx, {
        action: ACTIVITY.TAXONOMIA_BAJA, actorId: req.user.id,
        note: `${LIST_LABEL[list.name]} borrada: «${rowName(list.name, actual)}»`,
        detail: { list: list.name, key },
      });
    });
    return reply.code(204).send();
  });
}
