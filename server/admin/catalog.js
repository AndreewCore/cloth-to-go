/**
 * Pestaña Catálogo (capacidad Inventario): alta y edición de modelos, sus
 * fotos de catálogo y sus ejemplares.
 *
 * Un modelo sin ejemplares no sale en la app: el panel lo avisa, porque es el
 * paso que más fácil se olvida al dar de alta una prenda.
 */
import { api, can, formDialog, h, hooks, state, statusChip, toast, upload } from "./core.js";
import { photoButton, photoPicker, thumb } from "./photos.js";

const CONDITION_LABEL = { NUEVA: "Nueva", COMO_NUEVA: "Como nueva", BUENA: "Buena", USO_VISIBLE: "Uso visible" };
const MAX_PHOTOS = 6;

/** Carga los modelos y, la primera vez, la taxonomía. */
export async function loadCatalog() {
  const [productos, taxonomia] = await Promise.all([
    api("/api/admin/products"),
    state.taxonomy ? state.taxonomy : api("/api/taxonomy"),
  ]);
  state.products = productos;
  state.taxonomy = taxonomia;
}

/** Nombre de una clave de la taxonomía. */
const nombre = (lista, key) => state.taxonomy?.[lista]?.find((x) => x.key === key)?.name ?? key ?? "—";

/** Pinta la lista de modelos o el modelo abierto. */
export function renderCatalog(searchBar, matches) {
  const abierto = state.products.find((p) => p.id === state.openProduct);
  return abierto ? renderModel(abierto) : renderList(searchBar, matches);
}

/** Lista de modelos, de los más nuevos a los más viejos. */
function renderList(searchBar, matches) {
  const lista = state.products.filter((p) => matches(p.name, p.category, p.brand, ...p.items.map((i) => i.code)));
  return [
    h("h2", {}, "Catálogo ", h("small", {}, `${state.products.length} modelos`)),
    h("div.bar", {},
      h("button.btn.primary", { type: "button", dataset: { action: "model-new" } }, "Nuevo modelo")),
    searchBar("Buscar por nombre, categoría, marca o código"),
    lista.length ? h("div.models", {}, lista.map((p) => h("article.model", {},
      h("button.model-open", { type: "button", dataset: { action: "model-open", product: p.id }, "aria-label": `Abrir ${p.name}` },
        thumb(p.photos.map((f) => f.url))),
      h("div", {},
        h("h3", {}, p.name),
        h("div.meta", {}, `${p.category} · ${p.items.length} ejemplar${p.items.length === 1 ? "" : "es"} · ${p.photos.length} foto${p.photos.length === 1 ? "" : "s"}`),
        !p.items.length ? h("span.chip.warn", {}, "Sin ejemplares: no sale en la app") : null,
        !p.photos.length ? h("span.chip.muted", {}, "Sin fotos") : null,
      ),
      h("button.btn.small", { type: "button", dataset: { action: "model-open", product: p.id } }, "Abrir"),
    ))) : h("p.empty", {}, "No hay modelos que coincidan."),
  ];
}

/** Ficha de un modelo: datos, fotos de catálogo y ejemplares. */
function renderModel(p) {
  const dato = (label, valor) => [h("dt", {}, label), h("dd", {}, valor ?? "—")];
  return [
    h("div.bar", {},
      h("button.btn", { type: "button", dataset: { action: "model-close" } }, "← Catálogo"),
      h("h2.grow", {}, p.name),
      h("button.btn", { type: "button", dataset: { action: "model-edit", product: p.id } }, "Editar datos")),

    h("section.panel-box", {},
      h("dl.facts", {},
        dato("Categoría", p.category),
        dato("Material", nombre("materials", p.material)),
        dato("Valor de reposición", `$${p.value}`),
        dato("Estrellas", "★".repeat(p.stars)),
        dato("Peso", `${p.weightKg} kg`),
        dato("Marca", p.brand),
        dato("Público", p.audienceKey ? nombre("audiences", p.audienceKey) : null),
        dato("Temporada", p.seasonKey ? nombre("seasons", p.seasonKey) : null),
        dato("Ocasiones", p.occasions.map((o) => nombre("occasions", o)).join(", ") || null),
      ),
      p.desc ? h("p", {}, p.desc) : null),

    h("h3", {}, "Fotos del catálogo ", h("small.meta", {}, `${p.photos.length} de ${MAX_PHOTOS} · la primera es la portada`)),
    p.photos.length ? h("div.photo-grid", {}, p.photos.map((f, i) => h("figure.photo-card", {},
      h("img", { src: f.url, alt: `Foto ${i + 1} de ${p.name}`, loading: "lazy" }),
      h("figcaption", {},
        i === 0 ? h("span.chip", {}, "Portada") : null,
        h("span.photo-tools", {},
          h("button.btn.small", { type: "button", disabled: i === 0 || null, "aria-label": "Mover a la izquierda", dataset: { action: "photo-move", product: p.id, i, to: i - 1 } }, "←"),
          h("button.btn.small", { type: "button", disabled: i === p.photos.length - 1 || null, "aria-label": "Mover a la derecha", dataset: { action: "photo-move", product: p.id, i, to: i + 1 } }, "→"),
          h("button.btn.small.danger", { type: "button", "aria-label": "Quitar foto", dataset: { action: "photo-remove", product: p.id, i } }, "Quitar"))),
    ))) : h("p.meta", {}, "Este modelo aún no tiene fotos."),
    p.photos.length < MAX_PHOTOS
      ? h("button.btn", { type: "button", dataset: { action: "photo-add", product: p.id } }, "Subir fotos al catálogo") : null,

    h("h3", {}, "Ejemplares ", h("small.meta", {}, "cada prenda física, con su código")),
    !p.items.length ? h("p.empty", {}, "Sin ejemplares el modelo no sale en la app. Da de alta el primero.") : h("div.table-wrap", {}, h("table", {},
      h("thead", {}, h("tr", {}, ["Código", "Talla · color", "Condición", "Estado", ""].map((t) => h("th", {}, t)))),
      h("tbody", {}, p.items.map((i) => h("tr", {},
        h("td", {}, i.code ?? h("span.meta", {}, `demo #${i.id}`)),
        h("td", {}, `${i.size} · ${nombre("colors", i.color)}`),
        h("td", {}, CONDITION_LABEL[i.condition] ?? "—"),
        h("td", {}, statusChip(i.status)),
        h("td.row-actions", {},
          photoButton(i.id), " ",
          h("button.btn.small", { type: "button", dataset: { action: "item-edit", product: p.id, item: i.id } }, "Condición")),
      ))),
    )),
    h("button.btn.primary", { type: "button", dataset: { action: "item-new", product: p.id } }, "Agregar ejemplar"),
  ];
}

/** Opciones de un `<select>` desde una lista de la taxonomía. */
function opciones(lista, actual, { vacio = null } = {}) {
  return [
    vacio !== null ? h("option", { value: "", selected: !actual || null }, vacio) : null,
    ...(state.taxonomy?.[lista] ?? []).map((x) => h("option", { value: x.key, selected: x.key === actual || null }, x.name)),
  ];
}

/**
 * Diálogo de alta o edición de un modelo. En una edición solo se envía lo que
 * cambió: así quien no es de Administración puede corregir el nombre sin que
 * viajen valor y estrellas (que el servidor le negaría).
 * @param {object|null} p Modelo a editar, o null para uno nuevo.
 */
async function modelDialog(p) {
  const admin = can("ADMINISTRACION");
  const bloqueado = p && !admin;
  const datos = await formDialog(p ? `Editar ${p.name}` : "Nuevo modelo", [
    h("label", {}, "Nombre", h("input", { name: "name", required: true, minlength: 2, maxlength: 80, value: p?.name ?? "" })),
    h("label", {}, "Descripción", h("textarea", { name: "desc", maxlength: 1000, rows: 3 }, p?.desc ?? "")),
    h("div.grid2", {},
      h("label", {}, "Categoría", h("select", { name: "categoryKey", required: true }, opciones("categories", p?.categoryKey, { vacio: "Elige…" }))),
      h("label", {}, "Material", h("select", { name: "material", required: true }, opciones("materials", p?.material, { vacio: "Elige…" })))),
    h("div.grid2", {},
      h("label", {}, "Valor de reposición (USD)",
        h("input", { name: "value", type: "number", required: true, min: 1, max: 5000, step: "0.01", value: p?.value ?? "", disabled: bloqueado || null })),
      h("label", {}, "Estrellas", h("select", { name: "stars", required: true, disabled: bloqueado || null },
        [1, 2, 3, 4, 5].map((n) => h("option", { value: n, selected: (p?.stars ?? 3) === n || null }, "★".repeat(n)))))),
    bloqueado ? h("p.meta", {}, "Valor y estrellas mueven el precio y la garantía: solo los cambia la administración.") : null,
    h("div.grid2", {},
      h("label", {}, "Peso (kg)", h("input", { name: "weightKg", type: "number", required: true, min: 0.05, max: 20, step: "0.05", value: p?.weightKg ?? "" })),
      h("label", {}, "Marca (opcional)", h("input", { name: "brand", maxlength: 60, value: p?.brand ?? "" }))),
    h("div.grid2", {},
      h("label", {}, "Público", h("select", { name: "audienceKey" }, opciones("audiences", p?.audienceKey, { vacio: "—" }))),
      h("label", {}, "Temporada", h("select", { name: "seasonKey" }, opciones("seasons", p?.seasonKey, { vacio: "—" })))),
    h("fieldset", {}, h("legend", {}, "Ocasiones"),
      h("div.checks", {}, (state.taxonomy?.occasions ?? []).map((o) => h("label.check", {},
        h("input", { type: "checkbox", name: "occasions", value: o.key, checked: p?.occasions.includes(o.key) || null }), ` ${o.name}`)))),
  ], p ? "Guardar" : "Crear modelo", { wide: true });
  if (!datos) return;

  const cuerpo = {
    name: datos.get("name"),
    desc: datos.get("desc"),
    categoryKey: datos.get("categoryKey"),
    material: datos.get("material"),
    weightKg: Number(datos.get("weightKg")),
    brand: datos.get("brand") || null,
    audienceKey: datos.get("audienceKey") || null,
    seasonKey: datos.get("seasonKey") || null,
    occasions: datos.getAll("occasions"),
  };
  if (!bloqueado) {
    cuerpo.value = Number(datos.get("value"));
    cuerpo.stars = Number(datos.get("stars"));
  }
  try {
    if (p) {
      const cambios = Object.fromEntries(Object.entries(cuerpo).filter(([k, v]) =>
        JSON.stringify(v) !== JSON.stringify(k === "brand" ? p.brand ?? null : p[k])));
      if (!Object.keys(cambios).length) return toast("No cambió nada.");
      await api(`/api/products/${p.id}`, { method: "PATCH", body: cambios });
      toast("Modelo guardado.");
    } else {
      const nuevo = await api("/api/products", { method: "POST", body: cuerpo });
      state.openProduct = nuevo.id;
      toast("Modelo creado. Ahora sube sus fotos y su primer ejemplar.");
    }
    await hooks.reload();
  } catch (err) {
    toast(err.message, true);
  }
}

/** Sube fotos de catálogo a un modelo. */
async function addPhotos(p) {
  const picker = photoPicker({ label: "Elegir fotos", max: MAX_PHOTOS - p.photos.length });
  const datos = await formDialog(`Fotos de ${p.name}`, [
    h("p.meta", {}, "JPG o PNG. Se guardan recodificadas y sin datos de ubicación. Fondo neutro y buena luz: es lo que ve el cliente."),
    picker.el,
  ], "Subir", { wide: true, validate: () => (picker.count() ? null : "Elige al menos una foto.") });
  try {
    if (datos) {
      await upload(`/api/products/${p.id}/photos`, await picker.files());
      toast("Fotos subidas.");
      await hooks.reload();
    }
  } catch (err) {
    toast(err.message, true);
  } finally {
    picker.dispose();
  }
}

/** Reordena o quita fotos de catálogo enviando la lista nueva entera. */
async function savePhotoOrder(p, imgs, ok) {
  try {
    await api(`/api/products/${p.id}/photos`, { method: "PUT", body: { imgs } });
    toast(ok);
    await hooks.reload();
  } catch (err) {
    toast(err.message, true);
  }
}

/**
 * Alta de un ejemplar: talla, color y condición, más fotos de cómo está al
 * entrar (opcionales, pero son la primera prueba de su estado).
 */
async function newItem(p) {
  const tax = state.taxonomy;
  const escalas = [...new Set(tax.sizes.map((s) => s.scale))];
  const talla = h("select", { name: "size", required: true },
    escalas.map((esc) => h("optgroup", { label: esc === "CALZADO" ? "Calzado" : "Ropa" },
      tax.sizes.filter((s) => s.scale === esc).map((s) => h("option", { value: `${s.scale}|${s.label}` }, s.label)))));
  const picker = photoPicker({ label: "Fotos de cómo está (opcional)" });
  const datos = await formDialog(`Nuevo ejemplar de ${p.name}`, [
    h("div.grid2", {},
      h("label", {}, "Talla", talla),
      h("label", {}, "Color", h("select", { name: "color", required: true }, opciones("colors", null, { vacio: "Elige…" })))),
    h("label", {}, "Condición", h("select", { name: "condition" },
      h("option", { value: "" }, "—"),
      tax.conditions.map((c) => h("option", { value: c }, CONDITION_LABEL[c] ?? c)))),
    h("label", {}, "Observación (opcional)", h("textarea", { name: "note", maxlength: 500, rows: 2 })),
    picker.el,
  ], "Dar de alta", { wide: true });
  try {
    if (!datos) return;
    const [sizeScale, size] = datos.get("size").split("|");
    const item = await api(`/api/products/${p.id}/items`, {
      method: "POST",
      body: {
        size, sizeScale, color: datos.get("color"),
        ...(datos.get("condition") ? { condition: datos.get("condition") } : {}),
        ...(datos.get("note") ? { note: datos.get("note") } : {}),
      },
    });
    if (picker.count()) await upload(`/api/items/${item.id}/photos`, await picker.files(), { kind: "ESTADO" });
    toast(`Ejemplar ${item.code} dado de alta.`);
    await hooks.reload();
  } catch (err) {
    toast(err.message, true);
  } finally {
    picker.dispose();
  }
}

/** Corrige la condición de un ejemplar. */
async function editItem(p, itemId) {
  const it = p.items.find((i) => i.id === itemId);
  const datos = await formDialog(`Condición de ${it.code ?? `#${it.id}`}`, [
    h("label", {}, "Condición", h("select", { name: "condition" },
      h("option", { value: "" }, "—"),
      state.taxonomy.conditions.map((c) => h("option", { value: c, selected: it.condition === c || null }, CONDITION_LABEL[c] ?? c)))),
  ], "Guardar");
  if (!datos) return;
  try {
    await api(`/api/items/${itemId}`, { method: "PATCH", body: { condition: datos.get("condition") || null } });
    toast("Condición guardada.");
    await hooks.reload();
  } catch (err) {
    toast(err.message, true);
  }
}

/**
 * Atiende un clic delegado de la pestaña.
 * @param {HTMLElement} el Elemento con `data-action`.
 * @returns {boolean} true si la acción era de esta pestaña.
 */
export function catalogClick(el) {
  const p = state.products.find((x) => x.id === Number(el.dataset.product));
  const i = Number(el.dataset.i);
  switch (el.dataset.action) {
    case "model-new":
      modelDialog(null);
      return true;
    case "model-open":
      state.openProduct = p.id;
      state.filter = "";
      hooks.render();
      return true;
    case "model-close":
      state.openProduct = null;
      hooks.render();
      return true;
    case "model-edit":
      modelDialog(p);
      return true;
    case "photo-add":
      addPhotos(p);
      return true;
    case "photo-move": {
      const imgs = [...p.imgs];
      const [f] = imgs.splice(i, 1);
      imgs.splice(Number(el.dataset.to), 0, f);
      savePhotoOrder(p, imgs, "Orden guardado.");
      return true;
    }
    case "photo-remove":
      formDialog("Quitar foto", [h("p", {}, "La foto sale del catálogo y se borra del almacenamiento.")], "Quitar")
        .then((ok) => ok && savePhotoOrder(p, p.imgs.filter((_, j) => j !== i), "Foto quitada."));
      return true;
    case "item-new":
      newItem(p);
      return true;
    case "item-edit":
      editItem(p, Number(el.dataset.item));
      return true;
    default:
      return false;
  }
}
