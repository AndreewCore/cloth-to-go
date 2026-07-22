/* ============================================================
   CLOTH TO GO · profile.js
   Vista de perfil: datos de contacto editables (con validación),
   puntos (placeholder) y prendas en alquiler (con edición de
   devolución e indicadores de vencimiento/penalización).
   Depende de data.js (LATE_*, SHIPPING_FEE, helpers), state.js y dom.js.
   ============================================================ */

function renderProfile(){
  sheetTitle.textContent = "Mi perfil";
  const esc = escapeHTML;   // escape anti-XSS (contenido y atributos)
  const initial = escapeHTML(profile.name.trim().charAt(0) || "?").toUpperCase();
  const payNames = { cash:"💵 Efectivo", credit:"💳 Crédito", debit:"🏦 Débito" };

  const ordersWithIdx   = orders.map((o, i) => ({ o, i }));
  const activeOrders    = ordersWithIdx.filter(({ o }) => !isArchivedOrder(o));
  const archivedOrders  = ordersWithIdx.filter(({ o }) =>  isArchivedOrder(o));

  const orderCardHTML = ({ o, i }, archived) => {
    const days = daysBetween(o.start, o.end);
    const late = !archived && isLate(o);
    const retLabel = o.ret === "home" ? "🚚 Devolución a domicilio" : "🏬 Devolución en local";
    const stClass  = o.status === "settled" ? "settled" : "pending";
    return `
    <div class="order${late ? " late" : ""}${archived ? " archived" : ""}">
      <div class="order-head">
        <div class="order-head-main">
          <div class="order-id">Pedido #${o.id}</div>
          <div class="order-date">${fmtDate(o.date)} · ${payNames[o.pay] || "—"}</div>
        </div>
        <div class="order-badges">
          <span class="pay-status ${stClass}">${paymentStatusLabel(o)}</span>
          ${!archived ? `<span class="rent-tag${late ? " late" : ""}">${late ? "⚠ Vencida" : "En alquiler"}</span>` : ""}
        </div>
      </div>

      ${o.items.map(id => { const p = productById(id); return `
        <div class="order-item">
          <div class="ci-thumb">${imgPlaceholder(p)}</div>
          <div class="oi-info">
            <div class="oi-name">${escapeHTML(p.name)}</div>
            <div class="oi-meta">Talla ${escapeHTML(p.size)} · $${p.price}/día</div>
          </div>
        </div>`; }).join("")}

      <div class="order-period">📅 ${fmtDate(o.start)} → ${fmtDate(o.end)} · ${days} ${days === 1 ? "día" : "días"}</div>

      <div class="order-charge">
        <span>${archived ? "Total cobrado" : "Total del cobro"}</span>
        <b>$${o.total.toFixed(2)}</b>
      </div>

      <div class="ci-ret">${retLabel}${o.ret === "home" && o.retAddr ? ` · <span class="ret-addr">📍 ${escapeHTML(o.retAddr)}</span>` : ""}</div>
      ${!archived ? `
        <button class="ret-edit" data-action="editReturn" data-idx="${i}">✏️ Cambiar modo de devolución</button>
        ${editingOrder === i ? returnEditorHTML(i) : ""}
        ${late ? `
          <button class="late-info-btn" data-action="toggleLateInfo" data-idx="${i}">ⓘ Penalización por atraso</button>
          <div class="late-info" id="lateInfo${i}">
            Fecha límite vencida (${fmtDate(o.end)}). Si no devuelves dentro de
            <b>${LATE_GRACE_DAYS} días hábiles</b> tras esa fecha, se cobrará una penalización de
            <b>$${LATE_PENALTY.toFixed(2)}</b> y podría retenerse tu depósito ($${orderDeposit(o).toFixed(2)}).
          </div>` : ""}
      ` : ""}
    </div>`;
  };

  sheetBody.innerHTML = `
    <div class="profile-head">
      <div class="avatar">${initial}</div>
      <div class="ph-info">
        <div class="profile-name">${escapeHTML(profile.name) || "Sin nombre"}</div>
        <div class="profile-email">${escapeHTML(profile.email) || "—"}</div>
      </div>
    </div>

    <button class="points-card" data-action="openRewards" aria-label="Ver premios y canjear puntos">
      <div>
        <div class="pc-label">Puntos acumulados</div>
        <div class="pc-value">${profile.points} <span>pts</span></div>
      </div>
      <span class="pc-cta">Canjear →</span>
    </button>

    <div class="water-stat" aria-label="Agua ahorrada">
      <span class="ws-icon">💧</span>
      <div class="ws-text">
        <div class="ws-label">Agua ahorrada reutilizando ropa</div>
        <div class="ws-value">~${fmtLiters(totalWaterSaved())} <span>litros</span></div>
      </div>
    </div>

    <button class="donate-card" data-action="openDonate" aria-label="Donar ropa por puntos">
      <span class="dc-icon">♻️</span>
      <div class="dc-text">
        <div class="dc-title">Dona ropa y gana puntos</div>
        <div class="dc-desc">Entrega prendas que no uses. Los puntos se asignan al recibirlas.</div>
      </div>
      <span class="dc-cta">→</span>
    </button>

    <div class="section-label">Información de contacto</div>
    ${editingProfile ? `
    <div class="profile-form">
      <label class="pf-fld">Nombre
        <input id="pfName" value="${esc(profile.name)}" placeholder="Tu nombre" />
      </label>
      <small class="pf-error" id="errName" style="display:none"></small>
      <label class="pf-fld">Correo
        <input id="pfEmail" type="email" value="${esc(profile.email)}" placeholder="tucorreo@ejemplo.com" />
      </label>
      <small class="pf-error" id="errEmail" style="display:none"></small>
      <label class="pf-fld">Celular
        <input id="pfPhone" type="tel" inputmode="numeric" value="${esc(profile.phone)}" placeholder="09xxxxxxxx" />
      </label>
      <small class="pf-error" id="errPhone" style="display:none"></small>
      <div class="pf-actions">
        <button class="ret-cancel" data-action="cancelProfileEdit">Cancelar</button>
        <button class="save-btn" data-action="saveProfile">Guardar cambios</button>
      </div>
    </div>
    ` : `
    <div class="profile-info">
      <div class="pi-row"><span class="pi-k">Nombre</span><span class="pi-v">${escapeHTML(profile.name) || "—"}</span></div>
      <div class="pi-row"><span class="pi-k">Correo</span><span class="pi-v">${escapeHTML(profile.email) || "—"}</span></div>
      <div class="pi-row"><span class="pi-k">Celular</span><span class="pi-v">${escapeHTML(profile.phone) || "—"}</span></div>
      <button class="edit-info-btn" data-action="editProfile">✏️ Modificar información</button>
    </div>
    `}

    <div class="section-label">Mis pedidos</div>
    ${activeOrders.length
      ? activeOrders.map(pair => orderCardHTML(pair, false)).join("")
      : `<div class="empty" style="padding:30px 20px"><div class="em">👕</div><p>No tienes pedidos activos.<br>Alquila algo del catálogo.</p></div>`}

    ${archivedOrders.length ? `
    <details class="past-orders-section">
      <summary class="past-orders-toggle">
        <span>Alquileres anteriores</span>
        <span class="past-count">${archivedOrders.length}</span>
      </summary>
      <div class="past-orders-body">
        ${archivedOrders.map(pair => orderCardHTML(pair, true)).join("")}
      </div>
    </details>
    ` : ""}
  `;
  sheetFoot.innerHTML = "";
}

/* ---- Acciones del perfil (invocadas por la delegación en main.js) ---- */

// Guardar contacto con validación de correo y celular.
function saveProfile(){
  const nameV  = document.getElementById("pfName").value.trim();
  const emailV = document.getElementById("pfEmail").value.trim();
  const phoneV = document.getElementById("pfPhone").value.trim();
  const nameOk  = isValidName(nameV);
  const emailOk = isValidEmail(emailV);
  const phoneOk = isValidPhone(phoneV);
  const setErr = (id,msg)=>{ const e=document.getElementById(id); e.textContent=msg; e.style.display=msg?"block":"none"; };
  setErr("errName",  nameOk  ? "" : "Ingresa tu nombre (mínimo 2 caracteres).");
  setErr("errEmail", emailOk ? "" : "Ingresa un correo válido (ej: nombre@dominio.com).");
  setErr("errPhone", phoneOk ? "" : "Ingresa solo números (7 a 15 dígitos).");
  if(!nameOk || !emailOk || !phoneOk){ toast("Revisa los datos de contacto"); return; }
  profile.name = nameV; profile.email = emailV; profile.phone = phoneV;
  editingProfile = false;
  saveState();
  if(profile.name) greeting.textContent = `Hola, ${profile.name} 🌱`;
  renderProfile();
  toast("Perfil actualizado ✓");
}

// Entrar / salir del modo edición de la información de contacto.
function editProfile(){ editingProfile = true; renderProfile(); }
function cancelProfileEdit(){ editingProfile = false; renderProfile(); }

/* ---- Editor in-line del modo de devolución ----
   Permite elegir entre devolver en el local o a domicilio (con cargo
   adicional). Si es a domicilio, pide la dirección de retiro. */
function returnEditorHTML(i){
  return `
    <div class="ret-editor">
      <div class="ret-editor-title">Al finalizar el alquiler, ¿cómo quieres devolver la prenda?</div>
      <button type="button" class="ret-opt ${editRet==='store'?'active':''}" data-action="pickReturn" data-value="store" aria-pressed="${editRet==='store'}">
        <span class="ro-head"><span>🏬 Devolución en el local</span><span class="ro-tag free">Gratis</span></span>
        <small class="ro-desc">Te acercas a nuestro local físico a dejar la prenda.</small>
      </button>
      <button type="button" class="ret-opt ${editRet==='home'?'active':''}" data-action="pickReturn" data-value="home" aria-pressed="${editRet==='home'}">
        <span class="ro-head"><span>🚚 Devolución a domicilio</span><span class="ro-tag fee">+$${SHIPPING_FEE.toFixed(2)}</span></span>
        <small class="ro-desc">Vamos a la dirección que indiques a retirar la prenda (cargo adicional).</small>
      </button>
      ${editRet==='home' ? `
        <input class="ret-addr-input" id="editRetAddr" placeholder="Dirección de retiro…" value="${escapeHTML(editRetAddr)}" aria-label="Dirección de retiro" />` : ``}
      <div class="ret-editor-actions">
        <button type="button" class="ret-cancel" data-action="cancelReturn">Cancelar</button>
        <button type="button" class="ret-save" data-action="saveReturn" data-idx="${i}">Guardar</button>
      </div>
    </div>`;
}

function openReturnEditor(i){
  editingOrder = i;
  editRet = orders[i].ret;
  editRetAddr = orders[i].retAddr || "";
  renderProfile();
}
function closeReturnEditor(){
  editingOrder = null; editRet = null; editRetAddr = "";
  renderProfile();
}
function saveReturn(i){
  if(editRet === "home" && !isValidAddress(editRetAddr)){
    toast("Ingresa una dirección de retiro válida");
    return;
  }
  const o = orders[i];
  const apply = ()=>{
    o.ret = editRet;
    o.retAddr = editRet === "home" ? editRetAddr.trim() : "";
    o.total = orderTotal(o);   // el cambio de devolución actualiza el total del cobro
    saveState();
    closeReturnEditor();
    toast("Modo de devolución actualizado ✓");
  };
  // Si cambia el método, confirmar el cargo/descuento (mostrando el nuevo total);
  // si solo cambia la dirección, aplicar directo.
  if(o.ret !== editRet){
    const newTotal = orderTotal({ ...o, ret: editRet }).toFixed(2);
    const msg = editRet === "home"
      ? `Cambiarás a Devolución a domicilio.\n\nSe COBRARÁ un adicional de $${SHIPPING_FEE.toFixed(2)} por ir a retirar la prenda. El total del cobro del pedido pasará a $${newTotal}.\n\n¿Confirmar?`
      : `Cambiarás a Devolución en el local.\n\nSe te DESCONTARÁ $${SHIPPING_FEE.toFixed(2)} (ya no haremos el retiro a domicilio). El total del cobro del pedido pasará a $${newTotal}.\n\n¿Confirmar?`;
    confirmDialog(msg, apply);
  } else {
    apply();
  }
}

// Mostrar/ocultar la nota de penalización de una prenda vencida.
function toggleLateInfo(i){
  document.getElementById("lateInfo"+i).classList.toggle("show");
}

/* ---- Premios / canje de puntos ---- */
function renderRewards(){
  sheetTitle.textContent = "Premios";
  sheetBody.innerHTML = `
    <div class="points-card big">
      <div>
        <div class="pc-label">Tus puntos</div>
        <div class="pc-value">${profile.points} <span>pts</span></div>
      </div>
      <span class="pc-emoji">🎁</span>
    </div>

    <div class="section-label">Canjea tus puntos</div>
    ${REWARDS.map(rw => {
      const can = profile.points >= rw.cost;
      return `
      <div class="reward ${can ? "" : "locked"}">
        <div class="rw-icon">${rw.icon}</div>
        <div class="rw-info">
          <div class="rw-name">${rw.name}</div>
          <div class="rw-desc">${rw.desc}</div>
          <div class="rw-cost">${rw.cost} pts</div>
        </div>
        <button class="rw-btn" data-action="redeem" data-id="${rw.id}" ${can ? "" : "disabled"}>
          ${can ? "Canjear" : `Faltan ${rw.cost - profile.points}`}
        </button>
      </div>`;
    }).join("")}

    ${profile.redeemed.length ? `
      <div class="section-label">Tus canjes</div>
      ${profile.redeemed.map(c => `
        <div class="redeemed-item">✅ ${escapeHTML(c.name)} <span>${c.date} · ${c.cost} pts</span></div>`).join("")}
    ` : ""}

    <p class="summary-note">Ganas puntos con cada alquiler completado (según el monto, los días y la cantidad de prendas).</p>
  `;
  sheetFoot.innerHTML = "";
}

function redeem(id){
  const rw = REWARDS.find(r => r.id === id);
  if(!rw || profile.points < rw.cost) return;
  confirmDialog(`Canjear "${rw.name}" por ${rw.cost} puntos.\n\nTe quedarán ${profile.points - rw.cost} pts.\n\n¿Confirmar?`, ()=>{
    profile.points -= rw.cost;
    profile.redeemed.unshift({ name: rw.name, cost: rw.cost, date: fmtDate(isoOffset(0)) });
    saveState();
    renderRewards();
    toast("🎉 ¡Premio canjeado!");
  });
}

/* ---- Donar ropa por puntos (flujo indirecto) ----
   El usuario describe la prenda y elige cómo entregarla (local o cita de
   retiro a domicilio, ambos sin costo). Los puntos NO se otorgan aquí: se
   determinan al recibir y evaluar la prenda (queda "En revisión"). */
function openDonate(){
  donName = ""; donMethod = null; donAddr = ""; donDate = "";
  view = "donate"; renderSheet();
}

function donateValid(){
  if(donName.trim().length < 3 || !donMethod) return false;
  if(donMethod === "home") return isValidAddress(donAddr) && !!donDate;
  return true;   // entrega en local
}

function renderDonate(){
  sheetTitle.textContent = "Donar ropa";
  sheetBody.innerHTML = `
    <p class="donate-intro">♻️ Dona prendas que ya no uses y gana puntos. <b>La cantidad de puntos se determina al recibir y evaluar la prenda.</b></p>
    <ul class="donate-rules">
      <li>✅ La donación es <b>gratis a partir de 3 prendas diferentes</b>.</li>
      <li>🚫 No se aceptan <b>prendas interiores</b>.</li>
    </ul>

    <div class="section-label">¿Qué prendas quieres donar?</div>
    <input class="donate-input" id="donName" placeholder="Ej: Abrigo de lana, jeans y camisa (mín. 3 prendas)" value="${escapeHTML(donName)}" aria-label="Prendas a donar" />

    <div class="section-label">¿Cómo nos las entregas?</div>
    <div class="delivery-opts">
      <div class="delivery-opt ${donMethod==='store'?'active':''}" data-action="setDonateMethod" data-value="store" role="button" tabindex="0" aria-pressed="${donMethod==='store'}">
        <div class="do-icon">🏬</div>
        <div class="do-text">
          <div class="do-title"><span>Donar en el local</span><span style="color:var(--ok)">Gratis</span></div>
          <div class="do-desc">Acércate a nuestro local físico a dejar la prenda.</div>
        </div>
        <div class="do-radio"></div>
      </div>
      <div class="delivery-opt ${donMethod==='home'?'active':''}" data-action="setDonateMethod" data-value="home" role="button" tabindex="0" aria-pressed="${donMethod==='home'}">
        <div class="do-icon">🚚</div>
        <div class="do-text">
          <div class="do-title"><span>Solicitar retiro a domicilio</span><span style="color:var(--ok)">Gratis</span></div>
          <div class="do-desc">Agenda una cita y vamos a tu dirección a retirarla.</div>
        </div>
        <div class="do-radio"></div>
      </div>
    </div>

    ${donMethod==='store' ? `
      <div class="pickup-detail">🏬 <b>${LOCAL.nombre}</b><br>${LOCAL.direccion}<br><span style="color:var(--muted)">${LOCAL.horario}</span></div>` : ``}

    ${donMethod==='home' ? `
      <div class="ship-detail">
        📍 Dirección de retiro
        <input id="donAddr" placeholder="Calle, número, ciudad…" value="${escapeHTML(donAddr)}" />
        <label class="don-date-label">📅 Fecha de la cita
          <input type="date" id="donDate" min="${isoOffset(0)}" value="${donDate}" />
        </label>
      </div>` : ``}

    ${profile.donations.length ? `
      <div class="section-label">Mis donaciones</div>
      ${profile.donations.map(don => `
        <div class="donation-item">
          <div class="di-info">
            <div class="di-name">${escapeHTML(don.item)}</div>
            <div class="di-meta">${don.method==='home'
              ? `🚚 Retiro a domicilio · ${escapeHTML(don.addr)}${don.date ? ` · cita ${fmtDate(don.date)}` : ''}`
              : '🏬 Entrega en el local'}</div>
            <div class="di-points">Puntos: por determinar al recibir la prenda</div>
          </div>
          <span class="di-status">⏳ ${escapeHTML(don.status)}</span>
        </div>`).join("")}` : ``}
  `;

  const valid = donateValid();
  let label = "Enviar solicitud de donación";
  if(donName.trim().length < 3)                            label = "Describe la prenda a donar";
  else if(!donMethod)                                      label = "Elige cómo entregarla";
  else if(donMethod==='home' && !isValidAddress(donAddr))  label = "Ingresa la dirección de retiro";
  else if(donMethod==='home' && !donDate)                  label = "Elige la fecha de la cita";
  sheetFoot.innerHTML = `<button class="pay-btn" data-action="submitDonation" ${valid?'':'disabled'}>${label}</button>`;
}

function submitDonation(){
  if(!donateValid()) return;
  profile.donations.unshift({
    item: donName.trim(),
    method: donMethod,
    addr: donMethod === "home" ? donAddr.trim() : "",
    date: donMethod === "home" ? donDate : "",
    status: "En revisión",
    points: null
  });
  saveState();
  donName = ""; donMethod = null; donAddr = ""; donDate = "";
  renderDonate();
  toast("Solicitud de donación enviada ✓");
}
