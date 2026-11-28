/**
 * Correo saliente (fase 4, Avisos) por la API REST de Resend, sin SDK.
 *
 * Va **apagado** mientras falten `RESEND_API_KEY` y `MAIL_FROM`: Resend solo
 * escribe a cualquier destinatario desde un dominio verificado, y el dominio
 * aún no está comprado. Apagado no es un error: el aviso se guarda y se ve en
 * la app y la web igual, solo que sin correo.
 */

const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

/** Mailer que no envía nada: el de desarrollo y el de un despliegue sin dominio. */
export const disabledMailer = Object.freeze({ enabled: false, async send() { return false; } });

/**
 * Crea un mailer contra Resend.
 * @param {object} opts
 * @param {string} opts.apiKey Clave de la API de Resend.
 * @param {string} opts.from Remitente verificado, p. ej. `CLOTH TO GO <avisos@dominio.com>`.
 * @param {typeof fetch} [opts.fetchImpl] Para las pruebas.
 * @returns {{enabled: true, send: (msg: {to: string, subject: string, text: string}) => Promise<boolean>}}
 */
export function createResendMailer({ apiKey, from, fetchImpl = fetch }) {
  return {
    enabled: true,
    async send({ to, subject, text }) {
      const res = await fetchImpl(RESEND_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        // Solo texto: el cuerpo lo redacta el servidor y así no hay HTML que escapar.
        body: JSON.stringify({ from, to: [to], subject, text }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // El detalle de Resend puede citar el destinatario: se informa solo el código.
      if (!res.ok) throw new Error(`Resend respondió ${res.status}`);
      return true;
    },
  };
}

/**
 * El mailer que toca según el entorno.
 * @returns {object} Resend si hay clave y remitente; si no, el apagado.
 */
export function mailerFromEnv() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.MAIL_FROM?.trim();
  return apiKey && from ? createResendMailer({ apiKey, from }) : disabledMailer;
}
