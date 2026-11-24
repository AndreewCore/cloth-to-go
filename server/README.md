# CLOTH TO GO · Backend (API)

API del prototipo, construida con **Fastify + Prisma + Postgres**. Expone el
**catálogo** en modo lectura y la **verificación de login con Google**;
alquileres, pagos y envíos llegarán en iteraciones posteriores.

> **Estado:** Postgres es el motor en los **tres** sitios —desarrollo, CI y
> producción—. Se descartó dejar SQLite para probar: con dos motores las
> migraciones solo valen para uno y las pruebas no ejercitan el real. El
> historial de migraciones vive en `prisma/migrations/` y se commitea.

## Requisitos

- Node.js 18+ y **pnpm**.
- Un **Postgres 16** al que apuntar. En local vale un contenedor
  (`docker run -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16`) o una
  rama gratuita de Neon/Supabase.

## Puesta en marcha

```bash
cd server
pnpm install            # instala dependencias y genera el cliente Prisma
cp .env.example .env    # configura DATABASE_URL, DIRECT_URL y PORT
pnpm db:deploy          # aplica las migraciones
pnpm db:seed            # siembra las 16 prendas
pnpm dev                # levanta el servidor en http://localhost:3000
```

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Estado del servicio (`{ "status": "ok" }`). |
| GET | `/api/products` | Catálogo completo, ordenado por `id`. |
| POST | `/api/auth/google` | Verifica un ID token de Google, registra/actualiza al usuario y abre una **sesión**. |
| POST | `/api/auth/logout` | Revoca el token de sesión de la cabecera (siempre 204). |
| GET | `/api/me/points` | Saldo de puntos, canjes, premios y metas de agua (ya liquidados). |
| POST | `/api/rewards/:id/redeem` | Canjea un premio por un cupón (409 sin saldo). |
| GET | `/api/orders` | Pedidos del usuario autenticado, con su libro de cargos. |
| POST | `/api/orders` | Crea un pedido y sus cargos iniciales. |
| PATCH | `/api/orders/:id/return` | Cambia el modo de devolución → **genera un ajuste**. |
| POST | `/api/orders/:id/cancel` | Anula el pedido y revierte sus cargos. |
| POST | `/api/orders/:id/settle` | **Solo local**: confirma que el efectivo entró. |
| POST | `/api/orders/:id/deposit-release` | **Solo local**: libera el depósito. |
| POST | `/api/orders/:id/receive` | **Mostrador**: registra la devolución (día real) y cobra los días extra. |
| GET | `/api/me` | Quién es la sesión y sus capacidades (el panel decide qué pestañas enseñar). |
| GET | `/api/admin/orders` | **Mostrador o Caja**: pedidos en curso, con cliente y ejemplares (`?scope=all`, todos). |
| GET | `/api/admin/items` | **Mostrador o Inventario**: ejemplares con su estado interno y a qué estados pueden pasar. |
| GET | `/api/admin/stragglers` | **Mostrador**: rezagadas (vencidas sin recibir, recibidas sin lavar, >2 días en lavado). |
| GET | `/api/admin/products` | **Inventario**: todos los modelos (también sin ejemplares) con sus fotos y ejemplares. |
| POST | `/api/products` | **Inventario**: alta de un modelo (validado contra la taxonomía). |
| PATCH | `/api/products/:id` | **Inventario** edita; valor y estrellas solo **Administración**. |
| POST | `/api/products/:id/photos` | **Inventario**: sube fotos de catálogo (multipart, JPG/PNG, 5 MB, 6 por modelo). |
| PUT | `/api/products/:id/photos` | **Inventario**: reordena o quita fotos de catálogo (`{imgs}`). |
| PATCH | `/api/items/:id` | **Inventario**: corrige condición o medidas de un ejemplar. |
| POST | `/api/items/:id/photos` | **Mostrador o Inventario**: fotos de estado (`kind` SALIDA/LLEGADA con `orderId`, o ESTADO). |
| GET | `/api/items/:id/photos` | **Mostrador o Inventario**: fotos de estado con enlaces firmados (10 min). |
| GET | `/api/admin/taxonomy` | **Inventario**: todas las listas con el coste de lavado y cuántos modelos o ejemplares usan cada entrada. |
| POST | `/api/taxonomy/:list` | **Inventario**: alta en `categories`, `colors`, `sizes`, `materials` (coste de lavado: **Administración**), `occasions`, `seasons` o `audiences`. |
| PATCH | `/api/taxonomy/:list/:key` | **Inventario**: nombre, hex o coste de lavado (**Administración**). Clave, prefijo y talla no cambian. |
| PUT | `/api/taxonomy/:list/order` | **Inventario**: orden nuevo de una lista entera (`{keys}`; tallas, por escala con `ESCALA\|talla`). |
| DELETE | `/api/taxonomy/:list/:key` | **Inventario**: borra si nada la usa (si no, 409 con cuántos). |
| GET | `/media/…` | Solo con el conductor de **disco**: sirve `catalogo/` y, con firma, `ejemplares/`. |
| GET | `/admin/` | El **panel del local** (estáticos de `admin/`, con CSP estricta). |
| GET | `/api/impact/water` | **Pública**: litros de agua ahorrados entre todos (contador de la web). |
| GET | `/api/config` | **Pública**: días cerrados y feriados, más el envío y el tope por volumen para los textos. |
| POST | `/api/quote` | **Pública** (con sesión valora el premio): cotiza el carrito con la misma función que cobra. |
| GET | `/api/chat/status` | **Pública**: si el asistente está encendido y de qué fundación habla. |
| POST | `/api/chat` | **Pública, con límite**: pregunta al asistente sobre la huella hídrica. |

### `POST /api/auth/google`

Recibe `{ "credential": "<ID token de Google>" }` (el mismo token que el
frontend obtiene de Google Identity Services) y lo verifica en el servidor con
[`google-auth-library`](https://www.npmjs.com/package/google-auth-library)
contra `GOOGLE_CLIENT_ID` (audience). El frontend por sí solo solo *decodifica*
ese token (sin comprobar la firma) — esta ruta es la que de verdad autentica.

- **200** → `{ "user": { "sub", "name", "email", "picture", "staff" }, "token", "expiresAt" }`.
  El usuario queda registrado (upsert por `googleSub`) en la tabla `users`, y
  `token` es una **sesión propia** de 30 días: el cliente la manda en
  `Authorization: Bearer …` en vez del ID token, que caduca en una hora. La
  base guarda solo su SHA-256 (`sessions`); `POST /api/auth/logout` la revoca.
  Un ID token de Google válido se sigue aceptando en esa misma cabecera.
- **401** → credential ausente o que no verifica (firma, expiración o
  audience inválidas). El mensaje no expone el motivo interno.
- **500** → falta `GOOGLE_CLIENT_ID` en el entorno del servidor.

### `GET /api/impact/water`

Contador común de agua ahorrada que muestra la portada de la web. Responde
`{ liters, goal, reached, cutAt, nextCutAt }`.

- **La página lee un acumulado, no una suma.** Vive en una sola fila
  (`water_counter`, creada por la migración `contador_agua` con 0 L).
- **Corte por hora, perezoso.** La primera lectura de cada hora acredita los
  pedidos cumplidos desde el corte anterior: no anulados y con `start` ya
  pasado (la misma regla que `countsForRewards()` en el frontend). Cada pedido
  guarda en `waterLiters` lo que sumó, y eso impide contarlo dos veces. Si el
  local anula un pedido ya acreditado, sus litros se restan en el corte
  siguiente. No hay temporizador porque Render duerme el proceso sin tráfico.
- **Metas:** 100 M → 250 M → 500 M → 1.000 M de litros, y luego de mil en mil
  millones (`communityGoal()` en `src/water.js`).
- Los litros por prenda salen de `src/water.js`, una **copia** de
  `garmentWater()` de `js/data.js` vigilada por `test/agua-paridad.test.js`.
- **Hoy marca 0:** el frontend todavía no envía los pedidos a `POST
  /api/orders`, así que no hay pedidos en la base que acreditar.

### Asistente sobre la huella hídrica (`/api/chat`)

Responde **solo** con el texto de los documentos de `knowledge/`. Llama a Google
Gemini (capa gratuita) por REST y **sin herramientas**: no busca en la web, no
ve la base y no ejecuta nada. Todo lo que sabe va en el system prompt.

- **Cargar los documentos:** copiar los PDF a `knowledge/` y correr
  `pnpm knowledge` (necesita `pdftotext`, de poppler). Genera un `.txt` por PDF;
  el servidor solo lee los `.txt` al arrancar. Revisa el texto en el diff antes
  del commit: es literalmente lo que el modelo sabrá.
- **Los `.txt` revisados son la fuente**, no los PDF: tras extraerlos se
  corrigen a mano (por ejemplo, «segunda mano» solo aparece en su pregunta
  frecuente; lo vigila `test/conocimiento.test.js`). Los PDF no se versionan:
  volver a extraerlos pisaría esas correcciones.
- **Encendido:** necesita `GEMINI_API_KEY` y al menos un `.txt`. Si falta algo,
  `GET /api/chat/status` → `{ enabled: false }` y la web oculta la burbuja.
- **Defensas:** validación (≤ 500 caracteres, historial de ≤ 6 turnos y solo
  `user`/`model`), un prefiltro de inyecciones que responde sin gastar cuota,
  reglas en el prompt y un postfiltro. **La disculpa la escribe el servidor**:
  si el modelo responde `FUERA_DE_TEMA`, vacío o bloqueado, sale `APOLOGY`.
- **Límites:** `CHAT_PER_MINUTE` por IP (8 por defecto) y `CHAT_PER_DAY` global
  (1000), en memoria. El global cuida la cuota aunque alguien rote IPs.
  Respuestas: **429** al pasarse del límite y **503** si Gemini falla o agota la cuota.
- El texto de los usuarios **no se registra** en los logs.

### Catálogo: modelo y ejemplar

El cliente ve **modelos** (`products`); el mostrador maneja **ejemplares**
(`items`), que son las prendas físicas con su talla, color, estado y código.

- `GET /api/products` — público. Un modelo por entrada con la forma que el
  frontend ya consume (`cat`, `size`, `color`, `disponibles`…) y, al lado,
  `items` (cada ejemplar con `available: true|false`), `owner`/`official`,
  marca, público, temporada y ocasiones. **Nunca** sale el estado interno ni el
  código: el cliente solo distingue Disponible de No Disponible.
- `GET /api/taxonomy` — público. Categorías (con su prefijo), colores, materiales,
  tallas por escala, ocasiones, temporadas, públicos y condiciones. Son tablas:
  las siembra la migración y se editan desde la pestaña **Taxonomía** del panel
  (`src/taxonomyAdmin.js`). La clave sale del nombre al crear (`Día de playa` →
  `dia_de_playa`) y **no cambia nunca**, igual que el prefijo de una categoría
  (va dentro de los códigos de inventario). Lo usado se renombra, no se borra.
  Un material nuevo cuenta como algodón en el contador de agua (`water.js` tiene
  su tabla fija por clave).
- `POST /api/products/:id/items` — **Inventario**. Alta de un ejemplar con código
  `CAT-AA-NNNN` (prefijo de la categoría, año, correlativo que nunca se reutiliza).
  Los 16 ejemplares de demostración no llevan código.
- `PATCH /api/products/:id/pricing` — **Administración**. Ajuste manual del precio
  del primer día (`priceOverride`, nunca por debajo de `cycleCost()`) y garantía
  fija opcional (`depositOverride`).
- `GET /api/items/:id` — **Mostrador** o **Inventario**. Ficha interna con su bitácora.
- `POST /api/items/:id/status` — **Mostrador**. Cambio manual de estado. Reservada
  la ponen y la quitan los pedidos; En Lavado exige `laundry: {kind, place}`;
  Perdida y la retirada son de Administración.

**Sin solape de reservas.** Cada fila de `order_items` es una reserva con sus
días; una restricción de exclusión de Postgres (`btree_gist`) rechaza dos
reservas vivas del mismo ejemplar que se toquen, con extremos **inclusivos**: el
día de devolución está ocupado. Aguanta dos checkouts simultáneos, que una
comprobación en el código no aguanta.

**Bitácoras.** `item_logs` (prendas) y `finance_logs` (dinero y personal) son de
solo añadir: un disparador rechaza `UPDATE` y `DELETE`. Ninguna se devuelve al
cliente. `item_photos` (fotos de estado) también: es la prueba que respalda
retener una garantía.

### Fotos

Dos clases, con destinos distintos (`src/storage.js`):

- **De catálogo** (`products.imgs`): las ve cualquiera. Van al cubo **público** y
  en la base se guarda la clave (`catalogo/<uuid>.webp`); `GET /api/products` la
  devuelve como URL absoluta, que la app y la web pintan tal cual. Las rutas
  antiguas `img/products/…` (las 16 prendas de demostración) siguen igual.
- **De estado** (`item_photos`): cómo **salió** y cómo **llegó** cada ejemplar en
  cada pedido, más las sueltas. Van al cubo **privado** y solo se ven con un
  enlace firmado de 10 minutos.

Toda subida pasa por la tubería de `src/photos.js`: límites de multipart antes
de leer, tipo por **bytes mágicos** (JPG o PNG; extensión y `Content-Type` no
cuentan), tope de 40 MP contra bombas de descompresión, y **recodificación a
WebP** con `sharp` (1600 px de lado, sin EXIF ni GPS). El nombre es un UUID.
Las subidas tienen límite por persona (`UPLOADS_PER_MINUTE`, 30).

**Conductores.** Sin `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`, las fotos van a
disco (`MEDIA_DIR`, por defecto `server/uploads/`, ignorado por git) y la API
las sirve en `/media/`. Con ellas, van a Supabase Storage (ver `DEPLOY.md`). En
producción sin Supabase el servidor avisa: el disco de Render se borra en cada
despliegue.

### Pedidos y libro de cargos

Todas las rutas de `/api/orders` exigen el **ID token de Google** en
`Authorization: Bearer <token>`. No se emite sesión propia: el token de Google
ya identifica, y añadir un secreto más al servidor solo agrega superficie que
custodiar. El header (y no una cookie) es también lo que hace que CSRF no
aplique — el navegador nunca adjunta `Authorization` por su cuenta.

La regla que ordena estas rutas: **el cliente propone, el servidor decide.** El
checkout manda qué prendas, qué fechas y qué modo de entrega; ningún importe que
llegue en el cuerpo se usa jamás. Los precios salen de `src/pricing.js` sobre el
catálogo de la base.

- **No se guarda un `total`.** El pedido guarda líneas inmutables (`charges`) y
  el total es su suma. Un importe cobrado es un hecho histórico: si mañana sube
  `SHIPPING_FEE`, un total derivado haría mentir a todos los pedidos pasados.
- **Cambiar algo añade una línea, no edita la anterior.** Pasar la devolución de
  local a domicilio deja un `ADJUSTMENT +4.50`, y el historial explica por sí
  solo por qué el cliente pagó lo que pagó.
- **El depósito se cobra pero no se gana.** Entra como `DEPOSIT_HOLD` y sale
  como `DEPOSIT_RELEASE`; la respuesta trae `revenueCents` (sin depósito) aparte
  de `totalCents` justamente para que nadie facture la garantía.
- **Puntos y canjes en el servidor (§2 de PENDIENTE).** El saldo es la suma de
  `points_entries`, nunca un contador. Un pedido fija al crearse los puntos que
  gana (`pointsEarned`, por lo pagado sin depósito ni premio) y se acreditan de
  forma perezosa al día siguiente del inicio, cuando ya no se puede anular; las
  metas de agua, igual. El checkout manda `couponId`, nunca un importe: el
  descuento sale como línea `DISCOUNT`, no toca el depósito, un cupón que rebaja
  $0 no se consume (la respuesta trae `couponIssue`) y el canje condicional más
  el índice único impiden gastarlo dos veces. Anular libera el cupón y revierte
  los puntos, revocando canjes sin usar si el saldo ya se gastó.
- **Ventanas de devolución (§6.0), no multa.** No se retira ni se devuelve en
  fin de semana o feriado (400). Quien retira de lunes a miércoles devuelve
  hasta el viernes; jueves o viernes, hasta el lunes (feriado en el cierre → el
  siguiente día hábil). La ventana solo extiende: `returnBy` es la más tardía
  entre la devolución elegida y el cierre, y la reserva del ejemplar llega
  hasta ahí. El precio sigue saliendo de los días elegidos. La multa fija de
  $15 y su ruta desaparecieron; los días extra se cobrarán al registrar la
  devolución (fase 4). Los feriados viven en la tabla `holidays`.
- **Confirmar que entró dinero es del negocio.** `settle` y `deposit-release`
  exigen la capacidad **Caja**; el cliente no puede darse por
  cobrado a sí mismo. Cada uno deja su entrada en la bitácora financiera, que
  Caja lee en `GET /api/orders/:id/finance-log`.
- **Un pedido reserva ejemplares**: `items` son ids de ejemplar. La respuesta
  trae `items` (los modelos, como los guarda el frontend) e `itemIds`. Anular
  libera la reserva y devuelve el ejemplar a Disponible si no llegó a entregarse.
  Anular un pedido ajeno es de **Administración**.
- **Las cuentas del personal no alquilan** (un cliente no puede ser trabajador).
- El estado de pago **se deriva**: un pedido está `settled` cuando no le queda
  ninguna línea `PENDING`.

**Nada de lo que llega en el cuerpo se cree sin comprobar.** `delivery`, `ret` y
`pay` se validan contra su lista cerrada (editar el HTML del navegador para
mandar un valor inventado da 400, no un pedido raro); los ids de prenda deben
ser enteros existentes y sin repetir; las fechas, `YYYY-MM-DD` y no en el
pasado. Las **direcciones** son texto libre pero acotado: obligatorias solo
cuando el modo las necesita, de 6 a 200 caracteres y se guardan recortadas. Un
valor que no es texto da **400**, no 500 — un error de entrada no puede parecer
una caída del servidor. Lo que el servidor **no** hace es sanear marcado: el
XSS se ataja escapando al pintar (`escapeHTML()`), que es la única defensa que
vale para todos los destinos, y un filtro aquí rompería direcciones legítimas.

Códigos: **400** entrada inválida · **401** sin credencial o expirada · **403**
hace falta una capacidad del local · **404** no existe o no es tuyo · **409**
conflicto de estado (fechas solapadas, pedido anulado, depósito ya devuelto).

### Personal y capacidades

Las capacidades viven en la base (`users.capabilities`): **Mostrador**, **Caja**,
**Inventario**, **Administración** (cuenta como todas), **Moderación** y
**Socios**. Se autoriza siempre por capacidad, nunca por cargo, y se leen en cada
petición, así que quitarle una a alguien surte efecto al instante. No hay ruta
que ascienda a nadie; se cambian desde la consola:

```bash
pnpm staff:grant persona@correo.com admin          # Administración
pnpm staff:grant persona@correo.com trabajador     # Mostrador + Caja
pnpm staff:grant persona@correo.com MOSTRADOR,INVENTARIO
pnpm staff:grant persona@correo.com ninguna        # baja
```

La persona tiene que haber entrado una vez con Google. Una cuenta con pedidos no
se convierte en personal. Cada cambio queda en la bitácora financiera.

### Panel del local (`/admin/`)

La misma API sirve el panel desde `admin/` (`@fastify/static`), así que llama a
`/api/…` en su propio origen: sin CORS y sin URL que configurar. Se entra con
Google y la sesión vive en `sessionStorage` (equipos compartidos). Para que el
botón de Google funcione, el origen del panel (`http://localhost:3000` en local
y la URL de Render) tiene que estar en los **orígenes autorizados** del cliente
OAuth en Google Cloud.

Pestaña **Pedidos**: entregar (Reservada → En alquiler), **registrar la
devolución**, confirmar el cobro y liberar la garantía (Caja), anular
(Administración). **Ejemplares**: cambio manual de estado y bitácora.
**Rezagadas**: los umbrales del §3. **Catálogo** (Inventario): alta y edición de
modelos, sus fotos (subir, ordenar, quitar; la primera es la portada) y alta de
ejemplares. Un modelo sin ejemplares no sale en la app y el panel lo avisa; la
lista se filtra por categoría, estado de los ejemplares, pendientes (sin
ejemplares o fotos), talla, color, material, ocasión, temporada y público.
**Taxonomía** (Inventario): añadir, renombrar, reordenar y borrar lo que nada
usa en cada lista.

**Entregar** y **registrar la devolución** piden al menos una foto de cada
prenda: la de salida es la referencia y la de llegada se compara con ella. Se
suben antes del cambio de estado, para que no quede una entrega o devolución
registrada sin su prueba. El navegador reduce las fotos grandes del móvil antes
de subirlas; quien las limpia de verdad es el servidor.

Cada pedido enseña una **tira de días** (alquiler, margen sin costo, días extra,
días cerrados rayados, hoy remarcado), y al registrar la devolución la tira se
rehace con el día elegido para anticipar los días extra (el importe lo decide
siempre el servidor). Cada prenda tiene **«Ver foto»**: una galería con las
fotos de salida y llegada de ese ejemplar y las del modelo. Las rutas antiguas
`img/products/…` se sirven en `/admin/fotos/` desde `../img/products/`; si esa
carpeta no está (un despliegue que solo trae `server/`), la galería dice que no
pudo cargar la foto. Con Supabase, la CSP del panel añade su origen a `img-src`.

Recibir anota el **día real** en que volvió la prenda (puede ser anterior al
registro, §6.3) y quién lo registró. Pasada la fecha límite se cobran los días
**hábiles** extra continuando la escalera del pedido —`precio(días + extra) −
precio(días)`—, en una línea `RENTAL` y una entrada `DIAS_EXTRA`. Recibir no
cambia el estado físico: llevarla a lavado es otro acto, y lo que se olvida ahí
aparece como rezagada.

> Cupones y puntos **todavía no**: el pedido aún no acepta `couponId`. Es la §2
> del plan de backend, y sin el ledger de puntos aceptar un descuento del
> cliente sería justo el agujero que se quiere cerrar.

## Scripts

| Script | Qué hace |
|---|---|
| `pnpm dev` | Arranca el servidor (con logs). |
| `pnpm db:migrate` | Crea una migración nueva a partir del cambio en el esquema (desarrollo). |
| `pnpm db:deploy` | Aplica el historial de migraciones tal cual (CI y producción). |
| `pnpm db:seed` | Siembra el catálogo: cada prenda de la lista es un modelo con un ejemplar de demostración sin código. **Idempotente**: inserta lo que falte, actualiza lo que ya esté y no borra nada, así que puede correrse sobre una base con pedidos vivos. Avisa de los modelos de la base que ya no están en la lista, sin tocarlos. La taxonomía no la siembra: viene en la migración. |
| `pnpm db:reset` | Recrea la base desde cero y siembra (**borra datos**). |
| `pnpm staff:grant <correo> <capacidades>` | Da, cambia o quita capacidades del personal (ver arriba). |
| `pnpm test` | Corre las pruebas (`node:test`) contra la app en memoria. |

> Los tests asumen que la base fue migrada y sembrada antes de correrlos.

## Variables de entorno

| Variable | Qué hace |
|---|---|
| `DATABASE_URL` | Conexión que usa la app. En Supabase es el **pooler** (pgbouncer, puerto 6543). |
| `DIRECT_URL` | Conexión **directa** (puerto 5432). La exigen las migraciones: el pooler no admite las sentencias preparadas de `prisma migrate` y falla con un error que no explica de dónde viene. En local suele ser la misma que `DATABASE_URL`. |
| `PORT` | Puerto del servidor (por defecto `3000`). |
| `CORS_ORIGINS` | Orígenes autorizados a leer la API, separados por comas: `CORS_ORIGINS="https://clothtogo.app"`. Vacía refleja cualquier origen — cómodo en desarrollo y para abrir el frontend por `file://`. **Con `NODE_ENV=production` es obligatoria: si falta, el servidor no arranca** (#18), para que un despliegue no quede abierto a todos los orígenes sin avisar. |
| `GOOGLE_CLIENT_ID` | Client ID de Google Cloud Console usado como `audience` al verificar el ID token en `POST /api/auth/google`. Debe coincidir con el `GOOGLE_CLIENT_ID` de `js/auth.js`. Sin esta variable, la ruta responde `500` en vez de arrancar rota. |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | Activan Supabase Storage para las fotos. La clave de servicio **solo** vive en el servidor. Sin las dos, las fotos van a disco. |
| `SUPABASE_BUCKET_PUBLIC` / `SUPABASE_BUCKET_PRIVATE` | Nombres de los cubos (por defecto `catalogo` y `ejemplares-privado`). |
| `MEDIA_DIR` | Carpeta del conductor de disco (por defecto `server/uploads/`). |
| `MEDIA_SIGNING_SECRET` | Secreto de los enlaces firmados en disco; sin él, uno aleatorio por proceso (los enlaces vivos caducan al reiniciar, que es inocuo). |
| `UPLOADS_PER_MINUTE` | Subidas por persona y minuto (por defecto 30). |

> CORS limita quién puede **leer** la respuesta, no quién puede **enviar** la
> petición, así que no protege contra CSRF. Cuando se agregue autenticación, la
> sesión debe viajar en el header `Authorization` (que el navegador nunca adjunta
> por su cuenta) en vez de en cookies; así el vector de CSRF no existe.

## Cómo lo consume el frontend

`js/api.js` resuelve el origen del backend con `resolveApiBase()` según dónde
corra la app, y si hay uno alcanzable intenta `GET {base}/api/products` al
iniciar; si responde,
reemplaza el catálogo embebido. Si el servidor no está disponible (o se abre por
`file://`), la app sigue con los datos locales de `js/data.js` — la demo nunca se
rompe por falta de backend.

`js/auth.js` sigue el mismo patrón para el login: si `backend.enabled`, envía
el ID token de Google a `POST /api/auth/google` y usa el `user` verificado por
el servidor; si no hay backend, cae a decodificar el token en el cliente
(modo demo, sin verificar firma) — el login nunca se rompe por falta de
backend, solo pierde la garantía de autenticidad.
