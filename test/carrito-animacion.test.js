/**
 * Pruebas del ACUSE DE RECIBO al agregar una prenda al carrito.
 *
 * El badge cambia en una esquina que nadie mira mientras pulsa el botón, así
 * que la prenda vuela hasta él y el badge se sacude al recibirla. Lo que estas
 * pruebas vigilan no es la estética del vuelo —eso se mira con los ojos— sino
 * que sea *solo un adorno*: el carrito tiene que quedar igual de correcto sin
 * animación (menos movimiento, un navegador sin la API, jsdom), y el fantasma
 * no puede quedarse pegado a la pantalla.
 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadDom } = require("./helpers/load-dom.js");

let win, doc, app;

beforeEach(() => {
  const env = loadDom();
  win = env.window;
  doc = env.document;
  app = env.app;
});

/** Le da medidas a un elemento: jsdom no calcula layout y todo mide 0. */
function conMedidas(el, { left, top, width, height }) {
  el.getBoundingClientRect = () => ({
    left, top, width, height, right: left + width, bottom: top + height, x: left, y: top,
  });
}

/**
 * Prepara un vuelo posible: medidas en origen y destino, y un `animate` de
 * mentira que guarda la animación devuelta para poder darla por terminada.
 * @returns {{origin: Element, animaciones: object[]}}
 */
function prepararVuelo() {
  const origin = doc.createElement("div");
  origin.innerHTML = `<img src="img/products/1.webp">`;
  doc.body.appendChild(origin);
  conMedidas(origin, { left: 20, top: 300, width: 160, height: 200 });
  conMedidas(doc.getElementById("openCart"), { left: 340, top: 20, width: 40, height: 40 });

  const animaciones = [];
  // jsdom no trae la API de animaciones; se simula lo justo que usa flyToCart.
  win.Element.prototype.animate = function (keyframes, opts) {
    const anim = { keyframes, opts, onfinish: null, oncancel: null };
    animaciones.push(anim);
    return anim;
  };
  return { origin, animaciones };
}

/* ---- El texto del botón ---- */
test("la tarjeta invita a agregar al carrito, no a alquilar de golpe", () => {
  // "+ Alquilar" sonaba a cerrar el trato ahí mismo; el botón solo aparta la
  // prenda, y el detalle ya decía "Agregar al carrito".
  win.renderGrid();
  const btn = doc.querySelector(".card .add-btn");

  assert.match(btn.textContent, /Agregar al carrito/);
  assert.doesNotMatch(btn.textContent, /Alquilar/);
  assert.ok(btn.dataset.add, "el botón sigue llevando su data-add");
});

test("la prenda ya agregada sigue diciendo 'En carrito'", () => {
  const p = app.products[0];
  win.addToCart(p.id);
  win.renderGrid();

  const btn = doc.querySelector(`.add-btn[data-add="${p.id}"]`);
  assert.match(btn.textContent, /En carrito/);
});

/* ---- El vuelo ---- */
test("el vuelo sale de la miniatura y termina en el carrito", () => {
  const { origin, animaciones } = prepararVuelo();

  assert.equal(win.flyToCart(origin), true);
  const ghost = doc.querySelector(".fly-ghost");
  assert.ok(ghost, "debe haber un fantasma volando");
  assert.equal(ghost.style.left, "20px");
  assert.equal(ghost.style.top, "300px");
  assert.equal(ghost.style.width, "160px");

  // El último fotograma aterriza en el centro del carrito: (340+20) − (20+80)
  // en x y (20+20) − (300+100) en y.
  const ultimo = animaciones[0].keyframes.at(-1);
  assert.match(ultimo.transform, /translate\(260px, -360px\)/);
});

test("el fantasma se lleva la foto de la prenda", () => {
  // Un cuadro vacío cruzando la pantalla se lee como un error de carga.
  const { origin } = prepararVuelo();
  win.flyToCart(origin);
  assert.match(doc.querySelector(".fly-ghost").style.backgroundImage, /1\.webp/);
});

test("una prenda sin foto vuela igual, con el color de la marca", () => {
  const { origin } = prepararVuelo();
  origin.innerHTML = "";     // prenda sin imagen (placeholder)

  assert.equal(win.flyToCart(origin), true);
  assert.equal(doc.querySelector(".fly-ghost").style.backgroundImage, "");
});

test("al aterrizar, el fantasma se va y el badge acusa recibo", () => {
  // Si el fantasma sobreviviera al vuelo se quedaría clavado sobre la interfaz,
  // tapando lo que haya debajo y sin nada que lo quite.
  const { origin, animaciones } = prepararVuelo();
  win.flyToCart(origin);

  animaciones[0].onfinish();
  assert.equal(doc.querySelector(".fly-ghost"), null);
  assert.ok(doc.getElementById("badge").classList.contains("bump"));
});

test("un vuelo cancelado limpia igual que uno terminado", () => {
  // Pasar la pestaña a segundo plano cancela la animación a mitad de camino.
  const { origin, animaciones } = prepararVuelo();
  win.flyToCart(origin);

  animaciones[0].oncancel();
  assert.equal(doc.querySelector(".fly-ghost"), null);
});

/* ---- El adorno nunca manda ---- */
test("sin animación posible, la prenda entra igual al carrito", () => {
  // jsdom no trae Element.animate: es el mismo camino que un navegador viejo.
  const p = app.products[0];
  win.addToCart(p.id);

  assert.equal(app.cart.length, 1);
  assert.equal(doc.getElementById("badge").textContent, "1");
  assert.equal(doc.querySelector(".fly-ghost"), null);
  // Sin vuelo, el acuse recae en el badge.
  assert.ok(doc.getElementById("badge").classList.contains("bump"));
});

test("flyToCart no revienta sin origen ni con medidas en cero", () => {
  assert.equal(win.flyToCart(null), false);

  const suelto = doc.createElement("div");
  doc.body.appendChild(suelto);
  assert.equal(win.flyToCart(suelto), false, "un elemento sin layout no lanza vuelo");
  assert.equal(doc.querySelector(".fly-ghost"), null);
});

test("con 'menos movimiento' no vuela nada ni se sacude el badge", () => {
  // La preferencia es del usuario, no una sugerencia: el acuse se queda en el
  // conteo del badge y el toast, que no se mueven.
  app.setPref("reduceMotion", true);
  const { origin } = prepararVuelo();

  assert.equal(win.flyToCart(origin), false);
  assert.equal(doc.querySelector(".fly-ghost"), null);

  win.addToCart(app.products[0].id);
  assert.equal(doc.getElementById("badge").classList.contains("bump"), false);
  assert.equal(app.cart.length, 1, "la prenda entra igual al carrito");
});

test("agregar dos prendas seguidas sacude el badge las dos veces", () => {
  // La clase se quita y se vuelve a poner: si solo se pusiera, la segunda
  // prenda entraría sin acuse porque la animación ya estaba corriendo.
  const badge = doc.getElementById("badge");
  win.addToCart(app.products[0].id);
  badge.classList.remove("bump");          // como si la animación ya hubiera acabado

  win.addToCart(app.products[1].id);
  assert.ok(badge.classList.contains("bump"));
  assert.equal(badge.textContent, "2");
});

test("volver a agregar la misma prenda no la duplica ni vuelve a volar", () => {
  const { origin, animaciones } = prepararVuelo();
  const p = app.products[0];

  win.addToCart(p.id, origin);
  win.addToCart(p.id, origin);

  assert.equal(app.cart.length, 1);
  assert.equal(animaciones.length, 1, "el segundo intento no dibuja vuelo");
});
