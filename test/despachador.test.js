/**
 * Guardarraíl del DESPACHADOR de eventos (`js/main.js`).
 *
 * Toda la interactividad de la app cuelga de un patrón: los controles llevan
 * `data-action` y un único listener delegado los reparte con un `switch`. El
 * fallo característico de ese patrón es mudo — se agrega un botón, se olvida el
 * `case`, y el botón simplemente no hace nada: sin excepción, sin traza, sin
 * test que lo note.
 *
 * El inventario de lo que la app pinta se arma por DOS caminos, porque ninguno
 * de los dos basta solo:
 *
 * - **Leyendo el fuente** (`data-action="…"`). Ve las vistas que ninguna prueba
 *   renderiza y las ramas condicionales que aquí no se dan: `pickLocation` solo
 *   se dibuja con clave de Google Maps, que en las pruebas no existe.
 * - **Barriendo el DOM** tras renderizar todas las vistas. Ve lo que el
 *   escaneo estático NO puede ver: acciones con el nombre interpolado
 *   (`data-action="gal${'$'}{dir}"`) y las que salen de un HELPER de marcado
 *   compartido, donde el literal ya no está en la plantilla sino en el
 *   argumento de la llamada.
 *
 * Sin el barrido, extraer un helper de marcado —el trabajo normal de un
 * refactor de vistas— hacía desaparecer del inventario acciones que se siguen
 * pintando, y el guardarraíl se debilitaba sin avisar. La unión de ambos es lo
 * que hay que mirar.
 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadDom } = require("./helpers/load-dom.js");

const ROOT = path.join(__dirname, "..");
const JS_DIR = path.join(ROOT, "js");
const leer = f => fs.readFileSync(path.join(JS_DIR, f), "utf8");
const FUENTES = fs.readdirSync(JS_DIR).filter(f => f.endsWith(".js"));

/**
 * Los `data-action="…"` literales que hay en el fuente. Incluye index.html: hay
 * controles estáticos (galería, ajustes) que no nacen de ninguna plantilla y
 * cuyo case es igual de fácil de borrar por descuido.
 * @returns {string[]}
 */
function accionesEnFuente() {
  const out = new Set();
  const fuentes = [...FUENTES.map(leer), fs.readFileSync(path.join(ROOT, "index.html"), "utf8")];
  for (const src of fuentes) {
    for (const m of src.matchAll(/data-action="([A-Za-z0-9_]+)"/g)) out.add(m[1]);
  }
  return [...out].sort();
}

/**
 * Los `data-action` que aparecen REALMENTE en el DOM tras pintar la app entera.
 *
 * Recorre las once vistas y los estados que enseñan controles distintos (perfil
 * en edición, editor de devolución, pedido vencido, cupón aplicado, sesión de
 * Google, confirmación de un pedido recién pagado). Es un barrido, no una
 * prueba: no afirma nada por sí mismo, alimenta el inventario.
 *
 * Se hace una sola vez y se memoriza — monta su propio entorno porque deja el
 * estado hecho un cristo a propósito, y no debe contaminar el `beforeEach`.
 * @returns {string[]}
 */
let _accionesDom = null;
function accionesEnDOM() {
  if (_accionesDom) return _accionesDom;
  const { window: w, document: d, app: a } = loadDom({ withMain: true });
  const vistas = new Set();
  const recoger = () => d.querySelectorAll("[data-action]")
    .forEach(el => vistas.add(el.dataset.action));
  const pintar = v => { a.view = v; w.renderSheet(); recoger(); };

  const hoy = a.isoOffset(0);
  a.cart = [{ id: 1 }, { id: 3 }];
  a.orders = [
    { id:1001, date:a.isoOffset(-9), items:[1], start:a.isoOffset(-8), end:a.isoOffset(-2),
      delivery:"ship", ret:"home", retAddr:"Av. Siempre Viva 123", pay:"cash",
      status:"settled", total:40, points:60, pointsCredited:true },
    { id:1002, date:a.isoOffset(-1), items:[3], start:a.isoOffset(1), end:a.isoOffset(4),
      delivery:"pickup", ret:"store", retAddr:"", pay:"credit",
      status:"pending", total:25, points:30, pointsCredited:false },
    { id:1003, date:a.isoOffset(-5), items:[5], start:a.isoOffset(-4), end:a.isoOffset(-3),
      delivery:"ship", ret:"home", retAddr:"x", pay:"debit",
      status:"cancelled", cancelledAt:hoy, total:0, points:0, pointsCredited:false },
  ];
  Object.assign(a.profile, { name:"Ana", email:"a@b.com", phone:"0991234567", points:500 });
  a.setCheckout({ delivery:"ship", address:"Av. Siempre Viva 123", returnMethod:"home",
    returnAddress:"Av. Siempre Viva 123", payMethod:"credit",
    card:{ number:"4111111111111111", name:"Ana", expiry:"12/29", cvv:"123" } });

  w.renderGrid(); recoger();
  w.openDetail(1); recoger();                 // detalle + galería (galPrev/galNext)
  for (const v of ["cart","checkout","payment","profile","rewards","donate","filters","settings"]) pintar(v);

  w.editProfile(); recoger();                 // formulario de contacto
  pintar("profile");
  w.openReturnEditor(1); recoger();           // editor de devolución
  pintar("profile");

  a.orders[1].start = a.isoOffset(-5);        // pedido vencido: aviso de penalización
  a.orders[1].end = a.isoOffset(-1);
  pintar("profile");

  w.activateUserSession({ sub:"u1", name:"Ana", email:"a@b.com" });  // cuenta real: baja de cuenta
  pintar("settings");

  a.profile.redeemed = [{ id:1, rewardId:1, name:"Envío o retiro gratis", cost:60, date:hoy, usedIn:null }];
  a.cart = [{ id: 1 }];
  a.setCheckout({ delivery:"ship", address:"Av. Siempre Viva 123", returnMethod:"home",
    returnAddress:"Av. Siempre Viva 123", appliedCoupon:1 });
  pintar("checkout");                         // premio aplicado: quitarlo

  a.orders.push({ id:1004, date:a.isoOffset(-3), items:[7], start:a.isoOffset(-2), end:a.isoOffset(-1),
    delivery:"pickup", ret:"store", retAddr:"", pay:"cash", status:"settled", total:20,
    points:20, pointsCredited:true });
  w.openReview(1004); recoger();              // formulario de reseña

  a.cart = [{ id: 1 }];
  a.setCheckout({ delivery:"pickup", returnMethod:"store", payMethod:"cash" });
  w.placeOrder(); recoger();                  // confirmación del pedido

  _accionesDom = [...vistas].sort();
  return _accionesDom;
}

/**
 * Todo lo que la app llega a pintar: la UNIÓN de los dos caminos.
 * @returns {string[]}
 */
function accionesEmitidas() {
  return [...new Set([...accionesEnFuente(), ...accionesEnDOM()])].sort();
}

/** Los `case "…"` del switch del despachador. */
function accionesAtendidas() {
  const main = leer("main.js");
  return [...main.matchAll(/case\s+"([A-Za-z0-9_]+)"/g)].map(m => m[1]);
}

/* Ya no hace falta una lista de PREFIJOS_DINAMICOS: las acciones con el nombre
   armado en la plantilla (`gal…`) las ve el barrido del DOM, que es lo que se
   pinta de verdad. Una lista a mano de excepciones al escaneo es exactamente lo
   que envejece mal — nadie la revisa cuando el prefijo cambia. */

/**
 * Cases que hoy no los pinta nadie. HALLAZGO de `feature/tests-cobertura`, no
 * un permiso: `openSettings` quedó huérfano cuando Ajustes pasó a abrirse desde
 * el botón del header (`#openPrefs`, con su propio onclick en main.js). Se anota
 * aquí en vez de borrarlo porque esta rama no toca código de producción; le
 * toca a `feature/refactor-vistas`, que entonces debe vaciar esta lista.
 */
const CASES_MUERTOS_CONOCIDOS = ["openSettings"];

let win, doc, app;

beforeEach(() => {
  // withMain: el reparto de eventos vive en main.js, así que sin él estos
  // clics no llegarían a ninguna parte.
  const env = loadDom({ withMain: true });
  win = env.window;
  doc = env.document;
  app = env.app;
});

/* ---- Cobertura del switch ---- */
test("cada data-action que se pinta tiene su case en el despachador", () => {
  const sinAtender = accionesEmitidas().filter(a => !accionesAtendidas().includes(a));
  assert.deepEqual(sinAtender, [],
    "estos controles se dibujan pero no hacen nada al pulsarlos");
});

test("no aparecen cases huérfanos nuevos", () => {
  // Un case sin quien lo pinte es código muerto que el refactor arrastra sin
  // saberlo. La lista de los ya conocidos se declara arriba: esta prueba vigila
  // que no crezca, y fallará (a propósito) cuando el refactor la vacíe.
  const emitidas = accionesEmitidas();
  const huerfanos = accionesAtendidas().filter(a =>
    !emitidas.includes(a) &&
    !CASES_MUERTOS_CONOCIDOS.includes(a));

  assert.deepEqual(huerfanos, [], "cases nuevos que ya nadie dispara");
});

test("las acciones de nombre interpolado siguen teniendo case", () => {
  // `galPrev`/`galNext` se arman en la plantilla (`data-action="gal${dir}"`).
  // El barrido del DOM ya las ve, pero se nombran igual: son las que un escaneo
  // estático nunca pillará, y conviene que se caigan con un mensaje claro.
  for (const a of ["galPrev", "galNext", "galDot"]) {
    assert.ok(accionesAtendidas().includes(a), `falta el case de ${a}`);
  }
});

test("el barrido del DOM ve lo que el escaneo del fuente no puede ver", () => {
  // La razón de ser del barrido. Si esto deja de cumplirse es que la galería
  // pasó a escribir sus acciones literales — bien, pero entonces el barrido ya
  // no está demostrando nada y hay que revisarlo.
  const soloEnDOM = accionesEnDOM().filter(a => !accionesEnFuente().includes(a));
  assert.ok(soloEnDOM.length > 0,
    "el barrido no aporta ninguna acción que el fuente no tuviera");
});

test("el escaneo del fuente ve lo que el barrido no puede pintar", () => {
  // La otra mitad: `pickLocation` solo existe con clave de Google Maps, que en
  // las pruebas no hay. Por eso el inventario es la UNIÓN y no el barrido solo.
  const soloEnFuente = accionesEnFuente().filter(a => !accionesEnDOM().includes(a));
  assert.ok(soloEnFuente.includes("pickLocation"),
    `el fuente debería aportar al menos pickLocation; aporta ${JSON.stringify(soloEnFuente)}`);
});

test("el despachador atiende un número de acciones acorde al catálogo pintado", () => {
  // Cifra viva: si cae de golpe es que alguien borró medio switch.
  assert.ok(accionesAtendidas().length >= 40,
    `solo hay ${accionesAtendidas().length} acciones atendidas`);
});

/* ---- Convención de la casa ---- */
test("ninguna vista cablea onclick como atributo del HTML que genera", () => {
  // La delegación es la convención: un onclick dentro de una plantilla esquiva
  // el switch, que es donde se lee de un vistazo qué hace la app.
  // Solo se persigue el ATRIBUTO (`onclick="…"`). Asignar `el.onclick = fn` a un
  // elemento estático de index.html —lo que hace main.js con el header— es otra
  // cosa: ese nodo no se repinta nunca y no hay data-action que valga.
  // `onerror` del placeholder de imagen queda fuera a propósito: repara una
  // imagen rota en el sitio, no dispara ninguna acción.
  for (const f of FUENTES) {
    assert.doesNotMatch(leer(f), /onclick\s*=\s*["\']/,
      `${f} cablea un onclick como atributo en vez de usar data-action`);
  }
});

test("los controles no nativos declaran su rol y su foco", () => {
  // Un div con data-action no es pulsable con teclado si no lo declara; el
  // listener de Enter/Espacio de main.js depende de role="button".
  for (const f of FUENTES) {
    for (const m of leer(f).matchAll(/<div[^>]*data-action="[^"]+"[^>]*>/g)) {
      const tag = m[0];
      assert.match(tag, /role="button"/, `div pulsable sin role en ${f}: ${tag.slice(0, 80)}`);
      assert.match(tag, /tabindex=/, `div pulsable sin tabindex en ${f}: ${tag.slice(0, 80)}`);
    }
  }
});

/* ---- El reparto en vivo ---- */
test("pulsar un control del panel ejecuta su acción, no la del padre", () => {
  // El listener sube por el DOM hasta el primer [data-action]: si tomara el
  // contenedor en vez del botón, media interfaz haría lo que no toca.
  app.cart = [{ id: app.products[0].id }];
  app.view = "cart";
  win.renderSheet();
  win.openSheet();

  const btn = doc.querySelector('[data-action="toCheckout"]');
  assert.ok(btn, "el carrito debe ofrecer el paso siguiente");
  btn.click();
  assert.equal(app.view, "checkout", "la vista debe haber avanzado");
});

test("un clic fuera de todo control no rompe nada", () => {
  app.view = "cart";
  win.renderSheet();
  assert.doesNotThrow(() => doc.getElementById("sheetBody").click());
});

test("Enter y Espacio activan los controles con role=button", () => {
  // Sin esto, todo lo que no sea <button> queda fuera del alcance del teclado.
  app.view = "profile";
  win.renderSheet();
  const div = doc.querySelector('#sheet div[role="button"][data-action]');
  if (!div) return;   // la vista puede no tener ninguno; el guardarraíl de arriba ya cubre el marcado

  let pulsado = false;
  div.addEventListener("click", () => { pulsado = true; });
  const ev = new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true });
  div.dispatchEvent(ev);
  assert.ok(pulsado, "Enter debe traducirse en un clic");
});

test("el catálogo reparte entre agregar y abrir el detalle", () => {
  // Son dos acciones sobre la misma tarjeta: el botón agrega, la foto abre.
  win.renderGrid();
  const p = app.products[0];

  doc.querySelector(`[data-add="${p.id}"]`).click();
  assert.equal(app.cart.length, 1, "el botón agrega al carrito");

  doc.querySelector(`[data-detail="${p.id}"]`).click();
  assert.equal(app.view, "detail");
  assert.equal(app.detailId, p.id);
});
