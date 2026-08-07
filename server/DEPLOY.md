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
- [ ] **`NODE_ENV=production`** en el entorno del servidor. Es lo que activa la
      exigencia de `CORS_ORIGINS` del punto siguiente; sin esta variable el
      servidor arranca con la política permisiva de desarrollo.
- [ ] **`CORS_ORIGINS`** definido con los orígenes exactos autorizados
      (p. ej. `https://andreewcore.github.io`), sin comodines. **Con
      `NODE_ENV=production` el servidor rehúsa arrancar si falta** (#18): es
      preferible un despliegue que no levanta a uno abierto a todos los
      orígenes en silencio. Fuera de producción, vacío sigue reflejando
      cualquier origen, que es lo cómodo en desarrollo.
- [x] **Provider y migraciones.** `schema.prisma` ya es `postgresql` y el
      historial vive en `prisma/migrations/`, commiteado. Esta casilla daba por
      hecho algo que no existía hasta la rama de migraciones.
- [ ] **`DATABASE_URL`** apuntando a la base de producción (el *pooler* si es
      Supabase, puerto 6543) y **`DIRECT_URL`** a la conexión directa (5432).
      Sin la segunda, `prisma migrate deploy` no puede aplicar nada.
- [ ] **Migraciones aplicadas en producción**: `pnpm db:deploy` (nunca
      `migrate dev`, que puede reescribir el historial) y después `pnpm db:seed`.
      La semilla ya no es solo «la primera vez»: no borra nada y puede volver a
      correrse sobre una base con pedidos para propagar un cambio de catálogo.

## Configuración del frontend

- [ ] **`DEPLOYED_API`** (en `js/api.js`) fijado a la URL `https` del backend.
      Mientras siga en `null`, producción corre en **modo demo silencioso**
      (ver #17).
- [ ] Origen(es) de producción añadidos en Google Cloud Console → *Authorized
      JavaScript origins* del Client ID OAuth.

## Riesgos que BLOQUEABAN el login real — cerrados en `feature/backend-deploy`

Detectados en la revisión de seguridad del PR #15:

- [x] **#16** — Errores internos del backend ya no se filtran. `setErrorHandler`
      global: los 5xx responden `{ error: "Error interno del servidor." }` y el
      detalle queda solo en el log del servidor. Los 4xx conservan su mensaje,
      que lo redacta la app y no expone nada del interior.
- [x] **#17** — `resolveApiBase()` distingue `misconfigured` (origen de
      producción sin `DEPLOYED_API`) de `undeployed` (cualquier otro host, que
      es una espera legítima). Ante `misconfigured`, `onGoogleCredential` se
      niega a decodificar el token en local y avisa al usuario, en vez de
      autenticar sin verificar la firma.
- [x] **#18** — Con `NODE_ENV=production`, `corsOrigin()` lanza si falta
      `CORS_ORIGINS` y el servidor no arranca.

**Ojo:** cerrarlos elimina el fallo *silencioso*, no sustituye a la
configuración. Los puntos de arriba siguen siendo obligatorios — ahora el
despliegue te avisa cuando faltan en vez de correr en modo demo sin decirlo.

## Verificación previa a poner en vivo

- [ ] `pnpm run lint` (raíz) limpio y `pnpm test` (en `server/`) en verde.
- [ ] Con el backend desplegado: iniciar sesión con Google **funciona** (token
      verificado, usuario en la base).
- [ ] Con el backend **caído** a propósito: el login **no** entra y muestra un
      mensaje claro (no cae a modo demo).
- [ ] Un token que el servidor rechaza **no** inicia sesión por ninguna vía.

> Referencias: PR #15 (verificación en servidor), issues #16 / #17 / #18
> (riesgos bloqueantes), `server/.env.example` (variables), `server/README.md`.
