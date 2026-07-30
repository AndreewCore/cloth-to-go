/**
 * Calendario de tarifas: aritmética de fechas, coste marginal por día y la
 * cuadrícula que los pinta.
 *
 * Lo que se protege aquí es la INVARIANTE del roadmap: el calendario hace
 * visible el modelo de precios, no lo cambia. Por eso casi todas las
 * aserciones comparan contra rentalPrice()/subtotal() en vez de contra cifras
 * escritas a mano — si alguien toca los tramos, estas pruebas siguen valiendo.
 */
const test = require("node:test");
const assert = require("node:assert");
const { loadDom } = require("./helpers/load-dom");

/** Monta la app con un carrito conocido y las fechas fijadas. */
function setup(ids = [1], dates = {}) {
  const { document, app, window } = loadDom();
  app.cart = ids.map(id => ({ id }));
  if (dates.rentalStart || dates.rentalEnd) app.setCheckout(dates);
  return { document, app, window };
}

test("aritmética de fechas sin desfase de huso", async (t) => {
  const { app } = setup();

  await t.test("addDaysISO suma en hora local, no en UTC", () => {
    // El bug clásico: new Date("2026-08-01") es UTC y en Guayaquil (UTC-5)
    // retrocede al 31 de julio. Estos casos lo detectan.
    assert.equal(app.addDaysISO("2026-08-01", 1), "2026-08-02");
    assert.equal(app.addDaysISO("2026-08-01", 0), "2026-08-01");
    assert.equal(app.addDaysISO("2026-08-01", -1), "2026-07-31");
  });

  await t.test("cruza fin de mes y de año", () => {
    assert.equal(app.addDaysISO("2026-01-31", 1), "2026-02-01");
    assert.equal(app.addDaysISO("2026-12-31", 1), "2027-01-01");
    assert.equal(app.addDaysISO("2026-03-01", -1), "2026-02-28");
  });

  await t.test("año bisiesto", () => {
    assert.equal(app.addDaysISO("2028-02-28", 1), "2028-02-29");
    assert.equal(app.addDaysISO("2028-02-29", 1), "2028-03-01");
  });

  await t.test("monthOf y shiftMonth", () => {
    assert.equal(app.monthOf("2026-08-14"), "2026-08");
    assert.equal(app.shiftMonth("2026-08", 1), "2026-09");
    assert.equal(app.shiftMonth("2026-12", 1), "2027-01");
    assert.equal(app.shiftMonth("2026-01", -1), "2025-12");
  });

  await t.test("monthLabel en español", () => {
    assert.equal(app.monthLabel("2026-08"), "agosto 2026");
    assert.equal(app.monthLabel("2026-12"), "diciembre 2026");
  });
});

test("monthGrid arma semanas completas de lunes a domingo", async (t) => {
  const { app } = setup();

  await t.test("el número de celdas es múltiplo de 7", () => {
    for (const ym of ["2026-08", "2026-02", "2027-01", "2028-02"]) {
      assert.equal(app.monthGrid(ym).length % 7, 0, `${ym} no cierra la semana`);
    }
  });

  await t.test("empieza en lunes y termina en domingo", () => {
    const g = app.monthGrid("2026-08");
    // 2026-08-01 es sábado, así que la rejilla arranca el lunes 27 de julio.
    assert.equal(g[0].iso, "2026-07-27");
    assert.equal(new Date(g[0].iso + "T12:00:00").getDay(), 1);
    assert.equal(new Date(g[g.length - 1].iso + "T12:00:00").getDay(), 0);
  });

  await t.test("contiene todos los días del mes, ninguno marcado 'out'", () => {
    const dentro = app.monthGrid("2026-08").filter(c => !c.out);
    assert.equal(dentro.length, 31);
    assert.equal(dentro[0].iso, "2026-08-01");
    assert.equal(dentro[30].iso, "2026-08-31");
  });

  await t.test("los días de relleno se marcan 'out'", () => {
    const g = app.monthGrid("2026-08");
    assert.equal(g[0].out, true);
    assert.equal(g.find(c => c.iso === "2026-08-01").out, false);
  });

  await t.test("las celdas son consecutivas, sin huecos ni repetidos", () => {
    const g = app.monthGrid("2026-02");
    for (let i = 1; i < g.length; i++) {
      assert.equal(g[i].iso, app.addDaysISO(g[i - 1].iso, 1));
    }
  });
});

test("coste marginal por día", async (t) => {
  await t.test("el día 1 es el subtotal de un alquiler de un día", () => {
    const { app } = setup([1]);
    assert.equal(app.dayMarginalCost(1), app.subtotalForDays(1));
  });

  await t.test("los días suman exactamente el subtotal del período", () => {
    // La invariante central: pintar los días no puede inventar ni perder
    // dinero respecto al precio que se cobra.
    const { app } = setup([1, 2, 3]);
    for (const dias of [1, 2, 3, 5, 8, 14]) {
      let suma = 0;
      for (let n = 1; n <= dias; n++) suma += app.dayMarginalCost(n);
      assert.equal(
        Math.round(suma * 100),
        Math.round(app.subtotalForDays(dias) * 100),
        `los ${dias} días no cuadran con el subtotal`
      );
    }
  });

  await t.test("ningún día resta dinero", () => {
    const { app } = setup([1, 2, 3, 4]);
    for (let n = 1; n <= 20; n++) {
      assert.ok(app.dayMarginalCost(n) >= 0, `el día ${n} sale negativo`);
    }
  });

  await t.test("ningún día extra cuesta más que el primero", () => {
    const { app } = setup();
    for (const p of app.products) {
      app.cart = [{ id: p.id }];
      const base = app.dayMarginalCost(1);
      for (let n = 2; n <= 30; n++) {
        assert.ok(app.dayMarginalCost(n) <= base + 1e-9,
          `${p.name}: el día ${n} cuesta más que el día 1`);
      }
    }
  });

  await t.test("alargar el alquiler nunca encarece el precio por día", () => {
    // Es la promesa que la app ya le hace al cliente en el carrito ("mientras
    // más días alquiles, más barato sale cada día") y lo que el calendario
    // pone en verde. Se comprueba sobre TODO el catálogo, no sobre una prenda.
    const { app } = setup();
    for (const p of app.products) {
      app.cart = [{ id: p.id }];
      for (let n = 2; n <= 30; n++) {
        const antes = app.subtotalForDays(n - 1) / (n - 1);
        const ahora = app.subtotalForDays(n) / n;
        assert.ok(ahora <= antes + 1e-9,
          `${p.name}: el día ${n} sube el precio por día`);
      }
    }
  });

  await t.test("el marginal da un escalón al salir del piso de coste", () => {
    // Documenta una rareza real del modelo, no un fallo: mientras la prenda
    // está pinnada en rentalFloor() los días extra son gratis, y en cuanto el
    // precio de lista supera el piso el marginal PASA de 0 a positivo. Por eso
    // la serie de marginales no es monótona y no se puede afirmar que lo sea.
    const { app } = setup([5]);
    const serie = [];
    for (let n = 1; n <= 12; n++) serie.push(app.dayMarginalCost(n));
    const gratis = serie.slice(1).filter(v => v === 0).length;
    assert.ok(gratis > 0, "se esperaban días extra a $0 mientras rige el piso");
    assert.ok(serie.slice(1).some(v => v > 0), "se esperaba salir del piso");
    // Una vez que empieza a cobrar, ya no vuelve a $0.
    const primerCobro = serie.findIndex((v, i) => i > 0 && v > 0);
    assert.ok(serie.slice(primerCobro).every(v => v > 0),
      "un día gratis después de empezar a cobrar sería incoherente");
  });

  await t.test("una prenda anclada a su piso de coste da días extra a $0", () => {
    // Es el caso que da sentido al verde: las prendas baratas están pinnadas
    // en rentalFloor() y alargar no cuesta nada.
    const { app } = setup();
    const barata = app.products
      .slice()
      .sort((a, b) => a.value - b.value)[0];
    app.cart = [{ id: barata.id }];
    assert.equal(app.dayMarginalCost(2), 0,
      `se esperaba día 2 gratis en la prenda más barata (${barata.name})`);
  });

  await t.test("índices <= 1 se tratan como el día 1", () => {
    const { app } = setup([1]);
    assert.equal(app.dayMarginalCost(0), app.dayMarginalCost(1));
    assert.equal(app.dayMarginalCost(-3), app.dayMarginalCost(1));
  });

  await t.test("con el carrito vacío no hay coste", () => {
    const { app } = setup([]);
    assert.equal(app.subtotalForDays(5), 0);
    assert.equal(app.dayMarginalCost(3), 0);
  });

  await t.test("el descuento por volumen ya viene aplicado", () => {
    const { app } = setup([1]);
    const solo = app.subtotalForDays(4);
    app.cart = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const conVolumen = app.subtotalForDays(4);
    // El de 3 prendas no puede costar el triple exacto: hay 10% de descuento
    // (salvo que las tres estén pinnadas en su piso, que no es el caso aquí).
    assert.ok(conVolumen < solo * 3);
  });
});

test("etiquetas de los días en la cuadrícula", async (t) => {
  const hoy = new Date();
  const iso = n => {
    const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + n);
    const p = v => String(v).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  await t.test("el último día del rango lleva cifra, no un rótulo aparte", () => {
    // Se decidió no rotular la devolución: basta con ver el rango marcado.
    // Todos los días del calendario hablan el mismo idioma, el del importe.
    const { app } = setup([1], { rentalStart: iso(0), rentalEnd: iso(3) });
    const c = app.calDayCost(iso(3));
    assert.ok(["free", "paid"].includes(c.cls));
    assert.match(c.txt, /^\+\$\d+\.\d\d$/);
  });

  await t.test("el primer día muestra la base, sin signo +", () => {
    const { app } = setup([1], { rentalStart: iso(0), rentalEnd: iso(3) });
    const c = app.calDayCost(iso(0));
    assert.equal(c.cls, "base");
    assert.ok(c.txt.startsWith("$"), `esperaba "$…", vino "${c.txt}"`);
    assert.ok(!c.txt.startsWith("+"));
  });

  await t.test("un día que no suma sale en verde como '+$0.00'", () => {
    const { app } = setup([], { rentalStart: iso(0), rentalEnd: iso(9) });
    const barata = app.products.slice().sort((a, b) => a.value - b.value)[0];
    app.cart = [{ id: barata.id }];
    const c = app.calDayCost(iso(1));
    assert.equal(c.cls, "free");
    assert.equal(c.txt, "+$0.00");
  });

  await t.test("un día que sí suma sale con su importe", () => {
    const { app } = setup([], { rentalStart: iso(0), rentalEnd: iso(9) });
    const cara = app.products.slice().sort((a, b) => b.value - a.value)[0];
    app.cart = [{ id: cara.id }];
    const c = app.calDayCost(iso(1));
    assert.equal(c.cls, "paid");
    assert.match(c.txt, /^\+\$\d+\.\d\d$/);
  });

  await t.test("los días previos al inicio no llevan etiqueta", () => {
    const { app } = setup([1], { rentalStart: iso(5), rentalEnd: iso(8) });
    assert.equal(app.calDayCost(iso(4)), null);
  });

  await t.test("los días posteriores a la devolución previsualizan la extensión", () => {
    // Es deliberado: enseñar lo barato que sale alargar es el objetivo de
    // negocio de la feature.
    const { app } = setup([1], { rentalStart: iso(0), rentalEnd: iso(3) });
    const c = app.calDayCost(iso(5));
    assert.ok(c !== null, "el día posterior debería previsualizar su coste");
    assert.ok(["free", "paid"].includes(c.cls));
  });

  await t.test("sin carrito no se etiqueta ningún día", () => {
    const { app } = setup([], { rentalStart: iso(0), rentalEnd: iso(3) });
    assert.equal(app.calDayCost(iso(1)), null);
  });

  await t.test("calDayIndex cuenta desde 1 en el día de inicio", () => {
    const { app } = setup([1], { rentalStart: iso(0), rentalEnd: iso(3) });
    assert.equal(app.calDayIndex(iso(0)), 1);
    assert.equal(app.calDayIndex(iso(1)), 2);
    assert.equal(app.calDayIndex(iso(3)), 4);
  });
});

test("selección de rango con dos clics", async (t) => {
  const hoy = new Date();
  const iso = n => {
    const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + n);
    const p = v => String(v).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  await t.test("el primer clic deja el inicio pendiente sin tocar las fechas", () => {
    const { app } = setup([1], { rentalStart: iso(0), rentalEnd: iso(3) });
    app.pickCalendarDay(iso(10));
    assert.equal(app.calPendingStart, iso(10));
    assert.equal(app.rentalStart, iso(0), "no debe mover el inicio todavía");
    assert.equal(app.rentalEnd, iso(3));
  });

  await t.test("el segundo clic cierra el rango", () => {
    const { app } = setup([1], { rentalStart: iso(0), rentalEnd: iso(3) });
    app.pickCalendarDay(iso(10));
    app.pickCalendarDay(iso(14));
    assert.equal(app.rentalStart, iso(10));
    assert.equal(app.rentalEnd, iso(14));
    assert.equal(app.calPendingStart, null);
    assert.equal(app.rentalDays(), 4);
  });

  await t.test("un clic anterior al pendiente reinicia la selección", () => {
    const { app } = setup([1], { rentalStart: iso(0), rentalEnd: iso(3) });
    app.pickCalendarDay(iso(14));
    app.pickCalendarDay(iso(10));   // se equivocó: empieza de nuevo
    assert.equal(app.calPendingStart, iso(10));
    assert.equal(app.rentalStart, iso(0), "el rango viejo sigue intacto");
  });

  await t.test("clicar dos veces el mismo día no crea un rango de cero días", () => {
    const { app } = setup([1], { rentalStart: iso(0), rentalEnd: iso(3) });
    app.pickCalendarDay(iso(10));
    app.pickCalendarDay(iso(10));
    assert.equal(app.calPendingStart, iso(10));
    assert.equal(app.rentalEnd, iso(3), "no debe cerrarse sobre sí mismo");
  });

  await t.test("los días pasados se ignoran", () => {
    const { app } = setup([1], { rentalStart: iso(0), rentalEnd: iso(3) });
    app.pickCalendarDay(iso(-1));
    assert.equal(app.calPendingStart, null);
    assert.equal(app.rentalStart, iso(0));
  });
});

test("navegación de meses", async (t) => {
  await t.test("avanza y retrocede", () => {
    const { app } = setup([1]);
    const inicio = app.calVisibleMonth();
    app.shiftCalendar(1);
    assert.equal(app.calVisibleMonth(), app.shiftMonth(inicio, 1));
    app.shiftCalendar(-1);
    assert.equal(app.calVisibleMonth(), inicio);
  });

  await t.test("no retrocede antes del mes en curso", () => {
    const { app } = setup([1]);
    const mesActual = app.monthOf(app.isoOffset(0));
    app.shiftCalendar(-1);
    assert.equal(app.calVisibleMonth(), mesActual, "no se alquila hacia el pasado");
  });

  await t.test("por defecto muestra el mes del inicio elegido", () => {
    const { app } = setup([1]);
    assert.equal(app.calVisibleMonth(), app.monthOf(app.rentalStart));
  });
});

test("render del bloque de fechas", async (t) => {
  await t.test("pinta la cuadrícula con sus días pulsables", () => {
    const { app, document } = setup([1]);
    app.view = "cart";
    app.renderSheet();
    assert.ok(document.querySelector(".cal-grid"), "falta la cuadrícula");
    const dias = document.querySelectorAll('.cal-day[data-action="pickDay"]');
    assert.ok(dias.length >= 28, `esperaba un mes completo, hubo ${dias.length}`);
  });

  await t.test("los inputs nativos siguen presentes (ruta accesible)", () => {
    // El calendario se añade al selector nativo, no lo sustituye: sin los
    // inputs, quien navega por teclado o lector se queda sin forma de fijar
    // fechas.
    const { app, document } = setup([1]);
    app.view = "cart";
    app.renderSheet();
    assert.ok(document.getElementById("rentStart"));
    assert.ok(document.getElementById("rentEnd"));
  });

  await t.test("los días pasados van deshabilitados", () => {
    const { app, document } = setup([1]);
    app.view = "cart";
    app.renderSheet();
    const hoy = app.isoOffset(0);
    for (const b of document.querySelectorAll(".cal-day")) {
      if (b.dataset.iso < hoy) assert.ok(b.disabled, `${b.dataset.iso} debería estar bloqueado`);
    }
  });

  await t.test("marca inicio, fin y los días intermedios", () => {
    const { app, document } = setup([1]);
    app.view = "cart";
    app.renderSheet();
    const start = document.querySelector(".cal-day.start");
    const end = document.querySelector(".cal-day.end");
    assert.equal(start.dataset.iso, app.rentalStart);
    assert.equal(end.dataset.iso, app.rentalEnd);
    assert.ok(document.querySelectorAll(".cal-day.in").length >= 2);
  });

  await t.test("con un rango a medio elegir solo se resalta el día pendiente", () => {
    const { app, document } = setup([1]);
    app.view = "cart";
    app.renderSheet();
    // Se toma un día de la propia cuadrícula: escribir un offset fijo lo saca
    // del mes visible cuando la prueba corre a final de mes.
    const libre = [...document.querySelectorAll(".cal-day:not([disabled])")]
      .find(b => b.dataset.iso > app.rentalEnd);
    app.pickCalendarDay(libre.dataset.iso);

    const marcados = document.querySelectorAll(".cal-day.in");
    assert.equal(marcados.length, 1);
    assert.equal(marcados[0].dataset.iso, libre.dataset.iso);
    assert.ok(document.querySelector(".cal-day.pending"));
  });

  await t.test("el resumen pide el día final mientras hay un pendiente", () => {
    const { app, document } = setup([1]);
    app.view = "cart";
    app.pickCalendarDay(app.isoOffset(1));
    assert.match(document.querySelector(".date-total").textContent, /hasta cuándo/);
  });

  await t.test("no se explica el precio con palabras, solo con la cifra", () => {
    // Rotular "no suma nada" sonaba a que el negocio se justifica; el importe
    // y el color bastan. Este test evita que la leyenda vuelva por descuido.
    const { app, document } = setup([1]);
    app.view = "cart";
    app.renderSheet();
    assert.equal(document.querySelector(".cal-legend"), null);
    const box = document.querySelector(".date-box").textContent;
    assert.ok(!/no suma nada|devoluci\u00f3n/i.test(box),
      "el calendario no debe rotular la devolución ni explicar el precio");
  });

  await t.test("el botón de mes anterior está bloqueado en el mes en curso", () => {
    const { app, document } = setup([1]);
    app.view = "cart";
    app.renderSheet();
    assert.ok(document.querySelector('[data-action="calPrev"]').disabled);
  });
});

test("el calendario no altera lo que se cobra", async (t) => {
  await t.test("elegir fechas por el calendario da el mismo total que por los inputs", () => {
    const hoy = new Date();
    const iso = n => {
      const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + n);
      const p = v => String(v).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    };
    const a = setup([1, 2], { rentalStart: iso(2), rentalEnd: iso(9) });
    const porInput = a.app.grandTotal();

    const b = setup([1, 2]);
    b.app.pickCalendarDay(iso(2));
    b.app.pickCalendarDay(iso(9));
    assert.equal(b.app.grandTotal(), porInput);
  });
});
