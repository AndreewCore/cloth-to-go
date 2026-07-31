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
  const payNames = {
    cash:   `${icon("cash", { size: 14 })} Efectivo`,
    credit: `${icon("card", { size: 14 })} Crédito`,
    debit:  `${icon("bank", { size: 14 })} Débito`
  };

  // Distingue la cuenta de Google (identidad real) del invitado (demo efímera).
  const isUser = !!currentUser;
  // Avatar: foto de Google si la hay; si no, la inicial en círculo de color.
  // referrerpolicy=no-referrer: las fotos de Google fallan si se manda referer.
  const avatarInner = profile.picture
    ? `<img class="avatar-img" src="${esc(profile.picture)}" alt="" referrerpolicy="no-referrer" />`
    : initial;
  const sessionBadge = isUser
    ? `<span class="session-badge user">${icon("check", { size: 13 })} Cuenta de Google</span>`
    : `<span class="session-badge guest">Invitado · nada se guarda</span>`;
  const logoutLabel = isUser ? "Cerrar sesión" : "Salir de invitado";

  const ordersWithIdx   = orders.map((o, i) => ({ o, i }));
  const activeOrders    = ordersWithIdx.filter(({ o }) => !isPastOrder(o));
  const archivedOrders  = ordersWithIdx.filter(({ o }) =>  isPastOrder(o));

  const orderCardHTML = ({ o, i }, archived) => {
    const days = daysBetween(o.start, o.end);
    const voided = isCancelledOrder(o);
    // Un pedido anulado nunca está "vencido": no hay prenda que devolver.
    const late = !archived && !voided && isLate(o);
    const retLabel = o.ret === "home"
      ? `${icon("truck", { size: 15 })} Devolución a domicilio`
      : `${icon("store", { size: 15 })} Devolución en local`;
    const stClass  = voided ? "cancelled" : (o.status === "settled" ? "settled" : "pending");
    return `
    <div class="order${late ? " late" : ""}${archived ? " archived" : ""}${voided ? " cancelled" : ""}">
      <div class="order-head">
        <div class="order-head-main">
          <div class="order-id">Pedido #${o.id}</div>
          <div class="order-date">${fmtDate(o.date)} · ${payNames[o.pay] || "—"}</div>
        </div>
        <div class="order-badges">
          <span class="pay-status ${stClass}">${paymentStatusLabel(o)}</span>
          ${!archived ? `<span class="rent-tag${late ? " late" : ""}">${late ? `${icon("alert", { size: 13 })} Vencida` : "En alquiler"}</span>` : ""}
          ${voided ? `<span class="rent-tag void">Sin efecto</span>` : ""}
        </div>
      </div>

      ${o.items.map(id => { const p = productById(id); return `
        <div class="order-item">
          <div class="ci-thumb" data-action="openDetail" data-id="${p.id}"
               role="button" tabindex="0" aria-label="Ver detalle de ${escapeHTML(p.name)}">${imgPlaceholder(p)}</div>
          <div class="oi-info">
            <div class="oi-name">${escapeHTML(p.name)}</div>
            <div class="oi-meta">Talla ${escapeHTML(p.size)} · $${rentalPrice(p, days, o.items.length).toFixed(2)}</div>
          </div>
        </div>`; }).join("")}

      <div class="order-period">${icon("calendar", { size: 14 })} ${fmtDate(o.start)} → ${fmtDate(o.end)} · ${days} ${days === 1 ? "día" : "días"}</div>

      <div class="order-charge">
        <span>${voided ? "Cobro anulado" : (archived ? "Total cobrado" : "Total del cobro")}</span>
        <span class="total-vals">
          ${!voided && orderDeposit(o) > 0 ? `<span class="refund-inline">${icon("undo", { size: 13 })} $${orderDeposit(o).toFixed(2)} ${archived ? "devuelto" : "se te devuelve"}</span>` : ""}
          <b>$${o.total.toFixed(2)}</b>
        </span>
      </div>

      ${voided
        ? `<div class="ci-ret">${icon("x", { size: 14 })} Anulado el ${fmtDate(o.cancelledAt)} · las prendas volvieron al catálogo</div>`
        : `<div class="ci-ret">${retLabel}${o.ret === "home" && o.retAddr ? ` · <span class="ret-addr">${icon("mapPin", { size: 13 })} ${escapeHTML(o.retAddr)}</span>` : ""}</div>`}
      ${!archived ? `
        ${!o.pointsCredited ? `
          <div class="points-pending">${icon("sprout", { size: 14 })} Ganarás ${o.points} pts cuando recibas tus prendas</div>` : ""}
        <div class="water-pending">${icon("droplet", { size: 14 })} ${o.pointsCredited ? "Ahorraste" : "Ahorrarás"}
          <b>${fmtLiters(waterSavedForItems(o.items))} L</b> de agua${o.pointsCredited ? "" : ", que sumarán a tus metas"}</div>
        <button class="ret-edit" data-action="editReturn" data-idx="${i}">${icon("pencil", { size: 14 })} Cambiar modo de devolución</button>
        ${editingOrder === i ? returnEditorHTML(i) : ""}
        ${canCancelOrder(o) ? `
          <button class="order-cancel" data-action="cancelOrder" data-idx="${i}">${icon("trash", { size: 14 })} Anular pedido</button>` : ""}
        ${late ? `
          <button class="late-info-btn" data-action="toggleLateInfo" data-idx="${i}">ⓘ Penalización por atraso</button>
          <div class="late-info" id="lateInfo${i}">
            Fecha límite vencida (${fmtDate(o.end)}). Si no devuelves dentro de
            <b>${LATE_GRACE_DAYS} días hábiles</b> tras esa fecha, se cobrará una penalización de
            <b>$${LATE_PENALTY.toFixed(2)}</b> y podría retenerse tu depósito ($${orderDeposit(o).toFixed(2)}).
          </div>` : ""}
      ` : ""}
      ${/* Fuera del bloque !archived: un pedido TERMINADO es justo cuando se
            quiere reseñar. Dentro, el botón no habría aparecido nunca donde
            más sentido tiene. */""}
      ${hasPendingReview(o) ? `
        <button class="rev-add-btn" data-action="openReview" data-order="${o.id}">${icon("pencil", { size: 14 })} Agregar reseña</button>` : ""}
    </div>`;
  };

  sheetBody.innerHTML = `
    <div class="profile-head">
      <div class="avatar${profile.picture ? " has-img" : ""}">${avatarInner}</div>
      <div class="ph-info">
        <div class="profile-name">${escapeHTML(profile.name) || "Sin nombre"}</div>
        ${isUser ? `<div class="profile-email">${escapeHTML(profile.email) || "—"}</div>` : ""}
        ${sessionBadge}
      </div>
      <button class="logout-btn" data-action="signOut" aria-label="${logoutLabel}" title="${logoutLabel}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
      </button>
    </div>

    <button class="points-card" data-action="openRewards" aria-label="Ver premios y canjear puntos">
      <div>
        <div class="pc-label">Puntos acumulados</div>
        <div class="pc-value">${profile.points} <span>pts</span></div>
      </div>
      <span class="pc-cta">Canjear ${icon("arrowRight", { size: 15 })}</span>
    </button>

    ${waterGoalHTML()}

    <div class="section-label">Acciones</div>

    <button class="donate-card" data-action="openDonate" aria-label="Donar ropa por puntos">
      <span class="dc-icon">${icon("recycle", { size: 24 })}</span>
      <div class="dc-text">
        <div class="dc-title">Dona ropa y gana puntos</div>
        <div class="dc-desc">Entrega prendas que no uses. Los puntos se asignan al recibirlas.</div>
      </div>
      <span class="dc-cta">${icon("arrowRight", { size: 16 })}</span>
    </button>

    <button class="donate-card wardrobe-card" data-action="openWardrobe" aria-label="Poner tu armario en alquiler (próximamente)">
      <span class="dc-icon">${icon("wardrobe", { size: 24 })}</span>
      <div class="dc-text">
        <div class="dc-title">Pon tu armario en alquiler <span class="soon-tag">Próximamente</span></div>
        <div class="dc-desc">Gana dinero alquilando la ropa que no usas a otros usuarios.</div>
      </div>
      <span class="dc-cta">${icon("arrowRight", { size: 16 })}</span>
    </button>

    <div class="section-label" id="misPedidos">Mis pedidos</div>
    ${activeOrders.length
      ? activeOrders.map(pair => orderCardHTML(pair, false)).join("")
      : `<div class="empty" style="padding:30px 20px"><div class="em">${icon("shirt", { size: 34 })}</div><p>No tienes pedidos activos.<br>Alquila algo del catálogo.</p></div>`}

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
      <button class="edit-info-btn" data-action="editProfile">${icon("pencil", { size: 15 })} Modificar información</button>
    </div>
    `}
  `;
  sheetFoot.innerHTML = "";
}

/* ---- Indicador de ahorro de agua ----
   Antes era una tarjeta con un número suelto: parecía pulsable sin serlo, y el
   número no decía si estaba bien o mal. Ahora es UNA barra con todas las metas
   como marcadores pulsables: el detalle de cada meta (nombre, litros, puntos)
   solo aparece al tocar su marcador, para no saturar la tarjeta. Los puntos
   los acredita creditWaterGoals() (state.js), no esta vista. */

// Meta cuyo detalle está desplegado (id), o null. Estado efímero de la vista:
// no se persiste ni sobrevive a la sesión.
let selectedWaterGoalId = null;

/** Muestra/oculta el detalle de una meta al tocar su marcador. */
function toggleWaterGoalInfo(id){
  selectedWaterGoalId = selectedWaterGoalId === id ? null : id;
  renderSheet();
}

/** Barra de progreso única con marcadores de meta pulsables. */
function waterGoalHTML(){
  const litros = totalWaterSaved();
  const meta = nextWaterGoal();
  const logradas = reachedWaterGoals();
  const n = WATER_GOALS.length;
  /* La barra reparte las metas en tramos IGUALES (no proporcionales a litros):
     con escala lineal la primera meta caería en el 5% y los marcadores se
     amontonarían al inicio. El avance dentro del tramo lo da
     waterGoalProgress(), que ya mide desde la meta anterior. */
  const pct = meta
    ? Math.round(((logradas.length + waterGoalProgress()) / n) * 100)
    : 100;

  const marks = WATER_GOALS.map((g, i) => {
    const hecha = logradas.some(x => x.id === g.id);
    const activa = selectedWaterGoalId === g.id;
    const left = ((i + 1) / n) * 100;
    return `<button type="button" class="wg-mark${hecha ? " done" : ""}${activa ? " active" : ""}"
      style="left:${left}%" data-action="waterGoalInfo" data-id="${g.id}"
      aria-expanded="${activa}"
      aria-label="Meta ${escapeHTML(g.name)}: ${fmtLiters(g.liters)} litros, ${g.points} puntos${hecha ? ", conseguida" : ""}">
      ${hecha ? icon("check", { size: 9 }) : ""}
    </button>`;
  }).join("");

  const sel = WATER_GOALS.find(g => g.id === selectedWaterGoalId);
  let info = "";
  if(sel){
    const hecha = logradas.some(x => x.id === sel.id);
    const estado = hecha
      ? `Conseguida · <b>+${sel.points} pts</b> acreditados`
      : `Te faltan <b>${fmtLiters(sel.liters - litros)} L</b> · premia <b>+${sel.points} pts</b>`;
    info = `<div class="wg-goal-info${hecha ? " done" : ""}">
      <span class="wgi-ico">${icon(hecha ? "award" : "droplet", { size: 14 })}</span>
      <span><b>${escapeHTML(sel.name)}</b> · ${fmtLiters(sel.liters)} L<br>${estado}</span>
    </div>`;
  }

  return `
    <div class="water-goal" aria-label="Agua ahorrada y metas">
      <div class="wg-head">
        <span class="wg-icon">${icon("droplet", { size: 22 })}</span>
        <div class="wg-titles">
          <div class="wg-label">Agua ahorrada reutilizando ropa</div>
          <div class="wg-value">~${fmtLiters(litros)} <span>litros</span></div>
        </div>
        <span class="wg-next">${fmtLiters(WATER_GOALS[n - 1].liters)} L</span>
      </div>
      <div class="wg-track">
        <div class="wg-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"
             aria-label="Progreso de ahorro de agua sobre todas las metas">
          <span class="wg-fill" style="width:${pct}%"></span>
        </div>
        ${marks}
      </div>
      ${info}
    </div>`;
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
  if(profile.name) greeting.textContent = `Hola, ${profile.name}`;
  renderProfile();
  toast("Perfil actualizado");
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
        <span class="ro-head"><span>${icon("store", { size: 15 })} Devolución en el local</span><span class="ro-tag free">Gratis</span></span>
        <small class="ro-desc">Te acercas a nuestro local físico a dejar la prenda.</small>
      </button>
      <button type="button" class="ret-opt ${editRet==='home'?'active':''}" data-action="pickReturn" data-value="home" aria-pressed="${editRet==='home'}">
        <span class="ro-head"><span>${icon("truck", { size: 15 })} Devolución a domicilio</span><span class="ro-tag fee">+$${SHIPPING_FEE.toFixed(2)}</span></span>
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
    toast("Modo de devolución actualizado");
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

/**
 * Anula un pedido que aún no llegó a manos del cliente y devuelve sus prendas
 * al catálogo (el stock se deriva de `orders`, así que basta con marcarlo).
 * @param {number} i Índice del pedido en `orders`.
 */
function cancelOrder(i){
  const o = orders[i];
  // Revalidamos aquí y no solo al pintar: entre el render y el clic pudo cruzarse
  // la medianoche (la fecha de inicio se compara contra el día local).
  if(!o || !canCancelOrder(o)){
    toast("Este pedido ya no se puede anular");
    renderProfile();
    return;
  }

  const days = daysBetween(o.start, o.end);
  const prendas = o.items.map(id => productById(id));
  const items = prendas.map(p => escapeHTML(p.name)).join(" · ");
  // Miniaturas de lo que se anula: reconocer la prenda de un vistazo evita
  // anular el pedido equivocado cuando hay varios abiertos.
  const thumbsHTML = `<div class="md-thumbs">${prendas.map(p => `
    <div class="ci-thumb">${imgPlaceholder(p)}</div>`).join("")}</div>`;
  // El reembolso se muestra SIEMPRE, también cuando es $0: que la cifra falte
  // deja al cliente preguntándose si perdió el dinero.
  const cobrado = o.status === "settled";
  const refundHTML = `
    <div class="md-refund${cobrado ? "" : " zero"}">
      <span>${cobrado
        ? (o.pay === "cash"
          ? `${icon("cash", { size: 15 })} Se te devolverá en el local`
          : `${icon("card", { size: 15 })} Reembolso a tu tarjeta`)
        : `${icon("cash", { size: 15 })} No se te ha cobrado nada`}</span>
      <b>$${(cobrado ? o.total : 0).toFixed(2)}</b>
    </div>`;

  confirmDialog(
    "",
    ()=>{
      o.status = "cancelled";
      o.cancelledAt = isoOffset(0);
      // Los puntos solo se revierten si llegaron a acreditarse; los de un pedido
      // pendiente nunca entraron al saldo, así que no hay nada que restar.
      const revocados = revokeOrderPoints(o);
      // El premio vuelve a la cartera: el alquiler no llegó a existir, así que
      // los puntos que costó no pueden quedarse gastados.
      if(o.couponId){
        const c = couponById(o.couponId);
        if(c) c.usedIn = null;
        o.couponId = null;
      }
      // El editor de devolución guarda un índice: dejarlo abierto sobre un
      // pedido que ya no se muestra como activo lo dejaría huérfano.
      editingOrder = null; editRet = null; editRetAddr = "";
      saveState();
      renderProfile();
      renderGrid();             // las prendas reaparecen en el catálogo al instante
      // Perder un premio en silencio sería peor que el propio cobro: si la
      // reversión tuvo que revocar canjes, se dice cuántos y por qué.
      toast(revocados
        ? `Pedido anulado · ${revocados} ${revocados === 1 ? "premio revocado" : "premios revocados"} (sus puntos venían de este pedido)`
        : "Pedido anulado · prendas devueltas al catálogo");
    },
    "trash",
    {
      title: "¿Anular este pedido?",
      okLabel: "Sí, anular",
      danger: true,
      detailHTML: `
        ${thumbsHTML}
        <div class="md-row"><span class="md-k">Pedido</span><span class="md-v">#${o.id}</span></div>
        <div class="md-row"><span class="md-k">${o.items.length === 1 ? "Prenda" : "Prendas"}</span><span class="md-v">${items}</span></div>
        <div class="md-row"><span class="md-k">Período</span><span class="md-v">${fmtDate(o.start)} → ${fmtDate(o.end)} · ${days} ${days === 1 ? "día" : "días"}</span></div>
        ${refundHTML}`
    }
  );
}

// Mostrar/ocultar la nota de penalización de una prenda vencida.
function toggleLateInfo(i){
  document.getElementById("lateInfo"+i).classList.toggle("show");
}

// Nota: confirmar el cobro de un pedido en efectivo es una acción del NEGOCIO,
// no del cliente. Este prototipo es de cara al cliente y no tiene panel de
// administración, así que el efectivo queda "pendiente" y su cobro/acreditación
// de puntos los hará el backend/panel admin (fuera de alcance). Un pending del
// cliente NO se puede auto-confirmar aquí.

/* ---- Poner el armario propio en alquiler (anuncio, aún sin implementar) ----
   Convertir al cliente en arrendador cambia el modelo de negocio: exige
   verificar identidad, tasar prendas ajenas, repartir ingresos y responder por
   daños entre particulares. Nada de eso existe todavía, así que el botón solo
   anuncia la intención y recoge el interés — prometer un flujo que no está
   sería peor que no ofrecerlo. */
function openWardrobe(){
  confirmDialog(
    "",
    ()=>{},
    "wardrobe",
    {
      title: "Muy pronto",
      okLabel: "Entendido",
      infoOnly: true,
      tone: "brown",
      detailHTML: `
        <p class="soon-text">Estamos preparando la función para que <b>publiques tu propio armario</b>
        y ganes dinero alquilando la ropa que ya no usas.</p>
        <div class="soon-list">
          <div class="soon-item"><span class="si-icon ico-sky">${icon("camera", { size: 20 })}</span><div>Publica tus prendas con foto y talla</div></div>
          <div class="soon-item"><span class="si-icon ico-gold">${icon("cash", { size: 20 })}</span><div>Recibe ganancias por alquilar tus prendas</div></div>
          <div class="soon-item"><span class="si-icon ico-violet">${icon("shield", { size: 20 })}</span><div>Depósito y seguro por daños incluidos</div></div>
        </div>
        <p class="soon-note">Te avisaremos por correo en cuanto esté disponible.</p>`
    }
  );
}

/* ---- Premios / canje de puntos ---- */
/* ---------------- Reseñas ---------------- */

// Lado máximo de la foto de una reseña y calidad del webp. Una cámara de móvil
// entrega 3–5 MB por foto y localStorage da ~5 MB POR ORIGEN, compartidos con
// carrito, perfil y pedidos: guardar el original en base64 llenaría la cuota con
// una sola reseña y tumbaría el resto del estado. A 1000 px y calidad 0.7 la
// foto baja a decenas de KB sin que se note en pantalla.
const REVIEW_PHOTO_MAX_PX = 1000;
const REVIEW_PHOTO_QUALITY = 0.7;
// Techo duro por foto ya comprimida. Si aun así se pasa (una imagen enorme y muy
// ruidosa), es preferible rechazarla y decirlo que reventar el almacenamiento en
// silencio y perder el carrito del usuario.
const REVIEW_PHOTO_MAX_BYTES = 400 * 1024;

/**
 * Abre el formulario de reseña de un pedido.
 * @param {number} orderId Id del pedido a reseñar.
 */
function openReview(orderId){
  const o = orders.find(x => x.id === orderId);
  const pendientes = o ? reviewableItems(o).filter(id => !reviewFor(o.id, id)) : [];
  if(!pendientes.length) return;
  reviewOrderId = orderId;
  // Con una sola prenda pendiente no hay nada que elegir: se preselecciona.
  reviewProductId = pendientes.length === 1 ? pendientes[0] : null;
  reviewRating = 0;
  reviewText = "";
  reviewPhoto = "";
  view = "review";
  renderSheet();
}

/** ¿El borrador está listo para guardarse? */
function reviewValid(){ return !!reviewProductId && reviewRating >= 1; }

/**
 * Formulario de reseña: elegir prenda (si hay varias), estrellas, texto y foto.
 */
function renderReview(){
  sheetTitle.textContent = "Escribir reseña";
  const o = orders.find(x => x.id === reviewOrderId);
  if(!o){ view = "profile"; renderSheet(); return; }
  const pendientes = reviewableItems(o).filter(id => !reviewFor(o.id, id));

  const prendas = pendientes.map(id => { const p = productById(id); return `
    <div class="rev-pick${reviewProductId === id ? " on" : ""}" data-action="pickReviewItem" data-id="${id}"
         role="button" tabindex="0">
      <div class="ci-thumb">${imgPlaceholder(p)}</div>
      <div class="oi-info">
        <div class="oi-name">${escapeHTML(p.name)}</div>
        <div class="oi-meta">Talla ${escapeHTML(p.size)}</div>
      </div>
    </div>`; }).join("");

  const estrellas = [1,2,3,4,5].map(n => `
    <button class="rev-star${n <= reviewRating ? " on" : ""}" data-action="setReviewRating" data-n="${n}"
            aria-label="${n} ${n === 1 ? "estrella" : "estrellas"}">★</button>`).join("");

  sheetBody.innerHTML = `
    ${pendientes.length > 1 ? `
      <div class="rev-section">
        <div class="rev-label">¿Qué prenda quieres reseñar?</div>
        <div class="rev-picks">${prendas}</div>
      </div>` : `
      <div class="rev-section"><div class="rev-picks">${prendas}</div></div>`}

    <div class="rev-section">
      <div class="rev-label">Tu valoración</div>
      <div class="rev-stars-input">${estrellas}</div>
    </div>

    <div class="rev-section">
      <div class="rev-label">¿Qué tal te fue? <span class="rev-opt">(opcional)</span></div>
      <textarea id="revText" class="rev-textarea" rows="4" maxlength="500"
        placeholder="Cómo te quedó, cómo llegó, si repetirías…">${escapeHTML(reviewText)}</textarea>
    </div>

    <div class="rev-section">
      <div class="rev-label">Foto <span class="rev-opt">(opcional)</span></div>
      ${reviewPhoto ? `
        <div class="rev-photo-wrap">
          <img class="rev-photo" src="${escapeHTML(reviewPhoto)}" alt="Foto elegida">
          <button class="rev-photo-del" data-action="clearReviewPhoto">${icon("trash", { size: 14 })} Quitar</button>
        </div>` : `
        <label class="rev-photo-pick">
          ${icon("clipboard", { size: 15 })} Elegir una foto
          <input type="file" id="revPhoto" accept="image/*" hidden>
        </label>`}
    </div>`;

  sheetFoot.innerHTML = `
    <button class="pay-btn" data-action="saveReview" ${reviewValid() ? "" : "disabled"}>
      Publicar reseña</button>`;
}

/**
 * Redimensiona y convierte a webp la foto elegida, devolviendo un data URL.
 *
 * El navegador hace todo el trabajo: no hay servidor donde subirla, y guardar el
 * original en base64 se comería la cuota de localStorage de una sentada.
 * @param {File} file Archivo elegido por el usuario.
 * @returns {Promise<string>} Data URL en webp, o "" si no se pudo procesar.
 */
function compressPhoto(file){
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const escala = Math.min(1, REVIEW_PHOTO_MAX_PX / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * escala);
      canvas.height = Math.round(img.height * escala);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      // webp comprime bastante mejor que jpeg a igual calidad percibida; si el
      // navegador no lo soportara, toDataURL devuelve png y el techo de bytes
      // se encarga de rechazarlo.
      resolve(canvas.toDataURL("image/webp", REVIEW_PHOTO_QUALITY));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(""); };
    img.src = url;
  });
}

/**
 * Procesa la foto elegida en el formulario y repinta.
 * @param {File} file Archivo del input.
 */
async function pickReviewPhoto(file){
  if(!file) return;
  const dataUrl = await compressPhoto(file);
  if(!dataUrl){ toast("No se pudo leer esa imagen."); return; }
  // El data URL es base64: ~4 bytes por cada 3 del binario.
  if(dataUrl.length * 3 / 4 > REVIEW_PHOTO_MAX_BYTES){
    toast("La foto es demasiado pesada. Prueba con otra.");
    return;
  }
  reviewPhoto = dataUrl;
  renderSheet();
}

/** Guarda la reseña del borrador y vuelve al perfil. */
function submitReview(){
  if(!reviewValid()) return;
  saveReview();
  toast("¡Gracias por tu reseña!");
  view = "profile";
  renderSheet();
}

function renderRewards(){
  sheetTitle.textContent = "Premios";
  sheetBody.innerHTML = `
    <div class="points-card big">
      <div>
        <div class="pc-label">Tus puntos</div>
        <div class="pc-value">${profile.points} <span>pts</span></div>
      </div>
      <span class="pc-emoji">${icon("gift", { size: 26 })}</span>
    </div>

    <div class="section-label">Canjea tus puntos</div>
    ${REWARDS.map(rw => {
      const can = profile.points >= rw.cost;
      return `
      <div class="reward ${can ? "" : "locked"}" data-reward="${rw.id}">
        <div class="rw-icon">${icon(rw.icon, { size: 22 })}</div>
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

    ${couponListHTML(availableCoupons(), "Premios por usar",
      `<p class="summary-note">${icon("ticket", { size: 14 })} Aplícalos en el paso de <b>entrega y pago</b> de tu próximo alquiler.</p>`)}
    ${couponListHTML(profile.redeemed.filter(c => c.usedIn || c.revoked), "Historial de canjes")}

    <p class="summary-note">Ganas puntos con cada alquiler completado (según el monto, los días y la cantidad de prendas).</p>
  `;
  sheetFoot.innerHTML = "";
}

/**
 * Lista de canjes bajo un encabezado, o vacío si no hay ninguno.
 * @param {object[]} lista Canjes de profile.redeemed.
 * @param {string} label Encabezado de la sección.
 * @param {string} [noteHTML] Nota opcional al pie de la sección.
 */
function couponListHTML(lista, label, noteHTML = ""){
  if(!lista.length) return "";
  return `
    <div class="section-label">${label}</div>
    ${lista.map(c => {
      const inactivo = !!(c.usedIn || c.revoked);
      let nota = "";
      if(c.revoked)                              nota = " · anulado con el pedido";
      else if(c.usedIn && c.usedIn !== "—")      nota = ` · pedido #${escapeHTML(c.usedIn)}`;
      return `
      <div class="redeemed-item${inactivo ? " used" : ""}">
        ${c.revoked ? icon("alert", { size: 14 }) : c.usedIn ? icon("checkCircle", { size: 14 }) : icon("ticket", { size: 14 })} ${escapeHTML(c.name)}
        <span>${escapeHTML(c.date)} · ${c.cost} pts${nota}</span>
      </div>`;
    }).join("")}
    ${noteHTML}`;
}

function redeem(id){
  const rw = rewardById(id);
  if(!rw || profile.points < rw.cost) return;
  confirmDialog(`Canjear "${rw.name}" por ${rw.cost} puntos.\n\nLo guardaremos como premio para que lo apliques al pagar tu próximo alquiler.\n\nTe quedarán ${profile.points - rw.cost} pts.\n\n¿Confirmar?`, ()=>{
    profile.points -= rw.cost;
    profile.redeemed.unshift({
      id: nextCouponId(), rewardId: rw.id, name: rw.name,
      cost: rw.cost, date: fmtDate(isoOffset(0)), usedIn: null
    });
    saveState();
    renderRewards();
    toast("Premio guardado · aplícalo al pagar");
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
    <p class="donate-intro">${icon("recycle", { size: 16 })} Dona prendas que ya no uses y gana puntos. <b>La cantidad de puntos se determina al recibir y evaluar la prenda.</b></p>
    <ul class="donate-rules">
      <li>${icon("check", { size: 14 })} La donación es <b>gratis a partir de 3 prendas diferentes</b>.</li>
      <li>${icon("ban", { size: 14 })} No se aceptan <b>prendas interiores</b>.</li>
    </ul>

    <div class="section-label">¿Qué prendas quieres donar?</div>
    <input class="donate-input" id="donName" placeholder="Ej: Abrigo de lana, jeans y camisa (mín. 3 prendas)" value="${escapeHTML(donName)}" aria-label="Prendas a donar" />

    <div class="section-label">¿Cómo nos las entregas?</div>
    <div class="delivery-opts">
      <div class="delivery-opt ${donMethod==='store'?'active':''}" data-action="setDonateMethod" data-value="store" role="button" tabindex="0" aria-pressed="${donMethod==='store'}">
        <div class="do-icon">${icon("store", { size: 22 })}</div>
        <div class="do-text">
          <div class="do-title"><span>Donar en el local</span><span style="color:var(--ok)">Gratis</span></div>
          <div class="do-desc">Acércate a nuestro local físico a dejar la prenda.</div>
        </div>
        <div class="do-radio"></div>
      </div>
      <div class="delivery-opt ${donMethod==='home'?'active':''}" data-action="setDonateMethod" data-value="home" role="button" tabindex="0" aria-pressed="${donMethod==='home'}">
        <div class="do-icon">${icon("truck", { size: 22 })}</div>
        <div class="do-text">
          <div class="do-title"><span>Solicitar retiro a domicilio</span><span style="color:var(--ok)">Gratis</span></div>
          <div class="do-desc">Agenda una cita y vamos a tu dirección a retirarla.</div>
        </div>
        <div class="do-radio"></div>
      </div>
    </div>

    ${donMethod==='store' ? `
      <div class="pickup-detail">${icon("store", { size: 15 })} <b>${LOCAL.nombre}</b><br>${LOCAL.direccion}<br><span style="color:var(--muted)">${LOCAL.horario}</span></div>` : ``}

    ${donMethod==='home' ? `
      <div class="ship-detail">
        ${icon("mapPin", { size: 14 })} Dirección de retiro
        <input id="donAddr" placeholder="Calle, número, ciudad…" value="${escapeHTML(donAddr)}" />
        <label class="don-date-label">${icon("calendar", { size: 14 })} Fecha de la cita
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
              ? `${icon("truck", { size: 14 })} Retiro a domicilio · ${escapeHTML(don.addr)}${don.date ? ` · cita ${fmtDate(don.date)}` : ''}`
              : `${icon("store", { size: 14 })} Entrega en el local`}</div>
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
  toast("Solicitud de donación enviada");
}

/* ---- Ajustes de accesibilidad y tema ----
   Viven en su propia vista y no en el perfil porque no son datos de la cuenta:
   son del dispositivo (ver prefs.js). Quien entra como invitado también los
   necesita, y su sesión no guarda nada. */

/**
 * Grupo de opciones excluyentes, con la activa marcada.
 * @param {string} pref Clave de prefs a la que pertenece el grupo.
 * @param {string} actual Valor activo.
 * @param {Array<[string,string]>} opciones Pares [valor, etiqueta].
 * @returns {string} HTML.
 */
function prefOptionsHTML(pref, actual, opciones){
  return `
    <div class="pref-opts" role="group">
      ${opciones.map(([valor, etiqueta]) => `
        <button class="pref-opt${valor === actual ? " active" : ""}"
                data-action="setPref" data-pref="${pref}" data-value="${valor}"
                aria-pressed="${valor === actual}">${etiqueta}</button>`).join("")}
    </div>`;
}

/**
 * Interruptor de una preferencia booleana.
 * @param {string} pref Clave de prefs.
 * @param {boolean} activo Estado actual.
 * @returns {string} HTML.
 */
function prefToggleHTML(pref, activo){
  return `
    <button class="pref-switch${activo ? " on" : ""}"
            data-action="togglePref" data-pref="${pref}"
            role="switch" aria-checked="${activo}">
      <span class="ps-knob"></span>
    </button>`;
}

/** Vista de ajustes: tema, tamaño de texto, animaciones y contraste. */
function renderSettings(){
  sheetTitle.textContent = "Ajustes";
  const p = getPrefs();
  sheetBody.innerHTML = `
    <p class="settings-intro">Estos ajustes se guardan en este dispositivo y se
    mantienen aunque cierres sesión.</p>

    <div class="pref-row">
      <div class="pref-head">
        <span class="pref-icon ico-violet">${icon("moon", { size: 20 })}</span>
        <div>
          <div class="pref-name">Tema</div>
          <div class="pref-desc">"Automático" sigue al de tu sistema.</div>
        </div>
      </div>
      ${prefOptionsHTML("theme", p.theme, [["auto","Automático"],["light","Claro"],["dark","Oscuro"]])}
    </div>

    <div class="pref-row">
      <div class="pref-head">
        <span class="pref-icon ico-sky">${icon("textSize", { size: 20 })}</span>
        <div>
          <div class="pref-name">Tamaño del texto</div>
          <div class="pref-desc">Amplía también los espacios, no solo la letra.</div>
        </div>
      </div>
      ${prefOptionsHTML("textSize", p.textSize, [["normal","Normal"],["grande","Grande"],["mayor","Mayor"]])}
    </div>

    <div class="pref-row">
      <div class="pref-head">
        <span class="pref-icon ico-gold">${icon("motion", { size: 20 })}</span>
        <div>
          <div class="pref-name">Reducir animaciones</div>
          <div class="pref-desc">Quita transiciones y desplazamientos suaves.</div>
        </div>
        ${prefToggleHTML("reduceMotion", p.reduceMotion)}
      </div>
    </div>

    <div class="pref-row">
      <div class="pref-head">
        <span class="pref-icon ico-teal">${icon("contrast", { size: 20 })}</span>
        <div>
          <div class="pref-name">Contraste alto</div>
          <div class="pref-desc">Refuerza textos secundarios y bordes.</div>
        </div>
        ${prefToggleHTML("highContrast", p.highContrast)}
      </div>
    </div>`;
  sheetFoot.innerHTML = "";
}
