/* ============================================================
   CLOTH TO GO · web/js/cart.js
   Carrito, puerta de sesión y checkout de la web.

   El carrito se llena sin cuenta (se guarda en este navegador, ver
   session.js). Alquilar, en cambio, exige iniciar sesión con Google,
   igual que en la app: el pedido se guarda EN la cuenta y con las mismas
   claves de localStorage, así que lo que se confirma aquí aparece en
   "Mis pedidos" del móvil y viceversa.

   Todo el dinero lo pone el servidor: el catálogo trae el precio de cada
   prenda y la cotización (POST /api/quote, ver `quote` en js/state.js) el del
   carrito. Aquí no se multiplica nada; mientras llega, se enseña "—".
   ============================================================ */

// Paso del checkout: "datos" (fechas, entrega y devolución) → "pago" → "listo".
let checkoutStep = "datos";

// Marca si ya se intentó avanzar: hasta entonces no se pintan los campos en
// rojo. Señalar errores en un formulario que nadie ha tocado es regañar antes
// de tiempo.
let checkoutTried = false;

/* ---------------- Añadir y quitar ---------------- */

/**
 * Añade una prenda al carrito. Cada prenda es única (`disponibles` = 1), así
 * que no hay cantidad: o está o no está.
 * @param {number} id Id de la prenda.
 */
function addToCart(id){
  const p = productById(id);
  if(!p) return;
  if(isRented(id)){ toast("Esa prenda está alquilada ahora mismo"); return; }
  if(inCart(id)){ toast("Ya está en tu carrito"); return; }
  cart.push({ id });
  persistCart();
  updateBadge();
  renderCart();
  renderGrid();
  if(document.getElementById("detailModal").hidden === false) renderDetail();
  toast(`${p.name} · añadida`);
}

/**
 * Saca una prenda del carrito y devuelve el catálogo a su sitio (la prenda
 * vuelve a poder añadirse desde la parrilla).
 * @param {number} id Id de la prenda.
 */
function removeFromCart(id){
  cart = cart.filter(c => c.id !== id);
  persistCart();
  updateBadge();
  renderCart();
  renderGrid();
}

/** Contador del carrito en la cabecera. */
function updateBadge(){
  const b = document.getElementById("cartBadge");
  if(!b) return;
  b.textContent = cartCount();
  b.hidden = cartCount() === 0;
}

/* ---------------- Fechas ---------------- */

/**
 * Cambia una fecha del alquiler y mantiene el período coherente: la devolución
 * nunca puede caer antes que la entrega, y el inicio nunca en el pasado.
 * @param {"start"|"end"} campo Fecha que se está editando.
 * @param {string} valor Fecha ISO local (YYYY-MM-DD) del campo.
 */
function setRentalDate(campo, valor){
  if(!valor) return;
  if(campo === "start") rentalStart = valor;
  else rentalEnd = valor;
  // Nunca al pasado, la devolución después del inicio, y ninguno de los dos en
  // fin de semana o feriado: el local no entrega ni recibe (§6.0).
  snapRentalDates(true);
  renderCart();
  if(checkoutStep !== "listo") renderCheckout();
}

/**
 * Aviso de la ventana de devolución (§6.0): cuándo puede devolver sin costo
 * extra si eso cae después del día elegido, y que no se atiende en fin de
 * semana ni feriado (los campos de fecha nativos no pueden tachar días).
 * @returns {string} HTML.
 */
function returnWindowNoteHTML(){
  const limite = returnByISO(rentalStart, rentalEnd);
  return `<p class="note">${limite > rentalEnd
    ? `Puedes devolver sin costo extra hasta el ${fmtDate(limite)}. `
    : ""}Sin retiros ni devoluciones en fin de semana o feriado.</p>`;
}

/* ---------------- Panel del carrito ---------------- */

/** Abre el panel lateral del carrito. */
function openCart(){
  renderCart();
  document.getElementById("cartDrawer").hidden = false;
  document.getElementById("scrim").hidden = false;
}

/** Cierra el panel lateral (el carrito no se pierde: sigue guardado). */
function closeCart(){
  document.getElementById("cartDrawer").hidden = true;
  syncScrim();
}

/**
 * Línea de una prenda dentro del carrito, con su precio por el período
 * elegido (ya con el descuento por cantidad aplicado).
 * @param {object} p Prenda.
 * @returns {string} HTML de la línea.
 */
function cartLineHTML(p){
  return `
    <div class="line">
      <img src="${escapeHTML(webCover(p))}" alt="" onerror="this.style.display='none'">
      <div class="l-body">
        <b>${escapeHTML(p.name)}</b>
        <div class="meta">Talla ${escapeHTML(p.size)} · ${escapeHTML(materialLabel(p.material))}</div>
        <div class="meta">Depósito ${money(catalogDeposit(p))} (se devuelve)</div>
      </div>
      <div>
        <div class="l-price">${money(cartItemPrice(p))}</div>
        <button class="link-btn" data-action="remove" data-id="${p.id}">Quitar</button>
      </div>
    </div>`;
}

/**
 * Pinta el carrito: prendas, período, desglose y el botón que lleva al
 * alquiler (el que pasa por la puerta de sesión).
 */
/**
 * Llegó la cotización del carrito (requestQuote, en js/api.js): repinta el
 * panel y, si está abierto, el checkout, que hasta ahora enseñaban "—".
 */
function onQuoteUpdated(){
  renderCart();
  const modal = document.getElementById("checkoutModal");
  if(!modal || modal.hidden || checkoutStep === "listo") return;
  // Si se está escribiendo (dirección, tarjeta), repintar el cuerpo le quitaría
  // el foco al campo: basta con el pie, que es donde vive el total a confirmar.
  const escribiendo = document.activeElement && document.activeElement.matches("input, textarea")
    && modal.contains(document.activeElement);
  if(escribiendo) renderCheckoutFoot(); else renderCheckout();
}

function renderCart(){
  requestQuote();   // los importes los pone el servidor; al llegar, se repinta
  const body = document.getElementById("cartBody");
  const foot = document.getElementById("cartFoot");
  if(!body || !foot) return;
  updateBadge();

  if(!cart.length){
    body.innerHTML = `<p class="empty">Tu carrito está vacío.<br>Elige una prenda del catálogo.</p>`;
    foot.innerHTML = "";
    return;
  }

  const prendas = cart.map(c => productById(c.id)).filter(Boolean);
  const dias = rentalDays();
  const ahorro = volumeSavings();

  body.innerHTML = `
    ${prendas.map(cartLineHTML).join("")}
    <div class="dates">
      <label>Desde
        <input class="field" type="date" id="startDate" data-action="date" data-value="start"
               value="${rentalStart}" min="${isoOffset(0)}">
      </label>
      <label>Hasta
        <input class="field" type="date" id="endDate" data-action="date" data-value="end"
               value="${rentalEnd}" min="${addDaysISO(rentalStart, 1)}">
      </label>
    </div>
    <p class="note">${dias} ${dias === 1 ? "día" : "días"} de alquiler ·
      ${fmtDate(rentalStart)} a ${fmtDate(rentalEnd)}</p>
    ${returnWindowNoteHTML()}

    <div class="rows">
      <div class="row"><span>Alquiler (${prendas.length} ${prendas.length === 1 ? "prenda" : "prendas"})</span>
        <span>${money(subtotal())}</span></div>
      ${ahorro > 0
        ? `<div class="row"><span class="sub">Descuento por ${prendas.length} prendas</span>
             <span class="sub">−$${ahorro.toFixed(2)}</span></div>`
        : ""}
      <div class="row"><span>Depósito reembolsable</span><span>${money(depositTotal())}</span></div>
      <div class="row total"><span>Total</span><span>${money(grandTotal())}</span></div>
    </div>
    <p class="note">El envío o retiro a domicilio ($${SHIPPING_FEE.toFixed(2)} cada uno) se suma
      al elegir cómo recibes y devuelves las prendas. El depósito se te devuelve al entregarlas.</p>`;

  foot.innerHTML = `
    <button class="cta-btn" data-action="checkout">
      ${webUser ? "Continuar con el alquiler" : "Iniciar sesión y alquilar"}
    </button>
    ${webUser ? "" : `<p class="note">Para alquilar necesitas tu cuenta de Google. Tu carrito se conserva.</p>`}`;
}

/* ---------------- Checkout ---------------- */

/**
 * Punto de entrada del alquiler: es AQUÍ donde se exige la cuenta.
 *
 * Hasta este clic la web no pide nada; a partir de él hay fechas, dirección y
 * un pedido que tiene que pertenecer a alguien. Si no hay sesión, se abre el
 * diálogo de Google y el checkout queda aplazado: al volver, se abre solo.
 */
function startCheckout(){
  if(!cart.length){ toast("Tu carrito está vacío"); return; }
  requireSession(() => {
    checkoutStep = "datos";
    checkoutTried = false;
    closeCart();
    renderCheckout();
    openModal("checkoutModal");
  });
}

/** Cierra el checkout. Lo elegido (fechas, entrega, pago) se mantiene en memoria. */
function closeCheckout(){
  document.getElementById("checkoutModal").hidden = true;
  syncScrim();
  // Tras confirmar, el diálogo ya no tiene a qué volver: el carrito está vacío
  // y el pedido, guardado.
  if(checkoutStep === "listo") checkoutStep = "datos";
}

/**
 * Tarjeta de opción (entrega, devolución, pago).
 * @param {string} accion data-action que la atiende.
 * @param {string} valor Valor que se elige al pulsarla.
 * @param {string} titulo Etiqueta principal.
 * @param {string} detalle Línea secundaria (coste, plazo…).
 * @param {boolean} activa Si es la opción elegida.
 * @returns {string} HTML del botón.
 */
function optHTML(accion, valor, titulo, detalle, activa){
  return `<button class="opt${activa ? " on" : ""}" data-action="${accion}" data-value="${valor}">
    <b>${titulo}</b><small>${detalle}</small></button>`;
}

/** ¿Están completos los datos de entrega y devolución? */
function checkoutDataValid(){
  if(!delivery || !returnMethod) return false;
  if(delivery === DELIVERY.SHIP && !isValidAddress(address)) return false;
  if(returnMethod === RETURN_TO.HOME && !isValidAddress(returnAddress)) return false;
  return true;
}

/** ¿Está completo el pago? El efectivo no pide nada; la tarjeta, sus tres campos. */
function checkoutPayValid(){
  if(!payMethod) return false;
  if(payMethod === PAY_METHOD.CASH) return true;
  return isValidName(card.name) && isValidCardNumber(card.number) &&
         isValidExpiry(card.expiry) && isValidCvv(card.cvv);
}

/** Pinta el paso del checkout que toque. */
function renderCheckout(){
  requestQuote();
  const body = document.getElementById("checkoutBody");
  const foot = document.getElementById("checkoutFoot");
  if(!body || !foot) return;
  if(checkoutStep === "listo"){ renderCheckoutDone(body, foot); return; }

  const pasos = `
    <div class="steps">
      <span class="${checkoutStep === "datos" ? "on" : ""}">1 · Entrega</span>
      <span>›</span>
      <span class="${checkoutStep === "pago" ? "on" : ""}">2 · Pago</span>
      <span>›</span><span>3 · Listo</span>
    </div>`;

  body.innerHTML = pasos + (checkoutStep === "datos" ? checkoutDataHTML() : checkoutPayHTML());
  renderCheckoutFoot();
}

/**
 * Pinta solo el pie del checkout (el botón de avanzar y su estado).
 *
 * Va aparte porque es lo único que cambia mientras se escribe una dirección o
 * una tarjeta: repintar el cuerpo en cada tecla le quitaría el foco al campo
 * en el que se está escribiendo.
 */
function renderCheckoutFoot(){
  const foot = document.getElementById("checkoutFoot");
  if(!foot || checkoutStep === "listo") return;
  // Confirmar exige además la cotización vigente: sin ella no hay importe.
  const puedeSeguir = checkoutStep === "datos" ? checkoutDataValid() : checkoutPayValid() && quoteReady();
  foot.innerHTML = `
    ${checkoutStep === "pago"
      ? `<button class="ghost-btn" data-action="checkoutBack">Atrás</button>` : ""}
    <button class="cta-btn" data-action="${checkoutStep === "datos" ? "checkoutNext" : "placeOrder"}"
      ${puedeSeguir ? "" : "disabled"}>
      ${checkoutStep === "datos" ? "Continuar al pago" : `Confirmar alquiler · ${money(grandTotal())}`}
    </button>`;
}

/** Paso 1: período, cómo recibe y cómo devuelve. */
function checkoutDataHTML(){
  const dias = rentalDays();
  const malEnvio = checkoutTried && delivery === DELIVERY.SHIP && !isValidAddress(address);
  const malRetiro = checkoutTried && returnMethod === RETURN_TO.HOME && !isValidAddress(returnAddress);
  return `
    <div class="block">
      <h3>Período</h3>
      <div class="dates">
        <label>Desde
          <input class="field" type="date" data-action="date" data-value="start"
                 value="${rentalStart}" min="${isoOffset(0)}"></label>
        <label>Hasta
          <input class="field" type="date" data-action="date" data-value="end"
                 value="${rentalEnd}" min="${addDaysISO(rentalStart, 1)}"></label>
      </div>
      <p class="note">${dias} ${dias === 1 ? "día" : "días"} · alquiler ${money(subtotal())}</p>
      ${returnWindowNoteHTML()}
    </div>

    <div class="block">
      <h3>¿Cómo recibes las prendas?</h3>
      <div class="opts">
        ${optHTML("delivery", DELIVERY.PICKUP, "Retiro en el local",
          `${escapeHTML(LOCAL.direccion)} · sin costo`, delivery === DELIVERY.PICKUP)}
        ${optHTML("delivery", DELIVERY.SHIP, "Envío a domicilio",
          `$${SHIPPING_FEE.toFixed(2)} · Guayaquil`, delivery === DELIVERY.SHIP)}
      </div>
      ${delivery === DELIVERY.SHIP
        ? `<input class="field${malEnvio ? " bad" : ""}" data-action="field" data-value="address"
             placeholder="Dirección de entrega (calle y número)" value="${escapeHTML(address)}">
           ${malEnvio ? `<p class="hint">Escribe una dirección completa.</p>` : ""}`
        : ""}
    </div>

    <div class="block">
      <h3>¿Cómo las devuelves?</h3>
      <div class="opts">
        ${optHTML("return", RETURN_TO.STORE, "En el local",
          `${escapeHTML(LOCAL.horario)} · sin costo`, returnMethod === RETURN_TO.STORE)}
        ${optHTML("return", RETURN_TO.HOME, "Retiro a domicilio",
          `$${SHIPPING_FEE.toFixed(2)} · pasamos por ellas`, returnMethod === RETURN_TO.HOME)}
      </div>
      ${returnMethod === RETURN_TO.HOME
        ? `<input class="field${malRetiro ? " bad" : ""}" data-action="field" data-value="returnAddress"
             placeholder="Dirección de retiro" value="${escapeHTML(returnAddress)}">
           ${malRetiro ? `<p class="hint">Escribe una dirección completa.</p>` : ""}`
        : ""}
    </div>`;
}

/** Paso 2: método de pago y desglose final. */
function checkoutPayHTML(){
  const conTarjeta = payMethod === PAY_METHOD.CREDIT || payMethod === PAY_METHOD.DEBIT;
  const malo = campo => checkoutTried && !campo;
  return `
    <div class="block">
      <h3>Pago</h3>
      <div class="opts">
        ${optHTML("pay", PAY_METHOD.CASH, "Efectivo",
          "Pagas al recibir o retirar", payMethod === PAY_METHOD.CASH)}
        ${optHTML("pay", PAY_METHOD.CREDIT, "Tarjeta de crédito",
          "Se cobra al confirmar", payMethod === PAY_METHOD.CREDIT)}
        ${optHTML("pay", PAY_METHOD.DEBIT, "Tarjeta de débito",
          "Se cobra al confirmar", payMethod === PAY_METHOD.DEBIT)}
      </div>
      ${conTarjeta ? `
        <input class="field${malo(isValidName(card.name)) ? " bad" : ""}" data-action="card" data-value="name"
               placeholder="Nombre en la tarjeta" value="${escapeHTML(card.name)}">
        <input class="field${malo(isValidCardNumber(card.number)) ? " bad" : ""}" data-action="card" data-value="number"
               inputmode="numeric" placeholder="Número de tarjeta" value="${escapeHTML(card.number)}">
        <div class="dates">
          <label>Vence
            <input class="field${malo(isValidExpiry(card.expiry)) ? " bad" : ""}" data-action="card" data-value="expiry"
                   placeholder="MM/AA" value="${escapeHTML(card.expiry)}"></label>
          <label>CVV
            <input class="field${malo(isValidCvv(card.cvv)) ? " bad" : ""}" data-action="card" data-value="cvv"
                   inputmode="numeric" placeholder="123" value="${escapeHTML(card.cvv)}"></label>
        </div>
        <p class="note">Prototipo: no se procesa ningún cobro y los datos de la tarjeta
          no se guardan en ningún sitio.</p>` : ""}
    </div>

    <div class="block rows">
      <div class="row"><span>Alquiler · ${rentalDays()} ${rentalDays() === 1 ? "día" : "días"}</span>
        <span>${money(subtotal())}</span></div>
      <div class="row"><span>Depósito reembolsable</span><span>${money(depositTotal())}</span></div>
      ${shippingFee() ? `<div class="row"><span>Envío a domicilio</span><span>${money(shippingFee())}</span></div>` : ""}
      ${returnFee() ? `<div class="row"><span>Retiro a domicilio</span><span>${money(returnFee())}</span></div>` : ""}
      <div class="row total"><span>Total</span><span>${money(grandTotal())}</span></div>
    </div>`;
}

/** Paso 3: acuse del alquiler confirmado. */
function renderCheckoutDone(body, foot){
  const o = lastOrder;
  if(!o){ body.innerHTML = ""; foot.innerHTML = ""; return; }
  body.innerHTML = `
    <div class="ok-big">
      <div class="mark">${icon("checkCircle", { size: 46 })}</div>
      <h2>Alquiler confirmado</h2>
      <p class="modal-sub">Pedido #${o.id} · ${fmtDate(o.start)} a ${fmtDate(o.end)} ·
        $${o.total.toFixed(2)}</p>
      <p class="note">
        ${o.delivery === DELIVERY.SHIP
          ? `Te lo llevamos a ${escapeHTML(address || "tu dirección")}.`
          : `Retíralo en ${escapeHTML(LOCAL.direccion)} (${escapeHTML(LOCAL.horario)}).`}
        Ahorraste ${fmtLiters(lastWaterSaved)} litros de agua y ganaste ${o.points} puntos.
      </p>
      <p class="note">El pedido queda guardado en tu cuenta: lo ves en <b>Mis pedidos</b>
        de la app, con la misma sesión de Google.</p>
    </div>`;
  foot.innerHTML = `<button class="cta-btn" data-action="closeCheckout">Seguir mirando el catálogo</button>`;
}

/**
 * Registra el alquiler en la API, como placeOrder() de la app.
 *
 * El pedido lo guarda la base: por eso aparece en "Mis pedidos" de la app
 * desde cualquier dispositivo. La web manda qué ejemplares, fechas y modos; los
 * importes, los puntos y la reserva los decide el servidor, y la confirmación
 * pinta lo que respondió. Sin cupones (la web no los ofrece) ni coordenadas.
 * La tarjeta sigue simulada y no viaja.
 * @returns {Promise<boolean>} true si el pedido quedó creado.
 */
async function placeWebOrder(){
  checkoutTried = true;
  if(!checkoutDataValid() || !checkoutPayValid()){ renderCheckout(); return false; }
  if(webPlacing) return false;
  if(!canRentOnline()){ toast("Para alquilar hace falta conexión con el servidor."); return false; }
  if(!quoteReady()){ toast("Calculando el precio… inténtalo en un momento."); requestQuote(); return false; }
  const items = cartItemIds();
  if(!items){ toast("Alguna prenda del carrito ya no está disponible."); return false; }
  const litros = cartWaterSaved();

  webPlacing = true;
  const r = await apiFetch("/api/orders", { method: "POST", body: {
    items,
    start: rentalStart,
    end: rentalEnd,
    delivery,
    ret: returnMethod,
    shipAddr: delivery === DELIVERY.SHIP ? address.trim() : undefined,
    retAddr: returnMethod === RETURN_TO.HOME ? returnAddress.trim() : undefined,
    pay: payMethod,
  }});
  webPlacing = false;
  if(!r.ok){
    toast(apiErrorText(r));
    if(r.status === 409) hydrateCatalog();
    return false;
  }

  const order = orderFromApi(r.data);
  orders.push(order);
  lastWaterGoals = [];
  lastEarnedPoints = order.points;
  lastWaterSaved = litros;
  lastOrder = order;
  cart = [];
  // Los datos de la tarjeta se descartan en cuanto se "cobra": no se guardan ni
  // aquí ni en localStorage.
  card = { number: "", name: "", expiry: "", cvv: "" };
  saveState();
  checkoutStep = "listo";
  checkoutTried = false;
  renderCheckout();
  renderGrid();
  renderCart();
  updateBadge();
  hydrateCatalog();   // la prenda reservada sale del catálogo para todos
  return true;
}

// Si hay un pedido en vuelo: el botón no puede crear dos por un doble clic.
let webPlacing = false;

