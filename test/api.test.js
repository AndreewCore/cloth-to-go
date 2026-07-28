/**
 * Pruebas del PUENTE con el backend (api.js): a qué origen se habla según dónde
 * corra la app, y que el catálogo embebido se reemplace sin romper el índice.
 *
 * Es la lógica que mantiene viva la demo cuando no hay servidor: si resolveApiBase
 * se equivoca, o la app deja de abrir por file://, o intenta peticiones que el
 * navegador bloquea. Cada caso se monta con su propio origen (loadDom({url})),
 * porque api.js resuelve `backend` al cargarse.
 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadDom } = require("./helpers/load-dom.js");

// Monta la app en un origen concreto y devuelve su API.
const at = (url, storage) => loadDom({ url, storage });

const OVERRIDE_KEY = "clothToGo:apiBase";

let win, app;
beforeEach(() => {
  const env = loadDom();
  win = env.window;
  app = env.app;
});

/* ---- Resolución del backend según el origen ---- */
test("por file:// no se consulta al backend y se dice por qué", () => {
  const { app: a } = at("file:///home/user/index.html");
  assert.deepEqual({ ...a.backend }, { enabled: false, reason: "file" });
});

test("en desarrollo el backend se deriva del host que sirve la página", () => {
  // Derivarlo (y no fijar "localhost") permite abrir la demo desde el móvil
  // contra la laptop que la sirve.
  const { app: a } = at("http://192.168.1.50:8000/index.html");
  assert.equal(a.backend.enabled, true);
  assert.equal(a.backend.base, "http://192.168.1.50:3000");
});

test("localhost apunta al backend local en el puerto de desarrollo", () => {
  const { app: a } = at("http://localhost:8000/index.html");
  assert.equal(a.backend.base, "http://localhost:3000");
});

test("en producción (https) no hay backend publicado todavía", () => {
  const { app: a } = at("https://andreewcore.github.io/cloth-to-go/");
  assert.deepEqual({ ...a.backend }, { enabled: false, reason: "undeployed" });
});

test("una página https nunca habla con un backend http (mixed content)", () => {
  // El navegador bloquearía la petición antes de que saliera.
  const { app: a } = at("https://cloth.test/", { [OVERRIDE_KEY]: "http://localhost:3000" });
  assert.deepEqual({ ...a.backend }, { enabled: false, reason: "mixed" });
  assert.equal(a.isMixedContent("http://localhost:3000"), true);
  assert.equal(a.isMixedContent("https://api.cloth.test"), false);
});

/* ---- Override desde localStorage ---- */
test("el override de localStorage manda sobre el host", () => {
  const { app: a } = at("http://localhost:8000/", { [OVERRIDE_KEY]: "http://api.local:9000/lo-que-sea" });
  assert.equal(a.backend.enabled, true);
  assert.equal(a.backend.base, "http://api.local:9000");   // se queda con el origen
});

test("un override que no es URL http(s) se rechaza en vez de usarse", () => {
  for (const malo of ["hola", "javascript:alert(1)", "ftp://x.test"]) {
    const { app: a } = at("http://localhost:8000/", { [OVERRIDE_KEY]: malo });
    assert.deepEqual({ ...a.backend }, { enabled: false, reason: "override" },
      `debería rechazar: ${malo}`);
  }
});

test("el override tampoco exime de las reglas del navegador", () => {
  // Aunque el override sea una URL válida, sigue pasando por mixed content:
  // elegir el destino no es lo mismo que saltarse al navegador.
  // (El caso gemelo de file:// no se puede montar aquí: jsdom da un origen
  // opaco y sembrar localStorage lanza antes de que la app arranque.)
  const { app: a } = at("https://cloth.test/", { [OVERRIDE_KEY]: "http://api.local:9000" });
  assert.deepEqual({ ...a.backend }, { enabled: false, reason: "mixed" });
});

test("sin override no se altera la resolución normal", () => {
  const { app: a } = at("http://localhost:8000/");
  assert.equal(a.backend.base, a.backendForHost());
});

/* ---- Reemplazo del catálogo ---- */
test("replaceCatalog cambia el catálogo conservando la referencia global", () => {
  const antes = app.productCount;
  const nuevos = [
    { id: 901, name: "Prenda API", cat: "Casual", size: "M", material: "algodon",
      stars: 4, value: 40, disponibles: 1, desc: "Traída del backend", img: "" },
    { id: 902, name: "Otra API", cat: "Formal", size: "L", material: "lino",
      stars: 5, value: 60, disponibles: 1, desc: "También del backend", img: "" }
  ];

  win.replaceCatalog(nuevos);

  assert.notEqual(app.productCount, antes);
  assert.equal(app.productCount, 2);
  // El índice se reconstruye: productById debe ver lo nuevo y olvidar lo viejo.
  assert.equal(app.productById(901).name, "Prenda API");
  assert.equal(app.productById(7), undefined);
});

test("tras reemplazar el catálogo, la grilla se repinta con lo nuevo", () => {
  win.replaceCatalog([
    { id: 901, name: "Prenda API", cat: "Casual", size: "M", material: "algodon",
      stars: 4, value: 40, disponibles: 1, desc: "Traída del backend", img: "" }
  ]);
  win.renderGrid();

  const grid = win.document.getElementById("grid");
  assert.match(grid.innerHTML, /Prenda API/);
  assert.match(win.document.getElementById("resultsBar").innerHTML, />1 prenda</);
});

/* ---- hydrateCatalog: degradación silenciosa ---- */
test("sin backend alcanzable, hydrateCatalog no toca el catálogo local", async () => {
  const { window: w, app: a } = at("file:///home/user/index.html");
  const antes = a.productCount;

  assert.equal(await w.hydrateCatalog(), false);
  assert.equal(a.productCount, antes);
});

test("si el fetch falla, la demo se queda con los datos embebidos", async () => {
  const { window: w, app: a } = at("http://localhost:8000/");
  const antes = a.productCount;
  w.fetch = () => Promise.reject(new Error("ECONNREFUSED"));

  assert.equal(await w.hydrateCatalog(), false);
  assert.equal(a.productCount, antes);
});

test("una respuesta vacía del backend no deja el catálogo sin prendas", async () => {
  const { window: w, app: a } = at("http://localhost:8000/");
  const antes = a.productCount;
  w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve([]) });

  assert.equal(await w.hydrateCatalog(), false);
  assert.equal(a.productCount, antes, "una lista vacía se ignora");
});

test("con backend disponible, el catálogo se hidrata desde la API", async () => {
  const { window: w, app: a } = at("http://localhost:8000/");
  w.fetch = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve([
      { id: 901, name: "Prenda API", cat: "Casual", size: "M", material: "algodon",
        stars: 4, value: 40, disponibles: 1, desc: "Del backend", img: "" }
    ])
  });

  assert.equal(await w.hydrateCatalog(), true);
  assert.equal(a.productCount, 1);
  assert.equal(a.productById(901).name, "Prenda API");
});

test("un HTTP de error se trata como backend caído, no como catálogo vacío", async () => {
  const { window: w, app: a } = at("http://localhost:8000/");
  const antes = a.productCount;
  w.fetch = () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve([]) });

  assert.equal(await w.hydrateCatalog(), false);
  assert.equal(a.productCount, antes);
});

/* ---- verifyGoogleCredential ---- */
test("sin backend, verificar el login devuelve null (modo demo)", async () => {
  const { window: w } = at("file:///home/user/index.html");
  assert.equal(await w.verifyGoogleCredential("token"), null);
});

test("con backend, un token rechazado no da identidad", async () => {
  const { window: w } = at("http://localhost:8000/");
  w.fetch = () => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
  assert.equal(await w.verifyGoogleCredential("token-malo"), null);
});

test("con backend, un token válido devuelve la identidad verificada", async () => {
  const { window: w } = at("http://localhost:8000/");
  w.fetch = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ user: { sub: "111", name: "Ana Ruiz", email: "a@b.c", picture: "" } })
  });

  const user = await w.verifyGoogleCredential("token-bueno");
  assert.equal(user.sub, "111");
  assert.equal(user.name, "Ana Ruiz");
});
