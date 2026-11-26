/**
 * Pestaña Catálogo (capacidad Inventario): alta y edición de modelos, sus
 * fotos de catálogo y sus ejemplares.
 *
 * Un modelo sin ejemplares no sale en la app: el panel lo avisa, porque es el
 * paso que más fácil se olvida al dar de alta una prenda.
 */
import {
  CATALOG_FILTERS_DEFAULT, STATUS_LABEL, amt, api, can, formDialog, h, hooks, state, statusChip, toast, upload,
} from "./core.js";
import { photoButton, photoPicker, thumb } from "./photos.js";

const CONDITION_LABEL = { NUEVA: "Nueva", COMO_NUEVA: "Como nueva", BUENA: "Buena", USO_VISIBLE: "Uso visible" };
const MAX_PHOTOS = 6;
/** Nombre de cada campo del modelo en los avisos de «guardado». */
const FIELD_LABEL = {
  name: "nombre", desc: "descripción", categoryKey: "categoría", material: "material", value: "valor",
  stars: "estrellas", brand: "marca", audienceKey: "público", seasonKey: "temporada", occasions: "ocasiones", weightKg: "peso",
};

/** Carga los modelos y, la primera vez, la taxonomía. */
export async function loadCatalog() {
  const [productos, taxonomia] = await Promise.all([
    api("/api/admin/products"),
    state.taxonomy ? state.taxonomy : api("/api/taxonomy"),
  ]);
  state.products = productos;
  state.taxonomy = taxonomia;
  // El precio del modelo abierto también: una edición de valor o estrellas lo mueve.
  if (state.openProduct) await loadPricing(state.openProduct);
}

/** Carga el precio de un modelo con su historial. */
async function loadPricing(id) {
  state.pricing[id] = await api(`/api/products/${id}/pricing`);
}

/** Días que se enseñan de la escalera: los que más se alquilan. */
const LADDER_SHOWN = [1, 2, 3, 5, 7, 14];

/** "$3.00". */
const usd = (x) => `$${Number(x).toFixed(2)}`;

/** Escalera resumida: precio total por días. */
const ladderTable = (ladder) => h("div.table-wrap", {}, h("table.ladder", {},
  h("thead", {}, h("tr", {}, h("th", {}, "Días"), LADDER_SHOWN.map((d) => h("th", {}, d)))),
  h("tbody", {}, h("tr", {}, h("th", {}, "Total"), LADDER_SHOWN.map((d) => h("td", {}, usd(ladder[d - 1])))))));

/**
 * De dónde sale el precio del primer día. En prendas baratas manda el suelo
 * y no la fórmula: decirlo evita pensar que las estrellas lo fijaron.
 */
function origenPrimerDia(pr) {
  const base = pr.priceOverride ?? pr.formulaDay1;
  const quien = pr.priceOverride != null ? "el ajuste manual" : `la fórmula (${pr.stars} estrella${pr.stars === 1 ? "" : "s"})`;
  if (pr.ladder[0] > base) return `lo fija el suelo: ${quien} daría ${usd(base)}`;
  return pr.priceOverride != null ? `ajuste manual (la fórmula daría ${usd(pr.formulaDay1)})` : `fórmula por ${pr.stars} estrella${pr.stars === 1 ? "" : "s"}`;
}

/**
 * Sección Precio de la ficha: de dónde sale el primer día, el coste y el
 * suelo, la escalera, la garantía y quién cambió qué. Ajustar es de
 * Administración; el resto lo ve Inventario.
 */
function pricingSection(p) {
  const pr = state.pricing[p.id];
  if (!pr) return [h("h3", {}, "Precio"), h("p.meta", {}, "Cargando…")];
  const dato = (label, valor, nota) => [h("dt", {}, label), h("dd", {}, valor, nota ? h("div.meta", {}, nota) : null)];
  const cuando = (at) => new Date(at).toLocaleString("es-EC", { dateStyle: "short", timeStyle: "short" });
  return [
    h("h3", {}, "Precio ", h("small.meta", {}, "lo calcula el servidor; el cliente ve esta misma escalera")),
    h("section.panel-box", {},
      h("dl.facts", {},
        dato("Primer día", usd(pr.ladder[0]), origenPrimerDia(pr)),
        dato("Coste por ciclo", usd(pr.cycleCost), `incluye lavado de ${usd(pr.laundry)}`),
        dato("Suelo", usd(pr.floor), "ningún alquiler se cobra por debajo"),
        dato("Garantía", `$${pr.deposit}`, pr.depositOverride != null ? `fija (la fórmula daría $${pr.depositFormula})` : "40 % del valor, con tope"),
      ),
      ladderTable(pr.ladder),
      pr.pricing !== "CTG"
        ? h("p.meta", {}, "Este modelo usa la tarifa de su socio: CTG no la ajusta.")
        : can("ADMINISTRACION")
          ? h("button.btn", { type: "button", dataset: { action: "price-adjust", product: p.id } }, "Ajustar precio")
          : h("p.meta", {}, "Ajustar el precio es de la administración."),
      h("h4", {}, "Historial"),
      pr.history.length
        ? h("ul.lines", {}, pr.history.map((x) => h("li", {}, h("span", {}, x.note), h("span.meta", {}, `${cuando(x.at)} · ${x.by}`))))
        : h("p.meta", {}, "Sin cambios desde el alta."),
    ),
  ];
}

/**
 * Diálogo de ajuste con vista previa: cada cambio pide al servidor la
 * escalera que saldría (sin guardar), así lo que se ve es lo que se cobrará.
 */
async function adjustPrice(p) {
  const pr = state.pricing[p.id];
  const dia = h("input", { name: "day1", type: "number", min: 0, step: "0.01", placeholder: `Fórmula: ${pr.formulaDay1.toFixed(2)}`, value: pr.priceOverride ?? "" });
  const garantia = h("input", { name: "deposit", type: "number", min: 1, max: 500, step: "1", placeholder: `Fórmula: ${pr.depositFormula}`, value: pr.depositOverride ?? "" });
  const previa = h("div", {}, ladderTable(pr.ladder));
  const aviso = h("p.msg", { role: "status" });
  let turno = 0;
  const actualizar = async () => {
    const mio = ++turno;
    const q = new URLSearchParams({ priceOverride: dia.value, depositOverride: garantia.value });
    try {
      const v = await api(`/api/products/${p.id}/pricing?${q}`);
      if (mio !== turno) return; // Llegó tarde: ya hay una consulta más nueva.
      aviso.textContent = v.error ?? "";
      previa.replaceChildren(ladderTable(v.ladder), h("p.meta", {}, `Garantía: $${v.deposit}`));
    } catch (err) {
      if (mio === turno) aviso.textContent = err.message;
    }
  };
  let espera;
  for (const input of [dia, garantia]) {
    input.addEventListener("input", () => { clearTimeout(espera); espera = setTimeout(actualizar, 250); });
  }

  const datos = await formDialog(`Precio de ${p.name}`, [
    h("p.meta", {}, `Vacío = fórmula. El primer día no puede bajar del coste por ciclo (${usd(pr.cycleCost)}); los días siguientes siguen la escalera.`),
    h("div.grid2", {},
      h("label", {}, "Primer día (USD)", dia),
      h("label", {}, "Garantía fija (USD enteros)", garantia)),
    h("h4", {}, "Así quedaría"),
    previa,
    aviso,
    h("label", {}, "Motivo (queda en el historial)", h("textarea", { name: "note", maxlength: 300, rows: 2 })),
  ], "Guardar precio", { wide: true });
  clearTimeout(espera);
  if (!datos) return;

  const body = {};
  const nuevoDia = datos.get("day1") === "" ? null : Number(datos.get("day1"));
  const nuevaGarantia = datos.get("deposit") === "" ? null : Number(datos.get("deposit"));
  if (nuevoDia !== pr.priceOverride) body.priceOverride = nuevoDia;
  if (nuevaGarantia !== pr.depositOverride) body.depositOverride = nuevaGarantia;
  if (!Object.keys(body).length) return toast("No cambió nada.");
  if (datos.get("note")) body.note = datos.get("note");
  try {
    await api(`/api/products/${p.id}/pricing`, { method: "PATCH", body });
    const partes = [];
    if ("priceOverride" in body) {
      partes.push(body.priceOverride == null
        ? "el día 1 vuelve a la fórmula"
        : ["día 1 fijo en ", amt(Math.round(body.priceOverride * 100))]);
    }
    if ("depositOverride" in body) {
      partes.push(body.depositOverride == null
        ? "la garantía vuelve a la fórmula"
        : ["garantía fija en ", amt(Math.round(body.depositOverride * 100))]);
    }
    toast(["Precio de ", h("strong", {}, p.name), ": ", partes.flatMap((x, i) => (i ? [" y ", x] : [x])), "."]);
    await hooks.reload();
  } catch (err) {
    toast(err.message, true);
  }
}

/** Nombre de una clave de la taxonomía. */
const nombre = (lista, key) => state.taxonomy?.[lista]?.find((x) => x.key === key)?.name ?? key ?? "—";

/** Pinta la lista de modelos o el modelo abierto. */
export function renderCatalog(searchBar, matches) {
  const abierto = state.products.find((p) => p.id === state.openProduct);
  return abierto ? renderModel(abierto) : renderList(searchBar, matches);
}

/** Qué le falta a un modelo para estar completo, para el filtro «Pendiente». */
const PENDING = {
  "no-items": { label: "Sin ejemplares (no sale en la app)", test: (p) => p.items.length === 0 },
  "no-photos": { label: "Sin fotos", test: (p) => p.photos.length === 0 },
  "few-photos": { label: "Con menos de 3 fotos", test: (p) => p.photos.length < 3 },
};

/** Órdenes de la lista. Los ids crecen con el alta, así que «más nuevos» es id descendente. */
const SORTS = {
  new: { label: "Más nuevos", cmp: (a, b) => b.id - a.id },
  name: { label: "Nombre", cmp: (a, b) => a.name.localeCompare(b.name, "es") },
  "value-asc": { label: "Valor ↑", cmp: (a, b) => a.value - b.value || b.id - a.id },
  "value-desc": { label: "Valor ↓", cmp: (a, b) => b.value - a.value || b.id - a.id },
  items: { label: "Más ejemplares", cmp: (a, b) => b.items.length - a.items.length || b.id - a.id },
};

/**
 * Indica si un modelo pasa los filtros. Los de ejemplar (estado, talla, color)
 * piden que **alguno** de sus ejemplares cumpla: se busca la prenda, y basta
 * con que haya una así.
 * @param {object} p Modelo del panel.
 * @param {object} [f] Filtros.
 * @returns {boolean}
 */
export function matchesFilters(p, f = state.catalogFilters) {
  const alguno = (pred) => p.items.some(pred);
  return (!f.category || p.categoryKey === f.category)
    && (!f.material || p.material === f.material)
    && (!f.occasion || p.occasions.includes(f.occasion))
    && (!f.season || p.seasonKey === f.season)
    && (!f.audience || p.audienceKey === f.audience)
    && (!f.status || alguno((i) => i.status === f.status))
    && (!f.size || alguno((i) => `${i.sizeScale}|${i.size}` === f.size))
    && (!f.color || alguno((i) => i.color === f.color))
    && (!f.pending || (PENDING[f.pending]?.test(p) ?? true));
}

/** Ordena una copia de la lista según el filtro de orden. */
export const sortModels = (list, sort = state.catalogFilters.sort) =>
  [...list].sort((SORTS[sort] ?? SORTS.new).cmp);

/** Indica si hay algún filtro distinto del inicial (para enseñar «Limpiar»). */
const anyCatalogFilter = () =>
  Object.entries(CATALOG_FILTERS_DEFAULT).some(([k, v]) => state.catalogFilters[k] !== v);

/** Barra de filtros: un desplegable por criterio, con «Limpiar» si hay alguno puesto. */
function catalogFilterBar() {
  const f = state.catalogFilters;
  const tax = state.taxonomy ?? {};
  /** Un desplegable con su etiqueta; `items` son pares [valor, texto]. */
  const filtro = (key, label, items, todos = "Todos") => h("label", {}, label,
    h("select", { dataset: { action: "catalog-filter", key } },
      todos !== null ? h("option", { value: "", selected: !f[key] || null }, todos) : null,
      items.map(([v, t]) => h("option", { value: v, selected: f[key] === v || null }, t))));
  const deTax = (lista) => (tax[lista] ?? []).map((x) => [x.key, x.name]);
  // Solo las tallas que algún ejemplar tiene: la lista completa (ropa más
  // calzado) es larga y casi toda daría cero resultados.
  const tallas = [...new Set(state.products.flatMap((p) => p.items.map((i) => `${i.sizeScale}|${i.size}`)))]
    .sort((a, b) => {
      const orden = (k) => (tax.sizes ?? []).findIndex((s) => `${s.scale}|${s.label}` === k);
      return orden(a) - orden(b);
    })
    .map((k) => [k, `${k.split("|")[1]}${k.startsWith("CALZADO") ? " (calzado)" : ""}`]);

  return h("div.filters", {},
    filtro("category", "Categoría", deTax("categories"), "Todas"),
    filtro("status", "Ejemplares", Object.entries(STATUS_LABEL)),
    filtro("pending", "Pendiente", Object.entries(PENDING).map(([k, v]) => [k, v.label]), "—"),
    filtro("size", "Talla", tallas, "Todas"),
    filtro("color", "Color", deTax("colors")),
    filtro("material", "Material", deTax("materials")),
    filtro("occasion", "Ocasión", deTax("occasions"), "Todas"),
    filtro("season", "Temporada", deTax("seasons"), "Todas"),
    filtro("audience", "Público", deTax("audiences")),
    filtro("sort", "Orden", Object.entries(SORTS).map(([k, v]) => [k, v.label]), null),
    anyCatalogFilter()
      ? h("button.btn.small", { type: "button", dataset: { action: "catalog-filters-clear" } }, "Limpiar filtros") : null,
  );
}

/** Lista de modelos con el buscador y los filtros aplicados. */
function renderList(searchBar, matches) {
  const lista = sortModels(state.products.filter((p) =>
    matchesFilters(p) && matches(p.name, p.category, p.brand, ...p.items.map((i) => i.code))));
  const filtrado = lista.length !== state.products.length;
  return [
    h("h2", {}, "Catálogo ", h("small", {},
      filtrado ? `${lista.length} de ${state.products.length} modelos` : `${state.products.length} modelos`)),
    h("div.bar", {},
      h("button.btn.primary", { type: "button", dataset: { action: "model-new" } }, "Nuevo modelo")),
    searchBar("Buscar por nombre, categoría, marca o código"),
    catalogFilterBar(),
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

    ...pricingSection(p),

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
      toast([h("strong", {}, cuerpo.name || p.name), " guardado: ", Object.keys(cambios).map((k) => FIELD_LABEL[k] ?? k).join(", "), "."]);
    } else {
      const nuevo = await api("/api/products", { method: "POST", body: cuerpo });
      state.openProduct = nuevo.id;
      toast([h("strong", {}, nuevo.name ?? cuerpo.name), " creado. Ahora sube sus fotos y su primer ejemplar."]);
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
      const n = picker.count();
      await upload(`/api/products/${p.id}/photos`, await picker.files());
      toast([`${n} foto${n === 1 ? "" : "s"} subida${n === 1 ? "" : "s"} a `, h("strong", {}, p.name), "."]);
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
    toast(["Ejemplar ", h("strong", {}, item.code), ` de ${p.name} dado de alta (talla ${size}). Ya está Disponible.`]);
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
    const c = datos.get("condition");
    toast([h("strong", {}, it.code ?? `#${it.id}`), ` de ${p.name}: condición ${c ? `«${CONDITION_LABEL[c] ?? c}»` : "sin indicar"}.`]);
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
      // El buscador y los filtros se conservan: al volver, la lista sigue igual.
      state.openProduct = p.id;
      hooks.render();
      loadPricing(p.id).then(hooks.render, (err) => toast(err.message, true));
      return true;
    case "price-adjust":
      adjustPrice(p);
      return true;
    case "catalog-filters-clear":
      state.catalogFilters = { ...CATALOG_FILTERS_DEFAULT };
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
      formDialog("Quitar foto", [h("p", {}, "La foto sale del catálogo. Se conserva en la Bitácora, con quién la quitó y cuándo.")], "Quitar")
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
