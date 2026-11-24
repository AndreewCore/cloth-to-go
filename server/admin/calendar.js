/**
 * Pestaña Calendario (Administración): el horario de atención que leen la app
 * y la web, y los feriados y cierres puntuales.
 *
 * Los días de retiro y devolución (lunes a viernes) no se editan aquí: fijan
 * las ventanas de devolución. Un cierre nuevo sí quita un día hábil, y el panel
 * avisa de los pedidos que ya caían en él, porque sus fechas no se mueven solas.
 */
import { api, formDialog, fmtDay, h, hooks, localISO, toast } from "./core.js";

const DAY_NAME = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

/** Estado propio de la pestaña. */
const cal = { data: null };

/** Carga horario y cierres. */
export async function loadCalendar() {
  cal.data = await api("/api/admin/calendar");
}

/** Pedidos que caen en un cierre, para llamar a esos clientes. */
const ordersNote = (orders) => (orders.length
  ? h("div.cal-warn", {}, `Ese día ${orders.length === 1 ? "cae un pedido" : `caen ${orders.length} pedidos`}: `,
    orders.map((o) => `#${o.id} ${o.customer} (${o.what})`).join(" · "),
    ". Sus fechas no cambian solas: avisa a esos clientes.")
  : null);

/** Tabla del horario, editable en el sitio: una fila por día, lunes primero. */
function hoursForm(hours) {
  return h("form.panel-box.hours-form", { dataset: { action: "hours-form" } },
    h("div.table-wrap", {}, h("table", {},
      h("thead", {}, h("tr", {}, ["Día", "Abre", "Apertura", "Cierre", ""].map((t) => h("th", {}, t)))),
      h("tbody", {}, hours.map((d) => h("tr", {},
        h("td", {}, h("strong", {}, DAY_NAME[d.weekday])),
        h("td", {}, h("input", { type: "checkbox", name: `abre-${d.weekday}`, checked: !!d.open || null, "aria-label": `Abre el ${DAY_NAME[d.weekday].toLowerCase()}` })),
        h("td", {}, h("input", { type: "time", name: `open-${d.weekday}`, value: d.open ?? "10:00", step: 900 })),
        h("td", {}, h("input", { type: "time", name: `close-${d.weekday}`, value: d.close ?? "20:00", step: 900 })),
        h("td", {}, d.pickups ? h("span.meta", {}, "retiros y devoluciones") : h("span.chip.muted", {}, "sin retiros ni devoluciones")),
      ))))),
    h("div.actions", {}, h("button.btn.primary", { type: "submit" }, "Guardar horario")),
  );
}

/** Lista de cierres: los próximos primero, y los del último mes atenuados. */
function holidayList(holidays) {
  const proximos = holidays.filter((x) => !x.past);
  const pasados = holidays.filter((x) => x.past);
  const fila = (x) => h(`li.holiday${x.past ? ".past" : ""}`, {},
    h("div", {},
      h("strong", {}, fmtDay(x.date)), " ", h("span.meta", {}, x.date.slice(0, 4)), " · ", x.name,
      ordersNote(x.orders)),
    x.past ? h("span.meta", {}, "pasado") : h("span.row-actions", {},
      h("button.btn.small", { type: "button", dataset: { action: "holiday-edit", date: x.date } }, "Editar"), " ",
      h("button.btn.small.danger", { type: "button", dataset: { action: "holiday-delete", date: x.date } }, "Quitar")));
  return [
    proximos.length ? h("ul.holidays", {}, proximos.map(fila)) : h("p.empty", {}, "No hay cierres próximos."),
    pasados.length ? h("details", {}, h("summary", {}, `Último mes (${pasados.length})`), h("ul.holidays", {}, pasados.map(fila))) : null,
  ];
}

/** Pinta la pestaña. */
export function renderCalendar() {
  const c = cal.data;
  if (!c) return [h("p.empty", {}, "Cargando…")];
  return [
    h("h2", {}, "Calendario ", h("small", {}, "horario de atención y días cerrados; la app y la web los leen de aquí")),
    h("h3", {}, "Horario de atención"),
    h("p.meta", {}, "Lo que ve el cliente: ", h("strong", {}, c.hoursText)),
    hoursForm(c.hours),
    h("p.meta", {}, "Retiros y devoluciones son de lunes a viernes: de eso dependen las ventanas de devolución sin costo, así que no se cambia aquí."),
    h("div.bar", {},
      h("h3.grow", {}, "Feriados y cierres"),
      h("button.btn.primary", { type: "button", dataset: { action: "holiday-add" } }, "Añadir cierre")),
    h("p.meta", {}, "Un día cerrado no admite retiros ni devoluciones, y una ventana que cae en él pasa al siguiente día hábil."),
    ...holidayList(c.holidays),
  ];
}

/** Guarda el horario del formulario. */
async function saveHours(form) {
  const datos = new FormData(form);
  const hours = cal.data.hours.map((d) => {
    const abre = datos.get(`abre-${d.weekday}`) === "on";
    return { weekday: d.weekday, open: abre ? datos.get(`open-${d.weekday}`) : null, close: abre ? datos.get(`close-${d.weekday}`) : null };
  });
  try {
    await api("/api/admin/hours", { method: "PUT", body: { hours } });
    toast("Horario guardado.");
    await hooks.reload();
  } catch (err) {
    toast(err.message, true);
  }
}

/** Alta de un cierre; si ya había pedidos ese día, lo dice al terminar. */
async function addHoliday() {
  const hoy = localISO(new Date());
  const datos = await formDialog("Añadir cierre", [
    h("label", {}, "Día", h("input", { type: "date", name: "date", required: true, min: hoy })),
    h("label", {}, "Motivo (lo ve el cliente)", h("input", { name: "name", required: true, minlength: 2, maxlength: 80, placeholder: "Feriado, inventario, mantenimiento…" })),
  ], "Cerrar ese día");
  if (!datos) return;
  try {
    const r = await api("/api/admin/holidays", { method: "POST", body: { date: datos.get("date"), name: datos.get("name") } });
    await hooks.reload();
    if (r.orders.length) {
      await formDialog("Cierre añadido", [h("p", {}, `El ${fmtDay(r.date)} queda cerrado.`), ordersNote(r.orders)], "Entendido", { cancel: false });
    } else {
      toast("Cierre añadido.");
    }
  } catch (err) {
    toast(err.message, true);
  }
}

/** Cambia el motivo de un cierre. */
async function editHoliday(date) {
  const x = cal.data.holidays.find((y) => y.date === date);
  const datos = await formDialog(`Cierre del ${fmtDay(date)}`, [
    h("label", {}, "Motivo", h("input", { name: "name", required: true, minlength: 2, maxlength: 80, value: x.name })),
  ], "Guardar");
  if (!datos || datos.get("name") === x.name) return;
  try {
    await api(`/api/admin/holidays/${date}`, { method: "PATCH", body: { name: datos.get("name") } });
    toast("Cierre guardado.");
    await hooks.reload();
  } catch (err) {
    toast(err.message, true);
  }
}

/** Quita un cierre: ese día vuelve a ser hábil. */
async function deleteHoliday(date) {
  const x = cal.data.holidays.find((y) => y.date === date);
  const ok = await formDialog("Quitar cierre", [h("p", {}, `El ${fmtDay(date)} («${x.name}») vuelve a ser un día de retiros y devoluciones.`)], "Quitar");
  if (!ok) return;
  try {
    await api(`/api/admin/holidays/${date}`, { method: "DELETE" });
    toast("Cierre quitado.");
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
export function calendarClick(el) {
  switch (el.dataset.action) {
    case "holiday-add": addHoliday(); return true;
    case "holiday-edit": editHoliday(el.dataset.date); return true;
    case "holiday-delete": deleteHoliday(el.dataset.date); return true;
    default: return false;
  }
}

/**
 * Atiende el envío del formulario de horario (delegado desde admin.js).
 * @param {SubmitEvent} e Evento.
 * @returns {boolean} true si era el formulario de horario.
 */
export function calendarSubmit(e) {
  if (e.target.dataset?.action !== "hours-form") return false;
  e.preventDefault();
  saveHours(e.target);
  return true;
}
