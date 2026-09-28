# CLOTH TO GO · sitio web

Versión de **escritorio** del catálogo. Es el escaparate público: se mira y se
llena el carrito sin cuenta, y **alquilar exige iniciar sesión con Google**,
igual que en la app móvil.

## Cómo abrirlo

```bash
python3 -m http.server          # desde la RAÍZ del proyecto
# → http://localhost:8000/web/
```

Por `file://` (abriendo `web/index.html` a doble clic) el catálogo y el carrito
funcionan, pero **no** el inicio de sesión: Google Identity necesita un origen
http(s). En ese caso el diálogo lo explica en vez de dejar un botón muerto. Es
la misma degradación que hace la app.

## Qué comparte con la app (y por qué)

La web carga **los mismos archivos** de la app, no una copia:

| Archivo | Qué aporta |
|---|---|
| `../js/icons.js` | iconos SVG en línea |
| `../js/data.js`  | catálogo `PRODUCTS`, **modelo de precios** y helpers |
| `../js/state.js` | carrito, pedidos, perfil y persistencia en `localStorage` |
| `../js/api.js`   | `hydrateCatalog()`: catálogo desde el backend cuando exista |

Por eso el precio, el depósito y el ahorro de agua **no se calculan aquí**: se
piden a `rentalPrice()`, `depositForItems()`, `grandTotal()`… Si una tarifa
cambia en `js/data.js`, cambia en las dos superficies a la vez.

**Base de datos.** Todavía no existe; las dos superficies funcionan con el
catálogo embebido de `js/data.js`. El día que el backend esté publicado, la web
lo consume por el mismo `hydrateCatalog()` que la app (de ahí que sus funciones
de pintado se llamen `renderGrid()` y `renderFilters()`: son las que `api.js`
invoca al hidratar). No hay nada más que tocar.

**Almacenamiento.** Todo vive en `localStorage`, en las mismas claves que la app:

- `clothToGo:web:guestCart` — carrito de quien aún no ha entrado. Es de la web:
  una página se cierra y se vuelve por un enlace, así que el carrito tiene que
  sobrevivir a la recarga. Al iniciar sesión se vuelca en la cuenta y se borra.
- `clothToGo:v4:user:<sub>` — la cuenta (carrito, pedidos, perfil, reseñas).
  **Es la misma clave de la app**: un alquiler confirmado en la web aparece en
  "Mis pedidos" del móvil con la misma cuenta de Google, y al revés.

Los datos de la tarjeta no se guardan en ningún sitio (tampoco en la app).

## Archivos propios

```
web/
  index.html        marcado del sitio
  css/web.css       hoja única (los colores de marca vienen de css/base.css)
  js/session.js     carrito de invitado + puerta de sesión con Google
  js/catalog.js     filtros, parrilla y ficha de prenda
  js/cart.js        carrito, checkout y confirmación del pedido
  js/main.js        diálogos, delegación de eventos y arranque (va el último)
```

Mismas convenciones que la app: scripts clásicos con **ámbito global
compartido** (sin `import`/`export`), eventos por **delegación** con
`data-action`, `escapeHTML()` antes de meter nada en `innerHTML`, y todo global
nuevo declarado en `WEB_GLOBALS` de `eslint.config.js` (`pnpm lint` cubre
`web/js`).

## Lo que la web todavía no hace

Deliberado, para no duplicar media app:

- **Sin selector de mapa**: la dirección se escribe; el pedido se guarda con
  `shipCoords`/`retCoords` en `null`.
- **Sin cupones ni canje de puntos**: los puntos se acreditan (el pedido los
  otorga), pero se gastan desde la app. `couponId` va siempre `null`.
- **Sin perfil ni reseñas**: se ven en la app.
- `placeWebOrder()` arma el pedido con la misma forma que `placeOrder()` de
  `js/checkout.js` (que no puede cargarse aquí: depende del DOM del teléfono).
  El dinero y los puntos los siguen calculando `orderTotal()` y `orderPoints()`,
  así que lo duplicado son los campos, no las cuentas. **Si cambia la forma del
  pedido, cambia en los dos.**

## Instalar la app y página 404

- **Instalar la app** aparece en la cabecera, dentro del menú plegable (en móvil,
  donde la cabecera no tiene sitio) y en el pie. Los tres enlaces llevan
  `data-play` y los rellena `applyStoreLinks()` desde **`PLAY_STORE_URL`** en
  `web/js/main.js`: la URL está en un solo sitio. Hoy apunta a una ficha de
  Google Play **que no existe todavía** (`ec.clothtogo.app`) — al publicar la app
  se cambia esa constante.
- **`web/404.html`** es deliberadamente mínima: el código, qué pasó y el botón de
  volver al inicio. Sin cabecera, sin pie y sin JavaScript — toma de
  `css/web.css` solo los colores y el botón. Ojo al desplegar: GitHub Pages solo usa el archivo
  `404.html` que esté en la **raíz del sitio**, así que si el sitio se publica
  desde la raíz del repositorio hay que copiarlo allí (o publicar `web/` como
  raíz del sitio).

## El vídeo de la portada

La portada ocupa la ventana entera y se mete **debajo de la cabecera**, que ahí
flota transparente sobre el vídeo y se vuelve sólida al pasar de largo
(`updateTopBar()`, clase `.top.over`). El vídeo **no** es un
tapiz detrás de todo: está anclado a la derecha, se sale por el borde y su canto
izquierdo se disuelve en el fondo oscuro con una máscara en degradado
(`mask-image` en `.hero-bg`), de modo que el texto se apoya en negro limpio y no
sobre la imagen. En pantalla estrecha el fundido pasa a ser vertical y el vídeo
ocupa el fondo completo. El paralaje lo lleva `initHeroParallax()`
(`web/js/main.js`). El archivo que hay ahora es **de muestra**:

```
web/media/hero-demo.mp4   vídeo en bucle, 24 s, 1280×720, 264 KB
web/media/hero-demo.jpg   póster (primer fotograma), se ve mientras carga
```

Está generado con ffmpeg a partir de fotos del propio catálogo (un paneo lento y
oscurecido), así que funciona sin red. **Para poner el definitivo basta con
reemplazar esos dos archivos** conservando los nombres; no hay que tocar código.
Si el vídeo se cambia por uno con otra relación de aspecto, sigue encajando:
el `<video>` recorta con `object-fit: cover`.

Condiciones que cumple y conviene mantener: va silenciado y en bucle (sin sonido
no hay reproducción automática bloqueada), lleva `playsinline` para que iOS no lo
abra a pantalla completa, y **se detiene en el póster si el sistema pide menos
movimiento** (`prefers-reduced-motion`), igual que el paralaje.

## Propuestas de diseño (`web/propuestas/`)

Cinco maquetas de dirección visual sobre la misma paleta de la app (claro y
oscuro), abiertas desde `web/propuestas/index.html`. Cargan `../../js/data.js`,
así que enseñan el **catálogo y los precios reales** del prototipo: una maqueta
con cifras inventadas no permite juzgar si el precio cabe donde se puso. Son
solo portada + muestra de catálogo, sin carrito ni sesión.

| Maqueta | Idea | Tipografía |
|---|---|---|
| 1 · La percha | prendas colgadas de una barra, con etiqueta de precio | Saira Condensed + Assistant |
| 2 · Por día | tira de días que recalcula el precio al tocarla | Space Grotesk + IBM Plex Sans |
| 3 · La etiqueta | el catálogo en el idioma de la etiqueta cosida | Archivo + Archivo Narrow |
| 4 · El agua | abre con los litros que no se gastan | Newsreader + Work Sans |
| 5 · Lookbook | foto a sangre, piezas numeradas | Bodoni Moda + Jost |

Cada una trae su botón claro/oscuro (comparten la clave
`clothToGo:propuestas:tema`, que no toca los datos de la app).
