/**
 * Pestaña Taxonomía (capacidad Inventario): las listas con las que se
 * describen las prendas y con las que la app y la web arman sus filtros.
 *
 * Cada entrada dice cuántos modelos o ejemplares la usan: lo usado se puede
 * renombrar y reordenar, pero no borrar. La clave y el prefijo no aparecen
 * como editables porque el servidor no deja cambiarlos.
 */
import { amt, api, can, formDialog, h, hooks, state, toast } from "./core.js";

/** Secciones en el orden del panel, con su título y qué cuentan los usos. */
const SECTIONS = [
  { list: "categories", title: "Categorías", noun: "Categoría", uses: "modelos" },
  { list: "colors", title: "Colores", noun: "Color", uses: "ejemplares" },
  { list: "sizes", title: "Tallas", noun: "Talla", uses: "ejemplares" },
  { list: "materials", title: "Materiales", noun: "Material", uses: "modelos" },
  { list: "occasions", title: "Ocasiones", noun: "Ocasión", uses: "modelos" },
  { list: "seasons", title: "Temporadas", noun: "Temporada", uses: "modelos" },
  { list: "audiences", title: "Públicos", noun: "Público", uses: "modelos" },
];
const SCALE_LABEL = { ROPA: "Ropa", CALZADO: "Calzado" };

/** Carga las listas con sus usos. */
export async function loadTaxonomyAdmin() {
  state.taxAdmin = await api("/api/admin/taxonomy");
}

/** Muestra de un color. El fondo va por CSSOM: la CSP no deja atributos `style`. */
function swatch(hex) {
  const s = h("span.swatch", { "aria-hidden": "true" });
  s.style.background = hex;
  return s;
}

/** "$1.50" desde centavos. */
const dolares = (c) => `$${(c / 100).toFixed(2)}`;

/**
 * Filas de una tabla de la taxonomía, con ↑/↓ dentro de su grupo (las tallas
 * se ordenan por escala) y borrar solo si nada la usa.
 */
function rows(sec, filas) {
  return filas.map((r, i) => h("tr", {},
    h("td", {}, sec.list === "colors" ? swatch(r.hex) : null, " ", sec.list === "sizes" ? r.label : r.name),
    sec.list === "categories" ? h("td", {}, h("code", {}, r.prefix)) : null,
    sec.list === "colors" ? h("td", {}, h("code", {}, r.hex)) : null,
    sec.list === "materials" ? h("td", {}, dolares(r.laundryCents)) : null,
    h("td", {}, r.uses ? `${r.uses} ${sec.uses}` : h("span.meta", {}, "sin uso")),
    h("td.row-actions", {},
      h("button.btn.small", { type: "button", "aria-label": "Subir", disabled: i === 0 || null, dataset: { action: "tax-move", list: sec.list, key: r.id, dir: -1 } }, "↑"), " ",
      h("button.btn.small", { type: "button", "aria-label": "Bajar", disabled: i === filas.length - 1 || null, dataset: { action: "tax-move", list: sec.list, key: r.id, dir: 1 } }, "↓"), " ",
      sec.list !== "sizes" ? h("button.btn.small", { type: "button", dataset: { action: "tax-edit", list: sec.list, key: r.id } }, "Editar") : null, " ",
      h("button.btn.small.danger", {
        type: "button",
        disabled: r.uses > 0 || null,
        title: r.uses > 0 ? `No se puede borrar: la usan ${r.uses} ${sec.uses}. Puedes renombrarla.` : null,
        dataset: { action: "tax-delete", list: sec.list, key: r.id },
      }, "Borrar")),
  ));
}

/** Cabeceras de la tabla de una sección. */
const headers = (sec) => [
  sec.list === "sizes" ? "Talla" : "Nombre",
  sec.list === "categories" ? "Prefijo" : null,
  sec.list === "colors" ? "Hex" : null,
  sec.list === "materials" ? "Lavado" : null,
  "En uso", "",
].filter((x) => x !== null);

/** Tabla de un grupo de filas. */
const table = (sec, filas) => h("div.table-wrap", {}, h("table", {},
  h("thead", {}, h("tr", {}, headers(sec).map((t) => h("th", {}, t)))),
  h("tbody", {}, rows(sec, filas))));

/** Pinta todas las secciones, cada una plegable. */
export function renderTaxonomy() {
  const t = state.taxAdmin;
  if (!t) return [h("p.empty", {}, "Cargando…")];
  return [
    h("h2", {}, "Taxonomía ", h("small", {}, "las listas con las que se describe cada prenda; la app y la web arman sus filtros con ellas")),
    ...SECTIONS.map((sec) => {
      const filas = t[sec.list] ?? [];
      const cuerpo = sec.list === "sizes"
        ? ["ROPA", "CALZADO"].flatMap((esc) => [
          h("h4", {}, SCALE_LABEL[esc], " ",
            h("button.btn.small", { type: "button", dataset: { action: "tax-add", list: "sizes", scale: esc } }, `Agregar talla de ${SCALE_LABEL[esc].toLowerCase()}`)),
          table(sec, filas.filter((r) => r.scale === esc)),
        ])
        : [table(sec, filas), h("button.btn.small", { type: "button", dataset: { action: "tax-add", list: sec.list } }, `Agregar ${sec.noun.toLowerCase()}`)];
      return h("details.tax-section", { open: true },
        h("summary", {}, h("span", {}, sec.title), h("small.meta", {}, ` ${filas.length}`)),
        sec.list === "materials"
          ? h("p.meta", {}, "El coste de lavado fija el precio mínimo de cada alquiler: solo lo cambia la administración. Un material nuevo cuenta como algodón en el contador de agua ahorrada.")
          : null,
        sec.list === "categories"
          ? h("p.meta", {}, "El prefijo va en el código de inventario de cada ejemplar (p. ej. FIE-26-0001), así que no se cambia después de crearla.")
          : null,
        ...cuerpo);
    }),
  ];
}

/** Título de una lista («Colores»), para los avisos. */
const titleOf = (list) => SECTIONS.find((x) => x.list === list)?.title ?? list;

/** Recarga la pestaña y olvida la taxonomía del catálogo, que ya cambió. */
async function refrescar(ok, opts) {
  state.taxonomy = null;
  toast(ok, false, opts);
  await hooks.reload();
}

/** Diálogo de alta de una entrada. */
async function addEntry(list, scale) {
  const sec = SECTIONS.find((s) => s.list === list);
  const admin = can("ADMINISTRACION");
  const campos = list === "sizes"
    ? [h("label", {}, `Talla de ${SCALE_LABEL[scale].toLowerCase()}`,
      h("input", { name: "label", required: true, maxlength: 6, placeholder: scale === "CALZADO" ? "38 o 38.5" : "XXL" }))]
    : [h("label", {}, "Nombre", h("input", { name: "name", required: true, minlength: 2, maxlength: 40 }))];
  if (list === "categories") {
    campos.push(h("label", {}, "Prefijo de inventario (3 letras, no se cambia después)",
      h("input", { name: "prefix", required: true, pattern: "[A-Za-z]{3}", maxlength: 3, placeholder: "PLY" })));
  }
  if (list === "colors") campos.push(h("label", {}, "Color", h("input", { name: "hex", type: "color", value: "#888888" })));
  if (list === "materials") {
    campos.push(admin
      ? h("label", {}, "Coste de lavado (USD por ciclo)", h("input", { name: "laundry", type: "number", required: true, min: 0, max: 50, step: "0.01" }))
      : h("p.meta", {}, "Crear un material exige fijar su coste de lavado, que es de la administración."));
  }
  const datos = await formDialog(`Nueva ${list === "sizes" ? "talla" : sec.noun.toLowerCase()}`, campos, "Crear");
  if (!datos) return;
  const body = list === "sizes"
    ? { scale, label: datos.get("label") }
    : { name: datos.get("name") };
  if (list === "categories") body.prefix = datos.get("prefix");
  if (list === "colors") body.hex = datos.get("hex");
  if (list === "materials") body.laundryCents = Math.round(Number(datos.get("laundry")) * 100);
  try {
    await api(`/api/taxonomy/${list}`, { method: "POST", body });
    const nombre = body.name ?? body.label;
    await refrescar([`Alta en ${sec.title}: `, h("strong", {}, nombre),
      body.prefix ? ` con prefijo ${body.prefix.toUpperCase()}` : "",
      body.laundryCents != null ? [" · lavado ", amt(body.laundryCents, "bad"), " por ciclo"] : "", "."]);
  } catch (err) {
    toast(err.message, true);
  }
}

/** Diálogo de edición: nombre, y hex o coste de lavado según la lista. */
async function editEntry(list, key) {
  const r = state.taxAdmin[list].find((x) => x.id === key);
  const admin = can("ADMINISTRACION");
  const campos = [h("label", {}, "Nombre", h("input", { name: "name", required: true, minlength: 2, maxlength: 40, value: r.name }))];
  if (list === "colors") campos.push(h("label", {}, "Color", h("input", { name: "hex", type: "color", value: r.hex })));
  if (list === "materials") {
    campos.push(h("label", {}, "Coste de lavado (USD por ciclo)",
      h("input", { name: "laundry", type: "number", min: 0, max: 50, step: "0.01", value: (r.laundryCents / 100).toFixed(2), disabled: !admin || null })));
    if (!admin) campos.push(h("p.meta", {}, "El coste de lavado solo lo cambia la administración."));
  }
  if (list === "categories") campos.push(h("p.meta", {}, `Prefijo ${r.prefix} y clave «${r.key}»: no se cambian.`));
  const datos = await formDialog(`Editar ${r.name}`, campos, "Guardar");
  if (!datos) return;
  // Solo lo que cambió: así Inventario puede renombrar un material sin mandar
  // el coste de lavado, que el servidor le negaría.
  const body = {};
  if (datos.get("name") !== r.name) body.name = datos.get("name");
  if (list === "colors" && datos.get("hex") !== r.hex) body.hex = datos.get("hex");
  if (list === "materials" && admin) {
    const c = Math.round(Number(datos.get("laundry")) * 100);
    if (c !== r.laundryCents) body.laundryCents = c;
  }
  if (!Object.keys(body).length) return toast("No cambió nada.");
  try {
    await api(`/api/taxonomy/${list}/${encodeURIComponent(key)}`, { method: "PATCH", body });
    await refrescar([`${titleOf(list)}: `, h("strong", {}, body.name ?? r.name),
      body.name ? ` (antes «${r.name}»)` : " guardado",
      body.laundryCents != null ? [": lavado de ", amt(r.laundryCents, "ok"), " a ", amt(body.laundryCents, "bad"), " por ciclo. Mueve el precio mínimo de sus prendas"] : "",
      "."]);
  } catch (err) {
    toast(err.message, true);
  }
}

/** Sube o baja una entrada dentro de su grupo y guarda el orden entero. */
async function moveEntry(list, key, dir) {
  const todas = state.taxAdmin[list];
  const grupo = list === "sizes" ? todas.filter((r) => r.scale === todas.find((x) => x.id === key).scale) : todas;
  const keys = grupo.map((r) => r.id);
  const i = keys.indexOf(key);
  const j = i + dir;
  if (j < 0 || j >= keys.length) return;
  [keys[i], keys[j]] = [keys[j], keys[i]];
  try {
    await api(`/api/taxonomy/${list}/order`, { method: "PUT", body: { keys } });
    await refrescar([h("strong", {}, grupo[i].name ?? grupo[i].label), dir < 0 ? " sube" : " baja", " un puesto en la lista."]);
  } catch (err) {
    toast(err.message, true);
  }
}

/** Confirma y borra una entrada sin uso. */
async function deleteEntry(list, key) {
  const r = state.taxAdmin[list].find((x) => x.id === key);
  const ok = await formDialog("Borrar", [h("p", {}, `Se borra «${r.name ?? r.label}» de la lista. Nada la usa ahora mismo.`)], "Borrar");
  if (!ok) return;
  try {
    await api(`/api/taxonomy/${list}/${encodeURIComponent(key)}`, { method: "DELETE" });
    await refrescar(["Se borró ", h("strong", {}, r.name ?? r.label), ` de ${titleOf(list)}.`], { tone: "bad" });
  } catch (err) {
    toast(err.message, true);
  }
}

/**
 * Atiende un clic delegado de la pestaña.
 * @param {HTMLElement} el Elemento con `data-action`.
 * @returns {boolean} true si la acción era de esta pestaña.
 */
export function taxonomyClick(el) {
  const { list, key, scale } = el.dataset;
  switch (el.dataset.action) {
    case "tax-add": addEntry(list, scale); return true;
    case "tax-edit": editEntry(list, key); return true;
    case "tax-move": moveEntry(list, key, Number(el.dataset.dir)); return true;
    case "tax-delete": deleteEntry(list, key); return true;
    default: return false;
  }
}
