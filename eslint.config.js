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
  "DEPOSIT_DISCOUNT_PER_ITEM", "DEPOSIT_DISCOUNT_PER_DAY", "DEPOSIT_DISCOUNT_MAX", "depositDiscountRate",
  "IMG", "CATS", "PRODUCTS", "PRODUCT_BY_ID", "productById", "SIZE_ORDER", "SIZES", "REWARDS",
  "escapeHTML", "conditionLabel", "starStr", "fmtDate", "daysBetween", "imgPlaceholder",
  "isValidEmail", "isValidPhone", "isValidName", "isValidAddress",
  "isValidCardNumber", "isValidExpiry", "isValidCvv",
  "WATER_PER_KG", "LITERS_PER_GALLON", "garmentWater", "litersToGallons", "fmtLiters",
  "MATERIAL_LABELS", "materialLabel", "MATERIAL_ORDER", "MATERIALS",
  // state.js
  "isoOffset", "cart", "orders", "profile", "activeCat", "searchQuery",
  "qualityFilter", "sizeFilter", "materialFilter", "sortBy", "view", "detailId", "delivery", "address",
  "returnMethod", "returnAddress", "payMethod", "card",
  "editingOrder", "editRet", "editRetAddr", "lastEarnedPoints", "lastWaterSaved", "editingProfile",
  "donName", "donMethod", "donAddr", "donDate",
  "rentalStart", "rentalEnd",
  "rentalDays", "isLate", "inCart", "unitsAvailable", "cartCount", "cents", "subtotal",
  "depositBaseTotal", "depositRate", "depositTotal", "depositSavings",
  "shippingFee", "returnFee", "grandTotal", "orderPoints",
  "waterSavedForItems", "cartWaterSaved", "totalWaterSaved",
  "orderItemsSubtotal", "orderDeposit", "orderTotal", "paymentStatusLabel", "isArchivedOrder", "nextOrderId",
  "STORAGE_KEY", "saveState", "loadState",
  // dom.js
  "grid", "noResults", "resultsBar", "filtersEl", "overlay", "sheet", "sheetBody",
  "sheetFoot", "sheetTitle", "searchInput", "loginEl", "greeting", "backBtn",
  "SHEET_BACK", "openSheet", "closeSheet", "renderSheet", "updateBadge", "toastTimer", "toast",
  "modalOverlay", "modalText", "modalOk", "modalCancel", "onConfirmCb", "confirmDialog", "closeModal",
  "waterPop", "waterAmount", "waterMsg", "showWaterPop", "closeWaterPop",
  // catalog.js
  "renderFilters", "sortProducts", "filteredProducts", "anyFilterActive", "clearFilters",
  "activeFilterCount", "updateFilterBar", "renderFilterSheet",
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
  "enter", "loginHint", "showLoginHint",
  // api.js
  "API_BASE", "replaceCatalog", "hydrateCatalog"
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
      // builtinGlobals:false — si no, cada nombre de PROJECT_GLOBALS choca con
      // el archivo que de verdad lo define. Se sigue detectando la redeclaración
      // real dentro de un mismo archivo, que es lo que interesa.
      "no-redeclare": ["error", { "builtinGlobals": false }],
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-unreachable": "error",
      "no-cond-assign": ["error", "always"],
      "no-constant-condition": "warn",
      "no-empty": "off"                 // hay try/catch vacíos intencionales (persistencia)
    }
  }
];
