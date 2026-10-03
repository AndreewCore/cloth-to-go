/* ============================================================
   CLOTH TO GO · web/js/water.js
   Sección "Agua ahorrada entre todos".

   La cifra no se calcula aquí: el backend la acumula en un solo registro
   y la renueva en un corte por hora (server/src/impact.js). La página la
   lee al cargar y vuelve a pedirla justo después de cada corte, mientras
   siga abierta. Sin backend la sección se queda oculta.
   ============================================================ */

// Nivel mínimo del tanque (fracción de su alto). Con la meta en 100 M de
// litros, los primeros alquileres no llegan a una milésima: el tanque se vería
// vacío y la ola no tendría dónde estar. El dato exacto va en el texto y en la
// barra; el tanque solo enseña que hay agua.
const WATER_TANK_MIN = 0.06;

let waterRefreshTimer = null;

/**
 * Litros de una meta, en palabras: 100000000 → "100 millones".
 * @param {number} liters Litros (múltiplo de un millón en la práctica).
 * @returns {string}
 */
function fmtGoalLiters(liters){
  return `${(liters / 1e6).toLocaleString("es-EC")} millones`;
}

/**
 * Porcentaje de la meta con la precisión que el número merece: sin esto, los
 * primeros meses se leerían como "0 %" aunque ya haya agua ahorrada.
 * @param {number} pct Porcentaje (0–100).
 * @returns {string}
 */
function fmtGoalPct(pct){
  if(pct <= 0) return "0 %";
  if(pct < 0.01) return "menos de 0,01 %";
  return `${pct.toLocaleString("es-EC", { maximumFractionDigits: pct < 10 ? 2 : 1 })} %`;
}

/**
 * Hora de un corte en Guayaquil ("14:00"), sea cual sea la zona del visitante:
 * el corte es un hecho del negocio, no del navegador que lo mira.
 * @param {string} iso Instante ISO.
 * @returns {string}
 */
function fmtCutTime(iso){
  return new Date(iso).toLocaleTimeString("es-EC", {
    hour: "2-digit", minute: "2-digit", timeZone: "America/Guayaquil",
  });
}

/**
 * Anima el contador grande desde lo que muestra ahora hasta `target`.
 * Con menos movimiento pedido por el sistema, salta directo a la cifra.
 * @param {HTMLElement} el Elemento del número.
 * @param {number} target Litros finales.
 */
function countUpLiters(el, target){
  const from = Number(el.dataset.value) || 0;
  el.dataset.value = String(target);
  const quieto = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if(quieto || from === target){ el.textContent = fmtLiters(target); return; }

  const DURACION = 1800;
  const t0 = performance.now();
  function paso(t){
    const k = Math.min(1, (t - t0) / DURACION);
    const suave = 1 - Math.pow(1 - k, 3);
    el.textContent = fmtLiters(from + (target - from) * suave);
    if(k < 1) requestAnimationFrame(paso);
  }
  requestAnimationFrame(paso);
}

/**
 * Pinta la sección con una lectura del contador.
 * @param {{liters:number, goal:number, reached:number[], cutAt:string}} data
 */
function renderWaterImpact(data){
  const pct = Math.min(100, (data.liters / data.goal) * 100);

  const num = document.getElementById("waterLiters");
  // El conteo arranca cuando la sección entra en pantalla: animado fuera de
  // vista, llegaría ya terminado.
  if(num.dataset.seen) countUpLiters(num, data.liters);
  else num.dataset.pending = String(data.liters);

  const bar = document.getElementById("waterBar");
  bar.setAttribute("aria-valuenow", pct.toFixed(2));
  // La barra nunca queda en 0 px si ya hay agua: un hilo visible dice "empezó".
  document.getElementById("waterBarFill").style.width =
    data.liters > 0 ? `max(6px, ${pct}%)` : "0";

  document.getElementById("waterGoalText").innerHTML =
    `<b>${fmtGoalPct(pct)}</b> de la meta: <b>${fmtGoalLiters(data.goal)}</b> de litros`;

  const reached = document.getElementById("waterReached");
  reached.hidden = !data.reached.length;
  reached.innerHTML = data.reached.map(g =>
    `<li>${icon("checkCircle", { size: 16 })}Meta de ${fmtGoalLiters(g)} cumplida</li>`).join("");

  document.getElementById("waterStamp").textContent =
    `Actualizado a las ${fmtCutTime(data.cutAt)} · la cifra se renueva cada hora`;

  // Nivel del tanque: la gota va de y=8 a y=242 en su viewBox, y la ola tiene
  // su cresta ~12 unidades por debajo del borde de su grupo.
  const nivel = Math.max(WATER_TANK_MIN, pct / 100);
  document.getElementById("tankLevel").style.transform =
    `translateY(${(242 - nivel * 234 - 12).toFixed(1)}px)`;

  document.getElementById("agua").hidden = false;
}

/**
 * Programa la siguiente lectura para justo después del próximo corte, con un
 * margen aleatorio para que todas las pestañas abiertas no lleguen a la vez.
 * @param {number} delayMs Espera en milisegundos.
 */
function scheduleWaterRefresh(delayMs){
  clearTimeout(waterRefreshTimer);
  waterRefreshTimer = setTimeout(loadWaterImpact, Math.max(30000, delayMs));
}

/**
 * Lee el contador y pinta la sección; si falla, conserva lo que ya se veía y
 * reintenta más tarde (o deja la sección oculta si nunca llegó a mostrarse).
 */
async function loadWaterImpact(){
  const data = await fetchWaterImpact();
  if(!data){
    if(!document.getElementById("agua").hidden) scheduleWaterRefresh(5 * 60 * 1000);
    return;
  }
  renderWaterImpact(data);
  const margen = 5000 + Math.random() * 55000;
  scheduleWaterRefresh(Date.parse(data.nextCutAt) - Date.now() + margen);
}

/**
 * Arranca la sección: vigila cuándo entra en pantalla (para lanzar el conteo)
 * y hace la primera lectura.
 */
function initWaterImpact(){
  const section = document.getElementById("agua");
  const num = document.getElementById("waterLiters");
  if(!section || !num) return;

  const mostrar = () => {
    num.dataset.seen = "1";
    if(num.dataset.pending){
      countUpLiters(num, Number(num.dataset.pending));
      delete num.dataset.pending;
    }
  };
  if("IntersectionObserver" in window){
    const io = new IntersectionObserver(entries => {
      if(entries.some(e => e.isIntersecting)){ io.disconnect(); mostrar(); }
    }, { threshold: 0.35 });
    io.observe(section);
  } else {
    mostrar();
  }

  loadWaterImpact();
}
