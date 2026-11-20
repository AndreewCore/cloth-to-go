/**
 * Sesiones propias del servidor.
 *
 * El ID token de Google caduca en una hora y el SDK no siempre lo renueva en
 * silencio: un checkout a medias no puede depender de eso. Al iniciar sesión
 * (`POST /api/auth/google`, con el ID token verificado) el servidor entrega un
 * token opaco de 32 bytes aleatorios que dura 30 días y se revoca al cerrar
 * sesión. En la base se guarda **solo su SHA-256**: quien lea la tabla no puede
 * presentarse como nadie.
 *
 * Por qué un token en la cabecera y no una cookie: el navegador no adjunta
 * `Authorization` por su cuenta, así que un formulario hostil en otro sitio no
 * puede hacer una petición autenticada (CSRF), y la API sirve a varios orígenes
 * (la app en Pages, la web, el panel) sin pelearse con SameSite.
 */
import { createHash, randomBytes } from "node:crypto";
import prisma from "./db.js";

/** Vida de una sesión: lo bastante larga para no pedir login cada semana. */
export const SESSION_DAYS = 30;

/**
 * SHA-256 en hexadecimal: lo único del token que llega a la base.
 * @param {string} token Token en claro.
 * @returns {string}
 */
export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Abre una sesión para el usuario.
 * @param {number} userId Id en `users`.
 * @param {Date} [now=new Date()] Instante de referencia (pruebas).
 * @returns {Promise<{token: string, expiresAt: Date}>} El token en claro sale
 *   de aquí y nunca más vuelve a existir en el servidor.
 */
export async function createSession(userId, now = new Date()) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86400000);
  await prisma.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt } });
  return { token, expiresAt };
}

/**
 * Usuario dueño de una sesión viva (ni caducada ni revocada), o null.
 * @param {string} token Token en claro, tal como llegó en la cabecera.
 * @returns {Promise<object|null>} Fila de `users`, con sus capacidades al día.
 */
export async function userForSession(token) {
  const s = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!s || s.revokedAt || s.expiresAt <= new Date()) return null;
  return s.user;
}

/**
 * Cierra una sesión. Idempotente: revocar dos veces no es un error.
 * @param {string} token Token en claro.
 * @returns {Promise<boolean>} true si había una sesión viva que cerrar.
 */
export async function revokeSession(token) {
  const { count } = await prisma.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count > 0;
}
