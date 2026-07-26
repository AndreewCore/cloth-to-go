/**
 * Pruebas de los helpers puros de js/data.js: validadores de formulario,
 * escape anti-XSS, fechas y el cálculo de ahorro de agua.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp } = require("./helpers/load-app.js");

const A = loadApp();

test("escapeHTML neutraliza los 5 caracteres peligrosos", () => {
  assert.equal(A.escapeHTML(`<b>&"'`), "&lt;b&gt;&amp;&quot;&#39;");
  assert.equal(A.escapeHTML("hola"), "hola");
  assert.equal(A.escapeHTML(null), ""); // nullish → cadena vacía
});

test("isValidEmail", () => {
  assert.ok(A.isValidEmail("ana@correo.com"));
  assert.ok(!A.isValidEmail("ana@correo")); // sin dominio
  assert.ok(!A.isValidEmail("ana correo.com"));
  assert.ok(!A.isValidEmail(""));
});

test("isValidPhone: solo dígitos, 7 a 15", () => {
  assert.ok(A.isValidPhone("0991234567"));
  assert.ok(!A.isValidPhone("12345")); // muy corto
  assert.ok(!A.isValidPhone("099-123-4567")); // guiones
});

test("isValidName / isValidAddress: longitud mínima", () => {
  assert.ok(A.isValidName("Al"));
  assert.ok(!A.isValidName("A"));
  assert.ok(A.isValidAddress("Calle 1"));
  assert.ok(!A.isValidAddress("abc"));
});

test("validadores de tarjeta", () => {
  assert.ok(A.isValidCardNumber("4111 1111 1111 1111")); // ignora espacios
  assert.ok(!A.isValidCardNumber("4111")); // muy corto
  assert.ok(A.isValidExpiry("12/25"));
  assert.ok(!A.isValidExpiry("13/25")); // mes inválido
  assert.ok(!A.isValidExpiry("1/25")); // sin cero a la izquierda
  assert.ok(A.isValidCvv("123"));
  assert.ok(A.isValidCvv("1234"));
  assert.ok(!A.isValidCvv("12"));
});

test("daysBetween: mínimo 1, tolerante a nulos", () => {
  assert.equal(A.daysBetween("2026-01-01", "2026-01-04"), 3);
  assert.equal(A.daysBetween("2026-01-01", "2026-01-01"), 1); // mínimo 1
  assert.equal(A.daysBetween(null, null), 1);
});

test("fmtDate: ISO → legible en español", () => {
  assert.equal(A.fmtDate("2026-06-16"), "16 jun");
  assert.equal(A.fmtDate(""), "—");
});

test("isoOffset devuelve YYYY-MM-DD en hora local", () => {
  const hoy = A.isoOffset(0);
  assert.match(hoy, /^\d{4}-\d{2}-\d{2}$/);
  const d = new Date();
  const esperado = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  assert.equal(hoy, esperado);
});

test("garmentWater = peso · intensidad hídrica del material", () => {
  assert.equal(A.garmentWater({ material: "lino", weightKg: 0.5 }), 1450); // 0.5·2900
  assert.equal(A.garmentWater({ material: "sintetico", weightKg: 0.3 }), 36); // 0.3·120
  // Material desconocido cae al del algodón (10000 L/kg).
  assert.equal(A.garmentWater({ material: "???", weightKg: 0.25 }), 2500);
});

test("litersToGallons: litros → galones US, redondeado", () => {
  assert.equal(A.litersToGallons(3785), 1000); // 3785 / 3.785
  assert.equal(A.litersToGallons(0), 0);
});

test("starStr: llenas + vacías, siempre 5 símbolos", () => {
  assert.equal(A.starStr(3), "★★★☆☆");
  assert.equal(A.starStr(5), "★★★★★");
  assert.equal(A.starStr(0), "☆☆☆☆☆");
});

test("conditionLabel: etiqueta de desgaste por estrellas", () => {
  assert.equal(A.conditionLabel(5), "Como nuevo");
  assert.equal(A.conditionLabel(1), "Muy usado");
  assert.equal(A.conditionLabel(9), ""); // fuera de rango → vacío
});

test("materialLabel: nombre legible, pasa el original si es desconocido", () => {
  assert.equal(A.materialLabel("lana"), "Lana");
  assert.equal(A.materialLabel("sintetico"), "Sintético");
  assert.equal(A.materialLabel("desconocido"), "desconocido");
});
