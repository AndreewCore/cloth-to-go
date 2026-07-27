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
  "data.js", "state.js", "dom.js", "catalog.js",
  "checkout.js", "profile.js", "api.js", "auth.js"
];

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
    if('rentalStart'   in p) rentalStart   = p.rentalStart;
    if('rentalEnd'     in p) rentalEnd     = p.rentalEnd;
  },
  // Persistencia, para probar la migración de loadState: fija la clave activa
  // (normalmente la pone activateUserSession) y carga lo sembrado en localStorage.
  STORAGE_PREFIX,
  loadFromKey(key){ activeStorageKey = key; loadState(); },
  // Acepta el modal de confirmación: replica lo que hace modalOk.onclick en
  // main.js (excluido de esta carga), necesario para las acciones que confirman.
  confirmModalOk(){ const cb = onConfirmCb; closeModal(); if(cb) cb(); },
  get modalMessage(){ return modalText.textContent; },
  // Puros, para aserciones sin recalcular a mano.
  orderPoints, orderTotal, orderDeposit, isoOffset, productById,
};
`;

/**
 * Monta un DOM limpio con la app cargada.
 * @returns {{window, document, app}} `app` es la API __APP__ del trailer.
 */
function loadDom() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const dom = new JSDOM(html, {
    // outside-only: NO ejecuta los <script> del HTML (ni baja el SDK de Google),
    // pero habilita getInternalVMContext() para correr los scripts nosotros.
    runScripts: "outside-only",
    url: "https://cloth.test/",    // http (no file://): localStorage/location válidos
    pretendToBeVisual: true
  });
  const ctx = dom.getInternalVMContext();
  const source =
    FILES.map(f => fs.readFileSync(path.join(JS_DIR, f), "utf8")).join("\n") +
    "\n" + EXPORT_TRAILER;
  vm.runInContext(source, ctx, { filename: "app-bundle.js" });

  const { window } = dom;
  return { window, document: window.document, app: window.__APP__ };
}

module.exports = { loadDom };
