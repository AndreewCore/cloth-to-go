/* ============================================================
   CLOTH TO GO · main.js
   Punto de entrada: pantalla de bienvenida, cableado de eventos e
   inicialización. DEBE cargarse al final (usa todo lo anterior).
   ============================================================ */

/* ---------------- Bienvenida ---------------- */
/**
 * Oculta la pantalla de bienvenida y saluda al usuario en el header.
 * @param {string} name Nombre a mostrar; si es vacío se deja el saludo actual.
 */
function enter(name){
  loginEl.classList.add("hide");
  if(name) greeting.textContent = `Hola, ${name} 🌱`;
}
// Entra como invitado: sesión efímera (sin persistencia) y arranque limpio.
// El inicio de sesión con Google lo cablea initGoogleAuth() (ver auth.js).
document.getElementById("guestBtn").onclick = ()=>{
  activateUserSession(null);
  profile.name = "Invitado";
  enter(profile.name);
};

/* ---------------- Eventos ---------------- */
// Acciones del header: perfil, carrito y encuesta.
document.getElementById("openProfile").onclick = ()=>{ editingOrder=null; editingProfile=false; view="profile"; renderSheet(); openSheet(); };
document.getElementById("openCart").onclick = ()=>{ view="cart"; renderSheet(); openSheet(); };
// Botón "Filtros" del header: abre el panel de calidad/talla/material.
document.getElementById("openFilters").onclick = ()=>{ view="filters"; renderSheet(); openSheet(); };
document.getElementById("openSurvey").onclick = ()=>{
  confirmDialog("¿Quieres ayudarnos respondiendo una breve encuesta? Se abrirá en una pestaña nueva.", ()=>{
    window.open("https://forms.gle/eeu4G4Md877Rp2HV9", "_blank", "noopener");
  }, "📝");
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

// Pop-up de ahorro de agua (felicitación al confirmar un alquiler)
document.getElementById("waterClose").onclick = closeWaterPop;
waterPop.onclick = e=>{ if(e.target === waterPop) closeWaterPop(); };
document.addEventListener("keydown", e=>{
  if(e.key === "Escape" && waterPop.classList.contains("show")) closeWaterPop();
});

searchInput.addEventListener("input", e=>{ searchQuery = e.target.value; renderGrid(); });

// Orden: único <select> que permanece en el header.
document.getElementById("sortBy").addEventListener("change", e=>{
  sortBy = e.target.value; renderGrid();
});

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
    case "signOut":        signOut(); break;
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
    case "clearFiltersSheet": clearFilters(); break;
    case "closeSheet":     closeSheet(); break;
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
  // Selects del panel de filtros: actualizan en vivo el catálogo de fondo.
  else if(t.id === "fQuality"){ qualityFilter = +t.value; renderGrid(); renderFilterSheet(); }
  else if(t.id === "fSize"){ sizeFilter = t.value; renderGrid(); renderFilterSheet(); }
  else if(t.id === "fMaterial"){ materialFilter = t.value; renderGrid(); renderFilterSheet(); }
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
// Pinta el botón de Google (o lo oculta por file://) una vez cargado el SDK.
initGoogleAuth();
// Si el backend está levantado, refresca el catálogo desde la base;
// si no, la app se queda con los datos embebidos (funciona en file://).
hydrateCatalog();
