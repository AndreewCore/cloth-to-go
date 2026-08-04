/**
 * Carga la app COMPLETA en un DOM real (jsdom) para probar el flujo de UI:
 * render de vistas, estados de botones, escape en pantalla y los side effects
 * de placeOrder() y la migración. Complementa a load-app.js (que solo prueba
 * la lógica pura de data.js/state.js sin DOM).
 *
 * Se cargan los classic scripts en el ORDEN de index.html, salvo main.js: los
 * tests invocan las funciones directamente, así se evita el init de main
 * (fetch del catálogo, SDK de Google) que no aporta a estas pruebas.
 *
 * Igual que load-app.js, los archivos se CONCATENAN en un único runInContext:
 * los `const`/`let` de nivel superior solo se comparten entre archivos si viven
 * en el mismo scope léxico (ejecutados por separado no se verían entre sí).
 */
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..", "..");
const JS_DIR = path.join(ROOT, "js");

// Orden estricto de index.html, sin main.js.
const FILES = [
  "icons.js", "prefs.js", "data.js", "state.js", "dom.js", "catalog.js",
  "checkout.js", "profile.js", "api.js", "auth.js", "maps.js"
];

// `withMain: true` añade main.js al final, que es donde vive TODO el reparto de
// eventos. Sin él no hay forma de probar la delegación: los tests llaman a las
// funciones a mano y el `switch` —el sitio donde más barato es olvidar un
// `case`— nunca se ejecuta. Va detrás de una opción y no por defecto porque
// arrastra el init de la app (hidratar el catálogo, SDK de Google), ruido para
// las pruebas que solo quieren una vista.
const MAIN = "main.js";

// Trailer inyectado al final: corre en el mismo scope léxico, así puede leer y
// reasignar el estado mutable (cart/orders/…) y tocar el modal (onConfirmCb es
// un `let` de dom.js, invisible desde fuera del scope).
const EXPORT_TRAILER = `
globalThis.__APP__ = {
  get cart(){return cart;},         set cart(v){cart=v;},
  get orders(){return orders;},     set orders(v){orders=v;},
  get profile(){return profile;},   set profile(v){profile=v;},
  get view(){return view;},         set view(v){view=v;},
  get lastOrder(){return lastOrder;},
  get currentUser(){return currentUser;}, set currentUser(v){currentUser=v;},
  get payMethod(){return payMethod;},
  // Fija los campos de checkout/pago de una sola vez para preparar un caso.
  setCheckout(p){
    if('delivery'      in p) delivery      = p.delivery;
    if('address'       in p) address       = p.address;
    if('returnMethod'  in p) returnMethod  = p.returnMethod;
    if('returnAddress' in p) returnAddress = p.returnAddress;
    if('payMethod'     in p) payMethod     = p.payMethod;
    if('card'          in p) card          = p.card;
    if('addressCoords'       in p) addressCoords       = p.addressCoords;
    if('returnAddressCoords' in p) returnAddressCoords = p.returnAddressCoords;
    if('rentalStart'   in p) rentalStart   = p.rentalStart;
    if('rentalEnd'     in p) rentalEnd     = p.rentalEnd;
    if('appliedCoupon' in p) appliedCoupon = p.appliedCoupon;
  },
  get appliedCoupon(){ return appliedCoupon; },
  // Campos del checkout que las pruebas de validación leen tras un reset.
  get delivery(){ return delivery; },
  get returnMethod(){ return returnMethod; },
  get card(){ return card; },
  // Persistencia, para probar la migración de loadState: fija la clave activa
  // (normalmente la pone activateUserSession) y carga lo sembrado en localStorage.
  STORAGE_PREFIX,
  loadFromKey(key){ activeStorageKey = key; loadState(); },
  // Acepta el modal de confirmación: replica lo que hace modalOk.onclick en
  // main.js (excluido de esta carga), necesario para las acciones que confirman.
  confirmModalOk(){ const cb = onConfirmCb; closeModal(); if(cb) cb(); },
  get modalMessage(){ return modalText.textContent; },
  get modalHTML(){ return document.getElementById("modal").innerHTML; },
  // Selector de ubicación (maps.js). Las coordenadas son variables del scope
  // compartido, invisibles desde fuera igual que el resto del checkout.
  get addressCoords(){ return addressCoords; },
  get returnAddressCoords(){ return returnAddressCoords; },
  mapsAvailable, applyPickedLocation, clearPickedLocation, mapPickerButtonHTML, isValidAddress,
  get address(){ return address; },
  get returnAddress(){ return returnAddress; },
  // La clave escrita en el código, no la efectiva: es la que vigila el guardrail
  // de "nada de claves commiteadas". La efectiva sale de mapsApiKey().
  get hardcodedMapsKey(){ return GOOGLE_MAPS_API_KEY; },
  mapsApiKey, adoptMapsKeyFromUrl, MAPS_OVERRIDE_KEY, addressReady, addressFieldHTML,
  ADDRESS_FIELDS, addressField, addressFieldByInput,
  // Premios: el catálogo y los derivados del canje aplicado.
  REWARDS, SHIPPING_FEE, rewardById, rewardDiscount, rewardIssue,
  couponById, availableCoupons, couponDiscount, couponIssue, cartRewardCtx, orderDiscount,
  get products(){ return PRODUCTS; },
  // Filtros y orden: son variables let de state.js, invisibles fuera del scope.
  setFilters(p){
    if('activeCat'      in p) activeCat      = p.activeCat;
    if('searchQuery'    in p) searchQuery    = p.searchQuery;
    if('qualityFilter'  in p) qualityFilter  = p.qualityFilter;
    if('sizeFilter'     in p) sizeFilter     = p.sizeFilter;
    if('materialFilter' in p) materialFilter = p.materialFilter;
    if('colorFilter'    in p) colorFilter    = p.colorFilter;
    if('sortBy'         in p) sortBy         = p.sortBy;
  },
  get colorFilter(){ return colorFilter; },
  COLORS, COLOR_LABELS, colorLabel, colorSwatch, colorCount,
  CATS, SIZE_SCALES, SIZES, sizeScale, sizesInScale, garmentWater,
  LOCAL, localCardHTML,
  // Formulario de donación y editor de devolución (también variables let).
  setDonation(p){
    if('donName'   in p) donName   = p.donName;
    if('donMethod' in p) donMethod = p.donMethod;
    if('donAddr'   in p) donAddr   = p.donAddr;
    if('donCoords' in p) donCoords = p.donCoords;
    if('donDate'   in p) donDate   = p.donDate;
  },
  get donAddr(){ return donAddr; },
  get donCoords(){ return donCoords; },
  donateValid, renderDonate, submitDonation, openDonate,
  setReturnEdit(p){
    if('editRet'       in p) editRet       = p.editRet;
    if('editRetAddr'   in p) editRetAddr   = p.editRetAddr;
    if('editRetCoords' in p) editRetCoords = p.editRetCoords;
  },
  get editRet(){ return editRet; },
  get editRetAddr(){ return editRetAddr; },
  get editRetCoords(){ return editRetCoords; },
  // Pop-up del modo de devolución: vive fuera del panel, así que su estado
  // abierto/cerrado no se lee del sheet como el resto de las vistas.
  openReturnEditor, closeReturnEditor, saveReturn, renderReturnEditor, returnEditorHTML,
  get retEditorOpen(){ return document.getElementById("retOverlay").classList.contains("show"); },
  get retEditorHTML(){ return document.getElementById("retModalBody").innerHTML; },
  get editingOrder(){ return editingOrder; },
  get backend(){ return backend; },
  get productCount(){ return PRODUCTS.length; },
  get activeStorageKey(){ return activeStorageKey; },
  // Puros, para aserciones sin recalcular a mano.
  orderPoints, orderTotal, orderDeposit, isoOffset, productById,
  storageKeyFor, decodeJwt, resolveApiBase, backendForHost, isMixedContent,
  SHEET_BACK,
  getPrefs, setPref, toggleTheme, effectiveTheme, applyPrefs, loadPrefs,
  shouldReduceMotion, PREFS_KEY, DEFAULT_PREFS,
  isProductionHost, PRODUCTION_HOSTS, API_OFF_REASONS,
  // Metas de ahorro de agua. waterPointsCredited() es el saldo que las metas
  // aportan por su cuenta: los tests de puntos por pedido lo restan para no
  // confundir "el pedido no ha acreditado" con "el saldo es cero".
  WATER_GOALS, totalWaterSaved, waterSavedForItems, reachedWaterGoals, nextWaterGoal,
  waterGoalProgress, creditWaterGoals, waterGoalHTML, toggleWaterGoalInfo,
  renderProfile, renderSheet, fmtLiters, countsForRewards,
  waterPointsCredited(){
    return (profile.waterGoals || []).reduce(
      (s, id) => s + (WATER_GOALS.find(g => g.id === id)?.points || 0), 0);
  },
  get lastWaterGoals(){ return lastWaterGoals; },
  // Compartido por el checkout y el calendario: fechas y derivados de precio.
  // Son variables let del scope común, invisibles desde fuera.
  subtotal, subtotalForDays, depositTotal, couponDiscount, grandTotal,
  waterSavedForItems, SHIPPING_FEE, rentalPrice,
  rentalDays, renderSheet, fmtDate,
  get rentalStart(){ return rentalStart; },
  get rentalEnd(){ return rentalEnd; },
  // Confirmación del pedido. placeOrder sigue expuesto en window (los tests
  // viejos lo llaman suelto); esto es el paso de resumen que lo precede.
  confirmOrder, confirmDetailHTML, checkoutValid, paymentValid, redeem, closeModal,
  get modalOkLabel(){ return modalOk.textContent; },
  get modalCancelHidden(){ return modalCancel.classList.contains("is-hidden"); },
  get modalOpen(){ return modalOverlay.classList.contains("show"); },
  // Detalle desde imagen: pestaña apilada sobre el perfil.
  openDetail, openSheet, closeSheet, closeStackSheet,
  // Baja de cuenta.
  deleteAccount, askDeleteAccount, renderSettings, signOut,
  // Acuse de recibo al agregar al carrito.
  addToCart, flyToCart, bumpBadge, updateBadge,
  // Reseñas.
  productReviews, productRating, reviewFor, reviewableItems, hasPendingReview,
  openReview, reviewValid, submitReview, deleteReview, DEMO_REVIEWS,
  get reviews(){ return reviews; },               set reviews(v){ reviews = v; },
  get reviewProductId(){ return reviewProductId; }, set reviewProductId(v){ reviewProductId = v; },
  get reviewOrderId(){ return reviewOrderId; },
  get reviewRating(){ return reviewRating; },     set reviewRating(v){ reviewRating = v; },
  get reviewText(){ return reviewText; },         set reviewText(v){ reviewText = v; },
  get reviewPhoto(){ return reviewPhoto; },       set reviewPhoto(v){ reviewPhoto = v; },
  // Galería del detalle.
  productImages, coverImage, galleryHTML, moveGallery, showGalleryImage,
  get detailImg(){ return detailImg; }, set detailImg(v){ detailImg = v; },
  get sheetOpen(){ return sheet.classList.contains("show"); },
  get sheetFull(){ return sheet.classList.contains("full"); },
  get stackOpen(){ return sheetStack.classList.contains("show"); },
  get stackedDetail(){ return stackedDetail; },
  get detailId(){ return detailId; },
  // Calendario de tarifas.
  addDaysISO, monthOf, shiftMonth, monthLabel, monthGrid, dayMarginalCost,
  calVisibleMonth, calDayIndex, calDayCost, pickCalendarDay, shiftCalendar,
  get calPendingStart(){ return calPendingStart; },
};
`;

/**
 * Monta un DOM limpio con la app cargada.
 * @param {object} [opts] Ajustes del entorno, para los módulos que leen el
 *   contexto al cargarse (api.js resuelve `backend` en su nivel superior):
 *   - `url`: origen de la página (protocolo/host que ven api.js y auth.js).
 *   - `storage`: pares clave/valor sembrados en localStorage ANTES de ejecutar
 *     los scripts, única forma de probar el override del backend.
 *   - `withMain`: carga también main.js, con su reparto de eventos y su init.
 * @returns {{window, document, app}} `app` es la API __APP__ del trailer.
 */
function loadDom(opts = {}) {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const dom = new JSDOM(html, {
    // outside-only: NO ejecuta los <script> del HTML (ni baja el SDK de Google),
    // pero habilita getInternalVMContext() para correr los scripts nosotros.
    runScripts: "outside-only",
    // http por defecto (no file://): localStorage/location válidos.
    url: opts.url || "https://cloth.test/",
    pretendToBeVisual: true
  });
  for (const [k, v] of Object.entries(opts.storage || {})) {
    dom.window.localStorage.setItem(k, v);
  }
  const ctx = dom.getInternalVMContext();
  const archivos = opts.withMain ? [...FILES, MAIN] : FILES;
  // El init de main.js hidrata el catálogo contra la API. jsdom no trae fetch en
  // todas las versiones y aquí no hay servidor: se deja uno que siempre rechaza,
  // que es el camino de degradación real de api.js (sin backend, catálogo
  // embebido). Sin esto la promesa quedaría suelta y el runner lo reporta.
  if (opts.withMain && !dom.window.fetch) dom.window.fetch = () => Promise.reject(new Error("sin backend"));
  const source =
    archivos.map(f => fs.readFileSync(path.join(JS_DIR, f), "utf8")).join("\n") +
    "\n" + EXPORT_TRAILER;
  vm.runInContext(source, ctx, { filename: "app-bundle.js" });

  const { window } = dom;
  return { window, document: window.document, app: window.__APP__ };
}

module.exports = { loadDom };
