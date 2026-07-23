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
//     pay:'cash'|'credit'|'debit', status:'settled'|'pending', total }
// - total : valor total del cobro del pedido (incluye depósito reembolsable).
//           Se recalcula si se edita el modo de devolución (cambia la tarifa).
// - status: 'settled' = pagado/cobrado → etiqueta "Cancelado";
//           'pending'  = pendiente de cobro/pago → etiqueta "Pendiente".
// loadState() puede sobreescribir esto si hay datos guardados.
let orders = [];
// Perfil: contacto + puntos acumulados + historial de canjes + donaciones.
let profile = { name:"", email:"", phone:"", points: 0, redeemed: [], donations: [] };
let lastEarnedPoints = 0;            // puntos ganados en el último pedido (para la confirmación)
let lastWaterSaved = 0;              // litros de agua ahorrados en el último pedido (para la confirmación/pop-up)
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
let delivery = null;                 // 'ship' | 'pickup'  — cómo RECIBE el pedido
let address = "";
let returnMethod = null;             // 'store' | 'home'  — cómo DEVUELVE al terminar
let returnAddress = "";              // dirección para el retiro a domicilio
let payMethod = null;                // 'cash' | 'credit' | 'debit'  — método de pago
let card = { number:"", name:"", expiry:"", cvv:"" };  // datos de tarjeta (no se procesan: backend)
// Edición del modo de devolución de un pedido (en el perfil)
let editingOrder = null;             // índice del pedido en edición (o null)
let editRet = null;                  // 'store' | 'home' (selección temporal)
let editRetAddr = "";                // dirección de retiro temporal
let rentalStart = isoOffset(0);      // hoy
let rentalEnd = isoOffset(3);        // hoy + 3 días

/* ---------------- Cálculos ---------------- */
function rentalDays(){ return daysBetween(rentalStart, rentalEnd); }
function isLate(r){ return r.end < isoOffset(0); }   // fecha límite ya pasó (ISO comparable)
function inCart(id){ return cart.some(c => c.id === id); }
// Unidades realmente disponibles (stock menos lo que ya está en el carrito).
function unitsAvailable(p){ return p.disponibles - (inCart(p.id) ? 1 : 0); }
function cartCount(){ return cart.length; }
// Los montos se SUMAN en centavos (enteros) para evitar el arrastre de
// error de los float (p. ej. 0.1 + 0.2). Se devuelven en USD para la vista.
const cents = v => Math.round(v * 100);
// Precio de una prenda del carrito con los días y el volumen actuales.
function cartItemPrice(p){ return rentalPrice(p, rentalDays(), cart.length); }
function subtotal(){
  return cart.reduce((s,c) => s + cents(cartItemPrice(productById(c.id))), 0) / 100;
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
  return (cents(subtotal()) + cents(depositTotal()) + cents(shippingFee()) + cents(returnFee())) / 100;
}

// Litros de agua ahorrados por una lista de prendas (ids) al reutilizarlas en
// lugar de fabricarlas nuevas. Suma garmentWater() de cada prenda.
function waterSavedForItems(ids){
  return ids.reduce((s, id) => s + garmentWater(productById(id)), 0);
}
// Litros de agua ahorrados con el carrito actual (para la confirmación del pedido).
function cartWaterSaved(){ return waterSavedForItems(cart.map(c => c.id)); }
// Litros de agua ahorrados en total por TODOS los pedidos (para el perfil).
function totalWaterSaved(){
  return orders.reduce((s, o) => s + waterSavedForItems(o.items), 0);
}

// Puntos que otorga el pedido actual: según el monto pagado (no reembolsable),
// los días de alquiler y la cantidad de prendas.
function orderPoints(){
  const spend = subtotal() + shippingFee() + returnFee();   // gasto no reembolsable
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
// Valor total del cobro de un pedido (incluye depósito reembolsable + envío +
// devolución). Se usa para guardar/actualizar o.total.
function orderTotal(o){
  const ship = o.delivery === "ship" ? SHIPPING_FEE : 0;
  const ret  = o.ret === "home" ? SHIPPING_FEE : 0;
  return (cents(orderItemsSubtotal(o)) + cents(orderDeposit(o)) + cents(ship) + cents(ret)) / 100;
}
// Estado del cobro del pedido — solo dos valores:
//   "Cancelado" = ya pagado/cobrado (status 'settled', sea efectivo o tarjeta).
//   "Pendiente" = aún por cobrar/pagar.
function paymentStatusLabel(o){
  return o.status === "settled" ? "Cancelado" : "Pendiente";
}
// Un pedido pasa al historial ("Alquileres anteriores") cuando ya fue pagado
// (Cancelado) Y su período de alquiler terminó (la fecha de fin ya pasó).
function isArchivedOrder(o){ return o.status === "settled" && o.end < isoOffset(0); }
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
function defaultProfile(){ return { name:"", email:"", phone:"", points:0, redeemed:[], donations:[] }; }

// Clave de almacenamiento de un usuario, o null para el invitado (efímero).
function storageKeyFor(user){ return user && user.sub ? STORAGE_PREFIX + user.sub : null; }

// Restablece el estado a sus valores iniciales (arranque limpio al cambiar de
// sesión: al entrar como invitado o con otra cuenta).
function resetStateToDefaults(){
  cart = [];
  orders = [];
  profile = defaultProfile();
}

function saveState(){
  if(!activeStorageKey) return;       // invitado: nada queda registrado
  try {
    localStorage.setItem(activeStorageKey, JSON.stringify({ cart, profile, orders }));
  } catch(e){ /* almacenamiento no disponible: continúa en memoria */ }
}
function loadState(){
  if(!activeStorageKey) return;       // invitado: sin datos previos que cargar
  try {
    const raw = localStorage.getItem(activeStorageKey);
    if(!raw) return;
    const s = JSON.parse(raw);
    if(Array.isArray(s.cart)) cart = s.cart;
    if(Array.isArray(s.orders)) orders = s.orders;
    if(s.profile && typeof s.profile === "object"){
      profile = Object.assign(defaultProfile(), s.profile);
      if(!Array.isArray(profile.redeemed)) profile.redeemed = [];
      if(!Array.isArray(profile.donations)) profile.donations = [];
    }
  } catch(e){ /* datos corruptos: se usan los valores por defecto */ }
}
