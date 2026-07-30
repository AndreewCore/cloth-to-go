/**
 * Regresión del LOGIN EN PRODUCCIÓN (v0.6.0).
 *
 * En `andreewcore.github.io` la app se negaba a iniciar sesión porque
 * `DEPLOYED_API` es null: Google completaba su parte, la credencial llegaba y
 * el callback la rechazaba. Peor todavía, el aviso salía por `toast()`, que
 * quedaba DETRÁS de la pantalla de bienvenida — desde fuera, el botón
 * simplemente no hacía nada.
 *
 * Estas pruebas fijan las dos mitades del contrato, que es lo delicado: sin
 * backend hay que dejar entrar (identifica, no autoriza), y CON backend hay que
 * seguir exigiendo la verificación del servidor. Arreglar lo primero sin romper
 * lo segundo es todo el objetivo del arreglo.
 */
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadDom } = require("./helpers/load-dom.js");

const PROD_URL = "https://andreewcore.github.io/cloth-to-go/";

// Un ID token de Google real trae header.payload.signature; para el decode
// local solo importa el payload, y la firma no se comprueba (ese es el punto).
function fakeIdToken(claims) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256" })}.${b64(claims)}.firma-no-verificada`;
}

const CLAIMS = {
  sub: "999",
  name: "Andreew Core",
  email: "andreew@example.com",
  picture: "https://example.com/foto.jpg",
};

/**
 * Monta la app y sustituye `enter()`, que vive en main.js y no se carga en las
 * pruebas de DOM. Devuelve un flag para comprobar si se llegó a entrar.
 */
function setup(opts) {
  const env = loadDom(opts);
  const entered = { called: false, name: null };
  env.window.enter = name => { entered.called = true; entered.name = name; };
  return { ...env, entered };
}

let env;

afterEach(() => { env = null; });

/* ---- Sin backend: identifica y entra ---- */
test("en producción sin backend, iniciar sesión con Google entra a la app", async () => {
  env = setup({ url: PROD_URL });
  // El escenario exacto del fallo: host de producción y DEPLOYED_API en null.
  assert.equal(env.app.backend.enabled, false);
  assert.equal(env.app.backend.reason, "misconfigured");

  await env.window.onGoogleCredential({ credential: fakeIdToken(CLAIMS) });

  assert.equal(env.entered.called, true, "debe entrar a la app");
  assert.equal(env.app.currentUser.sub, "999");
});

test("la identidad de Google rellena el perfil", async () => {
  env = setup({ url: PROD_URL });
  await env.window.onGoogleCredential({ credential: fakeIdToken(CLAIMS) });

  assert.equal(env.app.profile.name, "Andreew Core");
  assert.equal(env.app.profile.email, "andreew@example.com");
  assert.equal(env.app.profile.picture, "https://example.com/foto.jpg");
});

test("un token ilegible no entra, y lo dice", async () => {
  env = setup({ url: PROD_URL });
  await env.window.onGoogleCredential({ credential: "esto-no-es-un-jwt" });

  assert.equal(env.entered.called, false);
  const hint = env.document.getElementById("loginHint");
  assert.equal(hint.hidden, false, "el aviso debe quedar a la vista");
  assert.match(hint.textContent, /no se pudo/i);
});

/* ---- Con backend: la verificación del servidor sigue siendo obligatoria ---- */
test("con backend, un token que el servidor rechaza NO inicia sesión", async () => {
  env = setup({
    url: "https://cloth.test/",
    storage: { "clothToGo:apiBase": "https://api.cloth.test" },
  });
  assert.equal(env.app.backend.enabled, true);

  // El servidor rechaza: verifyGoogleCredential devuelve null.
  env.window.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });

  await env.window.onGoogleCredential({ credential: fakeIdToken(CLAIMS) });

  assert.equal(env.entered.called, false, "no puede entrar sin verificación");
  assert.equal(env.app.currentUser, null);
});

test("con backend, NO se cae al decode local (sería anular la verificación)", async () => {
  env = setup({
    url: "https://cloth.test/",
    storage: { "clothToGo:apiBase": "https://api.cloth.test" },
  });
  // El servidor no responde: ni así vale el token sin verificar.
  env.window.fetch = async () => { throw new Error("red caída"); };

  await env.window.onGoogleCredential({ credential: fakeIdToken(CLAIMS) });

  assert.equal(env.entered.called, false);
  assert.equal(env.app.profile.email, "", "el perfil no debe rellenarse");
});

/* ---- El aviso de la bienvenida ---- */
test("el aviso de login se limpia al reintentar y al cerrar sesión", async () => {
  env = setup({ url: PROD_URL });
  const hint = env.document.getElementById("loginHint");

  await env.window.onGoogleCredential({ credential: "roto" });
  assert.equal(hint.hidden, false);

  // Un intento nuevo empieza sin el error del anterior colgando.
  await env.window.onGoogleCredential({ credential: fakeIdToken(CLAIMS) });
  assert.equal(hint.hidden, true);
  assert.equal(hint.textContent, "");
});

/* ---- La capa del toast ---- */
test("el toast se dibuja por encima de la pantalla de bienvenida", () => {
  // Se comprueba sobre el CSS y no con getComputedStyle porque jsdom no baja
  // las hojas externas. Es una invariante de capas: si el toast vuelve a
  // quedar por debajo del login, los fallos de esa pantalla se vuelven mudos.
  const css = fs.readFileSync(
    path.join(__dirname, "..", "css", "components.css"), "utf8");

  const zIndexDe = selector => {
    const bloque = new RegExp(`\\${selector}\\s*\\{[^}]*\\}`, "m").exec(css);
    assert.ok(bloque, `no se encontró la regla ${selector}`);
    const z = /z-index:\s*(\d+)/.exec(bloque[0]);
    assert.ok(z, `${selector} no declara z-index`);
    return Number(z[1]);
  };

  assert.ok(zIndexDe(".toast") > zIndexDe(".login"),
    "el toast debe quedar por encima de la bienvenida");
});
