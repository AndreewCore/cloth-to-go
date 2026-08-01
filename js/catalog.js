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
    // El color entra en la búsqueda además de tener su propio filtro: escribir
    // "negro" es el primer reflejo de mucha gente, y hasta ahora solo acertaba
    // por casualidad cuando la descripción mencionaba el color.
    (q === "" || p.name.toLowerCase().includes(q) || p.cat.toLowerCase().includes(q) ||
      p.desc.toLowerCase().includes(q) || colorLabel(p.color).toLowerCase().includes(q)) &&
    (p.stars >= qualityFilter) &&
    (sizeFilter === "Todas" || p.size === sizeFilter) &&
    (materialFilter === "Todos" || p.material === materialFilter) &&
    (colorFilter === "Todos" || p.color === colorFilter)
  );
  const orden = sortProducts(list);
  // La prenda alquilada se queda en el catálogo, pero al final: desaparecer
  // costaba el escaparate (nadie podía verla, ni volver a por ella) y hacía
  // pensar que el catálogo era más pequeño de lo que es. Sigue sin poder
  // alquilarse; esto es presentación, no permiso. El orden elegido por el
  // usuario se respeta dentro de cada grupo.
  return [...orden.filter(p => !isRented(p.id)), ...orden.filter(p => isRented(p.id))];
}

// ¿Hay algún filtro activo? (para mostrar "Limpiar filtros")
function anyFilterActive(){
  return activeCat !== "Todo" || searchQuery.trim() !== "" ||
         qualityFilter !== 0 || sizeFilter !== "Todas" ||
         materialFilter !== "Todos" || colorFilter !== "Todos" ||
         sortBy !== "default";
}

// Nº de filtros activos dentro del panel (calidad/talla/material/color) —
// alimenta el badge del botón "Filtros" del header. El orden y la categoría
// tienen sus propios controles, así que no cuentan aquí.
function activeFilterCount(){
  let n = 0;
  if(qualityFilter !== 0) n++;
  if(sizeFilter !== "Todas") n++;
  if(materialFilter !== "Todos") n++;
  if(colorFilter !== "Todos") n++;
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

// Restablece todos los filtros y el orden. El único <select> que queda es el de
// orden, en el header; los grupos de calidad/talla/material/color viven en el
// panel y se regeneran desde el estado al re-renderizar.
function clearFilters(){
  activeCat = "Todo"; searchQuery = ""; qualityFilter = 0; sizeFilter = "Todas";
  materialFilter = "Todos"; colorFilter = "Todos"; sortBy = "default";
  searchInput.value = "";
  const sortSel = document.getElementById("sortBy");
  if(sortSel) sortSel.value = "default";
  renderFilters();
  renderGrid();
  updateFilterBar();
  if(view === "filters" && sheet.classList.contains("show")) renderFilterSheet();
}

/* ---------------- Panel de filtros (sheet) ----------------
   Los <select> nativos se cambiaron por grupos plegables propios: el desplegable
   del sistema no admite elementos dentro de un <option> (ni el medidor de
   calidad ni el punto de color), y en móvil se abre como una rueda que tapa el
   catálogo que el filtro está actualizando en vivo. */

/** Qué valor tiene puesto un grupo, para que el cabezal cerrado lo diga. */
function filterGroupValue(group){
  if(group === "quality")  return qualityFilter === 0 ? "Todas" : conditionLabel(qualityFilter);
  if(group === "size")     return sizeFilter === "Todas" ? "Todas" : sizeFilter;
  if(group === "material") return materialFilter === "Todos" ? "Todos" : materialLabel(materialFilter);
  return "";
}

/**
 * Grupo plegable del panel: cabezal con el valor vigente y la flecha, y las
 * opciones debajo.
 * @param {string} group Clave del filtro (`quality`|`size`|`material`).
 * @param {string} label Título visible.
 * @param {string} optsHTML Opciones ya renderizadas.
 * @returns {string} HTML del grupo.
 */
function filterGroupHTML(group, label, optsHTML){
  const open = openFilterGroup === group;
  return `
    <div class="fs-group${open ? " open" : ""}" data-group="${group}">
      <button class="fs-head" data-action="toggleFilterGroup" data-group="${group}" aria-expanded="${open}">
        <span class="fs-head-l">${label}</span>
        <span class="fs-head-v">${escapeHTML(filterGroupValue(group))}</span>
        <span class="fs-chev">${icon("chevronDown", { size: 16 })}</span>
      </button>
      <div class="fs-opts"><div class="fs-opts-in">${optsHTML}</div></div>
    </div>`;
}

/**
 * Una opción de filtro. `aria-pressed` y no `role="radio"`: son botones que
 * conmutan un valor único, y el grupo puede quedar en su opción "Todas".
 * @param {string} group Clave del filtro.
 * @param {string|number} value Valor que aplica.
 * @param {boolean} sel Si es el valor vigente.
 * @param {string} inner Contenido del botón.
 * @param {string} [cls] Clase extra (variante de la opción).
 * @returns {string} HTML del botón.
 */
function filterOptHTML(group, value, sel, inner, cls = ""){
  return `<button class="fs-opt${cls ? " " + cls : ""}${sel ? " sel" : ""}"
    data-action="setFilter" data-filter="${group}" data-value="${escapeHTML(String(value))}"
    aria-pressed="${sel}">${inner}</button>`;
}

function renderFilterSheet(){
  sheetTitle.textContent = "Filtros";
  // El medidor va dibujado (no en texto) y la etiqueta en palabras al lado: si
  // la fuente o el contraste se comen las pastillas, el filtro se sigue
  // entendiendo. El "o más" del criterio se dice UNA vez, en la nota del grupo:
  // repetirlo en cada fila era ruido en cinco líneas seguidas.
  const qOpts = [
    filterOptHTML("quality", 0, qualityFilter === 0, `<span class="fs-opt-t">Todas</span>`, "fs-row"),
    ...[5, 4, 3, 2].map(n => filterOptHTML("quality", n, qualityFilter === n,
      `<span class="fs-opt-t">${conditionLabel(n)}</span>${qualityMeter(n)}`, "fs-row")),
  ].join("");

  const sOpts = [
    filterOptHTML("size", "Todas", sizeFilter === "Todas", "Todas"),
    ...SIZES.map(s => filterOptHTML("size", s, sizeFilter === s, escapeHTML(s))),
  ].join("");

  // Cada material lleva su icono: cinco filas de solo texto se leen todas
  // iguales, y el icono da dónde apoyar la vista al recorrerlas.
  const mOpts = [
    filterOptHTML("material", "Todos", materialFilter === "Todos",
      `${icon("layers", { size: 15 })}<span class="fs-opt-t">Todos</span>`, "fs-row"),
    ...MATERIALS.map(m => filterOptHTML("material", m, materialFilter === m,
      `${icon("layers", { size: 15 })}<span class="fs-opt-t">${escapeHTML(materialLabel(m))}</span>
       <span class="fs-opt-n">${PRODUCTS.filter(p => p.material === m).length}</span>`, "fs-row")),
  ].join("");

  // El color NO se pliega: son catorce opciones, y plegadas obligan a abrir,
  // desplazar y leer una lista larga para lo que la vista resuelve de un
  // vistazo. Cada botón lleva su muestra de color, que es lo que de verdad se
  // busca; el conteo va al lado porque el banco ofrece el catálogo entero de
  // tonos, y sin él elegir uno sin prendas parece un filtro roto.
  const cOpts = [
    // "Todos" también lleva muestra (la rueda entera): sin ella su renglón
    // arrancaría desalineado del resto de la rejilla.
    filterOptHTML("color", "Todos", colorFilter === "Todos",
      `<span class="color-dot" style="background:conic-gradient(${COLORS.map(colorSwatch).join(",")})"></span>
       <span class="fs-opt-t">Todos</span>`, "fs-color"),
    ...COLORS.map(c => filterOptHTML("color", c, colorFilter === c,
      `<span class="color-dot" style="background:${colorSwatch(c)}"></span>
       <span class="fs-opt-t">${escapeHTML(colorLabel(c))}</span>
       <span class="fs-opt-n">${colorCount(c)}</span>`, "fs-color")),
  ].join("");

  sheetBody.innerHTML = `
    <div class="filter-sheet">
      ${filterGroupHTML("quality", "Calidad",
        `<p class="fs-hint">Muestra las prendas de esa calidad o mejor.</p>${qOpts}`)}
      ${filterGroupHTML("size", "Talla", `<div class="fs-chips">${sOpts}</div>`)}
      ${filterGroupHTML("material", "Material", mOpts)}
      <div class="fs-group fs-static">
        <div class="fs-head-l fs-static-l">Color</div>
        <div class="fs-colors">${cOpts}</div>
      </div>
    </div>`;

  const n = filteredProducts().length;
  sheetFoot.innerHTML = `
    <div class="filter-foot">
      <button class="fs-clear" data-action="clearFiltersSheet" ${activeFilterCount()?"":"disabled"}>Limpiar</button>
      <button class="pay-btn fs-apply" data-action="closeSheet">Ver ${n} ${n===1?"prenda":"prendas"}</button>
    </div>`;
}

/**
 * Abre un grupo del panel y cierra el que estuviera abierto (solo uno a la vez:
 * el panel es corto y con dos abiertos el botón "Ver N prendas" se va de la
 * pantalla). Toca las clases del DOM en vez de repintar: el repintado nace ya
 * en el estado final y se comería la animación de la flecha y del desplegado.
 * @param {string} group Clave del grupo pulsado.
 */
function toggleFilterGroup(group){
  openFilterGroup = openFilterGroup === group ? null : group;
  sheetBody.querySelectorAll(".fs-group[data-group]").forEach(el => {
    const open = el.dataset.group === openFilterGroup;
    el.classList.toggle("open", open);
    el.querySelector(".fs-head").setAttribute("aria-expanded", String(open));
  });
}

/**
 * Aplica una opción del panel. Volver a pulsar la vigente la quita: equivocarse
 * no debe obligar a buscar la opción "Todas" al principio de la lista.
 * @param {string} group Clave del filtro.
 * @param {string} value Valor elegido.
 */
function setFilterValue(group, value){
  if(group === "quality")  qualityFilter  = qualityFilter === +value ? 0 : +value;
  if(group === "size")     sizeFilter     = sizeFilter === value ? "Todas" : value;
  if(group === "material") materialFilter = materialFilter === value ? "Todos" : value;
  if(group === "color")    colorFilter    = colorFilter === value ? "Todos" : value;
  renderGrid();
  updateFilterBar();
  renderFilterSheet();
}

function renderGrid(){
  const list = filteredProducts();
  noResults.style.display = list.length ? "none" : "block";

  // Barra de resultados: conteo + limpiar filtros (#7)
  const n = list.length;
  resultsBar.innerHTML = `
    <span class="results-count">${n} ${n===1 ? "prenda" : "prendas"}</span>
    ${anyFilterActive() ? `<button class="clear-filters" id="clearFilters">Limpiar filtros ${icon("x", { size: 13 })}</button>` : ""}`;

  grid.innerHTML = list.map(p => {
    const avail = unitsAvailable(p);
    // Alquilada ≠ "en tu carrito": la del carrito sigue siendo tuya y se pinta
    // normal, solo la que está fuera se apaga.
    const fuera = isRented(p.id);
    const btn = inCart(p.id)
      ? `<button class="add-btn in-cart" data-add="${p.id}">${icon("check", { size: 14 })} En carrito</button>`
      : avail > 0
        // "Agregar al carrito" y no "+ Alquilar": el botón no cierra ningún
        // trato, solo aparta la prenda, y en la feria hubo quien no lo pulsó
        // por miedo a estar alquilando ahí mismo.
        ? `<button class="add-btn" data-add="${p.id}">${icon("cart", { size: 14 })} Agregar al carrito</button>`
        : `<button class="add-btn" disabled>No disponible</button>`;
    return `
    <div class="card${fuera ? " card-off" : ""}">
      <div class="thumb" data-detail="${p.id}">
        ${imgPlaceholder(p)}
        ${fuera ? `<span class="off-tag" style="z-index:3">No disponible</span>` : ""}
        <span class="cond-tag" style="z-index:2">${conditionLabel(p.stars)}</span>
        <span class="size-tag" style="z-index:2">Talla ${escapeHTML(p.size)}</span>
      </div>
      <div class="card-body">
        <div class="card-name" data-detail="${p.id}" role="button" tabindex="0" aria-label="Ver detalle de ${escapeHTML(p.name)}">${escapeHTML(p.name)}</div>
        <div class="card-meta"><span>${escapeHTML(p.cat)}</span><span class="cm-dot">·</span><span class="cm-mat">${icon("layers", { size: 12 })} ${escapeHTML(materialLabel(p.material))}</span></div>
        <div class="quality">${qualityMeter(p.stars)}<small>${conditionLabel(p.stars)}</small></div>
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
/**
 * Agrega una prenda al carrito y acusa recibo.
 * @param {number} id Prenda a agregar.
 * @param {Element} [origin] Miniatura de la que sale la animación. El vuelo se
 *   mide ANTES de repintar la grilla: el repintado destruye ese nodo, y sin la
 *   medida tomada a tiempo el fantasma saldría desde la esquina de la página.
 */
function addToCart(id, origin){
  if(inCart(id)){ toast("Ya está en tu carrito"); return; }
  if(isRented(id)){ toast("Ya la tienes alquilada"); renderGrid(); return; }
  cart.push({ id });
  saveState();
  updateBadge();
  // El vuelo sale antes del repintado; si no llegó a lanzarse (sin origen, con
  // menos movimiento, o en un navegador sin la API) el badge se sacude solo,
  // para que el acuse de recibo nunca dependa del adorno.
  if(!flyToCart(origin)) bumpBadge();
  renderGrid();
  toast("Agregada al carrito");
}

/* ---------------- Detalle de prenda ---------------- */
/**
 * Abre el detalle de una prenda. Si encima hay una vista a pantalla completa
 * (el perfil), sube en la pestaña APILADA sin tocar el panel de abajo, que
 * conserva su scroll; desde el catálogo usa el panel principal de siempre.
 * La clase `show` es el único registro de si el panel está arriba: `view`
 * conserva su último valor aunque el usuario haya cerrado el panel.
 */
function openDetail(id){
  detailId = id;
  detailImg = 0;                     // cada prenda se abre por su portada
  stackedDetail = FULL_VIEWS.has(view) && sheet.classList.contains("show");
  if(stackedDetail){ renderDetail(); openStackSheet(); return; }
  view = "detail";
  renderSheet();
  openSheet();
}

/**
 * Deja `detailImg` dentro del rango de fotos de la prenda abierta.
 * Se recorta al leer y no al escribir porque la lista puede cambiar bajo los
 * pies: hydrateCatalog() sustituye el catálogo entero mientras el detalle
 * está abierto.
 * @param {object} p Prenda abierta.
 * @returns {number} Índice válido de la foto visible.
 */
function galleryIndex(p){
  const total = productImages(p).length;
  return Math.min(Math.max(detailImg, 0), total - 1);
}

/**
 * Galería del detalle: la foto actual, las flechas y los puntos.
 *
 * Con una sola foto no dibuja ningún control — no hay nada que recorrer, y unas
 * flechas que no llevan a ninguna parte son peores que su ausencia. Solo se
 * monta la imagen visible: precargar las demás multiplicaría el peso de la
 * vista por el número de fotos sin que nadie las haya pedido.
 * @param {object} p Prenda abierta.
 * @returns {string} HTML de la galería.
 */
function galleryHTML(p){
  const fotos = productImages(p);
  const i = galleryIndex(p);
  if(fotos.length < 2) return `<div class="detail-img">${imgPlaceholder(p, fotos[0])}</div>`;

  const flecha = (dir, nombre, etiqueta) => `
    <button class="gal-nav gal-${dir}" data-action="gal${nombre}" aria-label="${etiqueta}">
      ${icon(dir === "prev" ? "chevronLeft" : "chevronRight", { size: 20 })}
    </button>`;
  const puntos = fotos.map((_, n) => `
    <button class="gal-dot${n === i ? " on" : ""}" data-action="galDot" data-i="${n}"
            aria-label="Foto ${n + 1} de ${fotos.length}"
            aria-current="${n === i ? "true" : "false"}"></button>`).join("");

  return `
    <div class="detail-img gallery" data-gallery="${p.id}">
      ${imgPlaceholder(p, fotos[i])}
      ${flecha("prev", "Prev", "Foto anterior")}
      ${flecha("next", "Next", "Foto siguiente")}
      <span class="gal-count">${i + 1} / ${fotos.length}</span>
    </div>
    <div class="gal-dots">${puntos}</div>`;
}

/**
 * Mueve la galería `paso` fotos y repinta. Da la vuelta en los extremos: en un
 * carrusel corto, toparse con una flecha muerta se siente roto.
 * @param {number} paso -1 (anterior) o +1 (siguiente).
 */
function moveGallery(paso){
  const p = productById(detailId);
  if(!p) return;
  const total = productImages(p).length;
  detailImg = (galleryIndex(p) + paso + total) % total;
  renderDetail();
}

/**
 * Salta a una foto concreta (los puntos).
 * @param {number} i Índice de la foto.
 */
function showGalleryImage(i){
  const p = productById(detailId);
  if(!p) return;
  detailImg = Math.min(Math.max(Number(i) || 0, 0), productImages(p).length - 1);
  renderDetail();
}

/**
 * Bloque de reseñas del detalle: media, conteo y la lista.
 *
 * Aquí SÍ se usan estrellas: son la valoración de clientes, que es lo que una
 * estrella significa para todo el mundo. La calidad de la prenda tiene su
 * medidor propio (qualityMeter) justo por esta convivencia.
 * @param {object} p Prenda abierta.
 * @returns {string} HTML del bloque.
 */
function reviewsHTML(p){
  const rs = productReviews(p.id);
  if(!rs.length){
    return `<div class="reviews">
        <div class="rev-head"><h3>Reseñas</h3></div>
        <p class="rev-empty">Todavía no tiene reseñas. Si la alquilas, podrás dejar la primera.</p>
      </div>`;
  }
  const media = productRating(p.id);
  const item = r => `
    <div class="review">
      <div class="rev-top">
        <span class="rev-author">${escapeHTML(r.author || profile.name || "Tú")}</span>
        <span class="rev-date">${fmtDate(r.date)}</span>
      </div>
      <div class="rev-stars">${starStr(r.rating)}</div>
      ${r.text ? `<p class="rev-text">${escapeHTML(r.text)}</p>` : ""}
      ${r.photo ? `<img class="rev-photo" src="${escapeHTML(r.photo)}" alt="Foto de la reseña" loading="lazy">` : ""}
    </div>`;
  return `
    <div class="reviews">
      <div class="rev-head">
        <h3>Reseñas</h3>
        <span class="rev-avg">${starStr(Math.round(media))}
          <b>${media.toFixed(1)}</b> <small>(${rs.length})</small></span>
      </div>
      ${rs.map(item).join("")}
    </div>`;
}

/**
 * Pinta el detalle de la prenda en la superficie que toque: la pestaña
 * apilada (sobre el perfil) o el panel principal, según `stackedDetail`.
 */
function renderDetail(){
  const p = productById(detailId);
  const [body, foot] = stackedDetail ? [stackBody, stackFoot] : [sheetBody, sheetFoot];
  // El título de la pestaña apilada es fijo en el HTML: solo muestra detalle.
  if(!stackedDetail) sheetTitle.textContent = "Detalle";
  body.innerHTML = `
    ${galleryHTML(p)}
    <div class="detail-head">
      <div>
        <div class="detail-name">${escapeHTML(p.name)}</div>
        <div class="detail-cat">${escapeHTML(p.cat)}</div>
      </div>
      <div class="detail-price">$${rentalPrice(p, 1).toFixed(2)}<span>1er día</span></div>
    </div>
    <div class="detail-quality">${qualityMeter(p.stars)}<small>${conditionLabel(p.stars)}</small></div>
    <p class="detail-desc">${escapeHTML(p.desc)}</p>
    <div class="detail-facts">
      <div class="fact"><div class="k">Talla</div><div class="v">${escapeHTML(p.size)}</div></div>
      <div class="fact"><div class="k">Material</div><div class="v">${escapeHTML(materialLabel(p.material))}</div></div>
      ${p.color ? `<div class="fact"><div class="k">Color</div><div class="v"><span class="color-dot" style="background:${colorSwatch(p.color)}"></span> ${escapeHTML(colorLabel(p.color))}</div></div>` : ""}
      <div class="fact"><div class="k">Calidad</div><div class="v qm-fact">${qualityMeter(p.stars)} ${p.stars}/5</div></div>
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
      ? `${icon("checkCircle", { size: 15 })} Disponible · ${p.disponibles} unidad${p.disponibles===1?'':'es'} (prenda única)`
      : isRented(p.id)
        ? `${icon("ban", { size: 15 })} No disponible por el momento`
        : `${icon("ban", { size: 15 })} Ya está en tu carrito (prenda única)`}</p>
    ${reviewsHTML(p)}`;

  if(isRented(p.id)){
    // Misma acción en ambas superficies: apilado el perfil ya está debajo y
    // basta bajar la pestaña, de ahí que el texto diga "volver" y no "ver".
    foot.innerHTML = `<button class="pay-btn" data-action="goProfile">${stackedDetail
      ? "Volver a mis pedidos"
      : `Ver mis pedidos ${icon("arrowRight", { size: 16 })}`}</button>`;
  } else if(inCart(p.id)){
    foot.innerHTML = `<button class="pay-btn" data-action="goCart">Ver carrito ${icon("arrowRight", { size: 16 })}</button>`;
  } else {
    foot.innerHTML = `<button class="pay-btn" data-action="addDetail">Agregar al carrito · desde $${rentalPrice(p, 1).toFixed(2)}</button>`;
  }
}
