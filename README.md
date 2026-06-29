<div align="center">

<img src="img/Cloth%20To%20Go%20Logo.png" alt="CLOTH TO GO" height="96" />

# CLOTH TO GO

**Moda circular · alquila ropa de segunda mano por día** 🌱

Prototipo front-end de una app de alquiler de prendas, construido como demostración
para la materia de **Emprendimiento e Innovación (ESPOL)**.

</div>

---

## 📌 ¿Qué es?

**CLOTH TO GO** es un prototipo navegable de una aplicación móvil de **alquiler de ropa
de segunda mano por día**. Permite explorar un catálogo, filtrar y buscar prendas, ver
su detalle, armar un carrito con fechas de alquiler y depósito reembolsable, simular el
checkout (entrega, devolución y pago) y gestionar un perfil con pedidos, puntos y
donaciones — todo con una estética de moda circular y un mensaje de impacto ambiental
(agua ahorrada al reutilizar ropa).

Está hecho con **HTML, CSS y JavaScript puro (vanilla)**: sin framework, sin bundler y
**sin dependencias en tiempo de ejecución**. Se abre directamente con `index.html`.

> ⚠️ **Es un prototipo de clase.** El inicio de sesión, el pago, el stock y los pedidos
> de ejemplo son **simulados**. No hay backend ni pasarela de pago real. Los datos se
> guardan localmente en el navegador (`localStorage`).

---

## ✨ Características

- 🛍️ **Catálogo** de prendas con condición, talla, material y calidad (estrellas).
- 🔎 **Búsqueda** por nombre/categoría/descripción y **filtros** por categoría, calidad,
  talla y material, además de **ordenamiento** (precio, calidad, recomendado).
- 👕 **Detalle de prenda** con ficha (talla, material, calidad, depósito) y disponibilidad.
- 🛒 **Carrito** con selector de **período de alquiler** y cálculo de subtotal.
- 💰 **Depósito reembolsable con descuento por volumen**: a más prendas y días, menor
  depósito.
- 🚚 **Checkout simulado**: entrega (envío/retiro), método de devolución y pago
  (efectivo / tarjeta — sin procesar datos).
- 👤 **Perfil**: información de contacto editable, pedidos activos e historial,
  **programa de puntos** y **donación de ropa**.
- 💧 **Impacto ambiental**: litros de agua ahorrados al reutilizar prendas en lugar de
  fabricarlas nuevas (moda circular).
- 📝 Botón de **encuesta** (Google Forms) para retroalimentación.
- 📱 **Responsive**: mockup de teléfono en escritorio y pantalla completa en móvil.
- ♿ Cuidado de **accesibilidad**: contraste AA, foco visible y soporte de teclado.

---

## 🚀 Cómo ejecutarlo

No requiere servidor: basta con **abrir `index.html`** en el navegador (funciona con
`file://`).

```bash
# Opción 1 — abrir el archivo directamente
#   Doble clic en index.html

# Opción 2 — servidor estático (opcional, NO necesario)
python3 -m http.server
# luego visita http://localhost:8000
```

### Herramientas de desarrollo (opcional)

Solo para linting/formateo del código; **no son necesarias para que la app funcione**.

```bash
npm install      # instala eslint y prettier
npm run lint     # ESLint sobre js/
npm run format   # Prettier sobre js/css/html/md
```

---

## 🧱 Arquitectura

El JavaScript se divide en **7 scripts clásicos** que comparten un **ámbito global**, y
se cargan en un **orden de dependencias estricto** en `index.html`:

```
data → state → dom → catalog → checkout → profile → main
```

Se evitan los **módulos ES** (`import`/`export`) a propósito para que la demo abra con
`file://` (los módulos están bloqueados por CORS en `file://`). El renderizado es manual:
tras mutar el estado se llama a la función `render*()` correspondiente, que reconstruye el
HTML. Los eventos usan **delegación** mediante atributos `data-action`.

### Responsabilidades por archivo

| Archivo | Rol |
|---|---|
| `js/data.js` | Catálogo, constantes de negocio y helpers puros (formato, validaciones, agua). |
| `js/state.js` | Estado global, cálculos derivados y persistencia en `localStorage`. |
| `js/dom.js` | Referencias al DOM, panel deslizante (sheet), toast y modal de confirmación. |
| `js/catalog.js` | Grilla, filtros/orden, panel de filtros, detalle y agregar al carrito. |
| `js/checkout.js` | Flujo de compra: carrito → entrega/pago → confirmación. |
| `js/profile.js` | Perfil: contacto, pedidos, puntos, premios y donaciones. |
| `js/main.js` | Login, cableado de eventos (delegación) y render inicial. **Carga al final.** |

---

## 📁 Estructura del proyecto

```
.
├── index.html              # Punto de entrada (carga los scripts en orden)
├── css/
│   ├── base.css            # Variables de tema, reset y marco del teléfono
│   └── components.css      # Header, catálogo, sheet, carrito, checkout, perfil…
├── js/
│   ├── data.js  state.js  dom.js
│   ├── catalog.js  checkout.js  profile.js
│   └── main.js
├── img/
│   └── Cloth To Go Logo.png
├── package.json            # Scripts de tooling (lint/format)
├── eslint.config.js
└── README.md
```

---

## 🧪 Datos simulados

Para que el prototipo sea autocontenido, se **simulan**:

- **Autenticación**: el login no valida credenciales reales (también hay modo invitado).
- **Pago**: los datos de tarjeta **no se procesan ni se guardan**; el pago es de muestra.
- **Stock**: cada prenda es única (segunda mano), con disponibilidad fija en 1.
- **Persistencia**: carrito, perfil y pedidos se guardan en `localStorage` del navegador.

---

## 🗺️ Próximos pasos

- Backend real (autenticación, catálogo, pedidos) e integración de pasarela de pago.
- Imágenes de prendas alojadas localmente.
- Pruebas automatizadas (diferidas a la fase de backend).

---

## 👤 Autor

**GRUPO 5 - Dress to Impress** — ESPOL · Emprendimiento e Innovación.

> Proyecto académico. Las imágenes de catálogo provienen de Unsplash y, si no cargan, se
> muestra un placeholder.
