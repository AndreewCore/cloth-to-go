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
        <span class="total-amount">$${total.toFixed(2)}</span>
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
    const cost = past ? null : calDayCost(c.iso);
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
      sel ? "in" : "",
      sel && esInicio ? "start" : "",
      sel && esFin ? "end" : "",
      c.iso === calPendingStart ? "pending" : "",
    ].filter(Boolean).join(" ");
    return `<button type="button" class="${cls}" data-action="pickDay" data-iso="${c.iso}" ${past?"disabled":""}
              aria-label="${fmtDate(c.iso)}${cost ? ` · ${cost.txt}` : ""}">
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
/* ---- Carrito ---- */
function renderCart(){
  sheetTitle.textContent = "Tu carrito";
  if(cart.length===0){
    sheetBody.innerHTML = `<div class="empty"><div class="em">${icon("shirt", { size: 34 })}</div><p>Tu carrito está vacío.<br>Agrega prendas para alquilar.</p></div>`;
    sheetFoot.innerHTML = "";
    return;
  }
  const days = rentalDays();
  sheetBody.innerHTML = dateBoxHTML() + cart.map(c=>{
    const p = productById(c.id);
    return `
      <div class="cart-item">
        <div class="ci-thumb">${imgPlaceholder(p)}</div>
        <div class="ci-info">
          <div class="ci-name">${escapeHTML(p.name)}</div>
          <div class="ci-stars">${starStr(p.stars)} <span style="color:var(--muted)">${conditionLabel(p.stars)} · Talla ${escapeHTML(p.size)}</span></div>
          <div class="ci-meta">${days} ${days===1?'día':'días'} · $${(cartItemPrice(p)/days).toFixed(2)}/día · depósito $${depositFor(p)}</div>
        </div>
        <div>
          <div class="ci-price">$${cartItemPrice(p).toFixed(2)}</div>
          <button class="ci-remove" data-action="remove" data-id="${p.id}">Quitar</button>
        </div>
      </div>`;
  }).join("");

  const savings = volumeSavings();
  const discountRow = savings > 0
    ? `<div class="summary-row"><span>Alquiler sin descuento</span><span style="text-decoration:line-through;color:var(--muted)">$${subtotalBeforeVolume().toFixed(2)}</span></div>
       <div class="summary-row"><span>Descuento por volumen <span class="refund-tag">−${Math.round(volumeRate()*100)}%</span></span><span>−$${savings.toFixed(2)}</span></div>`
    : "";
  sheetBody.innerHTML += `
    <div class="summary">
      ${discountRow}
      <div class="summary-row"><span>Subtotal alquiler</span><span>$${subtotal().toFixed(2)}</span></div>
      <div class="summary-row deposit"><span>Depósito <span class="refund-tag">reembolsable</span></span><span>$${depositTotal().toFixed(2)}</span></div>
      ${totalRowHTML("Total", subtotal()+depositTotal())}
    </div>
    <p class="summary-note">${icon("bulb", { size: 14 })} El depósito se devuelve al regresar las prendas en buen estado.${savings > 0 ? ` <b>¡Ahorras $${savings.toFixed(2)} por alquilar varias prendas a la vez!</b>` : ` Mientras más días alquiles, más barato sale cada día; y llevando varias prendas ahorras hasta un ${Math.round(VOLUME_DISCOUNT_MAX*100)}%.`}</p>`;

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
  const ship = SHIPPING_FEE;
  const total = grandTotal();

  sheetBody.innerHTML = `
    <div class="section-label">¿Cómo quieres recibir tu pedido?</div>
    <div class="delivery-opts">
      <div class="delivery-opt ${delivery==='ship'?'active':''}" data-action="setDelivery" data-value="ship" role="button" tabindex="0" aria-pressed="${delivery==='ship'}">
        <div class="do-icon">${icon("truck", { size: 22 })}</div>
        <div class="do-text">
          <div class="do-title"><span>Envío a domicilio</span><span style="color:var(--accent)">$${ship.toFixed(2)}</span></div>
          <div class="do-desc">Recíbelo en 24–48 h en tu dirección.</div>
        </div>
        <div class="do-radio"></div>
      </div>
      <div class="delivery-opt ${delivery==='pickup'?'active':''}" data-action="setDelivery" data-value="pickup" role="button" tabindex="0" aria-pressed="${delivery==='pickup'}">
        <div class="do-icon">${icon("store", { size: 22 })}</div>
        <div class="do-text">
          <div class="do-title"><span>Retiro en local</span><span style="color:var(--ok)">Gratis</span></div>
          <div class="do-desc">Recoge en nuestro único local físico.</div>
        </div>
        <div class="do-radio"></div>
      </div>
    </div>
    ${delivery==='ship' ? `
      <div class="ship-detail">
        ${addressFieldHTML("ship", "Dirección de envío", address, addressCoords)}
      </div>` : ``}
    ${delivery==='pickup' ? `
      <div class="pickup-detail">
        ${icon("store", { size: 15 })} <b>${LOCAL.nombre}</b><br>
        ${LOCAL.direccion}<br>
        <span style="color:var(--muted)">${LOCAL.horario}</span>
      </div>` : ``}

    <div class="section-label">¿Cómo deseas devolver la ropa al terminar el alquiler?</div>
    <div class="delivery-opts">
      <div class="delivery-opt ${returnMethod==='store'?'active':''}" data-action="setReturn" data-value="store" role="button" tabindex="0" aria-pressed="${returnMethod==='store'}">
        <div class="do-icon">${icon("store", { size: 22 })}</div>
        <div class="do-text">
          <div class="do-title"><span>Devolver en el local</span><span style="color:var(--ok)">Gratis</span></div>
          <div class="do-desc">Acércate a nuestro local físico al terminar el alquiler.</div>
        </div>
        <div class="do-radio"></div>
      </div>
      <div class="delivery-opt ${returnMethod==='home'?'active':''}" data-action="setReturn" data-value="home" role="button" tabindex="0" aria-pressed="${returnMethod==='home'}">
        <div class="do-icon">${icon("truck", { size: 22 })}</div>
        <div class="do-text">
          <div class="do-title"><span>Retiro a domicilio</span><span style="color:var(--accent)">$${ship.toFixed(2)}</span></div>
          <div class="do-desc">Pasamos por tu dirección a retirar las prendas.</div>
        </div>
        <div class="do-radio"></div>
      </div>
    </div>
    ${returnMethod==='home' ? `
      <div class="ship-detail">
        ${addressFieldHTML("return", "Dirección de retiro", returnAddress, returnAddressCoords)}
      </div>` : ``}

    ${couponSectionHTML()}

    <div class="summary">
      <div class="summary-row"><span>Período</span><span>${rentalDays()} ${rentalDays()===1?'día':'días'} · ${fmtDate(rentalStart)} → ${fmtDate(rentalEnd)}</span></div>
      <div class="summary-row"><span>Subtotal alquiler</span><span>$${subtotal().toFixed(2)}</span></div>
      <div class="summary-row deposit"><span>Depósito <span class="refund-tag">reembolsable</span></span><span>$${depositTotal().toFixed(2)}</span></div>
      <div class="summary-row"><span>Envío</span><span>${delivery==='ship'?'$'+ship.toFixed(2):delivery==='pickup'?'$0.00':'—'}</span></div>
      <div class="summary-row"><span>Devolución</span><span>${returnMethod==='home'?'$'+ship.toFixed(2):returnMethod==='store'?'$0.00':'—'}</span></div>
      ${couponDiscount() > 0 ? `
        <div class="summary-row discount"><span>${icon("ticket", { size: 14 })} ${escapeHTML(couponById(appliedCoupon).name)}</span><span>−$${couponDiscount().toFixed(2)}</span></div>` : ""}
      ${totalRowHTML("Total a pagar", total)}
    </div>
    <p class="summary-note">${icon("bulb", { size: 14 })} El depósito se devuelve al regresar las prendas en buen estado.</p>
  `;

  const valid = checkoutValid();

  let payLabel = `Continuar al pago ${icon("arrowRight", { size: 16 })}`;
  if(!delivery)                                          payLabel = 'Elige cómo recibir tu pedido';
  else if(delivery==='ship' && !addressReady(address, addressCoords)) payLabel = mapsAvailable() ? 'Marca la ubicación de envío en el mapa' : 'Ingresa una dirección de envío válida';
  else if(!returnMethod)                                 payLabel = 'Elige cómo devolver la ropa';
  else if(returnMethod==='home' && !addressReady(returnAddress, returnAddressCoords)) payLabel = mapsAvailable() ? 'Marca la ubicación de retiro en el mapa' : 'Ingresa una dirección de retiro válida';

  sheetFoot.innerHTML = `
    <button class="pay-btn" data-action="toPayment" ${valid?'':'disabled'}>${payLabel}</button>`;
}

/**
 * Sección de premios del checkout: los canjes disponibles, con su descuento ya
 * calculado sobre ESTE pedido. Se aplica uno solo por alquiler — acumularlos
 * complicaría el cobro sin que el catálogo de premios lo pida.
 *
 * Los premios que no aplican se muestran igualmente (deshabilitados y con el
 * motivo): esconderlos dejaría al cliente creyendo que perdió el canje.
 * @returns {string} HTML, o vacío si no hay premios por usar.
 */
function couponSectionHTML(){
  const disponibles = availableCoupons();
  if(!disponibles.length) return "";
  const ctx = cartRewardCtx();

  return `
    <div class="section-label">Tus premios</div>
    <div class="coupon-opts">
      ${disponibles.map(c => {
        const rw = rewardById(c.rewardId);
        const motivo = rewardIssue(rw, ctx);
        const monto = rewardDiscount(rw, ctx);
        const usable = !motivo && monto > 0;
        // Solo se marca activo si además sirve: cambiar la entrega puede dejar
        // sin efecto un premio ya elegido, y pintarlo seleccionado mentiría
        // sobre un descuento que el total (correctamente) ya no aplica.
        const activo = appliedCoupon === c.id && usable;
        return `
        <div class="coupon-opt ${activo?'active':''} ${usable?'':'locked'}"
             ${usable ? `data-action="applyCoupon" data-id="${c.id}" role="button" tabindex="0" aria-pressed="${activo}"` : ""}>
          <div class="do-icon">${icon(rw ? rw.icon : "ticket", { size: 20 })}</div>
          <div class="do-text">
            <div class="do-title">
              <span>${escapeHTML(c.name)}</span>
              ${usable ? `<span style="color:var(--ok)">−$${monto.toFixed(2)}</span>` : ""}
            </div>
            <div class="do-desc">${motivo ? escapeHTML(motivo) : escapeHTML(rw ? rw.desc : "")}</div>
          </div>
          <div class="do-radio"></div>
        </div>`;
      }).join("")}
    </div>
    ${couponDiscount() > 0
      ? `<button class="link-btn" data-action="clearCoupon">Quitar el premio aplicado</button>`
      : ""}`;
}

// ¿El checkout tiene datos suficientes para pagar?
function checkoutValid(){
  const deliveryOk = delivery && (delivery==="pickup" || (delivery==="ship" && addressReady(address, addressCoords)));
  const returnOk = returnMethod && (returnMethod==="store" || (returnMethod==="home" && addressReady(returnAddress, returnAddressCoords)));
  return deliveryOk && returnOk;
}

/* ---- Pago (método) ---- */
function renderPayment(){
  sheetTitle.textContent = "Método de pago";
  const total = grandTotal();
  const isCard = payMethod==="credit" || payMethod==="debit";

  sheetBody.innerHTML = `
    <div class="section-label">¿Cómo deseas pagar?</div>
    <div class="delivery-opts">
      <div class="delivery-opt ${payMethod==='cash'?'active':''}" data-action="setPay" data-value="cash" role="button" tabindex="0" aria-pressed="${payMethod==='cash'}">
        <div class="do-icon">${icon("cash", { size: 22 })}</div>
        <div class="do-text">
          <div class="do-title"><span>Efectivo</span></div>
          <div class="do-desc">Pagas al recibir o retirar tu pedido.</div>
        </div>
        <div class="do-radio"></div>
      </div>
      <div class="delivery-opt ${payMethod==='credit'?'active':''}" data-action="setPay" data-value="credit" role="button" tabindex="0" aria-pressed="${payMethod==='credit'}">
        <div class="do-icon">${icon("card", { size: 22 })}</div>
        <div class="do-text">
          <div class="do-title"><span>Tarjeta de crédito</span></div>
          <div class="do-desc">Visa, Mastercard, etc.</div>
        </div>
        <div class="do-radio"></div>
      </div>
      <div class="delivery-opt ${payMethod==='debit'?'active':''}" data-action="setPay" data-value="debit" role="button" tabindex="0" aria-pressed="${payMethod==='debit'}">
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

    ${payMethod==='cash' ? `
      <div class="pickup-detail">${icon("cash", { size: 15 })} Pagarás <b>$${total.toFixed(2)}</b> en efectivo al recibir o retirar tu pedido.</div>` : ``}

    <div class="summary">
      ${couponDiscount() > 0 ? `
        <div class="summary-row discount"><span>${icon("ticket", { size: 14 })} ${escapeHTML(couponById(appliedCoupon).name)}</span><span>−$${couponDiscount().toFixed(2)}</span></div>` : ""}
      ${totalRowHTML("Total a pagar", total)}
    </div>
    <p class="summary-note">${icon("bulb", { size: 14 })} El depósito se devuelve al regresar las prendas en buen estado.</p>
  `;

  const valid = paymentValid();
  let label = 'Confirmar pedido';
  if(!payMethod)            label = 'Elige un método de pago';
  else if(isCard && !valid) label = 'Completa los datos de la tarjeta';

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
    const p = productById(c.id);
    return `
      <li class="oc-item">
        <span class="oc-thumb">${imgPlaceholder(p)}</span>
        <span class="oc-name">${escapeHTML(p.name)}</span>
        <span class="oc-price">$${cartItemPrice(p).toFixed(2)}</span>
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
        <div class="oc-row"><span>Alquiler</span><span>$${subtotal().toFixed(2)}</span></div>
        ${envio > 0 ? `<div class="oc-row"><span>Envío y retiro</span><span>$${envio.toFixed(2)}</span></div>` : ""}
        ${desc > 0 ? `<div class="oc-row discount"><span>Premio canjeado</span><span>−$${desc.toFixed(2)}</span></div>` : ""}
        ${dep > 0 ? `<div class="oc-row"><span>Depósito</span><span>$${dep.toFixed(2)}</span></div>` : ""}
        <div class="oc-row pay"><span>Pagas ahora</span><span>$${aPagar.toFixed(2)}</span></div>
      </div>
      ${dep > 0 ? `<div class="oc-refund">${icon("undo", { size: 14 })}
        Se te devuelven <b>$${dep.toFixed(2)}</b> al regresar las prendas en buen estado.</div>` : ""}
    </div>`;
}

/**
 * Abre el resumen final y solo registra el pedido si el cliente lo acepta.
 * Es lo que dispara el botón de pago; placeOrder() sigue siendo la operación
 * de verdad y se puede llamar suelta (los tests lo hacen).
 */
function confirmOrder(){
  if(!checkoutValid() || !paymentValid()) return;
  confirmDialog("", placeOrder, "check", {
    title: "¿Confirmas tu alquiler?",
    detailHTML: confirmDetailHTML(),
    okLabel: `Confirmar y pagar $${grandTotal().toFixed(2)}`,
  });
}

// ¿El método de pago está completo? (efectivo siempre; tarjeta exige datos válidos)
function paymentValid(){
  if(payMethod==="cash") return true;
  if(payMethod==="credit" || payMethod==="debit"){
    return isValidCardNumber(card.number) && isValidName(card.name)
        && isValidExpiry(card.expiry) && isValidCvv(card.cvv);
  }
  return false;
}

// Registra la orden: crea UN pedido que agrupa las prendas del carrito, guarda
// el valor total del cobro y su estado, y pasa a la confirmación.
// (No procesa el pago: eso corresponde al backend/pasarela, aún sin integrar.)
function placeOrder(){
  if(!checkoutValid() || !paymentValid()) return;   // guarda por si el botón estuviera activo
  const order = {
    id: nextOrderId(),
    date: isoOffset(0),
    items: cart.map(c => c.id),
    start: rentalStart,
    end: rentalEnd,
    delivery,
    ret: returnMethod,
    retAddr: returnMethod === "home" ? returnAddress.trim() : "",
    // Coordenadas del pedido: lo que de verdad usa el reparto. Se guardan con
    // el pedido y no solo en el checkout, que se limpia al terminar.
    shipCoords: delivery === "ship" ? addressCoords : null,
    retCoords: returnMethod === "home" ? returnAddressCoords : null,
    pay: payMethod,
    // Tarjeta: se cobra al confirmar → "settled" (Descontado).
    // Efectivo: se paga al recibir/retirar → "pending" (Cancelado más adelante).
    status: payMethod === "cash" ? "pending" : "settled",
    // Premio aplicado: se guarda la referencia al canje, no su importe. El
    // descuento lo recalcula orderDiscount() (el precio no se almacena).
    // Solo se engancha si de verdad rebaja algo en este pedido: así un canje
    // que quedó sin efecto vuelve a la cartera en vez de consumirse en balde.
    couponId: couponDiscount() > 0 ? appliedCoupon : null,
  };
  order.total = orderTotal(order);   // valor total del cobro del pedido
  // El canje pasa a "usado" y deja de ofrecerse en el siguiente checkout.
  if(order.couponId){
    const c = couponById(order.couponId);
    if(c) c.usedIn = order.id;
  }
  // Puntos que otorga el pedido; se calculan con el carrito aún intacto.
  order.points = orderPoints();
  order.pointsCredited = false;
  orders.push(order);
  // Los puntos se acreditan al ENTREGAR, no al cobrar: si el alquiler empieza
  // hoy, entran ya; si empieza más adelante, quedan reservados hasta que
  // creditDeliveredPoints() los liquide al abrir la app ese día.
  creditDeliveredPoints();
  lastEarnedPoints = order.points;
  // Litros de agua ahorrados con este alquiler (el carrito aún está intacto).
  lastWaterSaved = cartWaterSaved();
  // La confirmación se pinta desde el pedido, no del carrito: lo vaciamos ya
  // para que cerrar la hoja sin pulsar "finalizar" no permita repedir lo mismo.
  lastOrder = order;
  cart = [];
  saveState();
  // renderGrid: las prendas del pedido pasan a estar alquiladas y salen del
  // catálogo ya mismo, sin esperar a que se cierre la confirmación.
  view = "done"; renderSheet(); updateBadge(); renderGrid();
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
      ${o.couponId ? `<div class="coupon-used">${icon("ticket", { size: 16 })} Premio aplicado: <b>−$${orderDiscount(o).toFixed(2)}</b></div>` : ``}
      ${lastWaterSaved > 0 ? `<div class="water-saved">${icon("droplet", { size: 16 })} Ahorraste <b>~${fmtLiters(lastWaterSaved)} litros</b> de agua al reutilizar ropa</div>` : ``}
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
  lastEarnedPoints = 0; lastWaterSaved = 0; lastOrder = null;
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
