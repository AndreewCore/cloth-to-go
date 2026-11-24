/**
 * Fotos en el panel: elegirlas (con vista previa), prepararlas para subir y
 * verlas.
 *
 * Hay dos clases y la galería enseña las dos, porque juntas responden «¿es
 * esta la prenda, y está como salió?»:
 * - las del **modelo** (catálogo), iguales para todos sus ejemplares;
 * - las de **estado** del ejemplar concreto: cómo salió y cómo llegó en cada
 *   pedido. Llegan con enlaces firmados que caducan; por eso se piden al abrir.
 */
import { api, formDialog, h, state, toast, upload, when } from "./core.js";

/** Lado mayor con el que se sube una foto: el servidor la deja en 1600. */
const MAX_SIDE = 2400;
/** Por debajo de esto y sin pasarse de lado, la foto se sube tal cual. */
const KEEP_BELOW = 1.5 * 1024 * 1024;
const KIND_LABEL = { SALIDA: "Salida", LLEGADA: "Llegada", ESTADO: "Estado" };

/** Solo se pintan URLs ya resueltas por el servidor (del mismo origen o https). */
const photoSrc = (url) => (typeof url === "string" && /^(\/|https?:\/\/)/.test(url) ? url : null);

/** Miniatura de la portada; un hueco del mismo tamaño si no hay foto. */
export function thumb(imgs) {
  const src = photoSrc(imgs?.[0]);
  if (!src) return h("span.thumb.none", { "aria-hidden": "true" });
  const img = h("img.thumb", { src, alt: "", loading: "lazy" });
  img.addEventListener("error", () => img.replaceWith(h("span.thumb.none", { "aria-hidden": "true" })));
  return img;
}

/**
 * Botón «Ver foto» de un ejemplar. Sale siempre: aunque el modelo no tenga
 * fotos de catálogo, el ejemplar puede tener las de salida y llegada.
 */
export const photoButton = (itemId) =>
  h("button.btn.small", { type: "button", dataset: { action: "photos", item: itemId } }, "Ver foto");

/** Busca, en lo ya cargado, el nombre, código y fotos del modelo de un ejemplar. */
function fichaDe(itemId) {
  const s = state.stragglers ?? {};
  const fichas = [
    ...state.items.map((i) => ({ ...i, itemId: i.id })),
    ...state.orders.flatMap((o) => o.lines),
    ...(s.notReceived ?? []), ...(s.receivedNotWashed ?? []), ...(s.inLaundry ?? []),
    ...state.products.flatMap((p) => p.items.map((i) => ({
      itemId: i.id, code: i.code, productName: p.name, imgs: p.photos.map((f) => f.url),
    }))),
  ];
  return fichas.find((f) => f.itemId === itemId) ?? { itemId, productName: "Ejemplar", code: null, imgs: [] };
}

/**
 * Prepara una foto para subirla: la reduce si es enorme (las de móvil pasan
 * fácil de 5 MB) y aplica la orientación EXIF. Lo que de verdad la limpia es
 * el servidor; esto solo ahorra datos y evita un 413.
 * @param {File} file Foto elegida.
 * @returns {Promise<Blob>}
 */
export async function preparePhoto(file) {
  if (!["image/jpeg", "image/png"].includes(file.type)) throw new Error(`«${file.name}» no es JPG ni PNG.`);
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file; // El navegador no la entiende: que el servidor dé el motivo.
  }
  const escala = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  if (escala === 1 && file.size <= KEEP_BELOW) {
    bmp.close();
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * escala);
  canvas.height = Math.round(bmp.height * escala);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo preparar la foto."))), "image/jpeg", 0.88);
  });
}

/**
 * Selector de fotos con vista previa y botón para quitar cada una. En el
 * móvil, el selector del sistema ofrece la cámara.
 * @param {object} [opts]
 * @param {string} [opts.label] Texto del botón.
 * @param {number} [opts.max] Máximo de fotos.
 * @returns {{el: HTMLElement, count: () => number, files: () => Promise<Blob[]>, dispose: () => void}}
 */
export function photoPicker({ label = "Agregar fotos", max = 6 } = {}) {
  const input = h("input.visually-hidden", { type: "file", accept: "image/jpeg,image/png", multiple: true });
  const lista = h("div.picks");
  let elegidas = [];

  const pintar = () => {
    lista.replaceChildren(...elegidas.map((e, i) => h("figure.pick", {},
      h("img", { src: e.url, alt: `Foto ${i + 1}` }),
      h("button.pick-x", { type: "button", "aria-label": `Quitar foto ${i + 1}`, dataset: { i } }, "×"),
    )));
  };
  input.addEventListener("change", () => {
    const sobran = [...input.files].length - (max - elegidas.length);
    for (const file of [...input.files].slice(0, max - elegidas.length)) {
      elegidas.push({ file, url: URL.createObjectURL(file) });
    }
    if (sobran > 0) toast(`Como máximo ${max} fotos.`, true);
    input.value = "";
    pintar();
  });
  lista.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    const [quitada] = elegidas.splice(Number(b.dataset.i), 1);
    URL.revokeObjectURL(quitada.url);
    pintar();
  });

  return {
    el: h("div.picker", {}, h("label.btn.pick-btn", {}, label, input), lista),
    count: () => elegidas.length,
    files: () => Promise.all(elegidas.map((e) => preparePhoto(e.file))),
    dispose: () => {
      elegidas.forEach((e) => URL.revokeObjectURL(e.url));
      elegidas = [];
    },
  };
}

/**
 * Galería de un ejemplar: foto grande arriba y, debajo, las del modelo y las
 * de salida y llegada de cada pedido, de la más reciente a la más vieja. Desde
 * aquí también se añaden fotos de estado sueltas.
 * @param {number} itemId Ejemplar.
 */
export async function showPhotos(itemId) {
  const f = fichaDe(itemId);
  let estado = [];
  try {
    estado = await api(`/api/items/${itemId}/photos`);
  } catch (err) {
    toast(err.message, true);
  }

  const grande = h("img.photo", { alt: "" });
  const pie = h("p.meta.photo-caption", {});
  const fallo = h("p.empty", { hidden: true }, "No se pudo cargar la foto.");
  grande.addEventListener("error", () => { grande.hidden = true; fallo.hidden = false; });
  const botones = [];
  const mostrar = (foto) => {
    grande.hidden = false;
    fallo.hidden = true;
    grande.src = foto.src;
    grande.alt = foto.caption;
    pie.textContent = foto.caption;
    botones.forEach((b) => b.setAttribute("aria-current", String(b.foto === foto)));
  };
  const tira = (fotos) => h("div.thumbs", {}, fotos.map((foto) => {
    const b = h("button.thumb-btn", { type: "button", "aria-label": foto.caption }, h("img", { src: foto.src, alt: "", loading: "lazy" }));
    b.foto = foto;
    b.addEventListener("click", () => mostrar(foto));
    botones.push(b);
    return b;
  }));

  const delModelo = (f.imgs ?? []).map(photoSrc).filter(Boolean)
    .map((src, i, all) => ({ src, caption: `Catálogo (modelo) · foto ${i + 1} de ${all.length}` }));
  const deEstado = estado.map((e) => ({
    src: e.url,
    caption: `${KIND_LABEL[e.kind]}${e.orderId ? ` · pedido #${e.orderId}` : ""} · ${when(e.createdAt)} · ${e.takenBy ?? "—"}`,
    kind: e.kind,
  }));

  const nueva = photoPicker({ label: "Agregar fotos de estado" });
  const subirEstado = h("button.btn.small", { type: "button" }, "Subir");
  subirEstado.addEventListener("click", async () => {
    if (!nueva.count()) return toast("Elige primero alguna foto.", true);
    subirEstado.disabled = true;
    try {
      await upload(`/api/items/${itemId}/photos`, await nueva.files(), { kind: "ESTADO" });
      nueva.dispose();
      toast("Fotos guardadas.");
      document.querySelector("dialog[open]")?.close();
      showPhotos(itemId);
    } catch (err) {
      toast(err.message, true);
      subirEstado.disabled = false;
    }
  });

  const primera = deEstado[0] ?? delModelo[0];
  if (primera) mostrar(primera);
  else { grande.hidden = true; fallo.hidden = false; fallo.textContent = "Esta prenda todavía no tiene fotos."; }

  await formDialog(`${f.productName} (${f.code ?? `#${itemId}`})`, [
    h("div.gallery", {}, grande, fallo),
    pie,
    h("h4", {}, "Salida y llegada de este ejemplar"),
    deEstado.length ? tira(deEstado) : h("p.meta", {}, "Aún no hay fotos de cómo salió o volvió."),
    h("h4", {}, "Catálogo (el modelo)"),
    delModelo.length ? tira(delModelo) : h("p.meta", {}, "El modelo no tiene fotos de catálogo."),
    h("div.picker-row", {}, nueva.el, subirEstado),
  ], "Cerrar", { cancel: false, wide: true });
  nueva.dispose();
}
