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
  if(name) greeting.textContent = `Hola, ${name}`;
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
// Preferencias: el engranaje del header es ahora el ÚNICO acceso al tema.
// Antes estaba enterrado en el perfil, donde no se encontraba, y convivía con
// un interruptor suelto de claro/oscuro aquí arriba. Se retiró ese interruptor:
// un cuarto icono saturaba la cabecera, y el tema vive dentro de Preferencias.
document.getElementById("openPrefs").onclick = ()=>{ view="settings"; renderSheet(); openSheet(); };
document.getElementById("closeSheet").onclick = closeSheet;
overlay.onclick = closeSheet;
// Pestaña de detalle apilada (detalle abierto encima del perfil): cerrarla
// solo la baja; el perfil sigue debajo tal cual estaba.
document.getElementById("closeStack").onclick = closeStackSheet;
stackOverlay.onclick = closeStackSheet;

// Botón "atrás": vuelve al paso anterior del flujo (ver SHEET_BACK). En las
// vistas a pantalla completa sin paso previo (el perfil) hace de salida: no
// tendría sentido mostrar una flecha que no lleva a ningún sitio.
backBtn.onclick = ()=>{
  const prev = SHEET_BACK[view];
  if(prev){ view = prev; renderSheet(); }
  else closeSheet();
};

// Modal de confirmación in-app
modalOk.onclick = ()=>{ const cb = onConfirmCb; closeModal(); if(cb) cb(); };
modalCancel.onclick = closeModal;

// Selector de ubicación (maps.js). Los controles viven fuera del panel
// deslizante, así que no los alcanza su delegación de eventos.
document.getElementById("mapClose").onclick = closeMapPicker;
document.getElementById("mapConfirm").onclick = confirmMapPicker;
document.getElementById("mapLocate").onclick = useMyLocation;
document.getElementById("mapOverlay").onclick = e=>{
  if(e.target === document.getElementById("mapOverlay")) closeMapPicker();
};
modalOverlay.onclick = e=>{ if(e.target === modalOverlay) closeModal(); };
document.addEventListener("keydown", e=>{
  if(e.key === "Escape" && modalOverlay.classList.contains("show")) closeModal();
  else if(e.key === "Escape" && document.getElementById("mapOverlay").classList.contains("show")) closeMapPicker();
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
  // La miniatura de la tarjeta es el origen del vuelo al carrito: es lo que el
  // cliente está mirando cuando pulsa, no el botón.
  if(add){ addToCart(+add.dataset.add, add.closest(".card")?.querySelector(".thumb")); return; }
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
   HTML y no re-asignan listeners en cada render.
   La pestaña apilada comparte este despachador: muestra el mismo detalle, así
   que sus botones deben hacer lo mismo sin una segunda lista que sincronizar. */
function onSheetClick(e){
  const el = e.target.closest("[data-action]");
  if(!el) return;
  switch(el.dataset.action){
    case "remove":         removeItem(+el.dataset.id); break;
    case "toCheckout":     view="checkout"; renderSheet(); break;
    case "setDelivery":    delivery = el.dataset.value; renderSheet(); break;
    case "setReturn":      returnMethod = el.dataset.value; renderSheet(); break;
    // Segundo toque sobre el premio ya aplicado = quitarlo (como los radios
    // del resto del checkout, pero aquí no elegir es una opción legítima).
    case "applyCoupon":    { const id = +el.dataset.id;
                             appliedCoupon = appliedCoupon === id ? null : id;
                             renderSheet(); break; }
    case "clearCoupon":    appliedCoupon = null; renderSheet(); break;
    case "toPayment":      view="payment"; renderSheet(); break;
    case "setPay":         payMethod = el.dataset.value; renderSheet(); break;
    case "confirmOrder":   confirmOrder(); break;
    case "finish":         finishOrder(); break;
    case "goToOrders":     goToOrders(); break;
    // closeStackSheet() es inocuo si no hay pestaña arriba, y desde ella hay
    // que bajarla para que el carrito se vea en el panel principal.
    case "goCart":         closeStackSheet(); view="cart"; renderSheet(); break;
    // Miniatura de prenda dentro del panel (pedidos del perfil): abre su
    // detalle en la pestaña apilada, por encima del perfil.
    case "openDetail":     openDetail(+el.dataset.id); break;
    // Desde el detalle de una prenda ya alquilada: lleva a sus pedidos sin
    // tocar el checkout en curso (a diferencia de goToOrders, que lo limpia).
    // Apilado no hay a dónde navegar: el perfil ya está debajo de la pestaña.
    case "goProfile":      if(stackedDetail){ closeStackSheet(); break; }
                           editingOrder=null; editingProfile=false; view="profile"; renderSheet(); break;
    // renderDetail() sirve para ambas superficies y repinta solo el detalle,
    // que es lo único que cambia al agregar la prenda al carrito.
    // Desde el detalle vuela la foto grande: el botón vive en el pie del panel,
    // y la galería es lo que ocupa la mirada. `.sheet` acota a la superficie
    // pulsada — el detalle también se abre apilado sobre el perfil.
    case "addDetail":      addToCart(detailId, el.closest(".sheet")?.querySelector(".gallery"));
                           renderDetail(); break;
    case "openReview":     openReview(+el.dataset.order); break;
    case "pickReviewItem": reviewProductId = +el.dataset.id; renderSheet(); break;
    // Segundo toque sobre la misma estrella = quitarla, como el premio aplicado:
    // equivocarse al puntuar no debe obligar a salir y volver a entrar.
    case "setReviewRating": { const n = +el.dataset.n;
                              reviewRating = reviewRating === n ? 0 : n;
                              renderSheet(); break; }
    case "clearReviewPhoto": reviewPhoto = ""; renderSheet(); break;
    case "saveReview":     submitReview(); break;
    case "galPrev":        moveGallery(-1); break;
    case "galNext":        moveGallery(1); break;
    case "galDot":         showGalleryImage(+el.dataset.i); break;
    case "signOut":        signOut(); break;
    case "deleteAccount":  askDeleteAccount(); break;
    case "saveProfile":    saveProfile(); break;
    case "editProfile":    editProfile(); break;
    case "cancelProfileEdit": cancelProfileEdit(); break;
    case "verifyPhone":    verifyPhone(); break;
    case "pickDay":        pickCalendarDay(el.dataset.iso); break;
    case "calPrev":        shiftCalendar(-1); break;
    case "calNext":        shiftCalendar(1); break;
    case "openRewards":    view="rewards"; renderSheet(); break;
    case "waterGoalInfo":  toggleWaterGoalInfo(+el.dataset.id); break;
    case "redeem":         redeem(+el.dataset.id); break;
    case "openDonate":     openDonate(); break;
    case "openWardrobe":   openWardrobe(); break;
    case "setPref":        setPref(el.dataset.pref, el.dataset.value); renderSheet(); break;
    // Los booleanos leen su estado del DOM (aria-checked) en vez de recalcularlo:
    // el botón ya es la fuente de verdad de lo que el usuario está viendo.
    case "togglePref":     setPref(el.dataset.pref, el.getAttribute("aria-checked") !== "true"); renderSheet(); break;
    case "setDonateMethod": donMethod = el.dataset.value; renderSheet(); break;
    case "submitDonation": submitDonation(); break;
    case "editReturn":     openReturnEditor(+el.dataset.idx); break;
    case "pickReturn":     editRet = el.dataset.value; renderProfile(); break;
    case "saveReturn":     saveReturn(+el.dataset.idx); break;
    case "cancelReturn":   closeReturnEditor(); break;
    case "cancelOrder":    cancelOrder(+el.dataset.idx); break;
    case "toggleLateInfo": toggleLateInfo(+el.dataset.idx); break;
    case "clearFiltersSheet": clearFilters(); break;
    case "toggleFilterGroup": toggleFilterGroup(el.dataset.group); break;
    // Los filtros actualizan en vivo el catálogo de fondo, sin cerrar el panel.
    case "setFilter":      setFilterValue(el.dataset.filter, el.dataset.value); break;
    case "pickLocation":   openMapPicker(el.dataset.target); break;
    case "closeSheet":     closeSheet(); break;
  }
}
sheet.addEventListener("click", onSheetClick);
sheetStack.addEventListener("click", onSheetClick);

/* Deslizar la galería con el dedo. Es como se navegan las fotos en el móvil, y
   sin esto las flechas serían el único camino en la superficie donde menos se
   acierta a pulsarlas. Se escucha en las dos superficies (panel y pestaña
   apilada), igual que el click. */
let swipeX = null;
function onGalleryTouchStart(e){
  swipeX = e.target.closest(".gallery") ? e.changedTouches[0].clientX : null;
}
function onGalleryTouchEnd(e){
  if(swipeX === null) return;
  const dx = e.changedTouches[0].clientX - swipeX;
  swipeX = null;
  // 40px de umbral: por debajo suele ser un toque con temblor, no un gesto, y
  // cambiar la foto ahí se siente como que la app hace cosas sola.
  if(Math.abs(dx) > 40) moveGallery(dx < 0 ? 1 : -1);
}
for(const sup of [sheet, sheetStack]){
  sup.addEventListener("touchstart", onGalleryTouchStart, { passive: true });
  sup.addEventListener("touchend", onGalleryTouchEnd, { passive: true });
}

// Inputs del panel: actualizan estado sin re-render (para no perder el foco).
sheet.addEventListener("input", e=>{
  const t = e.target;
  // Escribir a mano invalida el punto del mapa: el texto y las coordenadas
  // dejarían de referirse al mismo sitio, y mandaríamos el reparto al viejo.
  if(t.id === "addr"){          address = t.value; clearPickedLocation("ship"); }
  else if(t.id === "retAddr"){  returnAddress = t.value; clearPickedLocation("return"); }
  // Sin re-render: repintar el formulario en cada tecla vaciaría el textarea
  // y perdería el cursor. El botón se habilita con las estrellas, no con esto.
  else if(t.id === "revText"){  reviewText = t.value; }
  // Celular: solo dígitos y nunca más de los 10 del formato nacional. El corte
  // en vivo evita que se pegue un número con el +593 delante y quede de 13.
  else if(t.id === "pfPhone")  t.value = t.value.replace(/[^0-9]/g, "").slice(0, PHONE_NATIONAL_LEN);
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
  if(t.id === "revPhoto"){
    pickReviewPhoto(t.files && t.files[0]);
    return;
  }
  if(t.id === "rentStart"){
    rentalStart = t.value;
    if(new Date(rentalEnd) <= new Date(rentalStart)) rentalEnd = rentalStart;
    // Escribir la fecha a mano manda sobre el rango a medio elegir en el
    // calendario: si no, quedarían dos inicios distintos compitiendo.
    calPendingStart = null;
    calMonth = null;
    renderSheet();
  } else if(t.id === "rentEnd"){
    rentalEnd = t.value; calPendingStart = null; calMonth = null; renderSheet();
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

/* Flechas ←/→ recorren la galería del detalle. Sin esto, quien navega por
   teclado tendría que tabular hasta los controles para ver la segunda foto. Se
   ignora si el foco está en un campo: ahí las flechas mueven el cursor. */
document.addEventListener("keydown", e=>{
  if(e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  if(!document.querySelector(".gallery")) return;
  if(e.target.closest("input, textarea, select")) return;
  e.preventDefault();
  moveGallery(e.key === "ArrowRight" ? 1 : -1);
});

/* ---------------- Init ---------------- */
// Antes de cualquier render: decide si el botón del mapa se ofrece en esta carga.
adoptMapsKeyFromUrl();
// Acompaña el cambio automático de tema del sistema mientras esté en "auto".
watchSystemTheme();
renderFilters();
renderGrid();
updateBadge();
// Pinta el botón de Google (o lo oculta por file://) una vez cargado el SDK.
initGoogleAuth();
// Si el backend está levantado, refresca el catálogo desde la base;
// si no, la app se queda con los datos embebidos (funciona en file://).
hydrateCatalog();
