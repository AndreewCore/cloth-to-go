/**
 * Ventanas de devolución en el frontend (§6.0 de DECISIONES), que sustituyen a
 * los días de gracia y a la multa de $15.
 *
 * El calendario no ofrece fines de semana ni feriados, las fechas escritas a
 * mano saltan al siguiente día hábil y un pedido vence por su `returnBy` (el
 * cierre de la ventana), no por el día elegido.
 *
 * La regla es copia de `server/src/dates.js`; la paridad se prueba aquí, en la
 * suite que corre quien toque `js/data.js`, como la del agua.
 */
const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { loadApp } = require("./helpers/load-app.js");

let server;

before(async () => {
  const ruta = path.join(__dirname, "..", "server", "src", "dates.js");
  server = await import(pathToFileURL(ruta).href);
});

/** Recorre `n` días de calendario desde `desde`. */
function* dias(desde, n) {
  let d = desde;
  for (let i = 0; i < n; i++) {
    yield d;
    d = server.addDaysISO(d, 1);
  }
}

test("misma regla que el servidor: día hábil, cierre y fecha límite", () => {
  const front = loadApp();
  const feriados = [{ date: "2030-01-11", name: "x" }, { date: "2030-02-04", name: "y" }];
  front.setBusinessCalendar({ closedWeekdays: [0, 6], holidays: feriados });
  const H = new Set(feriados.map((f) => f.date));
  for (const d of dias("2029-12-20", 120)) {
    assert.equal(front.isBusinessDayISO(d), server.isBusinessDay(d, H), `hábil ${d}`);
    assert.equal(front.weekdayISO(d), server.weekdayOf(d), `día ${d}`);
    if (!server.isBusinessDay(d, H)) continue;
    assert.equal(front.returnWindowCloseISO(d), server.returnWindowClose(d, H), `cierre ${d}`);
    for (const e of [d, server.addDaysISO(d, 2), server.addDaysISO(d, 9)]) {
      assert.equal(front.returnByISO(d, e), server.returnByDate(d, e, H), `límite ${d}→${e}`);
    }
  }
});

test("lunes a miércoles hasta el viernes; jueves y viernes hasta el lunes", () => {
  const front = loadApp();
  assert.equal(front.returnWindowCloseISO("2030-01-07"), "2030-01-11");
  assert.equal(front.returnWindowCloseISO("2030-01-09"), "2030-01-11");
  assert.equal(front.returnWindowCloseISO("2030-01-10"), "2030-01-14");
  assert.equal(front.returnByISO("2030-01-07", "2030-01-15"), "2030-01-15", "solo extiende");
});

test("las fechas elegidas saltan al siguiente día hábil y nunca al pasado", () => {
  const front = loadApp();
  front.setBusinessCalendar({ closedWeekdays: [0, 6], holidays: [{ date: "2030-01-14", name: "x" }] });
  front.setState({ rentalStart: "2030-01-12", rentalEnd: "2030-01-13" }); // sábado y domingo
  front.snapRentalDates(true);
  assert.deepEqual({ ...front.getRentalDates() }, { start: "2030-01-15", end: "2030-01-16" },
    "el lunes es feriado: martes y, después, miércoles");

  front.setState({ rentalStart: "2000-01-03", rentalEnd: "2000-01-04" });
  front.snapRentalDates(false);
  const { start } = front.getRentalDates();
  assert.ok(start >= front.isoOffset(0), "una fecha pasada vuelve a hoy o después");
  assert.ok(front.isBusinessDayISO(start));
});

test("un pedido vence por su fecha límite, no por el día elegido", () => {
  const front = loadApp();
  const ayer = front.isoOffset(-1);
  const manana = front.isoOffset(1);
  assert.ok(!front.isLate({ end: ayer, returnBy: manana }), "la ventana todavía lo cubre");
  assert.ok(front.isLate({ end: ayer, returnBy: ayer }));
  assert.ok(front.isLate({ end: ayer }), "un pedido antiguo, sin returnBy, se mide por end");
  assert.ok(!front.isArchivedOrder({ status: "settled", end: ayer, returnBy: manana }),
    "sigue en curso hasta el cierre de la ventana");
});

test("el calendario del checkout no ofrece fines de semana ni feriados", () => {
  const { loadDom } = require("./helpers/load-dom.js");
  const { app, document } = loadDom();
  app.cart = [{ id: 1 }];
  app.view = "cart";
  app.renderSheet();
  const dias = [...document.querySelectorAll(".cal-day[data-iso]")]
    .filter((b) => b.dataset.iso >= app.isoOffset(0));
  const cerrados = dias.filter((b) => !app.isBusinessDayISO(b.dataset.iso));
  assert.ok(cerrados.length > 0, "toda rejilla de 6 semanas trae algún fin de semana futuro");
  for (const b of cerrados) {
    assert.ok(b.disabled && b.classList.contains("closed"), `${b.dataset.iso} debería estar cerrado`);
  }
  // Y elegirlo a mano no hace nada.
  app.pickCalendarDay(cerrados[0].dataset.iso);
  assert.equal(app.calPendingStart, null);
});

test("el horario que se enseña es el que manda la API (lo edita el panel)", () => {
  const app = loadApp();
  assert.match(app.LOCAL.horario, /sin retiros ni devoluciones/, "sin API: el sábado se atiende pero no se retira");
  app.setBusinessCalendar({ hoursText: "Lun–Vie 09:00–18:00" });
  assert.equal(app.LOCAL.horario, "Lun–Vie 09:00–18:00");
  app.setBusinessCalendar({ hoursText: "   " });
  assert.equal(app.LOCAL.horario, "Lun–Vie 09:00–18:00", "un texto vacío no borra el horario");
});
