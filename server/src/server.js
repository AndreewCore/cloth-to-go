/**
 * Punto de arranque del servidor: construye la app, activa WAL y escucha.
 * El puerto sale de la variable de entorno PORT (por defecto 3000).
 */
import { buildApp } from "./app.js";
import { initDb } from "./db.js";

const PORT = Number(process.env.PORT) || 3000;

const app = buildApp({ logger: true });

await initDb();
app.listen({ port: PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
