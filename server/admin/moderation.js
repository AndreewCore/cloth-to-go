/**
 * Pestaña Reseñas (Moderación): la cola de lo pendiente y, por estado, lo ya
 * decidido. Aprobar, rechazar con un motivo de la lista, ocultar y volver a
 * mostrar; el servidor guarda cada decisión en la bitácora.
 *
 * El texto y el nombre del cliente se pintan con `textContent` (vía `h()`):
 * es lo único del panel que escribe alguien de fuera.
 */
import { act, api, formDialog, h, since, toast, when } from "./core.js";

const STATUS = {
  PENDIENTE: { label: "Pendientes", chip: "Pendiente", tone: "warn" },
  APROBADA: { label: "Publicadas", chip: "Publicada", tone: "" },
  OCULTA: { label: "Ocultas", chip: "Oculta", tone: "muted" },
  RECHAZADA: { label: "Rechazadas", chip: "Rechazada", tone: "bad" },
};

/** Estado propio de la pestaña. */
const mod = { status: "PENDIENTE", data: null };

/** Carga la lista del estado elegido. */
export async function loadModeration() {
  mod.data = await api(`/api/admin/reviews?status=${mod.status}`);
}

/** Etiqueta de un motivo, con la lista que manda el servidor. */
const reasonLabel = (key) => mod.data?.reasons.find((r) => r.key === key)?.label ?? key;

/** Estrellas como texto, para leerlas de un vistazo. */
const stars = (n) => "★".repeat(n) + "☆".repeat(5 - n);

/** Botones que corresponden al estado de la reseña. */
function actions(r) {
  const b = (action, label, cls = "") => h(`button.btn.small${cls}`, { type: "button", dataset: { action: "review-mod", move: action, review: r.id } }, label);
  return {
    PENDIENTE: [b("approve", "Aprobar", ".primary"), b("reject", "Rechazar", ".danger")],
    APROBADA: [b("hide", "Ocultar")],
    OCULTA: [b("show", "Mostrar de nuevo", ".primary"), b("reject", "Rechazar", ".danger")],
    RECHAZADA: [b("approve", "Aprobar")],
  }[r.status];
}

/** Tarjeta de una reseña. */
function reviewCard(r) {
  const s = STATUS[r.status];
  const reportes = r.openReports
    ? h("p.when.warn", {}, `${r.openReports} reporte${r.openReports === 1 ? "" : "s"}: `,
      [...new Set(r.reportReasons)].map(reasonLabel).join(" · "))
    : null;
  const decision = r.moderatedBy
    ? h("p.meta", { title: when(r.moderatedAt) },
      `${s.chip} por ${r.moderatedBy}${r.rejectReason ? ` · ${reasonLabel(r.rejectReason)}` : ""}`)
    : null;
  return h("article.card.review-card", {},
    h("header", {},
      h("h3", {}, r.product.name),
      h(`span.chip${s.tone ? `.${s.tone}` : ""}`, {}, s.chip)),
    h("p.meta", {}, `${r.author} · pedido #${r.orderId} · `, since(r.createdAt)),
    h("p.review-stars", { "aria-label": `${r.rating} de 5 estrellas` }, stars(r.rating)),
    r.text ? h("p.review-text", {}, r.text) : h("p.meta", {}, "Sin texto."),
    r.photo ? h("button.thumb-btn", { type: "button", "aria-label": "Ver la foto de la reseña", dataset: { action: "review-photo", src: r.photo } },
      h("img", { src: r.photo, alt: "", loading: "lazy" })) : null,
    reportes,
    decision,
    h("div.actions", {}, actions(r)),
  );
}

/** Pinta la pestaña. */
export function renderModeration() {
  if (!mod.data) return [h("p.empty", {}, "Cargando…")];
  const { counts, reviews } = mod.data;
  return [
    h("h2", {}, "Reseñas ", h("small", {}, "nada se publica hasta que alguien de Moderación lo aprueba")),
    h("div.bar", { role: "tablist" },
      Object.entries(STATUS).map(([key, s]) => h(`button.btn.small${mod.status === key ? ".primary" : ""}`,
        { type: "button", "aria-pressed": String(mod.status === key), dataset: { action: "review-status", status: key } },
        `${s.label} (${counts[key] ?? 0})`)),
      h("button.btn.small", { type: "button", dataset: { action: "reload" } }, "Actualizar")),
    reviews.length
      ? h("div.cards", {}, reviews.map(reviewCard))
      : h("p.empty", {}, mod.status === "PENDIENTE" ? "No hay reseñas esperando. ¡Cola vacía!" : "No hay reseñas en este estado."),
  ];
}

/** Número de pendientes, para la pestaña. */
export const pendingReviews = () => mod.data?.counts.PENDIENTE ?? 0;

/**
 * Pide el motivo y rechaza. Es lo único que el autor verá de la decisión, así
 * que el motivo sale de la lista cerrada y no de texto libre.
 * @param {number} id Reseña.
 */
async function reject(id) {
  const datos = await formDialog("Rechazar reseña", [
    h("p", {}, "El autor verá este motivo junto a su reseña."),
    h("label", {}, "Motivo",
      h("select", { name: "reason", required: true },
        h("option", { value: "" }, "Elige uno…"),
        mod.data.reasons.map((r) => h("option", { value: r.key }, r.label)))),
  ], "Rechazar");
  if (!datos) return;
  await act(() => api(`/api/reviews/${id}/moderate`, { method: "POST", body: { action: "reject", reason: datos.get("reason") } }), "Reseña rechazada.");
}

const OK = { approve: "Reseña publicada.", hide: "Reseña oculta.", show: "Reseña publicada de nuevo." };

/**
 * Atiende un clic delegado de la pestaña.
 * @param {HTMLElement} el Elemento con `data-action`.
 * @param {() => void} render Repinta la pestaña.
 * @returns {boolean} true si la acción era de esta pestaña.
 */
export function moderationClick(el, render) {
  switch (el.dataset.action) {
    case "review-status":
      mod.status = el.dataset.status;
      mod.data = null;
      render();
      loadModeration().then(render, (err) => toast(err.message, true));
      return true;
    case "review-mod": {
      const id = Number(el.dataset.review);
      const move = el.dataset.move;
      if (move === "reject") reject(id);
      else act(() => api(`/api/reviews/${id}/moderate`, { method: "POST", body: { action: move } }), OK[move]);
      return true;
    }
    case "review-photo":
      formDialog("Foto de la reseña", [h("div.gallery", {}, h("img.photo", { src: el.dataset.src, alt: "Foto de la reseña" }))], "Cerrar", { cancel: false, wide: true });
      return true;
    default:
      return false;
  }
}
