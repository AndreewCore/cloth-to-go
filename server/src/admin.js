/**
 * Sirve el panel de administración en `/admin/` desde `server/admin/`.
 *
 * Va en la misma app que la API para que el panel llame a `/api/…` en su propio
 * origen: sin CORS, sin una URL de API que configurar y con la misma sesión.
 */
import { fileURLToPath } from "node:url";
import staticFiles from "@fastify/static";

const ROOT = fileURLToPath(new URL("../admin/", import.meta.url));

/**
 * CSP del panel. Solo el propio origen y lo imprescindible de Google Identity
 * (botón, ventana y su hoja de estilos). Sin `unsafe-inline`: un texto que se
 * cuele en el HTML no se ejecuta aunque falle el escapado.
 */
export const ADMIN_CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com/gsi/client",
  "style-src 'self' https://accounts.google.com/gsi/style",
  "frame-src https://accounts.google.com/gsi/",
  "connect-src 'self' https://accounts.google.com/gsi/",
  "img-src 'self' data: https://*.googleusercontent.com",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

/**
 * Registra los estáticos del panel y sus cabeceras de seguridad.
 * @param {import("fastify").FastifyInstance} app Instancia Fastify.
 */
export function registerAdminPanel(app) {
  app.register(async (panel) => {
    panel.addHook("onSend", async (req, reply) => {
      reply.header("Content-Security-Policy", ADMIN_CSP);
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Referrer-Policy", "no-referrer");
      // El panel enseña datos de clientes: que ninguna caché compartida lo guarde.
      reply.header("Cache-Control", "no-store");
    });
    panel.register(staticFiles, { root: ROOT, prefix: "/admin/" });
    // Sin la barra, las rutas relativas del HTML (admin.css, admin.js) se
    // resolverían contra la raíz del sitio.
    panel.get("/admin", (req, reply) => reply.redirect("/admin/"));
  });
}
