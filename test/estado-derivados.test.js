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
