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
    // Se ordena por el precio del primer día, que es el que muestra la tarjeta.
    case "price-asc":  arr.sort((a,b)=> rentalPrice(a,1) - rentalPrice(b,1)); break;
    case "price-desc": arr.sort((a,b)=> rentalPrice(b,1) - rentalPrice(a,1)); break;
    case "stars-desc": arr.sort((a,b)=> b.stars - a.stars || rentalPrice(a,1) - rentalPrice(b,1)); break;
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
    (sizeFilter === "Todas" || p.size === sizeFilter) &&
    (materialFilter === "Todos" || p.material === materialFilter)
  );
  return sortProducts(list);
}

// ¿Hay algún filtro activo? (para mostrar "Limpiar filtros")
function anyFilterActive(){
  return activeCat !== "Todo" || searchQuery.trim() !== "" ||
         qualityFilter !== 0 || sizeFilter !== "Todas" ||
         materialFilter !== "Todos" || sortBy !== "default";
}

// Nº de filtros activos dentro del panel (calidad/talla/material) — alimenta el
// badge del botón "Filtros" del header. El orden y la categoría tienen sus
// propios controles, así que no cuentan aquí.
function activeFilterCount(){
  let n = 0;
  if(qualityFilter !== 0) n++;
  if(sizeFilter !== "Todas") n++;
  if(materialFilter !== "Todos") n++;
  return n;
}

// Actualiza el badge de conteo del botón "Filtros".
function updateFilterBar(){
  const el = document.getElementById("filterCount");
  if(!el) return;
  const n = activeFilterCount();
  el.textContent = n;
  el.style.display = n > 0 ? "grid" : "none";
}

// Restablece todos los filtros y el orden. El único <select> del header es el de
// orden; los de calidad/talla/material viven en el panel y se regeneran desde
// el estado al re-renderizar.
function clearFilters(){
  activeCat = "Todo"; searchQuery = ""; qualityFilter = 0; sizeFilter = "Todas";
  materialFilter = "Todos"; sortBy = "default";
  searchInput.value = "";
  const sortSel = document.getElementById("sortBy");
  if(sortSel) sortSel.value = "default";
  renderFilters();
  renderGrid();
  updateFilterBar();
  if(view === "filters" && sheet.classList.contains("show")) renderFilterSheet();
}

/* ---------------- Panel de filtros (sheet) ---------------- */
function renderFilterSheet(){
  sheetTitle.textContent = "Filtros";
  const qOpts = [[0,"Todas"],[5,"★★★★★ (5)"],[4,"4★ o más"],[3,"3★ o más"],[2,"2★ o más"]];
  sheetBody.innerHTML = `
    <div class="filter-sheet">
      <label class="fs-fld">
        <span>Calidad</span>
        <select id="fQuality">
          ${qOpts.map(([v,l]) => `<option value="${v}" ${qualityFilter===v?"selected":""}>${l}</option>`).join("")}
        </select>
      </label>
      <label class="fs-fld">
        <span>Talla</span>
        <select id="fSize">
          <option value="Todas" ${sizeFilter==="Todas"?"selected":""}>Todas</option>
          ${SIZES.map(s => `<option value="${s}" ${sizeFilter===s?"selected":""}>${s}</option>`).join("")}
        </select>
      </label>
      <label class="fs-fld">
        <span>Material</span>
        <select id="fMaterial">
          <option value="Todos" ${materialFilter==="Todos"?"selected":""}>Todos</option>
          ${MATERIALS.map(m => `<option value="${m}" ${materialFilter===m?"selected":""}>${materialLabel(m)}</option>`).join("")}
        </select>
      </label>
    </div>`;

  const n = filteredProducts().length;
  sheetFoot.innerHTML = `
    <div class="filter-foot">
      <button class="fs-clear" data-action="clearFiltersSheet" ${activeFilterCount()?"":"disabled"}>Limpiar</button>
      <button class="pay-btn fs-apply" data-action="closeSheet">Ver ${n} ${n===1?"prenda":"prendas"}</button>
    </div>`;
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
      ? `<button class="add-btn in-cart" data-add="${p.id}">✓ En carrito</button>`
      : avail > 0
        ? `<button class="add-btn" data-add="${p.id}">+ Alquilar</button>`
        : `<button class="add-btn" disabled>No disponible</button>`;
    return `
    <div class="card">
      <div class="thumb" data-detail="${p.id}">
        ${imgPlaceholder(p)}
        <span class="cond-tag" style="z-index:2">${conditionLabel(p.stars)}</span>
        <span class="size-tag" style="z-index:2">Talla ${escapeHTML(p.size)}</span>
      </div>
      <div class="card-body">
        <div class="card-name" data-detail="${p.id}" role="button" tabindex="0" aria-label="Ver detalle de ${escapeHTML(p.name)}">${escapeHTML(p.name)}</div>
        <div class="card-meta"><span>${escapeHTML(p.cat)}</span><span class="cm-dot">·</span><span class="cm-mat">🧵 ${escapeHTML(materialLabel(p.material))}</span></div>
        <div class="stars">${starStr(p.stars)}<small>calidad</small></div>
        <div class="price-row">
          <div class="price"><span class="price-amt">$${rentalPrice(p, 1).toFixed(2)}</span><span class="price-per">1er día</span></div>
          <div class="price-extra">${nextDayPrice(p) > 0
            ? `+$${nextDayPrice(p).toFixed(2)} por día extra`
            : "días extra sin costo"}</div>
        </div>
        ${btn}
      </div>
    </div>`;
  }).join("");

  updateFilterBar();
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
        <div class="detail-name">${escapeHTML(p.name)}</div>
        <div class="detail-cat">${escapeHTML(p.cat)}</div>
      </div>
      <div class="detail-price">$${rentalPrice(p, 1).toFixed(2)}<span>1er día</span></div>
    </div>
    <div class="detail-stars">${starStr(p.stars)}<small>${conditionLabel(p.stars)}</small></div>
    <p class="detail-desc">${escapeHTML(p.desc)}</p>
    <div class="detail-facts">
      <div class="fact"><div class="k">Talla</div><div class="v">${escapeHTML(p.size)}</div></div>
      <div class="fact"><div class="k">Material</div><div class="v">${escapeHTML(materialLabel(p.material))}</div></div>
      <div class="fact"><div class="k">Calidad</div><div class="v">${p.stars}/5 ★</div></div>
      <div class="fact"><div class="k">Depósito</div><div class="v">$${depositFor(p)}</div></div>
    </div>
    <div class="detail-tarifa">
      <div class="dt-title">Tarifa por duración</div>
      ${[1, 3, 7, 14].map(d => `
        <div class="dt-row">
          <span>${d} ${d === 1 ? "día" : "días"}</span>
          <span><b>$${rentalPrice(p, d).toFixed(2)}</b> <small>($${(rentalPrice(p, d) / d).toFixed(2)}/día)</small></span>
        </div>`).join("")}
      <p class="dt-note">Mientras más días, más barato sale cada uno. Alquilando varias prendas a la vez ahorras hasta un ${Math.round(VOLUME_DISCOUNT_MAX * 100)}% adicional.</p>
    </div>
    <p class="detail-avail">${unitsAvailable(p) > 0
      ? `✅ Disponible · ${p.disponibles} unidad${p.disponibles===1?'':'es'} (prenda única de segunda mano)`
      : "⛔ Ya está en tu carrito (prenda única)"}</p>`;

  if(inCart(p.id)){
    sheetFoot.innerHTML = `<button class="pay-btn" data-action="goCart">Ver carrito →</button>`;
  } else {
    sheetFoot.innerHTML = `<button class="pay-btn" data-action="addDetail">Agregar al carrito · desde $${rentalPrice(p, 1).toFixed(2)}</button>`;
  }
}
