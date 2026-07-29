/* ============================================================
   CLOTH TO GO · prefs.js
   Preferencias de presentación: tema (claro/oscuro/automático) y
   ajustes de accesibilidad (tamaño de texto, animaciones, contraste).

   Vive FUERA de state.js a propósito. El estado de state.js se guarda
   por usuario y la sesión de invitado es efímera; estas preferencias
   son del dispositivo: quien sube el tamaño de letra por baja visión
   no espera perderlo al cerrar sesión ni al entrar como invitado.

   Se aplican como atributos en <html>, no como clases en un contenedor,
   para que el CSS pueda reaccionar antes de que exista el marcado y no
   haya un parpadeo de tema claro al cargar.

   Se carga TEMPRANO (justo después de icons.js): el tema debe quedar
   puesto antes del primer render.
   ============================================================ */

const PREFS_KEY = "clothToGo:prefs";

/* Valores por defecto. `auto` sigue al sistema operativo: es el que respeta la
   decisión que el usuario ya tomó en su dispositivo, en vez de imponerle otra. */
const DEFAULT_PREFS = {
  theme: "auto",          // auto | light | dark
  textSize: "normal",     // normal | grande | mayor
  reduceMotion: false,
  highContrast: false,
};

/* Escalas de tamaño de texto. Se aplican con `zoom` sobre el marco de la app
   porque toda la hoja de estilos está en px: escalar la raíz no haría nada.
   `zoom` refluye el diseño de verdad (a diferencia de `transform: scale`, que
   deforma y deja la caja original), que es justo lo que necesita quien amplía
   por baja visión: texto más grande Y más espacio, no un texto estirado. */
const TEXT_SCALES = { normal: 1, grande: 1.15, mayor: 1.3 };

let prefs = { ...DEFAULT_PREFS };

/**
 * Lee las preferencias guardadas, quedándose con los valores por defecto para
 * cualquier campo ausente o corrupto.
 * @returns {object} Preferencias efectivas.
 */
function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const guardado = JSON.parse(raw);
      // Mezcla en vez de reemplazo: si una versión futura añade una preferencia,
      // los usuarios existentes la reciben con su valor por defecto en vez de
      // quedarse con `undefined`.
      prefs = { ...DEFAULT_PREFS, ...guardado };
    }
  } catch {
    // localStorage bloqueado o JSON inválido: se sigue con los valores por
    // defecto. Nunca debe impedir que la app arranque.
    prefs = { ...DEFAULT_PREFS };
  }
  return prefs;
}

/** Persiste las preferencias. Falla en silencio si no hay almacenamiento. */
function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* sin almacenamiento la preferencia dura lo que la pestaña */
  }
}

/**
 * ¿El sistema operativo pide tema oscuro?
 * @returns {boolean}
 */
function systemPrefersDark() {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Tema que toca pintar ahora mismo, resolviendo `auto` contra el sistema.
 * @returns {"light"|"dark"}
 */
function effectiveTheme() {
  if (prefs.theme === "auto") return systemPrefersDark() ? "dark" : "light";
  return prefs.theme;
}

/**
 * ¿Hay que suprimir las animaciones?
 * Respeta también la preferencia del sistema aunque el usuario no haya tocado
 * nada aquí: quien la activó a nivel de SO ya expresó su decisión.
 * @returns {boolean}
 */
function shouldReduceMotion() {
  if (prefs.reduceMotion) return true;
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Vuelca las preferencias a atributos de <html>, de donde las lee el CSS. */
function applyPrefs() {
  const root = document.documentElement;
  root.dataset.theme = effectiveTheme();
  root.dataset.textSize = prefs.textSize;
  root.dataset.reduceMotion = String(shouldReduceMotion());
  root.dataset.contrast = prefs.highContrast ? "high" : "normal";
  root.style.setProperty("--text-scale", String(TEXT_SCALES[prefs.textSize] ?? 1));
}

/**
 * Copia de las preferencias actuales.
 * Se devuelve copia y no la referencia para que la vista no pueda mutarlas sin
 * pasar por setPref(), que es quien guarda y aplica.
 * @returns {object}
 */
function getPrefs() {
  return { ...prefs };
}

/**
 * Cambia una preferencia, la guarda y la aplica.
 * @param {"theme"|"textSize"|"reduceMotion"|"highContrast"} key
 * @param {string|boolean} value
 */
function setPref(key, value) {
  prefs[key] = value;
  savePrefs();
  applyPrefs();
}

/**
 * Alterna claro/oscuro desde el botón del header.
 *
 * Sale de `auto` a propósito: si el usuario pulsa el botón es porque quiere
 * decidir él, y dejarlo en automático haría que el sistema le revirtiera la
 * elección al cambiar de hora o de perfil.
 */
function toggleTheme() {
  setPref("theme", effectiveTheme() === "dark" ? "light" : "dark");
  renderThemeButton();
  // El botón de Google lo dibuja su SDK: no basta con cambiar variables CSS.
  if (typeof renderGoogleButton === "function") renderGoogleButton();
  return prefs.theme;
}

/** Pinta el icono del botón de tema según lo que hará al pulsarlo. */
function renderThemeButton() {
  const btn = document.getElementById("toggleTheme");
  if (!btn) return;
  const oscuro = effectiveTheme() === "dark";
  // El icono anuncia el destino, no el estado actual: es lo que el usuario
  // espera de un interruptor ("pulsa para ir a claro").
  btn.innerHTML = icon(oscuro ? "sun" : "moon", { size: 21 });
  const etiqueta = oscuro ? "Cambiar a tema claro" : "Cambiar a tema oscuro";
  btn.setAttribute("aria-label", etiqueta);
  btn.setAttribute("title", etiqueta);
}

/**
 * Sigue los cambios del sistema mientras el tema esté en `auto`.
 * Sin esto, la app se quedaría con el tema que hubiera al cargar y no
 * acompañaría al cambio automático de noche del sistema.
 */
function watchSystemTheme() {
  if (typeof matchMedia !== "function") return;
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const alCambiar = () => {
    if (prefs.theme !== "auto") return;
    applyPrefs();
    renderThemeButton();
    if (typeof renderGoogleButton === "function") renderGoogleButton();
  };
  if (typeof mq.addEventListener === "function") mq.addEventListener("change", alCambiar);
}

// Se ejecuta al cargar el archivo, antes de cualquier render: el tema tiene que
// estar puesto en <html> antes de que se pinte nada.
loadPrefs();
applyPrefs();
