/* ============================================================
   CLOTH TO GO · data.js
   Datos del negocio, catálogo y helpers de presentación.
   Estas variables/funciones son globales y las consumen los
   módulos state/dom/catalog/checkout/profile/main.
   ============================================================ */

/* ---- Local físico único y tarifa de envío ---- */
const LOCAL = {
  nombre: "Local CLOTH TO GO · Centro",
  direccion: "Av. 9 de Octubre 1234, Guayaquil",
  horario: "Lun–Sáb · 10:00–20:00"
};
const SHIPPING_FEE = 4.50;

/* ---- Devolución tardía ---- */
const LATE_GRACE_DAYS = 3;     // días hábiles de gracia tras la fecha límite
const LATE_PENALTY = 15.00;    // penalización si no se devuelve dentro de la gracia

/* ============================================================
   MODELO DE PRECIOS
   ============================================================
   El precio de alquiler se calcula; NO se guarda por prenda. Se guarda
   `value` (lo que costaría reponer la prenda en Ecuador, segunda mano) y de
   ahí sale todo.

   Idea central: el coste de un alquiler es POR CICLO, no por día. Lavar,
   planchar, revisar y empacar cuesta lo mismo si la prenda estuvo fuera 1 día
   o 10. Por eso los días adicionales pueden abaratarse mucho sin perder
   dinero, y por eso existe un piso por debajo del cual ningún alquiler es
   rentable por corto que sea.

   Tarifa de cara al cliente (tramos sobre el valor de la prenda):
     día 1      → τ · value        (τ según calidad)
     días 2–3   → 50 % de τ · value  cada uno
     días 4–7   → 30 % de τ · value  cada uno
     días 8+    → 15 % de τ · value  cada uno
   …menos el descuento por volumen, y nunca por debajo del piso de coste. */

/* ---- Coste real de un ciclo de alquiler ---- */

// Coste de acondicionar la prenda entre un alquiler y el siguiente (USD,
// precios de lavandería en Guayaquil). Lana y cuero piden lavado en seco o
// tratamiento especial, de ahí la diferencia con el algodón.
const LAUNDRY_BY_MATERIAL = { algodon:1.50, sintetico:1.50, lino:2.50, lana:5.00, cuero:3.00 };

// Empaque, transporte interno y provisión por merma/no devolución, por ciclo.
const OVERHEAD_PER_CYCLE = 0.50;

// Ciclos de alquiler que le quedan a una prenda por cada estrella de calidad.
// Una prenda de 5★ aguanta ~30 alquileres antes de retirarse; una de 2★, ~12.
const CYCLES_PER_STAR = 6;

// Margen sobre coste que debe dejar cualquier alquiler, por corto que sea.
const MIN_MARGIN = 0.35;

/**
 * Ciclos de alquiler que le quedan a la prenda antes de retirarla del catálogo.
 * Sobre este número se amortiza su valor de reposición.
 */
function garmentCycles(p){ return CYCLES_PER_STAR * p.stars; }

/**
 * Coste de un alquiler para el negocio, sin importar cuántos días dure:
 * amortización de la prenda + lavandería + gastos fijos del ciclo.
 * @returns {number} USD por ciclo.
 */
function cycleCost(p){
  const laundry = LAUNDRY_BY_MATERIAL[p.material] ?? LAUNDRY_BY_MATERIAL.algodon;
  return p.value / garmentCycles(p) + laundry + OVERHEAD_PER_CYCLE;
}

/* ---- Tarifa de cara al cliente ---- */

// Porcentaje del valor de la prenda que se cobra el primer día, según calidad.
// Una prenda gastada se cobra más barata: le quedan menos ciclos y el cliente
// asume su desgaste visible.
const DAY1_RATE_BY_STARS = { 5:0.10, 4:0.08, 3:0.06, 2:0.06, 1:0.06 };

// Peso de cada día adicional respecto al primero, por tramos. Alquilar dos
// semanas no puede costar catorce veces un día: el coste del negocio apenas
// crece con el tiempo (ver cycleCost), así que el precio tampoco debe hacerlo.
const DAY_TRAMOS = [
  { hasta: 3,        peso: 0.50 },  // días 2–3
  { hasta: 7,        peso: 0.30 },  // días 4–7
  { hasta: Infinity, peso: 0.15 },  // días 8 en adelante
];

const VOLUME_DISCOUNT_PER_ITEM = 0.05;  // 5% menos por cada prenda adicional
const VOLUME_DISCOUNT_MAX      = 0.20;  // tope: hasta 20%

/**
 * Descuento por alquilar varias prendas a la vez. Existe porque el producto
 * real no es una prenda suelta sino un conjunto: las prendas baratas solo
 * salen rentables acompañadas (chocan contra el piso de coste por sí solas).
 * @param {number} itemCount Prendas en el pedido.
 * @returns {number} Tasa entre 0 y VOLUME_DISCOUNT_MAX.
 */
function volumeDiscountRate(itemCount){
  const extra = Math.max(0, itemCount - 1);
  return Math.min(extra * VOLUME_DISCOUNT_PER_ITEM, VOLUME_DISCOUNT_MAX);
}

/**
 * Precio de lista por `days` días, antes de descuentos y del piso de coste.
 * @returns {number} USD.
 */
function rentalListPrice(p, days){
  const day1 = (DAY1_RATE_BY_STARS[p.stars] ?? 0.06) * p.value;
  let total = day1;
  for(let d = 2; d <= days; d++){
    total += day1 * DAY_TRAMOS.find(t => d <= t.hasta).peso;
  }
  return total;
}

/**
 * Precio mínimo al que se puede alquilar la prenda sin perder dinero.
 * @returns {number} USD.
 */
function rentalFloor(p){ return cycleCost(p) * (1 + MIN_MARGIN); }

/**
 * Precio final de alquilar una prenda: tramos por día, menos el descuento por
 * volumen, con el piso de coste como suelo duro.
 * @param {object} p Prenda del catálogo.
 * @param {number} days Días de alquiler (mínimo 1).
 * @param {number} [itemCount=1] Prendas del pedido, para el descuento.
 * @returns {number} USD con 2 decimales.
 */
function rentalPrice(p, days, itemCount = 1){
  const d = Math.max(1, days);
  const listed = rentalListPrice(p, d) * (1 - volumeDiscountRate(itemCount));
  return Math.round(Math.max(listed, rentalFloor(p)) * 100) / 100;
}

/**
 * Cuánto sube el precio al añadir un día más al alquiler mínimo. Puede ser 0:
 * en las prendas ancladas a su piso de coste los primeros días extra no
 * encarecen nada, y eso conviene decirlo en la tarjeta.
 * @returns {number} USD del segundo día.
 */
function nextDayPrice(p){ return Math.round((rentalPrice(p, 2) - rentalPrice(p, 1)) * 100) / 100; }

/* ---- Depósito de garantía ----
   Cubre el riesgo de no recuperar la prenda, así que se deriva de su valor y
   NO baja por volumen: más prendas es más riesgo, no menos. El tope existe
   porque inmovilizar más de eso espanta al cliente aunque sea reembolsable;
   por encima del tope el riesgo se cubrirá con pre-autorización de tarjeta. */
const DEPOSIT_RATE      = 0.40;   // 40% del valor de reposición
const DEPOSIT_MAX       = 25;     // tope por prenda, en USD
const DEPOSIT_ORDER_MAX = 40;     // tope por pedido, en USD

/**
 * Depósito reembolsable de una prenda, derivado de su valor de reposición.
 * @returns {number} USD redondeado a dólares enteros.
 */
function depositFor(p){ return Math.min(Math.round(DEPOSIT_RATE * p.value), DEPOSIT_MAX); }

/**
 * Depósito de un pedido completo, con tope propio: un pedido de cinco prendas
 * no es cinco veces más probable de no volver que uno de una, y pasado cierto
 * monto el depósito espanta al cliente aunque se le devuelva entero.
 * @param {Array<object>} items Prendas del pedido.
 * @returns {number} USD.
 */
function depositForItems(items){
  const sum = items.reduce((s, p) => s + depositFor(p), 0);
  return Math.min(sum, DEPOSIT_ORDER_MAX);
}

/* ---- Ahorro de agua por reutilización (moda circular) ----
   Fabricar ropa NUEVA consume enormes cantidades de agua: riego del cultivo
   de la fibra + teñido + acabado. Al ALQUILAR ropa de segunda mano (reutilizada)
   se evita producir una prenda nueva, así que el cliente "ahorra" esa huella
   hídrica de producción.

   El ahorro de cada prenda depende de DOS factores reales:
     1) el material principal (intensidad hídrica, litros por kg de tejido), y
     2) el peso de la prenda (más tela = más agua).

   Litros de agua por KG de tejido acabado, según el material (promedios de
   estudios de huella hídrica — Water Footprint Network / WWF):
     · Algodón : ~10.000 L/kg (cultivo muy intensivo en riego + teñido).
     · Lana    : ~11.000 L/kg (incluye agua de cría del animal).
     · Cuero   : ~17.000 L/kg (curtido muy intensivo en agua).
     · Lino    :  ~2.900 L/kg (el lino necesita mucho menos riego).
     · Sintético: ~120 L/kg (poliéster: huella hídrica baja).
   Referencia de validación: una camiseta de algodón (~0,25 kg) ≈ 2.700 L
   (0,25 × 10.000 ≈ 2.500–2.700 L), cifra reconocida por WWF. */
const WATER_PER_KG = {
  algodon:   10000,
  lana:      11000,
  cuero:     17000,
  lino:       2900,
  sintetico:   120,
};
// Nombre legible de cada material (para etiquetas y filtro).
const MATERIAL_LABELS = { algodon:"Algodón", lana:"Lana", cuero:"Cuero", lino:"Lino", sintetico:"Sintético" };
const materialLabel = m => MATERIAL_LABELS[m] || m;

const LITERS_PER_GALLON = 3.785;   // 1 galón (US) = 3,785 litros

// Litros de agua ahorrados al reutilizar UNA prenda (no fabricarla nueva):
//   litros = peso_kg × intensidad_hídrica_del_material
function garmentWater(p){
  const intensity = WATER_PER_KG[p.material] ?? WATER_PER_KG.algodon;
  return Math.round((p.weightKg || 0) * intensity);
}
// Litros → galones (US), redondeado.
function litersToGallons(liters){ return Math.round(liters / LITERS_PER_GALLON); }
// Formatea litros con separador de miles (es-EC): 8000 → "8.000".
function fmtLiters(liters){ return Math.round(liters).toLocaleString("es-EC"); }

/* ---- Categorías para los filtros ---- */
const CATS = ["Todo", "Formal", "Fiesta", "Casual", "Invierno"];

/* ---- Catálogo ----
   Las imágenes son URLs de internet (Unsplash) de PRENDAS solas (sin personas).
   Si alguna no carga (onerror), se muestra el placeholder de imgPlaceholder().
   - value       : coste de reponer la prenda en Ecuador, segunda mano (USD).
                   Es la base de TODO el precio: el alquiler sale de rentalPrice()
                   y el depósito de depositFor(). No hay precio fijo por prenda.
   - stars       : calidad / desgaste (1 a 5). Además de informar al cliente,
                   define cuántos alquileres le quedan a la prenda (garmentCycles).
   - size        : talla de la prenda
   - disponibles : unidades en stock. Al ser ropa de segunda mano, cada prenda
                   es única: normalmente 1 (no hay varias instancias, colores ni modelos).
   - material    : fibra principal (algodon/lana/cuero/lino/sintetico) → intensidad hídrica.
   - weightKg    : peso aproximado de la prenda. material + weightKg definen el
                   ahorro de agua por reutilizarla (ver garmentWater()). */
const IMG = "?w=600&h=800&fit=crop&q=70&auto=format";
const PRODUCTS = [
  { id:1, name:"Blazer de lino", cat:"Formal", value:35, stars:5, size:"M",  disponibles:1, material:"lino",      weightKg:0.5, img:"https://images.unsplash.com/photo-1592343516109-362f7bd871aa"+IMG,
    desc:"Blazer de lino fresco, corte recto. Ideal para eventos formales y de oficina." },
  { id:2, name:"Vestido de gala", cat:"Fiesta", value:45, stars:4, size:"S",  disponibles:1, material:"sintetico", weightKg:0.4, img:"https://images.unsplash.com/photo-1604531825858-a8e24ed6b43d"+IMG,
    desc:"Vestido largo de gala con caída elegante. Perfecto para bodas y galas." },
  { id:3, name:"Jeans vintage", cat:"Casual", value:15, stars:3, size:"M",  disponibles:1, material:"algodon",   weightKg:0.8, img:"https://images.unsplash.com/photo-1542272604-787c3835535d"+IMG,
    desc:"Jeans de tiro alto estilo retro. Cómodos para el día a día." },
  { id:4, name:"Abrigo de lana", cat:"Invierno", value:55, stars:5, size:"L",  disponibles:1, material:"lana",      weightKg:1.2, img:"https://images.unsplash.com/photo-1539533113208-f6df8cc8b543"+IMG,
    desc:"Abrigo de lana cálido y de gran caída. Abriga sin perder estilo." },
  { id:5, name:"Camisa formal", cat:"Formal", value:14, stars:4, size:"M",  disponibles:1, material:"algodon",   weightKg:0.2, img:"https://images.unsplash.com/photo-1621773881532-fe65715b5137"+IMG,
    desc:"Camisa formal de algodón, fácil de combinar para reuniones." },
  { id:6, name:"Falda plisada", cat:"Casual", value:12, stars:3, size:"S",  disponibles:1, material:"sintetico", weightKg:0.3, img:"https://images.unsplash.com/photo-1715233749622-3216fe49e682"+IMG,
    desc:"Falda plisada midi, ligera y versátil para cualquier ocasión." },
  { id:7, name:"Esmoquin clásico", cat:"Fiesta", value:150, stars:5, size:"L",  disponibles:1, material:"lana",      weightKg:1.0, img:"https://images.unsplash.com/photo-1585412459272-762fb93357c3"+IMG,
    desc:"Esmoquin negro clásico con solapa satinada. La opción para eventos de etiqueta." },
  { id:8, name:"Chaqueta de cuero", cat:"Casual", value:45, stars:2, size:"M",  disponibles:1, material:"cuero",     weightKg:1.3, img:"https://images.unsplash.com/photo-1727515546577-f7d82a47b51d"+IMG,
    desc:"Chaqueta de cuero con carácter; muestra desgaste natural que le da estilo." },
  { id:9, name:"Sudadera bordada", cat:"Casual", value:12, stars:4, size:"L",  disponibles:1, material:"algodon",   weightKg:0.5, img:"https://images.unsplash.com/photo-1620799140188-3b2a02fd9a77"+IMG,
    desc:"Sudadera de algodón con bordado, súper cómoda para el día a día." },
  { id:10, name:"Gabardina beige", cat:"Invierno", value:40, stars:4, size:"XL", disponibles:1, material:"algodon",   weightKg:0.9, img:"https://images.unsplash.com/photo-1534702718617-c141fb9f99d0"+IMG,
    desc:"Gabardina beige atemporal, perfecta para días de lluvia y entretiempo." },
];

/* Tallas disponibles en el catálogo, en orden lógico (para el filtro). */
const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL"];
const SIZES = SIZE_ORDER.filter(s => PRODUCTS.some(p => p.size === s));

/* Materiales presentes en el catálogo, en orden lógico (para el filtro). */
const MATERIAL_ORDER = ["algodon", "lana", "lino", "cuero", "sintetico"];
const MATERIALS = MATERIAL_ORDER.filter(m => PRODUCTS.some(p => p.material === m));

/* ---- Programa de puntos ----
   Premios canjeables con los puntos acumulados (cost = puntos requeridos). */
const REWARDS = [
  { id:1, icon:"🚚", cost:60,  name:"Envío o retiro gratis",        desc:"Un envío a domicilio o retiro sin costo en tu próximo alquiler." },
  { id:2, icon:"🎟️", cost:100, name:"1 día de alquiler gratis",     desc:"Te regalamos un día en el período de tu próximo alquiler." },
  { id:3, icon:"🏷️", cost:150, name:"10% de descuento",             desc:"10% de descuento sobre el subtotal de tu próximo alquiler." },
  { id:4, icon:"👑", cost:300, name:"Prenda premium 2 días gratis", desc:"Alquila una prenda destacada por 2 días sin costo." },
];

/* Índice id → producto para acceso O(1) (evita PRODUCTS.find repetido). */
const PRODUCT_BY_ID = new Map(PRODUCTS.map(p => [p.id, p]));
function productById(id){ return PRODUCT_BY_ID.get(id); }

/* ---- Helpers de presentación ---- */

// Escapa texto del usuario antes de inyectarlo en innerHTML (anti-XSS).
// Sirve tanto para contenido como para valores de atributos (escapa comillas).
function escapeHTML(s){
  return String(s ?? "").replace(/[&<>"']/g, ch => (
    { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]
  ));
}

/* ---- Validaciones de formularios (reutilizables) ---- */
const isValidEmail   = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim());
const isValidPhone   = v => /^[0-9]{7,15}$/.test(String(v).trim());   // solo dígitos, 7–15
const isValidName    = v => String(v).trim().length >= 2;
const isValidAddress = v => String(v).trim().length >= 6;             // calle + número, etc.
const isValidCardNumber = v => /^[0-9]{13,19}$/.test(String(v).replace(/\s+/g, ""));  // 13–19 dígitos
const isValidExpiry  = v => /^(0[1-9]|1[0-2])\/\d{2}$/.test(String(v).trim());        // MM/AA
const isValidCvv     = v => /^[0-9]{3,4}$/.test(String(v).trim());

// Etiqueta de desgaste/calidad según las estrellas.
const conditionLabel = s => ({5:"Como nuevo",4:"Excelente",3:"Buen estado",2:"Usado",1:"Muy usado"}[s] || "");

// Estrellas llenas/vacías como texto.
function starStr(n){ return "★".repeat(n) + "☆".repeat(5-n); }

// Formatea una fecha "YYYY-MM-DD" a algo legible (ej: "16 jun").
function fmtDate(iso){
  if(!iso) return "—";
  const meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  const [y,m,d] = iso.split("-").map(Number);
  return `${d} ${meses[m-1]}`;
}

// Días de alquiler entre dos fechas ISO (mínimo 1).
function daysBetween(startISO, endISO){
  if(!startISO || !endISO) return 1;
  const ms = new Date(endISO) - new Date(startISO);
  return Math.max(1, Math.round(ms / 86400000));
}

// HTML de una imagen con placeholder de respaldo.
// Si la imagen no carga (onerror), se oculta y queda visible el placeholder.
function imgPlaceholder(p){
  return `<span class="img-ph">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <circle cx="8.5" cy="8.5" r="1.6"/>
        <path d="M21 16l-5-5L5 21"/>
      </svg>
      <span class="ph-txt">${escapeHTML(p.name)}</span>
    </span>
    <img src="${escapeHTML(p.img)}" alt="${escapeHTML(p.name)}" loading="lazy"
         onerror="this.style.display='none'">`;
}
