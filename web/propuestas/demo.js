/* ============================================================
   CLOTH TO GO · propuestas/demo.js
   Andamiaje común de las cinco maquetas de diseño.

   Las maquetas cargan ../../js/icons.js y ../../js/data.js: enseñan el
   catálogo y los PRECIOS REALES del prototipo, no texto de relleno. Una
   propuesta con precios inventados no se puede juzgar: lo que hay que ver
   es si "$2,55 el día" cabe y se lee donde se ha puesto.

   Cada maqueta pinta sus propias tarjetas; esto solo resuelve lo que
   comparten: rutas de imagen, cifras del catálogo y el cambio de tema.
   ============================================================ */

// Tema elegido a mano en la maqueta. Vive aparte de las claves de la app:
// esto es una maqueta, no la aplicación.
const DEMO_THEME_KEY = "clothToGo:propuestas:tema";

/** Ruta de una imagen del catálogo, corregida para web/propuestas/. */
function demoImg(src){ return src && !/^(https?:)?\/\//.test(src) ? `../../${src}` : src; }

/** Portada de una prenda, ya resuelta para esta carpeta. */
function demoCover(p){ return demoImg(coverImage(p)); }

/**
 * Prendas de muestra, siempre las mismas para poder comparar las maquetas
 * entre sí.
 * @param {number} n Cuántas devolver.
 * @param {number[]} [ids] Orden preferido; lo que falte se completa del catálogo.
 * @returns {Array<object>}
 */
function demoProducts(n, ids = [7, 2, 4, 1, 13, 14, 8, 10]){
  const elegidas = ids.map(productById).filter(Boolean);
  const resto = PRODUCTS.filter(p => !elegidas.includes(p));
  return [...elegidas, ...resto].slice(0, n);
}

/** Precio del primer día, formateado. */
function demoDay(p){ return rentalPrice(p, 1).toFixed(2); }

/** Precio de un fin de semana (3 días), formateado. */
function demoWeekend(p){ return rentalPrice(p, 3).toFixed(2); }

/**
 * Cuánto se ahorra frente a comprar la prenda, en porcentaje entero.
 * @param {object} p Prenda.
 * @param {number} [days=3] Días del alquiler con el que se compara.
 * @returns {number} 0–100.
 */
function demoSaving(p, days = 3){ return Math.round((1 - rentalPrice(p, days) / p.value) * 100); }

/** Litros de agua que ahorra la prenda, con separador de miles. */
function demoWater(p){ return fmtLiters(garmentWater(p)); }

/**
 * Enciende el cambio claro/oscuro de la maqueta.
 *
 * Las propuestas se juzgan en los dos temas, así que no basta con respetar el
 * del sistema: hace falta poder alternarlos delante del cliente. El botón
 * escribe `data-theme` en <html>; el CSS de cada maqueta define sus dos juegos
 * de variables y el sistema sigue decidiendo mientras no se toque nada.
 * @param {string} botonId Id del botón que alterna.
 */
function initDemoTheme(botonId){
  const raiz = document.documentElement;
  const btn = document.getElementById(botonId);
  let guardado = null;
  try { guardado = localStorage.getItem(DEMO_THEME_KEY); } catch(e){ /* sin almacenamiento */ }
  if(guardado) raiz.setAttribute("data-theme", guardado);

  const actual = () => raiz.getAttribute("data-theme")
    || ((window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light");
  const pintar = () => { if(btn) btn.textContent = actual() === "dark" ? "Claro" : "Oscuro"; };

  if(btn){
    btn.addEventListener("click", () => {
      const siguiente = actual() === "dark" ? "light" : "dark";
      raiz.setAttribute("data-theme", siguiente);
      try { localStorage.setItem(DEMO_THEME_KEY, siguiente); } catch(e){ /* sin almacenamiento */ }
      pintar();
    });
  }
  pintar();
}
