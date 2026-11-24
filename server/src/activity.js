/**
 * Bitácora general del panel (fase 4): todo lo que pasó, junto, con quién y
 * cuándo. Solo para Administración: mezcla dinero, permisos del personal y
 * movimientos de prendas.
 *
 * No es una tabla más donde todo se escribe dos veces: junta las cuatro que ya
 * existen, cada una de solo añadir, en una misma forma:
 * - `activity_logs`: catálogo, fotos de catálogo y taxonomía;
 * - `item_logs`: altas de ejemplares, cambios de estado y recepciones;
 * - `finance_logs`: cobros, garantías, anulaciones, días extra, precios y permisos;
 * - `item_photos`: fotos de salida, llegada y estado.
 */
import prisma from "./db.js";
import { CAPABILITY, httpError } from "./auth.js";
import { panelPhotoUrl } from "./catalogAdmin.js";
import { requestOrigin } from "./storage.js";

/** Categorías de los filtros, en el orden del panel. */
export const CATEGORIES = Object.freeze({
  catalogo: "Catálogo",
  fotos: "Fotos",
  prendas: "Prendas",
  dinero: "Dinero",
  precio: "Precio",
  personal: "Personal",
  taxonomia: "Taxonomía",
  calendario: "Calendario",
});

/**
 * Cada acción: su texto, su categoría, de qué tabla sale y, si comparte tabla
 * con otras, qué filas son suyas.
 */
const ACTIONS = {
  MODELO_ALTA: { label: "Alta de modelo", category: "catalogo", source: "activity" },
  MODELO_EDICION: { label: "Edición de modelo", category: "catalogo", source: "activity" },
  EJEMPLAR_EDICION: { label: "Edición de ejemplar", category: "catalogo", source: "activity" },
  FOTO_CATALOGO_SUBIDA: { label: "Foto de catálogo subida", category: "fotos", source: "activity" },
  FOTO_CATALOGO_QUITADA: { label: "Foto de catálogo quitada", category: "fotos", source: "activity" },
  FOTOS_CATALOGO_ORDEN: { label: "Fotos reordenadas", category: "fotos", source: "activity" },
  FOTO_ESTADO: { label: "Foto de salida, llegada o estado", category: "fotos", source: "photos" },
  EJEMPLAR_ALTA: { label: "Alta de ejemplar", category: "prendas", source: "items", where: { from: null } },
  // La recepción no cambia el estado (de En alquiler a En alquiler): se
  // distingue por la nota que escribe siempre `POST /api/orders/:id/receive`.
  RECEPCION: { label: "Devolución registrada", category: "prendas", source: "items", where: { note: { startsWith: "Recibida" } } },
  ESTADO: {
    label: "Cambio de estado",
    category: "prendas",
    source: "items",
    where: { from: { not: null }, OR: [{ note: null }, { NOT: { note: { startsWith: "Recibida" } } }] },
  },
  COBRO_CONFIRMADO: { label: "Cobro confirmado", category: "dinero", source: "finance" },
  GARANTIA_LIBERADA: { label: "Garantía liberada", category: "dinero", source: "finance" },
  PENALIZACION: { label: "Penalización", category: "dinero", source: "finance" },
  ANULACION: { label: "Pedido anulado", category: "dinero", source: "finance" },
  DIAS_EXTRA: { label: "Días extra cobrados", category: "dinero", source: "finance" },
  PRECIO: { label: "Cambio de precio", category: "precio", source: "finance" },
  CAPACIDADES: { label: "Permisos del personal", category: "personal", source: "finance" },
  TAXONOMIA_ALTA: { label: "Alta en la taxonomía", category: "taxonomia", source: "activity" },
  TAXONOMIA_EDICION: { label: "Edición de la taxonomía", category: "taxonomia", source: "activity" },
  TAXONOMIA_ORDEN: { label: "Orden de la taxonomía", category: "taxonomia", source: "activity" },
  TAXONOMIA_BAJA: { label: "Baja en la taxonomía", category: "taxonomia", source: "activity" },
  FERIADO_ALTA: { label: "Cierre añadido", category: "calendario", source: "activity" },
  FERIADO_EDICION: { label: "Cierre editado", category: "calendario", source: "activity" },
  FERIADO_BAJA: { label: "Cierre quitado", category: "calendario", source: "activity" },
  HORARIO: { label: "Horario de atención", category: "calendario", source: "activity" },
};

const STATUS_LABEL = {
  DISPONIBLE: "Disponible", RESERVADA: "Reservada", EN_ALQUILER: "En alquiler",
  EN_LAVADO: "En lavado", NO_ALQUILABLE: "No alquilable", PERDIDA: "Perdida",
};
const PHOTO_KIND = { SALIDA: "salida", LLEGADA: "llegada", ESTADO: "estado" };

const LIMIT_DEFAULT = 50;
const LIMIT_MAX = 200;
/** Filas de más por tabla: cubre empates de milisegundo entre tablas al paginar. */
const SLACK = 20;

/** Inicio de un día `YYYY-MM-DD` en Guayaquil (UTC−5, sin horario de verano). */
const dayStart = (iso) => new Date(`${iso}T00:00:00-05:00`);

/**
 * Lee y valida los filtros de la consulta.
 * @param {object} q `req.query`.
 * @returns {object} Filtros normalizados.
 */
export function parseFilters(q = {}) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  let actions = Object.keys(ACTIONS);
  if (q.category) {
    if (!CATEGORIES[q.category]) throw httpError(400, "Categoría desconocida.");
    actions = actions.filter((a) => ACTIONS[a].category === q.category);
  }
  if (q.action) {
    if (!ACTIONS[q.action]) throw httpError(400, "Acción desconocida.");
    actions = actions.filter((a) => a === q.action);
  }
  let actor;
  if (q.actor === "system") actor = null;
  else if (q.actor) {
    actor = Number(q.actor);
    if (!Number.isInteger(actor) || actor <= 0) throw httpError(400, "Persona no válida.");
  }
  for (const k of ["from", "to"]) if (q[k] && !iso.test(q[k])) throw httpError(400, "Las fechas van como AAAA-MM-DD.");
  const limit = Math.min(Math.max(Number(q.limit) || LIMIT_DEFAULT, 1), LIMIT_MAX);
  const before = q.before ? new Date(q.before) : null;
  if (before && Number.isNaN(before.getTime())) throw httpError(400, "Cursor no válido.");
  const text = typeof q.q === "string" ? q.q.trim().slice(0, 100) : "";
  const productId = q.product ? Number(q.product) : undefined;
  return { actions, actor, from: q.from, to: q.to, limit, before, beforeKey: q.beforeKey ?? null, text, productId };
}

/** `createdAt` según fechas y cursor (el cursor incluye su milisegundo: los empates se cortan después). */
function timeWhere(f) {
  const t = {};
  if (f.from) t.gte = dayStart(f.from);
  if (f.to) t.lt = new Date(dayStart(f.to).getTime() + 86_400_000);
  if (f.before) t.lte = f.before;
  return Object.keys(t).length ? { createdAt: t } : {};
}

/** «Contiene», sin distinguir mayúsculas. */
const ci = (t) => ({ contains: t, mode: "insensitive" });

/** Une condiciones con AND sin anidar vacíos. */
const and = (...ws) => {
  const llenas = ws.filter((w) => w && Object.keys(w).length);
  return llenas.length ? { AND: llenas } : {};
};

/** Condición de las acciones de una tabla: por columna de tipo, o por la regla de cada acción. */
function actionWhere(source, actions, column) {
  const suyas = actions.filter((a) => ACTIONS[a].source === source);
  if (!suyas.length) return null;
  const todas = Object.keys(ACTIONS).filter((a) => ACTIONS[a].source === source);
  if (suyas.length === todas.length) return {};
  if (column) return { [column]: { in: suyas } };
  return { OR: suyas.map((a) => ACTIONS[a].where) };
}

/**
 * Lee de las cuatro tablas lo que piden los filtros y lo devuelve en una sola
 * forma, de lo más nuevo a lo más viejo.
 * @param {object} f Filtros de `parseFilters()`.
 * @param {(key: string) => Promise<string>} signed Enlace firmado de una foto privada.
 * @param {(img: string) => string} catalog URL de una foto de catálogo.
 * @returns {Promise<{entries: object[], next: object|null}>}
 */
export async function readActivity(f, { signed, catalog }) {
  const take = f.limit + 1 + SLACK;
  const comun = timeWhere(f);
  const actor = (col) => (f.actor === undefined ? {} : { [col]: f.actor });
  const texto = (extra = []) => (f.text ? { OR: [{ note: ci(f.text) }, ...extra] } : {});
  const porModelo = (rel) => (f.productId ? rel(f.productId) : {});
  const consultas = [];

  const wActivity = actionWhere("activity", f.actions, "action");
  if (wActivity) {
    consultas.push(prisma.activityLog.findMany({
      where: and(wActivity, comun, actor("actorId"), texto([{ product: { name: ci(f.text) } }]), porModelo((id) => ({ productId: id }))),
      orderBy: { createdAt: "desc" },
      take,
      include: { actor: { select: { id: true, name: true } }, product: { select: { id: true, name: true } }, item: { select: { id: true, code: true } } },
    }).then((rows) => rows.map((r) => ({
      key: `a:${r.id}`, at: r.createdAt, action: r.action, actor: r.actor, note: r.note,
      product: r.product, item: r.item, orderId: null,
      photos: (r.detail?.keys ?? (r.action === "FOTOS_CATALOGO_ORDEN" ? r.detail?.after : null) ?? []).map(catalog),
    }))));
  }

  const wItems = actionWhere("items", f.actions);
  if (wItems) {
    consultas.push(prisma.itemLog.findMany({
      where: and(wItems, comun, actor("actorId"),
        texto([{ item: { code: ci(f.text) } }, { item: { product: { name: ci(f.text) } } }]),
        porModelo((id) => ({ item: { productId: id } }))),
      orderBy: { createdAt: "desc" },
      take,
      include: { actor: { select: { id: true, name: true } }, item: { select: { id: true, code: true, product: { select: { id: true, name: true } } } } },
    }).then((rows) => rows.map((r) => {
      const recepcion = r.note?.startsWith("Recibida");
      const action = r.from === null ? "EJEMPLAR_ALTA" : recepcion ? "RECEPCION" : "ESTADO";
      const cambio = r.from && !recepcion ? `${STATUS_LABEL[r.from]} → ${STATUS_LABEL[r.to]}` : r.from ? "" : `Alta: ${STATUS_LABEL[r.to]}`;
      const lavado = r.laundryPlace ? `en ${r.laundryKind === "EXTERNO" ? "lavandería externa" : "lavado propio"}: ${r.laundryPlace}` : "";
      return {
        key: `i:${r.id}`, at: r.createdAt, action, actor: r.actor,
        note: [cambio, r.note, lavado].filter(Boolean).join(" · "),
        product: r.item.product, item: { id: r.item.id, code: r.item.code }, orderId: r.orderId, photos: [],
      };
    })));
  }

  const wFinance = actionWhere("finance", f.actions, "kind");
  if (wFinance) {
    consultas.push(prisma.financeLog.findMany({
      where: and(wFinance, comun, actor("actorId"),
        texto([{ product: { name: ci(f.text) } }, { subjectUser: { name: ci(f.text) } }, { subjectUser: { email: ci(f.text) } }]),
        porModelo((id) => ({ productId: id }))),
      orderBy: { createdAt: "desc" },
      take,
      include: {
        actor: { select: { id: true, name: true } },
        product: { select: { id: true, name: true } },
        subjectUser: { select: { name: true, email: true } },
      },
    }).then((rows) => rows.map((r) => ({
      key: `f:${r.id}`, at: r.createdAt, action: r.kind, actor: r.actor,
      note: [r.subjectUser ? `${r.subjectUser.name ?? r.subjectUser.email}` : null, r.note,
        r.amountCents != null ? `$${(r.amountCents / 100).toFixed(2)}` : null].filter(Boolean).join(" · "),
      product: r.product, item: null, orderId: r.orderId, photos: [],
    }))));
  }

  // Las fotos de estado no tienen nota: el texto busca en el código y el modelo.
  const wPhotos = actionWhere("photos", f.actions);
  if (wPhotos) {
    const fotosTexto = f.text
      ? { OR: [{ item: { code: ci(f.text) } }, { item: { product: { name: ci(f.text) } } }] }
      : {};
    consultas.push(prisma.itemPhoto.findMany({
      where: and(comun, actor("takenById"), fotosTexto, porModelo((id) => ({ item: { productId: id } }))),
      orderBy: { createdAt: "desc" },
      take,
      include: { takenBy: { select: { id: true, name: true } }, item: { select: { id: true, code: true, product: { select: { id: true, name: true } } } } },
    }).then((rows) => rows.map((r) => ({
      key: `p:${r.id}`, at: r.createdAt, action: "FOTO_ESTADO", actor: r.takenBy,
      note: `Foto de ${PHOTO_KIND[r.kind]}${r.orderId ? ` (pedido #${r.orderId})` : ""}`,
      product: r.item.product, item: { id: r.item.id, code: r.item.code }, orderId: r.orderId,
      photoKey: r.key, photos: [],
    }))));
  }

  // Orden total: fecha descendente y, en un mismo milisegundo, la clave. El
  // cursor descarta lo ya enseñado en ese milisegundo.
  const orden = (a, b) => b.at - a.at || (a.key < b.key ? 1 : a.key > b.key ? -1 : 0);
  let todas = (await Promise.all(consultas)).flat().sort(orden);
  if (f.before && f.beforeKey) {
    const corte = { at: f.before, key: f.beforeKey };
    todas = todas.filter((e) => orden(corte, e) < 0);
  }
  const pagina = todas.slice(0, f.limit);
  for (const e of pagina) {
    if (e.photoKey) e.photos = [await signed(e.photoKey)];
    delete e.photoKey;
    e.label = ACTIONS[e.action].label;
    e.category = ACTIONS[e.action].category;
  }
  const ultima = pagina.at(-1);
  return { entries: pagina, next: todas.length > f.limit && ultima ? { before: ultima.at.toISOString(), beforeKey: ultima.key } : null };
}

/**
 * Registra la bitácora general.
 * @param {import("fastify").FastifyInstance} app Instancia Fastify.
 * @param {{requireCapability: Function}} guards preHandlers de autorización.
 * @param {{storage: object}} deps Almacenamiento, para las miniaturas.
 */
export function registerActivityRoutes(app, { requireCapability }, { storage }) {
  const admin = requireCapability(CAPABILITY.ADMINISTRACION);

  // Lo que el panel necesita para pintar los filtros: categorías, acciones y
  // el personal (más quien ya no tiene capacidades pero dejó entradas).
  app.get("/api/admin/activity/meta", { preHandler: admin }, async () => {
    const personal = await prisma.user.findMany({
      where: {
        OR: [
          { capabilities: { isEmpty: false } },
          { activity: { some: {} } },
          { itemLogs: { some: {} } },
          { financeActs: { some: {} } },
          { photosTaken: { some: {} } },
        ],
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    });
    return {
      categories: Object.entries(CATEGORIES).map(([key, label]) => ({ key, label })),
      actions: Object.entries(ACTIONS).map(([key, a]) => ({ key, label: a.label, category: a.category })),
      actors: personal.map((u) => ({ id: u.id, name: u.name || u.email })),
    };
  });

  app.get("/api/admin/activity", { preHandler: admin }, async (req) => {
    const f = parseFilters(req.query);
    const origin = requestOrigin(req);
    return readActivity(f, {
      signed: (key) => storage.signedUrl(key, origin),
      catalog: (img) => panelPhotoUrl(storage, img, origin),
    });
  });
}
