/* ============================================================
   CLOTH TO GO · web/js/main.js
   Diálogos, aviso flotante, cableado de eventos y arranque.

   Se carga EL ÚLTIMO: es el único archivo con código que se ejecuta al
   cargar la página (el resto solo define funciones), y necesita que todo
   lo demás esté definido. Misma regla que js/main.js en la app.

   Los eventos van por DELEGACIÓN, como en la app: los controles llevan
   `data-action` y aquí hay un único escuchador que reparte. Así el HTML
   que se repinta no tiene que volver a enganchar nada.
   ============================================================ */

/* ---------------- Enlace a la tienda ---------------- */

/*
 * Ficha de Google Play de la app. **Provisional**: la app todavía no está
 * publicada, así que este identificador no resuelve a nada. Se cambia AQUÍ y
 * solo aquí — los tres enlaces del sitio (cabecera, menú y pie) lo toman de
 * esta constante, para que publicar no sea ir a buscarlos por el HTML.
 */
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=ec.clothtogo.app";

/**
 * Apunta a la tienda todos los enlaces marcados con `data-play`.
 *
 * Van en el marcado con `href="#"` y se rellenan aquí: así no hay tres copias
 * de la URL que puedan quedarse desparejas. Se abren en otra pestaña porque
 * salen del sitio, con `rel` para no ceder el contexto de esta página.
 */
function applyStoreLinks(){
  for(const a of document.querySelectorAll("[data-play]")){
    a.href = PLAY_STORE_URL;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  }
}

/* ---------------- Diálogos y avisos ---------------- */

/**
 * Abre un diálogo y enciende el fondo oscuro.
 * @param {string} id Id del contenedor `.modal-wrap`.
 */
function openModal(id){
  document.getElementById(id).hidden = false;
  document.getElementById("scrim").hidden = false;
}

/**
 * Cierra un diálogo y apaga el fondo si ya no queda nada abierto.
 * @param {string} id Id del contenedor `.modal-wrap`.
 */
function closeModal(id){
  document.getElementById(id).hidden = true;
  syncScrim();
}

/**
 * Deja el fondo oscuro encendido solo mientras haya algo encima (carrito o
 * diálogo). Con varios paneles que se abren y cierran por separado, apagarlo
 * desde cada uno acababa dejándolo puesto sobre la página.
 */
function syncScrim(){
  const abiertos = ["cartDrawer", "detailModal", "loginModal", "checkoutModal"]
    .some(id => !document.getElementById(id).hidden);
  document.getElementById("scrim").hidden = !abiertos;
}

/** Cierra lo que esté abierto por encima de la página (botón ✕, fondo, Esc). */
function closeTopmost(){
  for(const id of ["detailModal", "loginModal", "checkoutModal"]){
    if(!document.getElementById(id).hidden){ closeModal(id); return; }
  }
  closeCart();
}

function openLogin(){ openModal("loginModal"); initWebAuth(); }
function closeLogin(){
  // Quien cierra la puerta de sesión ya no quiere lo que había pedido: dejar
  // la acción aplazada la dispararía en el próximo login, por sorpresa.
  pendingAfterLogin = null;
  showLoginHint("");
  closeModal("loginModal");
}

let webToastTimer = null;
/**
 * Aviso flotante breve. Equivale al toast() de js/dom.js, que no puede
 * cargarse aquí porque vive con el resto del DOM del teléfono.
 * @param {string} msg Texto del aviso.
 */
function toast(msg){
  const el = document.getElementById("toast");
  if(!el) return;
  el.textContent = msg;
  el.classList.add("on");
  clearTimeout(webToastTimer);
  webToastTimer = setTimeout(() => el.classList.remove("on"), 1800);
}

/* ---------------- Reparto de acciones ---------------- */

/**
 * Atiende un clic sobre un control con `data-action`.
 * @param {HTMLElement} el Elemento pulsado (el más interno con acción).
 */
function dispatchAction(el){
  const accion = el.dataset.action;
  const id = +el.dataset.id;
  const valor = el.dataset.value;
  switch(accion){
    /* Navegación */
    case "toggleNav":     toggleNav(); break;
    case "toggleFilters": toggleFilters(); break;
    case "toggleUserMenu": toggleUserMenu(); break;

    /* Catálogo */
    case "cat":         activeCat = valor; renderFilters(); renderGrid(); break;
    case "quality":     qualityFilter = +valor; renderFilters(); renderGrid(); break;
    case "size":        sizeFilter = sizeFilter === valor ? "Todas" : valor; renderFilters(); renderGrid(); break;
    case "material":    materialFilter = valor; renderFilters(); renderGrid(); break;
    case "color":       colorFilter = valor; renderFilters(); renderGrid(); break;
    case "clearFilters": clearWebFilters(); break;
    case "detail":      openDetail(id); break;
    case "detailImg":   detailImg = +valor; renderDetail(); break;
    case "closeDetail": closeModal("detailModal"); break;

    /* Carrito */
    case "add":         addToCart(id); break;
    case "remove":      removeFromCart(id); break;
    case "openCart":    openCart(); break;
    case "closeCart":   closeCart(); break;

    /* Sesión */
    case "openLogin":   openLogin(); break;
    case "closeLogin":  closeLogin(); break;
    case "signOut":     signOutWeb(); break;

    /* Checkout */
    case "checkout":      startCheckout(); break;
    case "delivery":      delivery = valor; renderCheckout(); break;
    case "return":        returnMethod = valor; renderCheckout(); break;
    case "pay":           payMethod = valor; renderCheckout(); break;
    case "checkoutNext":
      checkoutTried = true;
      if(!checkoutDataValid()){ renderCheckout(); break; }
      checkoutStep = "pago"; checkoutTried = false; renderCheckout();
      break;
    case "checkoutBack":  checkoutStep = "datos"; checkoutTried = false; renderCheckout(); break;
    case "placeOrder":    placeWebOrder(); break;
    case "closeCheckout": closeCheckout(); break;
    default: break;
  }
}

/**
 * Atiende lo que se escribe o elige en un campo con `data-action`.
 * @param {HTMLElement} el Campo modificado.
 */
function dispatchInput(el){
  const valor = el.dataset.value;
  switch(el.dataset.action){
    case "date":  setRentalDate(valor, el.value); break;
    case "field":
      // Solo se actualiza el estado y el botón: repintar el formulario entero
      // en cada tecla sacaría el foco del campo que se está escribiendo.
      if(valor === "address") address = el.value;
      if(valor === "returnAddress") returnAddress = el.value;
      renderCheckoutFoot();
      break;
    case "card":  card[valor] = el.value; renderCheckoutFoot(); break;
    default: break;
  }
}

/* ---------------- Portada ---------------- */

/**
 * Enciende el paralaje del vídeo de la portada.
 *
 * El fondo se desplaza a un tercio de la velocidad de la página: es lo que
 * da la sensación de profundidad. Se hace con `transform` dentro de un
 * `requestAnimationFrame` —no con `background-attachment: fixed`, que en móvil
 * o no funciona o deja el fondo a tirones— y solo mientras la portada sigue en
 * pantalla, para no calcular nada durante el resto del scroll.
 *
 * Si el sistema pide menos movimiento, el vídeo se detiene en su póster y el
 * fondo deja de moverse: un vídeo en bucle es exactamente lo que esa
 * preferencia existe para evitar.
 */
function initHeroParallax(){
  const bg = document.getElementById("heroBg");
  const hero = document.getElementById("inicio");
  const video = document.getElementById("heroVideo");
  if(!bg || !hero) return;

  const quieto = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false, addEventListener(){} };

  let pendiente = false;
  function pintar(){
    pendiente = false;
    updateTopBar();
    if(quieto.matches){ bg.style.transform = ""; return; }
    // Más allá del alto de la portada el fondo ya no se ve: se deja de mover.
    const y = Math.min(window.scrollY, hero.offsetHeight);
    bg.style.transform = `translate3d(0, ${(y * 0.35).toFixed(1)}px, 0)`;
  }

  function aplicarPreferencia(){
    if(!video) return;
    // El atributo `muted` del marcado no basta en todos los navegadores, y sin
    // silencio la reproducción automática se bloquea: se fija también aquí.
    video.muted = true;
    if(quieto.matches){ video.pause(); return; }
    // play() devuelve una promesa que el navegador rechaza si decide bloquear
    // la reproducción; sin el catch eso sube como error no tratado. Los
    // navegadores antiguos no devuelven nada, de ahí la comprobación.
    const reproduciendo = video.play();
    if(reproduciendo && reproduciendo.catch) reproduciendo.catch(() => {});
  }

  const alPedir = () => {
    if(pendiente) return;
    pendiente = true;
    requestAnimationFrame(pintar);
  };
  window.addEventListener("scroll", alPedir, { passive: true });
  window.addEventListener("resize", alPedir);
  if(quieto.addEventListener) quieto.addEventListener("change", () => { aplicarPreferencia(); pintar(); });

  aplicarPreferencia();
  pintar();
}

/**
 * Decide si la cabecera flota sobre la portada o es una barra sólida.
 *
 * Flota mientras el vídeo sigue detrás de ella; en cuanto la portada se va
 * hacia arriba, la barra se vuelve opaca, porque a partir de ahí lo que pasa
 * por debajo son secciones claras y unos enlaces blancos serían ilegibles.
 * El menú desplegado la fija también: el panel que cuelga es opaco y una
 * cabecera transparente encima se vería partida.
 */
function updateTopBar(){
  const bar = document.getElementById("topBar");
  const hero = document.getElementById("inicio");
  if(!bar || !hero) return;
  const navAbierto = document.getElementById("nav").classList.contains("open");
  // El umbral es el alto de la portada menos la propia cabecera: el momento en
  // que su borde inferior alcanza la barra.
  const limite = hero.offsetHeight - bar.offsetHeight;
  bar.classList.toggle("over", !navAbierto && window.scrollY < limite);
}

/* ---------------- Navegación ---------------- */

/** Despliega o pliega el menú de secciones (solo existe en pantalla estrecha). */
function toggleNav(){
  const nav = document.getElementById("nav");
  const abierto = nav.classList.toggle("open");
  document.querySelector(".burger").setAttribute("aria-expanded", String(abierto));
  updateTopBar();
}

/** Cierra el menú de secciones tras elegir una (si no, tapa lo que se acaba de abrir). */
function closeNav(){
  document.getElementById("nav").classList.remove("open");
  document.querySelector(".burger").setAttribute("aria-expanded", "false");
  updateTopBar();
}

/** Muestra u oculta la columna de filtros en pantalla estrecha. */
function toggleFilters(){
  const panel = document.getElementById("filterPanel");
  const abierto = panel.classList.toggle("open");
  document.querySelector(".filters-toggle").setAttribute("aria-expanded", String(abierto));
}

/* ---------------- Arranque ---------------- */

/** Engancha los escuchadores (uno por tipo de evento, para toda la página). */
function wireEvents(){
  document.addEventListener("click", e => {
    // Un menú desplegado se cierra al pulsar fuera de él: es lo que espera
    // cualquiera que lo haya abierto por error.
    if(!e.target.closest(".session")) closeUserMenu();
    if(e.target.closest(".nav a")) closeNav();

    const el = e.target.closest("[data-action]");
    if(!el) return;
    // Los enlaces del menú son anclas de verdad (#catalogo, #nosotros…): el
    // navegador ya sabe llevarlas, y no llevan data-action.
    dispatchAction(el);
  });

  // Los campos de texto avisan al escribir; las fechas y los desplegables, al
  // elegir (un `input` por cada dígito tecleado de una fecha daría períodos
  // absurdos a medio escribir).
  document.addEventListener("input", e => {
    const el = e.target.closest("[data-action]");
    if(el && el.dataset.action !== "date") dispatchInput(el);
  });
  document.addEventListener("change", e => {
    const el = e.target.closest('[data-action="date"]');
    if(el) dispatchInput(el);
  });

  document.getElementById("searchInput").addEventListener("input", e => {
    searchQuery = e.target.value;
    renderFilters();
    renderGrid();
  });
  document.getElementById("sortBy").addEventListener("change", e => {
    sortBy = e.target.value;
    renderGrid();
  });

  document.getElementById("scrim").addEventListener("click", closeTopmost);
  document.addEventListener("keydown", e => {
    if(e.key === "Escape"){ closeUserMenu(); closeNav(); closeTopmost(); return; }
    // Los div/span con role="button" no responden al teclado por su cuenta;
    // el catálogo los usa (la tarjeta de prenda, el enlace de la portada).
    const el = e.target.closest('[role="button"][data-action], .card[data-action]');
    if(el && (e.key === "Enter" || e.key === " ")){ e.preventDefault(); dispatchAction(el); }
  });
}

/**
 * Comprueba que los archivos compartidos con la app (js/data.js, js/state.js…)
 * llegaron, y explica qué hacer si no.
 *
 * Solo hay un motivo realista para que falten: haber levantado el servidor
 * DENTRO de web/, con lo que `../js/…` cae fuera de su raíz y el navegador no
 * lo sirve. Sin este aviso la página queda a medias —cabecera y portada sí,
 * catálogo no— y parece rota sin decir por qué.
 * @returns {boolean} true si se puede arrancar.
 */
function bootDepsReady(){
  if(typeof PRODUCTS !== "undefined" && typeof saveState !== "undefined") return true;
  document.querySelector("main").innerHTML = `
    <div class="boot-error">
      <h2>Falta el catálogo compartido</h2>
      <p>Esta página usa los mismos archivos que la app (<code>js/data.js</code>,
        <code>js/state.js</code>), que viven un nivel más arriba. El servidor tiene que
        arrancarse desde la <b>raíz del proyecto</b>, no desde <code>web/</code>:</p>
      <code>python3 -m http.server</code>
      <p>Y luego abrir <b>http://localhost:8000/web/</b> (con el <code>/web/</code> al final).</p>
    </div>`;
  return false;
}

/**
 * Arranca la web: recupera el carrito de invitado de este navegador, pinta
 * todo y pide el catálogo al backend.
 *
 * El carrito se lee ANTES de pintar para que la parrilla ya sepa qué prendas
 * están apartadas. La sesión no se restaura sola: Google la ofrece de nuevo
 * cuando hace falta (al alquilar), y mientras tanto mirar el catálogo no
 * necesita cuenta.
 */
function initWeb(){
  if(!bootDepsReady()) return;
  document.querySelector(".cart-ico").innerHTML = icon("cart", { size: 22 });
  applyStoreLinks();
  cart = readGuestCart();
  renderHeroFacts();
  renderContact();
  initHeroParallax();
  initWaterImpact();
  renderSession();
  renderFilters();
  renderGrid();
  renderCart();
  wireEvents();
  // El catálogo del backend sustituye al embebido en cuanto llegue; si no hay
  // servidor (todavía no existe la base de datos), la web sigue con los datos
  // locales — el mismo trato que la app.
  hydrateCatalog().then(hidratado => {
    // Si el catálogo llegó del backend, las cifras de la portada (cuántas
    // prendas, cuánto se ahorra, cuánta agua) ya no son las de los datos
    // embebidos: se recalculan sobre lo que de verdad se está mostrando.
    if(hidratado) renderHeroFacts();
  });
}

initWeb();
