/* ============================================================
   CLOTH TO GO · maps.js
   Selector de ubicación con Google Maps para el envío y el retiro
   a domicilio. Escribir una dirección a mano es la mayor fuente de
   entregas fallidas: en Guayaquil muchas casas no tienen numeración
   fiable y "por la ciclovía, casa verde" no le sirve al repartidor.
   Un punto en el mapa sí.

   OPCIONAL, igual que el login de Google y el backend: si no hay
   clave, no hay red o la app se abrió por file://, el botón del mapa
   no se ofrece y el campo de texto sigue funcionando exactamente
   como antes. La demo nunca deja de abrirse con doble clic.

   El SDK se carga BAJO DEMANDA (al pulsar "Elegir en el mapa"), no al
   arrancar: así quien solo mira el catálogo no paga la descarga ni
   aparece en la facturación de Google.

   Depende de state.js (address/returnAddress y sus coordenadas) y de
   dom.js (toast). Se carga antes que main.js.
   ============================================================ */

/* Clave de navegador de Google Cloud Console. NO es un secreto —viaja en el
   HTML—, pero sí debe restringirse por referente HTTP a los dominios de la app;
   sin esa restricción cualquiera puede consumir tu cuota. Vacía = mapa
   desactivado y la app cae al campo de texto. Ver README (sección Mapas). */
const GOOGLE_MAPS_API_KEY = "";

/* Override local de la clave, mismo patrón que API_OVERRIDE_KEY en api.js: deja
   probar el mapa sin escribir la clave en el código. Existe porque el repo es
   público y una clave commiteada acaba scrapeada y facturada a la cuenta; así
   la clave vive solo en el navegador de quien prueba. */
const MAPS_OVERRIDE_KEY = "clothToGo:mapsKey";

/* Parámetro de URL que siembra el override (?mapskey=…). Ahorra abrir la
   consola para pegar el localStorage a mano al probar en local. */
const MAPS_KEY_PARAM = "mapskey";

/**
 * Clave efectiva del mapa: el override local si existe, si no la del código.
 * @returns {string} Cadena vacía si no hay ninguna configurada.
 */
function mapsApiKey(){
  try {
    // Leer localStorage lanza si el almacenamiento está bloqueado (igual que en
    // api.js): sin override, la clave del código sigue siendo la respuesta.
    return localStorage.getItem(MAPS_OVERRIDE_KEY) || GOOGLE_MAPS_API_KEY;
  } catch {
    return GOOGLE_MAPS_API_KEY;
  }
}

/**
 * Guarda la clave que venga en ?mapskey= y la borra de la barra de direcciones.
 * Se limpia la URL porque una clave en el query string se filtra por el
 * historial y por la cabecera Referer hacia terceros.
 */
function adoptMapsKeyFromUrl(){
  const url = new URL(location.href);
  const k = url.searchParams.get(MAPS_KEY_PARAM);
  if(!k) return;
  try { localStorage.setItem(MAPS_OVERRIDE_KEY, k); } catch { /* sin storage no hay override */ }
  url.searchParams.delete(MAPS_KEY_PARAM);
  history.replaceState(null, "", url.pathname + url.search + url.hash);
}

/* Centro por defecto del mapa: Guayaquil, la ciudad donde opera el local. */
const MAP_DEFAULT_CENTER = { lat: -2.170998, lng: -79.922359 };
const MAP_DEFAULT_ZOOM = 15;

let mapsSdkPromise = null;   // promesa única de carga del SDK (evita duplicarla)
let pickerMap = null;        // instancia de google.maps.Map, reutilizada
let pickerGeocoder = null;
let pickerTarget = null;     // clave de ADDRESS_FIELDS — a qué campo vuelve el resultado
let pickerPlace = null;      // { lat, lng, address } elegido ahora mismo

/* ---- Campos de dirección que puede rellenar el mapa ----
   Cada uno dice de qué par de variables globales lee y escribe, con qué id sale
   su <input> de respaldo y qué hay que repintar al confirmar. Antes el objetivo
   era un `if (target === "ship") … else …` repartido por cuatro funciones, así
   que sumar un tercer campo obligaba a encontrarlos todos y el que se olvidara
   escribía la ubicación en el campo equivocado (o en ninguno) sin fallar.

   `refresh` sale de aquí porque no todos viven en el panel: el modo de
   devolución de un pedido se edita en un pop-up que renderSheet() no toca. */
const ADDRESS_FIELDS = {
  ship: {
    inputId: "addr",
    hint: "Marca en el mapa dónde quieres que te entreguemos las prendas.",
    text:   () => address,
    coords: () => addressCoords,
    set: (texto, punto) => { address = texto; addressCoords = punto; }
  },
  return: {
    inputId: "retAddr",
    hint: "Marca en el mapa dónde quieres que retiremos las prendas.",
    text:   () => returnAddress,
    coords: () => returnAddressCoords,
    set: (texto, punto) => { returnAddress = texto; returnAddressCoords = punto; }
  },
  orderRet: {
    inputId: "editRetAddr",
    hint: "Marca en el mapa dónde quieres que retiremos la prenda.",
    text:   () => editRetAddr,
    coords: () => editRetCoords,
    set: (texto, punto) => { editRetAddr = texto; editRetCoords = punto; },
    refresh: () => renderReturnEditor()
  },
  donate: {
    inputId: "donAddr",
    hint: "Marca en el mapa dónde pasamos a retirar las prendas que donas.",
    text:   () => donAddr,
    coords: () => donCoords,
    set: (texto, punto) => { donAddr = texto; donCoords = punto; }
  }
};

/**
 * Campo de dirección por su clave, o `null` si no existe.
 * Se consulta en vez de indexar a pelo para que una clave mal escrita no acabe
 * en un `undefined.set is not a function` a mitad de la confirmación.
 * @param {string} target
 * @returns {object|null}
 */
function addressField(target){
  return Object.prototype.hasOwnProperty.call(ADDRESS_FIELDS, target) ? ADDRESS_FIELDS[target] : null;
}

/**
 * Campo de dirección al que pertenece un `<input>` por su id.
 * Lo usa la delegación de `input` en main.js: escribir a mano tiene que invalidar
 * el punto del mapa sea cual sea el campo.
 * @param {string} inputId
 * @returns {[string, object]|null} Par [clave, campo].
 */
function addressFieldByInput(inputId){
  const par = Object.entries(ADDRESS_FIELDS).find(([, f]) => f.inputId === inputId);
  return par || null;
}

/**
 * Indica si el selector de mapa puede ofrecerse.
 * Mismo criterio que authAvailable(): por `file://` el SDK no carga, y sin
 * clave configurada Google responde con un mapa en gris y marca de agua.
 * @returns {boolean}
 */
function mapsAvailable(){
  return location.protocol !== "file:" && !!mapsApiKey();
}

/**
 * Carga el SDK de Google Maps una sola vez y resuelve cuando está listo.
 * Rechaza si no puede cargarse (sin red, clave inválida, dominio no autorizado)
 * para que quien llame pueda volver al campo de texto en vez de quedarse colgado.
 * @returns {Promise<void>}
 */
function loadMapsSdk(){
  if(mapsSdkPromise) return mapsSdkPromise;
  mapsSdkPromise = new Promise((resolve, reject) => {
    if(!mapsAvailable()) return reject(new Error("maps-unavailable"));
    if(window.google && window.google.maps) return resolve();
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(mapsApiKey())}&libraries=places&loading=async&language=es&region=EC`;
    s.async = true;
    s.onload = () => resolve();
    // Un fallo de carga deja la promesa rechazada PARA SIEMPRE; se limpia para
    // que un segundo intento (p. ej. tras recuperar la red) vuelva a probar.
    s.onerror = () => { mapsSdkPromise = null; reject(new Error("maps-load-failed")); };
    document.head.appendChild(s);
  });
  return mapsSdkPromise;
}

/**
 * Abre el selector de ubicación para el campo indicado.
 * @param {string} target Clave de ADDRESS_FIELDS que recibirá la ubicación.
 */
function openMapPicker(target){
  pickerTarget = target;
  pickerPlace = null;
  const overlayEl = document.getElementById("mapOverlay");
  const addrEl = document.getElementById("mapAddress");
  overlayEl.classList.add("show");
  addrEl.textContent = "Cargando el mapa…";
  document.getElementById("mapConfirm").disabled = true;

  loadMapsSdk()
    .then(() => setUpPickerMap(target))
    .catch(() => {
      closeMapPicker();
      toast("No se pudo abrir el mapa · escribe la dirección");
    });
}

/**
 * Monta (o reutiliza) el mapa y engancha la lectura del centro.
 *
 * El pin va FIJO en el centro de la pantalla y lo que se mueve es el mapa: en
 * un teléfono arrastrar un marcador diminuto con el dedo es incómodo y el
 * propio dedo tapa el punto que intentas afinar.
 * @param {string} target Clave de ADDRESS_FIELDS.
 */
function setUpPickerMap(target){
  const el = document.getElementById("mapCanvas");
  const campo = addressField(target);
  const previo = campo && campo.coords();
  const centro = previo || MAP_DEFAULT_CENTER;

  if(!pickerMap){
    pickerMap = new google.maps.Map(el, {
      center: centro,
      zoom: MAP_DEFAULT_ZOOM,
      disableDefaultUI: true,
      zoomControl: true,
      gestureHandling: "greedy"    // dentro del marco del teléfono no hay scroll que respetar
    });
    pickerGeocoder = new google.maps.Geocoder();
    pickerMap.addListener("idle", readMapCenter);
  } else {
    pickerMap.setCenter(centro);
    google.maps.event.trigger(pickerMap, "resize");
  }
  readMapCenter();
}

/**
 * Sustituto cuando la geocodificación inversa no da una calle.
 *
 * Existe como función y no como plantilla suelta porque `addressLabel()` tiene
 * que reconocer esta cadena para no enseñarla: si las dos se escriben aparte,
 * cambiar una deja a la otra comparando contra un texto que ya no se genera.
 * @param {{lat:number,lng:number}} punto Coordenadas elegidas.
 * @returns {string} Texto sustituto.
 */
function fallbackAddress(punto){
  return `Ubicación ${punto.lat.toFixed(5)}, ${punto.lng.toFixed(5)}`;
}

/** Lee el centro del mapa y lo traduce a una dirección legible. */
function readMapCenter(){
  if(!pickerMap) return;
  const c = pickerMap.getCenter();
  const punto = { lat: c.lat(), lng: c.lng() };
  const addrEl = document.getElementById("mapAddress");
  const okBtn = document.getElementById("mapConfirm");

  // El punto ya es válido aunque la geocodificación falle: la entrega se guía
  // por las coordenadas, y el texto solo sirve para que el cliente se reconozca.
  pickerPlace = { ...punto, address: "" };
  okBtn.disabled = false;
  addrEl.textContent = "Buscando la dirección…";

  pickerGeocoder.geocode({ location: punto }, (res, status) => {
    // Puede haber llegado otro "idle" mientras tanto: si el punto cambió, este
    // resultado ya es viejo y pisarlo mostraría una dirección que no toca.
    if(!pickerPlace || pickerPlace.lat !== punto.lat || pickerPlace.lng !== punto.lng) return;
    const ok = status === "OK" && res && res[0];
    if(!ok){
      // El motivo se descartaba, y sin él "sale una coordenada en vez de la
      // calle" no se puede diagnosticar: REQUEST_DENIED (clave o facturación),
      // OVER_QUERY_LIMIT y ZERO_RESULTS se ven exactamente igual desde fuera.
      console.warn(`[maps] geocodificación inversa sin resultado: ${status}`);
    }
    const texto = ok ? res[0].formatted_address : fallbackAddress(punto);
    pickerPlace.address = texto;
    addrEl.textContent = texto;
  });
}

/** Centra el mapa en la ubicación del dispositivo, si el usuario la concede. */
function useMyLocation(){
  if(!navigator.geolocation || !pickerMap) return;
  const btn = document.getElementById("mapLocate");
  btn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    pos => {
      btn.disabled = false;
      pickerMap.setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      pickerMap.setZoom(17);
    },
    () => { btn.disabled = false; toast("No pudimos obtener tu ubicación"); },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

/** Guarda la ubicación elegida en el campo que la pidió y repinta su pantalla. */
function confirmMapPicker(){
  if(!pickerPlace) return;
  const campo = addressField(pickerTarget);
  applyPickedLocation(pickerTarget, pickerPlace);
  closeMapPicker();
  // El pop-up del modo de devolución vive fuera del panel: repintar solo el
  // panel dejaría el punto guardado sin aparecer en la pantalla que lo pidió.
  if(campo && campo.refresh) campo.refresh();
  else renderSheet();
  toast("Ubicación guardada");
}

/**
 * Vuelca una ubicación en el campo de dirección correspondiente.
 * Separado de confirmMapPicker() para poder probar el efecto sobre el estado
 * sin depender del SDK de Google, que no existe en el entorno de pruebas.
 * @param {string} target Clave de ADDRESS_FIELDS.
 * @param {{lat:number, lng:number, address:string}} place
 */
function applyPickedLocation(target, place){
  const campo = addressField(target);
  if(!campo) return;
  const texto = place.address || `Ubicación ${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`;
  campo.set(texto, { lat: place.lat, lng: place.lng });
  saveState();
}

/**
 * Descarta el punto guardado de un campo, dejando solo su texto.
 *
 * Se llama cuando el usuario escribe la dirección a mano: si se conservara el
 * punto, el texto y las coordenadas apuntarían a sitios distintos y el reparto
 * iría a la ubicación vieja, que es justo el error que este selector evita.
 * @param {string} target Clave de ADDRESS_FIELDS.
 */
function clearPickedLocation(target){
  const campo = addressField(target);
  if(campo) campo.set(campo.text(), null);
}

/** Cierra el selector sin guardar nada. */
function closeMapPicker(){
  document.getElementById("mapOverlay").classList.remove("show");
  pickerPlace = null;
}

/**
 * Botón "Elegir en el mapa" para un campo de dirección.
 * Devuelve vacío cuando el mapa no está disponible: el campo de texto sigue
 * siendo la vía completa, así que un botón muerto solo estorbaría.
 * @param {string} target Clave de ADDRESS_FIELDS.
 * @param {{lat:number,lng:number}|null} coords Ubicación ya elegida, si la hay.
 * @returns {string} HTML.
 */
function mapPickerButtonHTML(target, coords){
  if(!mapsAvailable()) return "";
  return `
    <button type="button" class="map-pick-btn" data-action="pickLocation" data-target="${target}">
      ${icon("mapPin", { size: 16 })} ${coords ? "Cambiar ubicación en el mapa" : "Elegir ubicación exacta en el mapa"}
    </button>`;
}

/**
 * Texto con el que se anuncia un punto ya elegido.
 *
 * Cuando la geocodificación inversa no responde, `readMapCenter()` guarda como
 * dirección un "Ubicación -2.16396, -79.89318". Eso es una coordenada disfrazada
 * de dirección: no le dice nada al cliente y encima se leía junto a las mismas
 * cifras repetidas debajo. Aquí se cambia por una frase honesta — el punto vale,
 * lo que falta es su nombre — y las cifras quedan solo en el título, al alcance
 * de quien las necesite.
 * @param {string} addr Dirección guardada (puede ser el sustituto).
 * @param {{lat:number,lng:number}} coords Punto elegido.
 * @returns {string} Texto para mostrar.
 */
function addressLabel(addr, coords){
  const texto = String(addr ?? "").trim();
  return (!texto || texto === fallbackAddress(coords)) ? "Ubicación marcada en el mapa" : texto;
}

/**
 * Miniatura estática del punto elegido.
 *
 * Degrada igual que el resto del módulo: sin clave no se pinta nada, y si la
 * imagen no carga —Maps Static API sin habilitar en la clave, sin red— se
 * esconde en vez de dejar el hueco roto. El punto sigue guardado: la miniatura
 * confirma, no decide.
 * @param {{lat:number,lng:number}} coords Punto a dibujar.
 * @returns {string} HTML de la miniatura, o cadena vacía.
 */
function staticMapHTML(coords){
  const key = mapsApiKey();
  if(!key) return "";
  const punto = `${coords.lat},${coords.lng}`;
  // scale=2 para que no se vea borrosa en pantallas densas, que son todas las
  // de móvil. El tamaño es apaisado porque va en el ancho de la tarjeta.
  const src = `https://maps.googleapis.com/maps/api/staticmap?center=${punto}&zoom=16&size=320x110&scale=2`
    + `&markers=color:0x2e9e5b%7C${punto}&language=es&region=EC&key=${encodeURIComponent(key)}`;
  return `<img class="ap-map" src="${escapeHTML(src)}" alt="Mapa del punto elegido" loading="lazy"
            onerror="this.remove()" />`;
}

/**
 * Campo de dirección del checkout.
 *
 * Con el mapa disponible NO se ofrece campo de texto: la dirección se fija
 * marcando el punto y nada más. Escribirla a mano es justo lo que el mapa vino
 * a resolver — un texto sin coordenadas deja al repartidor con "por la
 * ciclovía, casa verde"— y mantener las dos vías abiertas garantiza que la
 * mayoría siga usando la peor.
 *
 * Sin mapa (file://, sin clave o sin red) SÍ vuelve el campo de texto: es la
 * única forma de terminar un pedido, y dejarlo bloqueado rompería la demo que
 * tiene que abrirse con doble clic.
 *
 * @param {string} target Clave de ADDRESS_FIELDS.
 * @param {string} label Rótulo del campo.
 * @param {string} addr Dirección actual (texto).
 * @param {{lat:number,lng:number}|null} coords Punto elegido, si lo hay.
 * @returns {string} HTML.
 */
function addressFieldHTML(target, label, addr, coords){
  const campo = addressField(target);
  const head = `${icon("mapPin", { size: 14 })} ${label}`;
  if(!mapsAvailable()){
    return `${head}
      <input id="${campo ? campo.inputId : "addr"}" placeholder="Calle, número, ciudad…" value="${escapeHTML(addr)}" />
      ${mapPickerButtonHTML(target, coords)}`;
  }
  const cuerpo = coords
    ? `<div class="addr-picked">
         ${staticMapHTML(coords)}
         <div class="ap-text">${escapeHTML(addressLabel(addr, coords))}</div>
         <div class="ap-coords">${icon("check", { size: 13 })} Punto exacto guardado</div>
       </div>`
    : `<div class="addr-empty">${campo ? campo.hint : ""}</div>`;
  return `${head}${cuerpo}${mapPickerButtonHTML(target, coords)}`;
}

/**
 * ¿La dirección está lista para continuar?
 * Con mapa exige el punto: un texto sin coordenadas ya no puede existir por
 * esta vía, y aceptarlo reabriría la puerta que addressFieldHTML() cierra.
 * @param {string} addr
 * @param {{lat:number,lng:number}|null} coords
 * @returns {boolean}
 */
function addressReady(addr, coords){
  return mapsAvailable() ? !!coords : isValidAddress(addr);
}
