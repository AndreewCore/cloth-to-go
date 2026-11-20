/**
 * API falsa, en memoria, para las pruebas de vistas (jsdom).
 *
 * Desde la fase 3 los pedidos, el saldo y los canjes viven en la base, y la app
 * los crea y los lee con `fetch`. Las reglas de negocio de verdad (precio,
 * puntos, cupones, anulación) se prueban en la suite del servidor; aquí solo
 * hace falta algo que **responda con la forma de la API**, para probar que la
 * app manda lo correcto y pinta lo que le devuelven.
 *
 * Por eso los importes se calculan con las propias funciones de la app que
 * siguen en el navegador (grandTotal, orderPoints…): no se reimplementa el
 * servidor, se le da a cada respuesta un número coherente con lo que el
 * checkout enseñó.
 *
 * Lo que la prueba puede tocar está en `fake.state` (pedidos, saldo, canjes,
 * metas) y en `fake.failNext` (la próxima petición que coincida responde con
 * ese error). `fake.calls` registra cada petición: `{ method, path, body }`.
 */

/** Ids de ejemplar falsos: un ejemplar por modelo, con id distinguible. */
const ITEM_BASE = 5000;

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

  /** Crea el pedido con lo que el checkout de la app tiene en pantalla. */
  function createOrder(body) {
    const productIds = body.items.map((id) => id - ITEM_BASE);
    let discountCents = 0;
    let couponId = null;
    let couponIssue = null;
    if (body.couponId != null) {
      const c = st.coupons.find((x) => x.id === body.couponId && x.usedIn == null && !x.revoked);
      if (!c) return respond(409, { error: "Ese premio ya no está disponible." });
      discountCents = Math.round(win.couponDiscount() * 100);
      if (discountCents > 0) { couponId = c.id; c.usedIn = st.nextOrderId; }
      else couponIssue = win.couponIssue() || "El premio no rebaja nada en este alquiler.";
    }
    const charges = productIds.map((pid, i) => ({
      type: "RENTAL",
      itemId: body.items[i],
      amountCents: Math.round(win.cartItemPrice(win.productById(pid)) * 100),
    }));
    const o = {
      id: st.nextOrderId++,
      createdAt: new Date().toISOString(),
      items: productIds,
      itemIds: body.items.slice(),
      start: body.start,
      end: body.end,
      returnBy: win.returnByISO(body.start, body.end),
      days: win.rentalDays(),
      delivery: body.delivery,
      ret: body.ret,
      shipAddr: body.shipAddr ?? null,
      retAddr: body.retAddr ?? null,
      pay: body.pay,
      status: body.pay === "cash" ? "pending" : "settled",
      cancelledAt: null,
      couponId,
      discountCents,
      points: win.orderPoints(),
      totalCents: Math.round(win.grandTotal() * 100),
      depositHeldCents: Math.round(win.depositTotal() * 100),
      charges,
    };
    st.orders.push(o);
    return respond(201, { ...toApi(o), couponIssue });
  }

  const routes = [
    ["GET", /^\/api\/products$/, () => respond(200, win.__APP__.products.map((p) => {
      const libre = !reserved().has(ITEM_BASE + p.id);
      return { ...p, disponibles: libre ? 1 : 0, items: [{ id: ITEM_BASE + p.id, available: libre }] };
    }))],
    ["GET", /^\/api\/config$/, () => respond(200, { today: today(), closedWeekdays: [0, 6], holidays: [] })],
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

module.exports = { installFakeApi, ITEM_BASE };
