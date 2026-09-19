/* ============================================================
   CLOTH TO GO · web/js/catalog.js
   Catálogo del sitio: filtros, parrilla y ficha de la prenda.

   Los datos y el precio NO viven aquí: vienen de js/data.js y js/state.js,
   los mismos archivos que carga la app móvil. Esto es solo la vista de
   escritorio de ese catálogo (parrilla ancha + columna de filtros a la
   vista, en lugar del panel deslizante del teléfono).

   Los nombres renderGrid() y renderFilters() son deliberados: js/api.js
   los llama al hidratar el catálogo desde el backend, así que la web
   recibe la base de datos por el mismo camino que la app.
   ============================================================ */

/**
 * Corrige la ruta de una imagen del catálogo para esta carpeta.
 *
 * Las rutas de js/data.js ("img/products/1.webp") son relativas a la raíz del
 * proyecto, donde vive la app; la web cuelga un nivel más abajo. Las absolutas
 * (las que traerá el backend) se dejan intactas.
 * @param {string} src Ruta tal como la declara la prenda.
 * @returns {string} Ruta utilizable desde web/index.html.
 */
function webImg(src){
  if(!src) return "";
  return /^(https?:)?\/\//.test(src) || src.startsWith("/") ? src : `../${src}`;
}

/** Foto de portada de una prenda, ya resuelta para esta carpeta. */
function webCover(p){ return webImg(coverImage(p)); }

/* ---------------- Selección ----------------
   Mismo criterio que filteredProducts()/sortProducts() de js/catalog.js: los
   filtros viven en las variables de js/state.js, así que las dos superficies
   filtran igual. Se repite el cuerpo porque aquel archivo no puede cargarse
   aquí (pinta el teléfono); si cambia el criterio, cambia en los dos. */

/**
 * Ordena una lista de prendas según `sortBy`.
 * @param {Array<object>} list Prendas.
 * @returns {Array<object>} Copia ordenada (no muta el catálogo).
 */
function webSortProducts(list){
  const arr = list.slice();
  switch(sortBy){
    case "price-asc":  arr.sort((a,b) => rentalPrice(a,1) - rentalPrice(b,1)); break;
    case "price-desc": arr.sort((a,b) => rentalPrice(b,1) - rentalPrice(a,1)); break;
    case "stars-desc": arr.sort((a,b) => b.stars - a.stars || rentalPrice(a,1) - rentalPrice(b,1)); break;
    default: break;
  }
  return arr;
}

/**
 * Prendas que pasan la búsqueda y los filtros, con las alquiladas al final:
 * siguen en el escaparate (se pueden mirar y esperar), pero no se pueden
 * alquilar.
 * @returns {Array<object>}
 */
function webFilteredProducts(){
  const q = searchQuery.trim().toLowerCase();
  const list = PRODUCTS.filter(p =>
    (activeCat === "Todo" || p.cat === activeCat) &&
    (q === "" || p.name.toLowerCase().includes(q) || p.cat.toLowerCase().includes(q) ||
      p.desc.toLowerCase().includes(q) || colorLabel(p.color).toLowerCase().includes(q)) &&
    (p.stars >= qualityFilter) &&
    (sizeFilter === "Todas" || p.size === sizeFilter) &&
    (materialFilter === "Todos" || p.material === materialFilter) &&
    (colorFilter === "Todos" || p.color === colorFilter)
  );
  const orden = webSortProducts(list);
  return [...orden.filter(p => !isRented(p.id)), ...orden.filter(p => isRented(p.id))];
}

/** ¿Hay algún filtro puesto? Decide si se ofrece "Limpiar filtros". */
function webAnyFilter(){
  return activeCat !== "Todo" || searchQuery.trim() !== "" || qualityFilter > 0 ||
    sizeFilter !== "Todas" || materialFilter !== "Todos" || colorFilter !== "Todos";
}

/** Devuelve el catálogo a su estado inicial (sin tocar el orden elegido). */
function clearWebFilters(){
  activeCat = "Todo"; searchQuery = ""; qualityFilter = 0;
  sizeFilter = "Todas"; materialFilter = "Todos"; colorFilter = "Todos";
  const buscador = document.getElementById("searchInput");
  if(buscador) buscador.value = "";
  renderFilters();
  renderGrid();
}

/* ---------------- Filtros ---------------- */

/**
 * Una pastilla de filtro.
 * @param {string} accion Valor de data-action que la atiende.
 * @param {string} valor Valor de data-value que se aplicará.
 * @param {string} texto HTML de la etiqueta (puede traer la muestra de color).
 * @param {boolean} activa Si es la opción puesta ahora mismo.
 * @returns {string} HTML del botón.
 */
function chipHTML(accion, valor, texto, activa){
  return `<button class="chip${activa ? " on" : ""}" data-action="${accion}"
           data-value="${escapeHTML(String(valor))}">${texto}</button>`;
}

/**
 * Pinta la columna de filtros a partir de lo que hay en el catálogo. Las
 * tallas se agrupan por escala (ropa / calzado) porque "M" y "39" no se
 * comparan; los colores muestran su conteo, ya que el banco se ofrece entero
 * y sin el número no se distingue "no hay" de "no funciona".
 */
function renderFilters(){
  const panel = document.getElementById("filterPanel");
  if(!panel) return;

  const cats = CATS.map(c => chipHTML("cat", c, escapeHTML(c), activeCat === c)).join("");

  const calidad = [0,3,4,5]
    .map(n => chipHTML("quality", n, n === 0 ? "Todas" : `${qualityMeterText(n)}+`, qualityFilter === n))
    .join("");

  const tallas = SIZE_SCALES.map(escala => {
    const disponibles = sizesInScale(escala.id);
    if(!disponibles.length) return "";
    return `<div class="fgroup">
      <h3>Talla · ${escala.label}</h3>
      <div class="chips">${disponibles
        .map(s => chipHTML("size", s, escapeHTML(s), sizeFilter === s)).join("")}</div>
    </div>`;
  }).join("");

  const materiales = [chipHTML("material", "Todos", "Todos", materialFilter === "Todos")]
    .concat(MATERIALS.map(m => chipHTML("material", m, escapeHTML(materialLabel(m)), materialFilter === m)))
    .join("");

  const colores = [chipHTML("color", "Todos", "Todos", colorFilter === "Todos")]
    .concat(COLORS.filter(colorCount).map(c => chipHTML(
      "color", c,
      `<span class="dot" style="background:${colorSwatch(c)}"></span>${escapeHTML(colorLabel(c))} (${colorCount(c)})`,
      colorFilter === c,
    )))
    .join("");

  panel.innerHTML = `
    <div class="fgroup">
      <h3>Categoría</h3>
      <div class="chips">${cats}</div>
    </div>
    <div class="fgroup">
      <h3>Calidad mínima</h3>
      <div class="chips">${calidad}</div>
    </div>
    ${tallas ? `${tallas}` : ""}
    <div class="fgroup">
      <h3>Material</h3>
      <div class="chips">${materiales}</div>
    </div>
    <div class="fgroup">
      <h3>Color</h3>
      <div class="chips">${colores}</div>
    </div>
    ${webAnyFilter()
      ? `<button class="chip clear-filters" data-action="clearFilters">Limpiar filtros</button>`
      : ""}`;

  // La talla no tiene pastilla "Todas" por escala (serían dos "Todas" que se
  // pisan): se limpia desde aquí, junto al resto.
  if(sizeFilter !== "Todas" && !SIZES.includes(sizeFilter)) sizeFilter = "Todas";
}

/* ---------------- Parrilla ---------------- */

/**
 * Tarjeta de una prenda. Muestra el precio del PRIMER día, que es el que sirve
 * para comparar entre prendas; el total real depende de las fechas y sale en
 * el carrito.
 * @param {object} p Prenda del catálogo.
 * @returns {string} HTML de la tarjeta.
 */
function cardHTML(p){
  const alquilada = isRented(p.id);
  const enCarrito = inCart(p.id);
  const dia2 = nextDayPrice(p);
  const accion = alquilada
    ? `<span class="tag-out">Alquilada ahora</span>`
    : enCarrito
      ? `<button class="cta-btn add" data-action="openCart" disabled>En tu carrito</button>`
      : `<button class="cta-btn add" data-action="add" data-id="${p.id}">Añadir al carrito</button>`;
  return `
    <article class="card" data-action="detail" data-id="${p.id}"
             tabindex="0" aria-label="Ver la ficha de ${escapeHTML(p.name)}">
      <div class="ph">
        ${icon("shirt", { size: 40 })}
        <img src="${escapeHTML(webCover(p))}" alt="${escapeHTML(p.name)}" loading="lazy"
             onerror="this.style.display='none'">
      </div>
      <div class="body">
        <h3>${escapeHTML(p.name)}</h3>
        <div class="meta">
          <span>${escapeHTML(p.cat)}</span>·<span>Talla ${escapeHTML(p.size)}</span>
          <span>${qualityMeter(p.stars)}</span>
        </div>
        <div class="price">
          $${rentalPrice(p, 1).toFixed(2)} <small>el primer día${
            dia2 > 0 ? ` · +$${dia2.toFixed(2)} por día extra` : " · días extra sin costo"}</small>
        </div>
        ${accion}
      </div>
    </article>`;
}

/**
 * Repinta la parrilla y el contador de resultados. La llama js/api.js cuando
 * el catálogo llega del backend, además de cada cambio de filtro.
 */
function renderGrid(){
  const grid = document.getElementById("grid");
  const vacio = document.getElementById("noResults");
  const contador = document.getElementById("resultsCount");
  if(!grid) return;
  const lista = webFilteredProducts();
  grid.innerHTML = lista.map(cardHTML).join("");
  if(vacio) vacio.hidden = lista.length > 0;
  if(contador){
    contador.textContent = lista.length === 1 ? "1 prenda" : `${lista.length} prendas`;
  }
  updateFilterCount();
}

/**
 * Número de filtros puestos, en el botón que los abre. En pantalla estrecha el
 * panel está plegado: sin este contador no habría forma de saber que el
 * catálogo se está mostrando recortado.
 */
function updateFilterCount(){
  const el = document.getElementById("filterCount");
  if(!el) return;
  const n = [
    activeCat !== "Todo", qualityFilter > 0, sizeFilter !== "Todas",
    materialFilter !== "Todos", colorFilter !== "Todos",
  ].filter(Boolean).length;
  el.textContent = n;
  el.hidden = n === 0;
}

/* ---------------- Portada ---------------- */

/**
 * Rellena los datos que la portada y las secciones toman del catálogo: cuánto
 * se ahorra frente a comprar y cuánta agua se evita.
 *
 * Son cifras derivadas del catálogo, no texto escrito a mano: si mañana entran
 * prendas nuevas, la portada deja de mentir sola.
 */
function renderHeroFacts(){
  // Ahorro: lo que cuesta un fin de semana (3 días) frente a comprar la prenda.
  // Se anuncia el mejor caso con "hasta", que es lo que el dato soporta.
  const ahorro = document.getElementById("heroSaving");
  if(ahorro && PRODUCTS.length){
    const mejor = Math.max(...PRODUCTS.map(p => 1 - rentalPrice(p, 3) / p.value));
    ahorro.textContent = `Hasta ${Math.round(mejor * 100)}% menos`;
  }

  const agua = document.getElementById("aboutWater");
  if(agua && PRODUCTS.length){
    const media = PRODUCTS.reduce((s, p) => s + garmentWater(p), 0) / PRODUCTS.length;
    agua.textContent = `Alquilar una prenda evita fabricar una nueva: unos ${fmtLiters(media)} `
      + `litros de agua que no se gastan, de media por prenda del catálogo. Tu total lo llevas en la app.`;
  }
}

/**
 * Pinta la sección de contacto con los datos del local que ya viven en
 * js/data.js. No se escriben aquí a mano: son los mismos que la app enseña en
 * la entrega y la devolución, y tienen que decir lo mismo en los dos sitios.
 */
function renderContact(){
  const lista = document.getElementById("contactList");
  if(!lista) return;
  lista.innerHTML = `
    <li><b>${escapeHTML(LOCAL.nombre)}</b><span>${escapeHTML(LOCAL.direccion)}</span></li>
    <li><b>Horario</b><span>${escapeHTML(LOCAL.horario)}</span></li>
    <li><b>A domicilio</b><span>Entrega y retiro por $${SHIPPING_FEE.toFixed(2)} cada uno,
      dentro de la ciudad.</span></li>`;
  const pie = document.getElementById("footLocal");
  if(pie) pie.textContent = `${LOCAL.direccion} · ${LOCAL.horario}`;
}

/* ---------------- Ficha de la prenda ---------------- */

/**
 * Abre la ficha con la galería, las características y el ahorro de agua.
 * @param {number} id Id de la prenda.
 */
function openDetail(id){
  const p = productById(id);
  if(!p) return;
  detailId = id;
  detailImg = 0;
  renderDetail();
  openModal("detailModal");
}

/** Pinta (o repinta, al cambiar de foto) el contenido de la ficha. */
function renderDetail(){
  const caja = document.getElementById("detailBody");
  const p = productById(detailId);
  if(!caja || !p) return;
  const fotos = productImages(p);
  const alquilada = isRented(p.id);
  const litros = garmentWater(p);

  const miniaturas = fotos.length > 1
    ? `<div class="thumbs">${fotos.map((src, i) => `
        <img src="${escapeHTML(webImg(src))}" alt="Foto ${i + 1} de ${escapeHTML(p.name)}"
             class="${i === detailImg ? "on" : ""}" data-action="detailImg" data-value="${i}">`).join("")}</div>`
    : "";

  caja.innerHTML = `
    <div class="detail">
      <div class="gal">
        <img src="${escapeHTML(webImg(fotos[detailImg]))}" alt="${escapeHTML(p.name)}">
        ${miniaturas}
      </div>
      <div>
        <h2>${escapeHTML(p.name)}</h2>
        <p class="desc">${escapeHTML(p.desc)}</p>
        <ul class="specs">
          <li><span>Categoría</span><b>${escapeHTML(p.cat)}</b></li>
          <li><span>Talla</span><b>${escapeHTML(p.size)}</b></li>
          <li><span>Color</span><b>${escapeHTML(colorLabel(p.color))}</b></li>
          <li><span>Material</span><b>${escapeHTML(materialLabel(p.material))}</b></li>
          <li><span>Estado</span><b>${qualityMeter(p.stars)} ${escapeHTML(conditionLabel(p.stars))}</b></li>
          <li><span>1 día</span><b>$${rentalPrice(p, 1).toFixed(2)}</b></li>
          <li><span>3 días</span><b>$${rentalPrice(p, 3).toFixed(2)}</b></li>
          <li><span>7 días</span><b>$${rentalPrice(p, 7).toFixed(2)}</b></li>
          <li><span>Depósito reembolsable</span><b>$${depositFor(p).toFixed(2)}</b></li>
        </ul>
        <p class="water">${icon("droplet", { size: 16 })}
          Alquilarla evita fabricar una prenda nueva: ahorras
          <b>${fmtLiters(litros)} litros</b> de agua (${litersToGallons(litros)} galones).</p>
        <p class="note">El depósito se devuelve al entregar la prenda. El precio baja
          por día y por cantidad de prendas; el total exacto sale en tu carrito.</p>
        ${alquilada
          ? `<p class="note"><b>Esta prenda está alquilada ahora mismo.</b> Es una pieza única
             de segunda mano: vuelve a mirarla cuando termine el alquiler.</p>`
          : inCart(p.id)
            ? `<button class="cta-btn" data-action="openCart">Ya está en tu carrito · verlo</button>`
            : `<button class="cta-btn" data-action="add" data-id="${p.id}">Añadir al carrito</button>`}
      </div>
    </div>`;
}
