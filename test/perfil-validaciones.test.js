/**
 * Pruebas de las reglas de la información de contacto:
 *
 *  - el correo de una cuenta de Google no se edita (y no basta con esconder el
 *    campo: se comprueba que un DOM manipulado tampoco lo cambie),
 *  - el correo del invitado debe ser de un proveedor aceptado,
 *  - el celular es ecuatoriano (+593, `09` + 8 dígitos),
 *  - el nombre se puede fijar al registrarse y después una vez cada 7 días.
 *
 * La verificación por SMS se prueba como lo que es hoy: un aviso que informa de
 * que la función está pendiente, sin dejar el número dado por bueno.
 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadDom } = require("./helpers/load-dom.js");
const { loadApp } = require("./helpers/load-app.js");

let win, doc, app;

beforeEach(() => {
  // withMain: hace falta la delegación real de main.js — una de las reglas del
  // celular (recortar a 10 dígitos) vive en el listener de `input`, no en el
  // render, y sin cargar main.js no habría nada que la ejecutara.
  const env = loadDom({ withMain: true });
  win = env.window;
  doc = env.document;
  app = env.app;
});

/** Entra al formulario y rellena los tres campos que existan. */
function editar({ name, email, phone }) {
  win.editProfile();
  const set = (id, v) => { const el = doc.getElementById(id); if (el && v !== undefined) el.value = v; };
  set("pfName", name);
  set("pfEmail", email);
  set("pfPhone", phone);
}

/* ================= Validadores puros ================= */

test("isValidEcPhone: 09 + 8 dígitos, ni uno más ni uno menos", () => {
  const A = loadApp();
  assert.ok(A.isValidEcPhone("0991234567"));
  assert.ok(A.isValidEcPhone("0987654321"));
  assert.ok(!A.isValidEcPhone("099123456"),   "9 dígitos: se quedó corto");
  assert.ok(!A.isValidEcPhone("09912345678"), "11 dígitos: se pasó");
  assert.ok(!A.isValidEcPhone("0812345678"),  "no empieza por 09");
  // Un fijo de Guayaquil (04 + 7) tiene 9 dígitos y empieza por 0: es
  // exactamente el error que este campo debe atrapar.
  assert.ok(!A.isValidEcPhone("042345678"));
  assert.ok(!A.isValidEcPhone("+593991234567"), "el internacional no va en el campo nacional");
  assert.ok(!A.isValidEcPhone("099 123 4567"), "espacios");
  assert.ok(!A.isValidEcPhone(""));
});

test("phoneToE164: cambia el 0 nacional por +593, y calla si el número no vale", () => {
  const A = loadApp();
  assert.equal(A.phoneToE164("0991234567"), "+593991234567");
  assert.equal(A.phoneToE164("  0991234567  "), "+593991234567");
  assert.equal(A.phoneToE164("12345"), "");
});

test("isAllowedEmailDomain: proveedores de la lista, sin importar mayúsculas", () => {
  const A = loadApp();
  for (const d of ["gmail.com", "outlook.com", "outlook.es", "hotmail.com", "hotmail.es", "yahoo.com"]) {
    assert.ok(A.isAllowedEmailDomain(`ana@${d}`), d);
  }
  assert.ok(A.isAllowedEmailDomain("Ana@GMAIL.COM"), "el dominio no distingue mayúsculas");
  assert.ok(!A.isAllowedEmailDomain("ana@mi-dominio.com"));
  assert.ok(!A.isAllowedEmailDomain("ana@gmail.com.mx"), "no basta con empezar por gmail.com");
  assert.ok(!A.isAllowedEmailDomain("ana"));
});

test("isValidContactEmail exige forma Y proveedor", () => {
  const A = loadApp();
  assert.ok(A.isValidContactEmail("ana@gmail.com"));
  assert.ok(!A.isValidContactEmail("ana@gmail"),        "sin TLD no es correo");
  assert.ok(!A.isValidContactEmail("ana@empresa.com"),  "proveedor fuera de la lista");
});

/* ================= Correo: cuenta de Google vs invitado ================= */

test("con cuenta de Google el correo se muestra bloqueado y explicado", () => {
  win.activateUserSession({ sub: "111", name: "Ana Ruiz", email: "ana@gmail.com" });
  win.editProfile();
  const email = doc.getElementById("pfEmail");
  assert.ok(email.hasAttribute("readonly"), "el campo de correo no se edita");
  assert.match(doc.getElementById("sheetBody").innerHTML, /cuenta de Google/,
    "se dice por qué está bloqueado, no solo que lo está");
});

test("el correo de Google no cambia aunque se fuerce el campo desde el DOM", () => {
  // `readonly` es ayuda visual, no defensa: quitarlo es un clic en el navegador.
  // Lo que tiene que aguantar es saveProfile, que lee del perfil y no del DOM.
  win.activateUserSession({ sub: "111", name: "Ana Ruiz", email: "ana@gmail.com" });
  editar({ phone: "0991234567" });
  const email = doc.getElementById("pfEmail");
  email.removeAttribute("readonly");
  email.value = "otra@gmail.com";
  win.saveProfile();

  assert.equal(app.profile.email, "ana@gmail.com", "sigue mandando el correo de la sesión");
});

test("el invitado sí escribe su correo, pero solo de un proveedor aceptado", () => {
  win.activateUserSession(null);
  editar({ name: "Ana Ruiz", email: "ana@midominio.com", phone: "0991234567" });
  win.saveProfile();

  assert.notEqual(app.profile.email, "ana@midominio.com", "no se guardó");
  const err = doc.getElementById("errEmail");
  assert.equal(err.style.display, "block");
  assert.match(err.textContent, /Gmail|Outlook|Hotmail|Yahoo/,
    "el error dice qué proveedores sirven, no solo que ese no");
});

test("el invitado con un correo bien formado y aceptado sí guarda", () => {
  win.activateUserSession(null);
  editar({ name: "Ana Ruiz", email: "ana@hotmail.es", phone: "0991234567" });
  win.saveProfile();

  assert.equal(app.profile.email, "ana@hotmail.es");
  assert.equal(app.profile.phone, "0991234567");
});

test("correo malformado y proveedor rechazado dan mensajes distintos", () => {
  win.activateUserSession(null);

  editar({ name: "Ana Ruiz", email: "ana-sin-arroba", phone: "0991234567" });
  win.saveProfile();
  const malformado = doc.getElementById("errEmail").textContent;

  editar({ name: "Ana Ruiz", email: "ana@empresa.com", phone: "0991234567" });
  win.saveProfile();
  const rechazado = doc.getElementById("errEmail").textContent;

  assert.notEqual(malformado, rechazado,
    "dos problemas con dos arreglos distintos no pueden compartir mensaje");
});

/* ================= Celular ================= */

test("el formulario muestra el código de país y el formato esperado", () => {
  win.activateUserSession(null);
  win.editProfile();
  const html = doc.getElementById("sheetBody").innerHTML;
  assert.match(html, /\+593/, "el prefijo país está a la vista");
  assert.match(html, /empieza por 09/i);
  assert.equal(doc.getElementById("pfPhone").getAttribute("maxlength"), "10");
});

test("un celular que no es de Ecuador no se guarda y lo dice", () => {
  win.activateUserSession(null);
  editar({ name: "Ana Ruiz", email: "ana@gmail.com", phone: "042345678" });
  win.saveProfile();

  assert.equal(app.profile.phone, "", "no se guardó el fijo en el campo de celular");
  const err = doc.getElementById("errPhone");
  assert.equal(err.style.display, "block");
  assert.match(err.textContent, /09/);
});

test("al teclear, el campo recorta a 10 dígitos y descarta lo que no sea número", () => {
  win.activateUserSession(null);
  win.editProfile();
  const el = doc.getElementById("pfPhone");
  el.value = "+593 99-123-4567";
  el.dispatchEvent(new win.Event("input", { bubbles: true }));
  assert.equal(el.value, "5939912345", "solo dígitos y como mucho 10");
});

/* ================= Verificación por SMS (pendiente) ================= */

test("verificar el celular solo informa: no da el número por verificado", () => {
  win.activateUserSession(null);
  editar({ name: "Ana Ruiz", email: "ana@gmail.com", phone: "0991234567" });
  win.verifyPhone();

  const modal = doc.getElementById("modalDetail").innerHTML;
  assert.match(modal, /\+593991234567/, "muestra el número en formato internacional");
  assert.match(modal, /pendiente|todav[íi]a no/i, "admite que la función no está");
  assert.equal(doc.getElementById("modalCancel").classList.contains("is-hidden"), true,
    "es un aviso, no una decisión: no ofrece Cancelar");
  assert.ok(!("phoneVerified" in app.profile), "no se inventa un estado de verificado");
});

test("sin un celular válido, el aviso pide el número antes que el código", () => {
  win.activateUserSession(null);
  editar({ name: "Ana Ruiz", email: "ana@gmail.com", phone: "12" });
  win.verifyPhone();

  const modal = doc.getElementById("modalDetail").innerHTML;
  assert.doesNotMatch(modal, /\+593\d/, "no hay número internacional que mostrar");
  assert.match(modal, /09/);
});

/* ================= Nombre: una vez cada 7 días ================= */

test("el primer nombre es libre y arranca el reloj", () => {
  win.activateUserSession(null);
  assert.equal(app.profile.nameChangedAt, "", "un perfil nuevo no tiene marca");
  assert.equal(win.canChangeName(), true);

  editar({ name: "Ana Ruiz", email: "ana@gmail.com", phone: "0991234567" });
  win.saveProfile();

  assert.equal(app.profile.name, "Ana Ruiz");
  assert.equal(app.profile.nameChangedAt, win.isoOffset(), "queda fechado hoy");
  assert.equal(win.canChangeName(), false, "el segundo cambio ya espera");
});

test("guardar sin tocar el nombre no cuesta una semana de espera", () => {
  win.activateUserSession(null);
  editar({ name: "Ana Ruiz", email: "ana@gmail.com", phone: "0991234567" });
  win.saveProfile();
  app.profile.nameChangedAt = "";      // como si nunca lo hubiera cambiado

  editar({ name: "Ana Ruiz", email: "ana@gmail.com", phone: "0987654321" });
  win.saveProfile();

  assert.equal(app.profile.phone, "0987654321", "el resto sí se guardó");
  assert.equal(app.profile.nameChangedAt, "", "el reloj no arrancó: el nombre es el mismo");
});

test("dentro de los 7 días el campo se bloquea y dice cuántos faltan", () => {
  win.activateUserSession(null);
  app.profile.name = "Ana Ruiz";
  app.profile.nameChangedAt = win.isoOffset(-2);

  assert.equal(win.daysUntilNameChange(), 5);
  win.editProfile();
  assert.ok(doc.getElementById("pfName").hasAttribute("readonly"));
  assert.match(doc.getElementById("sheetBody").innerHTML, /en 5 días/);
});

test("al día 7 se libera", () => {
  win.activateUserSession(null);
  app.profile.nameChangedAt = win.isoOffset(-7);
  assert.equal(win.daysUntilNameChange(), 0);
  assert.equal(win.canChangeName(), true);
});

test("el nombre no cambia aunque se fuerce el campo bloqueado desde el DOM", () => {
  win.activateUserSession(null);
  app.profile.name = "Ana Ruiz";
  app.profile.email = "ana@gmail.com";
  app.profile.phone = "0991234567";
  app.profile.nameChangedAt = win.isoOffset(-1);

  win.editProfile();
  const nameEl = doc.getElementById("pfName");
  nameEl.removeAttribute("readonly");
  nameEl.value = "Otro Nombre";
  win.saveProfile();

  assert.equal(app.profile.name, "Ana Ruiz", "el enfriamiento no se salta editando el DOM");
  assert.equal(app.profile.nameChangedAt, win.isoOffset(-1), "y la marca no se movió");
});

test("volver a iniciar sesión con Google no deshace el nombre elegido", () => {
  // Sin esto, el enfriamiento sería la peor combinación posible: el usuario
  // espera una semana, cambia el nombre, y el siguiente inicio de sesión se lo
  // devuelve al de Google — la espera sin el efecto.
  const user = { sub: "111", name: "Ana Google", email: "ana@gmail.com" };
  win.activateUserSession(user);
  assert.equal(app.profile.name, "Ana Google", "sin nombre propio manda el de Google");

  editar({ name: "Ana Ruiz", email: "ana@gmail.com", phone: "0991234567" });
  win.saveProfile();
  assert.equal(app.profile.name, "Ana Ruiz");

  win.activateUserSession(user);   // vuelve a entrar
  assert.equal(app.profile.name, "Ana Ruiz", "el nombre elegido sobrevive al inicio de sesión");
});
