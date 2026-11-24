/**
 * Sirve el panel de administración en `/admin/` desde `server/admin/`.
 *
 * Va en la misma app que la API para que el panel llame a `/api/…` en su propio
 * origen: sin CORS, sin una URL de API que configurar y con la misma sesión.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import staticFiles from "@fastify/static";

const ROOT = fileURLToPath(new URL("../admin/", import.meta.url));
/**
 * Fotos del catálogo (`products.imgs` guarda rutas `img/products/…` relativas
 * al sitio). El panel las sirve en su propio origen para no abrir la CSP a
 * otro dominio solo para ver qué prenda es cuál.
 */
const PHOTOS = fileURLToPath(new URL("../../img/products/", import.meta.url));

/**
 * CSP del panel. Solo el propio origen y lo imprescindible de Google Identity
 * (botón, ventana y su hoja de estilos). Sin `unsafe-inline`: un texto que se
 * cuele en el HTML no se ejecuta aunque falle el escapado. `blob:` deja ver
 * la vista previa de una foto elegida antes de subirla.
 * @param {string} [supabaseUrl] Origen de Supabase Storage, si se usa.
 * @returns {string}
 */
export function adminCsp(supabaseUrl) {
  // Con Supabase Storage las fotos (públicas y firmadas) vienen de su origen.
  const fotos = supabaseUrl ? ` ${new URL(supabaseUrl).origin}` : "";
  return [
    "default-src 'self'",
    "script-src 'self' https://accounts.google.com/gsi/client",
    "style-src 'self' https://accounts.google.com/gsi/style",
    "frame-src https://accounts.google.com/gsi/",
    "connect-src 'self' https://accounts.google.com/gsi/",
    `img-src 'self' data: blob: https://*.googleusercontent.com${fotos}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join("; ");
}

/** CSP del panel con el entorno de este proceso. */
export const ADMIN_CSP = adminCsp(process.env.SUPABASE_URL);

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
    // Sin la carpeta (un despliegue que solo trae `server/`) el panel enseña
    // «sin foto» en vez de fallar al arrancar.
    if (existsSync(PHOTOS)) {
      panel.register(staticFiles, { root: PHOTOS, prefix: "/admin/fotos/", decorateReply: false });
    }
    // Sin la barra, las rutas relativas del HTML (admin.css, admin.js) se
    // resolverían contra la raíz del sitio.
    panel.get("/admin", (req, reply) => reply.redirect("/admin/"));
  });
}
