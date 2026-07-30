/* ============================================================
   CLOTH TO GO · state.js
   Estado global de la app, helper de fechas y cálculos derivados.
   Lo consumen los demás módulos (dom, catalog, checkout, profile, main).
   Depende de data.js (PRODUCTS, SHIPPING_FEE, daysBetween).
   ============================================================ */

/* ---------------- Helper de fecha ---------------- */
// Devuelve "YYYY-MM-DD" en hora LOCAL (no UTC) para evitar desfase de día
// cerca de medianoche en zonas como Guayaquil (UTC-5).
function isoOffset(days){
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* ---------------- Estado ---------------- */
let cart = [];                       // [{id}] — una unidad por prenda
// PEDIDOS (orders): cada alquiler confirmado se guarda como UN pedido que
// agrupa sus prendas y registra el cobro. Forma de un pedido:
//   { id, date, items:[productId], start, end, delivery, ret, retAddr,
//     pay:'cash'|'credit'|'debit', status:'settled'|'pending'|'cancelled', total }
// - total : valor total del cobro del pedido (incluye depósito reembolsable).
//           Se recalcula si se edita el modo de devolución (cambia la tarifa).
// - status: 'settled' = pagado/cobrado → etiqueta "Cancelado";
//           'pending'  = pendiente de cobro/pago → etiqueta "Pendiente";
//           'cancelled' = pedido anulado por el cliente → etiqueta "Anulado".
//   Ojo con el vocabulario: aquí "Cancelado" significa PAGADO (uso corriente en
//   Ecuador), por eso un pedido anulado NO puede llamarse "cancelado" en la UI.
// loadState() puede sobreescribir esto si hay datos guardados.
let orders = [];
// RESEÑAS escritas por el usuario de esta sesión:
//   { id, productId, orderId, rating:1..5, text, photo?, date }
// `photo` es un data URL webp ya redimensionado (ver compressPhoto en
// profile.js). Se guardan por usuario en localStorage como el resto del estado;
// las de muestra (DEMO_REVIEWS) NO viven aquí y no se persisten nunca.
let reviews = [];
// Prenda y pedido que se están reseñando, y el borrador del formulario.
// Efímeros: un borrador a medias no merece sobrevivir a una recarga.
let reviewOrderId = null;
let reviewProductId = null;
let reviewRating = 0;
let reviewText = "";
let reviewPhoto = "";
// Perfil: contacto + puntos acumulados + canjes + donaciones.
// `redeemed` es a la vez historial y cartera: cada canje es un premio con
// nombre propio { id, rewardId, name, cost, date, usedIn } y sigue disponible
// mientras `usedIn` sea null (después guarda el id del pedido que lo gastó).
let profile = { name:"", email:"", phone:"", points: 0, redeemed: [], donations: [] };
let lastEarnedPoints = 0;            // puntos del último pedido (para la confirmación)
let lastWaterSaved = 0;              // litros de agua ahorrados en el último pedido (para la confirmación/pop-up)
let lastWaterGoals = [];             // metas de agua cruzadas por el último pedido (para la confirmación)
let lastOrder = null;                // último pedido confirmado: la pantalla de
                                     // confirmación se pinta desde aquí, no del
                                     // carrito (que ya se vació en placeOrder).
let editingProfile = false;          // info de contacto en modo edición (perfil)
// Formulario de donación de prendas (por puntos)
let donName = "";                    // descripción de la prenda a donar
let donMethod = null;                // 'store' | 'home' — cómo se entrega
let donAddr = "";                    // dirección de retiro (si domicilio)
let donDate = "";                    // fecha de la cita de retiro (si domicilio)
let activeCat = "Todo";
let searchQuery = "";
let qualityFilter = 0;               // estrellas mínimas (0 = todas)
let sizeFilter = "Todas";            // filtro por talla
let materialFilter = "Todos";        // filtro por material
let sortBy = "default";              // ordenamiento del catálogo
let view = "cart";                   // cart | checkout | done | detail | profile
let detailId = null;
// El detalle se está viendo en la pestaña apilada (sobre el perfil) y no en el
// panel principal. Lo decide openDetail() y manda en dónde pinta renderDetail()
// y a dónde vuelven sus botones. Efímero: no se persiste.
let stackedDetail = false;
// Foto visible de la galería del detalle. Efímero como stackedDetail: abrir otra
// prenda lo devuelve a 0, y no tiene sentido persistir por qué foto ibas.
let detailImg = 0;
let delivery = null;                 // 'ship' | 'pickup'  — cómo RECIBE el pedido
let address = "";
// Punto exacto elegido en el mapa ({lat,lng}) o null si solo hay texto.
// La entrega se guía por las coordenadas: el texto es para que el cliente se
// reconozca, no para que el repartidor busque una numeración que quizá no existe.
let addressCoords = null;
let returnMethod = null;             // 'store' | 'home'  — cómo DEVUELVE al terminar
let returnAddress = "";              // dirección para el retiro a domicilio
let returnAddressCoords = null;      // punto exacto del retiro ({lat,lng}) o null
let payMethod = null;                // 'cash' | 'credit' | 'debit'  — método de pago
let appliedCoupon = null;            // id del canje aplicado al checkout actual (o null)
let card = { number:"", name:"", expiry:"", cvv:"" };  // datos de tarjeta (no se procesan: backend)
// Edición del modo de devolución de un pedido (en el perfil)
let editingOrder = null;             // índice del pedido en edición (o null)
let editRet = null;                  // 'store' | 'home' (selección temporal)
let editRetAddr = "";                // dirección de retiro temporal
let rentalStart = isoOffset(0);      // hoy
let rentalEnd = isoOffset(3);        // hoy + 3 días
// Mes visible en el calendario de tarifas (YYYY-MM). null = el mes de rentalStart:
// así, al elegir fechas nuevas, el calendario vuelve solo a lo que se acaba de
// tocar en vez de quedarse donde el cliente navegó hace tres pantallas.
let calMonth = null;
// Primer clic de un rango a medio elegir (ISO), o null si no hay ninguno en
// curso. Efímero: no se guarda ni viaja al pedido.
let calPendingStart = null;

/* ---------------- Cálculos ---------------- */
function rentalDays(){ return daysBetween(rentalStart, rentalEnd); }
function isLate(r){ return r.end < isoOffset(0); }   // fecha límite ya pasó (ISO comparable)
function inCart(id){ return cart.some(c => c.id === id); }
/**
 * ¿La prenda está fuera, alquilada en un pedido vigente?
 * El stock NO se guarda en el producto: se deriva de `orders`, así sobrevive a
 * la recarga y la prenda vuelve sola al catálogo cuando el pedido se archiva
 * (mismo criterio que "prendas en alquiler" del perfil).
 * @param {number} id Id de la prenda.
 */
function isRented(id){
  return orders.some(o => !isPastOrder(o) && o.items.includes(id));
}
// Unidades realmente disponibles: stock menos lo alquilado y lo ya puesto en el
// carrito. Al ser ropa de segunda mano (`disponibles` = 1), alquilar una prenda
// la deja en 0 y desaparece del catálogo.
function unitsAvailable(p){
  return Math.max(0, p.disponibles - (isRented(p.id) ? 1 : 0) - (inCart(p.id) ? 1 : 0));
}
function cartCount(){ return cart.length; }
// Los montos se SUMAN en centavos (enteros) para evitar el arrastre de
// error de los float (p. ej. 0.1 + 0.2). Se devuelven en USD para la vista.
const cents = v => Math.round(v * 100);
// Precio de una prenda del carrito con los días y el volumen actuales.
function cartItemPrice(p){ return rentalPrice(p, rentalDays(), cart.length); }
function subtotal(){
  return cart.reduce((s,c) => s + cents(cartItemPrice(productById(c.id))), 0) / 100;
}
/**
 * Subtotal del carrito si el alquiler durase exactamente `days` días, sin tocar
 * las fechas elegidas. Base de las tarifas por día del calendario.
 * @param {number} days Días de alquiler (mínimo 1).
 * @returns {number} USD.
 */
function subtotalForDays(days){
  const d = Math.max(1, days);
  return cart.reduce((s,c) => s + cents(rentalPrice(productById(c.id), d, cart.length)), 0) / 100;
}

/**
 * Cuánto añade al total el día n-ésimo del alquiler (el día 1 es la base, no un
 * incremento). Sale de restar dos subtotales, así que respeta por construcción
 * los tramos, el descuento por volumen y el piso de coste: en las prendas
 * ancladas a su piso los días extra devuelven 0, que es justo lo que el
 * calendario quiere hacer visible.
 * @param {number} n Índice del día dentro del alquiler (1 = primero).
 * @returns {number} USD que suma ese día.
 */
function dayMarginalCost(n){
  if(n <= 1) return subtotalForDays(1);
  return (cents(subtotalForDays(n)) - cents(subtotalForDays(n - 1))) / 100;
}

// Precio del carrito SIN el descuento por volumen, para poder mostrar cuánto
// se ahorra el cliente por llevar varias prendas.
function subtotalBeforeVolume(){
  const days = rentalDays();
  return cart.reduce((s,c) => s + cents(rentalPrice(productById(c.id), days, 1)), 0) / 100;
}
// Tasa de descuento por volumen del carrito actual.
function volumeRate(){ return volumeDiscountRate(cart.length); }
// Ahorro en dólares por el descuento por volumen. Puede ser 0 aunque la tasa
// no lo sea: las prendas ancladas a su piso de coste no pueden bajar más.
function volumeSavings(){
  return (cents(subtotalBeforeVolume()) - cents(subtotal())) / 100;
}
// Depósito del carrito. Se deriva del valor de cada prenda y no baja por
// volumen ni por días: cubre riesgo, no uso.
function depositTotal(){
  return depositForItems(cart.map(c => productById(c.id)));
}
function shippingFee(){ return delivery === "ship" ? SHIPPING_FEE : 0; }
function returnFee(){ return returnMethod === "home" ? SHIPPING_FEE : 0; }
function grandTotal(){
  return (cents(subtotal()) + cents(depositTotal()) + cents(shippingFee())
        + cents(returnFee()) - cents(couponDiscount())) / 100;
}

/* ---------------- Premios canjeados (cupones) ----------------
   Un canje se guarda en profile.redeemed y vive ahí hasta que un pedido lo
   gasta. El descuento no se guarda: se deriva del premio y del alquiler, para
   que siga siendo correcto si el pedido cambia. */

// Canje por id (lo aplicado al checkout y lo enganchado a un pedido).
function couponById(id){ return profile.redeemed.find(c => c.id === id) || null; }
// Canjes todavía por usar, del más reciente al más antiguo. Un canje revocado
// (ver revokeOrderPoints) ya devolvió sus puntos al saldo: deja de ser gastable.
function availableCoupons(){ return profile.redeemed.filter(c => !c.usedIn && !c.revoked); }
// Siguiente número de canje (correlativo a partir de 1).
function nextCouponId(){ return profile.redeemed.reduce((m,c) => Math.max(m, c.id || 0), 0) + 1; }

// Contexto de descuento del CARRITO (checkout en curso).
function cartRewardCtx(){
  return {
    items: cart.map(c => productById(c.id)),
    days: rentalDays(),
    delivery,
    ret: returnMethod
  };
}
// Descuento del premio aplicado al checkout actual (0 si no hay ninguno).
function couponDiscount(){
  const c = couponById(appliedCoupon);
  return c ? rewardDiscount(rewardById(c.rewardId), cartRewardCtx()) : 0;
}
// Motivo por el que el premio aplicado no rebaja nada aquí (o null).
function couponIssue(){
  const c = couponById(appliedCoupon);
  return c ? rewardIssue(rewardById(c.rewardId), cartRewardCtx()) : null;
}

// Litros de agua ahorrados por una lista de prendas (ids) al reutilizarlas en
// lugar de fabricarlas nuevas. Suma garmentWater() de cada prenda.
function waterSavedForItems(ids){
  return ids.reduce((s, id) => s + garmentWater(productById(id)), 0);
}
// Litros de agua ahorrados con el carrito actual (para la confirmación del pedido).
function cartWaterSaved(){ return waterSavedForItems(cart.map(c => c.id)); }
// Litros de agua ahorrados por los alquileres ya CUMPLIDOS (ver countsForRewards).
// Contar un pedido todavía anulable era explotable: sus litros cruzaban una meta,
// la meta pagaba sus puntos, y anular el pedido devolvía los puntos del pedido
// pero no los de la meta — profile.waterGoals la da por cobrada para siempre.
function totalWaterSaved(){
  return orders.reduce((s, o) => s + (countsForRewards(o) ? waterSavedForItems(o.items) : 0), 0);
}

/* ---- Metas de agua ----
   Las metas se derivan de totalWaterSaved(), que a su vez sale de los pedidos:
   no se guarda ningún contador aparte que pudiera desincronizarse. Lo único
   que se persiste es QUÉ metas ya pagaron sus puntos (profile.waterGoals),
   porque eso sí es un hecho irreversible y no se puede recalcular. */

/** Metas ya alcanzadas con los litros ahorrados hasta ahora. */
function reachedWaterGoals(){
  const litros = totalWaterSaved();
  return WATER_GOALS.filter(g => litros >= g.liters);
}

/** Siguiente meta por alcanzar, o null si ya están todas. */
function nextWaterGoal(){
  const litros = totalWaterSaved();
  return WATER_GOALS.find(g => litros < g.liters) || null;
}

/**
 * Progreso hacia la siguiente meta, como fracción entre 0 y 1.
 * Con todas las metas cumplidas devuelve 1: la barra queda llena, no vacía.
 * El tramo se mide desde la meta anterior, no desde cero, o la barra se
 * quedaría casi llena para siempre a partir de la segunda meta.
 */
function waterGoalProgress(){
  const g = nextWaterGoal();
  if(!g) return 1;
  const previa = WATER_GOALS.filter(x => x.liters < g.liters).pop();
  const desde = previa ? previa.liters : 0;
  return Math.min(1, Math.max(0, (totalWaterSaved() - desde) / (g.liters - desde)));
}

/**
 * Acredita los puntos de las metas de agua recién alcanzadas.
 *
 * Idempotente: cada meta cobrada queda anotada en profile.waterGoals, así que
 * recargar la app no vuelve a pagarla. Se llama en los mismos sitios que
 * creditDeliveredPoints() — los litros solo cambian cuando cambian los pedidos.
 * @returns {Array<object>} Metas cobradas en esta llamada (vacío si ninguna).
 */
function creditWaterGoals(){
  if(!Array.isArray(profile.waterGoals)) profile.waterGoals = [];
  const nuevas = reachedWaterGoals().filter(g => !profile.waterGoals.includes(g.id));
  for(const g of nuevas){
    profile.points += g.points;
    profile.waterGoals.push(g.id);
  }
  return nuevas;
}

// Puntos que otorga el pedido actual: según el monto pagado (no reembolsable),
// los días de alquiler y la cantidad de prendas.
// Lo cubierto por un premio no vuelve a puntuar: si lo hiciera, canjear
// alimentaría el siguiente canje.
function orderPoints(){
  const spend = (cents(subtotal()) + cents(shippingFee()) + cents(returnFee())
               - cents(couponDiscount())) / 100;           // gasto no reembolsable
  return Math.round(spend * 10) + rentalDays() * 2 + cart.length * 5;
}

/* ---------------- Cálculos por PEDIDO (orders) ----------------
   Operan sobre un pedido ya confirmado (no sobre el carrito/checkout). */
function orderItemsSubtotal(o){
  const days = daysBetween(o.start, o.end);
  return o.items.reduce((s,id) => s + cents(rentalPrice(productById(id), days, o.items.length)), 0) / 100;
}
function orderDeposit(o){
  return depositForItems(o.items.map(id => productById(id)));
}
// Descuento que el premio del pedido le rebaja. Se recalcula (no se lee de un
// campo guardado) para que editar el pedido no deje el premio desactualizado:
// un "envío gratis" deja de valer si la devolución pasa a ser en el local.
function orderDiscount(o){
  if(!o.couponId) return 0;
  const c = couponById(o.couponId);
  if(!c) return 0;
  return rewardDiscount(rewardById(c.rewardId), {
    items: o.items.map(id => productById(id)),
    days: daysBetween(o.start, o.end),
    delivery: o.delivery,
    ret: o.ret
  });
}
// Valor total del cobro de un pedido (incluye depósito reembolsable + envío +
// devolución, menos el premio aplicado). Se usa para guardar/actualizar o.total.
function orderTotal(o){
  const ship = o.delivery === "ship" ? SHIPPING_FEE : 0;
  const ret  = o.ret === "home" ? SHIPPING_FEE : 0;
  return (cents(orderItemsSubtotal(o)) + cents(orderDeposit(o)) + cents(ship)
        + cents(ret) - cents(orderDiscount(o))) / 100;
}
// Estado del cobro del pedido — solo dos valores:
//   "Cancelado" = ya pagado/cobrado (status 'settled', sea efectivo o tarjeta).
//   "Pendiente" = aún por cobrar/pagar.
function paymentStatusLabel(o){
  if(o.status === "cancelled") return "Anulado";
  return o.status === "settled" ? "Cancelado" : "Pendiente";
}
// Un pedido pasa al historial ("Alquileres anteriores") cuando ya fue pagado
// (Cancelado) Y su período de alquiler terminó (la fecha de fin ya pasó).
function isArchivedOrder(o){ return o.status === "settled" && o.end < isoOffset(0); }
// Pedido anulado por el cliente antes de recibir las prendas.
function isCancelledOrder(o){ return o.status === "cancelled"; }
// Pedidos que ya NO están en curso: ni retienen prendas del catálogo ni se
// listan como activos. Agrupa los dos finales posibles (cumplido y anulado).
function isPastOrder(o){ return isArchivedOrder(o) || isCancelledOrder(o); }
/**
 * ¿El cliente todavía puede anular este pedido?
 * Solo mientras las prendas no estén en su poder: una vez llegada la fecha de
 * inicio ya fueron entregadas (o retiradas en local), y un pedido terminado o
 * ya anulado tampoco se toca. La app no tiene logística real, así que no puede
 * SABER si el paquete salió a reparto; eso se confirma con el cliente en el
 * diálogo de cancelOrder().
 * @param {object} o Pedido.
 */
function canCancelOrder(o){ return !isPastOrder(o) && isoOffset(0) <= o.start; }
/**
 * ¿Las prendas del pedido ya llegaron al cliente?
 * Sin logística real, la entrega se da por hecha al empezar el período: ese es
 * el día en que se envía o se retira en el local.
 * @param {object} o Pedido.
 */
function isDelivered(o){ return !isCancelledOrder(o) && o.start <= isoOffset(0); }
/**
 * ¿El pedido ya ganó sus recompensas: entregado y fuera de la ventana de anulación?
 *
 * Único umbral para TODO lo que premia un alquiler (puntos del pedido y litros
 * que alimentan las metas de agua). Mientras el pedido se pueda anular nada de
 * eso está ganado, y premiarlo antes es explotable: ver creditDeliveredPoints()
 * para el detalle del solapamiento entre `isDelivered` y `canCancelOrder`.
 * @param {object} o Pedido.
 */
function countsForRewards(o){ return isDelivered(o) && !canCancelOrder(o); }

/* ---------------- Reseñas ----------------
   Las de muestra (DEMO_REVIEWS) se mezclan al leer, nunca se guardan: así
   conviven con las del usuario sin ensuciar su almacenamiento, y retirarlas el
   día del backend es vaciar una constante. */

/**
 * Reseñas de una prenda, de la más reciente a la más antigua.
 * @param {number} id Id de la prenda.
 * @returns {object[]} Reseñas del usuario y las de muestra, mezcladas.
 */
function productReviews(id){
  return [...reviews, ...DEMO_REVIEWS]
    .filter(r => r.productId === id)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/**
 * Valoración media de una prenda. Se DERIVA, nunca se almacena: igual que el
 * precio y el descuento, para que borrar o editar una reseña no deje un
 * promedio mintiendo.
 * @param {number} id Id de la prenda.
 * @returns {number} Media de 1 a 5, o 0 si no tiene reseñas.
 */
function productRating(id){
  const rs = productReviews(id);
  if(!rs.length) return 0;
  return rs.reduce((s, r) => s + r.rating, 0) / rs.length;
}

/** ¿Ya reseñó el usuario esta prenda en este pedido? */
function reviewFor(orderId, productId){
  return reviews.find(r => r.orderId === orderId && r.productId === productId) || null;
}

/**
 * Prendas de un pedido que el usuario puede reseñar.
 *
 * Solo pedidos ya cumplidos, con el mismo umbral que los puntos y las metas de
 * agua (`countsForRewards`): reseñar algo que aún no se recibió es el agujero
 * que se cerró en las metas, y aquí sería peor porque queda publicado.
 * @param {object} o Pedido.
 * @returns {number[]} Ids de prendas reseñables (vacío si el pedido no cuenta).
 */
function reviewableItems(o){
  if(!o || !countsForRewards(o) || isCancelledOrder(o)) return [];
  return o.items;
}

/** ¿Queda alguna prenda de este pedido por reseñar? */
function hasPendingReview(o){
  return reviewableItems(o).some(id => !reviewFor(o.id, id));
}

/**
 * Guarda (o actualiza) la reseña del borrador y la persiste.
 * @returns {boolean} true si se guardó; false si faltaban datos.
 */
function saveReview(){
  if(!reviewProductId || !reviewRating) return false;
  const texto = reviewText.trim();
  const existente = reviewFor(reviewOrderId, reviewProductId);
  const datos = {
    productId: reviewProductId,
    orderId: reviewOrderId,
    rating: reviewRating,
    text: texto,
    photo: reviewPhoto || "",
    date: isoOffset(),
  };
  if(existente) Object.assign(existente, datos);
  else reviews.push({ id: `r${Date.now()}`, ...datos });
  saveState();
  return true;
}

/** Borra una reseña propia. Las de muestra no se pueden tocar: no son de nadie. */
function deleteReview(id){
  const i = reviews.findIndex(r => r.id === id);
  if(i < 0) return false;
  reviews.splice(i, 1);
  saveState();
  return true;
}
/**
 * Acredita los puntos de los pedidos ya entregados y FIRMES (no anulables).
 *
 * Los puntos premian el alquiler cumplido, no el cobro: por eso el disparador
 * es la entrega y no el pago (un efectivo pendiente ya disfrutó su prenda).
 * Como no hay tareas programadas, se liquida de forma perezosa: al arrancar la
 * sesión y al confirmar un pedido.
 *
 * La condición exige ADEMÁS que el pedido ya no se pueda anular, y no basta con
 * la entrega: `isDelivered` (start ≤ hoy) y `canCancelOrder` (hoy ≤ start) se
 * solapan justo el día de inicio. Acreditar en esa ventana permitía canjear los
 * puntos, anular el pedido y quedarse con el premio — la reversión devuelve
 * puntos, pero un premio ya canjeado no está en el saldo. Derivarlo de la
 * anulabilidad (y no de otra comparación de fechas) mantiene ambos lados
 * imposibles de solapar aunque las reglas de fechas cambien.
 * @returns {number} Puntos acreditados en esta pasada (0 si no hubo ninguno).
 */
function creditDeliveredPoints(){
  let sum = 0;
  orders.forEach(o => {
    if(o.pointsCredited || !countsForRewards(o)) return;
    profile.points += o.points;
    o.pointsCredited = true;
    sum += o.points;
  });
  return sum;
}

/**
 * Revierte los puntos de un pedido que deja de contar (anulado).
 *
 * Restar del saldo no basta: parte de esos puntos puede haberse convertido ya
 * en premios, que sobrevivirían a la reversión y dejarían al cliente con un
 * beneficio que ningún alquiler pagó. Por eso los canjes sin usar se revocan
 * (los más recientes primero, que son los que esos puntos financiaron) hasta
 * que el saldo alcance para pagar la reversión.
 *
 * Con creditDeliveredPoints() atado a la anulabilidad esto no debería ocurrir,
 * pero sí puede llegar por la migración de loadState(), que marca como
 * acreditados pedidos guardados que todavía admiten anulación.
 * @param {object} o Pedido anulado.
 * @returns {number} Canjes revocados para cubrir la reversión.
 */
function revokeOrderPoints(o){
  if(!o.pointsCredited) return 0;
  o.pointsCredited = false;
  let revocados = 0;
  while(profile.points < o.points){
    const c = availableCoupons()[0];   // redeemed se llena con unshift: [0] es el último canje
    if(!c) break;                      // nada más que recuperar: el resto se perdona
    c.revoked = true;
    profile.points += c.cost;
    revocados++;
  }
  profile.points = Math.max(0, profile.points - o.points);
  return revocados;
}
// Siguiente número de pedido (correlativo a partir de 1000).
function nextOrderId(){ return orders.reduce((m,o) => Math.max(m, o.id), 1000) + 1; }

/* ---------------- Persistencia (localStorage) ----------------
   Guarda solo los datos que deben sobrevivir a la recarga:
   carrito, perfil y prendas en alquiler. NO es backend: es
   almacenamiento del navegador. Si no está disponible, la app
   sigue funcionando en memoria (try/catch).

   El estado se guarda POR USUARIO: cada cuenta de Google tiene su propia
   clave `clothToGo:v4:user:<sub>`, para que dos cuentas en el mismo navegador
   no se pisen. El invitado NO persiste (clave nula): su carrito y pedidos
   viven solo en memoria y se descartan al cerrar — es una sesión de demo que
   no deja registro, tal como se le anuncia. La clave activa la fija la sesión
   (ver activateUserSession() en auth.js), no se conoce al cargar el archivo;
   por eso loadState() ya no se auto-ejecuta aquí. */
const STORAGE_PREFIX = "clothToGo:v4:user:";
let activeStorageKey = null;          // null = invitado (sin persistencia)

// Perfil recién inicializado (evita compartir referencia entre sesiones).
// waterGoals: ids de las metas de agua que YA pagaron sus puntos. Object.assign
// en loadState da la migración gratis: un perfil viejo entra con la lista vacía
// y cobra de una vez las metas que ya tenía ganadas.
function defaultProfile(){ return { name:"", email:"", phone:"", picture:"", points:0, redeemed:[], donations:[], waterGoals:[] }; }

// Clave de almacenamiento de un usuario, o null para el invitado (efímero).
function storageKeyFor(user){ return user && user.sub ? STORAGE_PREFIX + user.sub : null; }

// Restablece el estado a sus valores iniciales (arranque limpio al cambiar de
// sesión: al entrar como invitado o con otra cuenta).
function resetStateToDefaults(){
  cart = [];
  orders = [];
  reviews = [];      // las de otra cuenta no pueden asomar en esta sesión
  profile = defaultProfile();
}

function saveState(){
  if(!activeStorageKey) return;       // invitado: nada queda registrado
  try {
    localStorage.setItem(activeStorageKey, JSON.stringify({ cart, profile, orders, reviews }));
  } catch(e){ /* almacenamiento no disponible: continúa en memoria */ }
}
function loadState(){
  if(!activeStorageKey) return;       // invitado: sin datos previos que cargar
  try {
    const raw = localStorage.getItem(activeStorageKey);
    if(!raw) return;
    const s = JSON.parse(raw);
    if(Array.isArray(s.cart)) cart = s.cart;
    if(Array.isArray(s.reviews)) reviews = s.reviews;
    if(Array.isArray(s.orders)){
      orders = s.orders;
      // Migración: los pedidos guardados antes de "puntos al pagar" ya recibieron
      // sus puntos con la lógica anterior (y ya están en profile.points). Los
      // marcamos como acreditados para que ningún consumidor de pointsCredited
      // (la nota de "puntos pendientes", o el futuro backend/panel de cobros) los
      // trate como pendientes ni los vuelva a sumar. El centinela es `undefined`:
      // un pending NUEVO trae pointsCredited:false y NO debe pisarse a true.
      for(const o of orders){
        if(o.pointsCredited === undefined) o.pointsCredited = true;
        if(o.points === undefined) o.points = 0;
      }
    }
    if(s.profile && typeof s.profile === "object"){
      profile = Object.assign(defaultProfile(), s.profile);
      if(!Array.isArray(profile.redeemed)) profile.redeemed = [];
      if(!Array.isArray(profile.donations)) profile.donations = [];
      // Migración: los canjes anteriores solo eran una línea de historial (sin
      // id, sin premio asociado y sin forma de aplicarse). Se les completa la
      // identidad y se dan por DISPONIBLES: el cliente ya pagó esos puntos y
      // nunca recibió nada a cambio, así que honrarlos es lo correcto.
      let idSeq = 0;
      for(const c of profile.redeemed){
        if(c.id === undefined) c.id = ++idSeq;
        else idSeq = Math.max(idSeq, c.id);
        if(c.rewardId === undefined){
          const rw = REWARDS.find(r => r.name === c.name);
          c.rewardId = rw ? rw.id : null;
        }
        if(c.usedIn === undefined) c.usedIn = null;
        // Un canje sin premio reconocible (nombre cambiado en REWARDS) no puede
        // valorarse: se deja como historial, no como cupón utilizable.
        if(c.rewardId === null) c.usedIn = c.usedIn || "—";
      }
    }
  } catch(e){ /* datos corruptos: se usan los valores por defecto */ }
}
