/**
 * Construcción de la instancia Fastify y registro de rutas.
 *
 * Se separa del arranque (server.js) para que los tests puedan levantar la app
 * en memoria con `app.inject()` sin abrir un puerto real.
 */
import Fastify from "fastify";
import cors from "@fastify/cors";
import prisma from "./db.js";
import { createGoogleVerifier } from "./googleAuth.js";
import { createAuthGuards, upsertUser } from "./auth.js";
import { registerOrderRoutes } from "./orders.js";

/**
 * Resuelve la política de CORS a partir de CORS_ORIGINS.
 *
 * Con la variable definida (lista separada por comas) solo esos orígenes pueden
 * leer respuestas de la API; sin ella se refleja cualquier origen, cómodo para
 * desarrollo y para abrir el frontend por file://.
 *
 * Nota: CORS limita quién *lee* la respuesta, no quién envía la petición; no es
 * una defensa contra CSRF. Esa se resuelve autenticando con el header
 * `Authorization` (que el navegador nunca adjunta solo) en vez de cookies.
 *
 * @returns {true|string[]} Valor para la opción `origin` de @fastify/cors.
 */
function corsOrigin() {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (!raw) {
    // En producción, olvidar la variable dejaba la API abierta a cualquier
    // origen sin decir nada. Un deploy permisivo en silencio es peor que uno
    // que no arranca: el segundo se nota en el primer despliegue.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "CORS_ORIGINS es obligatoria con NODE_ENV=production: sin ella la API " +
          "reflejaría cualquier origen. Defínela con la lista de orígenes " +
          "permitidos separados por comas (ver DEPLOY.md)."
      );
    }
    return true;
  }
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Crea y configura la app.
 *
 * `verifyGoogleToken` se separa del resto de opciones (que van a Fastify tal
 * cual) para poder inyectar un verificador falso desde los tests sin llamar
 * a los servidores reales de Google.
 * @param {object} [opts] Opciones de Fastify (p. ej. logger).
 * @param {(idToken: string) => Promise<object>} [opts.verifyGoogleToken]
 *   Verificador de ID tokens; por defecto se crea contra GOOGLE_CLIENT_ID.
 * @returns {import("fastify").FastifyInstance}
 */
export function buildApp(opts = {}) {
  const { verifyGoogleToken, ...fastifyOpts } = opts;
  const app = Fastify(fastifyOpts);

  app.register(cors, { origin: corsOrigin() });

  // Nada de errores internos hacia el cliente. El handler por defecto de
  // Fastify responde 500 con `err.message`, que en un fallo de Prisma incluye
  // nombres de columnas y constraints: un mapa gratis del esquema para quien
  // sondee la API. El detalle se registra completo del lado del servidor, que
  // es donde sirve para depurar.
  app.setErrorHandler((err, request, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err }, "Error interno no controlado");
      return reply.code(500).send({ error: "Error interno del servidor." });
    }
    // Los 4xx sí llevan mensaje: los redacta la app para el cliente (validación,
    // credencial inválida) y no exponen nada del interior.
    return reply.code(status).send({ error: err.message });
  });

  // Sin GOOGLE_CLIENT_ID no hay contra qué verificar audience: se detecta acá
  // (una vez, al construir la app) en vez de fallar a mitad de una petición.
  const verify =
    verifyGoogleToken ??
    (process.env.GOOGLE_CLIENT_ID ? createGoogleVerifier(process.env.GOOGLE_CLIENT_ID) : null);

  // Salud del servicio: útil para monitoreo y para probar que está vivo.
  app.get("/api/health", async () => ({ status: "ok" }));

  // Catálogo completo, ordenado por id. Solo lectura por ahora.
  // La fila sale tal cual: `imgs` ya es una lista en la base, así que no queda
  // nada que traducir entre el almacén y el cliente (con SQLite había que
  // deshacer un JSON serializado en cada respuesta).
  app.get("/api/products", async () => prisma.product.findMany({ orderBy: { id: "asc" } }));

  // Verifica el ID token de Google en el servidor (el frontend solo lo
  // decodifica, sin comprobar firma) y registra/actualiza al usuario.
  // Éxito → { user }; token inválido/ausente → 401 sin detalle interno.
  app.post("/api/auth/google", async (req, reply) => {
    const credential = req.body?.credential;
    if (!credential) {
      return reply.code(401).send({ error: "Falta el credential de Google." });
    }
    if (!verify) {
      req.log.error("GOOGLE_CLIENT_ID no está configurado en el servidor.");
      return reply.code(500).send({ error: "Login con Google no disponible en el servidor." });
    }

    let payload;
    try {
      payload = await verify(credential);
    } catch {
      // No exponemos el motivo real (expirado, audience distinta, firma
      // inválida, …): de cara al cliente todo eso es "credential inválida".
      return reply.code(401).send({ error: "Credential de Google inválida." });
    }
    if (!payload?.sub) {
      return reply.code(401).send({ error: "Credential de Google inválida." });
    }

    const user = await upsertUser(payload);

    return {
      user: { sub: user.googleSub, name: user.name, email: user.email, picture: user.picture },
    };
  });

  // Pedidos y libro de cargos. Todas exigen credencial; las de confirmar cobro
  // y liberar depósito, además, ser del personal del local.
  registerOrderRoutes(app, createAuthGuards(verify));

  return app;
}
