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

/* ---- Categorías para los filtros ---- */
const CATS = ["Todo", "Formal", "Fiesta", "Casual", "Invierno"];

/* ---- Catálogo ----
   Las imágenes son URLs de internet (Unsplash) de PRENDAS solas (sin personas).
   Si alguna no carga (onerror), se muestra el placeholder de imgPlaceholder().
   - price       : precio de alquiler por día (USD)
   - deposit     : depósito de garantía reembolsable (USD)
   - stars       : calidad / desgaste (1 a 5)
   - size        : talla de la prenda
   - disponibles : unidades en stock. Al ser ropa de segunda mano, cada prenda
                   es única: normalmente 1 (no hay varias instancias, colores ni modelos). */
const IMG = "?w=600&h=800&fit=crop&q=70&auto=format";
const PRODUCTS = [
  { id:1, name:"Blazer de lino",   cat:"Formal",  price:0.99, deposit:25, stars:5, size:"M",  disponibles:1, img:"https://images.unsplash.com/photo-1592343516109-362f7bd871aa"+IMG,
    desc:"Blazer de lino fresco, corte recto. Ideal para eventos formales y de oficina." },
  { id:2, name:"Vestido de gala",  cat:"Fiesta",  price:1.49, deposit:20, stars:4, size:"S",  disponibles:1, img:"https://images.unsplash.com/photo-1604531825858-a8e24ed6b43d"+IMG,
    desc:"Vestido largo de gala con caída elegante. Perfecto para bodas y galas." },
  { id:3, name:"Jeans vintage",    cat:"Casual",  price:0.49, deposit:15, stars:3, size:"M",  disponibles:1, img:"https://images.unsplash.com/photo-1542272604-787c3835535d"+IMG,
    desc:"Jeans de tiro alto estilo retro. Cómodos para el día a día." },
  { id:4, name:"Abrigo de lana",   cat:"Invierno",price:1.19, deposit:25, stars:5, size:"L",  disponibles:1, img:"https://images.unsplash.com/photo-1539533113208-f6df8cc8b543"+IMG,
    desc:"Abrigo de lana cálido y de gran caída. Abriga sin perder estilo." },
  { id:5, name:"Camisa formal",    cat:"Formal",  price:0.69, deposit:18, stars:4, size:"M",  disponibles:1, img:"https://images.unsplash.com/photo-1621773881532-fe65715b5137"+IMG,
    desc:"Camisa formal de algodón, fácil de combinar para reuniones." },
  { id:6, name:"Falda plisada",    cat:"Casual",  price:0.49, deposit:15, stars:3, size:"S",  disponibles:1, img:"https://images.unsplash.com/photo-1715233749622-3216fe49e682"+IMG,
    desc:"Falda plisada midi, ligera y versátil para cualquier ocasión." },
  { id:7, name:"Esmoquin clásico", cat:"Fiesta",  price:4.99, deposit:35, stars:5, size:"L",  disponibles:1, img:"https://images.unsplash.com/photo-1585412459272-762fb93357c3"+IMG,
    desc:"Esmoquin negro clásico con solapa satinada. La opción para eventos de etiqueta." },
  { id:8, name:"Chaqueta de cuero",cat:"Casual",  price:1.29, deposit:30, stars:2, size:"M",  disponibles:1, img:"https://images.unsplash.com/photo-1727515546577-f7d82a47b51d"+IMG,
    desc:"Chaqueta de cuero con carácter; muestra desgaste natural que le da estilo." },
  { id:9, name:"Sudadera bordada", cat:"Casual",  price:0.39, deposit:10, stars:4, size:"L",  disponibles:1, img:"https://images.unsplash.com/photo-1620799140188-3b2a02fd9a77"+IMG,
    desc:"Sudadera de algodón con bordado, súper cómoda para el día a día." },
  { id:10,name:"Gabardina beige",  cat:"Invierno",price:0.99, deposit:28, stars:4, size:"XL", disponibles:1, img:"https://images.unsplash.com/photo-1534702718617-c141fb9f99d0"+IMG,
    desc:"Gabardina beige atemporal, perfecta para días de lluvia y entretiempo." },
];

/* Tallas disponibles en el catálogo, en orden lógico (para el filtro). */
const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL"];
const SIZES = SIZE_ORDER.filter(s => PRODUCTS.some(p => p.size === s));

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
      <span class="ph-txt">${p.name}</span>
    </span>
    <img src="${p.img}" alt="${p.name}" loading="lazy"
         onerror="this.style.display='none'">`;
}
