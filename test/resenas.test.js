/**
 * RESEÑAS de clientes: bloque en el detalle y alta desde el historial.
 *
 * Desde la fase 4 viven en el servidor (aquí, la API falsa). Lo que se vigila:
 *
 * 1. **Solo se reseña lo ya cumplido.** Es el mismo umbral que los puntos y las
 *    metas de agua (`countsForRewards`). El servidor lo vuelve a comprobar;
 *    aquí decide qué se ofrece.
 * 2. **Todo pasa por moderación.** Una reseña enviada no se ve en público: su
 *    autor la ve «En revisión», y el resto, nada hasta que se apruebe.
 * 3. **La media la deriva el servidor** de lo publicado; nunca se guarda.
 * 4. **Nada de reseñas en el navegador.** Ni en localStorage ni de muestra.
 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadDom } = require("./helpers/load-dom.js");

let win, doc, app, fake, flush;

beforeEach(async () => {
  const env = loadDom();
  ({ window: win, document: doc, app, fake, flush } = env);
  // Sesión real y no `currentUser` a mano: es activateUserSession quien fija la
  // clave de almacenamiento, y sin ella no hay nada que comprobar en disco.
  win.activateUserSession({ sub: "u1", name: "Ana" });
  // Los motivos de reporte llegan con /api/config, como al arrancar la app.
  await app.hydrateCalendar();
  await flush();
});

/**
 * Deja un pedido en el estado pedido, también en la API falsa (si la cuenta se
 * vuelve a sincronizar, el pedido sigue ahí).
 * @param {object} opts `cumplido` (entregado y ya no anulable) o pendiente.
 */
function pedido({ cumplido = true, items = [3], id = 1 } = {}) {
  const start = cumplido ? app.isoOffset(-2) : app.isoOffset(1);
  const o = {
    id, date: app.isoOffset(-3), items,
    start, end: app.isoOffset(5), deliveredAt: cumplido ? start : null,
    delivery: "pickup", ret: "local", retAddr: "",
    pay: "cash", status: "pending", total: 20, pointsCredited: true,
  };
  fake.seed(o);
  app.orders = [o];
  return o;
}

/** Publica en la API falsa una reseña ya aprobada de otra persona. */
function aprobada(productId, rating, text, date = "2026-07-01", extra = {}) {
  const r = { id: fake.state.nextReviewId++, orderId: 900 + rating, productId, rating, text, author: "Luis P.", date, status: "APROBADA", photo: null, ...extra };
  fake.state.reviews.push(r);
  return r;
}

/** Rellena el borrador y lo envía, esperando a la API. */
async function enviar({ rating = 5, text = "", productId } = {}) {
  app.openReview(1);
  if (productId) app.reviewProductId = productId;
  app.reviewRating = rating;
  app.reviewText = text;
  await app.submitReview();
  await flush();
}

/* ---- El umbral: solo lo cumplido ---- */
test("un pedido aún no entregado no se puede reseñar", () => {
  const o = pedido({ cumplido: false });
  assert.deepEqual(Array.from(app.reviewableItems(o)), []);
  assert.equal(app.hasPendingReview(o), false);
});

test("un pedido cumplido sí ofrece reseñar sus prendas", () => {
  const o = pedido({ items: [3, 5] });
  assert.deepEqual(Array.from(app.reviewableItems(o)), [3, 5]);
  assert.equal(app.hasPendingReview(o), true);
});

test("un pedido anulado no se puede reseñar", () => {
  const o = pedido();
  o.status = "cancelled";
  assert.deepEqual(Array.from(app.reviewableItems(o)), []);
});

test("el botón solo aparece cuando hay algo que reseñar", () => {
  pedido({ cumplido: false });
  win.renderProfile();
  assert.equal(doc.querySelectorAll('[data-action="openReview"]').length, 0);

  pedido();
  win.renderProfile();
  assert.equal(doc.querySelectorAll('[data-action="openReview"]').length, 1);
});

/* ---- Alta ---- */
test("con una sola prenda pendiente, se preselecciona", () => {
  pedido({ items: [3] });
  app.openReview(1);
  assert.equal(app.reviewProductId, 3);
});

test("con varias prendas hay que elegir una", () => {
  pedido({ items: [3, 5] });
  app.openReview(1);

  assert.equal(app.reviewProductId, null, "ninguna preseleccionada");
  assert.equal(app.reviewValid(), false, "sin prenda no se puede publicar");
  assert.equal(doc.querySelectorAll('[data-action="pickReviewItem"]').length, 2);
});

test("no se envía sin estrellas", () => {
  pedido();
  app.openReview(1);
  assert.equal(app.reviewValid(), false);

  app.reviewRating = 4;
  assert.equal(app.reviewValid(), true);
});

test("enviar la manda al servidor, queda «en revisión» y vuelve al perfil", async () => {
  pedido({ items: [3] });
  await enviar({ rating: 5, text: "  Quedó perfecta.  " });

  const enviada = fake.calls.find((c) => c.method === "POST" && c.path === "/api/reviews");
  assert.ok(enviada, "va a la API");
  assert.deepEqual([enviada.body.orderId, enviada.body.productId, enviada.body.rating, enviada.body.text], ["1", "3", "5", "Quedó perfecta."]);
  assert.equal(app.reviews.length, 1);
  assert.equal(app.reviews[0].status, "PENDIENTE");
  assert.equal(app.view, "profile");
  assert.match(doc.querySelector(".toast, #toast")?.textContent || "", /cuando la revisemos/);
});

test("el formulario avisa de que se revisa antes de publicarse", () => {
  pedido();
  app.openReview(1);
  assert.match(doc.querySelector(".rev-note").textContent, /cuando el equipo las revisa/);
});

test("la foto se envía como JPEG ya reducido", async () => {
  pedido({ items: [3] });
  app.openReview(1);
  app.reviewRating = 4;
  app.reviewPhotoBlob = new win.Blob(["jpeg"], { type: "image/jpeg" });
  await app.submitReview();
  await flush();
  assert.ok(fake.lastUpload.photo, "la foto viaja en el formulario");
  assert.equal(fake.lastUpload.photo.type, "image/jpeg");
  assert.equal(app.reviewPhotoBlob, null, "y el borrador la suelta");
});

test("si el servidor la rechaza, se dice por qué y el borrador sigue ahí", async () => {
  pedido({ items: [3] });
  app.openReview(1);
  app.reviewRating = 4;
  app.reviewText = "Mi texto";
  fake.failNext = { status: 409, error: "Podrás reseñarla cuando hayas recibido la prenda." };
  await app.submitReview();
  await flush();
  assert.equal(app.view, "review", "no se pierde lo escrito");
  assert.equal(app.reviewText, "Mi texto");
  assert.equal(app.reviews.length, 0);
  assert.match(doc.querySelector(".toast, #toast")?.textContent || "", /cuando hayas recibido/);
});

test("una prenda ya reseñada deja de ofrecerse en ese pedido", async () => {
  const o = pedido({ items: [3, 5] });
  await enviar({ productId: 3, rating: 4 });

  assert.deepEqual(Array.from(app.reviewableItems(o)), [3, 5], "el pedido no cambia");
  assert.ok(app.reviewFor(1, 3), "pero esa ya tiene reseña");
  assert.equal(app.hasPendingReview(o), true, "queda la otra");

  app.openReview(1);
  assert.equal(app.reviewProductId, 5, "se preselecciona la que falta");
});

test("reseñar la última prenda retira el botón del pedido", async () => {
  pedido({ items: [3] });
  await enviar({ rating: 4 });

  win.renderProfile();
  assert.equal(doc.querySelectorAll('[data-action="openReview"]').length, 0);
});

test("las reseñas propias llegan del servidor al sincronizar la cuenta", async () => {
  fake.state.reviews.push({ id: 77, orderId: 1, productId: 3, rating: 4, text: "", author: "Ana", date: "2026-07-01", status: "PENDIENTE", photo: null });
  await app.loadMyReviews();
  assert.ok(app.reviewFor(1, 3), "la app sabe que esa prenda ya está reseñada");
});

/* ---- El detalle ---- */
test("el detalle pide las reseñas publicadas y pinta su media", async () => {
  aprobada(3, 5, "Genial", "2026-07-01");
  aprobada(3, 3, "Correcta", "2026-07-02");
  app.openDetail(3);
  assert.match(doc.querySelector(".reviews").textContent, /Cargando reseñas/);
  await flush();

  assert.equal(app.productRating(3), 4);
  const bloque = doc.querySelector(".reviews");
  assert.match(bloque.textContent, /Genial/);
  assert.match(bloque.textContent, /Correcta/);
  assert.match(doc.querySelector(".rev-avg").textContent, /4\.0/);
  assert.match(doc.querySelector(".rev-avg").textContent, /\(2\)/);
});

test("lo pendiente no se ve en público: su autor lo ve «En revisión», sin contar en la media", async () => {
  pedido({ items: [3] });
  aprobada(3, 5, "Publicada");
  await enviar({ rating: 1, text: "La mía" });

  app.openDetail(3);
  await flush();
  const textos = Array.from(doc.querySelectorAll(".review"), (e) => e.textContent);
  assert.ok(textos.some((t) => /La mía/.test(t) && /En revisión/.test(t)), "el autor ve la suya marcada");
  assert.equal(app.productRating(3), 5, "la pendiente no mueve la media");
  assert.match(doc.querySelector(".rev-avg").textContent, /\(1\)/);
});

test("una prenda sin reseñas lo dice, no muestra un bloque vacío", async () => {
  app.openDetail(4);
  await flush();
  assert.match(doc.querySelector(".rev-empty").textContent, /Todavía no tiene reseñas/);
  assert.equal(doc.querySelector(".rev-avg"), null);
});

test("sin servidor no se inventan reseñas: se dice que hacen falta", () => {
  const sin = loadDom({ account: false });
  sin.app.openDetail(1);
  assert.match(sin.document.querySelector(".rev-empty").textContent, /con conexión/);
  assert.equal(sin.document.querySelectorAll(".review").length, 0, "ni de muestra");
});

test("la fecha de cada reseña se pinta legible", async () => {
  aprobada(3, 4, "Con fecha", "2026-07-15");
  app.openDetail(3);
  await flush();
  const fechas = Array.from(doc.querySelectorAll(".rev-date"), (e) => e.textContent);
  assert.ok(fechas.length, "el detalle debe pintar las fechas");
  for (const f of fechas) assert.doesNotMatch(f, /NaN|undefined/);
});

test("las reseñas se ordenan de la más reciente a la más antigua", async () => {
  aprobada(3, 5, "vieja", "2026-01-01");
  aprobada(3, 4, "nueva", "2026-07-01");
  await app.loadProductReviews(3);
  assert.deepEqual(Array.from(app.productReviews(3), (r) => r.text), ["nueva", "vieja"]);
});

/* ---- Contenido de usuario ---- */
test("el texto y la foto de la reseña se escapan antes de pintarse", async () => {
  // Es la superficie de XSS más grande de la app: texto de terceros en innerHTML.
  aprobada(3, 5, '<img src=x onerror="window.__hack=1">', "2026-07-01", { photo: 'x" onerror="window.__hack2=1' });
  app.openDetail(3);
  await flush();

  assert.equal(win.__hack, undefined, "no debe ejecutarse nada");
  assert.equal(win.__hack2, undefined);
  assert.equal(doc.querySelector(".rev-text img"), null, "ni inyectar marcado");
  assert.match(doc.querySelector(".rev-text").textContent, /onerror/);
});

/* ---- Nada en el navegador ---- */
test("las reseñas no se guardan en el almacenamiento del usuario", async () => {
  pedido({ items: [3] });
  await enviar({ rating: 4 });
  win.saveState();
  const guardado = JSON.parse(win.localStorage.getItem(app.activeStorageKey));
  assert.equal(guardado.reviews, undefined, "viven en el servidor");
});

test("las reseñas viejas guardadas en el navegador se ignoran", () => {
  const env = loadDom({ storage: { "clothToGo:v4:user:u9": JSON.stringify({ cart: [], reviews: [{ id: "r1", productId: 3, rating: 5 }] }) } });
  env.window.activateUserSession({ sub: "u9", name: "Eva" });
  assert.equal(env.app.reviews.length, 0);
});

test("retirar una reseña propia la borra en el servidor", async () => {
  pedido({ items: [3] });
  await enviar({ rating: 4 });
  const id = app.reviews[0].id;
  assert.equal(await app.deleteReview(id), true);
  assert.equal(app.reviews.length, 0);
  assert.equal(fake.state.reviews.length, 0);
  assert.equal(await app.deleteReview(12345), false, "una ajena o inexistente no");
});

/* ---- Aislamiento entre cuentas ---- */
test("las reseñas de una cuenta no asoman en la sesión de otra", async () => {
  pedido({ items: [3] });
  await enviar({ rating: 5 });
  assert.equal(app.reviews.length, 1);

  win.activateUserSession({ sub: "otro", name: "Luis" });
  assert.equal(app.reviews.length, 0);
  assert.deepEqual(Object.keys(app.productReviewCache), []);
});

test("si las reseñas no cargan, lo dice en vez de quedarse cargando", async () => {
  fake.failNext = { status: 500, error: "Error interno del servidor." };
  app.openDetail(3);
  await flush();
  assert.match(doc.querySelector(".rev-empty").textContent, /No se pudieron cargar/);
});

/* ---- Moderación ---- */
test("una reseña publicada ajena se puede reportar con un motivo de la lista", async () => {
  const r = aprobada(3, 2, "Spam total");
  app.openDetail(3);
  await flush();
  const boton = doc.querySelector('[data-action="reportReview"]');
  assert.ok(boton, "se ofrece reportar");
  // El reparto de clics vive en main.js (fuera de estas pruebas): se llama a lo
  // que despacha `reportReview` con el id del botón.
  app.openReportReview(Number(boton.dataset.id));
  const opciones = Array.from(doc.querySelectorAll('input[name="reportReason"]'), (i) => i.value);
  assert.deepEqual(opciones, ["OFENSIVO", "SPAM", "DATOS_PERSONALES", "FUERA_DE_TEMA"], "los motivos vienen de /api/config");
  doc.querySelector('input[name="reportReason"][value="SPAM"]').checked = true;
  app.confirmModalOk();
  await flush();

  assert.deepEqual(fake.state.reports, [{ reviewId: r.id, reason: "SPAM" }]);
  assert.equal(doc.querySelector('[data-action="reportReview"]'), null, "no se ofrece reportarla otra vez");
  assert.match(doc.querySelector(".rev-reported").textContent, /Reportada/);
});

test("la reseña propia no se ofrece para reportar, y sin sesión tampoco", async () => {
  pedido({ items: [3] });
  await enviar({ rating: 4, text: "Mía" });
  const mia = fake.state.reviews.at(-1);
  mia.status = "APROBADA";
  app.openDetail(3);
  await flush();
  assert.equal(doc.querySelectorAll(".review").length, 1);
  assert.equal(doc.querySelector('[data-action="reportReview"]'), null);

  const sin = loadDom({ account: false });
  sin.app.openDetail(1);
  assert.equal(sin.document.querySelector('[data-action="reportReview"]'), null);
});

test("el autor ve por qué se rechazó su reseña", async () => {
  pedido({ items: [3] });
  await enviar({ rating: 1, text: "Con mi teléfono 0999999999" });
  Object.assign(fake.state.reviews.at(-1), { status: "RECHAZADA", rejectReason: "DATOS_PERSONALES" });
  await app.loadMyReviews();
  app.openDetail(3);
  await flush();
  const texto = doc.querySelector(".review").textContent;
  assert.match(texto, /No publicada/);
  assert.match(texto, /Motivo: Datos personales/);
});
