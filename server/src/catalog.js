/**
 * Catálogo: modelos, ejemplares y taxonomía (§1 y §5 de DECISIONES).
 *
 * El cliente ve **modelos** y solo sabe si están Disponibles o No Disponibles;
 * los estados internos del ejemplar no salen de aquí. `GET /api/products`
 * conserva la forma que el frontend ya consume (`size`, `color`, `cat`,
 * `disponibles`…) para que la app y la web sigan funcionando sin tocarlas
 * hasta la fase 3, y añade lo nuevo (ejemplares, dueño, taxonomía) al lado.
 */
import prisma from "./db.js";
import { CAPABILITY, httpError } from "./auth.js";
import { logItem } from "./logs.js";
import { todayISO } from "./dates.js";
import { validatePriceOverride } from "./pricing.js";

/** Id del dueño Oficial (CTG), sembrado por la migración. */
export const OFFICIAL_OWNER_ID = 1;

/** Estados internos del ejemplar, como los nombra la base. */
export const ITEM_STATUS = Object.freeze({
  DISPONIBLE: "DISPONIBLE",
  RESERVADA: "RESERVADA",
  EN_ALQUILER: "EN_ALQUILER",
  EN_LAVADO: "EN_LAVADO",
  NO_ALQUILABLE: "NO_ALQUILABLE",
  PERDIDA: "PERDIDA",
});

/**
 * Estados en los que un ejemplar no admite reservas nuevas. Reservada, En
 * Alquiler y En Lavado sí las admiten para OTRAS fechas: esos estados dicen
 * dónde está hoy la prenda, y el solape de días lo decide la base.
 */
export const UNRENTABLE = Object.freeze([ITEM_STATUS.NO_ALQUILABLE, ITEM_STATUS.PERDIDA]);

/** Condiciones físicas válidas de un ejemplar. */
const CONDITIONS = ["NUEVA", "COMO_NUEVA", "BUENA", "USO_VISIBLE"];

/**
 * Convierte un día `YYYY-MM-DD` al `Date` que Prisma espera en una columna
 * `@db.Date`: medianoche UTC, que Postgres guarda como ese mismo día.
 * @param {string} iso Día de calendario.
 * @returns {Date}
 */
export function isoToDate(iso) {
  return new Date(`${iso}T00:00:00Z`);
}

/**
 * Datos de precio de un ejemplar: los de su modelo, más el coste de lavado de
 * la tabla de materiales. Es lo que consumen `rentalPrice()` y el ledger.
 * @param {object} item Ejemplar con `product.materialRef` incluido.
 * @returns {object} Prenda lista para pricing.js.
 */
export function pricedItem(item) {
  const p = item.product;
  return {
    itemId: item.id,
    productId: p.id,
    name: p.name,
    value: p.value,
    stars: p.stars,
    material: p.material,
    weightKg: p.weightKg,
    laundryCost: p.materialRef ? p.materialRef.laundryCents / 100 : undefined,
    priceOverride: p.priceOverride,
    depositOverride: p.depositOverride,
  };
}

/**
 * Ejemplares con una reserva viva que todavía no terminó.
 *
 * Es lo que el cliente ve como «No Disponible» HOY. No sustituye a la
 * restricción de solape (un ejemplar ocupado esta semana se puede reservar
 * para la siguiente); solo responde a la pregunta del catálogo.
 * @param {object} db Cliente Prisma o transacción.
 * @param {number[]} [itemIds] Limitar a estos ejemplares.
 * @returns {Promise<Set<number>>}
 */
export async function busyItemIds(db, itemIds) {
  const filas = await db.orderItem.findMany({
    where: {
      releasedAt: null,
      end: { gte: isoToDate(todayISO()) },
      ...(itemIds ? { itemId: { in: itemIds } } : {}),
    },
    select: { itemId: true },
  });
  return new Set(filas.map((f) => f.itemId));
}

/** Relaciones que hacen falta para describir un modelo al cliente. */
const MODELO_COMPLETO = {
  category: true,
  materialRef: true,
  owner: true,
  occasions: { orderBy: { sort: "asc" } },
  items: { orderBy: { id: "asc" } },
};

/**
 * Indica si un ejemplar debe aparecer en el catálogo. Lo perdido y lo retirado
 * desaparecen; un desperfecto se queda, como No Disponible, porque puede volver.
 * @param {object} item Ejemplar.
 * @returns {boolean}
 */
function isListed(item) {
  if (item.status === ITEM_STATUS.PERDIDA) return false;
  return !(item.status === ITEM_STATUS.NO_ALQUILABLE && item.unrentableReason === "RETIRADA");
}

/**
 * Convierte un modelo de la base en lo que ve el cliente.
 *
 * `size` y `color` de primer nivel son los del primer ejemplar disponible
 * (o el primero listado si no hay ninguno): es lo que el frontend actual sabe
 * pintar mientras no conozca los ejemplares.
 * @param {object} p Modelo con MODELO_COMPLETO incluido.
 * @param {Set<number>} busy Ejemplares ocupados hoy.
 * @returns {object|null} Modelo para la API, o null si no tiene nada listado.
 */
export function productToApi(p, busy) {
  const listados = p.items.filter(isListed).map((i) => ({
    id: i.id,
    size: i.size,
    sizeScale: i.sizeScale,
    color: i.color,
    condition: i.condition,
    measurements: i.measurements,
    available: !UNRENTABLE.includes(i.status) && !busy.has(i.id),
  }));
  if (listados.length === 0) return null;
  const portada = listados.find((i) => i.available) ?? listados[0];
  return {
    id: p.id,
    name: p.name,
    desc: p.desc,
    cat: p.category.name,
    categoryKey: p.categoryKey,
    value: p.value,
    stars: p.stars,
    material: p.material,
    weightKg: p.weightKg,
    imgs: p.imgs,
    brand: p.brand,
    audience: p.audienceKey,
    season: p.seasonKey,
    occasions: p.occasions.map((o) => o.key),
    size: portada.size,
    color: portada.color,
    disponibles: listados.filter((i) => i.available).length,
    owner: { kind: p.owner.kind, name: p.owner.name },
    official: p.owner.kind === "OFICIAL",
    items: listados,
  };
}

/**
 * Siguiente código de inventario `CAT-AA-NNNN` para un prefijo (§5).
 *
 * El contador se incrementa en una sola sentencia (`INSERT … ON CONFLICT`)
 * para que dos altas simultáneas no lean el mismo número: con leer y luego
 * escribir, ambas verían el mismo `last`.
 * @param {object} tx Transacción Prisma.
 * @param {string} prefix Prefijo de la categoría (tres letras).
 * @param {string} [isoDay] Día de alta, para el año; hoy en Guayaquil por defecto.
 * @returns {Promise<string>} Código, p. ej. `FOR-26-0001`.
 */
export async function nextInventoryCode(tx, prefix, isoDay = todayISO()) {
  const year = isoDay.slice(2, 4);
  const [{ last }] = await tx.$queryRaw`
    INSERT INTO "inventory_sequences" ("prefix", "year", "last") VALUES (${prefix}, ${year}, 1)
    ON CONFLICT ("prefix", "year") DO UPDATE SET "last" = "inventory_sequences"."last" + 1
    RETURNING "last"`;
  if (last > 9999) {
    throw httpError(409, `Se agotaron los códigos ${prefix}-${year} de este año.`);
  }
  return `${prefix}-${year}-${String(last).padStart(4, "0")}`;
}

/**
 * Lee la taxonomía entera, cada lista en su orden.
 * @param {object} [db] Cliente Prisma.
 * @returns {Promise<object>} Listas de la taxonomía.
 */
export async function getTaxonomy(db = prisma) {
  const porOrden = { orderBy: { sort: "asc" } };
  const [categories, colors, materials, sizes, occasions, seasons, audiences] = await Promise.all([
    db.category.findMany({ ...porOrden, select: { key: true, name: true, prefix: true } }),
    db.color.findMany({ ...porOrden, select: { key: true, name: true, hex: true } }),
    // El coste de lavado es un dato interno de costes: no le sirve al cliente.
    db.material.findMany({ ...porOrden, select: { key: true, name: true } }),
    db.size.findMany({ orderBy: [{ scale: "asc" }, { sort: "asc" }], select: { scale: true, label: true } }),
    db.occasion.findMany({ ...porOrden, select: { key: true, name: true } }),
    db.season.findMany({ ...porOrden, select: { key: true, name: true } }),
    db.audience.findMany({ ...porOrden, select: { key: true, name: true } }),
  ]);
  return { categories, colors, materials, sizes, occasions, seasons, audiences, conditions: CONDITIONS };
}

/**
 * Valida las medidas de un ejemplar: un objeto plano de centímetros.
 * @param {unknown} m Medidas recibidas.
 * @returns {string|null} Motivo del rechazo, o null si valen.
 */
export function validateMeasurements(m) {
  if (m === undefined || m === null) return null;
  if (typeof m !== "object" || Array.isArray(m)) return "Las medidas van como objeto { nombre: cm }.";
  const entradas = Object.entries(m);
  if (entradas.length > 12) return "Demasiadas medidas para una prenda.";
  for (const [k, v] of entradas) {
    if (!/^[a-z_]{1,24}$/.test(k)) return `Nombre de medida no válido: "${k}".`;
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > 400) {
      return `La medida "${k}" debe ser un número de centímetros.`;
    }
  }
  return null;
}

/**
 * Lee un id numérico de la ruta; un id que no es número es un 404, no un 500.
 * @param {string} raw Parámetro de la ruta.
 * @param {string} what Qué se buscaba, para el mensaje.
 * @returns {number}
 */
export function routeId(raw, what) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw httpError(404, `${what} no encontrado.`);
  return id;
}

/**
 * Registra las rutas del catálogo y la taxonomía.
 * @param {import("fastify").FastifyInstance} app Instancia Fastify.
 * @param {{requireCapability: Function}} guards preHandlers de autorización.
 */
export function registerCatalogRoutes(app, { requireCapability }) {
  // Catálogo público: un modelo por entrada, ordenado por id.
  app.get("/api/products", async () => {
    const [modelos, busy] = await Promise.all([
      prisma.product.findMany({ include: MODELO_COMPLETO, orderBy: { id: "asc" } }),
      busyItemIds(prisma),
    ]);
    return modelos.map((p) => productToApi(p, busy)).filter(Boolean);
  });

  // Taxonomía pública: con ella se construyen los filtros (fase 3) y el
  // formulario de alta del panel (fase 4).
  app.get("/api/taxonomy", async () => getTaxonomy());

  // Alta de un ejemplar físico de un modelo existente, con su código.
  app.post(
    "/api/products/:id/items",
    { preHandler: requireCapability(CAPABILITY.INVENTARIO) },
    async (req, reply) => {
      const productId = routeId(req.params.id, "Modelo");
      const body = req.body ?? {};
      const size = typeof body.size === "string" ? body.size.trim().toUpperCase() : "";
      // La escala se deduce como en el frontend si no viene: talla numérica ⇒ calzado.
      const sizeScale = body.sizeScale ?? (/^\d+$/.test(size) ? "CALZADO" : "ROPA");
      if (!["ROPA", "CALZADO"].includes(sizeScale)) throw httpError(400, "Escala de talla no válida.");
      if (body.condition != null && !CONDITIONS.includes(body.condition)) {
        throw httpError(400, "Condición no válida.");
      }
      const errMedidas = validateMeasurements(body.measurements);
      if (errMedidas) throw httpError(400, errMedidas);

      const creado = await prisma.$transaction(async (tx) => {
        const modelo = await tx.product.findUnique({ where: { id: productId }, include: { category: true } });
        if (!modelo) throw httpError(404, "Modelo no encontrado.");
        // Se comprueban contra la taxonomía antes de escribir para dar un
        // mensaje claro; la clave foránea lo impediría igual, con un 500.
        const [talla, color] = await Promise.all([
          tx.size.findUnique({ where: { scale_label: { scale: sizeScale, label: size } } }),
          tx.color.findUnique({ where: { key: String(body.color ?? "") } }),
        ]);
        if (!talla) throw httpError(400, "Talla no válida para su escala.");
        if (!color) throw httpError(400, "Color fuera de la paleta.");

        const item = await tx.item.create({
          data: {
            productId,
            code: await nextInventoryCode(tx, modelo.category.prefix),
            sizeScale,
            size,
            color: color.key,
            condition: body.condition ?? null,
            measurements: body.measurements ?? undefined,
          },
        });
        await logItem(tx, {
          itemId: item.id,
          from: null,
          to: item.status,
          actorId: req.user.id,
          note: typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : "Alta del ejemplar",
        });
        return item;
      });
      return reply.code(201).send(creado);
    },
  );

  // Ajuste manual del precio y garantía fija de un modelo con fórmula CTG.
  app.patch(
    "/api/products/:id/pricing",
    { preHandler: requireCapability(CAPABILITY.ADMINISTRACION) },
    async (req) => {
      const id = routeId(req.params.id, "Modelo");
      const body = req.body ?? {};
      const modelo = await prisma.product.findUnique({ where: { id }, include: { materialRef: true } });
      if (!modelo) throw httpError(404, "Modelo no encontrado.");
      if (modelo.pricing !== "CTG") {
        // Un local fija sus propias tarifas: CTG no le ajusta nada (§9).
        throw httpError(409, "Este modelo usa la tarifa de su socio.");
      }

      const data = {};
      if ("priceOverride" in body) {
        const err = validatePriceOverride(
          { ...modelo, laundryCost: modelo.materialRef.laundryCents / 100 },
          body.priceOverride,
        );
        if (err) throw httpError(400, err);
        data.priceOverride = body.priceOverride;
      }
      if ("depositOverride" in body) {
        const d = body.depositOverride;
        if (d !== null && !(Number.isInteger(d) && d > 0)) {
          throw httpError(400, "La garantía fija va en dólares enteros y positivos.");
        }
        data.depositOverride = d;
      }
      if (Object.keys(data).length === 0) throw httpError(400, "No hay nada que ajustar.");

      const actualizado = await prisma.product.update({ where: { id }, data });
      return { id, priceOverride: actualizado.priceOverride, depositOverride: actualizado.depositOverride };
    },
  );
}
