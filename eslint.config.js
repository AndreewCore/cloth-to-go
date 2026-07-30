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
  // icons.js
  "ICON_PATHS", "icon",
  // prefs.js
  "PREFS_KEY", "DEFAULT_PREFS", "TEXT_SCALES", "prefs", "loadPrefs", "savePrefs",
  "systemPrefersDark", "effectiveTheme", "shouldReduceMotion", "applyPrefs",
  "getPrefs", "setPref", "toggleTheme", "renderThemeButton", "watchSystemTheme",
  // data.js
  "LOCAL", "SHIPPING_FEE", "LATE_GRACE_DAYS", "LATE_PENALTY",
  "LAUNDRY_BY_MATERIAL", "OVERHEAD_PER_CYCLE", "CYCLES_PER_STAR", "MIN_MARGIN",
  "garmentCycles", "cycleCost", "DAY1_RATE_BY_STARS", "DAY_TRAMOS",
  "VOLUME_DISCOUNT_PER_ITEM", "VOLUME_DISCOUNT_MAX", "volumeDiscountRate",
  "rentalListPrice", "rentalFloor", "rentalPrice", "nextDayPrice",
  "DEPOSIT_RATE", "DEPOSIT_MAX", "DEPOSIT_ORDER_MAX", "depositFor", "depositForItems",
  "IMG", "CATS", "PRODUCTS", "PRODUCT_BY_ID", "productById", "SIZE_ORDER", "SIZES",
  "REWARDS", "REWARD_BY_ID", "rewardById", "premiumItem", "rewardDiscount", "rewardIssue",
  "escapeHTML", "conditionLabel", "starStr", "fmtDate", "daysBetween", "imgPlaceholder",
  "MESES_LARGOS", "addDaysISO", "monthOf", "shiftMonth", "monthLabel", "monthGrid",
  "isValidEmail", "isValidPhone", "isValidName", "isValidAddress",
  "isValidCardNumber", "isValidExpiry", "isValidCvv",
  "WATER_PER_KG", "LITERS_PER_GALLON", "garmentWater", "litersToGallons", "fmtLiters",
  "MATERIAL_LABELS", "materialLabel", "MATERIAL_ORDER", "MATERIALS",
  // state.js
  "isoOffset", "cart", "orders", "profile", "activeCat", "searchQuery",
  "qualityFilter", "sizeFilter", "materialFilter", "sortBy", "view", "detailId", "delivery", "address",
  "returnMethod", "returnAddress", "payMethod", "card", "appliedCoupon",
  "addressCoords", "returnAddressCoords",
  "editingOrder", "editRet", "editRetAddr", "lastEarnedPoints", "lastWaterSaved", "lastOrder", "editingProfile",
  "donName", "donMethod", "donAddr", "donDate",
  "rentalStart", "rentalEnd", "calMonth", "calPendingStart",
  "subtotalForDays", "dayMarginalCost",
  "rentalDays", "isLate", "inCart", "isRented", "unitsAvailable", "cartCount", "cents", "subtotal",
  "cartItemPrice", "subtotalBeforeVolume", "volumeRate", "volumeSavings", "depositTotal",
  "shippingFee", "returnFee", "grandTotal", "orderPoints",
  "couponById", "availableCoupons", "nextCouponId", "cartRewardCtx",
  "couponDiscount", "couponIssue", "orderDiscount",
  "waterSavedForItems", "cartWaterSaved", "totalWaterSaved",
  "orderItemsSubtotal", "orderDeposit", "orderTotal", "paymentStatusLabel", "isArchivedOrder",
  "isCancelledOrder", "isPastOrder", "canCancelOrder", "isDelivered",
  "creditDeliveredPoints", "revokeOrderPoints", "nextOrderId",
  "STORAGE_PREFIX", "activeStorageKey", "defaultProfile", "storageKeyFor",
  "resetStateToDefaults", "saveState", "loadState",
  // dom.js
  "grid", "noResults", "resultsBar", "filtersEl", "overlay", "sheet", "sheetBody",
  "sheetFoot", "sheetTitle", "searchInput", "loginEl", "greeting", "backBtn",
  "SHEET_BACK", "openSheet", "closeSheet", "renderSheet", "scrollSheetTo", "updateBadge", "toastTimer", "toast",
  "modalOverlay", "modalText", "modalOk", "modalCancel", "onConfirmCb", "confirmDialog", "closeModal",
  // catalog.js
  "renderFilters", "sortProducts", "filteredProducts", "anyFilterActive", "clearFilters",
  "activeFilterCount", "updateFilterBar", "renderFilterSheet",
  "renderGrid", "addToCart", "openDetail", "renderDetail",
  // checkout.js
  "totalRowHTML", "calVisibleMonth", "calDayIndex", "calDayCost", "calGridHTML",
  "pickCalendarDay", "shiftCalendar", "dateBoxHTML", "renderCart", "removeItem", "renderCheckout",
  "couponSectionHTML",
  "checkoutValid", "renderPayment", "paymentValid", "placeOrder", "renderDone",
  "resetCheckoutState", "finishOrder", "goToOrders",
  // profile.js
  "renderProfile", "saveProfile", "editProfile", "cancelProfileEdit", "toggleLateInfo",
  "returnEditorHTML", "openReturnEditor", "closeReturnEditor", "saveReturn", "cancelOrder",
  "renderRewards", "couponListHTML", "redeem",
  "prefOptionsHTML", "prefToggleHTML", "renderSettings",
  "openDonate", "donateValid", "renderDonate", "submitDonation", "openWardrobe",
  // main.js
  "enter",
  // api.js
  "DEPLOYED_API", "LOCAL_API_PORT", "API_OVERRIDE_KEY", "API_OFF_REASONS",
  "PRODUCTION_HOSTS", "isProductionHost",
  "readApiOverride", "backendForHost", "isMixedContent",
  "resolveApiBase", "backend", "replaceCatalog", "hydrateCatalog", "verifyGoogleCredential",
  // auth.js  (`google` lo aporta el SDK externo de Google Identity)
  "google", "GOOGLE_CLIENT_ID", "currentUser", "authAvailable", "decodeJwt",
  "activateUserSession", "onGoogleCredential", "initGoogleAuth", "renderGoogleButton", "signOut",
  // maps.js  (`google` ya está arriba: lo aporta el mismo SDK)
  "GOOGLE_MAPS_API_KEY", "MAPS_OVERRIDE_KEY", "MAPS_KEY_PARAM",
  "mapsApiKey", "adoptMapsKeyFromUrl",
  "MAP_DEFAULT_CENTER", "MAP_DEFAULT_ZOOM",
  "mapsSdkPromise", "pickerMap", "pickerGeocoder", "pickerTarget", "pickerPlace",
  "mapsAvailable", "loadMapsSdk", "openMapPicker", "setUpPickerMap", "readMapCenter",
  "useMyLocation", "confirmMapPicker", "applyPickedLocation", "clearPickedLocation", "closeMapPicker",
  "mapPickerButtonHTML", "addressFieldHTML", "addressReady"
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
