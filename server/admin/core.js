/**
 * Piezas comunes del panel: estado, creación de nodos, fechas, llamadas a la
 * API y diálogos. Las usan todas las pestañas.
 *
 * Todo lo que viene de la base se pinta con `textContent` (vía `h()`), nunca
 * con `innerHTML`: nombres de clientes, notas y direcciones son texto ajeno.
 */

/**
 * Lo que este módulo necesita de quien lo usa, sin importarlo (evita un ciclo
 * con admin.js): qué hacer si la sesión caduca y cómo recargar o repintar la
 * pestaña.
 */
export const hooks = {
  unauthorized: () => {},
  reload: async () => {},
  render: () => {},
};

export const STATUS_LABEL = {
  DISPONIBLE: "Disponible",
  RESERVADA: "Reservada",
  EN_ALQUILER: "En alquiler",
  EN_LAVADO: "En lavado",
  NO_ALQUILABLE: "No alquilable",
  PERDIDA: "Perdida",
};
export const STATUS_TONE = { DISPONIBLE: "", RESERVADA: "warn", EN_ALQUILER: "warn", EN_LAVADO: "muted", NO_ALQUILABLE: "bad", PERDIDA: "bad" };
export const PAY_LABEL = { cash: "Efectivo", credit: "Crédito", debit: "Débito" };

/** Filtros del catálogo sin tocar: sirve para iniciarlos y para «Limpiar». */
export const CATALOG_FILTERS_DEFAULT = Object.freeze({
  category: "", material: "", status: "", size: "", color: "",
  occasion: "", season: "", audience: "", pending: "", sort: "new",
});

export const state = {
  token: null,
  me: null,
  tab: null,
  orders: [],
  items: [],
  stragglers: null,
  /** Días que el local no abre (`GET /api/config`); null hasta cargarlos. */
  calendar: null,
  /** Modelos del catálogo (`GET /api/admin/products`). */
  products: [],
  /** Taxonomía (`GET /api/taxonomy`); se pide una vez. */
  taxonomy: null,
  /** Taxonomía con usos y coste de lavado, para la pestaña Taxonomía. */
  taxAdmin: null,
  /** Modelo abierto en la pestaña Catálogo, o null para la lista. */
  openProduct: null,
  /** Filtros de la lista del catálogo; "" es «todos». */
  catalogFilters: { ...CATALOG_FILTERS_DEFAULT },
  filter: "",
};

export const $ = (id) => document.getElementById(id);

/* ---------- utilidades ---------- */

/**
 * Crea un elemento. Los hijos de texto entran como nodos de texto, así que
 * ningún dato llega a interpretarse como HTML.
 * @param {string} tag Etiqueta, con clases opcionales: `"button.btn.primary"`.
 * @param {object} [attrs] Atributos (`dataset` se reparte en `data-*`).
 * @param {...(Node|string|number|null|false)} children Hijos; los falsos se omiten.
 * @returns {HTMLElement}
 */
export function h(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split(".");
  const el = document.createElement(name);
  if (classes.length) el.className = classes.join(" ");
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

/** Centavos a "$12.34". */
export const money = (c) => `$${(c / 100).toFixed(2)}`;

/** Día local `YYYY-MM-DD` de un instante (no `toISOString()`, que es UTC). */
export const localISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Hoy en hora local, `YYYY-MM-DD`. */
export const todayISO = () => localISO(new Date());

/** Fecha y hora cortas para las marcas de tiempo del servidor. */
export const when = (iso) => new Date(iso).toLocaleString("es-EC", { dateStyle: "short", timeStyle: "short" });

/* ---------- fechas de calendario ---------- */

export const DIA_MS = 86_400_000;
export const WEEKDAY = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
export const MONTH = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/**
 * Las fechas `YYYY-MM-DD` se tratan como días de calendario en UTC: así sumar
 * días o sacar el día de la semana no depende de la zona horaria del equipo.
 */
export const isoDate = (iso) => new Date(`${iso}T00:00:00Z`);

/** Suma días a una fecha `YYYY-MM-DD`. */
export const addDays = (iso, n) => new Date(isoDate(iso).getTime() + n * DIA_MS).toISOString().slice(0, 10);

/** Días de calendario de `a` a `b` (negativo si `b` es anterior). */
export const daysBetween = (a, b) => Math.round((isoDate(b) - isoDate(a)) / DIA_MS);

/** "lun 24 nov". */
export function fmtDay(iso) {
  const d = isoDate(iso);
  return `${WEEKDAY[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`;
}

/** Nombre del feriado de ese día, si lo es. */
export const holidayName = (iso) => state.calendar?.holidays.find((x) => x.date === iso)?.name ?? null;

/**
 * Indica si el local abre ese día. Es la misma regla que `isBusinessDay()` del
 * servidor; aquí solo sirve para dibujar y para anticipar los días extra, el
 * cobro lo calcula siempre el servidor.
 */
export function isOpen(iso) {
  const cerrados = state.calendar?.closedWeekdays ?? [0, 6];
  return !cerrados.includes(isoDate(iso).getUTCDay()) && !holidayName(iso);
}

/** Días hábiles después de `returnBy` hasta `until`, inclusive (como `lateDays()`). */
export function lateDays(returnBy, until) {
  let n = 0;
  for (let d = addDays(returnBy, 1), i = 0; d <= until && i < 366; d = addDays(d, 1), i++) {
    if (isOpen(d)) n++;
  }
  return n;
}

/** "hace 3 días", "hoy", "en 2 días". */
export function relDays(iso) {
  const n = daysBetween(todayISO(), iso);
  if (n === 0) return "hoy";
  if (n === 1) return "mañana";
  if (n === -1) return "ayer";
  return n > 0 ? `en ${n} días` : `hace ${-n} días`;
}

/** Instante del servidor como «hace N días», con la fecha exacta al pasar el ratón. */
export const since = (instant) => h("span", { title: when(instant) }, relDays(localISO(new Date(instant))));

/** Indica si la sesión tiene la capacidad (Administración cuenta como todas). */
export function can(cap) {
  const caps = state.me?.capabilities ?? [];
  return caps.includes(cap) || caps.includes("ADMINISTRACION");
}

/** Muestra un aviso breve. */
export function toast(text, error = false) {
  const t = $("toast");
  t.textContent = text;
  t.className = error ? "toast error" : "toast";
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 4000);
}

/** Chip con el estado interno de un ejemplar. */
export const statusChip = (s) => h(`span.chip${STATUS_TONE[s] ? `.${STATUS_TONE[s]}` : ""}`, {}, STATUS_LABEL[s] ?? s);

/* ---------- API ---------- */

/**
 * Llama a la API del mismo origen con la sesión. Un 401 cierra la sesión: el
 * token venció o lo revocaron, y seguir enseñando datos sería engañoso.
 * @param {string} path Ruta, p. ej. `/api/admin/orders`.
 * @param {object} [opts] `method` y `body` (se envía como JSON).
 * @returns {Promise<any>} Cuerpo de la respuesta.
 */
export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && state.token) {
    hooks.unauthorized();
    throw new Error("La sesión venció; vuelve a entrar.");
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Error ${res.status}`);
  return data;
}

/**
 * Sube fotos (`multipart/form-data`) con la sesión. El navegador pone el
 * `Content-Type` con su frontera; por eso aquí no se fija.
 * @param {string} path Ruta de subida.
 * @param {Blob[]} files Fotos ya preparadas.
 * @param {Record<string, string>} [fields] Campos de texto.
 * @returns {Promise<any>} Cuerpo de la respuesta.
 */
export async function upload(path, files, fields = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  files.forEach((f, i) => form.append("photo", f, `foto-${i + 1}.jpg`));
  const res = await fetch(path, {
    method: "POST",
    headers: state.token ? { authorization: `Bearer ${state.token}` } : {},
    body: form,
  });
  if (res.status === 401 && state.token) {
    hooks.unauthorized();
    throw new Error("La sesión venció; vuelve a entrar.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Error ${res.status}`);
  return data;
}

/**
 * Ejecuta una acción del panel, avisa del resultado y recarga la pestaña.
 * @param {() => Promise<any>} fn Acción.
 * @param {string} ok Mensaje de éxito.
 */
export async function act(fn, ok) {
  try {
    await fn();
    toast(ok);
    await hooks.reload();
  } catch (err) {
    toast(err.message, true);
  }
}

/**
 * Abre un diálogo modal con un formulario y resuelve con sus datos, o con null
 * si se cancela.
 * @param {string} title Título.
 * @param {Node[]} fields Campos del formulario.
 * @param {string} submit Texto del botón de confirmar.
 * @param {object} [opts]
 * @param {boolean} [opts.cancel] Botón de cancelar (no en los que solo enseñan).
 * @param {boolean} [opts.wide] Más ancho (fotos).
 * @param {(form: HTMLFormElement) => string|null} [opts.validate] Lo que el
 *   navegador no comprueba solo (p. ej. «falta una foto»): si devuelve un
 *   mensaje, el diálogo no se cierra y lo enseña.
 * @returns {Promise<FormData|null>}
 */
export function formDialog(title, fields, submit, { cancel = true, wide = false, validate = null } = {}) {
  return new Promise((resolve) => {
    const aviso = h("p.msg", { role: "alert" });
    const form = h("form", { method: "dialog" },
      h("h3", {}, title),
      ...fields,
      aviso,
      h("div.actions", {},
        cancel ? h("button.btn", { type: "button", value: "cancel" }, "Cancelar") : null,
        h("button.btn.primary", { type: "submit" }, submit),
      ),
    );
    const dlg = h(wide ? "dialog.wide" : "dialog", {}, form);
    let datos = null;
    form.querySelector('button[value="cancel"]')?.addEventListener("click", () => dlg.close());
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const problema = validate?.(form);
      if (problema) {
        aviso.textContent = problema;
        return;
      }
      datos = new FormData(form);
      dlg.close();
    });
    dlg.addEventListener("close", () => { dlg.remove(); resolve(datos); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

/** Pide una confirmación con nota opcional; null si se cancela. */
export async function confirmWithNote(title, text, submit, noteRequired = false) {
  const datos = await formDialog(title, [
    h("p", {}, text),
    h("label", {}, noteRequired ? "Motivo" : "Observación (opcional)",
      h("textarea", { name: "note", maxlength: 500, rows: 2, required: noteRequired || null })),
  ], submit);
  return datos ? { note: datos.get("note") || undefined } : null;
}
