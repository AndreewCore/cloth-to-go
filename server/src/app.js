/**
 * Construcción de la instancia Fastify y registro de rutas.
 *
 * Se separa del arranque (server.js) para que los tests puedan levantar la app
 * en memoria con `app.inject()` sin abrir un puerto real.
 */
import Fastify from "fastify";
import cors from "@fastify/cors";
import prisma from "./db.js";

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
  if (!raw) return true;
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Crea y configura la app.
 * @param {object} [opts] Opciones de Fastify (p. ej. logger).
 * @returns {import("fastify").FastifyInstance}
 */
export function buildApp(opts = {}) {
  const app = Fastify(opts);

  app.register(cors, { origin: corsOrigin() });

  // Salud del servicio: útil para monitoreo y para probar que está vivo.
  app.get("/api/health", async () => ({ status: "ok" }));

  // Catálogo completo, ordenado por id. Solo lectura por ahora.
  app.get("/api/products", async () => {
    return prisma.product.findMany({ orderBy: { id: "asc" } });
  });

  return app;
}
