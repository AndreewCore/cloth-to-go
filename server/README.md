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

## Cómo lo consume el frontend

`js/api.js` intenta `GET {API_BASE}/api/products` al iniciar y, si responde,
reemplaza el catálogo embebido. Si el servidor no está disponible (o se abre por
`file://`), la app sigue con los datos locales de `js/data.js` — la demo nunca se
rompe por falta de backend.
