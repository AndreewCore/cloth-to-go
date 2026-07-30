<div align="center">

<img src="img/Cloth%20To%20Go%20Logo.png" alt="CLOTH TO GO" height="96" />

# CLOTH TO GO

**Moda circular · alquila prendas únicas por día** 🌱

Prototipo de una app de alquiler de ropa, construido como demostración
para la materia de **Emprendimiento e Innovación (ESPOL)**.

[![CI](https://github.com/AndreewCore/cloth-to-go/actions/workflows/ci.yml/badge.svg)](https://github.com/AndreewCore/cloth-to-go/actions/workflows/ci.yml)

</div>

---

## 📌 ¿Qué es?

**CLOTH TO GO** es un prototipo navegable de una aplicación móvil de **alquiler de ropa
por día**. Permite explorar un catálogo, filtrar y buscar prendas, ver su detalle, armar
un carrito con fechas de alquiler y depósito reembolsable, simular el checkout (entrega,
devolución y pago) y gestionar un perfil con pedidos, puntos, premios y donaciones —
todo con una estética de moda circular y un mensaje de impacto ambiental (agua ahorrada
al reutilizar ropa en vez de fabricarla nueva).

Cada prenda es **única**: hay una sola unidad de cada una, así que alquilarla la retira
del catálogo hasta que vuelve.

El frontend está hecho con **HTML, CSS y JavaScript puro (vanilla)**: sin framework, sin
bundler y **sin dependencias en tiempo de ejecución**. Se abre directamente con
`index.html`.

### Qué es real y qué está simulado

|  | Estado |
|---|---|
| **Catálogo** | Real. Embebido en `js/data.js`; si el backend está levantado, se sirve desde la API. |
| **Precios y depósitos** | Reales: se **derivan** del valor de cada prenda (ver [Modelo de precios](#-modelo-de-precios)). |
| **Inicio de sesión** | Real con **Google**, verificado en el servidor. Sin backend o por `file://`, se entra como invitado. |
| **Mapas** | Real con Google Maps, si hay clave. Sin clave, el checkout cae al campo de dirección escrito a mano. |
| **Pago** | **Simulado.** No hay pasarela: los datos de tarjeta no se procesan ni se guardan. |
| **Pedidos y puntos** | **Simulados.** Viven en el `localStorage` del navegador, no en el servidor. |
| **Estados de envío** | **Simulados.** No hay logística ni panel de administración todavía. |

---

## ✨ Características

- 🛍️ **Catálogo** de prendas con condición, talla, material y calidad.
- 🔎 **Búsqueda** por nombre/categoría/descripción y **filtros** por categoría, calidad,
  talla y material, además de **ordenamiento** (precio, calidad, recomendado).
- 👕 **Detalle de prenda** con ficha (talla, material, calidad, depósito), tabla de
  tarifas por duración y disponibilidad.
- 🛒 **Carrito** con selector de **período de alquiler** y **calendario de tarifas**: cada
  día muestra debajo cuánto suma al total, para que se vea de un vistazo qué cuesta
  alargar el alquiler.
- 💸 **Descuento por volumen**: 5 % menos por cada prenda adicional, hasta un 20 %.
- 🔒 **Depósito reembolsable**: 40 % del valor de reposición, con tope por prenda y por
  pedido. Cubre el riesgo, así que **no** baja por alquilar más días ni más prendas.
- 🚚 **Checkout**: entrega (envío/retiro), método de devolución, pago (efectivo/tarjeta) y
  un **resumen de confirmación** antes de registrar el pedido.
- 👤 **Perfil**: contacto editable, pedidos activos e historial, cambio del método de
  devolución, **cancelación de pedido** y acceso al detalle de cualquier prenda alquilada.
- 🎁 **Puntos y premios**: se acumulan al recibir el pedido, se canjean por cupones y el
  cupón se aplica a un alquiler en el checkout.
- 💧 **Metas de agua**: litros ahorrados al reutilizar prendas, con metas que otorgan
  puntos al cruzarlas.
- 🎁 **Donación de ropa** y armario propio (próximamente, poner tus prendas en alquiler).
- 🌗 **Tema claro/oscuro** y **preferencias de accesibilidad**: tamaño de texto, menos
  animación y alto contraste.
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

> Por `file://` se pierden solo las piezas que dependen de la red: el inicio de sesión
> con Google, el mapa y la hidratación del catálogo desde la API. Todo lo demás funciona
> igual.

### Herramientas de desarrollo (opcional)

Solo para linting y pruebas; **no son necesarias para que la app funcione**.

```bash
pnpm install     # instala eslint y jsdom
pnpm lint        # ESLint sobre js/
pnpm test        # 357 pruebas: precios, flujo, vistas y helpers (runner nativo de Node)
```

Las pruebas cargan los scripts clásicos en un contexto `vm` (y en `jsdom` para las
vistas), porque los archivos no tienen `export`. El backend tiene las suyas en
`server/` (15 pruebas). **CI** ejecuta las tres cosas —lint, tests del frontend y tests
del servidor— en cada push y cada pull request.

> No hay formateador automático: el código se alinea a mano (el catálogo de
> `js/data.js` es una tabla legible que Prettier destruía).

---

## 💵 Modelo de precios

Ninguna prenda guarda un precio. Cada una lleva su **valor de reposición** (`value`) y
todo lo demás se **deriva** de ahí, en `js/data.js`:

- **Tarifa por tramos.** El primer día cuesta un porcentaje del valor según la calidad;
  los días 2–3 pesan un 50 % de ese primer día, los 4–7 un 30 % y del 8 en adelante un
  15 %. Alquilar dos semanas no puede costar catorce veces un día.
- **Piso de coste.** Ninguna tarifa baja de `cycleCost()` = amortización + lavandería
  según el material + gastos. El coste de un alquiler es **por ciclo, no por día**:
  lavar y desinfectar cuesta lo mismo si la prenda salió un día o diez. Por eso los días
  extra son baratos y por eso el piso existe.
- **Descuento por volumen**, hasta un 20 %. Las prendas baratas chocan contra su piso por
  sí solas: solo salen rentables acompañadas, y el descuento empuja en esa dirección.
- **Depósito**: 40 % del valor, con tope de $25 por prenda y $40 por pedido. Es
  reembolsable, así que ni el volumen ni los cupones lo tocan.

---

## 🧱 Arquitectura

El JavaScript se divide en **12 scripts clásicos** que comparten un **ámbito global**, y
se cargan en un **orden de dependencias estricto** en `index.html`:

```
icons → prefs → data → state → dom → catalog → checkout → profile → api → auth → maps → main
```

Se evitan los **módulos ES** (`import`/`export`) a propósito para que la demo abra con
`file://` (los módulos están bloqueados por CORS en `file://`). El renderizado es manual:
tras mutar el estado se llama a la función `render*()` correspondiente, que reconstruye el
HTML. Los eventos usan **delegación** mediante atributos `data-action`.

### Responsabilidades por archivo

| Archivo | Rol |
|---|---|
| `js/icons.js` | Set de iconos SVG en línea y el helper `icon()`. Sin dependencias de red. |
| `js/prefs.js` | Tema (claro/oscuro/auto) y preferencias de accesibilidad, persistidas aparte del resto. |
| `js/data.js` | Catálogo, constantes de negocio, **modelo de precios** y helpers puros (formato, validaciones, agua). |
| `js/state.js` | Estado global, cálculos derivados y persistencia en `localStorage`. |
| `js/dom.js` | Referencias al DOM, panel deslizante (sheet), toast y modal de confirmación. |
| `js/catalog.js` | Grilla, filtros/orden, panel de filtros, detalle y agregar al carrito. |
| `js/checkout.js` | Flujo de compra: carrito → entrega → pago → confirmación. |
| `js/profile.js` | Perfil: contacto, pedidos, puntos, premios, metas de agua y donaciones. |
| `js/api.js` | Puente opcional con el backend: hidrata el catálogo desde la API si está disponible. |
| `js/auth.js` | Inicio de sesión con Google (GSI). Sin SDK o por `file://`, la app degrada a invitado. |
| `js/maps.js` | Selector de ubicación con Google Maps (opcional). Sin clave/red cae al campo de texto. |
| `js/main.js` | Pantalla de bienvenida, cableado de eventos (delegación) y render inicial. **Carga al final.** |

Los tres módulos que dependen de la red —`api.js`, `auth.js` y `maps.js`— siguen el mismo
patrón: si el recurso no está, la pieza no se dibuja y la app sigue funcionando. Es lo que
mantiene viva la demo por `file://`.

---

## 🖥️ Backend (opcional)

En `server/` hay una API con **Fastify + Prisma + SQLite** que hoy sirve el catálogo y
verifica el inicio de sesión:

| Método | Ruta | Para qué |
|---|---|---|
| `GET` | `/api/health` | Comprobación de vida. |
| `GET` | `/api/products` | Catálogo, en el mismo formato que espera el frontend. |
| `POST` | `/api/auth/google` | Verifica el ID token de Google y registra al usuario. |

SQLite en desarrollo; para producción se cambia el `provider` y la `DATABASE_URL` a
Postgres sin tocar el código de la app. Si el servidor no está levantado, el frontend usa
los datos embebidos y sigue abriéndose por `file://`. Ver
[`server/README.md`](server/README.md).

El dinero, los pedidos y los puntos **todavía no viven en el servidor**: están en el
navegador.

---

## 📁 Estructura del proyecto

```
.
├── index.html              # Punto de entrada (carga los scripts en orden)
├── css/
│   ├── base.css            # Variables de tema, reset y marco del teléfono
│   └── components.css      # Header, catálogo, sheet, carrito, checkout, perfil…
├── js/
│   ├── icons.js  prefs.js  data.js  state.js  dom.js
│   ├── catalog.js  checkout.js  profile.js
│   ├── api.js  auth.js  maps.js
│   └── main.js
├── img/
│   ├── Cloth To Go Logo.png
│   └── products/           # Fotos del catálogo (webp, servidas desde el repo)
├── test/                   # Pruebas del frontend (runner nativo de Node + jsdom)
├── server/                 # API Fastify + Prisma + SQLite
├── .github/workflows/      # CI (lint + tests) y despliegue a GitHub Pages
├── package.json            # Scripts de tooling (lint/test)
├── eslint.config.js
└── README.md
```

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

- **Pedidos y dinero en el servidor**: hoy viven en el navegador, así que un total
  cobrado no queda registrado en ninguna parte.
- **Pasarela de pago** real.
- **Panel de administración**: confirmar cobros en efectivo, estados del pedido e
  inventario. Confirmar que entró dinero es un acto del negocio, nunca del cliente.
- **Canje de puntos validado en el servidor**: mientras el saldo viva en `localStorage`,
  es editable desde la consola del navegador.
- **Reseñas de clientes** y **galería de varias fotos** por prenda.

---

## 👤 Autor

**GRUPO 5 - Dress to Impress** — ESPOL · Emprendimiento e Innovación.

> Proyecto académico. Las fotos del catálogo se sirven desde el propio repositorio
> (`img/products/`); si alguna no carga, se muestra un placeholder.
