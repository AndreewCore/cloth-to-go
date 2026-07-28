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

/* Centro por defecto del mapa: Guayaquil, la ciudad donde opera el local. */
const MAP_DEFAULT_CENTER = { lat: -2.170998, lng: -79.922359 };
const MAP_DEFAULT_ZOOM = 15;

let mapsSdkPromise = null;   // promesa única de carga del SDK (evita duplicarla)
let pickerMap = null;        // instancia de google.maps.Map, reutilizada
let pickerGeocoder = null;
let pickerTarget = null;     // "ship" | "return" — a qué campo vuelve el resultado
let pickerPlace = null;      // { lat, lng, address } elegido ahora mismo

/**
 * Indica si el selector de mapa puede ofrecerse.
 * Mismo criterio que authAvailable(): por `file://` el SDK no carga, y sin
 * clave configurada Google responde con un mapa en gris y marca de agua.
 * @returns {boolean}
 */
function mapsAvailable(){
  return location.protocol !== "file:" && !!GOOGLE_MAPS_API_KEY;
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
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&libraries=places&loading=async&language=es&region=EC`;
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
 * @param {"ship"|"return"} target Campo del checkout que recibirá la ubicación.
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
 * @param {"ship"|"return"} target
 */
function setUpPickerMap(target){
  const el = document.getElementById("mapCanvas");
  const previo = target === "ship" ? addressCoords : returnAddressCoords;
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
    const texto = (status === "OK" && res && res[0])
      ? res[0].formatted_address
      : `Ubicación ${punto.lat.toFixed(5)}, ${punto.lng.toFixed(5)}`;
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

/** Guarda la ubicación elegida en el campo del checkout que la pidió. */
function confirmMapPicker(){
  if(!pickerPlace) return;
  applyPickedLocation(pickerTarget, pickerPlace);
  closeMapPicker();
  renderSheet();
  toast("Ubicación guardada");
}

/**
 * Vuelca una ubicación en el campo correspondiente del checkout.
 * Separado de confirmMapPicker() para poder probar el efecto sobre el estado
 * sin depender del SDK de Google, que no existe en el entorno de pruebas.
 * @param {"ship"|"return"} target
 * @param {{lat:number, lng:number, address:string}} place
 */
function applyPickedLocation(target, place){
  const texto = place.address || `Ubicación ${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`;
  if(target === "ship"){
    address = texto;
    addressCoords = { lat: place.lat, lng: place.lng };
  } else {
    returnAddress = texto;
    returnAddressCoords = { lat: place.lat, lng: place.lng };
  }
  saveState();
}

/**
 * Descarta el punto guardado de un campo, dejando solo su texto.
 *
 * Se llama cuando el usuario escribe la dirección a mano: si se conservara el
 * punto, el texto y las coordenadas apuntarían a sitios distintos y el reparto
 * iría a la ubicación vieja, que es justo el error que este selector evita.
 * @param {"ship"|"return"} target
 */
function clearPickedLocation(target){
  if(target === "ship") addressCoords = null;
  else returnAddressCoords = null;
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
 * @param {"ship"|"return"} target
 * @param {{lat:number,lng:number}|null} coords Ubicación ya elegida, si la hay.
 * @returns {string} HTML.
 */
function mapPickerButtonHTML(target, coords){
  if(!mapsAvailable()) return "";
  return `
    <button type="button" class="map-pick-btn" data-action="pickLocation" data-target="${target}">
      📍 ${coords ? "Cambiar ubicación en el mapa" : "Elegir ubicación exacta en el mapa"}
    </button>
    ${coords ? `<div class="map-coords">✓ Punto exacto guardado (${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)})</div>` : ""}`;
}
