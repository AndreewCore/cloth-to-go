/**
 * Catálogo desde el panel (fase 4): alta y edición de modelos, sus fotos de
 * catálogo y las fotos de estado de cada ejemplar.
 *
 * Dos clases de foto con destinos distintos:
 * - **De catálogo** (`products.imgs`): las ve cualquiera, van al cubo público.
 * - **De estado** (`item_photos`): cómo salió y cómo llegó un ejemplar
 *   concreto. Son evidencia interna, van al cubo privado y solo se ven con un
 *   enlace firmado que caduca.
 */
import prisma from "./db.js";
import { CAPABILITY, hasCapability, httpError } from "./auth.js";
import { routeId, validateMeasurements } from "./catalog.js";
import { PHOTO_LIMITS, readPhotoUpload } from "./photos.js";
import { BUCKET, PRIVATE_FOLDERS, catalogPhotoUrl, isStorageKey, newKey, requestOrigin } from "./storage.js";
import { logValueChange } from "./pricingAdmin.js";
import { ACTIVITY, logActivity } from "./logs.js";

/** Nombre legible de cada campo del modelo, para la nota de la bitácora. */
const FIELD_LABEL = {
  name: "nombre", desc: "descripción", categoryKey: "categoría", material: "material", value: "valor",
  stars: "estrellas", weightKg: "peso", brand: "marca", audienceKey: "público", seasonKey: "temporada",
};

const CONDITIONS = ["NUEVA", "COMO_NUEVA", "BUENA", "USO_VISIBLE"];
const PHOTO_KINDS = ["SALIDA", "LLEGADA", "ESTADO"];

/**
 * URL con la que el PANEL ve una foto del catálogo. Las rutas antiguas
 * (`img/products/…`) las sirve el propio panel en `/admin/fotos/`.
 * @param {object} storage Almacenamiento.
 * @param {string} img Clave o ruta de `products.imgs`.
 * @param {string} origin Origen de la API.
 * @returns {string}
 */
export function panelPhotoUrl(storage, img, origin) {
  if (typeof img === "string" && img.startsWith("img/products/")) return `/admin/fotos/${img.slice("img/products/".length)}`;
  return catalogPhotoUrl(storage, img, origin);
}

/**
 * Valida los campos de un modelo contra la taxonomía.
 * @param {object} body Cuerpo recibido.
 * @param {boolean} partial true en una edición: solo se validan los presentes.
 * @returns {Promise<object>} Datos listos para Prisma (sin `occasions`) y `occasions` aparte.
 */
async function parseModel(body, partial) {
  const b = body ?? {};
  const has = (k) => k in b;
  const data = {};
  const texto = (k, min, max, label) => {
    const v = typeof b[k] === "string" ? b[k].trim() : null;
    if (v === null || v.length < min || v.length > max) throw httpError(400, `${label}: entre ${min} y ${max} caracteres.`);
    return v;
  };
  const numero = (k, min, max, label, entero = false) => {
    const v = b[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max || (entero && !Number.isInteger(v))) {
      throw httpError(400, `${label}: ${entero ? "un entero" : "un número"} entre ${min} y ${max}.`);
    }
    return v;
  };
  const opcional = (k) => (b[k] === null || b[k] === "" ? null : String(b[k]));

  for (const k of ["name", "categoryKey", "material", "value", "stars", "weightKg"]) {
    if (!partial && !has(k)) throw httpError(400, `Falta el campo ${k}.`);
  }
  if (has("name")) data.name = texto("name", 2, 80, "Nombre");
  if (has("desc")) data.desc = texto("desc", 0, 1000, "Descripción");
  else if (!partial) data.desc = "";
  if (has("value")) data.value = numero("value", 1, 5000, "Valor de reposición (USD)");
  if (has("stars")) data.stars = numero("stars", 1, 5, "Estrellas", true);
  if (has("weightKg")) data.weightKg = numero("weightKg", 0.05, 20, "Peso (kg)");
  if (has("brand")) {
    const v = opcional("brand");
    if (v !== null && v.trim().length > 60) throw httpError(400, "Marca: 60 caracteres como máximo.");
    data.brand = v === null ? null : v.trim() || null;
  }

  // Las claves se comprueban antes de escribir para dar un mensaje claro; la
  // clave foránea lo impediría igual, pero con un 500.
  const checks = [];
  const existe = (modelo, k, label) => {
    if (!has(k)) return;
    const v = opcional(k);
    if (v === null) {
      if (k === "categoryKey" || k === "material") throw httpError(400, `${label} es obligatorio.`);
      data[k] = null;
      return;
    }
    checks.push(prisma[modelo].findUnique({ where: { key: v } }).then((r) => {
      if (!r) throw httpError(400, `${label} fuera de la taxonomía.`);
      data[k] = v;
    }));
  };
  existe("category", "categoryKey", "Categoría");
  existe("material", "material", "Material");
  existe("audience", "audienceKey", "Público");
  existe("season", "seasonKey", "Temporada");

  let occasions;
  if (has("occasions")) {
    if (!Array.isArray(b.occasions) || b.occasions.length > 10 || !b.occasions.every((o) => typeof o === "string")) {
      throw httpError(400, "Ocasiones: una lista de claves.");
    }
    occasions = [...new Set(b.occasions)];
    checks.push(prisma.occasion.count({ where: { key: { in: occasions } } }).then((n) => {
      if (n !== occasions.length) throw httpError(400, "Alguna ocasión está fuera de la taxonomía.");
    }));
  }
  await Promise.all(checks);
  return { data, occasions };
}

/**
 * Modelo tal como lo ve el panel: todos sus campos, sus fotos con URL y sus
 * ejemplares con el estado interno.
 */
function modelForPanel(p, storage, origin) {
  return {
    id: p.id,
    name: p.name,
    desc: p.desc,
    categoryKey: p.categoryKey,
    category: p.category.name,
    material: p.material,
    value: p.value,
    stars: p.stars,
    weightKg: p.weightKg,
    brand: p.brand,
    audienceKey: p.audienceKey,
    seasonKey: p.seasonKey,
    occasions: p.occasions.map((o) => o.key),
    priceOverride: p.priceOverride,
    depositOverride: p.depositOverride,
    imgs: p.imgs,
    photos: p.imgs.map((img) => ({ img, url: panelPhotoUrl(storage, img, origin) })),
    items: p.items.map((i) => ({
      id: i.id, code: i.code, size: i.size, sizeScale: i.sizeScale, color: i.color,
      condition: i.condition, measurements: i.measurements, status: i.status,
    })),
  };
}

const MODELO_PANEL = {
  category: true,
  occasions: { orderBy: { sort: "asc" } },
  items: { orderBy: { id: "asc" } },
};

/**
 * Bloquea la fila del modelo hasta el final de la transacción: dos subidas a
 * la vez no pueden pasar las dos el tope de 6 fotos leyendo la misma lista.
 * @returns {Promise<string[]>} Fotos actuales.
 */
async function lockModelPhotos(tx, id) {
  const filas = await tx.$queryRaw`SELECT "imgs" FROM "products" WHERE "id" = ${id} FOR UPDATE`;
  if (!filas.length) throw httpError(404, "Modelo no encontrado.");
  return filas[0].imgs;
}

/**
 * Borra objetos del almacenamiento sin tumbar la petición: si falla, queda un
 * archivo huérfano (se registra), nunca una fila que apunte a la nada.
 */
async function removeQuietly(storage, keys, log) {
  for (const key of keys) {
    await storage.remove(key).catch((err) => log.error({ err, key }, "No se pudo borrar una foto del almacenamiento"));
  }
}

/**
 * Sube fotos ya recodificadas y devuelve sus claves. Si una falla, borra las
 * que sí subieron y relanza.
 */
async function putAll(storage, bucket, photos, log) {
  const keys = [];
  try {
    for (const buf of photos) {
      const key = newKey(bucket);
      await storage.put(key, buf);
      keys.push(key);
    }
  } catch (err) {
    await removeQuietly(storage, keys, log);
    throw err;
  }
  return keys;
}

/**
 * Registra las rutas del catálogo del panel y, con el conductor de disco, las
 * que sirven los archivos.
 * @param {import("fastify").FastifyInstance} app Instancia Fastify.
 * @param {{requireCapability: Function}} guards preHandlers de autorización.
 * @param {{storage: object, allowUpload: (userId: number) => boolean}} deps
 */
export function registerCatalogAdminRoutes(app, { requireCapability }, { storage, allowUpload }) {
  const inventario = requireCapability(CAPABILITY.INVENTARIO);
  const mostradorOInventario = requireCapability(CAPABILITY.MOSTRADOR, CAPABILITY.INVENTARIO);

  /** Corta la petición si la persona ya subió demasiado en el último minuto. */
  const limitar = (req) => {
    if (!allowUpload(req.user.id)) throw httpError(429, "Demasiadas subidas seguidas. Espera un minuto.");
  };

  // Todos los modelos, también los que aún no tienen ejemplares (que el
  // catálogo público esconde): es donde se terminan de dar de alta.
  app.get("/api/admin/products", { preHandler: inventario }, async (req) => {
    const modelos = await prisma.product.findMany({ include: MODELO_PANEL, orderBy: { id: "desc" } });
    return modelos.map((p) => modelForPanel(p, storage, requestOrigin(req)));
  });

  // Alta de un modelo. Precio y garantía salen de valor y estrellas; el
  // ajuste manual es otra ruta, de Administración.
  app.post("/api/products", { preHandler: inventario }, async (req, reply) => {
    const { data, occasions } = await parseModel(req.body, false);
    const creado = await prisma.$transaction(async (tx) => {
      const fila = await tx.product.create({
        data: { ...data, imgs: [], ...(occasions ? { occasions: { connect: occasions.map((key) => ({ key })) } } : {}) },
        include: MODELO_PANEL,
      });
      await logActivity(tx, {
        action: ACTIVITY.MODELO_ALTA, actorId: req.user.id, productId: fila.id,
        note: `Alta de «${fila.name}» (${fila.category.name}, $${fila.value}, ${fila.stars}★)`,
      });
      return fila;
    });
    return reply.code(201).send(modelForPanel(creado, storage, requestOrigin(req)));
  });

  // Edición de un modelo. Valor y estrellas mueven el precio y la garantía de
  // todos sus alquileres futuros: eso es de Administración, como el ajuste.
  app.patch("/api/products/:id", { preHandler: inventario }, async (req) => {
    const id = routeId(req.params.id, "Modelo");
    const { data, occasions } = await parseModel(req.body, true);
    if (("value" in data || "stars" in data) && !hasCapability(req.user, CAPABILITY.ADMINISTRACION)) {
      throw httpError(403, "Cambiar el valor o las estrellas mueve el precio: es de la administración.");
    }
    if (!Object.keys(data).length && !occasions) throw httpError(400, "No hay nada que cambiar.");
    const actualizado = await prisma.$transaction(async (tx) => {
      const antes = await tx.product.findUnique({ where: { id } });
      if (!antes) throw httpError(404, "Modelo no encontrado.");
      const fila = await tx.product.update({
        where: { id },
        data: { ...data, ...(occasions ? { occasions: { set: occasions.map((key) => ({ key })) } } : {}) },
        include: MODELO_PANEL,
      });
      // Valor y estrellas mueven precio y garantía: quedan en la bitácora.
      await logValueChange(tx, antes, data, req.user.id);
      const cambiados = Object.keys(data).filter((k) => data[k] !== antes[k]).map((k) => FIELD_LABEL[k] ?? k);
      if (occasions) cambiados.push("ocasiones");
      await logActivity(tx, {
        action: ACTIVITY.MODELO_EDICION, actorId: req.user.id, productId: id,
        note: `«${fila.name}»: cambió ${cambiados.join(", ") || "nada visible"}`,
        detail: { fields: Object.keys(data), ...(occasions ? { occasions } : {}) },
      });
      return fila;
    });
    return modelForPanel(actualizado, storage, requestOrigin(req));
  });

  // Sube fotos de catálogo al final de la lista (la primera es la portada).
  app.post("/api/products/:id/photos", { preHandler: inventario }, async (req) => {
    const id = routeId(req.params.id, "Modelo");
    limitar(req);
    const actuales = (await prisma.product.findUnique({ where: { id }, select: { imgs: true } }))?.imgs;
    if (!actuales) throw httpError(404, "Modelo no encontrado.");
    // Primer aviso antes de procesar nada; el definitivo va con la fila bloqueada.
    if (actuales.length >= PHOTO_LIMITS.maxFiles) throw httpError(409, `El modelo ya tiene ${PHOTO_LIMITS.maxFiles} fotos.`);

    const { photos } = await readPhotoUpload(req);
    const keys = await putAll(storage, BUCKET.PUBLIC, photos, req.log);
    try {
      const imgs = await prisma.$transaction(async (tx) => {
        const ahora = await lockModelPhotos(tx, id);
        if (ahora.length + keys.length > PHOTO_LIMITS.maxFiles) {
          throw httpError(409, `Un modelo tiene ${PHOTO_LIMITS.maxFiles} fotos como máximo (ya tiene ${ahora.length}).`);
        }
        const fila = await tx.product.update({ where: { id }, data: { imgs: [...ahora, ...keys] } });
        await logActivity(tx, {
          action: ACTIVITY.FOTO_CATALOGO_SUBIDA, actorId: req.user.id, productId: id,
          note: `${keys.length} foto${keys.length === 1 ? "" : "s"} subida${keys.length === 1 ? "" : "s"} a «${fila.name}»`,
          detail: { keys },
        });
        return fila.imgs;
      });
      return { imgs, photos: imgs.map((img) => ({ img, url: panelPhotoUrl(storage, img, requestOrigin(req)) })) };
    } catch (err) {
      await removeQuietly(storage, keys, req.log);
      throw err;
    }
  });

  // Reordena o quita fotos de catálogo: la lista nueva tiene que salir de la
  // actual (no se cuela una ruta ajena). Las quitadas salen del catálogo pero
  // NO se borran del cubo: la bitácora las enseña, para saber qué se quitó.
  app.put("/api/products/:id/photos", { preHandler: inventario }, async (req) => {
    const id = routeId(req.params.id, "Modelo");
    const pedidas = req.body?.imgs;
    if (!Array.isArray(pedidas) || !pedidas.every((x) => typeof x === "string") || new Set(pedidas).size !== pedidas.length) {
      throw httpError(400, "Envía la lista de fotos, sin repetir.");
    }
    const { imgs } = await prisma.$transaction(async (tx) => {
      const ahora = await lockModelPhotos(tx, id);
      if (!pedidas.every((x) => ahora.includes(x))) throw httpError(409, "La lista de fotos cambió mientras tanto; vuelve a cargar.");
      const nuevo = await tx.product.update({ where: { id }, data: { imgs: pedidas } });
      const quitadas = ahora.filter((x) => !pedidas.includes(x));
      if (quitadas.length) {
        await logActivity(tx, {
          action: ACTIVITY.FOTO_CATALOGO_QUITADA, actorId: req.user.id, productId: id,
          note: `${quitadas.length} foto${quitadas.length === 1 ? "" : "s"} quitada${quitadas.length === 1 ? "" : "s"} de «${nuevo.name}»`,
          detail: { keys: quitadas },
        });
      } else if (pedidas.join() !== ahora.join()) {
        await logActivity(tx, {
          action: ACTIVITY.FOTOS_CATALOGO_ORDEN, actorId: req.user.id, productId: id,
          note: `Nuevo orden de fotos de «${nuevo.name}»${pedidas[0] !== ahora[0] ? " (cambió la portada)" : ""}`,
          detail: { before: ahora, after: pedidas },
        });
      }
      return { imgs: nuevo.imgs };
    });
    return { imgs, photos: imgs.map((img) => ({ img, url: panelPhotoUrl(storage, img, requestOrigin(req)) })) };
  });

  // Corrige la condición o las medidas de un ejemplar. Talla y color no: son
  // la identidad física de la prenda y van en su código de alta.
  app.patch("/api/items/:id", { preHandler: inventario }, async (req) => {
    const id = routeId(req.params.id, "Ejemplar");
    const b = req.body ?? {};
    const data = {};
    if ("condition" in b) {
      if (b.condition !== null && !CONDITIONS.includes(b.condition)) throw httpError(400, "Condición no válida.");
      data.condition = b.condition;
    }
    if ("measurements" in b) {
      const err = validateMeasurements(b.measurements);
      if (err) throw httpError(400, err);
      data.measurements = b.measurements ?? null;
    }
    if (!Object.keys(data).length) throw httpError(400, "No hay nada que cambiar.");
    return prisma.$transaction(async (tx) => {
      const antes = await tx.item.findUnique({ where: { id }, include: { product: { select: { id: true, name: true } } } });
      if (!antes) throw httpError(404, "Ejemplar no encontrado.");
      const fila = await tx.item.update({ where: { id }, data });
      const partes = [];
      if ("condition" in data) partes.push(`condición: ${antes.condition ?? "—"} → ${data.condition ?? "—"}`);
      if ("measurements" in data) partes.push("medidas");
      await logActivity(tx, {
        action: ACTIVITY.EJEMPLAR_EDICION, actorId: req.user.id, productId: antes.product.id, itemId: id,
        note: `${antes.code ?? `#${id}`} (${antes.product.name}): ${partes.join(" · ")}`,
      });
      return fila;
    });
  });

  // Fotos de estado de un ejemplar: al entregarlo (SALIDA), al recibirlo
  // (LLEGADA) o en cualquier momento (ESTADO). Las dos primeras van atadas a
  // un pedido de ese ejemplar.
  app.post("/api/items/:id/photos", { preHandler: mostradorOInventario }, async (req, reply) => {
    const itemId = routeId(req.params.id, "Ejemplar");
    limitar(req);
    const { fields, photos } = await readPhotoUpload(req);
    const kind = fields.kind;
    if (!PHOTO_KINDS.includes(kind)) throw httpError(400, "Indica si la foto es de salida, de llegada o de estado.");
    let orderId = null;
    if (kind !== "ESTADO") {
      orderId = Number(fields.orderId);
      if (!Number.isInteger(orderId) || orderId <= 0) throw httpError(400, "Una foto de salida o llegada va con su pedido.");
      const linea = await prisma.orderItem.findFirst({ where: { orderId, itemId }, select: { id: true } });
      if (!linea) throw httpError(409, "Ese ejemplar no es de ese pedido.");
    } else if (!(await prisma.item.findUnique({ where: { id: itemId }, select: { id: true } }))) {
      throw httpError(404, "Ejemplar no encontrado.");
    }

    const keys = await putAll(storage, BUCKET.PRIVATE, photos, req.log);
    try {
      await prisma.itemPhoto.createMany({
        data: keys.map((key) => ({ itemId, orderId, kind, key, takenById: req.user.id })),
      });
    } catch (err) {
      await removeQuietly(storage, keys, req.log);
      throw err;
    }
    return reply.code(201).send({ count: keys.length });
  });

  // Fotos de estado de un ejemplar, de la más reciente a la más vieja, con
  // enlaces firmados que caducan a los pocos minutos.
  app.get("/api/items/:id/photos", { preHandler: mostradorOInventario }, async (req) => {
    const itemId = routeId(req.params.id, "Ejemplar");
    const fotos = await prisma.itemPhoto.findMany({
      where: { itemId },
      orderBy: { id: "desc" },
      include: { takenBy: { select: { name: true } } },
    });
    const origin = requestOrigin(req);
    return Promise.all(fotos.map(async (f) => ({
      id: f.id,
      kind: f.kind,
      orderId: f.orderId,
      createdAt: f.createdAt,
      takenBy: f.takenBy.name,
      url: await storage.signedUrl(f.key, origin),
    })));
  });

  if (storage.driver === "disk") registerDiskMedia(app, storage);
}

/**
 * Sirve los archivos del conductor de disco. Lo público con caché larga (una
 * clave nunca cambia de contenido); lo privado solo con firma válida y sin
 * caché, porque el enlace caduca.
 * @param {import("fastify").FastifyInstance} app
 * @param {object} storage Conductor de disco.
 */
function registerDiskMedia(app, storage) {
  const servir = async (reply, key, cache) => {
    const buf = await storage.read(key);
    if (!buf) throw httpError(404, "Foto no encontrada.");
    return reply
      .header("content-type", "image/webp")
      .header("x-content-type-options", "nosniff")
      .header("cache-control", cache)
      .send(buf);
  };

  app.get("/media/catalogo/:file", async (req, reply) => {
    const key = `catalogo/${req.params.file}`;
    if (!isStorageKey(key)) throw httpError(404, "Foto no encontrada.");
    return servir(reply, key, "public, max-age=31536000, immutable");
  });

  // Lo privado (fotos de estado y de reseñas sin aprobar), solo con firma.
  app.get("/media/:folder/:file", async (req, reply) => {
    if (!PRIVATE_FOLDERS.includes(req.params.folder)) throw httpError(404, "Foto no encontrada.");
    const key = `${req.params.folder}/${req.params.file}`;
    if (!storage.verify(key, req.query?.exp, req.query?.sig)) throw httpError(403, "Enlace caducado o no válido.");
    return servir(reply, key, "private, no-store");
  });
}
