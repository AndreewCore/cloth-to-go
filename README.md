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

> ⚠️ **Es un prototipo de clase.** El pago, el stock y los pedidos
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

Solo para linting y pruebas; **no son necesarias para que la app funcione**.

```bash
pnpm install     # instala eslint y jsdom
pnpm lint        # ESLint sobre js/
pnpm test        # pruebas del modelo de precios, flujo y helpers (runner nativo de Node)
```

> No hay formateador automático: el código se alinea a mano (el catálogo de
> `js/data.js` es una tabla legible que Prettier destruía).

---

## 🧱 Arquitectura

El JavaScript se divide en **10 scripts clásicos** que comparten un **ámbito global**, y
se cargan en un **orden de dependencias estricto** en `index.html`:

```
icons → data → state → dom → catalog → checkout → profile → api → auth → main
```

Se evitan los **módulos ES** (`import`/`export`) a propósito para que la demo abra con
`file://` (los módulos están bloqueados por CORS en `file://`). El renderizado es manual:
tras mutar el estado se llama a la función `render*()` correspondiente, que reconstruye el
HTML. Los eventos usan **delegación** mediante atributos `data-action`.

### Responsabilidades por archivo

| Archivo | Rol |
|---|---|
| `js/icons.js` | Set de iconos SVG en línea y el helper `icon()`. Sin dependencias de red. |
| `js/data.js` | Catálogo, constantes de negocio y helpers puros (formato, validaciones, agua). |
| `js/maps.js` | Selector de ubicación con Google Maps (opcional). Sin clave/red cae al campo de texto. |
| `js/state.js` | Estado global, cálculos derivados y persistencia en `localStorage`. |
| `js/dom.js` | Referencias al DOM, panel deslizante (sheet), toast y modal de confirmación. |
| `js/catalog.js` | Grilla, filtros/orden, panel de filtros, detalle y agregar al carrito. |
| `js/checkout.js` | Flujo de compra: carrito → entrega/pago → confirmación. |
| `js/profile.js` | Perfil: contacto, pedidos, puntos, premios y donaciones. |
| `js/api.js` | Puente opcional con el backend: hidrata el catálogo desde la API si está disponible. |
| `js/main.js` | Pantalla de bienvenida, cableado de eventos (delegación) y render inicial. **Carga al final.** |

> **Backend (opcional).** En `server/` hay una API (Fastify + Prisma + SQLite) que
> sirve el catálogo. Si está levantada, el frontend la consume; si no, la app usa los
> datos embebidos y sigue abriéndose por `file://`. Ver [`server/README.md`](server/README.md).

---

## 📁 Estructura del proyecto

```
.
├── index.html              # Punto de entrada (carga los scripts en orden)
├── css/
│   ├── base.css            # Variables de tema, reset y marco del teléfono
│   └── components.css      # Header, catálogo, sheet, carrito, checkout, perfil…
├── js/
│   ├── icons.js  data.js  state.js  dom.js
│   ├── catalog.js  checkout.js  profile.js
│   └── main.js
├── img/
│   └── Cloth To Go Logo.png
├── package.json            # Scripts de tooling (lint/test)
├── eslint.config.js
└── README.md
```

---

## 🧪 Datos simulados

Para que el prototipo sea autocontenido, se **simulan**:

- **Autenticación**: no existe. Se entra como invitado; "Iniciar sesión" y "Crear cuenta"
  solo avisan que llegarán con el backend.
- **Pago**: los datos de tarjeta **no se procesan ni se guardan**; el pago es de muestra.
- **Stock**: cada prenda es única (segunda mano), con disponibilidad fija en 1.
- **Persistencia**: carrito, perfil y pedidos se guardan en `localStorage` del navegador.

---

## 🗺️ Mapas: cómo conseguir la API key

El selector de ubicación (envío y retiro a domicilio) usa **Google Maps**. Es
**opcional**: sin clave, sin red o abriendo por `file://`, el botón del mapa no
aparece y el campo de dirección escrito a mano funciona igual que siempre.

Para activarlo:

1. Entra en [Google Cloud Console](https://console.cloud.google.com/) con tu
   cuenta de Google y **crea un proyecto** (arriba a la izquierda, "Nuevo proyecto").
   Nómbralo p. ej. `cloth-to-go`.
2. **Activa la facturación** en *Facturación* → *Vincular cuenta*. Google la exige
   aunque no vayas a pagar: hay **$200 de crédito gratis al mes**, que para una
   demo de clase no se agotan ni de lejos. Sin facturación el mapa sale en gris
   con la marca de agua "solo para fines de desarrollo".
3. En *APIs y servicios* → *Biblioteca*, activa estas dos:
   - **Maps JavaScript API** (dibuja el mapa)
   - **Geocoding API** (convierte el punto en una dirección legible)
4. En *APIs y servicios* → *Credenciales* → *Crear credenciales* → **Clave de API**.
   Copia la clave que aparece.
5. **Restringe la clave** (importante: viaja en el HTML y es pública). En la
   propia clave:
   - *Restricciones de aplicación* → **Sitios web**, y añade los orígenes desde
     los que se sirve la app, p. ej.:
     - `https://andreewcore.github.io/*`
     - `http://localhost:8000/*`
   - *Restricciones de API* → **Restringir clave** y marca solo las dos APIs de arriba.
6. Sirve la app por http (`python3 -m http.server`) y entra pasando la clave una
   sola vez por la URL:
   ```
   http://localhost:8000/?mapskey=AIza…
   ```
   Queda guardada en el `localStorage` del navegador (`clothToGo:mapsKey`) y el
   parámetro se borra de la barra de direcciones. Desde ahí entras por
   `http://localhost:8000` a secas. Por `file://` el mapa **no** carga a propósito.

   Para quitarla: `localStorage.removeItem("clothToGo:mapsKey")`.

> ⚠️ **No pegues la clave en `js/maps.js`.** Este repo es público: una clave
> commiteada queda para siempre en el historial de git, la recogen los scrapers
> en minutos y el consumo se factura a tu cuenta. `GOOGLE_MAPS_API_KEY` se deja
> vacía y hay un test que lo vigila. El override de `localStorage` existe justo
> para probar sin tocar el código.
>
> Para un despliegue real la clave sí viaja en el HTML —es inevitable en una
> clave de navegador—, y lo que la protege es la restricción por referente HTTP
> del paso 5, no el secreto.

### En la página desplegada (GitHub Pages)

La clave **no se commitea**: la inyecta el workflow `.github/workflows/pages.yml`
al desplegar, leyéndola de un secreto del repositorio.

1. *Settings* → *Secrets and variables* → *Actions* → **New repository secret**,
   con nombre `GOOGLE_MAPS_API_KEY` y la clave como valor.
2. *Settings* → *Pages* → *Build and deployment* → *Source*: cambia
   **Deploy from a branch** por **GitHub Actions**. Sin este paso Pages sigue
   publicando `main` tal cual y el mapa no aparecerá, porque en el repo la
   constante está vacía.
3. Comprueba que la restricción por referente incluye el origen desplegado
   (`https://andreewcore.github.io/*`).

Si el secreto no está puesto, el despliegue **no falla**: sale sin mapa y la app
cae al campo de dirección escrito a mano, igual que en `file://`.

> ⚠️ Esto saca la clave del **repositorio**, no de la **página**. En el sitio
> publicado sigue siendo legible con "ver código fuente": una clave de navegador
> tiene que llegar al navegador. Quien la copie no podrá usarla en otro dominio
> **solo** si la restricción por referente está bien puesta — ese es el control
> de verdad, y conviene además fijar una cuota diaria en Cloud Console.

## 📍 Dirección: solo por mapa

Cuando hay clave, el checkout **no ofrece campo de texto** para la dirección de
envío ni la de retiro: se marca el punto en el mapa y ya. Un texto sin
coordenadas es justo lo que provoca las entregas fallidas, y mantener las dos
vías abiertas garantizaba que la mayoría siguiera usando la peor.

Sin mapa (por `file://`, sin clave o sin red) **vuelve el campo de texto**: es la
única forma de terminar un pedido, y bloquearlo rompería la demo que tiene que
poder abrirse con doble clic.

Si el mapa no aparece, abre la consola del navegador: Google explica ahí el
motivo exacto (`RefererNotAllowedMapError`, `ApiNotActivatedMapError`, etc.).

---

## 🗺️ Próximos pasos

- Backend real (autenticación, catálogo, pedidos) e integración de pasarela de pago.
- Imágenes de prendas alojadas localmente.
- Ampliar la cobertura de pruebas (checkout, perfil, flujo completo). El modelo
  de precios y los helpers puros ya tienen tests: `pnpm test`.

---

## 👤 Autor

**GRUPO 5 - Dress to Impress** — ESPOL · Emprendimiento e Innovación.

> Proyecto académico. Las imágenes de catálogo provienen de Unsplash y, si no cargan, se
> muestra un placeholder.
