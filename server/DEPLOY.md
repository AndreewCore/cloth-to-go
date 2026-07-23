# Checklist de despliegue — habilitar el login real

El login con Google pasa de **modo demo** (identidad sin verificar, en el
navegador) a **verificado por el servidor** en cuanto `backend.enabled` es
`true` en producción — es decir, en cuanto `DEPLOYED_API` (en `js/api.js`)
apunta a un backend `https` alcanzable.

**No habilites el login real hasta cumplir TODOS los puntos siguientes.** Están
en este orden por dependencia.

## Configuración del backend

- [ ] **`GOOGLE_CLIENT_ID`** definido en el entorno del servidor, **idéntico**
      al Client ID que usa el frontend en `js/auth.js`. Si no coinciden, la
      verificación (`audience`) rechaza todos los tokens.
- [ ] **`CORS_ORIGINS`** definido con los orígenes exactos autorizados
      (p. ej. `https://andreewcore.github.io`), sin comodines. Vacío = refleja
      cualquier origen (ver #18).
- [ ] **`DATABASE_URL`** apuntando a la base de producción (Postgres), con el
      `provider` del `schema.prisma` cambiado a `postgresql` y las migraciones
      aplicadas.

## Configuración del frontend

- [ ] **`DEPLOYED_API`** (en `js/api.js`) fijado a la URL `https` del backend.
      Mientras siga en `null`, producción corre en **modo demo silencioso**
      (ver #17).
- [ ] Origen(es) de producción añadidos en Google Cloud Console → *Authorized
      JavaScript origins* del Client ID OAuth.

## Riesgos que BLOQUEAN el login real (deben cerrarse en `feature/backend-deploy`)

Detectados en la revisión de seguridad del PR #15. Cada uno tiene su issue con
criterio de cierre:

- [ ] **#16** — Errores internos del backend (Prisma) pueden filtrarse al
      cliente en un 500. Requiere `setErrorHandler` global o try/catch en el
      upsert, con respuesta genérica.
- [ ] **#17** — Olvidar `DEPLOYED_API` deja producción en modo demo silencioso.
      Requiere una guarda de frontend que falle en voz alta en el origen de
      producción si no hay backend.
- [ ] **#18** — `CORS_ORIGINS` vacío refleja cualquier origen. Requiere que el
      servidor rehúse arrancar en `NODE_ENV=production` sin esa variable.

## Verificación previa a poner en vivo

- [ ] `pnpm run lint` (raíz) limpio y `pnpm test` (en `server/`) en verde.
- [ ] Con el backend desplegado: iniciar sesión con Google **funciona** (token
      verificado, usuario en la base).
- [ ] Con el backend **caído** a propósito: el login **no** entra y muestra un
      mensaje claro (no cae a modo demo).
- [ ] Un token que el servidor rechaza **no** inicia sesión por ninguna vía.

> Referencias: PR #15 (verificación en servidor), issues #16 / #17 / #18
> (riesgos bloqueantes), `server/.env.example` (variables), `server/README.md`.
