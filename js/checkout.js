/* ============================================================
   CLOTH TO GO · checkout.js
   Flujo de alquiler: carrito, entrega/pago y confirmación.
   Incluye el selector de fechas reutilizable y quitar del carrito.
   Depende de data.js, state.js y dom.js.
   ============================================================ */

/* ---- Bloque reutilizable: selector de fechas ---- */
function dateBoxHTML(){
  return `
    <div class="date-box">
      <div class="dl">📅 Período de alquiler</div>
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
      <div class="date-total">${rentalDays()} ${rentalDays()===1?'día':'días'} de alquiler · ${fmtDate(rentalStart)} → ${fmtDate(rentalEnd)}</div>
    </div>`;
}
/* ---- Carrito ---- */
function renderCart(){
  sheetTitle.textContent = "Tu carrito";
  if(cart.length===0){
    sheetBody.innerHTML = `<div class="empty"><div class="em">👕</div><p>Tu carrito está vacío.<br>Agrega prendas para alquilar.</p></div>`;
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
      <div class="summary-row total"><span>Total</span><span>$${(subtotal()+depositTotal()).toFixed(2)}</span></div>
    </div>
    <p class="summary-note">💡 El total incluye un depósito reembolsable de $${depositTotal().toFixed(2)} que se te devuelve al regresar las prendas.${savings > 0 ? ` <b>¡Ahorras $${savings.toFixed(2)} por alquilar varias prendas a la vez!</b>` : ` Mientras más días alquiles, más barato sale cada día; y llevando varias prendas ahorras hasta un ${Math.round(VOLUME_DISCOUNT_MAX*100)}%.`}</p>`;

  sheetFoot.innerHTML = `<button class="pay-btn" data-action="toCheckout">Continuar a entrega →</button>`;
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
        <div class="do-icon">🚚</div>
        <div class="do-text">
          <div class="do-title"><span>Envío a domicilio</span><span style="color:var(--accent)">$${ship.toFixed(2)}</span></div>
          <div class="do-desc">Recíbelo en 24–48 h en tu dirección.</div>
        </div>
        <div class="do-radio"></div>
      </div>
      <div class="delivery-opt ${delivery==='pickup'?'active':''}" data-action="setDelivery" data-value="pickup" role="button" tabindex="0" aria-pressed="${delivery==='pickup'}">
        <div class="do-icon">🏬</div>
        <div class="do-text">
          <div class="do-title"><span>Retiro en local</span><span style="color:var(--ok)">Gratis</span></div>
          <div class="do-desc">Recoge en nuestro único local físico.</div>
        </div>
        <div class="do-radio"></div>
      </div>
    </div>
    ${delivery==='ship' ? `
      <div class="ship-detail">
        📍 Dirección de envío
        <input id="addr" placeholder="Calle, número, ciudad…" value="${escapeHTML(address)}" />
      </div>` : ``}
    ${delivery==='pickup' ? `
      <div class="pickup-detail">
        🏬 <b>${LOCAL.nombre}</b><br>
        ${LOCAL.direccion}<br>
        <span style="color:var(--muted)">${LOCAL.horario}</span>
      </div>` : ``}

    <div class="section-label">¿Cómo deseas devolver la ropa al terminar el alquiler?</div>
    <div class="delivery-opts">
      <div class="delivery-opt ${returnMethod==='store'?'active':''}" data-action="setReturn" data-value="store" role="button" tabindex="0" aria-pressed="${returnMethod==='store'}">
        <div class="do-icon">🏬</div>
        <div class="do-text">
          <div class="do-title"><span>Devolver en el local</span><span style="color:var(--ok)">Gratis</span></div>
          <div class="do-desc">Acércate a nuestro local físico al terminar el alquiler.</div>
        </div>
        <div class="do-radio"></div>
      </div>
      <div class="delivery-opt ${returnMethod==='home'?'active':''}" data-action="setReturn" data-value="home" role="button" tabindex="0" aria-pressed="${returnMethod==='home'}">
        <div class="do-icon">🚚</div>
        <div class="do-text">
          <div class="do-title"><span>Retiro a domicilio</span><span style="color:var(--accent)">$${ship.toFixed(2)}</span></div>
          <div class="do-desc">Pasamos por tu dirección a retirar las prendas.</div>
        </div>
        <div class="do-radio"></div>
      </div>
    </div>
    ${returnMethod==='home' ? `
      <div class="ship-detail">
        📍 Dirección de retiro
        <input id="retAddr" placeholder="Calle, número, ciudad…" value="${escapeHTML(returnAddress)}" />
      </div>` : ``}

    <div class="summary">
      <div class="summary-row"><span>Período</span><span>${rentalDays()} ${rentalDays()===1?'día':'días'} · ${fmtDate(rentalStart)} → ${fmtDate(rentalEnd)}</span></div>
      <div class="summary-row"><span>Subtotal alquiler</span><span>$${subtotal().toFixed(2)}</span></div>
      <div class="summary-row deposit"><span>Depósito <span class="refund-tag">reembolsable</span></span><span>$${depositTotal().toFixed(2)}</span></div>
      <div class="summary-row"><span>Envío</span><span>${delivery==='ship'?'$'+ship.toFixed(2):delivery==='pickup'?'$0.00':'—'}</span></div>
      <div class="summary-row"><span>Devolución</span><span>${returnMethod==='home'?'$'+ship.toFixed(2):returnMethod==='store'?'$0.00':'—'}</span></div>
      <div class="summary-row total"><span>Total a pagar</span><span>$${total.toFixed(2)}</span></div>
    </div>
    <p class="summary-note">💡 Incluye depósito reembolsable de $${depositTotal().toFixed(2)} (se devuelve al regresar las prendas).</p>
  `;

  const valid = checkoutValid();

  let payLabel = 'Continuar al pago →';
  if(!delivery)                                          payLabel = 'Elige cómo recibir tu pedido';
  else if(delivery==='ship' && !isValidAddress(address)) payLabel = 'Ingresa una dirección de envío válida';
  else if(!returnMethod)                                 payLabel = 'Elige cómo devolver la ropa';
  else if(returnMethod==='home' && !isValidAddress(returnAddress)) payLabel = 'Ingresa una dirección de retiro válida';

  sheetFoot.innerHTML = `
    <button class="pay-btn" data-action="toPayment" ${valid?'':'disabled'}>${payLabel}</button>`;
}

// ¿El checkout tiene datos suficientes para pagar?
function checkoutValid(){
  const deliveryOk = delivery && (delivery==="pickup" || (delivery==="ship" && isValidAddress(address)));
  const returnOk = returnMethod && (returnMethod==="store" || (returnMethod==="home" && isValidAddress(returnAddress)));
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
        <div class="do-icon">💵</div>
        <div class="do-text">
          <div class="do-title"><span>Efectivo</span></div>
          <div class="do-desc">Pagas al recibir o retirar tu pedido.</div>
        </div>
        <div class="do-radio"></div>
      </div>
      <div class="delivery-opt ${payMethod==='credit'?'active':''}" data-action="setPay" data-value="credit" role="button" tabindex="0" aria-pressed="${payMethod==='credit'}">
        <div class="do-icon">💳</div>
        <div class="do-text">
          <div class="do-title"><span>Tarjeta de crédito</span></div>
          <div class="do-desc">Visa, Mastercard, etc.</div>
        </div>
        <div class="do-radio"></div>
      </div>
      <div class="delivery-opt ${payMethod==='debit'?'active':''}" data-action="setPay" data-value="debit" role="button" tabindex="0" aria-pressed="${payMethod==='debit'}">
        <div class="do-icon">🏦</div>
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
        <p class="pay-note">🔒 Demo: los datos de la tarjeta no se procesan ni se guardan. La pasarela de pago se integrará con el backend.</p>
      </div>` : ``}

    ${payMethod==='cash' ? `
      <div class="pickup-detail">💵 Pagarás <b>$${total.toFixed(2)}</b> en efectivo al recibir o retirar tu pedido.</div>` : ``}

    <div class="summary">
      <div class="summary-row total"><span>Total a pagar</span><span>$${total.toFixed(2)}</span></div>
    </div>
    <p class="summary-note">💡 Incluye depósito reembolsable de $${depositTotal().toFixed(2)} (se devuelve al regresar las prendas).</p>
  `;

  const valid = paymentValid();
  let label = 'Confirmar pedido';
  if(!payMethod)            label = 'Elige un método de pago';
  else if(isCard && !valid) label = 'Completa los datos de la tarjeta';

  sheetFoot.innerHTML = `<button class="pay-btn" data-action="placeOrder" ${valid?'':'disabled'}>${label}</button>`;
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
    pay: payMethod,
    // Tarjeta: se cobra al confirmar → "settled" (Descontado).
    // Efectivo: se paga al recibir/retirar → "pending" (Cancelado más adelante).
    status: payMethod === "cash" ? "pending" : "settled",
  };
  order.total = orderTotal(order);   // valor total del cobro del pedido
  orders.push(order);
  // Acreditar puntos por el alquiler completado.
  lastEarnedPoints = orderPoints();
  profile.points += lastEarnedPoints;
  // Litros de agua ahorrados con este alquiler (el carrito aún está intacto).
  lastWaterSaved = cartWaterSaved();
  saveState();
  view = "done"; renderSheet(); updateBadge();
  // Felicitación por el ahorro de agua (moda circular / ropa reutilizada).
  showWaterPop(lastWaterSaved, cart.length);
}

/* ---- Confirmación ---- */
function renderDone(){
  sheetTitle.textContent = "¡Listo!";
  const isShip = delivery==="ship";
  const payNames = { cash:"💵 Efectivo", credit:"💳 Tarjeta de crédito", debit:"🏦 Tarjeta de débito" };
  const last4 = card.number.replace(/\s+/g, "").slice(-4);
  const payText = (payNames[payMethod] || "—") + (payMethod!=="cash" && last4 ? ` ····${last4}` : "");
  sheetBody.innerHTML = `
    <div class="confirm">
      <div class="big">🎉</div>
      <h2>Alquiler confirmado</h2>
      <p>Gracias por elegir CLOTH TO GO. Cuida tus prendas y devuélvelas a tiempo 💚</p>
      <div class="box">
        <b>📅 Período:</b> ${fmtDate(rentalStart)} → ${fmtDate(rentalEnd)} (${rentalDays()} ${rentalDays()===1?'día':'días'})<br>
        <hr style="border:none;border-top:1px dashed var(--line);margin:10px 0">
        ${isShip
          ? `<b>🚚 Envío a domicilio</b><br>${escapeHTML(address)}<br><span style="color:var(--muted)">Llega en 24–48 h.</span>`
          : `<b>🏬 Retiro en local</b><br>${LOCAL.nombre}<br>${LOCAL.direccion}<br><span style="color:var(--muted)">${LOCAL.horario}</span>`}
        <hr style="border:none;border-top:1px dashed var(--line);margin:10px 0">
        ${returnMethod==='home'
          ? `<b>🚚 Devolución: retiro a domicilio</b><br>${escapeHTML(returnAddress)}<br><span style="color:var(--muted)">Coordinaremos el retiro al terminar el alquiler.</span>`
          : `<b>🏬 Devolución en local</b><br>${LOCAL.nombre}<br>${LOCAL.direccion}<br><span style="color:var(--muted)">${LOCAL.horario}</span>`}
        <hr style="border:none;border-top:1px dashed var(--line);margin:10px 0">
        <b>Pago:</b> ${payText}
        <hr style="border:none;border-top:1px dashed var(--line);margin:10px 0">
        ${cart.map(c=>{const p=productById(c.id);return `· ${escapeHTML(p.name)} — $${cartItemPrice(p).toFixed(2)}`;}).join("<br>")}
        <hr style="border:none;border-top:1px dashed var(--line);margin:10px 0">
        <span style="color:var(--muted)">Depósito reembolsable: $${depositTotal().toFixed(2)} (se devuelve al regresar las prendas)</span>
      </div>
      <div class="earned-points">🌱 Ganaste <b>${lastEarnedPoints}</b> puntos con este alquiler</div>
      ${lastWaterSaved > 0 ? `<div class="water-saved">💧 Ahorraste <b>~${fmtLiters(lastWaterSaved)} litros</b> de agua al reutilizar ropa</div>` : ``}
    </div>`;
  sheetFoot.innerHTML = `<button class="pay-btn" data-action="finish">Volver al catálogo</button>`;
}

// Cierra el flujo: limpia carrito/entrega y vuelve al catálogo.
function finishOrder(){
  cart = []; delivery = null; address = ""; returnMethod = null; returnAddress = "";
  payMethod = null; card = { number:"", name:"", expiry:"", cvv:"" };
  lastEarnedPoints = 0; lastWaterSaved = 0;
  view = "cart";
  saveState();
  updateBadge(); renderGrid(); closeSheet();
}
