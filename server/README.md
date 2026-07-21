# CLOTH TO GO · Backend (API)

API del prototipo, construida con **Fastify + Prisma + SQLite**. Por ahora solo
expone el **catálogo** en modo lectura; auth, alquileres, pagos y envíos llegarán
en iteraciones posteriores.

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

> CORS limita quién puede **leer** la respuesta, no quién puede **enviar** la
> petición, así que no protege contra CSRF. Cuando se agregue autenticación, la
> sesión debe viajar en el header `Authorization` (que el navegador nunca adjunta
> por su cuenta) en vez de en cookies; así el vector de CSRF no existe.

## Cómo lo consume el frontend

`js/api.js` intenta `GET {API_BASE}/api/products` al iniciar y, si responde,
reemplaza el catálogo embebido. Si el servidor no está disponible (o se abre por
`file://`), la app sigue con los datos locales de `js/data.js` — la demo nunca se
rompe por falta de backend.
