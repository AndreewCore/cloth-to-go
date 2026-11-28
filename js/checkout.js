/* ============================================================
   CLOTH TO GO · checkout.js
   Flujo de alquiler: carrito, entrega/pago y confirmación.
   Incluye el selector de fechas reutilizable y quitar del carrito.
   Depende de data.js, state.js y dom.js.
   ============================================================ */

/**
 * Fila de total del resumen, con el depósito reembolsable a la IZQUIERDA del
 * monto a pagar.
 *
 * El depósito va en cada pantalla del flujo y no solo en la nota al pie: el
 * total se ve más caro de lo que realmente cuesta el alquiler, y saber de un
 * vistazo cuánto vuelve evita el abandono en el paso de pago.
 * @param {string} label Etiqueta de la fila ("Total", "Total a pagar"…).
 * @param {number} total Monto a cobrar (ya incluye el depósito).
 */
function totalRowHTML(label, total){
  const dep = depositTotal();
  return `
    <div class="summary-row total">
      <span>${label}</span>
      <span class="total-vals">
        ${dep > 0 ? `<span class="refund-inline" title="Depósito que se te devuelve al terminar el alquiler">${icon("undo", { size: 13 })} $${dep.toFixed(2)} se te devuelve</span>` : ""}
        <span class="total-amount">${money(total)}</span>
      </span>
    </div>`;
}

/* ---- Bloque reutilizable: selector de fechas ---- */

/** Mes que muestra el calendario: el que el cliente navegó, o el del inicio. */
function calVisibleMonth(){ return calMonth || monthOf(rentalStart); }

/**
 * Índice de un día dentro del alquiler contando desde el inicio elegido.
 * El día de inicio es el 1; el día de devolución cae fuera del rango cobrado
 * (se entrega esa mañana, no se cobra), de ahí que un alquiler de N días ocupe
 * las celdas [inicio, devolución).
 * @param {string} iso Día del calendario.
 * @returns {number} Índice ≥ 1 (puede exceder rentalDays() al previsualizar
 *   una extensión del alquiler).
 */
function calDayIndex(iso){
  return Math.round((new Date(iso) - new Date(rentalStart)) / 86400000) + 1;
}

/**
 * Etiqueta de coste bajo un día del calendario: solo la cifra.
 *
 * El importe se explica solo — un "+$0.00" ya dice que ese día no encarece
 * nada, y rotularlo además con palabras suena a que el negocio se justifica.
 * El color hace el resto del trabajo. Los días posteriores al fin del rango
 * también se etiquetan: son la previsualización de lo que costaría alargar.
 * @param {string} iso Día del calendario.
 * @returns {{cls:string, txt:string}|null} null si el día no lleva cifra.
 */
function calDayCost(iso){
  if(cart.length === 0) return null;
  if(iso < rentalStart) return null;
  const add = dayMarginalCost(calDayIndex(iso));
  // Sin cotización todavía no hay tarifa que enseñar: el día queda en blanco.
  if(add === null) return null;
  // El primer día es la base del alquiler, no un incremento: va sin el "+".
  if(calDayIndex(iso) === 1) return { cls: "base", txt: `$${add.toFixed(2)}` };
  return { cls: add === 0 ? "free" : "paid", txt: `+$${add.toFixed(2)}` };
}

/** Cuadrícula del mes visible con el rango marcado y la tarifa de cada día. */
function calGridHTML(){
  const hoy = isoOffset(0);
  const ym = calVisibleMonth();
  const dows = ["L","M","X","J","V","S","D"];
  const cells = monthGrid(ym).map(c => {
    const past = c.iso < hoy;
    // Fin de semana o feriado: el local no entrega ni recibe (§6.0).
    const closed = !past && !isBusinessDayISO(c.iso);
    const cost = past || closed ? null : calDayCost(c.iso);
    // Con un rango a medio elegir solo se resalta ese día: marcar el rango
    // viejo mientras se elige el nuevo confunde sobre qué está seleccionado.
    const sel = calPendingStart
      ? c.iso === calPendingStart
      : c.iso >= rentalStart && c.iso <= rentalEnd;
    // El rango se pinta como una barra continua, así que cada extremo necesita
    // saber que lo es: solo ahí se redondea la esquina. Un día suelto (rango
    // pendiente o de un solo día) es start y end a la vez y queda redondeado
    // por los dos lados.
    const esInicio = calPendingStart ? c.iso === calPendingStart : c.iso === rentalStart;
    const esFin    = calPendingStart ? c.iso === calPendingStart : c.iso === rentalEnd;
    const cls = [
      "cal-day",
      c.out ? "out" : "",
      past ? "past" : "",
      closed ? "closed" : "",
      sel ? "in" : "",
      sel && esInicio ? "start" : "",
      sel && esFin ? "end" : "",
      c.iso === calPendingStart ? "pending" : "",
    ].filter(Boolean).join(" ");
    return `<button type="button" class="${cls}" data-action="pickDay" data-iso="${c.iso}" ${past || closed ? "disabled" : ""}
              aria-label="${fmtDate(c.iso)}${closed ? " · cerrado" : ""}${cost ? ` · ${cost.txt}` : ""}">
        <span class="cd-n">${c.day}</span>
        <span class="cd-c ${cost ? cost.cls : ""}">${cost ? cost.txt : ""}</span>
      </button>`;
  }).join("");

  // No se retrocede antes del mes en curso: no se alquila hacia el pasado.
  const atFloor = ym <= monthOf(hoy);
  return `
    <div class="cal">
      <div class="cal-head">
        <button type="button" class="cal-nav" data-action="calPrev" ${atFloor?"disabled":""} aria-label="Mes anterior">${icon("arrowLeft", { size: 15 })}</button>
        <span class="cal-month">${monthLabel(ym)}</span>
        <button type="button" class="cal-nav" data-action="calNext" aria-label="Mes siguiente">${icon("arrowRight", { size: 15 })}</button>
      </div>
      <div class="cal-dow">${dows.map(d=>`<span>${d}</span>`).join("")}</div>
      <div class="cal-grid">${cells}</div>
    </div>`;
}

function dateBoxHTML(){
  const dias = rentalDays();
  const resumen = calPendingStart
    ? `${icon("calendar", { size: 13 })} Inicio ${fmtDate(calPendingStart)} · elige hasta cuándo`
    : `${dias} ${dias===1?'día':'días'} de alquiler · ${fmtDate(rentalStart)} → ${fmtDate(rentalEnd)}`;
  // La ventana regala días: se dice cuáles, para que nadie pague de más.
  const limite = returnByISO(rentalStart, rentalEnd);
  const ventana = !calPendingStart && limite > rentalEnd
    ? `<div class="date-window">${icon("undo", { size: 13 })} Puedes devolver sin costo extra hasta el ${fmtDate(limite)}. Sin retiros ni devoluciones en fin de semana o feriado.</div>`
    : "";
  return `
    <div class="date-box">
      <div class="dl">${icon("calendar", { size: 15 })} Período de alquiler</div>
      <div class="date-row">
        <div class="date-field">
          <label>Desde</label>
          <input type="date" id="rentStart" value="${rentalStart}" min="${isoOffset(0)}" />
        </div>
        <div class="date-field">
          <label>Hasta</label>
          <input type="date" id="rentEnd" value="${rentalEnd}" min="${rentalStart}" />
        </div>
      </div>
      ${calGridHTML()}
      <div class="date-total ${calPendingStart ? "pending" : ""}">${resumen}</div>
      ${ventana}
    </div>`;
}

/**
 * Clic en un día del calendario: primer clic fija el inicio, segundo cierra el
 * rango. Un clic anterior o igual al inicio pendiente reinicia la selección en
 * vez de rechazarla — es lo que hace el cliente cuando se equivoca de mes.
 * @param {string} iso Día pulsado.
 */
function pickCalendarDay(iso){
  if(!iso || iso < isoOffset(0)) return;         // no se alquila hacia atrás
  if(!isBusinessDayISO(iso)) return;             // ni en fin de semana o feriado
  if(calPendingStart === null){
    calPendingStart = iso;
  } else if(iso > calPendingStart){
    rentalStart = calPendingStart;
    rentalEnd = iso;
    calPendingStart = null;
  } else {
    calPendingStart = iso;
  }
  renderSheet();
}

/** Navega el calendario `n` meses, sin bajar del mes en curso. */
function shiftCalendar(n){
  const next = shiftMonth(calVisibleMonth(), n);
  if(next < monthOf(isoOffset(0))) return;
  calMonth = next;
  renderSheet();
}
/**
 * Llegó la cotización del carrito (requestQuote, en api.js): repinta la vista
 * del flujo de compra que esté abierta, que hasta ahora enseñaba "—".
 */
function onQuoteUpdated(){
  if(!sheet.classList.contains("show") || !["cart", "checkout", "payment"].includes(view)) return;
  // Repintar mientras se escribe (dirección, tarjeta) le quitaría el foco al
  // campo; el siguiente repintado (al salir del campo) ya trae los importes.
  const a = document.activeElement;
  if(a && a.matches("input, textarea") && sheet.contains(a)) return;
  renderSheet();
}

/* ---- Carrito ---- */
function renderCart(){
  sheetTitle.textContent = "Tu carrito";
  requestQuote();   // los importes los pone el servidor; al llegar, se repinta
  if(cart.length===0){
    sheetBody.innerHTML = `<div class="empty"><div class="em">${icon("shirt", { size: 34 })}</div><p>Tu carrito está vacío.<br>Agrega prendas para alquilar.</p></div>`;
    sheetFoot.innerHTML = "";
    return;
  }
  const days = rentalDays();
  sheetBody.innerHTML = dateBoxHTML() + cart.map(c=>{
    const p = productOrStub(c.id);
    return `
      <div class="cart-item">
        <div class="ci-thumb">${imgPlaceholder(p)}</div>
        <div class="ci-info">
          <div class="ci-name">${escapeHTML(p.name)}</div>
          <div class="ci-quality">${qualityMeter(p.stars)} <span style="color:var(--muted)">${conditionLabel(p.stars)} · Talla ${escapeHTML(p.size)}</span></div>
          <div class="ci-meta">${days} ${days===1?'día':'días'} · ${money(perDay(cartItemPrice(p), days))}/día · depósito ${money(catalogDeposit(p))}</div>
        </div>
        <div>
          <div class="ci-price">${money(cartItemPrice(p))}</div>
          <button class="ci-remove" data-action="remove" data-id="${p.id}">Quitar</button>
        </div>
      </div>`;
  }).join("");

  const savings = volumeSavings();
  const discountRow = savings > 0
    ? `<div class="summary-row"><span>Alquiler sin descuento</span><span style="text-decoration:line-through;color:var(--muted)">${money(subtotalBeforeVolume())}</span></div>
       <div class="summary-row"><span>Descuento por volumen <span class="refund-tag">−${Math.round(savings / subtotalBeforeVolume() * 100)}%</span></span><span>−$${savings.toFixed(2)}</span></div>`
    : "";
  sheetBody.innerHTML += `
    <div class="summary">
      ${discountRow}
      <div class="summary-row"><span>Subtotal alquiler</span><span>${money(subtotal())}</span></div>
      <div class="summary-row deposit"><span>Depósito <span class="refund-tag">reembolsable</span></span><span>${money(depositTotal())}</span></div>
      ${totalRowHTML("Total", sumOrNull(subtotal(), depositTotal()))}
    </div>
    ${/* La frase del depósito se fue: el propio total ya dice "$X se te
          devuelve", y repetirlo debajo era decir dos veces lo mismo. Lo que
          queda es el ahorro ya conseguido, que es un número concreto y no
          aparece en ninguna otra parte; el consejo genérico sobre tarifas
          también se fue, porque no informaba de este carrito sino del modelo. */""}
    ${savings > 0 ? `<p class="summary-note"><b>¡Ahorras $${savings.toFixed(2)} por alquilar varias prendas a la vez!</b></p>` : ""}`;

  sheetFoot.innerHTML = `<button class="pay-btn" data-action="toCheckout">Continuar a entrega ${icon("arrowRight", { size: 16 })}</button>`;
}

function removeItem(id){
  cart = cart.filter(c => c.id !== id);
  saveState();
  updateBadge();
  renderGrid();
  renderSheet();
}

/* ---- Checkout (entrega + pago) ---- */
function renderCheckout(){
  sheetTitle.textContent = "Entrega y pago";
  requestQuote();
  const ship = SHIPPING_FEE;
  const total = grandTotal();

  sheetBody.innerHTML = `
    <div class="section-label">¿Cómo quieres recibir tu pedido?</div>
    <div class="delivery-opts">
      ${optionCardHTML({ action:"setDelivery", value:DELIVERY.SHIP, active: delivery===DELIVERY.SHIP,
        glyph:"truck", title:"Envío a domicilio", note:`$${ship.toFixed(2)}`, noteVar:"accent",
        desc:"Recíbelo en 24–48 h en tu dirección." })}
      ${/* El detalle va PEGADO a la opción elegida, dentro de la lista. Colgado
            debajo de las dos, la dirección parecía referirse a la última tarjeta
            —o a ninguna— y había que deducir a cuál pertenecía. */""}
      ${delivery===DELIVERY.SHIP ? `
        <div class="opt-detail">
          ${addressFieldHTML("ship", "Dirección de envío", address, addressCoords)}
        </div>` : ``}
      ${optionCardHTML({ action:"setDelivery", value:DELIVERY.PICKUP, active: delivery===DELIVERY.PICKUP,
        glyph:"store", title:"Retiro en local", note:"Gratis",
        desc:"Recoge en nuestro único local físico." })}
      ${delivery===DELIVERY.PICKUP ? `<div class="opt-detail">${localCardHTML()}</div>` : ``}
    </div>

    <div class="section-label">¿Cómo deseas devolver la ropa al terminar el alquiler?</div>
    <div class="delivery-opts">
      ${optionCardHTML({ action:"setReturn", value:RETURN_TO.STORE, active: returnMethod===RETURN_TO.STORE,
        glyph:"store", title:"Devolver en el local", note:"Gratis",
        desc:"Acércate a nuestro local físico al terminar el alquiler." })}
      ${/* Elegir "devolver en el local" sin ver CUÁL local deja al cliente
            aceptando ir a una dirección que nadie le dijo. Va pegada a su
            opción, no debajo de las dos. */""}
      ${returnMethod===RETURN_TO.STORE ? `<div class="opt-detail">${localCardHTML()}</div>` : ``}
      ${optionCardHTML({ action:"setReturn", value:RETURN_TO.HOME, active: returnMethod===RETURN_TO.HOME,
        glyph:"truck", title:"Retiro a domicilio", note:`$${ship.toFixed(2)}`, noteVar:"accent",
        desc:"Pasamos por tu dirección a retirar las prendas." })}
      ${returnMethod===RETURN_TO.HOME ? `
        <div class="opt-detail">
          ${addressFieldHTML("return", "Dirección de retiro", returnAddress, returnAddressCoords)}
        </div>` : ``}
    </div>

    ${couponSectionHTML()}

    <div class="summary">
      <div class="summary-row"><span>Período</span><span>${rentalDays()} ${rentalDays()===1?'día':'días'} · ${fmtDate(rentalStart)} → ${fmtDate(rentalEnd)}</span></div>
      <div class="summary-row"><span>Subtotal alquiler</span><span>${money(subtotal())}</span></div>
      <div class="summary-row deposit"><span>Depósito <span class="refund-tag">reembolsable</span></span><span>${money(depositTotal())}</span></div>
      <div class="summary-row"><span>Envío</span><span>${delivery===DELIVERY.SHIP?'$'+ship.toFixed(2):delivery===DELIVERY.PICKUP?'$0.00':'—'}</span></div>
      <div class="summary-row"><span>Devolución</span><span>${returnMethod===RETURN_TO.HOME?'$'+ship.toFixed(2):returnMethod===RETURN_TO.STORE?'$0.00':'—'}</span></div>
      ${couponDiscount() > 0 ? `
        <div class="summary-row discount"><span>${icon("ticket", { size: 14 })} ${escapeHTML(couponById(appliedCoupon).name)}</span><span>−${money(couponDiscount())}</span></div>` : ""}
      ${totalRowHTML("Total a pagar", total)}
    </div>
  `;

  const valid = checkoutValid();

  let payLabel = `Continuar al pago ${icon("arrowRight", { size: 16 })}`;
  if(!delivery)                                          payLabel = 'Elige cómo recibir tu pedido';
  else if(delivery===DELIVERY.SHIP && !addressReady(address, addressCoords)) payLabel = mapsAvailable() ? 'Marca la ubicación de envío en el mapa' : 'Ingresa una dirección de envío válida';
  else if(!returnMethod)                                 payLabel = 'Elige cómo devolver la ropa';
  else if(returnMethod===RETURN_TO.HOME && !addressReady(returnAddress, returnAddressCoords)) payLabel = mapsAvailable() ? 'Marca la ubicación de retiro en el mapa' : 'Ingresa una dirección de retiro válida';

  sheetFoot.innerHTML = `
    <button class="pay-btn" data-action="toPayment" ${valid?'':'disabled'}>${payLabel}</button>`;
}

/**
 * Sección de premios del checkout: los canjes disponibles. Se aplica uno solo
 * por alquiler — acumularlos complicaría el cobro sin que el catálogo de
 * premios lo pida.
 *
 * Cuánto rebaja el premio aplicado (o por qué no rebaja nada aquí) lo dice la
 * cotización del servidor: es el mismo cálculo que hará al cobrar, así que el
 * checkout no puede prometer un descuento que después no se aplica.
 * @returns {string} HTML, o vacío si no hay premios por usar.
 */
function couponSectionHTML(){
  const disponibles = availableCoupons();
  if(!disponibles.length) return "";
  const motivo = couponIssue();
  const monto = couponDiscount();

  return `
    <div class="section-label">Tus premios</div>
    <div class="coupon-opts">
      ${disponibles.map(c => {
        const rw = rewardById(c.rewardId);
        const activo = appliedCoupon === c.id;
        const nota = activo && motivo
          ? `${escapeHTML(motivo)} No se gastará.`
          : escapeHTML(rw ? rw.desc : "");
        return `
        <div class="coupon-opt ${activo && !motivo ? 'active' : ''} ${activo && motivo ? 'locked' : ''}"
             data-action="applyCoupon" data-id="${c.id}" role="button" tabindex="0" aria-pressed="${activo}">
          <div class="do-icon">${icon(rw ? rw.icon : "ticket", { size: 20 })}</div>
          <div class="do-text">
            <div class="do-title">
              <span>${escapeHTML(c.name)}</span>
              ${activo && monto > 0 ? `<span style="color:var(--ok)">−${money(monto)}</span>` : ""}
            </div>
            <div class="do-desc">${nota}</div>
          </div>
          <div class="do-radio"></div>
        </div>`;
      }).join("")}
    </div>
    ${appliedCoupon != null
      ? `<button class="link-btn" data-action="clearCoupon">Quitar el premio aplicado</button>`
      : ""}`;
}

/**
 * ¿Está resuelto CÓMO recibe el cliente el pedido?
 * Retirar en el local no pide nada más; el envío exige dirección utilizable
 * (ver addressReady en maps.js: con selector de mapa manda el punto, sin él
 * manda el texto).
 * @returns {boolean}
 */
function deliveryReady(){
  if(delivery === DELIVERY.PICKUP) return true;
  return delivery === DELIVERY.SHIP && addressReady(address, addressCoords);
}

/**
 * ¿Está resuelto CÓMO devuelve el cliente las prendas?
 * @returns {boolean}
 */
function returnReady(){
  if(returnMethod === RETURN_TO.STORE) return true;
  return returnMethod === RETURN_TO.HOME && addressReady(returnAddress, returnAddressCoords);
}

/**
 * ¿El checkout tiene datos suficientes para pagar?
 *
 * Devuelve booleano de verdad. Antes empezaba por `delivery && …`, así que sin
 * entrega elegida respondía `null`: funcionaba porque solo alimenta un
 * `disabled`, pero es una firma que miente y que el primer `=== false` o el
 * primer `JSON.stringify` habrían delatado.
 * @returns {boolean}
 */
function checkoutValid(){
  return deliveryReady() && returnReady();
}

/* ---- Pago (método) ---- */
function renderPayment(){
  sheetTitle.textContent = "Método de pago";
  requestQuote();
  const total = grandTotal();
  const isCard = payMethod===PAY_METHOD.CREDIT || payMethod===PAY_METHOD.DEBIT;

  sheetBody.innerHTML = `
    <div class="section-label">¿Cómo deseas pagar?</div>
    <div class="delivery-opts">
      <div class="delivery-opt ${payMethod===PAY_METHOD.CASH?'active':''}" data-action="setPay" data-value="${PAY_METHOD.CASH}" role="button" tabindex="0" aria-pressed="${payMethod===PAY_METHOD.CASH}">
        <div class="do-icon">${icon("cash", { size: 22 })}</div>
        <div class="do-text">
          <div class="do-title"><span>Efectivo</span></div>
          <div class="do-desc">Pagas al recibir o retirar tu pedido.</div>
        </div>
        <div class="do-radio"></div>
      </div>
      <div class="delivery-opt ${payMethod===PAY_METHOD.CREDIT?'active':''}" data-action="setPay" data-value="${PAY_METHOD.CREDIT}" role="button" tabindex="0" aria-pressed="${payMethod===PAY_METHOD.CREDIT}">
        <div class="do-icon">${icon("card", { size: 22 })}</div>
        <div class="do-text">
          <div class="do-title"><span>Tarjeta de crédito</span></div>
          <div class="do-desc">Visa, Mastercard, etc.</div>
        </div>
        <div class="do-radio"></div>
      </div>
      <div class="delivery-opt ${payMethod===PAY_METHOD.DEBIT?'active':''}" data-action="setPay" data-value="${PAY_METHOD.DEBIT}" role="button" tabindex="0" aria-pressed="${payMethod===PAY_METHOD.DEBIT}">
        <div class="do-icon">${icon("bank", { size: 22 })}</div>
        <div class="do-text">
          <div class="do-title"><span>Tarjeta de débito</span></div>
          <div class="do-desc">Débito bancario.</div>
        </div>
        <div class="do-radio"></div>
      </div>
    </div>

    ${isCard ? `
      <div class="card-form">
        <label class="pf-fld">Número de tarjeta
          <input id="cardNumber" inputmode="numeric" maxlength="19" placeholder="1234 5678 9012 3456" value="${escapeHTML(card.number)}" />
        </label>
        <label class="pf-fld">Nombre en la tarjeta
          <input id="cardName" placeholder="Como aparece en la tarjeta" value="${escapeHTML(card.name)}" />
        </label>
        <div class="card-row">
          <label class="pf-fld">Vence (MM/AA)
            <input id="cardExpiry" inputmode="numeric" maxlength="5" placeholder="MM/AA" value="${escapeHTML(card.expiry)}" />
          </label>
          <label class="pf-fld">CVV
            <input id="cardCvv" inputmode="numeric" maxlength="4" placeholder="123" value="${escapeHTML(card.cvv)}" />
          </label>
        </div>
        <p class="pay-note">${icon("lock", { size: 14 })} Demo: los datos de la tarjeta no se procesan ni se guardan. La pasarela de pago se integrará con el backend.</p>
      </div>` : ``}

    ${payMethod===PAY_METHOD.CASH ? `
      <div class="pickup-detail">${icon("cash", { size: 15 })} Pagarás <b>${money(total)}</b> en efectivo al recibir o retirar tu pedido.</div>` : ``}

    <div class="summary">
      ${couponDiscount() > 0 ? `
        <div class="summary-row discount"><span>${icon("ticket", { size: 14 })} ${escapeHTML(couponById(appliedCoupon).name)}</span><span>−${money(couponDiscount())}</span></div>` : ""}
      ${totalRowHTML("Total a pagar", total)}
    </div>
  `;

  // Sin cotización vigente no hay importe que confirmar: el botón espera.
  const valid = paymentValid() && quoteReady();
  let label = 'Confirmar pedido';
  if(!payMethod)                label = 'Elige un método de pago';
  else if(isCard && !paymentValid()) label = 'Completa los datos de la tarjeta';
  else if(!quoteReady())        label = 'Calculando el precio…';

  sheetFoot.innerHTML = `<button class="pay-btn" data-action="confirmOrder" ${valid?'':'disabled'}>${label}</button>`;
}

/* ---- Resumen previo a confirmar ----
   Último punto donde el cliente puede echarse atrás sin coste. Repite las
   fechas, las prendas, lo que se cobra y lo que vuelve, porque el pago es el
   paso donde más se abandona: el total incluye el depósito y, sin desglosarlo
   otra vez aquí, se lee como si el alquiler costase mucho más de lo que cuesta. */

/**
 * Miniaturas y nombres de las prendas del carrito para el diálogo.
 * @returns {string} HTML con los valores ya escapados.
 */
function confirmItemsHTML(){
  return cart.map(c => {
    const p = productOrStub(c.id);
    return `
      <li class="oc-item">
        <span class="oc-thumb">${imgPlaceholder(p)}</span>
        <span class="oc-name">${escapeHTML(p.name)}</span>
        <span class="oc-price">${money(cartItemPrice(p))}</span>
      </li>`;
  }).join("");
}

/**
 * Cuerpo del diálogo de confirmación: período, prendas, cobro y reembolso.
 * @returns {string} HTML (todo lo variable pasa por escapeHTML()).
 */
function confirmDetailHTML(){
  const dias = rentalDays();
  const dep = depositTotal();
  const desc = couponDiscount();
  const aPagar = grandTotal();
  const envio = shippingFee() + returnFee();
  return `
    <div class="order-confirm">
      <div class="oc-dates">
        ${icon("calendar", { size: 14 })}
        <b>${escapeHTML(fmtDate(rentalStart))} → ${escapeHTML(fmtDate(rentalEnd))}</b>
        <span class="oc-days">${dias} ${dias === 1 ? "día" : "días"}</span>
      </div>
      <ul class="oc-items">${confirmItemsHTML()}</ul>
      <div class="oc-rows">
        <div class="oc-row"><span>Alquiler</span><span>${money(subtotal())}</span></div>
        ${envio > 0 ? `<div class="oc-row"><span>Envío y retiro</span><span>$${envio.toFixed(2)}</span></div>` : ""}
        ${desc > 0 ? `<div class="oc-row discount"><span>Premio canjeado</span><span>−${money(desc)}</span></div>` : ""}
        ${dep > 0 ? `<div class="oc-row"><span>Depósito</span><span>${money(dep)}</span></div>` : ""}
        <div class="oc-row pay"><span>Pagas ahora</span><span>${money(aPagar)}</span></div>
      </div>
      ${dep > 0 ? `<div class="oc-refund">${icon("undo", { size: 14 })}
        Se te devuelven <b>${money(dep)}</b> al regresar las prendas en buen estado.</div>` : ""}
    </div>`;
}

/**
 * Abre el resumen final y solo registra el pedido si el cliente lo acepta.
 * Es lo que dispara el botón de pago; placeOrder() sigue siendo la operación
 * de verdad y se puede llamar suelta (los tests lo hacen).
 */
function confirmOrder(){
  if(!checkoutValid() || !paymentValid() || !quoteReady()) return;
  confirmDialog("", placeOrder, "check", {
    title: "¿Confirmas tu alquiler?",
    detailHTML: confirmDetailHTML(),
    okLabel: `Confirmar y pagar ${money(grandTotal())}`,
  });
}

// ¿El método de pago está completo? (efectivo siempre; tarjeta exige datos válidos)
function paymentValid(){
  if(payMethod===PAY_METHOD.CASH) return true;
  if(payMethod===PAY_METHOD.CREDIT || payMethod===PAY_METHOD.DEBIT){
    return isValidCardNumber(card.number) && isValidName(card.name)
        && isValidExpiry(card.expiry) && isValidCvv(card.cvv);
  }
  return false;
}

// Si hay un pedido en vuelo: el botón no puede crear dos por un doble toque.
let placingOrder = false;

/**
 * Registra el alquiler: lo crea en la API y pasa a la confirmación.
 *
 * Desde la fase 3 el pedido lo guarda la base, no el navegador: el cliente
 * manda qué ejemplares, qué fechas y qué modos (más el canje, por id), y el
 * servidor pone los importes, los puntos y el descuento. Lo que se pinta
 * después es lo que respondió, nunca un total calculado aquí. Sin sesión o sin
 * API no hay dónde guardarlo: se dice, y el carrito queda intacto. La tarjeta
 * sigue simulada y no viaja (no hay pasarela hasta la fase 5).
 * @returns {Promise<boolean>} true si el pedido quedó creado.
 */
async function placeOrder(){
  if(placingOrder) return false;
  if(!checkoutValid() || !paymentValid()) return false;   // por si el botón estuviera activo
  if(!currentUser){ askLoginToRent(); return false; }
  if(!canRentOnline()){
    toast("Para alquilar hace falta conexión con el servidor.");
    return false;
  }
  const items = cartItemIds();
  if(!items){
    toast("Alguna prenda del carrito ya no está disponible.");
    return false;
  }
  // Lo que la confirmación necesita del carrito, antes de vaciarlo.
  const litros = cartWaterSaved();

  placingOrder = true;
  const r = await apiFetch("/api/orders", { method: "POST", body: {
    items,
    start: rentalStart,
    end: rentalEnd,
    delivery,
    ret: returnMethod,
    shipAddr: delivery === DELIVERY.SHIP ? address.trim() : undefined,
    retAddr: returnMethod === RETURN_TO.HOME ? returnAddress.trim() : undefined,
    pay: payMethod,
    couponId: appliedCoupon ?? undefined,
  }});
  placingOrder = false;

  if(!r.ok){
    toast(apiErrorText(r));
    // Otro cliente se llevó la prenda: el catálogo de la API dirá cuál.
    if(r.status === 409) hydrateCatalog();
    return false;
  }

  const order = orderFromApi(r.data);
  // Coordenadas del reparto: el servidor aún no las guarda, pero el pedido de
  // esta sesión las conserva para quien lo mire ahora.
  order.shipCoords = delivery === DELIVERY.SHIP ? addressCoords : null;
  order.retCoords = returnMethod === RETURN_TO.HOME ? returnAddressCoords : null;
  if(r.data.couponIssue) toast(`Premio no aplicado: ${r.data.couponIssue}`);
  orders.push(order);
  lastEarnedPoints = order.points;
  lastWaterSaved = litros;
  lastWaterGoals = [];
  // La confirmación se pinta desde el pedido, no del carrito: lo vaciamos ya
  // para que cerrar la hoja sin pulsar "finalizar" no permita repedir lo mismo.
  lastOrder = order;
  cart = [];
  appliedCoupon = null;
  card = { number:"", name:"", expiry:"", cvv:"" };
  saveState();
  view = "done"; renderSheet(); updateBadge(); renderGrid();
  // La prenda reservada sale del catálogo, y el cupón gastado de la cartera.
  hydrateCatalog();
  syncAccount();
  return true;
}

/* ---- Confirmación ----
   No se desglosa aquí la compra: el detalle del pedido (prendas, período,
   entrega, depósito, estado del pago) vive en el perfil. La confirmación queda
   como un acuse breve + el ahorro de agua (antes un pop-up aparte) + un acceso
   directo a "Mis pedidos". */
function renderDone(){
  sheetTitle.textContent = "¡Listo!";
  if(!lastOrder) return;              // sin pedido reciente no hay nada que confirmar
  const o = lastOrder;
  sheetBody.innerHTML = `
    <div class="confirm">
      <div class="big">${icon("sparkles", { size: 46 })}</div>
      <h2>Alquiler confirmado</h2>
      <p>Gracias por elegir CLOTH TO GO. Cuida tus prendas y devuélvelas a tiempo ${icon("heart", { size: 14 })}</p>
      ${o.pointsCredited
        ? `<div class="earned-points">${icon("sprout", { size: 16 })} Ganaste <b>${o.points}</b> puntos con este alquiler</div>`
        : `<div class="earned-points pending">${icon("sprout", { size: 16 })} Ganarás <b>${o.points}</b> puntos cuando recibas tus prendas</div>`}
      ${o.discount > 0 ? `<div class="coupon-used">${icon("ticket", { size: 16 })} Premio aplicado: <b>−$${o.discount.toFixed(2)}</b></div>` : ``}
      ${lastWaterSaved > 0 ? `<div class="water-saved">${icon("droplet", { size: 16 })} Ahorraste <b>~${fmtLiters(lastWaterSaved)} litros</b> de agua al reutilizar ropa</div>` : ``}
      ${lastWaterGoals.length ? lastWaterGoals.map(g =>
        `<div class="goal-hit">${icon("award", { size: 16 })} Meta “${escapeHTML(g.name)}” conseguida · <b>+${g.points} pts</b></div>`).join("") : ``}
      <button class="pay-btn ver-pedidos" data-action="goToOrders">Ver mis pedidos ${icon("arrowRight", { size: 16 })}</button>
    </div>`;
  sheetFoot.innerHTML = `<button class="pay-btn ghost" data-action="finish">Volver al catálogo</button>`;
}

// Restablece el estado de checkout tras cerrar un pedido (el carrito ya se vació
// en placeOrder). Compartido por "Volver al catálogo" y "Ver mis pedidos".
function resetCheckoutState(){
  delivery = null; address = ""; returnMethod = null; returnAddress = "";
  addressCoords = null; returnAddressCoords = null;
  payMethod = null; card = { number:"", name:"", expiry:"", cvv:"" };
  appliedCoupon = null;
  lastEarnedPoints = 0; lastWaterSaved = 0; lastWaterGoals = []; lastOrder = null;
}

// "Volver al catálogo": cierra el flujo y vuelve a la grilla.
function finishOrder(){
  resetCheckoutState();
  view = "cart";
  saveState();
  updateBadge(); renderGrid(); closeSheet();
}

// "Ver mis pedidos": cierra el flujo y abre el perfil desplazado a la sección de
// pedidos (activos/vigentes). Los finalizados quedan en su desplegable.
function goToOrders(){
  resetCheckoutState();
  editingOrder = null; editingProfile = false;
  view = "profile";
  saveState();
  updateBadge(); renderGrid(); renderSheet();
  scrollSheetTo("misPedidos");
}
