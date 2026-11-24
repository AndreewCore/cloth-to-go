/**
 * API falsa, en memoria, para las pruebas de vistas (jsdom).
 *
 * Desde la fase 3 los pedidos, el saldo y los canjes viven en la base, y la app
 * los crea y los lee con `fetch`. Las reglas de negocio de verdad (precio,
 * puntos, cupones, anulación) se prueban en la suite del servidor; aquí solo
 * hace falta algo que **responda con la forma de la API**, para probar que la
 * app manda lo correcto y pinta lo que le devuelven.
 *
 * Los importes se calculan con las funciones PURAS del propio servidor
 * (server/src/pricing.js, ledger.js, rewards.js), cargadas aquí con require: no
 * se reimplementa el modelo de precios, así que lo que la vista pinta en una
 * prueba es lo que la API de verdad respondería.
 *
 * Lo que la prueba puede tocar está en `fake.state` (pedidos, saldo, canjes,
 * metas) y en `fake.failNext` (la próxima petición que coincida responde con
 * ese error). `fake.calls` registra cada petición: `{ method, path, body }`.
 */

const path = require("node:path");

// Funciones puras del servidor (ESM, sin Prisma ni red). require() de un módulo
// ES funciona en Node ≥ 22.12, que es lo que corre la CI.
const SERVER = path.join(__dirname, "..", "..", "server", "src");
const pricing = require(path.join(SERVER, "pricing.js"));
const ledger = require(path.join(SERVER, "ledger.js"));
const rewards = require(path.join(SERVER, "rewards.js"));

/** Ids de ejemplar falsos: un ejemplar por modelo, con id distinguible. */
const ITEM_BASE = 5000;

/**
 * Precio de catálogo de una prenda, como `priceSummary` de server/src/catalog.js.
 * @param {object} p Prenda del catálogo embebido.
 * @returns {{ladder: number[], nextDay: number, deposit: number}}
 */
function priceSummary(p) {
  const ladder = Array.from({ length: 14 }, (_, i) => pricing.rentalPrice(p, i + 1, 1));
  return { ladder, nextDay: Math.round((ladder[1] - ladder[0]) * 100) / 100, deposit: pricing.depositFor(p) };
}

/**
 * Respuesta mínima con la interfaz que usa api.js.
 * @param {number} status Código HTTP.
 * @param {any} data Cuerpo (se sirve como JSON).
 */
function respond(status, data) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  });
}

/**
 * Instala la API falsa en una ventana de jsdom con la app ya cargada.
 * @param {Window} win Ventana de jsdom.
 * @returns {object} `{ state, calls, failNext }`.
 */
function installFakeApi(win) {
  const today = () => win.isoOffset(0);
  const fake = {
    calls: [],
    failNext: null,
    state: { orders: [], balance: 0, coupons: [], reached: [], nextOrderId: 2001, nextCouponId: 1 },
  };
  const st = fake.state;

  const credited = (o) => !o.cancelledAt && o.start < today();
  const toApi = (o) => ({ ...o, pointsCredited: o.points > 0 && credited(o) });
  const summary = () => ({
    balance: st.balance + st.orders.filter(credited).reduce((s, o) => s + o.points, 0),
    coupons: st.coupons.slice().reverse(),
    rewards: win.__APP__.REWARDS,
    water: { liters: 0, goals: win.__APP__.WATER_GOALS, reached: st.reached.slice() },
  });
  const reserved = () => new Set(st.orders.filter((o) => !o.cancelledAt).flatMap((o) => o.itemIds));

  /**
   * Cotiza como `priceOrder` + `POST /api/quote` del servidor, con sus mismas
   * funciones puras. Devuelve también las líneas y el cupón para crear pedidos.
   */
  function quoteOf(body) {
    const delivery = body.delivery || "pickup";
    const ret = body.ret || "store";
    const priced = body.items.map((id) => ({ ...win.productById(id - ITEM_BASE), itemId: id }));
    const lineas = ledger.initialCharges({ items: priced, start: body.start, end: body.end, delivery, ret, pay: body.pay || "credit" });
    const days = pricing.rentalDays(body.start, body.end);
    let cupon = null;
    let couponIssue = null;
    let missing = false;
    if (body.couponId != null) {
      cupon = st.coupons.find((x) => x.id === body.couponId && x.usedIn == null && !x.revoked) || null;
      if (!cupon) { missing = true; couponIssue = "Ese premio ya no está disponible."; } else {
        const rw = rewards.rewardById(cupon.rewardId);
        const ctx = { items: priced, days, delivery, ret };
        const rebaja = rewards.rewardDiscountCents(rw, ctx);
        if (rebaja > 0) lineas.push(ledger.discountCharge(rebaja, body.pay || "credit", `Premio: ${rw.name}`));
        else { couponIssue = rewards.rewardIssue(rw, ctx) || "El premio no rebaja nada en este alquiler."; cupon = null; }
      }
    }
    const sum = (t) => lineas.filter((l) => l.type === t).reduce((a, l) => a + l.amountCents, 0);
    const rentalCents = sum("RENTAL");
    return {
      lineas, cupon, couponIssue, missing,
      quote: {
        days,
        returnBy: win.returnByISO(body.start, body.end),
        lines: lineas.map((l) => ({ type: l.type, amountCents: l.amountCents, itemId: l.itemId, note: l.note })),
        rentalCents,
        volumeSavingsCents: priced.reduce((a, p) => a + pricing.cents(pricing.rentalPrice(p, days, 1)), 0) - rentalCents,
        shippingCents: sum("SHIPPING"),
        returnCents: sum("RETURN"),
        depositCents: sum("DEPOSIT_HOLD"),
        discountCents: -sum("DISCOUNT") || 0,
        totalCents: lineas.reduce((a, l) => a + l.amountCents, 0),
        points: rewards.orderPoints({ spendCents: ledger.revenueCents(lineas), days, itemCount: priced.length }),
        couponId: cupon ? cupon.id : null,
        couponIssue: body.couponId != null ? couponIssue : null,
        ladderCents: Array.from({ length: 60 }, (_, i) =>
          priced.reduce((a, p) => a + pricing.cents(pricing.rentalPrice(p, i + 1, priced.length)), 0)),
      },
    };
  }

  /** Crea el pedido: mismas líneas que la cotización, como el servidor. */
  function createOrder(body) {
    const { lineas, cupon, couponIssue, missing, quote } = quoteOf(body);
    if (missing) return respond(409, { error: "Ese premio ya no está disponible." });
    if (cupon) cupon.usedIn = st.nextOrderId;
    const o = {
      id: st.nextOrderId++,
      createdAt: new Date().toISOString(),
      items: body.items.map((id) => id - ITEM_BASE),
      itemIds: body.items.slice(),
      start: body.start,
      end: body.end,
      returnBy: quote.returnBy,
      days: quote.days,
      delivery: body.delivery,
      ret: body.ret,
      shipAddr: body.shipAddr ?? null,
      retAddr: body.retAddr ?? null,
      pay: body.pay,
      status: body.pay === "cash" ? "pending" : "settled",
      cancelledAt: null,
      couponId: cupon ? cupon.id : null,
      discountCents: quote.discountCents,
      points: quote.points,
      totalCents: quote.totalCents,
      depositHeldCents: quote.depositCents,
      charges: lineas,
    };
    st.orders.push(o);
    return respond(201, { ...toApi(o), couponIssue });
  }

  const routes = [
    ["GET", /^\/api\/products$/, () => respond(200, win.__APP__.products.map((p) => {
      const libre = !reserved().has(ITEM_BASE + p.id);
      return { ...p, price: priceSummary(p), disponibles: libre ? 1 : 0, items: [{ id: ITEM_BASE + p.id, available: libre }] };
    }))],
    ["GET", /^\/api\/config$/, () => respond(200, { today: today(), closedWeekdays: [0, 6], holidays: [], hoursText: "Lun–Vie 10:00–20:00 · Sáb 10:00–20:00 (sin retiros ni devoluciones)", shippingFee: 4.5, volumeDiscountMax: 0.2 })],
    ["POST", /^\/api\/quote$/, (m, body) => respond(200, quoteOf(body).quote)],
    // Sin `state.taxonomy` responde 404, como un servidor viejo: la app se
    // queda con las listas de respaldo.
    ["GET", /^\/api\/taxonomy$/, () => (st.taxonomy ? respond(200, st.taxonomy) : respond(404, { error: "sin taxonomía" }))],
    // Sin `state.taxonomy` responde 404, como un servidor viejo: la app se
    // queda con las listas de respaldo.
    ["GET", /^\/api\/taxonomy$/, () => (st.taxonomy ? respond(200, st.taxonomy) : respond(404, { error: "sin taxonomía" }))],
    ["POST", /^\/api\/orders$/, (m, body) => createOrder(body)],
    ["GET", /^\/api\/orders$/, () => respond(200, st.orders.slice().reverse().map(toApi))],
    ["PATCH", /^\/api\/orders\/(\d+)\/return$/, (m, body) => {
      const o = st.orders.find((x) => x.id === Number(m[1]));
      if (!o) return respond(404, { error: "Pedido no encontrado." });
      o.totalCents += Math.round((win.returnFeeFor(body.ret) - win.returnFeeFor(o.ret)) * 100);
      o.ret = body.ret;
      o.retAddr = body.retAddr ?? null;
      return respond(200, toApi(o));
    }],
    ["POST", /^\/api\/orders\/(\d+)\/cancel$/, (m) => {
      const o = st.orders.find((x) => x.id === Number(m[1]));
      if (!o) return respond(404, { error: "Pedido no encontrado." });
      if (o.cancelledAt) return respond(409, { error: "El pedido ya estaba anulado." });
      if (today() > o.start) return respond(409, { error: "El alquiler ya empezó: la anulación se gestiona con el local." });
      o.cancelledAt = new Date().toISOString();
      o.status = "cancelled";
      for (const c of st.coupons) if (c.usedIn === o.id) c.usedIn = null;
      o.couponId = null;
      return respond(200, toApi(o));
    }],
    ["GET", /^\/api\/me\/points$/, () => respond(200, summary())],
    ["POST", /^\/api\/rewards\/(\d+)\/redeem$/, (m) => {
      const rw = win.rewardById(Number(m[1]));
      if (!rw) return respond(404, { error: "Ese premio no existe." });
      if (summary().balance < rw.cost) return respond(409, { error: "No tienes puntos suficientes para ese premio." });
      st.balance -= rw.cost;
      const c = { id: st.nextCouponId++, rewardId: rw.id, name: rw.name, cost: rw.cost,
        issuedAt: new Date().toISOString(), usedIn: null, revoked: false };
      st.coupons.push(c);
      return respond(201, { coupon: c, ...summary() });
    }],
    ["POST", /^\/api\/auth\/logout$/, () => respond(204, null)],
  ];

  /**
   * Da de alta en la API falsa un pedido escrito con la forma de la app (la de
   * `orders`), para que editarlo o anularlo encuentre algo en el servidor.
   * @param {object} o Pedido con forma de `orders` (id, items, start, end…).
   * @returns {object} El mismo pedido, para encadenar.
   */
  fake.seed = (o) => {
    st.orders.push({
      id: o.id, createdAt: new Date().toISOString(),
      items: o.items.slice(), itemIds: o.items.map((id) => ITEM_BASE + id),
      start: o.start, end: o.end, returnBy: o.returnBy || o.end, days: 1,
      delivery: o.delivery || "pickup", ret: o.ret || "store",
      shipAddr: null, retAddr: o.retAddr || null, pay: o.pay || "cash",
      status: o.status || "pending", cancelledAt: null, couponId: o.couponId ?? null,
      discountCents: 0, points: o.points || 0,
      totalCents: Math.round((o.total || 0) * 100), depositHeldCents: 0, charges: [],
    });
    return o;
  };

  win.fetch = (url, opts = {}) => {
    const method = (opts.method || "GET").toUpperCase();
    const path = new URL(url).pathname;
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    fake.calls.push({ method, path, body });
    if (fake.failNext) {
      const { status, error } = fake.failNext;
      fake.failNext = null;
      return respond(status, { error });
    }
    for (const [verbo, patron, handler] of routes) {
      const m = method === verbo && path.match(patron);
      if (m) return handler(m, body);
    }
    return respond(404, { error: `Ruta falsa no definida: ${method} ${path}` });
  };
  return fake;
}

module.exports = { installFakeApi, ITEM_BASE, priceSummary };
