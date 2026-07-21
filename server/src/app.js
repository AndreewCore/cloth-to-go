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
 * Crea y configura la app.
 * @param {object} [opts] Opciones de Fastify (p. ej. logger).
 * @returns {import("fastify").FastifyInstance}
 */
export function buildApp(opts = {}) {
  const app = Fastify(opts);

  // CORS abierto en desarrollo. En producción se restringe al origen real
  // del frontend (dominio de la app / WebView).
  app.register(cors, { origin: true });

  // Salud del servicio: útil para monitoreo y para probar que está vivo.
  app.get("/api/health", async () => ({ status: "ok" }));

  // Catálogo completo, ordenado por id. Solo lectura por ahora.
  app.get("/api/products", async () => {
    return prisma.product.findMany({ orderBy: { id: "asc" } });
  });

  return app;
}
