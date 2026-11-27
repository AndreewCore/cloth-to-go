/**
 * Pestaña Bitácora (solo Administración): todo lo que hizo el personal, con
 * quién y cuándo, filtrable por categoría, acción, persona, fechas y texto.
 *
 * Los filtros se aplican en el servidor (la bitácora crece sin tope) y la
 * lista se pagina con «Cargar más».
 */
import { api, fmtDay, formDialog, h, localISO, relDays, toast, when } from "./core.js";

/** Filtros sin tocar. */
export const ACTIVITY_FILTERS_DEFAULT = Object.freeze({ category: "", action: "", actor: "", from: "", to: "", q: "" });

/** Color del chip de cada categoría (clases de admin.css). */
const TONE = { catalogo: "", fotos: "info", prendas: "muted", dinero: "warn", precio: "warn", personal: "bad", taxonomia: "", resenas: "info", pedidos: "info" };
/** Acciones que merecen otro color que el de su categoría: lo que se cobra de más o se deshace. */
const ACTION_TONE = { DIAS_EXTRA: "bad", ANULACION: "bad", PENALIZACION: "bad", GARANTIA_LIBERADA: "" };

/** Estado propio de la pestaña. */
const bit = { meta: null, entries: [], next: null, filters: { ...ACTIVITY_FILTERS_DEFAULT }, loading: false };

/** Consulta con los filtros puestos (sin los vacíos). */
function query(extra = {}) {
  const q = Object.fromEntries(Object.entries({ ...bit.filters, ...extra }).filter(([, v]) => v !== "" && v != null));
  return new URLSearchParams({ limit: "50", ...q });
}

/** Carga la primera página (y, la primera vez, los datos de los filtros). */
export async function loadActivity() {
  if (!bit.meta) bit.meta = await api("/api/admin/activity/meta");
  const { entries, next } = await api(`/api/admin/activity?${query()}`);
  bit.entries = entries;
  bit.next = next;
}

/** Añade la página siguiente. */
async function loadMore() {
  if (!bit.next || bit.loading) return;
  bit.loading = true;
  try {
    const { entries, next } = await api(`/api/admin/activity?${query(bit.next)}`);
    bit.entries.push(...entries);
    bit.next = next;
  } catch (err) {
    toast(err.message, true);
  } finally {
    bit.loading = false;
  }
}

/** Indica si hay algún filtro puesto. */
const anyFilter = () => Object.entries(ACTIVITY_FILTERS_DEFAULT).some(([k, v]) => bit.filters[k] !== v);

/**
 * Barra de filtros. La acción se elige en dos pasos: primero la categoría y
 * luego, entre las suyas (de una a cinco), la acción. Todas juntas eran más de
 * treinta en un solo desplegable.
 */
function filterBar() {
  const f = bit.filters;
  const m = bit.meta;
  const select = (key, label, items, todos, disabled = false) => h("label", {}, label,
    h("select", { dataset: { action: "activity-filter", key }, disabled: disabled || null },
      h("option", { value: "", selected: !f[key] || null }, todos),
      items.map(([v, t]) => h("option", { value: v, selected: String(f[key]) === String(v) || null }, t))));
  const fecha = (key, label) => h("label", {}, label,
    h("input", { type: "date", value: f[key], max: localISO(new Date()), dataset: { action: "activity-filter", key } }));
  const acciones = m.actions.filter((a) => a.category === f.category);
  return h("div.filters", {},
    select("category", "Categoría", m.categories.map((c) => [c.key, c.label]), "Todas"),
    select("action", "Acción", f.category ? acciones.map((a) => [a.key, a.label]) : [],
      f.category ? "Todas" : "Elige una categoría primero", !f.category),
    select("actor", "Persona", [...m.actors.map((a) => [a.id, a.name]), ["system", "Sistema (automático)"]], "Todas"),
    fecha("from", "Desde"),
    fecha("to", "Hasta"),
    h("label.grow-2", {}, "Texto", h("input", { type: "search", value: f.q, placeholder: "Nota, código, nombre…", dataset: { action: "activity-q" } })),
    anyFilter() ? h("button.btn.small", { type: "button", dataset: { action: "activity-clear" } }, "Limpiar filtros") : null,
  );
}

/**
 * Una entrada: cuándo, quién, qué, sobre qué, la nota y sus fotos. La usa
 * también el recorrido de un pedido (admin.js).
 * @param {object} e Entrada de `readActivity()`.
 * @param {{orderLink?: boolean, fullDate?: boolean}} [opts] Enlace al
 *   recorrido del pedido (no dentro del propio recorrido) y fecha completa
 *   (el recorrido no se agrupa por días).
 */
export function entryRow(e, { orderLink = true, fullDate = false } = {}) {
  const objetivo = [
    e.product ? e.product.name : null,
    e.item ? (e.item.code ?? `ejemplar #${e.item.id}`) : null,
    e.orderId && !orderLink ? `pedido #${e.orderId}` : null,
  ].filter(Boolean).join(" · ");
  const dia = localISO(new Date(e.at));
  return h("li.activity", {},
    h("div.activity-when", { title: when(e.at) },
      h("strong", {}, new Date(e.at).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" })),
      h("span.meta", {}, fullDate ? fmtDay(dia) : relDays(dia))),
    h("div.activity-body", {},
      h("div", {},
        chipFor(e), " ",
        h("strong", {}, e.actor?.name ?? "Sistema"),
        objetivo ? h("span.meta", {}, ` · ${objetivo}`) : null,
        // Desde la bitácora se salta al recorrido entero de ese pedido.
        e.orderId && orderLink
          ? [h("span.meta", {}, " · "), h("button.link", { type: "button", dataset: { action: "timeline", order: e.orderId } }, `pedido #${e.orderId}`)]
          : null),
      e.note ? h("div.activity-note", {}, e.note) : null,
      e.photos.length ? h("div.activity-photos", {}, e.photos.map((src, i) =>
        h("button.thumb-btn", { type: "button", "aria-label": `Ver foto ${i + 1}`, dataset: { action: "activity-photo", src } },
          h("img", { src, alt: "", loading: "lazy" })))) : null),
  );
}

/** Chip de una entrada, con el color de su acción o, si no tiene, el de su categoría. */
function chipFor(e) {
  const tone = e.action in ACTION_TONE ? ACTION_TONE[e.action] : TONE[e.category];
  return h(`span.chip${tone ? `.${tone}` : ""}`, {}, e.label);
}

/** Agrupa las entradas por día para leer la lista como un diario. */
function byDay(entries) {
  const grupos = [];
  for (const e of entries) {
    const dia = localISO(new Date(e.at));
    if (grupos.at(-1)?.dia !== dia) grupos.push({ dia, items: [] });
    grupos.at(-1).items.push(e);
  }
  return grupos;
}

/** Pinta la pestaña. */
export function renderActivity() {
  if (!bit.meta) return [h("p.empty", {}, "Cargando…")];
  return [
    h("h2", {}, "Bitácora ", h("small", {}, "todo lo que hizo el personal, con quién y cuándo; nada se edita ni se borra")),
    filterBar(),
    // Esparcido: la vista se pinta con `replaceChildren(...)`, que no aplana
    // arreglos anidados.
    ...(bit.entries.length
      ? byDay(bit.entries).map((g) => h("section.activity-day", {},
        h("h3", {}, new Date(`${g.dia}T12:00:00`).toLocaleDateString("es-EC", { weekday: "long", day: "numeric", month: "long", year: "numeric" })),
        h("ul.activity-list", {}, g.items.map((e) => entryRow(e)))))
      : [h("p.empty", {}, anyFilter() ? "Nada coincide con estos filtros." : "Todavía no hay nada registrado.")]),
    bit.next ? h("div.bar", {}, h("button.btn", { type: "button", dataset: { action: "activity-more" } }, "Cargar más")) : null,
  ];
}

/**
 * Cambia un filtro y recarga desde la primera página. Cambiar de categoría
 * suelta la acción si ya no pertenece a ella.
 * @param {string} key Filtro.
 * @param {string} value Valor nuevo.
 * @param {() => void} render Repinta la pestaña.
 */
export async function setActivityFilter(key, value, render) {
  bit.filters = { ...bit.filters, [key]: value };
  if (key === "category" && bit.filters.action) {
    const a = bit.meta.actions.find((x) => x.key === bit.filters.action);
    if (!value || a?.category !== value) bit.filters.action = "";
  }
  try {
    await loadActivity();
  } catch (err) {
    toast(err.message, true);
  }
  render();
}

/**
 * Atiende un clic delegado de la pestaña.
 * @param {HTMLElement} el Elemento con `data-action`.
 * @param {() => void} render Repinta la pestaña.
 * @returns {boolean} true si la acción era de esta pestaña.
 */
export function activityClick(el, render) {
  switch (el.dataset.action) {
    case "activity-more":
      loadMore().then(render);
      return true;
    case "activity-clear":
      bit.filters = { ...ACTIVITY_FILTERS_DEFAULT };
      loadActivity().then(render, (err) => toast(err.message, true));
      return true;
    case "activity-photo":
      formDialog("Foto", [h("div.gallery", {}, h("img.photo", { src: el.dataset.src, alt: "Foto de la bitácora" }))], "Cerrar", { cancel: false, wide: true });
      return true;
    default:
      return false;
  }
}
