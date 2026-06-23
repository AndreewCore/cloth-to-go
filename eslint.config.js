// ============================================================
// CLOTH TO GO · configuración de ESLint (v9, flat config)
//
// El proyecto usa scripts clásicos que comparten ÁMBITO GLOBAL (sin
// módulos ES, para que la demo abra con file://). Por eso:
//   - declaramos aquí los globales del propio proyecto (no-undef útil), y
//   - desactivamos no-unused-vars (una función se define en un archivo y
//     se usa en otro, lo que daría falsos positivos por-archivo).
// Migrar a módulos ES (con un servidor local) permitiría un linting más estricto.
// ============================================================
const globals = require("globals");

// Globales reales del proyecto (definidos en el nivel superior de algún js/).
const PROJECT_GLOBALS = [
  // data.js
  "LOCAL", "SHIPPING_FEE", "LATE_GRACE_DAYS", "LATE_PENALTY",
  "IMG", "CATS", "PRODUCTS", "PRODUCT_BY_ID", "productById", "SIZE_ORDER", "SIZES", "REWARDS",
  "escapeHTML", "conditionLabel", "starStr", "fmtDate", "daysBetween", "imgPlaceholder",
  "isValidEmail", "isValidPhone", "isValidName", "isValidAddress",
  "isValidCardNumber", "isValidExpiry", "isValidCvv",
  // state.js
  "isoOffset", "cart", "orders", "profile", "activeCat", "searchQuery",
  "qualityFilter", "sizeFilter", "sortBy", "view", "detailId", "delivery", "address",
  "returnMethod", "returnAddress", "payMethod", "card",
  "editingOrder", "editRet", "editRetAddr", "lastEarnedPoints", "editingProfile",
  "donName", "donMethod", "donAddr", "donDate",
  "rentalStart", "rentalEnd",
  "rentalDays", "isLate", "inCart", "unitsAvailable", "cartCount", "cents", "subtotal",
  "depositTotal", "shippingFee", "returnFee", "grandTotal", "orderPoints",
  "orderItemsSubtotal", "orderDeposit", "orderTotal", "paymentStatusLabel", "isArchivedOrder", "nextOrderId",
  "STORAGE_KEY", "saveState", "loadState",
  // dom.js
  "grid", "noResults", "resultsBar", "filtersEl", "overlay", "sheet", "sheetBody",
  "sheetFoot", "sheetTitle", "searchInput", "loginEl", "greeting", "backBtn",
  "SHEET_BACK", "openSheet", "closeSheet", "renderSheet", "updateBadge", "toastTimer", "toast",
  "modalOverlay", "modalText", "modalOk", "modalCancel", "onConfirmCb", "confirmDialog", "closeModal",
  // catalog.js
  "renderFilters", "sortProducts", "filteredProducts", "anyFilterActive", "clearFilters",
  "renderGrid", "addToCart", "openDetail", "renderDetail",
  // checkout.js
  "dateBoxHTML", "renderCart", "removeItem", "renderCheckout",
  "checkoutValid", "renderPayment", "paymentValid", "placeOrder", "renderDone", "finishOrder",
  // profile.js
  "renderProfile", "saveProfile", "editProfile", "cancelProfileEdit", "toggleLateInfo",
  "returnEditorHTML", "openReturnEditor", "closeReturnEditor", "saveReturn",
  "renderRewards", "redeem",
  "openDonate", "donateValid", "renderDonate", "submitDonation",
  // main.js
  "enter"
];

const projectGlobals = Object.fromEntries(PROJECT_GLOBALS.map(n => [n, "writable"]));

module.exports = [
  {
    files: ["js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { ...globals.browser, ...projectGlobals }
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": "off",          // ver nota de cabecera
      "eqeqeq": ["warn", "smart"],
      "no-redeclare": "error",
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-unreachable": "error",
      "no-cond-assign": ["error", "always"],
      "no-constant-condition": "warn",
      "no-empty": "off"                 // hay try/catch vacíos intencionales (persistencia)
    }
  }
];
