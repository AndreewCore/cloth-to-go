# Despliegue — CLOTH TO GO

Paso a paso para poner en vivo las tres piezas y, con ellas, el **login real**.

```
  Navegador                Fastify                Postgres
  GitHub Pages    ──────▶   Render      ──────▶   Supabase
  (main)                    (main)                (una sola base)
```

El navegador **nunca** habla con la base: las credenciales de Postgres no salen
de Render. Las tres siguen a `main`, así que lo publicado en el navegador y lo
publicado en la API salen siempre del mismo commit.

**Orden obligatorio.** Cada parte necesita algo que produce la anterior: Render
necesita las cadenas de Supabase, el frontend necesita la URL de Render, y
Google Cloud necesita ambas. No se puede empezar por el final.

> **Una sola base**, sin *staging* (§10.2 de `README-DECISIONES-BACKEND.md`).
> Es defendible mientras no haya cobros reales. El compromiso escrito: la
> segunda base se crea **antes** del primer cobro real, no después.

---

## 0. Antes de empezar

Necesitás en la mano:

- Cuenta de **Supabase**, de **Render** y acceso a **Google Cloud Console** del
  proyecto que emite el Client ID.
- El repo clonado y `server/` con dependencias instaladas (`pnpm install`).
- El **`googleSub`** de quien vaya a operar el local (para `ADMIN_SUBS`). Si no
  lo tenés todavía, se puede dejar vacío y añadirlo después: sin él nadie es
  admin y `settle` / `deposit-release` / `late-penalty` responden `403`.

Y con todo limpio antes de tocar nada externo:

```bash
pnpm run lint          # en la raíz
cd server && pnpm test # requiere una base local migrada y sembrada
```

---

## 1. Base de datos en Supabase

### 1.1 Crear el proyecto

1. [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. **Name:** `cloth-to-go`.
3. **Database Password:** generala con el botón y **guardala en un gestor de
   contraseñas ahora mismo**. Supabase no la vuelve a mostrar; recuperarla
   obliga a resetearla y a rehacer las dos cadenas de conexión.
4. **Region:** `East US (North Virginia)` — la misma zona que el servicio de
   Render del paso 2. Server y base en continentes distintos añaden latencia a
   **cada** consulta, y el libro de cargos hace varias por pedido. La región se
   elige una sola vez: cambiarla después es migrar todo.
5. Crear y esperar a que el proyecto termine de aprovisionarse (~2 min).

### 1.2 Sacar las DOS cadenas de conexión

En el proyecto → botón **Connect** (arriba) → pestaña **ORMs** o **Connection
string**. Hacen falta dos cadenas distintas, y confundirlas es el error más
común de este despliegue:

| Variable | Qué cadena | Puerto | Para qué |
|---|---|---|---|
| `DATABASE_URL` | **Transaction pooler** | `6543` | La que usa la app en Render. |
| `DIRECT_URL` | **Session pooler** (o *Direct connection*) | `5432` | La que usan las migraciones. |

**Por qué dos.** El *transaction pooler* (pgbouncer) no admite las sentencias
preparadas que usa `prisma migrate`, y falla con un error que no explica de
dónde viene. Por eso el esquema declara `directUrl` aparte.

Dos detalles que Supabase no te avisa:

- A `DATABASE_URL` hay que **añadirle a mano** `?pgbouncer=true&connection_limit=1`
  al final. Sin `pgbouncer=true`, Prisma intenta usar sentencias preparadas
  contra el pooler y revienta en caliente, no al arrancar.
- Para `DIRECT_URL`, usá el **Session pooler** y no la *Direct connection*
  salvo que tu red tenga IPv6: la conexión directa de los proyectos nuevos es
  **solo IPv6**, y desde una red IPv4 falla con «could not translate host name».
  El session pooler (puerto 5432, host `...pooler.supabase.com`) sirve IPv4 y
  admite migraciones.

Reemplazá `[YOUR-PASSWORD]` por la del paso 1.1. Si la contraseña tiene
caracteres raros (`@`, `/`, `#`, `:`), hay que **codificarlos en porcentaje** o
la URL se parte por el medio.

Quedan así (tus valores reales cambian el `ref` y la región):

```
DATABASE_URL="postgresql://postgres.abcdefgh:CLAVE@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://postgres.abcdefgh:CLAVE@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
```

### 1.3 Aplicar migraciones y sembrar el catálogo

Desde **local**, apuntando a Supabase. Poné las dos cadenas en `server/.env`
(está en `.gitignore`; **no** se commitea) y ejecutá:

```bash
cd server
pnpm exec prisma migrate status   # debe decir que hay migraciones sin aplicar
pnpm db:deploy                    # aplica el historial commiteado, tal cual
pnpm db:seed                      # siembra las 16 prendas
```

- **`db:deploy`, nunca `db:migrate`.** `migrate dev` puede reescribir el
  historial y, ante una divergencia, ofrece *resetear la base* — sobre
  producción eso es borrar el negocio.
- **`db:seed` es idempotente**: inserta lo que falte, actualiza lo que ya esté
  y no borra nada. Se puede volver a correr sobre una base con pedidos vivos
  para propagar un cambio de catálogo; avisa de las prendas que ya no están en
  la lista, sin tocarlas.

**Comprobalo** en Supabase → **Table Editor**: deben existir `Product` (16
filas), `User`, `Order`, `OrderItem` y `Charge`.

> Las migraciones se aplican **a mano** y no en el build de Render a propósito:
> «migraciones automáticas al desplegar» sigue siendo una decisión aplazada
> (§10.1). Un `migrate deploy` automático corre sin nadie mirando y sobre la
> única base que existe.
>
> Y acordate de **devolver `server/.env` a tu base local** cuando termines, o
> tus pruebas de desarrollo escribirán en producción.

---

## 2. Servidor Fastify en Render

### 2.1 Crear el servicio

El repo ya trae `render.yaml` en la raíz, así que no hay que rellenar el
formulario a mano:

1. [dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint**.
2. Conectá el repositorio `AndreewCore/cloth-to-go` y autorizá el acceso.
3. Render lee `render.yaml` y propone el servicio `cloth-to-go-api`:
   `rootDir: server`, rama `main`, plan gratuito, health check en
   `/api/health`.
4. **Apply**. Render pedirá las variables marcadas `sync: false` — son las del
   paso siguiente.

Si la región `virginia` no aparece en el plan gratuito, elegí `ohio` y creá el
proyecto de Supabase en *East US* igualmente.

### 2.2 Variables de entorno

En el servicio → **Environment**. `NODE_ENV=production` y `NODE_VERSION=22` ya
vienen del blueprint; estas cinco las escribís vos:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | La del pooler de transacciones (6543, con `?pgbouncer=true&connection_limit=1`). |
| `DIRECT_URL` | La del session pooler (5432). |
| `CORS_ORIGINS` | `https://andreewcore.github.io` — **exacto, sin barra final y sin comodines**. |
| `GOOGLE_CLIENT_ID` | `115840486389-f3vitcouhua5eckn3grn1gk9kqb7ccjs.apps.googleusercontent.com` (idéntico al de `js/auth.js`). |
| `ADMIN_SUBS` | El `googleSub` del personal, separados por comas. Vacía = nadie es admin. |

Tres avisos que ahorran una tarde:

- **`CORS_ORIGINS` es obligatoria con `NODE_ENV=production`**: si falta, el
  servidor **no arranca** (#18). Es a propósito — un despliegue que no levanta
  se nota; uno abierto a todos los orígenes en silencio, no.
- **`GOOGLE_CLIENT_ID` debe coincidir carácter por carácter** con el del
  frontend. Es el `audience` contra el que se verifica el token: si difieren,
  la API rechaza *todos* los logins con un 401 que no dice por qué.
- **`PORT` no se define.** Render inyecta el suyo y `src/server.js` ya lo lee.
  Fijarlo a mano rompe el health check.

### 2.3 Comprobar que vive

Render te da una URL tipo `https://cloth-to-go-api.onrender.com`. **Anotala: es
lo que necesita el paso 4.**

```bash
curl https://cloth-to-go-api.onrender.com/api/health
# {"status":"ok"}

curl https://cloth-to-go-api.onrender.com/api/products | head -c 300
# el catálogo sembrado en el paso 1.3
```

Si `/api/health` responde y `/api/products` da 500, el servidor está vivo pero
no llega a la base: revisá `DATABASE_URL` en los logs de Render (el detalle del
error **no** viaja al cliente por diseño, #16 — está en el log del servidor).

> **El plan gratuito duerme el servicio a los ~15 min sin tráfico** y el primer
> request después tarda ~50 s. La app no se rompe (`hydrateCatalog()` cae al
> catálogo embebido), pero el login **sí** falla mientras despierta. Si va a
> haber una demostración en vivo, abrí `/api/health` un minuto antes.

---

## 3. Google Cloud Console

Sin esto el botón de Google no aparece o falla en el origen publicado.

1. [console.cloud.google.com](https://console.cloud.google.com) → **APIs y
   servicios** → **Credenciales** → el Client ID de OAuth 2.0 del proyecto.
2. **Authorized JavaScript origins** → añadir `https://andreewcore.github.io`
   (solo el origen: **sin** ruta, sin `/cloth-to-go`, sin barra final).
3. Guardar. Los cambios pueden tardar unos minutos en propagarse.

No hace falta añadir la URL de Render: el token lo emite Google en el
navegador, y el servidor solo lo verifica.

---

## 4. Frontend en GitHub Pages

### 4.1 Apuntar la app al backend

Una línea, en `js/api.js`:

```js
const DEPLOYED_API = "https://cloth-to-go-api.onrender.com";  // sin barra final
```

Mientras siga en `null`, el sitio publicado corre en **modo demo bloqueado**:
`resolveApiBase()` detecta un origen de producción sin backend, lo marca como
`misconfigured` y `auth.js` **se niega** a decodificar el token localmente
(#17). Es decir: no es que el login funcione peor — es que no funciona, a
propósito, para no autenticar sin verificar la firma.

### 4.2 Publicar

`pages.yml` despliega en cada push a `main` (y tiene `workflow_dispatch` para
re-desplegar a mano). Por la cadena normal:

```
feature/despliegue-supabase-render ──PR──▶ dev ──PR──▶ staging ──PR──▶ main
```

Al fusionar en `main`, Pages publica solo y Render redespliega solo (ambos
siguen `main`). El deploy de Render tarda unos minutos más que el de Pages.

---

## 5. Verificación previa a darlo por vivo

- [ ] `pnpm run lint` (raíz) limpio y `pnpm test` (en `server/`) en verde.
- [ ] `GET /api/health` y `GET /api/products` responden por `https`.
- [ ] El catálogo de la app publicada viene de la API: en la consola de
      Firefox debe verse `Catálogo cargado desde el backend (16 prendas).`
- [ ] Iniciar sesión con Google **funciona** y el usuario aparece en la tabla
      `User` de Supabase.
- [ ] Con el backend caído a propósito (suspender el servicio en Render): el
      login **no** entra y muestra un mensaje claro — no cae a modo demo.
- [ ] Un token que el servidor rechaza **no** inicia sesión por ninguna vía.
- [ ] Desde otro origen (p. ej. `file://` o `localhost`), `fetch` a la API es
      bloqueado por CORS. Si **no** lo es, `CORS_ORIGINS` no se aplicó.

---

## 6. Cuando algo sale mal

| Síntoma | Causa casi siempre |
|---|---|
| Render no arranca: *«CORS_ORIGINS es obligatoria…»* | Falta la variable, o quedó con barra final. |
| `prisma migrate` cuelga o da error de sentencias preparadas | `DIRECT_URL` apunta al pooler de 6543 en vez del de 5432. |
| *«could not translate host name»* al migrar | Estás usando *Direct connection* (solo IPv6) desde una red IPv4. Usá el **session pooler**. |
| 500 en `/api/products`, health OK | `DATABASE_URL` mal, o falta `?pgbouncer=true`. |
| Login da 401 siempre | `GOOGLE_CLIENT_ID` distinto entre servidor y `js/auth.js`. |
| El botón de Google no aparece en Pages | Falta el origen en *Authorized JavaScript origins*. |
| La app publicada muestra el catálogo viejo | `DEPLOYED_API` sigue en `null`, o Pages no redesplegó. |
| Primer request tarda 50 s | El servicio gratuito estaba dormido. Es lo esperado. |

**Rollback.** `pages.yml` tiene `workflow_dispatch`: re-desplegar un tag
anterior es el botón de pánico del frontend. Render mantiene el historial de
deploys y permite **Rollback** a uno previo desde el panel. Lo que **no** tiene
vuelta atrás fácil es una migración aplicada: por eso se aplican a mano.

> ⚠️ El simulacro de rollback **no se ha probado en frío** (ver
> `RAMAS-PENDIENTES.md`). Si el entorno `github-pages` tiene regla de
> protección, conviene saberlo antes de necesitarlo.

---

## Anexo — riesgos que bloqueaban el login real (cerrados)

Detectados en la revisión de seguridad del PR #15 y resueltos en
`feature/backend-deploy`:

- [x] **#16** — Los errores internos ya no se filtran. `setErrorHandler` global:
      los 5xx responden `{ error: "Error interno del servidor." }` y el detalle
      queda solo en el log. Los 4xx conservan su mensaje, redactado por la app.
- [x] **#17** — `resolveApiBase()` distingue `misconfigured` (origen de
      producción sin `DEPLOYED_API`) de `undeployed` (espera legítima). Ante
      `misconfigured`, no se decodifica el token en local.
- [x] **#18** — Con `NODE_ENV=production`, el servidor no arranca sin
      `CORS_ORIGINS`.
- [x] **Provider y migraciones.** `schema.prisma` ya es `postgresql` y el
      historial vive commiteado en `prisma/migrations/`.

Cerrarlos eliminó el fallo *silencioso*, no la necesidad de configurar: los
pasos de arriba siguen siendo obligatorios — ahora el despliegue avisa cuando
faltan en vez de correr en modo demo sin decirlo.

> Referencias: `server/README.md` (endpoints y variables), `server/.env.example`,
> `render.yaml`, `.github/workflows/pages.yml`, §10 de
> `README-DECISIONES-BACKEND.md`.
