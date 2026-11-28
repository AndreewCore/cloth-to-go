/**
 * Panel del local (fase 4). Módulo ES: a diferencia de la app, el panel siempre
 * se sirve desde la API por HTTP, así que no necesita abrirse por `file://`.
 *
 * Este archivo lleva la sesión, las pestañas de operación y los eventos; las
 * piezas comunes están en core.js, las fotos en photos.js y el catálogo en
 * catalog.js. Los permisos que aquí esconden botones son comodidad; la
 * comprobación real la hace cada ruta del servidor.
 */
import {
  $, PAY_LABEL, STATUS_LABEL, WEEKDAY, act, addDays, api, can, confirmWithNote, daysBetween, fmtDay,
  formDialog, h, holidayName, hooks, isOpen, isoDate, lateDays, money, relDays, since, state, statusChip,
  toast, todayISO, upload, when,
} from "./core.js";
import { photoButton, photoPicker, showPhotos, thumb } from "./photos.js";
import { catalogClick, loadCatalog, renderCatalog } from "./catalog.js";
import { loadTaxonomyAdmin, renderTaxonomy, taxonomyClick } from "./taxonomy.js";
import { activityClick, loadActivity, renderActivity, setActivityFilter } from "./activity.js";
import { calendarClick, calendarSubmit, loadCalendar, renderCalendar } from "./calendar.js";
import { loadModeration, moderationClick, pendingReviews, renderModeration } from "./moderation.js";

/** Mismo cliente OAuth que la app y la web (js/auth.js): es público. */
const GOOGLE_CLIENT_ID = "115840486389-f3vitcouhua5eckn3grn1gk9kqb7ccjs.apps.googleusercontent.com";
/** sessionStorage y no localStorage: el panel se usa en equipos compartidos del local. */
const SESSION_KEY = "clothToGo:admin:session";

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
  // Sin calendario la tira de días asume solo fines de semana cerrados.
  state.calendar = await api("/api/config").catch(() => null);
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
    { id: "catalog", label: "Catálogo", show: can("INVENTARIO") },
    { id: "taxonomy", label: "Taxonomía", show: can("INVENTARIO") },
    { id: "calendar", label: "Calendario", show: can("ADMINISTRACION") },
    { id: "reviews", label: "Reseñas", show: can("MODERACION") },
    // Al extremo derecho: no es una tarea del día, es para revisar.
    { id: "activity", label: "Bitácora", show: can("ADMINISTRACION"), end: true },
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
    t.end ? "button.tab-end" : "button",
    { type: "button", role: "tab", "aria-selected": String(state.tab === t.id), dataset: { action: "tab", tab: t.id } },
    t.label,
    t.id === "stragglers" && rezagadas > 0 ? h("span.count", {}, rezagadas) : null,
    t.id === "reviews" && pendingReviews() > 0 ? h("span.count", {}, pendingReviews()) : null,
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
    if (state.tab === "catalog") await loadCatalog();
    if (state.tab === "taxonomy") await loadTaxonomyAdmin();
    if (state.tab === "activity") await loadActivity();
    if (state.tab === "calendar") await loadCalendar();
    if (state.tab === "reviews") await loadModeration();
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
  const view = {
    orders: renderOrders,
    items: renderItems,
    stragglers: renderStragglers,
    catalog: () => renderCatalog(searchBar, matches),
    taxonomy: renderTaxonomy,
    activity: renderActivity,
    calendar: renderCalendar,
    reviews: renderModeration,
  }[state.tab];
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
    stripLegend(),
    lista.length ? h("div.cards", {}, lista.map(orderCard)) : h("p.empty", {}, "No hay pedidos en curso."),
  ];
}

/** Celdas que caben en la tira antes de recortar el medio. */
const STRIP_MAX = 21;

/**
 * Tira de días del pedido: cada día es una casilla coloreada según la fase
 * (alquiler, margen sin costo, días extra), con los cerrados rayados y hoy
 * remarcado. Así el mostrador ve de un vistazo dónde está el pedido sin
 * comparar tres fechas de cabeza.
 * @param {object} o Pedido del panel.
 * @param {string|null} [returnedOn] Día de vuelta supuesto (vista previa al recibir).
 * @returns {HTMLElement}
 */
function dayStrip(o, returnedOn = null) {
  const hoy = todayISO();
  const porRecibir = o.lines.some((l) => !l.receivedAt);
  const volvio = o.lines.map((l) => l.returnedOn).filter(Boolean).sort().at(-1) ?? null;
  // Hasta dónde corren los días: el día que vuelve (o volvió) o, si sigue
  // fuera, hoy.
  const hasta = returnedOn ?? (porRecibir ? hoy : volvio);

  // Un pedido que empieza pronto enseña la espera desde hoy.
  const first = hoy < o.start && daysBetween(hoy, o.start) <= 7 ? hoy : o.start;
  const last = [o.returnBy, hasta].filter(Boolean).sort().at(-1);
  const dias = [];
  for (let d = first; d <= last && dias.length < 400; d = addDays(d, 1)) dias.push(d);
  const visibles = dias.length > STRIP_MAX ? [...dias.slice(0, 7), null, ...dias.slice(-(STRIP_MAX - 8))] : dias;

  // Si se retira y devuelve el mismo día, manda la entrega: la devolución que
  // importa es el límite, que va en su propia casilla.
  const marca = { [o.end]: "Devuelve" };
  marca[o.start] = o.delivery === "ship" ? "Envío" : "Retira";
  marca[o.returnBy] = "Límite";
  if (!porRecibir && volvio) marca[volvio] = "Volvió";
  if (returnedOn) marca[returnedOn] = "Vuelve";

  const fase = (d) => {
    if (d < o.start) return "antes";
    if (d <= o.end) return "alquiler";
    if (d <= o.returnBy) return "margen";
    return hasta && d <= hasta ? "extra" : "despues";
  };
  const celda = (d) => {
    if (!d) return h("li.gap", { "aria-hidden": "true" }, "…");
    const abierto = isOpen(d);
    const fer = holidayName(d);
    const clases = ["dia", fase(d), !abierto && "cerrado", d === hoy && "hoy"].filter(Boolean).join(".");
    const titulo = [fmtDay(d), marca[d], fer ?? (!abierto ? "local cerrado" : null), d === hoy ? "hoy" : null];
    return h(`li.${clases}`, { title: titulo.filter(Boolean).join(" · ") },
      h("span.wd", {}, WEEKDAY[isoDate(d).getUTCDay()]),
      h("span.num", {}, isoDate(d).getUTCDate()),
      h("span.tag", {}, marca[d] ?? ""),
    );
  };

  const resumen = stripSummary(o, { hoy, porRecibir, volvio, returnedOn });
  return h("div.timeline", {},
    h("ol.strip", { "aria-label": `Del ${fmtDay(o.start)} al ${fmtDay(o.returnBy)}, límite sin costo` }, visibles.map(celda)),
    h(`p.when${resumen.tone ? `.${resumen.tone}` : ""}`, {}, resumen.text),
  );
}

/**
 * Frase de una línea que dice en qué punto está el pedido.
 * @returns {{text: string, tone: string|null}}
 */
function stripSummary(o, { hoy, porRecibir, volvio, returnedOn }) {
  const extra = (hasta) => {
    const n = lateDays(o.returnBy, hasta);
    return n ? ` · ${n} día${n === 1 ? "" : "s"} hábil${n === 1 ? "" : "es"} extra` : "";
  };
  if (returnedOn) {
    const n = lateDays(o.returnBy, returnedOn);
    return n ? { text: `Vuelve tarde${extra(returnedOn)}: se cobran al registrar.`, tone: "bad" } : { text: "A tiempo: sin días extra.", tone: "ok" };
  }
  if (!porRecibir) return { text: `Volvió el ${fmtDay(volvio)}${extra(volvio)}`, tone: null };
  if (hoy < o.start) return { text: `Empieza ${relDays(o.start)} (${fmtDay(o.start)})`, tone: null };
  if (hoy < o.end) {
    return { text: `Día ${daysBetween(o.start, hoy) + 1} de ${daysBetween(o.start, o.end)} · devuelve ${relDays(o.end)}`, tone: null };
  }
  if (hoy <= o.returnBy) {
    return { text: hoy === o.returnBy ? "Hoy es el último día sin costo." : `Sin costo hasta el ${fmtDay(o.returnBy)}`, tone: "warn" };
  }
  return { text: `Vencido desde el ${fmtDay(o.returnBy)}${extra(hoy)} hasta hoy`, tone: "bad" };
}

/** Leyenda de colores de la tira de días. */
function stripLegend() {
  const item = (cls, text) => h("span", {}, h(`i.sw.${cls}`, { "aria-hidden": "true" }), text);
  return h("p.legend", {},
    item("alquiler", "Alquiler"), item("margen", "Margen sin costo"), item("extra", "Días extra"),
    item("cerrado", "Local cerrado"), item("hoy", "Hoy"));
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
      `${o.delivery === "ship" ? "Envío a domicilio" : "Retira en el local"} · ${o.ret === "home" ? "retiro a domicilio" : "devuelve en el local"} · ${PAY_LABEL[o.pay] ?? o.pay}`),
    dayStrip(o),
    h("ul.lines", {}, o.lines.map((l) => h("li", {},
      h("span", {}, `${l.productName} `, h("span.meta", {}, `${l.code ?? `#${l.itemId}`} · ${l.size} · ${l.color}`)),
      h("span.line-actions", {},
        photoButton(l.itemId),
        " ",
        l.receivedAt ? h("span.chip", { title: `Registrada ${when(l.receivedAt)}` }, `Volvió ${fmtDay(l.returnedOn)}`) : statusChip(l.status),
        " ",
        !l.receivedAt && l.status === "RESERVADA" && can("MOSTRADOR")
          ? h("button.btn", { type: "button", disabled: o.start > hoy || null, title: o.start > hoy ? `Se entrega desde el ${fmtDay(o.start)}` : null, dataset: { action: "deliver", order: o.id, item: l.itemId } }, "Entregar")
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

/** Diálogo de recepción: qué prendas, qué día volvieron de verdad y observación. */
async function receiveOrder(id) {
  const o = state.orders.find((x) => x.id === id);
  const recibibles = o.lines.filter((l) => !l.receivedAt && l.status === "EN_ALQUILER");
  const fecha = h("input", { type: "date", name: "returnedOn", required: true, value: todayISO(), max: todayISO(), min: o.start });
  const vista = h("div", {}, dayStrip(o, fecha.value));
  // Vista previa: la tira se rehace con el día elegido para ver los días extra
  // antes de registrar. El importe lo decide el servidor.
  fecha.addEventListener("input", () => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(fecha.value)) vista.replaceChildren(dayStrip(o, fecha.value));
  });
  // Una tanda de fotos por prenda: así cada foto queda atada a su ejemplar y
  // se puede comparar con las de su salida.
  const fichas = recibibles.map((l) => ({ l, picker: photoPicker({ label: "Fotos de cómo llegó" }) }));
  const marcadas = (form) => new Set(new FormData(form).getAll("item").map(Number));
  const datos = await formDialog(`Devolución del pedido #${id}`, [
    h("p.meta", {}, `Límite sin costo: ${fmtDay(o.returnBy)}. Los días hábiles después se cobran como días extra.`),
    h("label", {}, "Día en que volvió de verdad", fecha),
    vista,
    h("fieldset", {}, h("legend", {}, "Prendas que volvieron"),
      fichas.map(({ l, picker }) => h("div.receive-item", {},
        h("label.check", {},
          h("input", { type: "checkbox", name: "item", value: l.itemId, checked: true }),
          thumb(l.imgs),
          ` ${l.productName} (${l.code ?? `#${l.itemId}`})`),
        h("div.receive-photos", {},
          h("button.btn.small", { type: "button", dataset: { action: "photos", item: l.itemId } }, "Ver cómo salió"),
          picker.el),
      ))),
    h("label", {}, "Observación (opcional)", h("textarea", { name: "note", maxlength: 500, rows: 2 })),
  ], "Registrar", {
    wide: true,
    validate: (form) => {
      const elegidas = marcadas(form);
      if (!elegidas.size) return "Marca al menos una prenda.";
      const sinFoto = fichas.find(({ l, picker }) => elegidas.has(l.itemId) && !picker.count());
      return sinFoto ? `Falta al menos una foto de cómo llegó ${sinFoto.l.productName}.` : null;
    },
  });
  try {
    if (!datos) return;
    const itemIds = datos.getAll("item").map(Number);
    // Las fotos primero: si la subida falla, no queda registrada una
    // devolución sin su prueba, y se puede reintentar entera.
    for (const { l, picker } of fichas.filter(({ l: x }) => itemIds.includes(x.itemId))) {
      await upload(`/api/items/${l.itemId}/photos`, await picker.files(), { kind: "LLEGADA", orderId: String(id) });
    }
    await act(
      () => api(`/api/orders/${id}/receive`, {
        method: "POST",
        body: { returnedOn: datos.get("returnedOn"), itemIds, note: datos.get("note") || undefined },
      }),
      "Devolución registrada con sus fotos.",
    );
  } catch (err) {
    toast(err.message, true);
  } finally {
    fichas.forEach(({ picker }) => picker.dispose());
  }
}

/**
 * Entrega una prenda: pide fotos de cómo sale (son la referencia con la que
 * se comparará al volver) y la pasa a En Alquiler.
 * @param {number} orderId Pedido.
 * @param {number} itemId Ejemplar.
 */
async function deliverItem(orderId, itemId) {
  const l = state.orders.find((o) => o.id === orderId)?.lines.find((x) => x.itemId === itemId);
  const picker = photoPicker({ label: "Fotos de cómo sale" });
  const datos = await formDialog(`Entregar ${l?.productName ?? "prenda"} (${l?.code ?? `#${itemId}`})`, [
    h("p.meta", {}, "Fotografía la prenda tal como sale: de frente, de espalda y cualquier detalle (manchas, botones, costuras). Es lo que se compara cuando vuelva."),
    h("button.btn.small", { type: "button", dataset: { action: "photos", item: itemId } }, "Ver fotos del catálogo"),
    picker.el,
  ], "Entregar", { wide: true, validate: () => (picker.count() ? null : "Saca al menos una foto de cómo sale.") });
  try {
    if (!datos) return;
    await upload(`/api/items/${itemId}/photos`, await picker.files(), { kind: "SALIDA", orderId: String(orderId) });
    await act(
      () => api(`/api/items/${itemId}/status`, { method: "POST", body: { to: "EN_ALQUILER", note: "Entregada al cliente" } }),
      "Prenda entregada con sus fotos.",
    );
  } catch (err) {
    toast(err.message, true);
  } finally {
    picker.dispose();
  }
}

/* ---------- Ejemplares ---------- */

/** Pestaña de ejemplares con su estado interno. */
function renderItems() {
  const lista = state.items.filter((i) => matches(i.code, i.productName, STATUS_LABEL[i.status], i.color, i.size));
  return [
    h("h2", {}, "Ejemplares ", h("small", {}, `${state.items.length} en total`)),
    searchBar("Buscar por código, prenda, estado, talla o color"),
    h("div.table-wrap", {}, h("table", {},
      h("thead", {}, h("tr", {}, ["", "Código", "Prenda", "Talla · color", "Estado", "Desde", ""].map((t) => h("th", {}, t)))),
      h("tbody", {}, lista.map((i) => h("tr", {},
        h("td.thumb-cell", {}, thumb(i.imgs)),
        h("td", {}, i.code ?? h("span.meta", {}, `demo #${i.id}`)),
        h("td", {}, i.productName),
        h("td", {}, `${i.size} · ${i.color}`),
        h("td", {}, statusChip(i.status),
          i.laundryPlace ? h("div.meta", {}, `${i.laundryKind === "EXTERNO" ? "Externo" : "Propio"}: ${i.laundryPlace}`) : null,
          i.unrentableReason ? h("div.meta", {}, i.unrentableReason === "RETIRADA" ? "Retirada" : "Desperfecto") : null),
        h("td", {}, since(i.statusSince)),
        h("td.row-actions", {},
          photoButton(i.id), " ",
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
  ], "Cerrar", { cancel: false });
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
  const prenda = (r) => h("span.line-actions", {}, `${r.productName} (${r.code ?? `#${r.itemId}`}) `, photoButton(r.itemId));
  return [
    h("h2", {}, "Vencidas sin recibir ", h("small", {}, "pasó la fecha límite y nadie registró la devolución")),
    // Días hábiles, como los cobra la recepción: los naturales asustarían de más.
    tabla(["Pedido", "Cliente", "Prenda", "Límite", "Días hábiles extra", "Estado"],
      s.notReceived.map((r) => [`#${r.orderId}`, r.customer, prenda(r), fmtDay(r.returnBy), lateDays(r.returnBy, todayISO()), statusChip(r.status)])),
    h("h2", {}, "Recibidas sin lavar ", h("small", {}, "más de 1 día recibidas y siguen En alquiler")),
    tabla(["Pedido", "Prenda", "Recibida"],
      s.receivedNotWashed.map((r) => [`#${r.orderId}`, prenda(r), since(r.receivedAt)])),
    h("h2", {}, "En lavado ", h("small", {}, "más de 2 días sin salir")),
    tabla(["Prenda", "Desde", "Dónde"],
      s.inLaundry.map((r) => [prenda(r), since(r.since), `${r.laundryKind === "EXTERNO" ? "Externo" : "Propio"}: ${r.laundryPlace ?? "—"}`])),
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
      return deliverItem(order, item);
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
    case "photos":
      return showPhotos(item);
    default:
      if (!catalogClick(el) && !taxonomyClick(el) && !calendarClick(el) && !moderationClick(el, render)) activityClick(el, render);
  }
});

// Los desplegables de filtros del catálogo: repintar no pierde nada, porque
// el valor elegido vive en `state` y el desplegable se vuelve a pintar con él.
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset?.action === "activity-filter") {
    // La bitácora se filtra en el servidor: recarga y devuelve el foco.
    setActivityFilter(el.dataset.key, el.value, () => {
      render();
      document.querySelector(`[data-action="activity-filter"][data-key="${el.dataset.key}"]`)?.focus();
    });
    return;
  }
  if (el.dataset?.action !== "catalog-filter") return;
  state.catalogFilters = { ...state.catalogFilters, [el.dataset.key]: el.value };
  render();
  document.querySelector(`[data-action="catalog-filter"][data-key="${el.dataset.key}"]`)?.focus();
});

// Formularios que viven en la pestaña (no en un diálogo): el horario.
document.addEventListener("submit", (e) => calendarSubmit(e));

// Texto de la bitácora: espera a que se deje de escribir, para no pedir una
// página por cada tecla.
let activityTimer;
document.addEventListener("input", (e) => {
  if (e.target.dataset?.action !== "activity-q") return;
  const valor = e.target.value;
  clearTimeout(activityTimer);
  activityTimer = setTimeout(() => setActivityFilter("q", valor, () => {
    render();
    const campo = document.querySelector('[data-action="activity-q"]');
    campo?.focus();
    campo?.setSelectionRange(valor.length, valor.length);
  }), 350);
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

// Lo que core.js y catalog.js piden de aquí sin importarlo.
hooks.unauthorized = () => signOut(false);
hooks.reload = loadTab;
hooks.render = render;

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
