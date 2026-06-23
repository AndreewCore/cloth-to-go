/* ============================================================
   CLOTH TO GO · catalog.js
   Vista principal: filtros, ordenamiento, grid de prendas y
   detalle de prenda. Incluye agregar al carrito.
   Depende de data.js (PRODUCTS, helpers), state.js y dom.js.
   ============================================================ */

/* ---------------- Filtros ---------------- */
function renderFilters(){
  filtersEl.innerHTML = CATS.map(c =>
    `<button class="chip ${c===activeCat?'active':''}" data-cat="${c}">${c}</button>`
  ).join("");
}

function sortProducts(list){
  const arr = list.slice();           // no mutar PRODUCTS
  switch(sortBy){
    case "price-asc":  arr.sort((a,b)=> a.price - b.price); break;
    case "price-desc": arr.sort((a,b)=> b.price - a.price); break;
    case "stars-desc": arr.sort((a,b)=> b.stars - a.stars || a.price - b.price); break;
    default: break;                   // "default" → orden original del catálogo
  }
  return arr;
}
function filteredProducts(){
  const q = searchQuery.trim().toLowerCase();
  const list = PRODUCTS.filter(p =>
    (activeCat === "Todo" || p.cat === activeCat) &&
    (q === "" || p.name.toLowerCase().includes(q) || p.cat.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q)) &&
    (p.stars >= qualityFilter) &&
    (sizeFilter === "Todas" || p.size === sizeFilter)
  );
  return sortProducts(list);
}

// ¿Hay algún filtro activo? (para mostrar "Limpiar filtros")
function anyFilterActive(){
  return activeCat !== "Todo" || searchQuery.trim() !== "" ||
         qualityFilter !== 0 || sizeFilter !== "Todas" || sortBy !== "default";
}

// Restablece todos los filtros y el orden (incluye sincronizar los controles del DOM).
function clearFilters(){
  activeCat = "Todo"; searchQuery = ""; qualityFilter = 0; sizeFilter = "Todas"; sortBy = "default";
  searchInput.value = "";
  document.getElementById("qualityFilter").value = "0";
  document.getElementById("sizeFilter").value = "Todas";
  document.getElementById("sortBy").value = "default";
  renderFilters();
  renderGrid();
}

function renderGrid(){
  const list = filteredProducts();
  noResults.style.display = list.length ? "none" : "block";

  // Barra de resultados: conteo + limpiar filtros (#7)
  const n = list.length;
  resultsBar.innerHTML = `
    <span class="results-count">${n} ${n===1 ? "prenda" : "prendas"}</span>
    ${anyFilterActive() ? `<button class="clear-filters" id="clearFilters">Limpiar filtros ✕</button>` : ""}`;

  grid.innerHTML = list.map(p => {
    const avail = unitsAvailable(p);
    const btn = inCart(p.id)
      ? `<button class="add-btn" data-add="${p.id}">✓ En carrito</button>`
      : avail > 0
        ? `<button class="add-btn" data-add="${p.id}">+ Alquilar</button>`
        : `<button class="add-btn" disabled>No disponible</button>`;
    return `
    <div class="card">
      <div class="thumb" data-detail="${p.id}">
        ${imgPlaceholder(p)}
        <span class="cond-tag" style="z-index:2">${conditionLabel(p.stars)}</span>
        <span class="size-tag" style="z-index:2">Talla ${p.size}</span>
      </div>
      <div class="card-body">
        <div class="card-name" data-detail="${p.id}" role="button" tabindex="0" aria-label="Ver detalle de ${p.name}">${p.name}</div>
        <div class="card-cat">${p.cat}</div>
        <div class="stars">${starStr(p.stars)}<small>calidad</small></div>
        <div class="price-row">
          <div class="price">$${p.price}<span>/día</span></div>
        </div>
        ${btn}
      </div>
    </div>`;
  }).join("");
}

/* ---------------- Operación de carrito ---------------- */
function addToCart(id){
  if(inCart(id)){ toast("Ya está en tu carrito"); return; }
  cart.push({ id });
  saveState();
  updateBadge();
  renderGrid();
  toast("Añadido al carrito 🛒");
}

/* ---------------- Detalle de prenda ---------------- */
function openDetail(id){ detailId = id; view = "detail"; renderSheet(); openSheet(); }

function renderDetail(){
  const p = productById(detailId);
  sheetTitle.textContent = "Detalle";
  sheetBody.innerHTML = `
    <div class="detail-img">${imgPlaceholder(p)}</div>
    <div class="detail-head">
      <div>
        <div class="detail-name">${p.name}</div>
        <div class="detail-cat">${p.cat}</div>
      </div>
      <div class="detail-price">$${p.price}<span>/día</span></div>
    </div>
    <div class="detail-stars">${starStr(p.stars)}<small>${conditionLabel(p.stars)}</small></div>
    <p class="detail-desc">${p.desc}</p>
    <div class="detail-facts">
      <div class="fact"><div class="k">Talla</div><div class="v">${p.size}</div></div>
      <div class="fact"><div class="k">Calidad</div><div class="v">${p.stars}/5 ★</div></div>
      <div class="fact"><div class="k">Depósito</div><div class="v">$${p.deposit}</div></div>
    </div>
    <p class="detail-avail">${unitsAvailable(p) > 0
      ? `✅ Disponible · ${p.disponibles} unidad${p.disponibles===1?'':'es'} (prenda única de segunda mano)`
      : "⛔ Ya está en tu carrito (prenda única)"}</p>`;

  if(inCart(p.id)){
    sheetFoot.innerHTML = `<button class="pay-btn" data-action="goCart">Ver carrito →</button>`;
  } else {
    sheetFoot.innerHTML = `<button class="pay-btn" data-action="addDetail">Agregar al carrito · $${p.price}/día</button>`;
  }
}
