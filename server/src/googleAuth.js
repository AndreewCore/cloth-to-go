/**
 * Verificación de ID tokens de Google Identity Services.
 *
 * Se aísla en su propio módulo (en vez de inline en app.js) para poder
 * inyectar un verificador falso en los tests: llamar a Google en cada test
 * sería red real, lento y no determinista, y no hay forma de obtener un ID
 * token válido fuera del navegador.
 */
import { OAuth2Client } from "google-auth-library";

/**
 * Crea el verificador real contra los servidores de Google para un Client ID
 * dado. `audience` debe coincidir con el Client ID que usa el frontend
 * (js/auth.js): si no coincide, `verifyIdToken` rechaza el token aunque la
 * firma sea válida — es la comprobación que evita aceptar tokens emitidos
 * para otra app.
 * @param {string} clientId Google OAuth Client ID (GOOGLE_CLIENT_ID).
 * @returns {(idToken: string) => Promise<import("google-auth-library").TokenPayload>}
 */
export function createGoogleVerifier(clientId) {
  const client = new OAuth2Client(clientId);
  return async function verifyGoogleToken(idToken) {
    const ticket = await client.verifyIdToken({ idToken, audience: clientId });
    return ticket.getPayload();
  };
}
