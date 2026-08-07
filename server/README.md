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
| POST | `/api/auth/google` | Verifica un ID token de Google y registra/actualiza al usuario. |
| GET | `/api/orders` | Pedidos del usuario autenticado, con su libro de cargos. |
| POST | `/api/orders` | Crea un pedido y sus cargos iniciales. |
| PATCH | `/api/orders/:id/return` | Cambia el modo de devolución → **genera un ajuste**. |
| POST | `/api/orders/:id/cancel` | Anula el pedido y revierte sus cargos. |
| POST | `/api/orders/:id/settle` | **Solo local**: confirma que el efectivo entró. |
| POST | `/api/orders/:id/deposit-release` | **Solo local**: libera el depósito. |
| POST | `/api/orders/:id/late-penalty` | **Solo local**: cobra la devolución fuera de plazo. |

### `POST /api/auth/google`

Recibe `{ "credential": "<ID token de Google>" }` (el mismo token que el
frontend obtiene de Google Identity Services) y lo verifica en el servidor con
[`google-auth-library`](https://www.npmjs.com/package/google-auth-library)
contra `GOOGLE_CLIENT_ID` (audience). El frontend por sí solo solo *decodifica*
ese token (sin comprobar la firma) — esta ruta es la que de verdad autentica.

- **200** → `{ "user": { "sub", "name", "email", "picture" } }`. El usuario
  queda registrado (upsert por `googleSub`) en la tabla `users`.
- **401** → credential ausente o que no verifica (firma, expiración o
  audience inválidas). El mensaje no expone el motivo interno.
- **500** → falta `GOOGLE_CLIENT_ID` en el entorno del servidor.

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
- **Confirmar que entró dinero es del negocio.** `settle`, `deposit-release` y
  `late-penalty` exigen estar en `ADMIN_SUBS`; el cliente no puede darse por
  cobrado a sí mismo.
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
hace falta ser del local · **404** no existe o no es tuyo · **409** conflicto de
estado (prenda ya alquilada, pedido anulado, depósito ya devuelto).

> Cupones y puntos **todavía no**: el pedido aún no acepta `couponId`. Es la §2
> del plan de backend, y sin el ledger de puntos aceptar un descuento del
> cliente sería justo el agujero que se quiere cerrar.

## Scripts

| Script | Qué hace |
|---|---|
| `pnpm dev` | Arranca el servidor (con logs). |
| `pnpm db:migrate` | Crea una migración nueva a partir del cambio en el esquema (desarrollo). |
| `pnpm db:deploy` | Aplica el historial de migraciones tal cual (CI y producción). |
| `pnpm db:seed` | Siembra el catálogo. **Idempotente**: inserta lo que falte, actualiza lo que ya esté y no borra nada, así que puede correrse sobre una base con pedidos vivos. Avisa de las prendas de la base que ya no están en la lista, sin tocarlas. |
| `pnpm db:reset` | Recrea la base desde cero y siembra (**borra datos**). |
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
| `ADMIN_SUBS` | `googleSub` del personal del local, separados por comas. Son los únicos que pueden confirmar cobros, liberar depósitos y cobrar atrasos. Va en el entorno y no en una columna `role` a propósito: **no hay endpoint que ascienda a nadie**, así que el permiso no se puede escalar desde la propia API. Vacía = nadie es admin, y esas tres rutas responden `403` a todo el mundo. |

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
