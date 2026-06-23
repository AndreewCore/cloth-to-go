/* ============================================================
   CLOTH TO GO · main.js
   Punto de entrada: login (simulado), cableado de eventos e
   inicialización. DEBE cargarse al final (usa todo lo anterior).
   ============================================================ */

/* ---------------- Login (simulado) ---------------- */
function enter(name){
  loginEl.classList.add("hide");
  if(name) greeting.textContent = `Hola, ${name} 🌱`;
}
document.getElementById("loginBtn").onclick = ()=>{
  const email = document.getElementById("loginEmail").value.trim();
  const pass = document.getElementById("loginPass").value;
  const err = document.getElementById("loginError");
  const showErr = msg => { err.textContent = msg; err.style.display = "block"; };

  if(!isValidEmail(email)){ showErr("Ingresa un correo válido (ej: nombre@dominio.com)."); return; }
  if(pass.length < 4){ showErr("La contraseña debe tener al menos 4 caracteres."); return; }
  err.style.display = "none";

  profile.email = email;
  profile.name = email.split("@")[0];
  saveState();
  enter(profile.name);
};
document.getElementById("guestBtn").onclick = ()=>{ if(!profile.name) profile.name = "Invitado"; saveState(); enter("invitado"); };

/* ---------------- Eventos ---------------- */
document.getElementById("openProfile").onclick = ()=>{ editingOrder=null; editingProfile=false; view="profile"; renderSheet(); openSheet(); };
document.getElementById("openCart").onclick = ()=>{ view="cart"; renderSheet(); openSheet(); };
document.getElementById("openSurvey").onclick = ()=>{
  confirmDialog("¿Quieres ayudarnos respondiendo una breve encuesta? Se abrirá en una pestaña nueva.", ()=>{
    window.open("https://forms.gle/eeu4G4Md877Rp2HV9", "_blank", "noopener");
  });
};
document.getElementById("closeSheet").onclick = closeSheet;
overlay.onclick = closeSheet;

// Botón "atrás": vuelve al paso anterior del flujo (ver SHEET_BACK).
backBtn.onclick = ()=>{ const prev = SHEET_BACK[view]; if(prev){ view = prev; renderSheet(); } };

// Modal de confirmación in-app
modalOk.onclick = ()=>{ const cb = onConfirmCb; closeModal(); if(cb) cb(); };
modalCancel.onclick = closeModal;
modalOverlay.onclick = e=>{ if(e.target === modalOverlay) closeModal(); };
document.addEventListener("keydown", e=>{
  if(e.key === "Escape" && modalOverlay.classList.contains("show")) closeModal();
});

searchInput.addEventListener("input", e=>{ searchQuery = e.target.value; renderGrid(); });

document.getElementById("qualityFilter").addEventListener("change", e=>{
  qualityFilter = +e.target.value; renderGrid();
});
document.getElementById("sortBy").addEventListener("change", e=>{
  sortBy = e.target.value; renderGrid();
});

// Selector de talla: opciones generadas desde SIZES.
const sizeSel = document.getElementById("sizeFilter");
sizeSel.innerHTML = `<option value="Todas">Todas</option>` +
  SIZES.map(s => `<option value="${s}">${s}</option>`).join("");
sizeSel.addEventListener("change", e=>{ sizeFilter = e.target.value; renderGrid(); });

// "Limpiar filtros" (se re-renderiza dentro de resultsBar).
resultsBar.addEventListener("click", e=>{
  if(e.target.closest("#clearFilters")) clearFilters();
});

filtersEl.addEventListener("click", e=>{
  const c = e.target.closest("[data-cat]");
  if(!c) return;
  activeCat = c.dataset.cat;
  renderFilters(); renderGrid();
});

grid.addEventListener("click", e=>{
  const add = e.target.closest("[data-add]");
  if(add){ addToCart(+add.dataset.add); return; }
  const card = e.target.closest("[data-detail]");
  if(card){ openDetail(+card.dataset.detail); }
});

// Teclado en el catálogo: Enter/Espacio sobre el nombre (role="button") abre el detalle.
grid.addEventListener("keydown", e=>{
  if((e.key === "Enter" || e.key === " ") && e.target.matches("[data-detail]")){
    e.preventDefault();
    e.target.click();
  }
});

/* ---- Delegación de eventos del panel deslizante ----
   Toda la interacción dentro del sheet (body + foot) se maneja aquí
   por delegación, leyendo data-action. Así las vistas solo generan
   HTML y no re-asignan listeners en cada render. */
sheet.addEventListener("click", e=>{
  const el = e.target.closest("[data-action]");
  if(!el) return;
  switch(el.dataset.action){
    case "remove":         removeItem(+el.dataset.id); break;
    case "toCheckout":     view="checkout"; renderSheet(); break;
    case "setDelivery":    delivery = el.dataset.value; renderSheet(); break;
    case "setReturn":      returnMethod = el.dataset.value; renderSheet(); break;
    case "toPayment":      view="payment"; renderSheet(); break;
    case "setPay":         payMethod = el.dataset.value; renderSheet(); break;
    case "placeOrder":     placeOrder(); break;
    case "finish":         finishOrder(); break;
    case "goCart":         view="cart"; renderSheet(); break;
    case "addDetail":      addToCart(detailId); renderSheet(); break;
    case "saveProfile":    saveProfile(); break;
    case "editProfile":    editProfile(); break;
    case "cancelProfileEdit": cancelProfileEdit(); break;
    case "openRewards":    view="rewards"; renderSheet(); break;
    case "redeem":         redeem(+el.dataset.id); break;
    case "openDonate":     openDonate(); break;
    case "setDonateMethod": donMethod = el.dataset.value; renderSheet(); break;
    case "submitDonation": submitDonation(); break;
    case "editReturn":     openReturnEditor(+el.dataset.idx); break;
    case "pickReturn":     editRet = el.dataset.value; renderProfile(); break;
    case "saveReturn":     saveReturn(+el.dataset.idx); break;
    case "cancelReturn":   closeReturnEditor(); break;
    case "toggleLateInfo": toggleLateInfo(+el.dataset.idx); break;
  }
});

// Inputs del panel: actualizan estado sin re-render (para no perder el foco).
sheet.addEventListener("input", e=>{
  const t = e.target;
  if(t.id === "addr")          address = t.value;
  else if(t.id === "retAddr")  returnAddress = t.value;
  else if(t.id === "pfPhone")  t.value = t.value.replace(/[^0-9]/g, ""); // solo números
  // Datos de tarjeta (formateo en vivo)
  else if(t.id === "cardNumber"){ t.value = t.value.replace(/[^0-9 ]/g, ""); card.number = t.value; }
  else if(t.id === "cardName"){   card.name = t.value; }
  else if(t.id === "cardExpiry"){
    t.value = t.value.replace(/[^0-9]/g, "").replace(/^(\d{2})(\d)/, "$1/$2").slice(0, 5); // MM/AA
    card.expiry = t.value;
  }
  else if(t.id === "cardCvv"){ t.value = t.value.replace(/[^0-9]/g, ""); card.cvv = t.value; }
  // Dirección de retiro al editar la devolución de un alquiler
  else if(t.id === "editRetAddr"){ editRetAddr = t.value; }
  // Formulario de donación
  else if(t.id === "donName"){ donName = t.value; }
  else if(t.id === "donAddr"){ donAddr = t.value; }
});

// Cambios de fecha: actualizan estado y re-renderizan.
sheet.addEventListener("change", e=>{
  const t = e.target;
  if(t.id === "rentStart"){
    rentalStart = t.value;
    if(new Date(rentalEnd) <= new Date(rentalStart)) rentalEnd = rentalStart;
    renderSheet();
  } else if(t.id === "rentEnd"){
    rentalEnd = t.value; renderSheet();
  } else if(t.id === "donDate"){
    donDate = t.value; renderSheet();
  }
});

// Al salir de una dirección o de un campo de tarjeta, re-render para revalidar el botón.
sheet.addEventListener("focusout", e=>{
  if(["addr","retAddr","cardNumber","cardName","cardExpiry","cardCvv","donName","donAddr"].includes(e.target.id)) renderSheet();
});

// Teclado: Enter/Espacio activa los controles con role="button" (divs no nativos).
sheet.addEventListener("keydown", e=>{
  if((e.key === "Enter" || e.key === " ") && e.target.matches("[data-action]") && e.target.tagName !== "BUTTON"){
    e.preventDefault();
    e.target.click();
  }
});

/* ---------------- Init ---------------- */
renderFilters();
renderGrid();
updateBadge();
