/**
 * Autenticación de las peticiones que necesitan saber quién las hace.
 *
 * El cliente manda el **ID token de Google** en `Authorization: Bearer …` y el
 * servidor lo verifica en cada petición. No emitimos sesión propia: sería un
 * secreto más que custodiar, con su caducidad y su revocación, para un
 * prototipo que ya tiene un emisor de identidad perfectamente bueno. El precio
 * es que el token caduca (~1 h) y el cliente vuelve a pedir uno al SDK, que es
 * justo lo que el SDK hace solo.
 *
 * Por qué header y no cookie: el navegador NO adjunta `Authorization` por su
 * cuenta, así que un formulario hostil en otro sitio no puede hacer una
 * petición autenticada en nombre del usuario. Es la defensa contra CSRF que ya
 * anticipaba el comentario de CORS en app.js — CORS limita quién *lee* la
 * respuesta, no quién envía la petición.
 */
import prisma from "./db.js";

/**
 * Registra o actualiza al usuario a partir del payload verificado de Google.
 *
 * Se actualiza en cada visita porque el nombre y la foto cambian en Google y el
 * `sub` no: es el único campo por el que se puede buscar con seguridad.
 * @param {object} payload Payload ya verificado del ID token.
 * @returns {Promise<object>} Fila de `users`.
 */
export async function upsertUser(payload) {
  const data = {
    email: payload.email ?? "",
    name: payload.name ?? "",
    picture: payload.picture ?? null,
  };
  return prisma.user.upsert({
    where: { googleSub: payload.sub },
    update: data,
    create: { googleSub: payload.sub, ...data },
  });
}

/** Las capacidades del personal, como las nombra la base (§2.2). */
export const CAPABILITY = Object.freeze({
  MOSTRADOR: "MOSTRADOR",
  CAJA: "CAJA",
  INVENTARIO: "INVENTARIO",
  ADMINISTRACION: "ADMINISTRACION",
  MODERACION: "MODERACION",
  SOCIOS: "SOCIOS",
});

/**
 * Plantillas de alta. Son atajos para el script de consola, no valores
 * guardados: lo que se guarda y se comprueba es siempre la lista concreta.
 */
export const CAPABILITY_TEMPLATES = Object.freeze({
  admin: [CAPABILITY.ADMINISTRACION],
  trabajador: [CAPABILITY.MOSTRADOR, CAPABILITY.CAJA],
});

/**
 * Indica si el usuario tiene una capacidad.
 *
 * Administración cuenta como todas: es «todo lo anterior y más» por definición,
 * y obligar a marcarle cada casilla solo crea la ocasión de olvidar una.
 * @param {{capabilities?: string[]}|null|undefined} user Fila de `users`.
 * @param {string} cap Una de CAPABILITY.
 * @returns {boolean}
 */
export function hasCapability(user, cap) {
  const caps = user?.capabilities ?? [];
  return caps.includes(cap) || caps.includes(CAPABILITY.ADMINISTRACION);
}

/**
 * Indica si el usuario es personal del local (alguna capacidad). Un cliente
 * no puede ser trabajador (§2.1), así que esto también separa las cuentas.
 * @param {{capabilities?: string[]}|null|undefined} user Fila de `users`.
 * @returns {boolean}
 */
export function isStaff(user) {
  return (user?.capabilities ?? []).length > 0;
}

/**
 * Error con código HTTP, para que lo formatee el `setErrorHandler` de app.js.
 *
 * Los guards lanzan en vez de responder porque un preHandler que ya respondió
 * y otro que además lanza es una fuente clásica de doble envío; lanzando, hay
 * un único camino de salida y el handler de errores decide qué se ve.
 * @param {number} status Código HTTP.
 * @param {string} message Mensaje para el cliente (solo se muestra en 4xx).
 * @returns {Error} Error con `statusCode`.
 */
export function httpError(status, message) {
  const err = new Error(message);
  err.statusCode = status;
  return err;
}

/**
 * Crea los preHandlers de autenticación para una app dada.
 *
 * Recibe el verificador en vez de importarlo para que los tests puedan inyectar
 * uno falso, igual que hace `buildApp` con el login.
 * @param {(idToken: string) => Promise<object>} [verify] Verificador de tokens.
 * @returns {{requireUser: Function, requireCapability: Function}} preHandlers.
 */
export function createAuthGuards(verify) {
  /**
   * Exige un ID token válido y deja el usuario en `req.user`.
   * @param {import("fastify").FastifyRequest} req Petición.
   */
  async function requireUser(req) {
    const header = req.headers.authorization ?? "";
    const [esquema, token] = header.split(" ");
    if (esquema !== "Bearer" || !token) {
      throw httpError(401, "Falta la credencial de acceso.");
    }
    if (!verify) {
      req.log.error("GOOGLE_CLIENT_ID no está configurado en el servidor.");
      throw httpError(500, "Autenticación no disponible en el servidor.");
    }

    let payload;
    try {
      payload = await verify(token);
    } catch {
      // Mismo criterio que el login: expirado, audience distinta o firma rota
      // son todos "credencial inválida" de cara al cliente.
      throw httpError(401, "Credencial inválida o expirada.");
    }
    if (!payload?.sub) {
      throw httpError(401, "Credencial inválida o expirada.");
    }

    req.user = await upsertUser(payload);
  }

  /**
   * Crea un preHandler que exige usuario y al menos una de las capacidades.
   *
   * Las capacidades se leen de la base en cada petición (las trae
   * `requireUser`), así que quitarle una a alguien surte efecto al instante,
   * sin reiniciar nada: era el problema de la antigua lista ADMIN_SUBS.
   *
   * 403 y no 404: el recurso existe, lo que falta es permiso, y disfrazarlo de
   * "no existe" complica depurar sin esconder nada que el cliente no sepa ya.
   * @param {...string} caps Capacidades aceptadas (basta una).
   * @returns {(req: import("fastify").FastifyRequest) => Promise<void>}
   */
  function requireCapability(...caps) {
    return async (req) => {
      await requireUser(req);
      if (!caps.some((c) => hasCapability(req.user, c))) {
        throw httpError(403, "Solo el personal del local puede hacer esto.");
      }
    };
  }

  return { requireUser, requireCapability };
}
