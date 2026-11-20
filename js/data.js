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

/* Qué modos de entrega y devolución llevan cargo logístico. La regla vivía
   escrita a mano en seis sitios (el carrito, el pedido guardado y las dos
   cuentas del premio de envío); un tercer modo de entrega obligaba a
   encontrarlos todos y el que se olvidara cobraría de menos en silencio. */

/**
 * Cargo por RECIBIR el pedido. Solo el envío a domicilio cuesta: retirarlo en
 * el local no mueve a nadie.
 * @param {string} delivery Modo de entrega del pedido (`ship`|`pickup`).
 * @returns {number} USD.
 */
function deliveryFeeFor(delivery){ return delivery === DELIVERY.SHIP ? SHIPPING_FEE : 0; }

/**
 * Cargo por DEVOLVER el pedido. Solo el retiro a domicilio cuesta.
 * @param {string} ret Modo de devolución del pedido (`home`|`store`).
 * @returns {number} USD.
 */
function returnFeeFor(ret){ return ret === RETURN_TO.HOME ? SHIPPING_FEE : 0; }

/* ---- Vocabulario del pedido ----
   Los cuatro juegos de valores que un pedido guarda en crudo y que media app
   comparaba a mano. Lo que ganan al estar aquí es un sitio ÚNICO donde leer qué
   valores existen: antes había que reconstruirlo grepeando cadenas por seis
   archivos. Lo que NO ganan, y conviene no creérselo: protección contra erratas.
   En JS `DELIVERY.SHIPP` vale `undefined` y la comparación falla tan callada
   como `"shipp"`; eso solo lo atrapa un compilador que aquí no hay.

   Tres homónimos que NO son este vocabulario y por eso siguen siendo literales:
   - Los nombres de icono: `icon("store")`, `icon("cash")`. Otro catálogo.
   - Los nombres de clase CSS: `.pay-status.settled`, `.date-total.pending`.
     Coinciden con el valor porque derivan de él, pero viven en el CSS.
   - `pickerTarget` en maps.js, que vale "ship" | "return": es el CAMPO de
     dirección que recibe el punto del mapa, no el modo de entrega. Comparte la
     cadena por casualidad y su pareja es "return", no "pickup". */
const DELIVERY     = Object.freeze({ SHIP: "ship", PICKUP: "pickup" });   // cómo RECIBE el pedido
const RETURN_TO    = Object.freeze({ HOME: "home", STORE: "store" });     // cómo lo DEVUELVE (y cómo dona)
const ORDER_STATUS = Object.freeze({ SETTLED: "settled", PENDING: "pending", CANCELLED: "cancelled" });
const PAY_METHOD   = Object.freeze({ CASH: "cash", CREDIT: "credit", DEBIT: "debit" });

/* ---- Calendario del negocio y ventanas de devolución (§6.0) ----
   Sustituyen a los días de gracia y a la multa fija: no hay retiros ni
   devoluciones en fin de semana ni feriado, y quien retira de lunes a miércoles
   devuelve hasta el viernes (jueves o viernes → hasta el lunes) sin costo
   extra. Los días cerrados llegan de GET /api/config (hydrateCalendar); sin API
   se cierran solo los fines de semana. La regla es copia de server/src/dates.js
   y test/ventanas-paridad.test.js vigila que no se separen. */
const businessCalendar = { closedWeekdays: [0, 6], holidays: new Set() };

/** Adopta el calendario que sirve la API (días cerrados y feriados). */
function setBusinessCalendar(cfg){
  if(!cfg) return;
  if(Array.isArray(cfg.closedWeekdays)) businessCalendar.closedWeekdays = cfg.closedWeekdays.slice();
  if(Array.isArray(cfg.holidays)) businessCalendar.holidays = new Set(cfg.holidays.map(h => h.date));
  if(typeof cfg.shippingFee === "number") pricingTexts.shippingFee = cfg.shippingFee;
  if(typeof cfg.volumeDiscountMax === "number") pricingTexts.volumeDiscountMax = cfg.volumeDiscountMax;
}
/** Día de la semana de una fecha `YYYY-MM-DD` (0 = domingo), sin zona horaria. */
function weekdayISO(iso){
  const [y,m,d] = iso.split("-").map(Number);
  return new Date(y, m-1, d).getDay();
}
/** ¿Atiende el local ese día? Ni fin de semana ni feriado. */
function isBusinessDayISO(iso){
  return !businessCalendar.closedWeekdays.includes(weekdayISO(iso)) && !businessCalendar.holidays.has(iso);
}
/** El mismo día si es hábil; si no, el siguiente que lo sea. */
function nextBusinessDayISO(iso){
  let d = iso;
  for(let i = 0; i < 30 && !isBusinessDayISO(d); i++) d = addDaysISO(d, 1);
  return d;
}
/** Cierre de la ventana sin costo extra para un retiro (o entrega) en `start`. */
function returnWindowCloseISO(start){
  const dow = weekdayISO(start);
  const salto = dow >= 1 && dow <= 3 ? 5 - dow : dow >= 4 && dow <= 5 ? 8 - dow : (8 - dow) % 7 + 4;
  return nextBusinessDayISO(addDaysISO(start, salto));
}
/** Fecha límite de devolución: la ventana solo extiende, nunca acorta. */
function returnByISO(start, end){
  const cierre = returnWindowCloseISO(start);
  return end > cierre ? end : cierre;
}

/* ============================================================
   PRECIOS: los pone el servidor (fase 3)
   ============================================================
   El modelo de precios (tramos por día, volumen, piso de coste, garantía)
   vive SOLO en server/src/pricing.js. La API devuelve con cada prenda su
   escalera de 1 a 14 días (`p.price`) y `POST /api/quote` cotiza el carrito
   (ver `quote` en state.js). Aquí solo se lee lo que llegó; con el catálogo
   embebido (sin API) no hay precio que enseñar, y tampoco se puede alquilar.
   ============================================================ */

/** Textos de tarifas que llegan de GET /api/config (envío, volumen máximo). */
const pricingTexts = { shippingFee: SHIPPING_FEE, volumeDiscountMax: 0.20 };

/**
 * Precio de una prenda suelta por `days` días, según la API, o null si el
 * catálogo no trae precios (embebido, sin conexión).
 * @param {object} p Prenda.
 * @param {number} days Días (1 a 14; más allá se usa el último tramo).
 * @returns {number|null} USD.
 */
function catalogPrice(p, days){
  const ladder = p && p.price && p.price.ladder;
  if(!Array.isArray(ladder) || !ladder.length) return null;
  const d = Math.max(1, days);
  if(d <= ladder.length) return ladder[d - 1];
  // Pasados los 14 días cada día extra cuesta lo mismo que el último tramo.
  const ultimo = ladder[ladder.length - 1] - ladder[ladder.length - 2];
  return Math.round((ladder[ladder.length - 1] + ultimo * (d - ladder.length)) * 100) / 100;
}
/** Lo que añade el segundo día a una prenda, o null sin precios. */
function catalogNextDay(p){ return p && p.price ? p.price.nextDay : null; }
/** Garantía de una prenda suelta, o null sin precios. */
function catalogDeposit(p){ return p && p.price ? p.price.deposit : null; }
/**
 * Importe listo para pintar: "$12.50", o "—" cuando todavía no se sabe (sin
 * API, o mientras llega la cotización).
 * @param {number|null|undefined} usd Importe.
 * @returns {string}
 */
function money(usd){ return typeof usd === "number" && Number.isFinite(usd) ? `$${usd.toFixed(2)}` : "—"; }
/** Precio por día de un importe de `d` días; null si el importe no se sabe. */
function perDay(usd, d){ return usd === null || usd === undefined ? null : usd / Math.max(1, d); }
/** Suma de importes; null si alguno todavía no se sabe. */
function sumOrNull(...usds){ return usds.some(v => v === null || v === undefined) ? null : usds.reduce((s, v) => s + v, 0); }
/** Clave para ordenar por precio del primer día (sin precio, como gratis: al principio). */
function sortPrice(p){ return catalogPrice(p, 1) ?? 0; }

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

/* ---- Metas de ahorro de agua ----
   El contador de litros no decía nada por sí solo: un número grande sin escala
   no deja saber si está bien o mal. Las metas le ponen un techo visible y
   premian llegar, que es lo que convierte el dato ambiental en un motivo para
   volver a alquilar.

   Los umbrales se calibran sobre el catálogo real: una prenda ahorra ~7.200 L
   de media, así que la primera meta cae con el primer alquiler y la última
   exige constancia. Los puntos se miden contra REWARDS (60–300 pts): una meta
   rinde, pero no regala el catálogo de premios. */
const WATER_GOALS = [
  { id: 1, liters:   5000, points:  50, name: "Primer ahorro" },
  { id: 2, liters:  20000, points: 150, name: "Ahorro constante" },
  { id: 3, liters:  50000, points: 400, name: "Impacto real" },
  { id: 4, liters: 100000, points: 900, name: "Leyenda circular" },
];

/* ---- Categorías para los filtros ----
   Disfraces y Calzado son categorías DEMOSTRATIVAS: enseñan que el catálogo no
   se agota en la ropa de vestir, que en la feria hubo que explicar de palabra
   una y otra vez. El calzado además obliga al catálogo a admitir dos escalas de
   talla distintas (ver SIZE_SCALES). */
const CATS = ["Todo", "Formal", "Fiesta", "Casual", "Invierno", "Disfraces", "Calzado"];

/* ---- Catálogo ----
   Las imágenes se sirven localmente desde img/products/ (webp optimizado ~600×800).
   Alojarlas en el repo evita la dependencia de red de Unsplash: cargan también
   en file:// y offline. Si alguna falta (onerror), queda el placeholder de imgPlaceholder().
   - imgs        : lista de fotos, de la portada a la última. La PRIMERA es la que
                   sale en tarjeta, carrito y pedidos; el resto solo en el detalle.
                   Una sola foto es válido: la galería no dibuja controles.
                   Convención de nombres: N.webp para la portada y N-2, N-3… para
                   las demás, de modo que añadir fotos no toca más que esta lista.
   - value       : coste de reponer la prenda en Ecuador, segunda mano (USD).
                   Es la base de TODO el precio: el alquiler sale de rentalPrice()
                   y el depósito de depositFor(). No hay precio fijo por prenda.
   - stars       : calidad / desgaste (1 a 5). Además de informar al cliente,
                   define cuántos alquileres le quedan a la prenda (garmentCycles).
   - size        : talla de la prenda
   - color       : color dominante de la prenda, tomado de la FOTO y no del
                   nombre (la "gabardina beige" es el único caso en que ambos
                   coinciden). Es una sola clave del banco COLOR_LABELS —el más
                   cercano si el tono exacto no está—: el cliente filtra por el
                   color que recuerda haber visto, no por la carta de tonos del
                   fabricante.
   - disponibles : unidades en stock. Al ser ropa de segunda mano, cada prenda
                   es única: normalmente 1 (no hay varias instancias, colores ni modelos).
   - material    : fibra principal (algodon/lana/cuero/lino/sintetico) → intensidad hídrica.
   - weightKg    : peso aproximado de la prenda. material + weightKg definen el
                   ahorro de agua por reutilizarla (ver garmentWater()). */
const PRODUCTS = [
  { id:1, name:"Blazer de lino", cat:"Formal", value:35, stars:5, size:"M",  color:"negro",  disponibles:1, material:"lino",      weightKg:0.5, imgs:["img/products/1.webp", "img/products/1-2.webp", "img/products/1-3.webp"],
    desc:"Blazer de lino fresco, corte recto. Ideal para eventos formales y de oficina." },
  { id:2, name:"Vestido de gala", cat:"Fiesta", value:45, stars:4, size:"S",  color:"blanco", disponibles:1, material:"sintetico", weightKg:0.4, imgs:["img/products/2.webp", "img/products/2-2.webp", "img/products/2-3.webp"],
    desc:"Vestido largo de gala con caída elegante. Perfecto para bodas y galas." },
  { id:3, name:"Jeans vintage", cat:"Casual", value:15, stars:3, size:"M",  color:"azul",   disponibles:1, material:"algodon",   weightKg:0.8, imgs:["img/products/3.webp"],
    desc:"Jeans de tiro alto estilo retro. Cómodos para el día a día." },
  { id:4, name:"Abrigo de lana", cat:"Invierno", value:55, stars:5, size:"L",  color:"beige",  disponibles:1, material:"lana",      weightKg:1.2, imgs:["img/products/4.webp"],
    desc:"Abrigo de lana cálido y de gran caída. Abriga sin perder estilo." },
  { id:5, name:"Camisa formal", cat:"Formal", value:14, stars:4, size:"M",  color:"blanco", disponibles:1, material:"algodon",   weightKg:0.2, imgs:["img/products/5.webp"],
    desc:"Camisa formal de algodón, fácil de combinar para reuniones." },
  { id:6, name:"Falda plisada", cat:"Casual", value:12, stars:3, size:"S",  color:"beige",  disponibles:1, material:"sintetico", weightKg:0.3, imgs:["img/products/6.webp"],
    desc:"Falda plisada midi, ligera y versátil para cualquier ocasión." },
  { id:7, name:"Esmoquin clásico", cat:"Fiesta", value:150, stars:5, size:"L",  color:"negro",  disponibles:1, material:"lana",      weightKg:1.0, imgs:["img/products/7.webp", "img/products/7-2.webp", "img/products/7-3.webp"],
    desc:"Esmoquin negro clásico con solapa satinada. La opción para eventos de etiqueta." },
  { id:8, name:"Chaqueta de cuero", cat:"Casual", value:45, stars:2, size:"M",  color:"negro",  disponibles:1, material:"cuero",     weightKg:1.3, imgs:["img/products/8.webp"],
    desc:"Chaqueta de cuero con carácter; muestra desgaste natural que le da estilo." },
  { id:9, name:"Sudadera bordada", cat:"Casual", value:12, stars:4, size:"L",  color:"blanco", disponibles:1, material:"algodon",   weightKg:0.5, imgs:["img/products/9.webp"],
    desc:"Sudadera de algodón con bordado, súper cómoda para el día a día." },
  { id:10, name:"Gabardina beige", cat:"Invierno", value:40, stars:4, size:"XL", color:"beige",  disponibles:1, material:"algodon",   weightKg:0.9, imgs:["img/products/10.webp"],
    desc:"Gabardina beige atemporal, perfecta para días de lluvia y entretiempo." },
  // Disfraces y calzado: piezas de muestra de las dos categorías nuevas. Como
  // el resto del catálogo, el `color` sale de la FOTO y no del nombre.
  { id:11, name:"Traje de catrina", cat:"Disfraces", value:30, stars:4, size:"M",  color:"beige",  disponibles:1, material:"sintetico", weightKg:0.6, imgs:["img/products/11.webp"],
    desc:"Vestido y tocado de catrina, con bordado floral. Para Día de Muertos y fiestas de disfraces." },
  { id:12, name:"Capa con capucha", cat:"Disfraces", value:18, stars:5, size:"L",  color:"rojo",   disponibles:1, material:"sintetico", weightKg:0.3, imgs:["img/products/12.webp"],
    desc:"Capa larga con capucha y cierre al cuello. Ligera y de talla generosa; sirve de caperucita, vampiro o cuento a elección." },
  { id:13, name:"Vestido de época", cat:"Disfraces", value:48, stars:4, size:"S",  color:"blanco", disponibles:1, material:"algodon",   weightKg:0.9, imgs:["img/products/13.webp"],
    desc:"Vestido largo de inspiración victoriana, con botonadura en la espalda y encaje en puños y cuello." },
  { id:14, name:"Botines de cuero", cat:"Calzado", value:40, stars:4, size:"39", color:"negro",  disponibles:1, material:"cuero",     weightKg:1.1, imgs:["img/products/14.webp"],
    desc:"Botines de caña baja en cuero, con cordones y suela de goma. Combinan con todo." },
  { id:15, name:"Tacones de fiesta", cat:"Calzado", value:25, stars:5, size:"37", color:"negro",  disponibles:1, material:"sintetico", weightKg:0.6, imgs:["img/products/15.webp"],
    desc:"Tacón de aguja de 8 cm, punta fina. Cómodos para una noche entera de pie." },
  { id:16, name:"Zapatos oxford", cat:"Calzado", value:35, stars:3, size:"42", color:"negro",  disponibles:1, material:"cuero",     weightKg:1.2, imgs:["img/products/16.webp"],
    desc:"Oxford clásicos de cuero con acabado pulido. El complemento del traje formal." },
];

/* ---- Tallas ----
   Dos escalas, no una: el calzado se numera (EU 35–44) y la ropa se letrea, y
   mezclarlas en una sola lista daría un filtro donde "M" y "39" cuelgan del
   mismo renglón como si fueran comparables. La escala se deduce de la talla
   —numérica ⇒ calzado— y no de la categoría: un disfraz puede traer botas, y
   entonces la prenda manda sobre el estante donde está colgada. */
const SIZE_SCALES = [
  { id: "ropa",    label: "Ropa",    order: ["XS", "S", "M", "L", "XL", "XXL"] },
  { id: "calzado", label: "Calzado", order: ["35", "36", "37", "38", "39", "40", "41", "42", "43", "44"] },
];
const SIZE_ORDER = SIZE_SCALES.flatMap(e => e.order);
const SIZES = SIZE_ORDER.filter(s => PRODUCTS.some(p => p.size === s));

/**
 * A qué escala pertenece una talla. Devuelve "ropa" para lo que no sea
 * numérico: es el caso por defecto del catálogo y el que no debe romperse si
 * llega una talla desconocida de la API.
 * @param {string} size Talla tal como la declara la prenda.
 * @returns {string} `ropa` | `calzado`
 */
const sizeScale = size => /^\d+$/.test(String(size ?? "")) ? "calzado" : "ropa";

/**
 * Tallas presentes en el catálogo dentro de una escala, en su orden lógico.
 * Alimenta los dos bloques del filtro; vacío = esa escala no se dibuja.
 * @param {string} scale Id de la escala (`ropa`|`calzado`).
 * @returns {string[]}
 */
const sizesInScale = scale =>
  (SIZE_SCALES.find(e => e.id === scale)?.order || []).filter(s => SIZES.includes(s));

/* Materiales presentes en el catálogo, en orden lógico (para el filtro). */
const MATERIAL_ORDER = ["algodon", "lana", "lino", "cuero", "sintetico"];
const MATERIALS = MATERIAL_ORDER.filter(m => PRODUCTS.some(p => p.material === m));

/* ---- Colores ----
   Banco FIJO de colores comunes, en orden de neutros → cálidos → fríos. A
   diferencia de SIZES y MATERIALS, esta lista NO se recorta a lo que hay en el
   catálogo: es de donde se elige al dar de alta una prenda, y ofrecerla entera
   es lo que evita que cada prenda nueva estrene su propia clave ("azul marino"
   junto a "azul" son dos colores que el filtro ya no sabe juntar). Si el tono
   real no está, se asigna el más cercano.

   El precio de mostrarlos todos es que algunos no tengan prendas; por eso el
   filtro anuncia el conteo de cada uno (ver colorCount()) en vez de dejar que
   se descubra con la pantalla vacía.

   El hex NO es el color exacto de la tela, sino su muestra en la interfaz: los
   tonos reales de una foto (un negro que es gris carbón, un beige que tira a
   rosa) se confunden entre sí al tamaño de un punto. */
const COLOR_LABELS = {
  negro:    "Negro",
  gris:     "Gris",
  blanco:   "Blanco",
  beige:    "Beige",
  cafe:     "Café",
  rojo:     "Rojo",
  naranja:  "Naranja",
  amarillo: "Amarillo",
  verde:    "Verde",
  turquesa: "Turquesa",
  celeste:  "Celeste",
  azul:     "Azul",
  morado:   "Morado",
  rosa:     "Rosa",
};
const COLOR_HEX = {
  negro:    "#1e1e1e",
  gris:     "#9aa0a6",
  blanco:   "#f6f5f1",
  beige:    "#d8c3a0",
  cafe:     "#6d4a2f",
  rojo:     "#c0392b",
  naranja:  "#e07b2c",
  amarillo: "#e3c355",
  verde:    "#4a7c59",
  turquesa: "#3fb8ad",
  celeste:  "#7fc4e8",
  azul:     "#33609c",
  morado:   "#7b5ea7",
  rosa:     "#e2a0bb",
};
const COLORS = Object.keys(COLOR_LABELS);

/**
 * Cuántas prendas del catálogo son de un color. Alimenta la etiqueta del filtro:
 * como el desplegable ofrece el banco completo, el conteo es lo que distingue
 * "no hay prendas de ese color" de "el filtro no funciona".
 * @param {string} c Clave del color.
 * @returns {number}
 */
const colorCount = c => PRODUCTS.filter(p => p.color === c).length;

/* ---- Taxonomía de la API (fase 3) ----
   Categorías, tallas, materiales y colores son DATOS en la base (los editará el
   panel en la fase 4) y llegan por GET /api/taxonomy. Las listas de arriba son
   el respaldo para el catálogo embebido, sin API. Al llegar la taxonomía se
   rellenan EN SU SITIO (mismos arreglos y objetos, contenido nuevo): así siguen
   siendo `const` y todo lo que ya las lee —los filtros de la app y de la web—
   se entera sin cambiar de referencia. */

/**
 * Vacía un objeto y le copia otro, conservando la referencia.
 * @param {object} destino Objeto a rellenar.
 * @param {object} origen Contenido nuevo.
 */
function replaceInPlace(destino, origen){
  for(const k of Object.keys(destino)) delete destino[k];
  Object.assign(destino, origen);
}

/**
 * Recalcula las listas que dependen del catálogo cargado (tallas y materiales
 * presentes). Antes se calculaban una sola vez al cargar el archivo y se
 * quedaban con el catálogo embebido aunque llegara otro de la API.
 */
function refreshCatalogLists(){
  SIZES.splice(0, SIZES.length, ...SIZE_ORDER.filter(sz => PRODUCTS.some(p => p.size === sz)));
  MATERIALS.splice(0, MATERIALS.length, ...MATERIAL_ORDER.filter(m => PRODUCTS.some(p => p.material === m)));
}

/**
 * Adopta la taxonomía de GET /api/taxonomy: categorías (por nombre, que es lo
 * que trae cada prenda en `cat`), tallas por escala, materiales y colores con
 * su muestra. Una lista vacía o ausente deja la de respaldo.
 * @param {object} tax Respuesta de la API.
 */
function applyTaxonomy(tax){
  if(!tax) return;
  if(Array.isArray(tax.categories) && tax.categories.length){
    CATS.splice(0, CATS.length, "Todo", ...tax.categories.map(c => c.name));
  }
  if(Array.isArray(tax.sizes) && tax.sizes.length){
    const escalas = [];
    for(const t of tax.sizes){
      const id = String(t.scale).toLowerCase();
      let e = escalas.find(x => x.id === id);
      if(!e){
        const previa = SIZE_SCALES.find(x => x.id === id);
        e = { id, label: previa ? previa.label : id.charAt(0).toUpperCase() + id.slice(1), order: [] };
        escalas.push(e);
      }
      e.order.push(t.label);
    }
    SIZE_SCALES.splice(0, SIZE_SCALES.length, ...escalas);
    SIZE_ORDER.splice(0, SIZE_ORDER.length, ...escalas.flatMap(e => e.order));
  }
  if(Array.isArray(tax.materials) && tax.materials.length){
    MATERIAL_ORDER.splice(0, MATERIAL_ORDER.length, ...tax.materials.map(m => m.key));
    replaceInPlace(MATERIAL_LABELS, Object.fromEntries(tax.materials.map(m => [m.key, m.name])));
  }
  if(Array.isArray(tax.colors) && tax.colors.length){
    replaceInPlace(COLOR_LABELS, Object.fromEntries(tax.colors.map(c => [c.key, c.name])));
    // La muestra va a un atributo style: solo se acepta un hex de verdad.
    replaceInPlace(COLOR_HEX, Object.fromEntries(tax.colors
      .filter(c => /^#[0-9a-f]{3,8}$/i.test(c.hex || "")).map(c => [c.key, c.hex])));
    COLORS.splice(0, COLORS.length, ...tax.colors.map(c => c.key));
  }
  refreshCatalogLists();
}

/**
 * Nombre legible de un color; devuelve la clave tal cual si es desconocida
 * (una prenda que llegue del backend con un color que el front no conoce se
 * sigue mostrando, en vez de quedarse sin etiqueta) y cadena vacía si no trae
 * ninguno — un catálogo hidratado por una API vieja no debe reventar la
 * búsqueda, que llama a .toLowerCase() sobre este valor.
 * @param {string} c Clave del color.
 * @returns {string}
 */
const colorLabel = c => COLOR_LABELS[c] || c || "";

/**
 * Muestra (hex) con la que se pinta la pastilla de un color. Los desconocidos
 * caen en un gris neutro: es preferible una muestra apagada a un cuadro
 * transparente que parezca un fallo de carga.
 * @param {string} c Clave del color.
 * @returns {string} Color CSS.
 */
const colorSwatch = c => COLOR_HEX[c] || "#c9cdc6";

/* ---- Reseñas de muestra ----
   ⚠️ BORRAR CUANDO HAYA BACKEND. Estas reseñas NO son de nadie: existen solo
   para que el bloque del detalle no se vea vacío en la demostración. Se retiran
   vaciando esta constante — `productReviews()` las mezcla al vuelo, así que no
   hay nada más que limpiar y no tocan el localStorage de ningún usuario.

   Van marcadas con `demo:true`, de modo que el día de la migración se pueden
   distinguir de las reales con una comprobación, no a ojo. Tampoco se pueden
   editar ni borrar desde la interfaz: no pertenecen a la sesión.

   Se reparten por categorías distintas para que se vea el bloque en varias
   prendas, y una lleva foto (la segunda del propio catálogo) para enseñar cómo
   queda una reseña con imagen. */
const DEMO_REVIEWS = [
  { id:"demo-1", productId:1,  rating:5, author:"Camila V.", date:"2026-07-12",
    text:"Impecable. Lo usé para una boda y el corte cae muy bien; llegó planchado y sin una sola mancha.",
    photo:"img/products/1-2.webp", demo:true },
  { id:"demo-2", productId:2,  rating:4, author:"Doménica R.", date:"2026-07-05",
    text:"El vestido es precioso y la caída es real, como en las fotos. Le doy 4 porque me quedó algo largo, pero eso es cosa mía.",
    demo:true },
  { id:"demo-3", productId:7,  rating:5, author:"Sebastián M.", date:"2026-06-28",
    text:"Alquilar el esmoquin me costó menos que la corbata que compré aparte. Volvería sin dudarlo.",
    demo:true },
  { id:"demo-4", productId:4,  rating:4, author:"Andrés L.", date:"2026-06-20",
    text:"Abrigo calientito y en muy buen estado. La devolución en el local tomó dos minutos.",
    demo:true },
  { id:"demo-5", productId:10, rating:3, author:"Paula E.", date:"2026-06-14",
    text:"Cumple, pero la gabardina tiene algo de uso en los puños. Se avisa en la ficha, así que sin sorpresas.",
    demo:true },
];

/* ---- Programa de puntos ----
   Premios canjeables con los puntos acumulados (cost = puntos requeridos).
   `type` decide cómo se traduce el premio a dinero en rewardDiscount(); los
   ids se mantienen estables porque quedan grabados en los canjes guardados. */
const REWARDS = [
  { id:1, type:"shipping",    icon:"truck",  cost:60,  name:"Envío o retiro gratis",        desc:"Un envío a domicilio o retiro sin costo en tu próximo alquiler." },
  { id:2, type:"freeDay",     icon:"ticket", cost:100, name:"1 día de alquiler gratis",     desc:"Te regalamos un día en el período de tu próximo alquiler." },
  { id:3, type:"percent",     icon:"tag",    cost:150, name:"10% de descuento",             desc:"10% de descuento sobre el subtotal de tu próximo alquiler.", rate:0.10 },
  { id:4, type:"premiumDays", icon:"crown",  cost:300, name:"Prenda premium 2 días gratis", desc:"Alquila una prenda destacada por 2 días sin costo.", days:2, minStars:5 },
];

/* Premio por id, para resolver un canje guardado (que solo almacena rewardId). */
const REWARD_BY_ID = new Map(REWARDS.map(r => [r.id, r]));
function rewardById(id){ return REWARD_BY_ID.get(id); }

/* El valor de un premio en un alquiler lo calcula el servidor
   (server/src/rewards.js); el checkout lo recibe en la cotización. REWARDS
   queda aquí solo para pintar nombres, costes y descripciones, y
   test/premios-paridad.test.js vigila que coincida con el del servidor. */

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

/* ---- Contacto: proveedores de correo aceptados ----
   Solo se admiten buzones de proveedor conocido. El motivo no es capricho: la
   cuenta se verifica por correo y por SMS, y un dominio propio o desechable deja
   sin destinatario real la recuperación de cuenta y las notificaciones del
   alquiler. Las variantes regionales (.es, .com.ec) entran porque en Ecuador
   hotmail.es y outlook.es son buzones corrientes, no rarezas.
   Es una LISTA, no un patrón: aceptar un proveedor nuevo es añadir una línea. */
const ALLOWED_EMAIL_DOMAINS = [
  "gmail.com",
  "outlook.com", "outlook.es", "outlook.com.ec",
  "hotmail.com", "hotmail.es", "hotmail.com.ec",
  "yahoo.com",   "yahoo.es",   "yahoo.com.ec",
  "live.com"
];

/** Dominio de un correo, en minúsculas y sin espacios. "" si no hay arroba. */
const emailDomain = v => String(v).trim().toLowerCase().split("@")[1] || "";

/** ¿El correo es de un proveedor de la lista blanca? */
const isAllowedEmailDomain = v => ALLOWED_EMAIL_DOMAINS.includes(emailDomain(v));

/**
 * Correo de contacto: bien formado **y** de un proveedor aceptado.
 * Se separa de isValidEmail() a propósito — el formulario necesita distinguir
 * "esto no es un correo" de "este proveedor no nos sirve", que son dos errores
 * con dos arreglos distintos para quien los lee.
 */
const isValidContactEmail = v => isValidEmail(v) && isAllowedEmailDomain(v);

/* ---- Contacto: celular de Ecuador ---- */

// Prefijo país. Es fijo y no editable: la app opera solo en Guayaquil.
const PHONE_COUNTRY_CODE = "+593";
const PHONE_NATIONAL_LEN = 10;

/**
 * Celular ecuatoriano en formato nacional: `09` + 8 dígitos, 10 en total.
 *
 * "Empieza con 0 y tiene 10 dígitos" solo puede ser un móvil: los fijos de
 * Ecuador son 9 dígitos (`0[2-7]` + 7), así que exigir el `9` no restringe nada
 * legítimo y sí atrapa el error habitual de escribir el fijo en el campo de
 * celular. El `0` es un prefijo de marcación nacional y no viaja al extranjero
 * (ver phoneToE164).
 */
const isValidEcPhone = v => /^09\d{8}$/.test(String(v).trim());

/**
 * Celular nacional → E.164 para el SMS de verificación (`+5939XXXXXXXX`).
 * El `0` inicial se cae: es prefijo de marcación interna, no parte del número.
 * @returns {string} Número internacional, o "" si el nacional no es válido.
 */
function phoneToE164(v){
  const s = String(v).trim();
  return isValidEcPhone(s) ? PHONE_COUNTRY_CODE + s.slice(1) : "";
}

/* ---- Contacto: enfriamiento del cambio de nombre ----
   El nombre viaja en los pedidos y es lo que ve quien entrega la prenda:
   cambiarlo a diario convierte la entrega en una discusión de identidad. Se
   permite fijarlo al registrarse y después una vez por semana. */
const NAME_CHANGE_DAYS = 7;
const isValidAddress = v => String(v).trim().length >= 6;             // calle + número, etc.
const isValidCardNumber = v => /^[0-9]{13,19}$/.test(String(v).replace(/\s+/g, ""));  // 13–19 dígitos
const isValidExpiry  = v => /^(0[1-9]|1[0-2])\/\d{2}$/.test(String(v).trim());        // MM/AA
const isValidCvv     = v => /^[0-9]{3,4}$/.test(String(v).trim());

// Etiqueta de desgaste/calidad según las estrellas.
// Describe la prenda, no su procedencia: "Usado"/"Muy usado" contaba de dónde
// viene en vez de cómo está, y en alquiler el desgaste es normal, no un defecto
// que confesar. La escala sigue siendo honesta — 2 y 1 no disimulan el uso.
const conditionLabel = s => ({5:"Como nuevo",4:"Excelente",3:"Buen estado",2:"Con carácter",1:"Muy vivida"}[s] || "");

// Estrellas llenas/vacías como texto.
// Reservadas para las RESEÑAS de clientes (feature futura). La calidad de la
// prenda ya no las usa: ver qualityMeter().
function starStr(n){ return "★".repeat(n) + "☆".repeat(5-n); }

// Recorta la calidad al rango válido; un `stars` fuera de 1–5 (o ausente) no
// debe pintar un medidor roto.
const qualityLevel = n => Math.max(0, Math.min(5, Math.round(Number(n) || 0)));

/**
 * Medidor de calidad: cinco pastillas, llenas hasta el nivel de la prenda.
 *
 * Sustituye a las ★ porque una estrella significa "valoración de usuarios" para
 * cualquiera que haya comprado algo por internet, y esto es lo contrario: lo
 * fija el negocio al catalogar la prenda, y de ello depende la tarifa del
 * primer día. Con las reseñas en camino, tener las dos cosas dibujadas igual
 * pasaba de confuso a incorrecto.
 * @param {number} n Calidad de la prenda (`stars`, 1–5).
 * @returns {string} HTML del medidor, con etiqueta accesible.
 */
function qualityMeter(n){
  const nivel = qualityLevel(n);
  const seg = i => `<i class="qm-seg${i < nivel ? " on" : ""}"></i>`;
  return `<span class="qmeter" role="img" aria-label="Calidad ${nivel} de 5">`
       + [0,1,2,3,4].map(seg).join("") + "</span>";
}

/**
 * El mismo medidor en texto plano, para donde no cabe HTML.
 *
 * Para superficies sin HTML (texto plano, `<option>` de un desplegable nativo,
 * un `aria-label`). El panel de filtros ya no lo usa —dibuja el medidor de
 * verdad—, pero cualquier salida en texto lo sigue necesitando. Va siempre
 * acompañado de la etiqueta en palabras: si la fuente no trae estos glifos, el
 * texto sigue diciendo lo mismo.
 * @param {number} n Calidad de la prenda (`stars`, 1–5).
 * @returns {string} Cinco pastillas, p. ej. "▰▰▰▱▱".
 */
function qualityMeterText(n){
  const nivel = qualityLevel(n);
  return "▰".repeat(nivel) + "▱".repeat(5 - nivel);
}

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

/* ---- Aritmética de calendario ----
   Todo se hace partiendo el ISO a mano en vez de con Date: `new Date("2026-08-01")`
   se interpreta en UTC y en Guayaquil (UTC−5) retrocede al día anterior. Es el
   mismo motivo por el que existe isoOffset() en lugar de toISOString(). */

const MESES_LARGOS = ["enero","febrero","marzo","abril","mayo","junio",
                      "julio","agosto","septiembre","octubre","noviembre","diciembre"];

/**
 * Suma días a una fecha ISO y devuelve otra ISO, sin pasar por husos horarios.
 * @param {string} iso Fecha "YYYY-MM-DD".
 * @param {number} n Días a sumar (puede ser negativo).
 * @returns {string} Fecha ISO resultante.
 */
function addDaysISO(iso, n){
  const [y,m,d] = iso.split("-").map(Number);
  const dt = new Date(y, m-1, d + n);   // constructor local, no UTC
  const p = v => String(v).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth()+1)}-${p(dt.getDate())}`;
}

/** Mes "YYYY-MM" al que pertenece una fecha ISO. */
function monthOf(iso){ return iso.slice(0, 7); }

/**
 * Desplaza un mes "YYYY-MM" en `n` meses.
 * @returns {string} Mes resultante en el mismo formato.
 */
function shiftMonth(ym, n){
  const [y,m] = ym.split("-").map(Number);
  const dt = new Date(y, m-1 + n, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}`;
}

/** Etiqueta legible de un mes "YYYY-MM" (ej: "agosto 2026"). */
function monthLabel(ym){
  const [y,m] = ym.split("-").map(Number);
  return `${MESES_LARGOS[m-1]} ${y}`;
}

/**
 * Celdas de la cuadrícula mensual, de lunes a domingo y en semanas completas.
 * Los huecos del principio y del final se rellenan con los días del mes vecino
 * (marcados `out`) en vez de con blancos: así el rango de alquiler se ve
 * continuo cuando cruza el cambio de mes.
 * @param {string} ym Mes "YYYY-MM".
 * @returns {Array<{iso:string, day:number, out:boolean}>} Múltiplo de 7 celdas.
 */
function monthGrid(ym){
  const [y,m] = ym.split("-").map(Number);
  const first = new Date(y, m-1, 1);
  // getDay() es 0=domingo; la semana local empieza en lunes.
  const lead = (first.getDay() + 6) % 7;
  const start = addDaysISO(`${ym}-01`, -lead);
  // SIEMPRE seis filas (42 días), aunque sobren.
  //
  // Antes se cortaba en cuanto una semana completa pasaba el fin de mes, y eso
  // escondía días que el cliente necesita: alquilando a fin de mes, la fecha de
  // devolución cae en el mes siguiente y podía quedar FUERA de la cuadrícula.
  // El 31 de julio de 2026, con el rango por defecto de 3 días, la rejilla
  // llegaba al 2 de agosto y la devolución era el 3: invisible e inseleccionable.
  //
  // Seis filas es además lo que hace cualquier calendario, así que la altura no
  // baila al cambiar de mes.
  const cells = [];
  for(let i = 0; i < 42; i++){
    const iso = addDaysISO(start, i);
    cells.push({ iso, day: Number(iso.slice(8)), out: monthOf(iso) !== ym });
  }
  return cells;
}

/**
 * Fotos de una prenda, siempre como lista y siempre con al menos un elemento.
 *
 * Normaliza en un solo sitio lo que puede llegar de tres sitios distintos: el
 * catálogo embebido (`imgs`), el backend (que serializa la lista) y una entrada
 * antigua con `img` suelto. Sin esto, cada vista tendría que repetir el mismo
 * `?.` defensivo y una sola omisión rompería la galería.
 * @param {object} p Prenda del catálogo.
 * @returns {string[]} Rutas de las fotos; `[""]` si no hay ninguna (deja el
 *   placeholder a la vista en lugar de romper el marcado).
 */
function productImages(p){
  const lista = Array.isArray(p?.imgs) ? p.imgs.filter(Boolean)
              : p?.img ? [p.img] : [];
  return lista.length ? lista : [""];
}

/** Foto de portada: la que sale en tarjeta, carrito y pedidos. */
function coverImage(p){ return productImages(p)[0]; }

// HTML de una imagen con placeholder de respaldo.
// Si la imagen no carga (onerror), se oculta y queda visible el placeholder.
// `src` permite pintar una foto concreta de la galería; por defecto, la portada.
function imgPlaceholder(p, src){
  const ruta = src === undefined ? coverImage(p) : src;
  return `<span class="img-ph">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <circle cx="8.5" cy="8.5" r="1.6"/>
        <path d="M21 16l-5-5L5 21"/>
      </svg>
      <span class="ph-txt">${escapeHTML(p.name)}</span>
    </span>
    <img src="${escapeHTML(ruta)}" alt="${escapeHTML(p.name)}" loading="lazy"
         onerror="this.style.display='none'">`;
}
