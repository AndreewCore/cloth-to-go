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

// Globales reales de la app, agrupados por el archivo de js/ que los define.
// Van por archivo porque el sitio web y las maquetas cargan solo algunos:
// cada superficie declara lo que de verdad tiene en su página, y no-undef
// avisa si la web llama a algo que solo existe en la app (`sheet`,
// `confirmDialog`…).
const APP_GLOBALS = {
  icons: [
    "ICON_PATHS", "icon"
  ],
  prefs: [
    "PREFS_KEY", "DEFAULT_PREFS", "TEXT_SCALES", "prefs", "loadPrefs", "savePrefs",
    "systemPrefersDark", "effectiveTheme", "shouldReduceMotion", "applyPrefs",
    "getPrefs", "setPref", "toggleTheme", "watchSystemTheme"
  ],
  data: [
    "LOCAL", "SHIPPING_FEE", "deliveryFeeFor", "returnFeeFor",
    "DELIVERY", "RETURN_TO", "ORDER_STATUS", "PAY_METHOD",
    "businessCalendar", "setBusinessCalendar", "weekdayISO", "isBusinessDayISO", "nextBusinessDayISO",
    "returnWindowCloseISO", "returnByISO",
    "pricingTexts", "reviewReasons", "reviewReasonLabel", "catalogPrice", "catalogNextDay", "catalogDeposit", "money", "perDay",
    "sumOrNull", "sortPrice",
    "CATS", "PRODUCTS", "PRODUCT_BY_ID", "productById", "productOrStub", "SIZE_SCALES", "SIZE_ORDER", "SIZES",
    "sizeScale", "sizesInScale",
    "REWARDS", "REWARD_BY_ID", "rewardById",
    "escapeHTML", "conditionLabel", "starStr", "fmtDate", "daysBetween", "imgPlaceholder",
    "qualityLevel", "qualityMeter", "qualityMeterText",
    "productImages", "coverImage",
    "MESES_LARGOS", "addDaysISO", "monthOf", "shiftMonth", "monthLabel", "monthGrid",
    "isValidEmail", "isValidPhone", "isValidName", "isValidAddress",
    "ALLOWED_EMAIL_DOMAINS", "emailDomain", "isAllowedEmailDomain", "isValidContactEmail",
    "PHONE_COUNTRY_CODE", "PHONE_NATIONAL_LEN", "isValidEcPhone", "phoneToE164", "NAME_CHANGE_DAYS",
    "isValidCardNumber", "isValidExpiry", "isValidCvv",
    "WATER_PER_KG", "LITERS_PER_GALLON", "garmentWater", "litersToGallons", "fmtLiters",
    "WATER_GOALS",
    "MATERIAL_LABELS", "materialLabel", "MATERIAL_ORDER", "MATERIALS",
    "COLOR_LABELS", "COLOR_HEX", "COLORS", "colorLabel", "colorSwatch", "colorCount",
    "replaceInPlace", "refreshCatalogLists", "applyTaxonomy"
  ],
  state: [
    "isoOffset", "cart", "orders", "profile", "activeCat", "searchQuery",
    "qualityFilter", "sizeFilter", "materialFilter", "colorFilter", "sortBy", "openFilterGroup", "view", "detailId", "stackedDetail", "delivery", "address",
    "returnMethod", "returnAddress", "payMethod", "card", "appliedCoupon",
    "addressCoords", "returnAddressCoords",
    "detailImg", "editingOrder", "editRet", "editRetAddr", "editRetCoords", "lastEarnedPoints", "lastWaterSaved", "lastWaterGoals", "lastOrder", "editingProfile",
    "donName", "donMethod", "donAddr", "donCoords", "donDate",
    "rentalStart", "rentalEnd", "calMonth", "calPendingStart",
    "subtotalForDays", "dayMarginalCost",
    "rentalDays", "isLate", "snapRentalDates", "inCart", "isRented", "unitsAvailable", "cartCount", "cents", "subtotal",
    "cartItemPrice", "subtotalBeforeVolume", "volumeSavings", "depositTotal",
    "quote", "quoteKey", "cartQuoteBody", "currentQuoteKey", "quoteReady", "quoteUsd",
    "shippingFee", "returnFee", "grandTotal", "orderPoints",
    "couponById", "availableCoupons",
    "couponDiscount", "couponIssue",
    "waterSavedForItems", "cartWaterSaved", "totalWaterSaved",
    "reachedWaterGoals", "nextWaterGoal", "waterGoalProgress", "applyAccount", "accountSynced",
    "toggleWaterGoalInfo", "celebrateWaterGoals",
    "orderDeposit", "orderItemPrice", "cartItemIds", "pickItem", "earliestStartISO", "paymentStatusLabel", "isArchivedOrder",
    "isCancelledOrder", "isPastOrder", "canCancelOrder", "isDelivered",
    "reviews", "productReviewCache", "notices", "unreadNotices", "reviewOrderId", "reviewProductId", "reviewRating", "reviewText",
    "reviewPhoto", "reviewPhotoBlob", "REVIEW_STATUS_LABEL",
    "productReviews", "productRating", "reviewFor", "reviewableItems", "hasPendingReview",
    "deleteReview",
    "countsForRewards",
    "STORAGE_PREFIX", "activeStorageKey", "defaultProfile", "storageKeyFor",
    "daysUntilNameChange", "canChangeName", "emailIsManaged",
    "resetStateToDefaults", "saveState", "loadState"
  ],
  dom: [
    "grid", "noResults", "resultsBar", "filtersEl", "overlay", "sheet", "sheetBody",
    "sheetFoot", "sheetTitle", "searchInput", "loginEl", "greeting", "backBtn",
    "SHEET_BACK", "FULL_VIEWS", "optionCardHTML", "localCardHTML", "openSheet", "closeSheet", "renderSheet", "scrollSheetTo", "updateBadge", "bumpBadge", "flyToCart", "toastTimer", "toast",
    "sheetStack", "stackOverlay", "stackBody", "stackFoot", "openStackSheet", "closeStackSheet",
    "modalOverlay", "modalText", "modalOk", "modalCancel", "onConfirmCb", "confirmDialog", "closeModal", "updateNoticeDot"
  ],
  catalog: [
    "renderFilters", "sortProducts", "filteredProducts", "anyFilterActive", "clearFilters",
    "activeFilterCount", "updateFilterBar", "renderFilterSheet",
    "filterGroupValue", "filterGroupHTML", "filterOptHTML", "toggleFilterGroup", "setFilterValue",
    "renderGrid", "addToCart", "openDetail", "refreshProductReviews", "renderDetail", "reviewsHTML",
    "reviewActionHTML", "openReportReview", "sendReviewReport",
    "galleryIndex", "galleryHTML", "moveGallery", "showGalleryImage"
  ],
  checkout: [
    "onQuoteUpdated", "totalRowHTML", "calVisibleMonth", "calDayIndex", "calDayCost", "calGridHTML",
    "pickCalendarDay", "shiftCalendar", "dateBoxHTML", "renderCart", "removeItem", "renderCheckout",
    "couponSectionHTML",
    "deliveryReady", "returnReady", "checkoutValid", "renderPayment", "paymentValid", "placingOrder", "placeOrder", "renderDone",
    "confirmItemsHTML", "confirmDetailHTML", "confirmOrder",
    "resetCheckoutState", "finishOrder", "goToOrders"
  ],
  profile: [
    "renderProfile", "noticesHTML", "PAY_LABELS", "profileHeadHTML", "contactInfoHTML", "orderCardHTML", "rentTagText", "waterGoalHTML", "saveProfile", "editProfile", "cancelProfileEdit", "phoneVerifyHTML", "verifyPhone", "toggleLateInfo",
    "returnEditorHTML", "renderReturnEditor", "openReturnEditor", "closeReturnEditor", "saveReturn", "cancelOrder",
    "renderRewards", "couponListHTML", "redeem",
    "prefOptionsHTML", "prefToggleHTML", "renderSettings",
    "openDonate", "donateValid", "renderDonate", "submitDonation", "openWardrobe",
    "REVIEW_PHOTO_MAX_PX", "REVIEW_PHOTO_QUALITY", "REVIEW_PHOTO_MAX_BYTES",
    "openReview", "reviewValid", "submittingReview", "clearReviewPhotoDraft", "renderReview", "compressPhoto",
    "pickReviewPhoto", "submitReview"
  ],
  main: [
    "enter", "onSheetClick"
  ],
  api: [
    "DEPLOYED_API", "LOCAL_API_PORT", "API_OVERRIDE_KEY", "API_OFF_REASONS",
    "PRODUCTION_HOSTS", "isProductionHost",
    "readApiOverride", "backendForHost", "isMixedContent",
    "resolveApiBase", "backend", "replaceCatalog", "hydrateCatalog", "hydrateCalendar", "verifyGoogleCredential",
    "fetchWaterImpact", "fetchChatStatus", "askChatbot",
    "catalogFromApi", "catalogState", "catalogEmptyText", "loadNotices", "markNoticesRead", "SESSION_KEY", "readSessionToken", "storeSessionToken", "clearSessionToken",
    "canRentOnline", "apiFetch", "apiUpload", "loadMyReviews", "loadProductReviews", "apiErrorText", "logoutSession", "localDayOf", "orderFromApi",
    "couponFromApi", "refreshAccount", "quoteInFlight", "quotePromise", "requestQuote"
  ],
  // `google` lo aporta el SDK externo de Google Identity.
  auth: [
    "google", "GOOGLE_CLIENT_ID", "currentUser", "authAvailable", "decodeJwt",
    "activateUserSession", "onGoogleCredential", "initGoogleAuth", "renderGoogleButton", "signOut",
    "deleteAccount", "askDeleteAccount",
    "loginHint", "loginFailed",
    "syncAccount", "onSessionExpired", "pendingRental", "askLoginToRent", "resumePendingRental"
  ],
  // `google` ya está en auth: lo aporta el mismo SDK.
  maps: [
    "GOOGLE_MAPS_API_KEY", "MAPS_OVERRIDE_KEY", "MAPS_KEY_PARAM",
    "mapsApiKey", "adoptMapsKeyFromUrl",
    "MAP_DEFAULT_CENTER", "MAP_DEFAULT_ZOOM",
    "mapsSdkPromise", "pickerMap", "pickerGeocoder", "pickerTarget", "pickerPlace",
    "ADDRESS_FIELDS", "addressField", "addressFieldByInput",
    "mapsAvailable", "loadMapsSdk", "openMapPicker", "setUpPickerMap", "readMapCenter",
    "useMyLocation", "confirmMapPicker", "applyPickedLocation", "clearPickedLocation", "closeMapPicker",
    "mapPickerButtonHTML", "addressFieldHTML", "addressReady",
    "fallbackAddress", "hasStreetName"
  ],
};
const PROJECT_GLOBALS = Object.values(APP_GLOBALS).flat();


// Globales del SITIO WEB (web/js/*). Viven en su propio ámbito global: la web
// carga los mismos js/data.js, js/state.js y js/api.js que la app, más estos.
const WEB_GLOBALS = [
  // web/js/session.js
  "WEB_GOOGLE_CLIENT_ID", "GUEST_CART_KEY", "webUser", "pendingAfterLogin",
  "webAuthAvailable", "webDecodeJwt", "persistCart", "readGuestCart", "clearGuestCart",
  "startWebSession", "signOutWeb", "onSessionExpired", "requireSession", "onWebGoogleCredential",
  "initWebAuth", "showLoginHint", "renderSession", "userMenuOpen", "toggleUserMenu", "closeUserMenu",
  "webNoticesHTML", "updateNoticeDot",
  // web/js/catalog.js
  "webImg", "webCover", "webSortProducts", "webFilteredProducts", "webAnyFilter",
  "clearWebFilters", "chipHTML", "cardHTML", "openDetail", "updateFilterCount",
  "renderHeroFacts", "renderContact", "renderFilters", "renderGrid", "renderDetail",
  // web/js/cart.js
  "checkoutStep", "checkoutTried", "addToCart", "removeFromCart", "setRentalDate",
  "openCart", "closeCart", "cartLineHTML", "startCheckout", "closeCheckout", "optHTML",
  "checkoutDataValid", "checkoutPayValid", "renderCheckout", "renderCheckoutFoot",
  "checkoutDataHTML", "checkoutPayHTML", "renderCheckoutDone", "placeWebOrder", "webPlacing",
  "renderCart", "updateBadge", "returnWindowNoteHTML", "onQuoteUpdated",
  // web/js/main.js
  "openModal", "syncScrim", "closeTopmost", "openLogin", "closeLogin", "bootDepsReady",
  "webToastTimer", "dispatchAction", "dispatchInput", "wireEvents", "initWeb",
  "PLAY_STORE_URL", "applyStoreLinks", "toast", "closeModal",
  "toggleNav", "closeNav", "toggleFilters", "initHeroParallax", "updateTopBar",
  // web/js/water.js
  "WATER_TANK_MIN", "waterRefreshTimer", "fmtGoalLiters", "fmtGoalPct", "fmtCutTime",
  "renderWaterImpact", "countUpLiters", "scheduleWaterRefresh", "loadWaterImpact", "initWaterImpact",
  // web/js/chat.js
  "CHAT_SUGGESTIONS", "chatHistory", "chatBusy", "addChatBubble",
  "renderChatWelcome", "chatIsOpen", "openChat", "closeChat", "toggleChat", "sendChat", "initChat",
];

/** Convierte una lista de nombres en el objeto de globales de ESLint. */
const asGlobals = names => Object.fromEntries(names.map(n => [n, "writable"]));

const projectGlobals = asGlobals(PROJECT_GLOBALS);
// Lo que carga web/index.html de js/ (icons, data, state, api), más el SDK de
// Google y sus propios archivos.
const webGlobals = asGlobals([
  ...APP_GLOBALS.icons, ...APP_GLOBALS.data, ...APP_GLOBALS.state, ...APP_GLOBALS.api,
  "google", ...WEB_GLOBALS,
]);
// Las maquetas cargan solo js/icons.js y js/data.js.
const mockupGlobals = asGlobals([...APP_GLOBALS.icons, ...APP_GLOBALS.data]);

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
  },
  // Las maquetas de diseño (web/propuestas): cargan js/data.js y su propio
  // andamiaje. Mismas reglas; el JS de cada maqueta va dentro del HTML y no lo
  // ve ESLint, así que aquí solo entra demo.js.
  {
    files: ["web/propuestas/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...mockupGlobals,
        DEMO_THEME_KEY: "writable", demoImg: "writable", demoCover: "writable",
        demoProducts: "writable", demoPrice: "writable", demoDeposit: "writable", demoDay: "writable", demoWeekend: "writable",
        demoSaving: "writable", demoWater: "writable", initDemoTheme: "writable",
      }
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": "off",
      "eqeqeq": ["warn", "smart"],
      "no-redeclare": ["error", { "builtinGlobals": false }],
      "no-empty": "off"
    }
  },
  // El sitio web: mismas reglas y mismo patrón de ámbito global compartido,
  // con solo los globales de js/ que su página carga, más los suyos.
  {
    files: ["web/js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { ...globals.browser, ...webGlobals }
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": "off",
      "eqeqeq": ["warn", "smart"],
      "no-redeclare": ["error", { "builtinGlobals": false }],
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-unreachable": "error",
      "no-cond-assign": ["error", "always"],
      "no-constant-condition": "warn",
      "no-empty": "off"
    }
  },
  // El servidor (server/): módulos ES de Node, no scripts clásicos. Aquí SÍ se
  // activa no-unused-vars, porque cada archivo importa lo que usa y una
  // declaración sin usar es un error real, no un falso positivo de ámbito
  // compartido. Nada de estilo: no hay formateador a propósito (§12).
  {
    files: ["server/**/*.js"],
    ignores: ["server/node_modules/**", "server/admin/**"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node }
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { "args": "none", "caughtErrors": "none" }],
      "no-unreachable": "error",
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-redeclare": "error",
      "no-cond-assign": ["error", "always"],
      "no-constant-condition": "error",
      // §12.1 (b): las reglas de promesas que funcionan sin información de tipos.
      "no-async-promise-executor": "error",
      "no-promise-executor-return": "error",
      // allowProperties: escribir `req.user` tras un await es el patrón normal
      // de un preHandler de Fastify, no una carrera; sin esto la regla solo da
      // falsos positivos ahí. Sigue vigilando las variables reasignadas.
      "require-atomic-updates": ["error", { "allowProperties": true }],
      // §12.1 (c): una escritura de Prisma como sentencia suelta —sin await, sin
      // return, sin asignar— es un cargo que quizá no exista cuando se responde.
      // Tosca (no ve `const p = prisma.x.create()` sin esperar), pero atrapa la
      // forma en que este error se escribe en la práctica.
      "no-restricted-syntax": ["error", {
        "selector": "ExpressionStatement > CallExpression[callee.object.object.name=/^(prisma|tx)$/]",
        "message": "Llamada a Prisma sin await: la escritura puede no existir cuando respondas."
      }]
    }
  },
  // El panel (server/admin/): módulo ES del navegador, servido por la API. No
  // comparte el ámbito global de la app: lo único ajeno que ve es el SDK de Google.
  {
    files: ["server/admin/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, google: "readonly" }
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { "args": "none", "caughtErrors": "none" }],
      "no-unreachable": "error",
      "no-dupe-keys": "error",
      "no-redeclare": "error",
      "no-cond-assign": ["error", "always"],
      "eqeqeq": ["warn", "smart"]
    }
  }
];
