/**
 * Punto de arranque del servidor: construye la app y escucha.
 * El puerto sale de la variable de entorno PORT (por defecto 3000).
 */
import { buildApp } from "./app.js";

const PORT = Number(process.env.PORT) || 3000;

// Detrás del proxy de Render, sin esto `req.ip` sería la IP del proxy y el
// límite por IP del asistente contaría a todos como una sola persona. Es un
// número de saltos, no `true`: con `true` se creería el X-Forwarded-For entero,
// que el cliente puede falsificar para saltarse el límite.
const TRUST_PROXY = Number(process.env.TRUST_PROXY) || false;

const app = buildApp({ logger: true, trustProxy: TRUST_PROXY });

app.listen({ port: PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
