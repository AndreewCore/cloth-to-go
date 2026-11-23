/**
 * Panel del local (fase 4). Módulo ES: a diferencia de la app, el panel siempre
 * se sirve desde la API por HTTP, así que no necesita abrirse por `file://`.
 *
 * Todo lo que viene de la base se pinta con `textContent` (vía `h()`), nunca
 * con `innerHTML`: nombres de clientes, notas y direcciones son texto ajeno.
 * Los permisos que aquí esconden botones son comodidad; la comprobación real
 * la hace cada ruta del servidor.
 */

/** Mismo cliente OAuth que la app y la web (js/auth.js): es público. */
const GOOGLE_CLIENT_ID = "115840486389-f3vitcouhua5eckn3grn1gk9kqb7ccjs.apps.googleusercontent.com";
/** sessionStorage y no localStorage: el panel se usa en equipos compartidos del local. */
const SESSION_KEY = "clothToGo:admin:session";

const STATUS_LABEL = {
  DISPONIBLE: "Disponible",
  RESERVADA: "Reservada",
  EN_ALQUILER: "En alquiler",
  EN_LAVADO: "En lavado",
  NO_ALQUILABLE: "No alquilable",
  PERDIDA: "Perdida",
};
const STATUS_TONE = { DISPONIBLE: "", RESERVADA: "warn", EN_ALQUILER: "warn", EN_LAVADO: "muted", NO_ALQUILABLE: "bad", PERDIDA: "bad" };
const PAY_LABEL = { cash: "Efectivo", credit: "Crédito", debit: "Débito" };

const state = {
  token: null,
  me: null,
  tab: null,
  orders: [],
  items: [],
  stragglers: null,
  filter: "",
};

const $ = (id) => document.getElementById(id);

/* ---------- utilidades ---------- */

/**
 * Crea un elemento. Los hijos de texto entran como nodos de texto, así que
 * ningún dato llega a interpretarse como HTML.
 * @param {string} tag Etiqueta, con clases opcionales: `"button.btn.primary"`.
 * @param {object} [attrs] Atributos (`dataset` se reparte en `data-*`).
 * @param {...(Node|string|number|null|false)} children Hijos; los falsos se omiten.
 * @returns {HTMLElement}
 */
function h(tag, attrs = {}, ...children) {
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
const money = (c) => `$${(c / 100).toFixed(2)}`;

/** Hoy en hora local, `YYYY-MM-DD` (no `toISOString()`, que es UTC). */
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Fecha y hora cortas para las marcas de tiempo del servidor. */
const when = (iso) => new Date(iso).toLocaleString("es-EC", { dateStyle: "short", timeStyle: "short" });

/** Indica si la sesión tiene la capacidad (Administración cuenta como todas). */
function can(cap) {
  const caps = state.me?.capabilities ?? [];
  return caps.includes(cap) || caps.includes("ADMINISTRACION");
}

/** Muestra un aviso breve. */
function toast(text, error = false) {
  const t = $("toast");
  t.textContent = text;
  t.className = error ? "toast error" : "toast";
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 4000);
}

/** Chip con el estado interno de un ejemplar. */
const statusChip = (s) => h(`span.chip${STATUS_TONE[s] ? `.${STATUS_TONE[s]}` : ""}`, {}, STATUS_LABEL[s] ?? s);

/* ---------- API ---------- */

/**
 * Llama a la API del mismo origen con la sesión. Un 401 cierra la sesión: el
 * token venció o lo revocaron, y seguir enseñando datos sería engañoso.
 * @param {string} path Ruta, p. ej. `/api/admin/orders`.
 * @param {object} [opts] `method` y `body` (se envía como JSON).
 * @returns {Promise<any>} Cuerpo de la respuesta.
 */
async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && state.token) {
    signOut(false);
    throw new Error("La sesión venció; vuelve a entrar.");
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Error ${res.status}`);
  return data;
}

/**
 * Ejecuta una acción del panel, avisa del resultado y recarga la pestaña.
 * @param {() => Promise<any>} fn Acción.
 * @param {string} ok Mensaje de éxito.
 */
async function act(fn, ok) {
  try {
    await fn();
    toast(ok);
    await loadTab();
  } catch (err) {
    toast(err.message, true);
  }
}

/* ---------- sesión ---------- */

/** Recibe la credencial de Google y la cambia por una sesión del servidor. */
async function onGoogleCredential({ credential }) {
  $("login-msg").textContent = "";
  try {
    const { token } = await api("/api/auth/google", { method: "POST", body: { credential } });
    state.token = token;
    try { sessionStorage.setItem(SESSION_KEY, token); } catch { /* sin almacenamiento: dura la pestaña */ }
    await enter();
  } catch (err) {
    $("login-msg").textContent = err.message;
  }
}

/** Carga quién es la sesión y abre el panel, o explica por qué no. */
async function enter() {
  state.me = await api("/api/me");
  if (!state.me.capabilities.length) {
    // Una cuenta de cliente no tiene nada que hacer aquí, pero su sesión es
    // válida en la app: se revoca solo la de esta pestaña.
    await signOut(true);
    $("login-msg").textContent = "Esta cuenta no es del personal del local.";
    return;
  }
  $("login").hidden = true;
  renderWho();
  renderTabs();
  await openTab(tabs()[0]?.id);
}

/**
 * Cierra la sesión del panel.
 * @param {boolean} revoke Si además se revoca en el servidor.
 */
async function signOut(revoke = true) {
  if (revoke && state.token) await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  state.token = null;
  state.me = null;
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* nada que borrar */ }
  $("tabs").hidden = true;
  $("who").replaceChildren();
  $("view").replaceChildren();
  $("login").hidden = false;
  initGoogle();
}

/** Inicializa Google Identity en cuanto el SDK (async) esté cargado. */
function initGoogle(tries = 0) {
  if (initGoogle.done) return;
  if (!window.google?.accounts?.id) {
    if (tries > 50) {
      $("login-msg").textContent = "No se pudo cargar el inicio de sesión de Google.";
      return;
    }
    setTimeout(() => initGoogle(tries + 1), 100);
    return;
  }
  initGoogle.done = true;
  google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onGoogleCredential });
  google.accounts.id.renderButton($("gsi-button"), { theme: "outline", size: "large", text: "signin_with" });
}

/* ---------- cabecera y pestañas ---------- */

/** Pestañas visibles según las capacidades de la sesión. */
function tabs() {
  return [
    { id: "orders", label: "Pedidos", show: can("MOSTRADOR") || can("CAJA") },
    { id: "items", label: "Ejemplares", show: can("MOSTRADOR") || can("INVENTARIO") },
    { id: "stragglers", label: "Rezagadas", show: can("MOSTRADOR") },
  ].filter((t) => t.show);
}

/** Pinta quién está dentro y el botón de salir. */
function renderWho() {
  $("who").replaceChildren(
    h("span", {}, state.me.name || state.me.email),
    h("button.btn", { type: "button", dataset: { action: "sign-out" } }, "Salir"),
  );
}

/** Pinta la barra de pestañas, con el número de rezagadas si ya se conoce. */
function renderTabs() {
  const nav = $("tabs");
  const rezagadas = state.stragglers
    ? state.stragglers.notReceived.length + state.stragglers.receivedNotWashed.length + state.stragglers.inLaundry.length
    : 0;
  nav.replaceChildren(...tabs().map((t) => h(
    "button",
    { type: "button", role: "tab", "aria-selected": String(state.tab === t.id), dataset: { action: "tab", tab: t.id } },
    t.label,
    t.id === "stragglers" && rezagadas > 0 ? h("span.count", {}, rezagadas) : null,
  )));
  nav.hidden = false;
}

/** Cambia de pestaña y la carga. */
async function openTab(id) {
  if (!id) {
    $("view").replaceChildren(h("p.empty", {}, "Tu cuenta no tiene ninguna capacidad con pestaña en el panel todavía."));
    return;
  }
  state.tab = id;
  renderTabs();
  await loadTab();
}

/** Recarga los datos de la pestaña abierta y la vuelve a pintar. */
async function loadTab() {
  try {
    if (state.tab === "orders") state.orders = await api("/api/admin/orders");
    if (state.tab === "items") state.items = await api("/api/admin/items");
    // Las rezagadas se piden siempre que se pueda: alimentan el número de la pestaña.
    if (can("MOSTRADOR")) state.stragglers = await api("/api/admin/stragglers");
  } catch (err) {
    toast(err.message, true);
    return;
  }
  renderTabs();
  render();
}

/** Pinta la pestaña abierta. */
function render() {
  const view = { orders: renderOrders, items: renderItems, stragglers: renderStragglers }[state.tab];
  $("view").replaceChildren(...(view ? view() : []));
}

/** Barra de búsqueda compartida por Pedidos y Ejemplares. */
function searchBar(placeholder) {
  return h("div.bar", {},
    h("input", { type: "search", placeholder, value: state.filter, "aria-label": placeholder, dataset: { action: "filter" } }),
    h("button.btn", { type: "button", dataset: { action: "reload" } }, "Actualizar"),
  );
}

/** Indica si un texto contiene el filtro, sin distinguir mayúsculas. */
const matches = (...texts) => {
  const f = state.filter.trim().toLowerCase();
  return !f || texts.some((t) => String(t ?? "").toLowerCase().includes(f));
};

/* ---------- Pedidos ---------- */

/** Pestaña de pedidos en curso. */
function renderOrders() {
  const lista = state.orders.filter((o) => matches(
    `#${o.id}`, o.customer.name, o.customer.email, ...o.lines.flatMap((l) => [l.code, l.productName]),
  ));
  return [
    h("h2", {}, "Pedidos en curso ", h("small", {}, "con prendas por recibir, cobro pendiente o garantía retenida")),
    searchBar("Buscar por #pedido, cliente, código o prenda"),
    lista.length ? h("div.cards", {}, lista.map(orderCard)) : h("p.empty", {}, "No hay pedidos en curso."),
  ];
}

/** Tarjeta de un pedido con sus prendas, su dinero y sus acciones. */
function orderCard(o) {
  const pendienteCents = o.charges.filter((c) => c.status === "PENDING").reduce((s, c) => s + c.amountCents, 0);
  const porRecibir = o.lines.filter((l) => !l.receivedAt);
  const recibible = porRecibir.some((l) => l.status === "EN_ALQUILER");
  const hoy = todayISO();
  const vencido = porRecibir.length > 0 && o.returnBy < hoy;

  return h("article.card", {},
    h("header", {},
      h("h3", {}, `#${o.id} · ${o.customer.name || o.customer.email}`),
      vencido ? h("span.chip.bad", {}, "Vencido") : null,
    ),
    h("div.meta", {}, o.customer.email),
    h("div.meta", {},
      `${o.delivery === "ship" ? "Envío" : "Retira"} ${o.start} · elige devolver ${o.end} · límite sin costo ${o.returnBy}`),
    h("div.meta", {}, `${o.ret === "home" ? "Retiro a domicilio" : "Devuelve en el local"} · ${PAY_LABEL[o.pay] ?? o.pay}`),
    h("ul.lines", {}, o.lines.map((l) => h("li", {},
      h("span", {}, `${l.productName} `, h("span.meta", {}, `${l.code ?? `#${l.itemId}`} · ${l.size} · ${l.color}`)),
      h("span", {},
        l.receivedAt ? h("span.chip", { title: `Registrada ${when(l.receivedAt)}` }, `Volvió ${l.returnedOn}`) : statusChip(l.status),
        " ",
        !l.receivedAt && l.status === "RESERVADA" && can("MOSTRADOR")
          ? h("button.btn", { type: "button", disabled: o.start > hoy || null, title: o.start > hoy ? `Se entrega desde el ${o.start}` : null, dataset: { action: "deliver", item: l.itemId } }, "Entregar")
          : null,
      ),
    ))),
    h("dl.money", {},
      h("dt", {}, "Total del pedido"), h("dd", {}, money(o.totalCents)),
      h("dt", {}, "Pendiente de cobro"), h("dd", {}, money(pendienteCents)),
      h("dt", {}, "Garantía retenida"), h("dd", {}, money(o.depositHeldCents)),
    ),
    h("div.actions", {},
      recibible && can("MOSTRADOR")
        ? h("button.btn.primary", { type: "button", dataset: { action: "receive", order: o.id } }, "Registrar devolución") : null,
      pendienteCents > 0 && can("CAJA")
        ? h("button.btn", { type: "button", dataset: { action: "settle", order: o.id } }, `Confirmar cobro de ${money(pendienteCents)}`) : null,
      o.depositHeldCents > 0 && porRecibir.length === 0 && can("CAJA")
        ? h("button.btn", { type: "button", dataset: { action: "release", order: o.id } }, "Liberar garantía") : null,
      can("ADMINISTRACION")
        ? h("button.btn.danger", { type: "button", dataset: { action: "cancel", order: o.id } }, "Anular") : null,
    ),
  );
}

/**
 * Abre un diálogo modal con un formulario y resuelve con sus datos, o con null
 * si se cancela.
 * @param {string} title Título.
 * @param {Node[]} fields Campos del formulario.
 * @param {string} submit Texto del botón de confirmar.
 * @returns {Promise<FormData|null>}
 */
function formDialog(title, fields, submit) {
  return new Promise((resolve) => {
    const form = h("form", { method: "dialog" },
      h("h3", {}, title),
      ...fields,
      h("div.actions", {},
        h("button.btn", { type: "button", value: "cancel" }, "Cancelar"),
        h("button.btn.primary", { type: "submit" }, submit),
      ),
    );
    const dlg = h("dialog", {}, form);
    let datos = null;
    form.querySelector('button[value="cancel"]').addEventListener("click", () => dlg.close());
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      datos = new FormData(form);
      dlg.close();
    });
    dlg.addEventListener("close", () => { dlg.remove(); resolve(datos); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

/** Diálogo de recepción: qué prendas, qué día volvieron de verdad y observación. */
async function receiveOrder(id) {
  const o = state.orders.find((x) => x.id === id);
  const recibibles = o.lines.filter((l) => !l.receivedAt && l.status === "EN_ALQUILER");
  const datos = await formDialog(`Devolución del pedido #${id}`, [
    h("p.meta", {}, `Límite sin costo: ${o.returnBy}. Los días hábiles después se cobran como días extra.`),
    h("label", {}, "Día en que volvió de verdad",
      h("input", { type: "date", name: "returnedOn", required: true, value: todayISO(), max: todayISO(), min: o.start })),
    h("fieldset", {}, h("legend", {}, "Prendas que volvieron"),
      recibibles.map((l) => h("label", {},
        h("input", { type: "checkbox", name: "item", value: l.itemId, checked: true }),
        ` ${l.productName} (${l.code ?? `#${l.itemId}`})`,
      ))),
    h("label", {}, "Observación (opcional)", h("textarea", { name: "note", maxlength: 500, rows: 2 })),
  ], "Registrar");
  if (!datos) return;
  const itemIds = datos.getAll("item").map(Number);
  if (!itemIds.length) return toast("Marca al menos una prenda.", true);
  await act(
    () => api(`/api/orders/${id}/receive`, {
      method: "POST",
      body: { returnedOn: datos.get("returnedOn"), itemIds, note: datos.get("note") || undefined },
    }),
    "Devolución registrada.",
  );
}

/** Pide una confirmación con nota opcional; null si se cancela. */
async function confirmWithNote(title, text, submit, noteRequired = false) {
  const datos = await formDialog(title, [
    h("p", {}, text),
    h("label", {}, noteRequired ? "Motivo" : "Observación (opcional)",
      h("textarea", { name: "note", maxlength: 500, rows: 2, required: noteRequired || null })),
  ], submit);
  return datos ? { note: datos.get("note") || undefined } : null;
}

/* ---------- Ejemplares ---------- */

/** Pestaña de ejemplares con su estado interno. */
function renderItems() {
  const lista = state.items.filter((i) => matches(i.code, i.productName, STATUS_LABEL[i.status], i.color, i.size));
  return [
    h("h2", {}, "Ejemplares ", h("small", {}, `${state.items.length} en total`)),
    searchBar("Buscar por código, prenda, estado, talla o color"),
    h("div.table-wrap", {}, h("table", {},
      h("thead", {}, h("tr", {}, ["Código", "Prenda", "Talla · color", "Estado", "Desde", ""].map((t) => h("th", {}, t)))),
      h("tbody", {}, lista.map((i) => h("tr", {},
        h("td", {}, i.code ?? h("span.meta", {}, `demo #${i.id}`)),
        h("td", {}, i.productName),
        h("td", {}, `${i.size} · ${i.color}`),
        h("td", {}, statusChip(i.status),
          i.laundryPlace ? h("div.meta", {}, `${i.laundryKind === "EXTERNO" ? "Externo" : "Propio"}: ${i.laundryPlace}`) : null,
          i.unrentableReason ? h("div.meta", {}, i.unrentableReason === "RETIRADA" ? "Retirada" : "Desperfecto") : null),
        h("td", {}, when(i.statusSince)),
        h("td", {},
          h("button.btn", { type: "button", dataset: { action: "log", item: i.id } }, "Bitácora"), " ",
          can("MOSTRADOR") && i.next.length
            ? h("button.btn", { type: "button", dataset: { action: "move", item: i.id } }, "Cambiar estado") : null),
      ))),
    )),
  ];
}

/** Diálogo de cambio manual de estado; los datos obligatorios los valida el servidor. */
async function moveItem(id) {
  const it = state.items.find((x) => x.id === id);
  const destino = h("select", { name: "to", required: true },
    it.next.map((s) => h("option", { value: s }, STATUS_LABEL[s])));
  const lavado = h("div", {},
    h("label", {}, "Quién lava", h("select", { name: "kind" },
      h("option", { value: "PROPIO" }, "Propio"), h("option", { value: "EXTERNO" }, "Externo"))),
    h("label", {}, "Dónde está la prenda", h("input", { name: "place", maxlength: 120, placeholder: "Local, o nombre de la lavandería" })),
  );
  const motivo = h("label", {}, "Motivo", h("select", { name: "reason" },
    h("option", { value: "DESPERFECTO" }, "Desperfecto"),
    can("ADMINISTRACION") ? h("option", { value: "RETIRADA" }, "Retirada del inventario") : null));
  // Solo se enseñan los campos que pide el destino elegido.
  const sync = () => {
    lavado.hidden = destino.value !== "EN_LAVADO";
    motivo.hidden = destino.value !== "NO_ALQUILABLE";
  };
  destino.addEventListener("change", sync);
  sync();

  const datos = await formDialog(`${it.productName} (${it.code ?? `#${it.id}`})`, [
    h("p.meta", {}, "Ahora: ", statusChip(it.status)),
    h("label", {}, "Pasar a", destino),
    lavado,
    motivo,
    h("label", {}, "Observación", h("textarea", { name: "note", maxlength: 500, rows: 2 })),
  ], "Guardar");
  if (!datos) return;
  const to = datos.get("to");
  await act(() => api(`/api/items/${id}/status`, {
    method: "POST",
    body: {
      to,
      note: datos.get("note") || undefined,
      ...(to === "EN_LAVADO" ? { laundry: { kind: datos.get("kind"), place: datos.get("place") } } : {}),
      ...(to === "NO_ALQUILABLE" ? { reason: datos.get("reason") } : {}),
    },
  }), "Estado actualizado.");
}

/** Muestra la bitácora de un ejemplar, de lo más reciente a lo más viejo. */
async function showLog(id) {
  let ficha;
  try { ficha = await api(`/api/items/${id}`); } catch (err) { return toast(err.message, true); }
  await formDialog(`Bitácora de ${ficha.product.name} (${ficha.code ?? `#${ficha.id}`})`, [
    ficha.logs.length ? h("ul.lines", {}, ficha.logs.map((l) => h("li", {},
      h("span", {},
        h("strong", {}, l.from ? `${STATUS_LABEL[l.from]} → ${STATUS_LABEL[l.to]}` : `Alta: ${STATUS_LABEL[l.to]}`),
        l.note ? h("div.meta", {}, l.note) : null),
      h("span.meta", {}, `${when(l.createdAt)} · ${l.actor?.name ?? "sistema"}`),
    ))) : h("p.empty", {}, "Sin entradas."),
  ], "Cerrar");
}

/* ---------- Rezagadas ---------- */

/** Pestaña de rezagadas: lo que debió moverse y nadie movió (§3). */
function renderStragglers() {
  const s = state.stragglers ?? { notReceived: [], receivedNotWashed: [], inLaundry: [] };
  const tabla = (cols, filas) => filas.length
    ? h("div.table-wrap", {}, h("table", {},
      h("thead", {}, h("tr", {}, cols.map((c) => h("th", {}, c)))),
      h("tbody", {}, filas.map((f) => h("tr", {}, f.map((c) => h("td", {}, c))))),
    ))
    : h("p.empty", {}, "Nada pendiente aquí.");
  const prenda = (r) => `${r.productName} (${r.code ?? `#${r.itemId}`})`;
  return [
    h("h2", {}, "Vencidas sin recibir ", h("small", {}, "pasó la fecha límite y nadie registró la devolución")),
    tabla(["Pedido", "Cliente", "Prenda", "Límite", "Días", "Estado"],
      s.notReceived.map((r) => [`#${r.orderId}`, r.customer, prenda(r), r.returnBy, r.daysLate, statusChip(r.status)])),
    h("h2", {}, "Recibidas sin lavar ", h("small", {}, "más de 1 día recibidas y siguen En alquiler")),
    tabla(["Pedido", "Prenda", "Recibida"],
      s.receivedNotWashed.map((r) => [`#${r.orderId}`, prenda(r), when(r.receivedAt)])),
    h("h2", {}, "En lavado ", h("small", {}, "más de 2 días sin salir")),
    tabla(["Prenda", "Desde", "Dónde"],
      s.inLaundry.map((r) => [prenda(r), when(r.since), `${r.laundryKind === "EXTERNO" ? "Externo" : "Propio"}: ${r.laundryPlace ?? "—"}`])),
  ];
}

/* ---------- eventos (delegación) ---------- */

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.tagName === "INPUT") return;
  const order = Number(el.dataset.order);
  const item = Number(el.dataset.item);
  switch (el.dataset.action) {
    case "tab":
      state.filter = "";
      return openTab(el.dataset.tab);
    case "reload":
      return loadTab();
    case "sign-out":
      return signOut(true);
    case "deliver":
      return act(() => api(`/api/items/${item}/status`, { method: "POST", body: { to: "EN_ALQUILER", note: "Entregada al cliente" } }), "Prenda entregada.");
    case "receive":
      return receiveOrder(order);
    case "settle": {
      const ok = await confirmWithNote("Confirmar cobro", `¿Entró el dinero pendiente del pedido #${order}?`, "Confirmar");
      return ok && act(() => api(`/api/orders/${order}/settle`, { method: "POST", body: ok }), "Cobro confirmado.");
    }
    case "release": {
      const ok = await confirmWithNote("Liberar garantía", `Se devuelve toda la garantía del pedido #${order} al cliente.`, "Liberar");
      return ok && act(() => api(`/api/orders/${order}/deposit-release`, { method: "POST", body: ok }), "Garantía liberada.");
    }
    case "cancel": {
      const ok = await confirmWithNote("Anular pedido", `Se anula el pedido #${order}: se revierten sus cargos y se liberan las prendas.`, "Anular", true);
      return ok && act(() => api(`/api/orders/${order}/cancel`, { method: "POST", body: ok }), "Pedido anulado.");
    }
    case "move":
      return moveItem(item);
    case "log":
      return showLog(item);
  }
});

document.addEventListener("input", (e) => {
  if (e.target.dataset?.action !== "filter") return;
  state.filter = e.target.value;
  const pos = e.target.selectionStart;
  render();
  // Repintar reemplaza el campo: se devuelve el foco y el cursor donde estaban.
  const campo = document.querySelector('[data-action="filter"]');
  campo?.focus();
  campo?.setSelectionRange(pos, pos);
});

/* ---------- arranque ---------- */

/** Reanuda la sesión de esta pestaña si la hay; si no, enseña el login. */
async function boot() {
  try { state.token = sessionStorage.getItem(SESSION_KEY); } catch { state.token = null; }
  if (state.token) {
    try {
      await enter();
      return;
    } catch {
      await signOut(false);
    }
  }
  $("login").hidden = false;
  initGoogle();
}

boot();
