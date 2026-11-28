/* ============================================================
   CLOTH TO GO · state.js
   Estado global de la app, helper de fechas y cálculos derivados.
   Lo consumen los demás módulos (dom, catalog, checkout, profile, main).
   Depende de data.js (PRODUCTS, SHIPPING_FEE, daysBetween).
   ============================================================ */

/* ---------------- Helper de fecha ---------------- */
// Devuelve "YYYY-MM-DD" en hora LOCAL (no UTC) para evitar desfase de día
// cerca de medianoche en zonas como Guayaquil (UTC-5).
// El 0 por defecto ("hoy") no es comodidad: sin él, isoOffset() sumaba
// `undefined` y devolvía "NaN-NaN-NaN" en silencio, una fecha que se guarda,
// se ordena y se pinta sin que nada proteste.
function isoOffset(days = 0){
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
// Reseñas del propio cliente, en cualquier estado, tal como las devuelve
// GET /api/me/reviews. Viven en el servidor: aquí no se guardan.
let reviews = [];
// Reseñas publicadas de cada prenda (GET /api/products/:id/reviews), por id.
// Las pide el detalle al abrirse; una prenda sin entrada aún no se cargó.
let productReviewCache = {};
// Prenda y pedido que se están reseñando, y el borrador del formulario.
// Efímeros: un borrador a medias no merece sobrevivir a una recarga.
let reviewOrderId = null;
let reviewProductId = null;
let reviewRating = 0;
let reviewText = "";
// Vista previa (URL de objeto) y archivo ya reducido de la foto del borrador.
let reviewPhoto = "";
let reviewPhotoBlob = null;
// Perfil: contacto + puntos acumulados + canjes + donaciones.
// `redeemed` es a la vez historial y cartera: cada canje es un premio con
// nombre propio { id, rewardId, name, cost, date, usedIn } y sigue disponible
// mientras `usedIn` sea null (después guarda el id del pedido que lo gastó).
// La forma la define defaultProfile() y no un literal aquí: había dos y no
// coincidían (a este le faltaban `picture` y `waterGoals`), así que la sesión
// de invitado arrancaba con un perfil distinto del que deja cambiar de cuenta.
let profile = defaultProfile();
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
let donCoords = null;                // punto exacto de ese retiro, marcado en el mapa
let donDate = "";                    // fecha de la cita de retiro (si domicilio)
let activeCat = "Todo";
let searchQuery = "";
let qualityFilter = 0;               // estrellas mínimas (0 = todas)
let sizeFilter = "Todas";            // filtro por talla
let materialFilter = "Todos";        // filtro por material
let colorFilter = "Todos";           // filtro por color dominante
let sortBy = "default";              // ordenamiento del catálogo
// Grupo desplegado del panel de filtros (null = todos plegados). Es estado de
// presentación, no un filtro: no se persiste ni cuenta en el badge.
let openFilterGroup = null;
// Vista que pinta el panel deslizante. La lista completa, porque es el
// conmutador central de renderSheet() y quedarse corta manda a buscar una
// vista que sí existe:
//   cart | checkout | payment | done | detail | profile | rewards | review |
//   donate | filters | settings
let view = "cart";
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
let editRetCoords = null;            // punto exacto de esa dirección, marcado en el mapa
// Primer día hábil desde hoy, y tres días después (también hábil): no hay
// retiros ni devoluciones en fin de semana ni feriado (§6.0).
let rentalStart = nextBusinessDayISO(isoOffset(0));
let rentalEnd = nextBusinessDayISO(addDaysISO(rentalStart, 3));
// Mes visible en el calendario de tarifas (YYYY-MM). null = el mes de rentalStart:
// así, al elegir fechas nuevas, el calendario vuelve solo a lo que se acaba de
// tocar en vez de quedarse donde el cliente navegó hace tres pantallas.
let calMonth = null;
// Primer clic de un rango a medio elegir (ISO), o null si no hay ninguno en
// curso. Efímero: no se guarda ni viaja al pedido.
let calPendingStart = null;

/* ---------------- Cálculos ---------------- */
function rentalDays(){ return daysBetween(rentalStart, rentalEnd); }
// Fecha límite de devolución ya pasada (ISO comparable). La límite es el cierre
// de la ventana (`returnBy`), no el día elegido; un pedido guardado antes de las
// ventanas no la trae y se mide por su `end`.
function isLate(r){ return (r.returnBy || r.end) < isoOffset(0); }
/**
 * Lleva las fechas elegidas a días hábiles: el inicio al siguiente hábil (y
 * nunca al pasado), y la devolución al siguiente hábil posterior al inicio. Se
 * llama al cambiar una fecha a mano y al llegar el calendario de la API, que
 * puede declarar feriado un día que ya estaba elegido.
 * @param {boolean} [endAfterStart=true] Si la devolución debe ser estrictamente
 *   posterior al inicio (el calendario y la web lo exigen; un alquiler mínimo es
 *   de un día).
 */
function snapRentalDates(endAfterStart = true){
  const hoy = isoOffset(0);
  rentalStart = nextBusinessDayISO(rentalStart < hoy ? hoy : rentalStart);
  const minEnd = endAfterStart ? addDaysISO(rentalStart, 1) : rentalStart;
  rentalEnd = nextBusinessDayISO(rentalEnd < minEnd ? minEnd : rentalEnd);
}
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
/**
 * Ids de ejemplar del carrito: lo que de verdad se reserva. Cada modelo del
 * catálogo de la API trae sus ejemplares; se toma el primero disponible. Lo
 * comparten la app (placeOrder) y la web (placeWebOrder).
 * @returns {number[]|null} null si alguna prenda ya no tiene ejemplar libre.
 */
function cartItemIds(){
  const ids = cart.map(c => {
    const p = productById(c.id);
    const libre = p && Array.isArray(p.items) && p.items.find(i => i.available);
    return libre ? libre.id : null;
  });
  return ids.every(id => id !== null) ? ids : null;
}

// Los montos se SUMAN en centavos (enteros) para evitar el arrastre de
// error de los float (p. ej. 0.1 + 0.2). Se devuelven en USD para la vista.
const cents = v => Math.round(v * 100);
/* ---------------- Cotización del carrito (fase 3) ----------------
   Solo el servidor cotiza: `POST /api/quote` devuelve el alquiler de cada
   prenda, la logística, la garantía, el premio, los puntos y la escalera del
   carrito para el calendario. `quote` es la última respuesta y `quoteKey` dice
   de qué carrito/fechas/modos/premio es: si no coincide con lo que hay en
   pantalla, los importes valen null y la vista enseña "—" hasta que llegue la
   nueva (la pide requestQuote, en api.js). Nada de esto se guarda. */
let quote = null;
let quoteKey = "";

/** Lo que se manda a cotizar: lo mismo que viajará al confirmar el pedido. */
function cartQuoteBody(){
  return {
    items: cartItemIds(),
    start: rentalStart,
    end: rentalEnd,
    delivery: delivery || undefined,
    ret: returnMethod || undefined,
    couponId: appliedCoupon ?? undefined,
  };
}
/** Clave del carrito tal como está ahora (cambia con cualquier dato cotizable). */
function currentQuoteKey(){ return JSON.stringify(cartQuoteBody()); }
/** ¿La cotización guardada es la del carrito que se ve? */
function quoteReady(){ return !!quote && cart.length > 0 && quoteKey === currentQuoteKey(); }
/** Centavos → USD de un campo de la cotización vigente, o null. */
function quoteUsd(campo){ return quoteReady() ? quote[campo] / 100 : null; }

// Precio de una prenda del carrito: su línea RENTAL en la cotización.
function cartItemPrice(p){
  if(!quoteReady()) return null;
  const ids = cartItemIds() || [];
  const idx = cart.findIndex(c => c.id === p.id);
  const linea = quote.lines.find(l => l.type === "RENTAL" && l.itemId === ids[idx]);
  return linea ? linea.amountCents / 100 : null;
}
function subtotal(){ return quoteUsd("rentalCents"); }
/**
 * Subtotal del carrito si el alquiler durase exactamente `days` días, sin tocar
 * las fechas elegidas. Base de las tarifas por día del calendario: sale de la
 * escalera que manda la cotización.
 * @param {number} days Días de alquiler (mínimo 1).
 * @returns {number|null} USD.
 */
function subtotalForDays(days){
  if(!quoteReady() || !Array.isArray(quote.ladderCents)) return null;
  const d = Math.min(Math.max(1, days), quote.ladderCents.length);
  return quote.ladderCents[d - 1] / 100;
}

/**
 * Cuánto añade al total el día n-ésimo del alquiler (el día 1 es la base, no un
 * incremento). Resta dos peldaños de la escalera del servidor, así que respeta
 * los tramos, el volumen y el piso de coste sin conocerlos: en las prendas
 * ancladas a su piso los días extra devuelven 0.
 * @param {number} n Índice del día dentro del alquiler (1 = primero).
 * @returns {number|null} USD que suma ese día.
 */
function dayMarginalCost(n){
  const hoy = subtotalForDays(n);
  if(hoy === null) return null;
  if(n <= 1) return hoy;
  return (cents(hoy) - cents(subtotalForDays(n - 1))) / 100;
}

// Precio del carrito SIN el descuento por volumen, para enseñar el ahorro.
function subtotalBeforeVolume(){
  return quoteReady() ? (quote.rentalCents + quote.volumeSavingsCents) / 100 : null;
}
// Ahorro por el descuento por volumen. Puede ser 0 aunque haya varias prendas:
// las ancladas a su piso de coste no pueden bajar más.
function volumeSavings(){ return quoteUsd("volumeSavingsCents"); }
// Garantía del carrito: la de la cotización. No baja por volumen ni por días.
function depositTotal(){ return quoteUsd("depositCents"); }
// Cargos logísticos del CHECKOUT en curso: tarifa fija que se puede enseñar
// antes de cotizar; el cobro real viaja en la cotización.
function shippingFee(){ return deliveryFeeFor(delivery); }
function returnFee(){ return returnFeeFor(returnMethod); }
function grandTotal(){ return quoteUsd("totalCents"); }

/* ---------------- Premios canjeados (cupones) ----------------
   Un canje se guarda en profile.redeemed y vive ahí hasta que un pedido lo
   gasta. El descuento no se guarda: se deriva del premio y del alquiler, para
   que siga siendo correcto si el pedido cambia. */

// Canje por id (lo aplicado al checkout y lo enganchado a un pedido).
function couponById(id){ return profile.redeemed.find(c => c.id === id) || null; }
// Canjes todavía por usar, del más reciente al más antiguo. Un canje revocado
// (lo hace el servidor al anular un pedido ya premiado) ya devolvió sus puntos: deja de ser gastable.
function availableCoupons(){ return profile.redeemed.filter(c => !c.usedIn && !c.revoked); }

// Descuento del premio aplicado al checkout actual, según la cotización (0 si
// no hay premio o no rebaja nada; null mientras no haya cotización).
function couponDiscount(){
  if(appliedCoupon == null) return 0;
  return quoteUsd("discountCents");
}
// Motivo por el que el premio aplicado no rebaja nada aquí (o null).
function couponIssue(){
  return appliedCoupon != null && quoteReady() ? quote.couponIssue : null;
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
 * Adopta el estado de la cuenta que manda el servidor: pedidos, saldo, canjes y
 * metas de agua ya cobradas.
 *
 * Desde la fase 3 nada de esto se calcula ni se guarda en el navegador: el
 * servidor acredita los puntos (al entregar), revierte al anular y valida los
 * canjes. `orders` y los campos de puntos de `profile` son un ESPEJO con la
 * misma forma de antes, para que las vistas no cambien; se rellenan desde la
 * API al iniciar sesión y tras cada acción, y no se persisten.
 * @param {{orders?: object[], points?: object}} cuenta Respuestas de la API, ya
 *   traducidas (`orderFromApi`) o el resumen de GET /api/me/points.
 * @returns {Array<object>} Metas de agua que el servidor cobró desde la última
 *   vez (para felicitar), vacío si ninguna.
 */
function applyAccount({ orders: lista, points } = {}){
  if(Array.isArray(lista)) orders = lista.slice().sort((a, b) => a.id - b.id);
  if(!points) return [];
  const antes = Array.isArray(profile.waterGoals) ? profile.waterGoals : [];
  profile.points = points.balance;
  profile.redeemed = points.coupons.map(couponFromApi);
  profile.waterGoals = points.water.reached.slice();
  // Solo se felicita lo que se cobró con la app abierta: en el primer espejo de
  // la sesión `antes` está vacío y no hay nada "nuevo" que celebrar.
  if(accountSynced !== true) { accountSynced = true; return []; }
  return WATER_GOALS.filter(g => profile.waterGoals.includes(g.id) && !antes.includes(g.id));
}
// Si `applyAccount` ya recibió el estado de esta sesión al menos una vez.
let accountSynced = false;

// Puntos que otorgará el pedido actual: los calcula el servidor al cotizar,
// con la misma fórmula con que los fijará al crear el pedido.
function orderPoints(){ return quoteReady() ? quote.points : null; }

/* ---------------- Importes de un PEDIDO ya confirmado ----------------
   Vienen de la API (orderFromApi): el servidor los escribió en su libro de
   cargos. Aquí no se recalcula ninguno. */
// Garantía retenida del pedido.
function orderDeposit(o){ return typeof o.deposit === "number" ? o.deposit : 0; }
// Precio cobrado por una prenda del pedido: su línea RENTAL.
function orderItemPrice(o, p){ return o.itemPrices && p.id in o.itemPrices ? o.itemPrices[p.id] : null; }
// Estado del cobro del pedido — solo dos valores:
//   "Cancelado" = ya pagado/cobrado (status 'settled', sea efectivo o tarjeta).
//   "Pendiente" = aún por cobrar/pagar.
function paymentStatusLabel(o){
  if(o.status === ORDER_STATUS.CANCELLED) return "Anulado";
  return o.status === ORDER_STATUS.SETTLED ? "Cancelado" : "Pendiente";
}
/* ---- Estados de un pedido ----
   No hay un campo `estado` con estos valores: cada uno se DERIVA de `status`
   y de las fechas, y las seis funciones de abajo se llaman entre sí. La
   máquina que forman, escrita de una vez para no tener que reconstruirla
   leyendo:

     confirmado ──(llega o.start)──▶ entregado ──(pasa o.start)──▶ firme
          │                                                          │
          │ isDelivered=false                    countsForRewards=true
          │ canCancelOrder=true                                      │
          │                                          (pasa o.end, ya pagado)
          └──(el cliente anula)──▶ ANULADO                           ▼
                                   isCancelledOrder              ARCHIVADO
                                        └──────── isPastOrder ────────┘

   Tres cosas que conviene tener presentes:
   - `isDelivered` (start ≤ hoy) y `canCancelOrder` (hoy ≤ start) SE SOLAPAN el
     día de inicio. Por eso "entregado" y "firme" son estados distintos y no
     uno solo.
   - `countsForRewards` es la frontera de TODO lo que premia un alquiler
     (puntos, litros para las metas, poder reseñar). La corrigió fix-metas-agua
     (#50): premiar dentro de la ventana de anulación era explotable.
   - `isPastOrder` agrupa los dos finales (archivado y anulado) y es el que
     decide si la prenda vuelve al catálogo. */

// Un pedido pasa al historial ("Alquileres anteriores") cuando ya fue pagado
// (Cancelado) Y su período terminó: pasó la fecha límite de devolución, que es
// el cierre de la ventana (`returnBy`) y no el día elegido. Hasta entonces la
// prenda sigue reservada, igual que en el servidor.
function isArchivedOrder(o){ return o.status === ORDER_STATUS.SETTLED && (o.returnBy || o.end) < isoOffset(0); }
// Pedido anulado por el cliente antes de recibir las prendas.
function isCancelledOrder(o){ return o.status === ORDER_STATUS.CANCELLED; }
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
 * eso está ganado, y premiarlo antes es explotable: canjear, anular y quedarse
 * con el premio. Es la misma regla que `countsForRewards` en server/src/points.js,
 * que es quien de verdad acredita; aquí solo decide qué se muestra como cumplido.
 * @param {object} o Pedido.
 */
function countsForRewards(o){ return isDelivered(o) && !canCancelOrder(o); }

/* ---------------- Reseñas ----------------
   Viven en el servidor (fase 4) y todas pasan por moderación: el público solo
   ve las aprobadas, y cada cliente ve además las suyas con su estado. */

/** Cómo se llama, para su autor, una reseña propia que el público aún no ve. */
const REVIEW_STATUS_LABEL = { PENDIENTE: "En revisión", RECHAZADA: "No publicada", OCULTA: "Oculta" };

/**
 * Reseñas de una prenda, de la más reciente a la más antigua: las publicadas
 * y, para su autor, las suyas que aún no lo están.
 * @param {number} id Id de la prenda.
 * @returns {object[]}
 */
function productReviews(id){
  const publicadas = productReviewCache[id] ? productReviewCache[id].reviews : [];
  const vistas = new Set(publicadas.map(r => r.id));
  const mias = reviews.filter(r => r.productId === id && r.status !== "APROBADA" && !vistas.has(r.id));
  return [...publicadas, ...mias].sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/**
 * Valoración media de una prenda, sobre lo publicado. Se deriva en el servidor
 * a partir de las reseñas aprobadas y nunca se almacena: borrar o moderar una
 * reseña no puede dejar un promedio mintiendo.
 * @param {number} id Id de la prenda.
 * @returns {number} Media de 1 a 5, o 0 si no tiene reseñas publicadas.
 */
function productRating(id){
  return productReviewCache[id] ? productReviewCache[id].average || 0 : 0;
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
 * Retira una reseña propia (con su foto) en el servidor y la olvida aquí.
 * @param {number} id Reseña.
 * @returns {Promise<boolean>} true si se borró.
 */
async function deleteReview(id){
  const i = reviews.findIndex(r => r.id === id);
  if(i < 0) return false;
  const r = await apiFetch(`/api/reviews/${id}`, { method: "DELETE" });
  if(!r.ok) return false;
  const [quitada] = reviews.splice(reviews.findIndex(x => x.id === id), 1);
  delete productReviewCache[quitada.productId];
  return true;
}
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
// nameChangedAt: fecha ISO del último cambio de nombre HECHO POR EL USUARIO, o
// "" si nunca lo tocó. Vacío = tiene su cambio libre, y eso cubre gratis dos
// casos a la vez: el registro (aún no eligió nombre) y los perfiles guardados
// antes de que existiera la regla, que no deben quedar bloqueados por algo que
// no podían saber. Es estado, no derivado: no hay forma de deducir cuándo se
// cambió un nombre mirando el nombre.
function defaultProfile(){ return { name:"", email:"", phone:"", picture:"", nameChangedAt:"", points:0, redeemed:[], donations:[], waterGoals:[] }; }

/**
 * Días que faltan para poder volver a cambiar el nombre.
 * @returns {number} 0 si se puede cambiar ahora.
 */
function daysUntilNameChange(){
  if(!profile.nameChangedAt) return 0;
  const unlock = addDaysISO(profile.nameChangedAt, NAME_CHANGE_DAYS);
  const today = isoOffset();
  if(today >= unlock) return 0;   // "YYYY-MM-DD" ordena igual como texto que como fecha
  return daysBetween(today, unlock);
}

/** ¿El usuario puede cambiar su nombre hoy? */
function canChangeName(){ return daysUntilNameChange() === 0; }

/**
 * ¿El correo lo manda la cuenta de Google y por tanto no se edita aquí?
 * Con sesión de Google el correo ES la identidad con la que se inició sesión;
 * dejarlo editar crearía un perfil que dice un correo y una sesión que dice
 * otro, y el de la sesión ganaría en el siguiente inicio. El invitado sí lo
 * escribe: no tiene ninguna otra fuente.
 */
function emailIsManaged(){ return !!currentUser; }

// Clave de almacenamiento de un usuario, o null para el invitado (efímero).
function storageKeyFor(user){ return user && user.sub ? STORAGE_PREFIX + user.sub : null; }

// Restablece el estado a sus valores iniciales (arranque limpio al cambiar de
// sesión: al entrar como invitado o con otra cuenta).
function resetStateToDefaults(){
  cart = [];
  orders = [];
  accountSynced = false;
  reviews = [];      // las de otra cuenta no pueden asomar en esta sesión
  productReviewCache = {};
  profile = defaultProfile();
}

function saveState(){
  if(!activeStorageKey) return;       // invitado: nada queda registrado
  try {
    // Ni los pedidos ni los puntos: los guarda la base, y una copia local solo
    // podría quedarse vieja (o editarse desde la consola) sin cambiar nada.
    const { points, redeemed, waterGoals, ...datos } = profile;
    localStorage.setItem(activeStorageKey, JSON.stringify({ cart, profile: datos }));
  } catch(e){ /* almacenamiento no disponible: continúa en memoria */ }
}
function loadState(){
  if(!activeStorageKey) return;       // invitado: sin datos previos que cargar
  try {
    const raw = localStorage.getItem(activeStorageKey);
    if(!raw) return;
    const s = JSON.parse(raw);
    if(Array.isArray(s.cart)) cart = s.cart;
    // `s.reviews` (reseñas guardadas antes de la fase 4) se ignora: las reseñas
    // viven en el servidor, con alquiler verificado y moderación.
    // `s.orders` (pedidos guardados antes de la fase 3) se ignora a propósito:
    // los pedidos viven en la base y llegan con applyAccount().
    if(s.profile && typeof s.profile === "object"){
      // Object.assign sobre defaultProfile() es la migración de los campos
      // nuevos (picture, waterGoals): un perfil viejo entra con el valor por
      // defecto en vez de con un hueco.
      // Los puntos guardados por versiones anteriores tampoco se adoptan: el
      // saldo lo da el servidor, desde cero (§2 de PENDIENTE).
      const { points, redeemed, waterGoals, ...datos } = s.profile;
      profile = Object.assign(defaultProfile(), datos);
      if(!Array.isArray(profile.donations)) profile.donations = [];
    }
  } catch(e){ /* datos corruptos: se usan los valores por defecto */ }
}
