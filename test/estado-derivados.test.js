/**
 * Pruebas de los DERIVADOS de `js/state.js` que nadie tocaba directamente:
 * conteos, cargos de envío, tasa de volumen, agua del carrito, id del siguiente
 * pedido y el reseteo de estado entre sesiones.
 *
 * Son funciones de una línea, y esa es justamente la razón de cubrirlas: el
 * refactor las va a mover o fundir, y ninguna tiene hoy una prueba que diga qué
 * debía devolver. Varias son la base de dinero — cambiar `shippingFee()` sin
 * red equivale a cobrar mal sin enterarse.
 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadDom } = require("./helpers/load-dom.js");

let win, app;

beforeEach(() => {
  const env = loadDom();
  win = env.window;
  app = env.app;
});

/* ---- Conteo y precio unitario del carrito ---- */
test("cartCount cuenta las prendas del carrito", () => {
  assert.equal(win.cartCount(), 0);
  app.cart = [{ id: 1 }, { id: 2 }];
  assert.equal(win.cartCount(), 2);
});

test("cartItemPrice aplica los días y el volumen VIGENTES del carrito", () => {
  // No es el precio de catálogo: la misma prenda vale distinto según cuántas
  // más lleve el carrito y cuántos días dure el alquiler.
  const p = app.products[0];
  app.cart = [{ id: p.id }];
  const sola = win.cartItemPrice(p);

  app.cart = [{ id: p.id }, { id: app.products[1].id }, { id: app.products[2].id }];
  assert.ok(win.cartItemPrice(p) <= sola, "con más prendas no puede salir más cara");
  assert.equal(win.cartItemPrice(p), win.rentalPrice(p, win.rentalDays(), 3));
});

test("volumeRate sube con las prendas y se topa", () => {
  const tasa = n => { app.cart = Array.from({ length: n }, (_, i) => ({ id: i + 1 })); return win.volumeRate(); };
  assert.equal(tasa(1), 0, "una prenda no tiene descuento por volumen");
  assert.ok(tasa(3) > tasa(2));
  assert.ok(tasa(10) <= 0.20, "el descuento por volumen está topado");
});

/* ---- Cargos de envío ---- */
test("los cargos dependen del modo elegido, y son independientes entre sí", () => {
  app.setCheckout({ delivery: "pickup", returnMethod: "store" });
  assert.equal(win.shippingFee(), 0);
  assert.equal(win.returnFee(), 0);

  app.setCheckout({ delivery: "ship" });
  assert.equal(win.shippingFee(), app.SHIPPING_FEE);
  assert.equal(win.returnFee(), 0, "que lo traigan no implica que lo recojan");

  app.setCheckout({ returnMethod: "home" });
  assert.equal(win.returnFee(), app.SHIPPING_FEE);
});

test("grandTotal suma exactamente sus partes", () => {
  // La red que hace falta antes de mover la fórmula: si el refactor pierde un
  // sumando, esto lo dice; el total en pantalla, no.
  app.cart = [{ id: app.products[0].id }, { id: app.products[3].id }];
  app.setCheckout({ delivery: "ship", returnMethod: "home" });

  const esperado = app.subtotal() + app.depositTotal() + win.shippingFee()
                 + win.returnFee() - app.couponDiscount();
  assert.ok(Math.abs(app.grandTotal() - esperado) < 1e-9);
});

/* ---- Agua del carrito ---- */
test("cartWaterSaved es el agua de lo que hay en el carrito, no de lo alquilado", () => {
  // El del carrito es una promesa ("ahorrarías"); el histórico solo cuenta
  // pedidos cumplidos. Confundirlos regalaría puntos por llenar el carrito.
  const p = app.products[0];
  app.cart = [{ id: p.id }];
  assert.equal(win.cartWaterSaved(), app.waterSavedForItems([p.id]));

  app.cart = [];
  assert.equal(win.cartWaterSaved(), 0);
  assert.equal(app.totalWaterSaved(), 0, "sin pedidos cumplidos no hay histórico");
});

/* ---- Identificadores de pedido ---- */
test("nextOrderId no repite ni retrocede", () => {
  assert.equal(win.nextOrderId(), 1001, "el primero arranca por encima de 1000");

  app.orders = [{ id: 1001 }, { id: 1005 }, { id: 1003 }];
  assert.equal(win.nextOrderId(), 1006, "toma el mayor, no el último");

  // Un id heredado más bajo no debe hacer que el siguiente pise a uno existente.
  app.orders = [{ id: 7 }];
  assert.ok(win.nextOrderId() > 1000);
});

/* ---- Reseteo entre sesiones ---- */
test("defaultProfile devuelve un perfil nuevo cada vez", () => {
  // Si compartieran referencia, editar el perfil de una sesión editaría el de
  // la siguiente: el fallo más silencioso posible con dos cuentas.
  const a = win.defaultProfile();
  const b = win.defaultProfile();
  a.points = 50;
  a.redeemed.push({ id: 1 });

  assert.equal(b.points, 0);
  assert.equal(b.redeemed.length, 0);
  assert.notEqual(a.redeemed, b.redeemed);
});

test("resetStateToDefaults deja carrito, pedidos, reseñas y perfil en blanco", () => {
  app.cart = [{ id: 1 }];
  app.orders = [{ id: 1001 }];
  app.reviews = [{ id: 1 }];
  app.profile.points = 300;

  win.resetStateToDefaults();

  assert.equal(app.cart.length, 0);
  assert.equal(app.orders.length, 0);
  assert.equal(app.reviews.length, 0, "las reseñas de otra cuenta no pueden asomar");
  assert.equal(app.profile.points, 0);
});
