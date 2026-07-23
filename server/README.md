# CLOTH TO GO · Backend (API)

API del prototipo, construida con **Fastify + Prisma + SQLite**. Expone el
**catálogo** en modo lectura y la **verificación de login con Google**;
alquileres, pagos y envíos llegarán en iteraciones posteriores.

> **Estado:** scaffold inicial. SQLite es la base de **desarrollo/testeo**; para
> producción se migra a PostgreSQL cambiando `provider` y `DATABASE_URL` en
> `prisma/schema.prisma` (el código de la app no cambia).

## Requisitos

- Node.js 18+ y **pnpm**.

## Puesta en marcha

```bash
cd server
pnpm install            # instala dependencias y genera el cliente Prisma
cp .env.example .env    # configura DATABASE_URL y PORT
pnpm db:reset           # crea la base SQLite y siembra las 10 prendas
pnpm dev                # levanta el servidor en http://localhost:3000
```

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Estado del servicio (`{ "status": "ok" }`). |
| GET | `/api/products` | Catálogo completo, ordenado por `id`. |
| POST | `/api/auth/google` | Verifica un ID token de Google y registra/actualiza al usuario. |

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

## Scripts

| Script | Qué hace |
|---|---|
| `pnpm dev` | Arranca el servidor (con logs). |
| `pnpm db:push` | Aplica el esquema a la base sin borrar datos. |
| `pnpm db:seed` | Siembra el catálogo. |
| `pnpm db:reset` | Recrea la base desde cero y siembra (**borra datos**). |
| `pnpm test` | Corre las pruebas (`node:test`) contra la app en memoria. |

> Los tests asumen que la base fue sembrada (`pnpm db:reset`) antes de correrlos.

## Variables de entorno

| Variable | Qué hace |
|---|---|
| `DATABASE_URL` | Conexión de Prisma. `file:./dev.db` en desarrollo. |
| `PORT` | Puerto del servidor (por defecto `3000`). |
| `CORS_ORIGINS` | Orígenes autorizados a leer la API, separados por comas. Si está vacía se refleja cualquier origen — cómodo en desarrollo y para abrir el frontend por `file://`, pero **defínela en producción**: `CORS_ORIGINS="https://clothtogo.app"`. |
| `GOOGLE_CLIENT_ID` | Client ID de Google Cloud Console usado como `audience` al verificar el ID token en `POST /api/auth/google`. Debe coincidir con el `GOOGLE_CLIENT_ID` de `js/auth.js`. Sin esta variable, la ruta responde `500` en vez de arrancar rota. |

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
