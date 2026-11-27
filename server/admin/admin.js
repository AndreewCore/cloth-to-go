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
  $, PAY_LABEL, STATUS_LABEL, WEEKDAY, act, addDays, amt, api, can, garment, joinParts, confirmWithNote, daysBetween, fmtDay,
  formDialog, h, holidayName, hooks, isOpen, isoDate, lateDays, localISO, money, relDays, since, state, statusChip,
  toast, todayISO, upload, when,
} from "./core.js";
import { photoButton, photoPicker, showPhotos, thumb } from "./photos.js";
import { catalogClick, loadCatalog, renderCatalog } from "./catalog.js";
import { loadTaxonomyAdmin, renderTaxonomy, taxonomyClick } from "./taxonomy.js";
import { activityClick, entryRow, loadActivity, renderActivity, setActivityFilter } from "./activity.js";
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
    // Lo primero al entrar: lo que hay que hacer hoy y lo vencido sin registrar.
    { id: "today", label: "Hoy", show: can("MOSTRADOR") || can("CAJA") },
    { id: "orders", label: "Pedidos", show: can("MOSTRADOR") || can("CAJA") },
    { id: "items", label: "Ejemplares", show: can("MOSTRADOR") || can("INVENTARIO") },
    { id: "catalog", label: "Catálogo", show: can("INVENTARIO") },
    { id: "taxonomy", label: "Taxonomía", show: can("INVENTARIO") },
    { id: "calendar", label: "Calendario", show: can("ADMINISTRACION") },
    { id: "reviews", label: "Reseñas", show: can("MODERACION") },
    { id: "activity", label: "Bitácora", show: can("ADMINISTRACION") },
  ].filter((t) => t.show);
}

/** Pinta quién está dentro y el botón de salir. */
function renderWho() {
  $("who").replaceChildren(
    h("span", {}, state.me.name || state.me.email),
    h("button.btn", { type: "button", dataset: { action: "sign-out" } }, "Salir"),
  );
}

/** Pinta la barra de pestañas, con lo urgente de «Hoy» si ya se conoce. */
function renderTabs() {
  const nav = $("tabs");
  const urgentes = state.today?.urgent ?? 0;
  nav.replaceChildren(...tabs().map((t) => h(
    "button",
    { type: "button", role: "tab", "aria-selected": String(state.tab === t.id), dataset: { action: "tab", tab: t.id } },
    t.label,
    t.id === "today" && urgentes > 0 ? h("span.count", { title: "Vencido sin registrar" }, urgentes) : null,
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
    if (state.tab === "orders") {
      [state.orders, state.history] = await Promise.all([
        api("/api/admin/orders"),
        api(`/api/admin/orders?scope=history&days=${state.historyDays}`),
      ]);
    }
    if (state.tab === "items") state.items = await api("/api/admin/items");
    if (state.tab === "catalog") await loadCatalog();
    if (state.tab === "taxonomy") await loadTaxonomyAdmin();
    if (state.tab === "activity") await loadActivity();
    if (state.tab === "calendar") await loadCalendar();
    if (state.tab === "reviews") await loadModeration();
    // «Hoy» se pide siempre que se pueda: alimenta el número rojo de la pestaña.
    if (can("MOSTRADOR") || can("CAJA")) state.today = await api("/api/admin/today");
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
    today: renderToday,
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

/** Indica si un pedido coincide con la búsqueda de la pestaña. */
const orderMatches = (o) => matches(
  `#${o.id}`, o.customer.name, o.customer.email, ...o.lines.flatMap((l) => [l.code, l.productName]),
);

/** Pestaña de pedidos: los que están en curso y, debajo, los que ya terminaron. */
function renderOrders() {
  const lista = state.orders.filter(orderMatches);
  const hist = state.history ?? { days: state.historyDays, orders: [], hasMore: false };
  const terminados = hist.orders.filter(orderMatches);
  return [
    h("h2", {}, "Pedidos en curso ", h("small", {}, "con prendas por recibir, cobro pendiente o garantía retenida")),
    searchBar("Buscar por #pedido, cliente, código o prenda"),
    stripLegend(),
    lista.length ? h("div.cards", {}, lista.map(orderCard)) : h("p.empty", {}, "No hay pedidos en curso."),
    h("h2", {}, "Terminados recientemente ", h("small", {}, `cerrados o anulados en los últimos ${hist.days} días`)),
    terminados.length
      ? h("div.cards", {}, terminados.map(historyCard))
      : h("p.empty", {}, state.filter ? "Ningún pedido terminado coincide con la búsqueda." : "Ningún pedido terminó en estos días."),
    hist.hasMore ? h("div.bar", {}, h("button.btn", { type: "button", dataset: { action: "history-more" } }, `Ver ${HISTORY_STEP} días más`)) : null,
  ];
}

/** Días que suma cada «Ver más» del historial. */
const HISTORY_STEP = 30;

/**
 * Tarjeta compacta de un pedido terminado: quién, qué prendas, cuándo, cuánto
 * y cómo acabó. El detalle está en «Ver recorrido».
 */
function historyCard(o) {
  const anulado = Boolean(o.cancelledAt);
  return h("article.card.history-card", {},
    h("header", {},
      h("h3", {}, `#${o.id} · `, customerLink(o)),
      h(`span.chip${anulado ? ".bad" : ""}`, {}, anulado ? "Anulado" : "Cerrado")),
    h("div.meta", {}, `Del ${fmtDay(o.start)} al ${fmtDay(o.returnBy)} · terminó `, since(o.finishedAt)),
    h("ul.lines", {}, o.lines.map((l) => h("li", {},
      h("span", {}, `${l.productName} `, h("span.meta", {}, l.code ?? `#${l.itemId}`)),
      h("span.line-actions", {},
        l.returnedOn ? h("span.meta", {}, `volvió ${fmtDay(l.returnedOn)} `) : null,
        h("span", { title: "Estado de la prenda hoy" }, statusChip(l.status))),
    ))),
    h("dl.money", {},
      h("dt", {}, anulado ? "Total tras anular" : "Total cobrado"), h("dd", {}, money(o.totalCents)),
      o.charges.some((c) => c.note?.startsWith("Días extra"))
        ? [h("dt", {}, "Días extra"), h("dd.bad", {}, money(o.charges.filter((c) => c.note?.startsWith("Días extra")).reduce((s, c) => s + c.amountCents, 0)))]
        : null,
    ),
    h("div.actions", {}, timelineButton(o.id)),
  );
}

/** Botón que abre el recorrido de un pedido. */
const timelineButton = (id) => h("button.btn", { type: "button", dataset: { action: "timeline", order: id } }, "Ver recorrido");

/**
 * Recorrido de un pedido, del principio al final: reserva, entrega con fotos,
 * devolución, lavado, vuelta a Disponible, cobro y garantía, con quién y cuándo.
 * @param {number} id Pedido.
 */
async function showTimeline(id) {
  let r;
  try { r = await api(`/api/orders/${id}/timeline`); } catch (err) { return toast(err.message, true); }
  await formDialog(`Recorrido del pedido #${id}`, [
    h("p.meta", {}, "De lo más viejo a lo más nuevo. Incluye lo que les pasó a sus prendas hasta que otro pedido las tomó."),
    h("ul.activity-list.timeline-list", {}, r.entries.map((e) => entryRow(e, { orderLink: false, fullDate: true }))),
  ], "Cerrar", { cancel: false, wide: true });
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

/** Nombre del cliente de un pedido, o su correo si no lo dio. */
const customerName = (o) => o?.customer.name || o?.customer.email || "el cliente";

/** Nombre del cliente como enlace a su ficha. */
const customerLink = (o) => h("button.link", { type: "button", dataset: { action: "customer", customer: o.customer.id } }, customerName(o));

/** Cobro pendiente de un pedido, en centavos. */
const pendingCents = (o) => o.charges.filter((c) => c.status === "PENDING").reduce((s, c) => s + c.amountCents, 0);

/** Tarjeta de un pedido con sus prendas, su dinero y sus acciones. */
function orderCard(o) {
  const pendienteCents = pendingCents(o);
  const porRecibir = o.lines.filter((l) => !l.receivedAt);
  const recibible = porRecibir.some((l) => l.deliveredAt && l.status === "EN_ALQUILER");
  const entregable = o.lines.some((l) => !l.deliveredAt && l.status === "RESERVADA");
  const hoy = todayISO();
  const vencido = porRecibir.length > 0 && o.returnBy < hoy;

  return h("article.card", {},
    h("header", {},
      h("h3", {}, `#${o.id} · `, customerLink(o)),
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
        l.receivedAt
          ? h("span.chip", { title: `Registrada ${when(l.receivedAt)}` }, `Volvió ${fmtDay(l.returnedOn)}`)
          : l.deliveredAt
            ? h("span.chip.warn", { title: `Registrada ${when(l.deliveredAt)}` }, `Salió ${fmtDay(l.deliveredOn)}`)
            : statusChip(l.status),
      ),
    ))),
    h("dl.money", {},
      h("dt", {}, "Total del pedido"), h("dd", {}, money(o.totalCents)),
      h("dt", {}, "Pendiente de cobro"), h("dd", {}, money(pendienteCents)),
      h("dt", {}, "Garantía retenida"), h("dd", {}, money(o.depositHeldCents)),
    ),
    h("div.actions", {},
      entregable && can("MOSTRADOR")
        ? h("button.btn.primary", {
          type: "button", disabled: o.start > hoy || null,
          title: o.start > hoy ? `Se entrega desde el ${fmtDay(o.start)}` : null,
          dataset: { action: "deliver", order: o.id },
        }, o.start > hoy ? `Entrega desde el ${fmtDay(o.start)}` : "Registrar entrega") : null,
      recibible && can("MOSTRADOR")
        ? h("button.btn.primary", { type: "button", dataset: { action: "receive", order: o.id } }, "Registrar devolución") : null,
      pendienteCents > 0 && can("CAJA")
        ? h("button.btn", { type: "button", dataset: { action: "settle", order: o.id } }, `Confirmar cobro de ${money(pendienteCents)}`) : null,
      o.depositHeldCents > 0 && porRecibir.length === 0 && can("CAJA")
        ? h("button.btn", { type: "button", dataset: { action: "release", order: o.id } }, `Devolver garantía de ${money(o.depositHeldCents)}`) : null,
      timelineButton(o.id),
      can("ADMINISTRACION")
        ? h("button.btn.danger", { type: "button", dataset: { action: "cancel", order: o.id } }, "Anular") : null,
    ),
  );
}

/** Diálogo de recepción: qué prendas, qué día volvieron de verdad y observación. */
async function receiveOrder(id) {
  const o = findOrder(id);
  const recibibles = o.lines.filter((l) => !l.receivedAt && l.deliveredAt && l.status === "EN_ALQUILER");
  const fecha = h("input", { type: "date", name: "returnedOn", required: true, value: todayISO(), max: todayISO(), min: o.start });
  const vista = h("div", {}, dayStrip(o, fecha.value));
  // Vista previa: la tira se rehace con el día elegido para ver los días extra
  // antes de registrar. El importe lo decide el servidor.
  fecha.addEventListener("input", () => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(fecha.value)) vista.replaceChildren(dayStrip(o, fecha.value));
  });
  // Una tanda de fotos por prenda: así cada foto queda atada a su ejemplar y
  // se puede comparar con las de su salida. Y un destino por prenda: nada
  // vuelve al catálogo sin pasar por lavado (§3).
  const fichas = recibibles.map((l) => ({ l, picker: photoPicker({ label: "Fotos de cómo llegó" }), destino: destinationFields(l.itemId) }));
  const marcadas = (form) => new Set(new FormData(form).getAll("item").map(Number));
  const datos = await formDialog(`Devolución del pedido #${id}`, [
    h("p.meta", {}, `Límite sin costo: ${fmtDay(o.returnBy)}. Los días hábiles después se cobran como días extra.`),
    h("label", {}, "Día en que volvió de verdad", fecha),
    vista,
    h("fieldset", {}, h("legend", {}, "Prendas que volvieron"),
      fichas.map(({ l, picker, destino }) => h("div.receive-item", {},
        h("label.check", {},
          h("input", { type: "checkbox", name: "item", value: l.itemId, checked: true }),
          thumb(l.imgs),
          ` ${l.productName} (${l.code ?? `#${l.itemId}`})`),
        h("div.receive-photos", {},
          h("button.btn.small", { type: "button", dataset: { action: "photos", item: l.itemId } }, "Ver cómo salió"),
          picker.el),
        destino.el,
      ))),
    h("label", {}, "Observación general (opcional)", h("textarea", { name: "note", maxlength: 500, rows: 2 })),
  ], "Registrar", {
    wide: true,
    validate: (form) => {
      const elegidas = marcadas(form);
      if (!elegidas.size) return "Marca al menos una prenda.";
      const sinFoto = fichas.find(({ l, picker }) => elegidas.has(l.itemId) && !picker.count());
      if (sinFoto) return `Falta al menos una foto de cómo llegó ${sinFoto.l.productName}.`;
      const incompleta = fichas.find(({ l, destino }) => elegidas.has(l.itemId) && destino.error());
      return incompleta ? `${incompleta.l.productName}: ${incompleta.destino.error()}` : null;
    },
  });
  try {
    if (!datos) return;
    const itemIds = datos.getAll("item").map(Number);
    const elegidas = fichas.filter(({ l }) => itemIds.includes(l.itemId));
    // Las fotos primero: si la subida falla, no queda registrada una
    // devolución sin su prueba, y se puede reintentar entera.
    for (const { l, picker } of elegidas) {
      await upload(`/api/items/${l.itemId}/photos`, await picker.files(), { kind: "LLEGADA", orderId: String(id) });
    }
    await act(
      () => api(`/api/orders/${id}/receive`, {
        method: "POST",
        body: {
          returnedOn: datos.get("returnedOn"),
          note: datos.get("note") || undefined,
          items: elegidas.map(({ destino }) => destino.value()),
        },
      }),
      (res) => receiptMessage(id, res.receipt),
      (res) => ({ tone: res.receipt.extraCents > 0 ? "warn" : "ok" }),
    );
  } catch (err) {
    toast(err.message, true);
  } finally {
    fichas.forEach(({ picker }) => picker.dispose());
  }
}

/**
 * Aviso de una devolución: qué volvió, adónde fue cada prenda y, si se pasó
 * de la fecha, cuánto se cobró de más (en rojo).
 * @param {number} id Pedido.
 * @param {{extraCents: number, items: object[]}} receipt Lo que registró el servidor.
 * @returns {Array<string|Node>}
 */
function receiptMessage(id, receipt) {
  const prendas = receipt.items.map((x) => [
    ...garment(x.productName, x.code), " → ", statusChip(x.to), x.laundryPlace ? ` en ${x.laundryPlace}` : "",
  ]);
  const dias = Math.max(0, ...receipt.items.map((x) => x.extraDays));
  return [
    `Pedido #${id} recibido: `, ...joinParts(prendas, "; "),
    receipt.extraCents > 0
      ? [". Se cobran ", amt(receipt.extraCents, "bad"), ` por ${dias} día${dias === 1 ? "" : "s"} hábil${dias === 1 ? "" : "es"} extra.`]
      : ". A tiempo, sin cobros extra.",
  ];
}

/**
 * Campos de adónde va una prenda al recibirla: a lavado (quién lava y dónde
 * está) o a desperfecto (qué le pasó). Solo se ven los del destino elegido.
 * @param {number} itemId Ejemplar.
 * @returns {{el: HTMLElement, value: () => object, error: () => string|null}}
 */
function destinationFields(itemId) {
  const destino = h("select", { "aria-label": "Adónde va" },
    h("option", { value: "EN_LAVADO" }, "A lavado"),
    h("option", { value: "NO_ALQUILABLE" }, "Desperfecto (no se alquila)"));
  const quien = h("select", { "aria-label": "Quién lava" },
    h("option", { value: "PROPIO" }, "Propio"), h("option", { value: "EXTERNO" }, "Externo"));
  const lugar = h("input", { maxlength: 120, value: "Local", "aria-label": "Dónde está", placeholder: "Local, o nombre de la lavandería" });
  const nota = h("input", { maxlength: 500, "aria-label": "Qué le pasó", placeholder: "Qué le pasó (obligatorio)" });
  const lavado = h("div.dest-fields", {}, h("label", {}, "Quién lava", quien), h("label", {}, "Dónde está", lugar));
  const danio = h("div.dest-fields", {}, h("label.grow", {}, "Desperfecto", nota));
  const sync = () => {
    lavado.hidden = destino.value !== "EN_LAVADO";
    danio.hidden = destino.value !== "NO_ALQUILABLE";
  };
  destino.addEventListener("change", sync);
  sync();
  return {
    el: h("div.receive-dest", {}, h("label", {}, "Adónde va", destino), lavado, danio),
    value: () => (destino.value === "EN_LAVADO"
      ? { itemId, to: "EN_LAVADO", laundry: { kind: quien.value, place: lugar.value.trim() } }
      : { itemId, to: "NO_ALQUILABLE", reason: "DESPERFECTO", note: nota.value.trim() }),
    error: () => {
      if (destino.value === "EN_LAVADO" && !lugar.value.trim()) return "indica dónde se lava.";
      if (destino.value === "NO_ALQUILABLE" && !nota.value.trim()) return "describe el desperfecto.";
      return null;
    },
  };
}

/**
 * Registra la entrega de un pedido: qué prendas salieron, el día real (hoy por
 * defecto; puede ser anterior si se registra tarde) y una tanda de fotos por
 * prenda, que es con lo que se comparará al volver. Si quien entrega también
 * es Caja y hay efectivo pendiente, el mismo diálogo confirma el cobro.
 * @param {number} orderId Pedido.
 */
async function deliverOrder(orderId) {
  const o = findOrder(orderId);
  const listas = o.lines.filter((l) => !l.deliveredAt && l.status === "RESERVADA");
  const hoy = todayISO();
  const fichas = listas.map((l) => ({ l, picker: photoPicker({ label: "Fotos de cómo sale" }) }));
  const pendiente = pendingCents(o);
  const cobra = pendiente > 0 && o.pay === "cash" && can("CAJA");
  const marcadas = (form) => new Set(new FormData(form).getAll("item").map(Number));
  const datos = await formDialog(`Entrega del pedido #${orderId} · ${customerName(o)}`, [
    h("p.meta", {}, "Fotografía cada prenda tal como sale: de frente, de espalda y cualquier detalle (manchas, botones, costuras). Es lo que se compara cuando vuelva."),
    h("label", {}, "Día en que salió",
      h("input", { type: "date", name: "deliveredOn", required: true, value: hoy < o.start ? o.start : hoy, min: o.start, max: hoy })),
    h("fieldset", {}, h("legend", {}, "Prendas que salen"),
      fichas.map(({ l, picker }) => h("div.receive-item", {},
        h("label.check", {},
          h("input", { type: "checkbox", name: "item", value: l.itemId, checked: true }),
          thumb(l.imgs), ` ${l.productName} (${l.code ?? `#${l.itemId}`})`),
        h("div.receive-photos", {},
          h("button.btn.small", { type: "button", dataset: { action: "photos", item: l.itemId } }, "Ver fotos del catálogo"),
          picker.el),
      ))),
    cobra
      ? h("label.check.pay-check", {}, h("input", { type: "checkbox", name: "settle", value: "1", checked: true }),
        " Cobré ", h("strong", {}, money(pendiente)), " en efectivo")
      : pendiente > 0 ? h("p.meta.warn", {}, `Queda ${money(pendiente)} por cobrar: lo confirma Caja.`) : null,
    h("label", {}, "Observación (opcional)", h("textarea", { name: "note", maxlength: 500, rows: 2, placeholder: "Quién retiró, cómo se envió…" })),
  ], "Registrar entrega", {
    wide: true,
    validate: (form) => {
      const elegidas = marcadas(form);
      if (!elegidas.size) return "Marca al menos una prenda.";
      const sinFoto = fichas.find(({ l, picker }) => elegidas.has(l.itemId) && !picker.count());
      return sinFoto ? `Saca al menos una foto de cómo sale ${sinFoto.l.productName}.` : null;
    },
  });
  try {
    if (!datos) return;
    const items = datos.getAll("item").map(Number);
    // Las fotos primero: si la subida falla, no queda una entrega sin su prueba.
    for (const { l, picker } of fichas.filter(({ l: x }) => items.includes(x.itemId))) {
      await upload(`/api/items/${l.itemId}/photos`, await picker.files(), { kind: "SALIDA", orderId: String(orderId) });
    }
    await act(
      () => api(`/api/orders/${orderId}/deliver`, {
        method: "POST",
        body: { deliveredOn: datos.get("deliveredOn"), items, settle: datos.get("settle") === "1", note: datos.get("note") || undefined },
      }),
      (res) => [
        "Pedido #", String(orderId), " entregado a ", h("strong", {}, customerName(o)), ": ",
        ...joinParts(res.delivery.items.map((x) => garment(x.productName, x.code)), ", "),
        ". Devuelve sin costo hasta el ", h("strong", {}, fmtDay(res.delivery.returnBy)), ".",
        res.delivery.settledCents > 0 ? [" Cobrado: ", amt(res.delivery.settledCents), "."] : "",
      ],
    );
  } catch (err) {
    toast(err.message, true);
  } finally {
    fichas.forEach(({ picker }) => picker.dispose());
  }
}

/* ---------- Ejemplares ---------- */

/** Pestaña de ejemplares con su estado interno. */
function renderItems() {
  const lista = state.items.filter((i) => matches(i.code, i.productName, STATUS_LABEL[i.status], i.color, i.size));
  return [
    h("h2", {}, "Ejemplares ", h("small", {}, `${state.items.length} en total`)),
    searchBar("Buscar por código, prenda, estado, talla o color"),
    batchBar(state.items),
    // `table.stack`: en el teléfono cada fila se vuelve una tarjeta (admin.css).
    h("div.table-wrap", {}, h("table.stack", {},
      h("thead", {}, h("tr", {}, ["", "", "Código", "Prenda", "Talla · color", "Estado", "Desde", ""].map((t) => h("th", {}, t)))),
      h("tbody", {}, lista.map((i) => h("tr", {},
        h("td.select-cell", {}, can("MOSTRADOR") ? selectBox(i.id, `${i.productName} (${i.code ?? `#${i.id}`})`) : null),
        h("td.thumb-cell", {}, thumb(i.imgs)),
        h("td", { "data-label": "Código" }, i.code ?? h("span.meta", {}, `demo #${i.id}`)),
        h("td", { "data-label": "Prenda" }, i.productName),
        h("td", { "data-label": "Talla · color" }, `${i.size} · ${i.color}`),
        h("td", { "data-label": "Estado" }, statusChip(i.status),
          i.laundryPlace ? h("div.meta", {}, `${i.laundryKind === "EXTERNO" ? "Externo" : "Propio"}: ${i.laundryPlace}`) : null,
          i.unrentableReason ? h("div.meta", {}, i.unrentableReason === "RETIRADA" ? "Retirada" : "Desperfecto") : null),
        h("td", { "data-label": "Desde" }, since(i.statusSince)),
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
  }), (res) => [
    ...garment(it.productName, it.code), ": ", statusChip(it.status), " → ", statusChip(res.status),
    res.laundryPlace ? ` en ${res.laundryPlace}` : "",
    // Pidió Disponible y quedó Reservada: el servidor vio un pedido esperándola.
    to === "DISPONIBLE" && res.status === "RESERVADA" ? ". Ya la espera un pedido: apártala para entregarla." : ".",
  ], (res) => ({ tone: ["NO_ALQUILABLE", "PERDIDA"].includes(res.status) ? "bad" : "ok" }));
}

/** Muestra la bitácora de un ejemplar, de lo más reciente a lo más viejo. */
async function showLog(id) {
  let ficha;
  try { ficha = await api(`/api/items/${id}`); } catch (err) { return toast(err.message, true); }
  await formDialog(`Bitácora de ${ficha.product.name} (${ficha.code ?? `#${ficha.id}`})`, [
    ficha.logs.length ? h("ul.lines", {}, ficha.logs.map((l) => h("li", {},
      h("span", {},
        h("strong", {}, l.from ? `${STATUS_LABEL[l.from]} → ${STATUS_LABEL[l.to]}` : `Alta: ${STATUS_LABEL[l.to]}`),
        l.note ? h("div.meta", {}, l.note) : null,
        l.laundryPlace ? h("div.meta", {}, `${l.laundryKind === "EXTERNO" ? "Lavandería externa" : "Lavado propio"}: ${l.laundryPlace}`) : null,
        // Saltar al pedido para seguir la historia de la prenda.
        l.orderId && (can("MOSTRADOR") || can("CAJA"))
          ? h("button.link", { type: "button", dataset: { action: "timeline", order: l.orderId } }, `Ver recorrido del pedido #${l.orderId}`)
          : null),
      h("span.meta", {}, `${when(l.createdAt)} · ${l.actor?.name ?? "sistema"}`),
    ))) : h("p.empty", {}, "Sin entradas."),
  ], "Cerrar", { cancel: false });
}

/* ---------- Lote ---------- */

/** Casilla para marcar un ejemplar para una acción en lote. */
const selectBox = (id, label) => h("input.select", {
  type: "checkbox", "aria-label": `Marcar ${label}`, checked: state.selected.has(id) || null, dataset: { action: "select", item: id },
});

/**
 * Barra de acciones en lote sobre lo marcado de una lista. Solo ofrece lo que
 * vale para TODAS las marcadas: el servidor lo hace todo o nada.
 * @param {{id: number, status: string}[]} lista Ejemplares visibles.
 * @returns {HTMLElement|null}
 */
function batchBar(lista) {
  const marcadas = lista.filter((i) => state.selected.has(i.id));
  if (!marcadas.length) return null;
  const n = marcadas.length;
  const todas = (st) => marcadas.every((i) => st.includes(i.status));
  return h("div.batch-bar", { role: "region", "aria-label": "Acciones en lote" },
    h("strong", {}, `${n} marcada${n === 1 ? "" : "s"}`),
    todas(["EN_LAVADO"]) ? h("button.btn.primary", { type: "button", dataset: { action: "batch-out" } }, `Sacar del lavado (${n})`) : null,
    todas(["DISPONIBLE", "EN_ALQUILER", "NO_ALQUILABLE"]) ? h("button.btn", { type: "button", dataset: { action: "batch-wash" } }, `Mandar a lavado (${n})`) : null,
    !todas(["EN_LAVADO"]) && !todas(["DISPONIBLE", "EN_ALQUILER", "NO_ALQUILABLE"])
      ? h("span.meta", {}, "Marca prendas en el mismo estado para moverlas juntas.") : null,
    h("button.btn", { type: "button", dataset: { action: "batch-clear" } }, "Quitar marcas"));
}

/** Nombre y código de un ejemplar marcado, buscando en lo cargado. */
function selectedName(id) {
  const i = state.items.find((x) => x.id === id) ?? state.today?.laundryReady.find((x) => x.itemId === id);
  return i ? garment(i.productName, i.code) : [`#${id}`];
}

/** Saca del lavado todo lo marcado, en una sola operación. */
async function batchOut() {
  const ids = [...state.selected];
  await act(() => api("/api/items/status-batch", { method: "POST", body: { ids, to: "DISPONIBLE", note: "Salió del lavado" } }), (res) => {
    const reservadas = res.items.filter((i) => i.status === "RESERVADA");
    state.selected.clear();
    return [`${ids.length} prenda${ids.length === 1 ? "" : "s"} salieron del lavado: `,
      ...joinParts(ids.map(selectedName), ", "), ".",
      reservadas.length === 1 ? [" A ", h("strong", {}, "1"), " ya la espera un pedido: queda Reservada, apártala."]
        : reservadas.length ? [" A ", h("strong", {}, `${reservadas.length}`), " ya las esperan pedidos: quedan Reservadas, apártalas."]
          : " Ya están en el catálogo."];
  });
}

/** Manda a lavado todo lo marcado: pide una vez quién lava y dónde. */
async function batchWash() {
  const ids = [...state.selected];
  const datos = await formDialog(`Mandar ${ids.length} a lavado`, [
    h("p.meta", {}, joinParts(ids.map(selectedName), ", ")),
    h("label", {}, "Quién lava", h("select", { name: "kind" },
      h("option", { value: "PROPIO" }, "Propio"), h("option", { value: "EXTERNO" }, "Externo"))),
    h("label", {}, "Dónde están", h("input", { name: "place", required: true, maxlength: 120, value: "Local", placeholder: "Local, o nombre de la lavandería" })),
  ], "Mandar a lavado");
  if (!datos) return;
  const laundry = { kind: datos.get("kind"), place: datos.get("place") };
  await act(() => api("/api/items/status-batch", { method: "POST", body: { ids, to: "EN_LAVADO", laundry } }), () => {
    state.selected.clear();
    return [`${ids.length} prenda${ids.length === 1 ? "" : "s"} a lavado en `, h("strong", {}, laundry.place), ": ",
      ...joinParts(ids.map(selectedName), ", "), "."];
  });
}

/* ---------- Ficha de cliente ---------- */

/**
 * Ficha de un cliente: lo que debe, la garantía que se le retiene, sus
 * devoluciones tardías y lo retenido alguna vez, y la lista de sus pedidos.
 * @param {number} id Usuario.
 */
async function showCustomer(id) {
  let f;
  try { f = await api(`/api/admin/customers/${id}`); } catch (err) { return toast(err.message, true); }
  const s = f.summary;
  const dato = (dt, dd) => [h("dt", {}, dt), h("dd", {}, dd)];
  await formDialog(f.customer.name || f.customer.email, [
    h("p.meta", {}, `${f.customer.email} · cliente desde ${fmtDay(localISO(new Date(f.customer.createdAt)))}`),
    h("dl.money", {},
      dato("Pedidos", `${s.orders}${s.cancelled ? ` (${s.cancelled} anulado${s.cancelled === 1 ? "" : "s"})` : ""}`),
      dato("Debe ahora", s.owedCents ? amt(s.owedCents, "bad") : "Nada"),
      dato("Garantía en custodia", money(s.depositHeldCents)),
      dato("Devoluciones tardías", s.lateReturns ? [`${s.lateReturns} · `, amt(s.lateCents, "bad"), " en días extra"] : "Ninguna"),
      dato("Garantía retenida alguna vez", s.retainedCents ? amt(s.retainedCents, "bad") : "Nunca")),
    h("h4", {}, "Pedidos"),
    h("ul.lines.customer-orders", {}, f.orders.map((o) => h("li", {},
      h("span", {}, h("strong", {}, `#${o.id}`), ` · del ${fmtDay(o.start)} al ${fmtDay(o.returnBy)} · `,
        h("span.meta", {}, o.lines.map((l) => l.productName).join(", "))),
      h("span.line-actions", {},
        o.cancelledAt ? h("span.chip.bad", {}, "Anulado") : h("span.chip", {}, o.status === "pending" ? "Por cobrar" : "Pagado"),
        " ", money(o.totalCents), " ", timelineButton(o.id)),
    ))),
  ], "Cerrar", { cancel: false, wide: true });
}

/* ---------- Garantía ---------- */

/**
 * Devuelve la garantía de un pedido, entera o reteniendo una parte por la tabla
 * del §6.2. Enseña las fotos de salida y llegada de cada prenda para decidir,
 * propone «desperfecto» si alguna volvió así y calcula lo que se retiene y lo
 * que vuelve; el importe definitivo lo calcula el servidor.
 * @param {number} id Pedido.
 */
async function releaseDeposit(id) {
  const o = findOrder(id);
  const casos = state.calendar?.retentionCases ?? [];
  const held = o.depositHeldCents;
  const danada = o.lines.some((l) => l.status === "NO_ALQUILABLE");
  const resumen = h("p.deposit-sum");
  const otro = can("ADMINISTRACION")
    ? h("input", { type: "number", name: "percent", min: 0, max: 100, step: 1, inputmode: "numeric", placeholder: "—" })
    : null;
  const pintar = (form) => {
    const fd = new FormData(form);
    const elegidos = fd.getAll("case");
    const fuera = otro && otro.value !== "" ? Math.min(100, Math.max(0, Math.round(Number(otro.value)))) : null;
    const pct = fuera ?? Math.min(100, elegidos.reduce((s, k) => s + (casos.find((c) => c.key === k)?.percent ?? 0), 0));
    const retiene = Math.floor((held * pct) / 100);
    // Esparcido: replaceChildren no aplana arreglos y pintaría «[object HTMLElement]».
    resumen.replaceChildren(...(pct
      ? ["Se retiene ", amt(retiene, "bad"), ` (${pct} %) y se devuelven `, amt(held - retiene), "."]
      : ["Se devuelve completa: ", amt(held), "."]));
  };
  const campos = [
    h("p", {}, `Garantía de ${customerName(o)}: `, h("strong", {}, money(held)), ". Revisa cómo salió y cómo volvió cada prenda."),
    h("div.deposit-photos", {}, o.lines.map((l) => h("span", {}, `${l.productName} `, photoButton(l.itemId),
      l.status === "NO_ALQUILABLE" ? h("span.chip.bad", {}, "Volvió con desperfecto") : null))),
    h("fieldset", {}, h("legend", {}, "¿Qué le pasó? (tabla de retención)"),
      casos.map((c) => h("label.check", {},
        h("input", { type: "checkbox", name: "case", value: c.key, checked: danada && c.key === "DESPERFECTO_MENOR" || null }),
        ` ${c.label} `, h("strong", {}, `${c.percent} %`))),
      h("p.meta", {}, "Los casos se suman, con techo de 100 %. El atraso no se retiene: ya se cobró en días extra.")),
    otro ? h("label", {}, "Otro porcentaje, fuera de la tabla (solo Administración)", otro) : null,
    resumen,
    h("label", {}, "Observación (la ve el cliente si se retiene algo)", h("textarea", { name: "note", maxlength: 500, rows: 2 })),
  ];
  const datos = await formDialog(`Garantía del pedido #${id}`, campos, "Confirmar", {
    wide: true,
    validate: (form) => {
      const fd = new FormData(form);
      const retiene = fd.getAll("case").length || (otro && otro.value !== "" && Number(otro.value) > 0);
      return retiene && !String(fd.get("note") ?? "").trim() ? "Explica qué le pasó a la prenda: el cliente lo verá." : null;
    },
    onInput: pintar,
  });
  if (!datos) return;
  const cases = datos.getAll("case");
  const body = { note: datos.get("note") || undefined };
  if (otro && otro.value !== "") body.percent = Math.round(Number(otro.value));
  else if (cases.length) body.cases = cases;
  await act(() => api(`/api/orders/${id}/deposit-release`, { method: "POST", body }), (res) => (res.deposit.retainedCents
    ? ["Garantía de ", h("strong", {}, customerName(o)), ": se devuelven ", amt(res.deposit.refundedCents), " y se retienen ",
      amt(res.deposit.retainedCents, "bad"), ` (${res.deposit.percent} %) · pedido #${id}. Se le avisó con el motivo.`]
    : ["Garantía devuelta completa: ", amt(res.deposit.refundedCents), ` a ${customerName(o)} · pedido #${id}.`]),
  (res) => ({ tone: res.deposit.retainedCents ? "warn" : "ok" }));
}

/* ---------- Hoy ---------- */

/**
 * Busca un pedido en todo lo cargado (en curso, Hoy e historial): las acciones
 * se lanzan desde cualquiera de esas listas.
 * @param {number} id Pedido.
 * @returns {object|undefined}
 */
function findOrder(id) {
  const t = state.today ?? {};
  return [
    ...state.orders,
    ...["pickupsOverdue", "returnsOverdue", "pickupsToday", "returnsToday", "toClose"].flatMap((k) => t[k] ?? []),
    ...(state.history?.orders ?? []),
  ].find((o) => o.id === id);
}

/**
 * Fila de un pedido en «Hoy»: quién, qué prendas, la fecha que importa y los
 * botones de lo que toca hacer. Cabe en un teléfono.
 * @param {object} o Pedido del panel.
 * @param {"pickupLate"|"pickup"|"returnLate"|"return"|"close"} kind Qué falta.
 */
function todayRow(o, kind) {
  const hoy = todayISO();
  const fecha = {
    pickupLate: () => h("span.bad", {}, `Debía retirar el ${fmtDay(o.start)} (${relDays(o.start)})`),
    pickup: () => h("span", {}, `Retira hoy${o.delivery === "ship" ? " (envío)" : ""}`),
    returnLate: () => h("span.bad", {}, `Debía devolver el ${fmtDay(o.returnBy)} · ${lateDays(o.returnBy, hoy)} día(s) hábil(es) extra hasta hoy`),
    return: () => h("span", {}, `Devuelve hoy${o.ret === "home" ? " (retiro a domicilio)" : ""}`),
    close: () => h("span", {}, [
      pendingCents(o) > 0 ? ["Por cobrar ", h("strong.amt.bad", {}, money(pendingCents(o)))] : null,
      pendingCents(o) > 0 && o.depositHeldCents > 0 ? " · " : null,
      o.depositHeldCents > 0 ? ["Garantía por decidir ", h("strong", {}, money(o.depositHeldCents))] : null,
    ]),
  }[kind]();
  const b = (action, label, cls = "") => h(`button.btn${cls}`, { type: "button", dataset: { action, order: o.id } }, label);
  const acciones = {
    pickupLate: [can("MOSTRADOR") && b("deliver", "Se entregó", ".primary"), can("MOSTRADOR") && b("reschedule", "Mover retiro"),
      can("MOSTRADOR") && b("noshow", "No vino: anular", ".danger")],
    pickup: [can("MOSTRADOR") && b("deliver", "Registrar entrega", ".primary")],
    returnLate: [can("MOSTRADOR") && b("receive", "Registrar devolución", ".primary")],
    return: [can("MOSTRADOR") && b("receive", "Registrar devolución", ".primary")],
    close: [pendingCents(o) > 0 && can("CAJA") && b("settle", `Cobrar ${money(pendingCents(o))}`),
      o.depositHeldCents > 0 && o.status !== "pending" && can("CAJA") && b("release", "Devolver garantía", ".primary")],
  }[kind];
  return h(`article.today-row.${kind}`, {},
    h("div.today-main", {},
      h("strong", {}, `#${o.id} · `, customerLink(o)),
      h("div.meta", {}, o.lines.map((l) => `${l.productName} (${l.code ?? `#${l.itemId}`})`).join(", ")),
      h("div.today-when", {}, fecha)),
    h("div.actions", {}, acciones, timelineButton(o.id)),
  );
}

/** Pestaña «Hoy»: lo vencido primero, después la agenda del día y lo que queda por cerrar. */
function renderToday() {
  const t = state.today;
  if (!t) return [h("p.empty", {}, "Cargando…")];
  const seccion = (titulo, nota, filas, tono = "") => (filas.length
    ? h(`section.today-section${tono ? `.${tono}` : ""}`, {},
      h("h2", {}, `${titulo} `, h("span.count-inline", {}, filas.length), nota ? h("small", {}, nota) : null),
      h("div.today-list", {}, filas))
    : null);
  const prenda = (r, extra, accion) => h("article.today-row.laundry", {},
    can("MOSTRADOR") && r.laundryPlace !== undefined ? selectBox(r.itemId, `${r.productName} (${r.code ?? `#${r.itemId}`})`) : null,
    h("div.today-main", {}, h("strong", {}, `${r.productName} (${r.code ?? `#${r.itemId}`})`), h("div.today-when", {}, extra)),
    h("div.actions", {}, photoButton(r.itemId), accion));
  const nada = !t.urgent && !t.pickupsToday.length && !t.returnsToday.length && !t.toClose.length && !t.laundryReady.length;
  return [
    h("h2.today-title", {}, `Hoy, ${fmtDay(t.today)}`),
    nada ? h("p.empty", {}, "Todo al día: nada vencido ni pendiente. ¡Buen trabajo!") : null,
    seccion("Retiros vencidos", "pasó el día de retiro y nadie registró la entrega: ¿se entregó, se mueve o no vino?",
      t.pickupsOverdue.map((o) => todayRow(o, "pickupLate")), "urgent"),
    seccion("Devoluciones vencidas", "pasó la fecha límite y la prenda no consta como recibida",
      t.returnsOverdue.map((o) => todayRow(o, "returnLate")), "urgent"),
    seccion("Recibidas sin lavar", "registradas antes de que recibir llevara a lavado",
      t.receivedNotWashed.map((r) => prenda(r, ["Recibida ", since(r.receivedAt)],
        can("MOSTRADOR") ? h("button.btn", { type: "button", dataset: { action: "move", item: r.itemId } }, "Cambiar estado") : null)), "urgent"),
    seccion("Retiros de hoy", null, t.pickupsToday.map((o) => todayRow(o, "pickup"))),
    seccion("Devoluciones de hoy", null, t.returnsToday.map((o) => todayRow(o, "return"))),
    t.laundryReady.length && can("MOSTRADOR") ? batchBar(t.laundryReady.map((r) => ({ ...r, id: r.itemId, status: "EN_LAVADO" }))) : null,
    seccion("Listas para salir del lavado", "ya pasaron los días de lavado: márcalas y sácalas juntas, o una a una",
      t.laundryReady.map((r) => prenda(r,
        [`${r.laundryKind === "EXTERNO" ? "Lavandería externa" : "Lavado propio"}: ${r.laundryPlace ?? "—"} · desde `, since(r.since)],
        can("MOSTRADOR") ? h("button.btn.primary", { type: "button", dataset: { action: "laundry-out", item: r.itemId } }, "Salió del lavado") : null))),
    seccion("Por cerrar", "todo recibido: falta el cobro o decidir la garantía", t.toClose.map((o) => todayRow(o, "close"))),
  ];
}

/**
 * Mueve el retiro de un cliente que no vino. Se corre todo el alquiler los
 * mismos días, al mismo precio; el servidor comprueba que la prenda siga libre.
 * @param {number} id Pedido.
 */
async function rescheduleOrder(id) {
  const o = findOrder(id);
  const hoy = todayISO();
  let sugerido = hoy;
  for (let i = 0; i < 30 && !isOpen(sugerido); i++) sugerido = addDays(sugerido, 1);
  const datos = await formDialog(`Mover el retiro del pedido #${id}`, [
    h("p", {}, `${customerName(o)} debía retirar el ${fmtDay(o.start)}. Se corre todo el alquiler los mismos días y al mismo precio; el cliente recibe un aviso.`),
    h("label", {}, "Retira desde", h("input", { type: "date", name: "start", required: true, min: hoy, value: sugerido })),
  ], "Mover retiro", { validate: (form) => (isOpen(new FormData(form).get("start")) ? null : "Ese día el local no entrega: elige un día hábil.") });
  if (!datos) return;
  await act(() => api(`/api/orders/${id}/reschedule`, { method: "POST", body: { start: datos.get("start") } }), (res) => [
    `Retiro del pedido #${id} movido: `, h("strong", {}, customerName(o)), " retira desde el ", h("strong", {}, fmtDay(res.reschedule.start)),
    " y devuelve hasta el ", h("strong", {}, fmtDay(res.reschedule.returnBy)), ". Mismo precio; se le avisó.",
  ], { tone: "warn" });
}

/** «No vino»: anula un retiro vencido sin entrega y libera las prendas. */
async function noShowOrder(id) {
  const o = findOrder(id);
  const ok = await confirmWithNote("No vino a retirar",
    `Se anula el pedido #${id} de ${customerName(o)} (debía retirar el ${fmtDay(o.start)}): se revierten sus cargos, las prendas vuelven al catálogo y se le avisa.`,
    "Anular pedido");
  if (!ok) return;
  await act(() => api(`/api/orders/${id}/cancel`, { method: "POST", body: { ...ok, reason: "NO_SHOW" } }), () => [
    `Pedido #${id} anulado porque no se retiró. Vuelven al catálogo: `,
    ...joinParts(o.lines.map((l) => garment(l.productName, l.code)), ", "), ".",
  ], { tone: "bad" });
}

/** Saca una prenda del lavado: vuelve a Disponible (o a Reservada, si ya la espera un pedido). */
async function laundryOut(itemId) {
  const r = state.today?.laundryReady.find((x) => x.itemId === itemId);
  await act(() => api(`/api/items/${itemId}/status`, { method: "POST", body: { to: "DISPONIBLE", note: "Salió del lavado" } }), (res) => [
    ...garment(r?.productName ?? "Prenda", r?.code), " salió del lavado → ", statusChip(res.status),
    res.status === "RESERVADA" ? ". Ya la espera un pedido: apártala para entregarla." : ". Ya está en el catálogo.",
  ]);
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
      state.selected.clear();
      return openTab(el.dataset.tab);
    case "customer":
      return showCustomer(Number(el.dataset.customer));
    case "batch-out":
      return batchOut();
    case "batch-wash":
      return batchWash();
    case "batch-clear":
      state.selected.clear();
      return render();
    case "reload":
      return loadTab();
    case "sign-out":
      return signOut(true);
    case "deliver":
      return deliverOrder(order);
    case "receive":
      return receiveOrder(order);
    case "settle": {
      const o = findOrder(order);
      const cuanto = pendingCents(o);
      const ok = await confirmWithNote("Confirmar cobro",
        `¿Entraron ${money(cuanto)} de ${customerName(o)} por el pedido #${order}?`, "Confirmar");
      return ok && act(() => api(`/api/orders/${order}/settle`, { method: "POST", body: ok }), () => [
        "Cobro confirmado: ", amt(cuanto), ` de ${customerName(o)} · pedido #${order}.`,
      ]);
    }
    case "release":
      return releaseDeposit(order);
    case "cancel": {
      const o = findOrder(order);
      const prendas = o.lines.map((l) => l.productName).join(", ");
      const ok = await confirmWithNote("Anular pedido",
        `Se anula el pedido #${order} de ${customerName(o)}: se revierten sus cargos y se liberan ${prendas}.`, "Anular", true);
      return ok && act(() => api(`/api/orders/${order}/cancel`, { method: "POST", body: ok }), (res) => [
        `Pedido #${order} anulado. Se revirtieron `, amt(o.totalCents - res.totalCents, "bad"),
        " y quedan libres: ", ...joinParts(o.lines.map((l) => garment(l.productName, l.code)), ", "), ".",
      ], { tone: "bad" });
    }
    case "timeline":
      return showTimeline(order);
    case "reschedule":
      return rescheduleOrder(order);
    case "noshow":
      return noShowOrder(order);
    case "laundry-out":
      return laundryOut(item);
    case "history-more":
      state.historyDays += HISTORY_STEP;
      return loadTab();
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
  if (el.dataset?.action === "select") {
    const id = Number(el.dataset.item);
    if (el.checked) state.selected.add(id);
    else state.selected.delete(id);
    render();
    document.querySelector(`[data-action="select"][data-item="${id}"]`)?.focus();
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
