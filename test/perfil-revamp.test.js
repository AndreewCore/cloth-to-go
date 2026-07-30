/**
 * Revamp del perfil: ventana completa, metas de ahorro de agua con puntos, y
 * el traslado de Preferencias al header.
 *
 * Lo crítico aquí son las metas: acreditan puntos de verdad, así que la
 * idempotencia (no cobrar dos veces) importa tanto como la propia meta. El
 * resto son garantías de que la reorganización no dejó una pantalla sin salida
 * ni un ajuste inalcanzable.
 */
const test = require("node:test");
const assert = require("node:assert");
const { loadDom } = require("./helpers/load-dom");

/** Monta la app con pedidos que suman los litros indicados. */
function conAgua(litrosObjetivo) {
  const env = loadDom();
  const { app } = env;
  // Se acumulan prendas reales hasta pasar el umbral: así los litros salen del
  // mismo garmentWater() que usa la app y no de un número inventado.
  const items = [];
  let litros = 0;
  let i = 0;
  while (litros < litrosObjetivo && i < app.products.length * 40) {
    const p = app.products[i % app.products.length];
    items.push(p.id);
    litros = app.waterSavedForItems(items);
    i++;
  }
  app.orders = [{
    id: 1, items, start: app.isoOffset(-5), end: app.isoOffset(-1),
    status: "settled", points: 0, pointsCredited: true, total: 10,
  }];
  return env;
}

test("metas de ahorro de agua", async (t) => {
  await t.test("sin pedidos no hay ninguna meta alcanzada", () => {
    const { app } = loadDom();
    app.orders = [];
    assert.equal(app.totalWaterSaved(), 0);
    assert.deepEqual(app.reachedWaterGoals(), []);
    assert.equal(app.nextWaterGoal().id, app.WATER_GOALS[0].id);
  });

  await t.test("los umbrales crecen y cada uno paga más que el anterior", () => {
    const { app } = loadDom();
    for (let i = 1; i < app.WATER_GOALS.length; i++) {
      assert.ok(app.WATER_GOALS[i].liters > app.WATER_GOALS[i - 1].liters,
        "los litros deben crecer");
      assert.ok(app.WATER_GOALS[i].points > app.WATER_GOALS[i - 1].points,
        "cuesta más llegar, debe pagar más");
    }
  });

  await t.test("se alcanzan las metas por debajo de los litros ahorrados", () => {
    const { app } = conAgua(25000);
    const litros = app.totalWaterSaved();
    for (const g of app.reachedWaterGoals()) assert.ok(litros >= g.liters);
    const siguiente = app.nextWaterGoal();
    if (siguiente) assert.ok(litros < siguiente.liters);
  });

  await t.test("la barra mide desde la meta anterior, no desde cero", () => {
    // Sin esto la barra se quedaría casi llena para siempre a partir de la
    // segunda meta y dejaría de informar.
    const { app } = conAgua(21000);   // recién pasada la meta de 20.000
    const p = app.waterGoalProgress();
    assert.ok(p >= 0 && p <= 1);
    assert.ok(p < 0.5, `esperaba un progreso bajo tras cruzar una meta, fue ${p}`);
  });

  await t.test("con todas las metas cumplidas la barra queda llena", () => {
    const { app } = conAgua(120000);
    assert.equal(app.nextWaterGoal(), null);
    assert.equal(app.waterGoalProgress(), 1);
  });

  await t.test("un pedido anulado no cuenta para las metas", () => {
    const { app } = conAgua(25000);
    const antes = app.reachedWaterGoals().length;
    app.orders[0].status = "cancelled";        // así lo marca isCancelledOrder()
    app.orders[0].cancelledAt = app.isoOffset(0);
    assert.equal(app.totalWaterSaved(), 0);
    assert.equal(app.reachedWaterGoals().length, 0);
    assert.ok(antes > 0, "el caso de prueba necesitaba metas alcanzadas");
  });
});

test("acreditación de los puntos de meta", async (t) => {
  await t.test("acredita las metas alcanzadas y las anota", () => {
    const { app } = conAgua(25000);
    app.profile = { ...app.profile, points: 0, waterGoals: [] };
    const cobradas = app.creditWaterGoals();

    assert.ok(cobradas.length > 0, "debería haber cobrado alguna meta");
    const suma = cobradas.reduce((s, g) => s + g.points, 0);
    assert.equal(app.profile.points, suma);
    assert.deepEqual(app.profile.waterGoals.slice().sort(),
      cobradas.map(g => g.id).sort());
  });

  await t.test("no vuelve a pagar una meta ya cobrada", () => {
    // La invariante que más duele si se rompe: recargar la app regalaría puntos.
    const { app } = conAgua(25000);
    app.profile = { ...app.profile, points: 0, waterGoals: [] };
    app.creditWaterGoals();
    const saldo = app.profile.points;

    assert.deepEqual(app.creditWaterGoals(), [], "la segunda pasada no cobra nada");
    assert.equal(app.profile.points, saldo);
    app.creditWaterGoals();
    assert.equal(app.profile.points, saldo, "ni la tercera");
  });

  await t.test("solo cobra las metas nuevas al subir de escalón", () => {
    const { app } = conAgua(6000);            // pasa la primera meta
    app.profile = { ...app.profile, points: 0, waterGoals: [] };
    const primera = app.creditWaterGoals();
    assert.equal(primera.length, 1);

    // Más pedidos: cruza la segunda meta. Solo debe cobrar esa.
    const extra = [];
    let i = 0;
    while (app.totalWaterSaved() < 21000 && i < 200) {
      extra.push(app.products[i % app.products.length].id);
      app.orders = [app.orders[0], {
        id: 2, items: extra, start: app.isoOffset(-5), end: app.isoOffset(-1),
        status: "settled", points: 0, pointsCredited: true, total: 10,
      }];
      i++;
    }
    const segunda = app.creditWaterGoals();
    assert.equal(segunda.length, 1, "solo la meta recién cruzada");
    assert.notEqual(segunda[0].id, primera[0].id);
  });

  await t.test("un perfil viejo sin waterGoals cobra lo ya ganado, una sola vez", () => {
    // Migración: Object.assign en loadState mete waterGoals:[] en perfiles
    // guardados antes de esta feature.
    const { app } = conAgua(25000);
    const viejo = { name: "Ana", email: "", phone: "", picture: "", points: 10, redeemed: [], donations: [] };
    app.profile = viejo;
    const cobradas = app.creditWaterGoals();
    assert.ok(cobradas.length > 0);
    assert.ok(app.profile.points > 10);
    const saldo = app.profile.points;
    assert.deepEqual(app.creditWaterGoals(), []);
    assert.equal(app.profile.points, saldo);
  });

  await t.test("las metas no tocan los canjes ni el descuento", () => {
    // Los puntos de meta entran como saldo normal; no deben crear cupones por
    // su cuenta ni alterar profile.redeemed.
    const { app } = conAgua(25000);
    app.profile = { ...app.profile, points: 0, waterGoals: [], redeemed: [] };
    app.creditWaterGoals();
    assert.deepEqual(app.profile.redeemed, [], "una meta no emite cupones");
    assert.deepEqual(app.availableCoupons(), []);
  });
});

test("el perfil como ventana completa", async (t) => {
  await t.test("el perfil y sus derivadas ocupan la pantalla", () => {
    const { app, document } = loadDom();
    const sheet = document.getElementById("sheet");
    for (const v of ["profile", "rewards", "donate", "settings"]) {
      app.view = v;
      app.renderSheet();
      assert.ok(sheet.classList.contains("full"), `${v} debería ir a pantalla completa`);
    }
  });

  await t.test("el checkout sigue siendo panel deslizante", () => {
    const { app, document } = loadDom();
    const sheet = document.getElementById("sheet");
    // `detail` se omite: renderDetail() necesita un detailId puesto y este test
    // solo mira el contenedor, no la vista.
    for (const v of ["cart", "checkout", "payment", "done"]) {
      app.view = v;
      app.renderSheet();
      assert.ok(!sheet.classList.contains("full"), `${v} no debe ir a pantalla completa`);
    }
  });

  await t.test("una ventana completa nunca queda sin flecha de salida", () => {
    const { app, document } = loadDom();
    const back = document.getElementById("backBtn");
    for (const v of ["profile", "rewards", "donate", "settings"]) {
      app.view = v;
      app.renderSheet();
      assert.notEqual(back.style.display, "none", `${v} se quedó sin salida`);
    }
  });
});

test("orden y contenido del perfil", async (t) => {
  await t.test("las secciones van en el orden acordado", () => {
    const { app, document } = loadDom();
    app.view = "profile";
    app.renderSheet();
    const html = document.getElementById("sheetBody").innerHTML;
    const pos = t => html.indexOf(t);
    assert.ok(pos("profile-head") < pos("points-card"), "identidad antes que estado");
    assert.ok(pos("points-card") < pos("water-goal"), "puntos antes que agua");
    assert.ok(pos("water-goal") < pos("Acciones"), "estado antes que acciones");
    assert.ok(pos("Acciones") < pos("Mis pedidos"), "acciones antes que pedidos");
    assert.ok(pos("Mis pedidos") < pos("Información de contacto"),
      "los pedidos van antes que los datos fríos");
  });

  await t.test("el indicador de agua ya no parece un botón", () => {
    // El motivo original del cambio: era una tarjeta con pinta de pulsable que
    // no llevaba a ningún sitio.
    const { app, document } = loadDom();
    app.view = "profile";
    app.renderSheet();
    const wg = document.querySelector(".water-goal");
    assert.ok(wg, "falta el indicador de agua");
    assert.notEqual(wg.tagName, "BUTTON");
    assert.equal(wg.getAttribute("data-action"), null, "no debe ser pulsable");
    assert.equal(document.querySelector(".water-stat"), null, "la tarjeta vieja se retiró");
  });

  await t.test("muestra la barra con un marcador por meta y sin detalle abierto", () => {
    const { app, document } = conAgua(6000);
    app.view = "profile";
    app.renderSheet();
    const bar = document.querySelector(".wg-bar");
    assert.ok(bar);
    const pct = Number(bar.getAttribute("aria-valuenow"));
    assert.ok(pct >= 0 && pct <= 100);
    assert.equal(document.querySelectorAll(".wg-mark").length, app.WATER_GOALS.length);
    // El nombre y los puntos de la meta NO se muestran hasta tocar su marcador.
    assert.equal(document.querySelector(".wg-goal-info"), null);
  });

  await t.test("tocar un marcador despliega el detalle de esa meta (y otro toque lo cierra)", () => {
    const { app, document } = conAgua(6000);
    app.view = "profile";
    app.renderSheet();
    const meta = app.nextWaterGoal();
    app.toggleWaterGoalInfo(meta.id);
    const info = document.querySelector(".wg-goal-info");
    assert.ok(info, "falta el detalle de la meta");
    assert.match(info.textContent, new RegExp(`\\+${meta.points} pts`));
    assert.match(info.textContent, new RegExp(meta.name));
    app.toggleWaterGoalInfo(meta.id);
    assert.equal(document.querySelector(".wg-goal-info"), null, "el segundo toque debe cerrarlo");
  });

  await t.test("marca como conseguidas las metas alcanzadas", () => {
    const { app, document } = conAgua(25000);
    app.view = "profile";
    app.renderSheet();
    const hechas = document.querySelectorAll(".wg-mark.done");
    assert.equal(hechas.length, app.reachedWaterGoals().length);
  });

  await t.test("Preferencias ya no está dentro del perfil", () => {
    const { app, document } = loadDom();
    app.view = "profile";
    app.renderSheet();
    assert.equal(document.querySelector('[data-action="openSettings"]'), null,
      "se movió al engranaje del header");
  });

  await t.test("los nombres de meta se escapan en el indicador", () => {
    const { app } = conAgua(6000);
    app.WATER_GOALS[0].name = '<img src=x onerror="alert(1)">';
    const html = app.waterGoalHTML();
    assert.ok(!html.includes("<img src=x"), "inyección sin escapar");
    assert.ok(html.includes("&lt;img"));
  });
});

test("la confirmación anuncia la meta recién conseguida", async (t) => {
  await t.test("un pedido que cruza una meta lo dice al confirmar", () => {
    const { app, window, document } = loadDom();
    app.profile = { ...app.profile, points: 0, waterGoals: [] };
    // Prenda con litros de sobra para pasar la primera meta.
    const gorda = app.products.slice().sort((a, b) =>
      app.waterSavedForItems([b.id]) - app.waterSavedForItems([a.id]))[0];
    app.cart = [{ id: gorda.id }];
    app.setCheckout({ delivery: "pickup", returnMethod: "store", payMethod: "cash" });
    window.placeOrder();

    assert.ok(app.lastWaterGoals.length > 0, "debería haber cruzado una meta");
    assert.match(document.getElementById("sheetBody").innerHTML, /Meta/);
    assert.match(document.getElementById("sheetBody").innerHTML, /goal-hit/);
    // Además del acuse en pantalla, salta el pop-up de felicitación.
    assert.ok(document.getElementById("modalOverlay").classList.contains("show"),
      "falta el pop-up de felicidades");
    assert.match(document.getElementById("modalTitle").textContent, /Felicidades/);
  });

  await t.test("sin meta cruzada no se anuncia nada", () => {
    const { app, window, document } = loadDom();
    // Se marcan todas como ya cobradas: ningún pedido puede cruzar una nueva.
    app.profile = { ...app.profile, points: 0, waterGoals: app.WATER_GOALS.map(g => g.id) };
    app.cart = [{ id: app.products[0].id }];
    app.setCheckout({ delivery: "pickup", returnMethod: "store", payMethod: "cash" });
    window.placeOrder();

    assert.deepEqual(app.lastWaterGoals, []);
    assert.ok(!document.getElementById("sheetBody").innerHTML.includes("goal-hit"));
  });
});
