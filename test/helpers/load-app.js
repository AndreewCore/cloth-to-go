/**
 * Carga los classic scripts del frontend (js/*.js) en un contexto `vm`
 * compartido, imitando el scope global único que tienen en el navegador, y
 * expone una API para testearlos SIN modificar los archivos de la app.
 *
 * Por qué vm: los archivos no usan import/export (restricción del proyecto para
 * abrir en file://). En `vm`, las `function` de nivel superior sí quedan como
 * globales, pero las `const`/`let` no; por eso concatenamos data.js + state.js
 * con un "trailer" que —ejecutándose en el mismo scope léxico— captura los
 * símbolos y los publica en `__APP__`, incluyendo setters para el estado mutable.
 */
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const JS_DIR = path.join(__dirname, "..", "..", "js");

// Trailer inyectado tras los archivos: corre en el mismo scope léxico, así que
// puede leer y reasignar las const/let/function declaradas arriba.
const EXPORT_TRAILER = `
globalThis.__APP__ = {
  // --- Precios (data.js) ---
  rentalPrice, rentalListPrice, rentalFloor, nextDayPrice, cycleCost,
  garmentCycles, volumeDiscountRate, depositFor, depositForItems,
  // --- Constantes ---
  SHIPPING_FEE, DEPOSIT_MAX, DEPOSIT_ORDER_MAX, MIN_MARGIN,
  // --- Helpers puros (data.js) ---
  escapeHTML, fmtDate, daysBetween, starStr, conditionLabel, materialLabel,
  garmentWater, litersToGallons,
  isValidEmail, isValidPhone, isValidName, isValidAddress,
  isValidCardNumber, isValidExpiry, isValidCvv,
  PRODUCTS, productById,
  // --- Estado y cálculos derivados (state.js) ---
  isoOffset, cents, rentalDays, isLate, isArchivedOrder, isCancelledOrder, isPastOrder,
  canCancelOrder, isDelivered, creditDeliveredPoints, isRented, unitsAvailable, inCart,
  totalWaterSaved,
  subtotal, subtotalBeforeVolume, volumeSavings, depositTotal, grandTotal,
  orderItemsSubtotal, orderDeposit, orderTotal, paymentStatusLabel, orderPoints,
  // --- Control del estado mutable para los tests ---
  setState(patch){
    if ('cart'         in patch) cart = patch.cart;
    if ('orders'       in patch) orders = patch.orders;
    if ('delivery'     in patch) delivery = patch.delivery;
    if ('returnMethod' in patch) returnMethod = patch.returnMethod;
    if ('rentalStart'  in patch) rentalStart = patch.rentalStart;
    if ('rentalEnd'    in patch) rentalEnd = patch.rentalEnd;
  },
};
`;

/**
 * Ejecuta data.js + state.js en un contexto vm limpio y devuelve la API (`__APP__`).
 * Cada llamada crea un contexto aislado, así los tests no comparten estado.
 * @returns {object} API con las funciones y el setter `setState`.
 */
function loadApp() {
  // Stubs mínimos: estos módulos no tocan el DOM a nivel top-level, pero
  // dejamos localStorage/console por si alguna ruta los roza.
  const sandbox = {
    console,
    localStorage: {
      _d: {},
      getItem(k) {
        return k in this._d ? this._d[k] : null;
      },
      setItem(k, v) {
        this._d[k] = String(v);
      },
      removeItem(k) {
        delete this._d[k];
      }
    }
  };
  vm.createContext(sandbox);

  const source =
    fs.readFileSync(path.join(JS_DIR, "data.js"), "utf8") +
    "\n" +
    fs.readFileSync(path.join(JS_DIR, "state.js"), "utf8") +
    "\n" +
    EXPORT_TRAILER;

  vm.runInContext(source, sandbox, { filename: "app-bundle.js" });
  return sandbox.__APP__;
}

module.exports = { loadApp };
