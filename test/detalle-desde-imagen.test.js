/**
 * Detalle desde imagen: tocar la miniatura de una prenda en los pedidos del
 * perfil (activos e historial) abre su detalle en la pestaña APILADA, que
 * sube por encima del perfil sin tocarlo — el perfil conserva su scroll y su
 * estado, y cerrar la pestaña simplemente la baja.
 *
 * Lo crítico es esa independencia: si el detalle usara el panel principal,
 * volver implicaría re-renderizar el perfil y perder dónde estaba el usuario.
 */
const test = require("node:test");
const assert = require("node:assert");
const { loadDom } = require("./helpers/load-dom");

/** Monta la app con un pedido (activo o vencido según `end`). */
function conPedido(env, { end }) {
  const { app } = env;
  const p = app.products[0];
  app.orders = [{
    id: 1, date: app.isoOffset(-2), items: [p.id],
    start: app.isoOffset(-2), end,
    delivery: "pickup", ret: "store", pay: "cash",
    status: "settled", points: 0, pointsCredited: true, total: 10,
  }];
  return p;
}

/** Deja la app con el perfil abierto a pantalla completa, como en la app real. */
function conPerfilAbierto(env) {
  const { app } = env;
  app.view = "profile";
  app.renderSheet();
  app.openSheet();
}

test("detalle desde la imagen del pedido", async (t) => {
  await t.test("la miniatura en 'Mis pedidos' es pulsable y anuncia la prenda", () => {
    const env = loadDom();
    const { app, document } = env;
    const p = conPedido(env, { end: app.isoOffset(3) });
    conPerfilAbierto(env);
    const thumb = document.querySelector('.order-item .ci-thumb[data-action="openDetail"]');
    assert.ok(thumb, "falta la miniatura pulsable");
    assert.equal(+thumb.dataset.id, p.id);
    assert.equal(thumb.getAttribute("role"), "button", "sin role=button no hay teclado");
    assert.match(thumb.getAttribute("aria-label"), new RegExp(p.name));
  });

  await t.test("también en el historial de pedidos", () => {
    const env = loadDom();
    const { app, document } = env;
    // end en el pasado → el pedido cae en la sección de historial (archivado).
    conPedido(env, { end: app.isoOffset(-1) });
    conPerfilAbierto(env);
    assert.ok(document.querySelector('.order.archived') || document.querySelector('.order'),
      "el pedido debería estar renderizado");
    assert.ok(document.querySelector('.order-item .ci-thumb[data-action="openDetail"]'),
      "la miniatura del historial también debe abrir el detalle");
  });

  await t.test("desde el perfil sube la pestaña apilada sin tocar el panel principal", () => {
    const env = loadDom();
    const { app, document } = env;
    const p = conPedido(env, { end: app.isoOffset(3) });
    conPerfilAbierto(env);
    app.openDetail(p.id);
    assert.equal(app.stackOpen, true, "la pestaña apilada debe estar arriba");
    assert.equal(app.view, "profile", "la vista del panel principal no debe cambiar");
    assert.equal(app.sheetOpen, true, "el perfil sigue abierto debajo");
    assert.equal(app.sheetFull, true, "el perfil sigue a pantalla completa");
    assert.match(document.getElementById("stackBody").innerHTML, new RegExp(p.name),
      "la pestaña apilada debe mostrar la prenda");
  });

  await t.test("una prenda alquilada invita a volver, no a navegar al perfil", () => {
    const env = loadDom();
    const { app, document } = env;
    const p = conPedido(env, { end: app.isoOffset(3) });
    conPerfilAbierto(env);
    app.openDetail(p.id);
    const btn = document.querySelector('#stackFoot [data-action="goProfile"]');
    assert.ok(btn, "el pie debe llevar la acción de ir a mis pedidos");
    assert.match(btn.textContent, /Volver/,
      "apilado el perfil ya está debajo: se vuelve a él, no se navega");
  });

  await t.test("con el panel cerrado el detalle no se apila aunque `view` siga en perfil", () => {
    const env = loadDom();
    const { app } = env;
    const p = conPedido(env, { end: app.isoOffset(3) });
    conPerfilAbierto(env);
    // Cerrar el panel no toca `view`: sin mirar si está arriba, un detalle
    // abierto luego desde el catálogo se apilaría sobre una hoja invisible.
    app.closeSheet();
    app.openDetail(p.id);
    assert.equal(app.stackedDetail, false);
    assert.equal(app.stackOpen, false, "nada debe apilarse con el panel abajo");
    assert.equal(app.view, "detail", "el detalle usa el panel principal");
  });

  await t.test("cerrar la pestaña apilada deja el perfil tal cual estaba", () => {
    const env = loadDom();
    const { app, document } = env;
    const p = conPedido(env, { end: app.isoOffset(3) });
    conPerfilAbierto(env);
    const antes = document.getElementById("sheetBody").innerHTML;
    app.openDetail(p.id);
    app.closeStackSheet();
    assert.equal(app.stackOpen, false);
    assert.equal(app.view, "profile");
    assert.equal(app.sheetOpen, true, "el perfil debe seguir abierto");
    assert.equal(document.getElementById("sheetBody").innerHTML, antes,
      "el perfil no debe re-renderizarse al abrir/cerrar el detalle");
  });

  await t.test("desde el catálogo el detalle usa el panel principal, sin pestaña apilada", () => {
    const { app } = loadDom();
    app.openDetail(app.products[0].id);
    assert.equal(app.view, "detail");
    assert.equal(app.detailId, app.products[0].id);
    assert.equal(app.stackOpen, false, "sin origen, nada se apila");
    assert.equal(app.sheetFull, false, "el detalle del catálogo sigue siendo panel");
  });
});
