/**
 * Alta, cambio y baja de capacidades del personal (§2.2).
 *
 * Sustituye a la variable ADMIN_SUBS: las capacidades viven en la base y se
 * cambian sin reiniciar. Hasta que exista el panel (fase 4) se usa desde la
 * consola con `pnpm staff:grant`; no hay ruta de la API que ascienda a nadie,
 * así que nadie puede darse permisos a sí mismo desde fuera.
 */
import { CAPABILITY, CAPABILITY_TEMPLATES } from "./auth.js";
import { FINANCE_EVENT, logFinance } from "./logs.js";

/**
 * Traduce lo que se escribe en la consola a una lista de capacidades.
 * @param {string} spec `admin`, `trabajador`, `ninguna` o una lista separada
 *   por comas (`MOSTRADOR,INVENTARIO`).
 * @returns {string[]} Capacidades, sin repetir.
 */
export function parseCapabilities(spec) {
  const s = String(spec ?? "").trim();
  if (s.toLowerCase() === "ninguna") return [];
  const plantilla = CAPABILITY_TEMPLATES[s.toLowerCase()];
  if (plantilla) return [...plantilla];
  const caps = s.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
  const malas = caps.filter((c) => !Object.values(CAPABILITY).includes(c));
  if (caps.length === 0 || malas.length) {
    throw new Error(
      `Capacidad desconocida: ${malas.join(", ") || "(vacía)"}. ` +
        `Usa admin, trabajador, ninguna o una lista de ${Object.values(CAPABILITY).join(", ")}.`,
    );
  }
  return [...new Set(caps)];
}

/**
 * Fija las capacidades de una persona y lo anota en la bitácora financiera.
 *
 * La persona tiene que haber entrado al menos una vez con Google (así existe
 * su fila). Una cuenta con pedidos es de cliente y no se convierte en
 * personal (§2.1): el personal usa una cuenta aparte.
 * @param {import("@prisma/client").PrismaClient} db Cliente Prisma.
 * @param {object} args Datos del cambio.
 * @param {string} args.who Correo o `googleSub` de la persona.
 * @param {string[]} args.capabilities Capacidades nuevas (vacía = baja).
 * @param {number|null} [args.actorId] Quién lo hace; null = la consola.
 * @returns {Promise<{user: object, before: string[]}>} Usuario actualizado y
 *   las capacidades que tenía.
 */
export async function setCapabilities(db, { who, capabilities, actorId = null }) {
  const clave = String(who ?? "").trim();
  if (!clave) throw new Error("Indica el correo o el googleSub de la persona.");

  return db.$transaction(async (tx) => {
    const candidatos = await tx.user.findMany({
      where: { OR: [{ googleSub: clave }, { email: { equals: clave, mode: "insensitive" } }] },
      include: { _count: { select: { orders: true } } },
    });
    if (candidatos.length === 0) {
      throw new Error(`No hay ninguna cuenta para "${clave}". Tiene que entrar una vez con Google antes.`);
    }
    if (candidatos.length > 1) {
      throw new Error(`"${clave}" corresponde a varias cuentas; usa su googleSub.`);
    }
    const [user] = candidatos;
    if (capabilities.length > 0 && user._count.orders > 0) {
      throw new Error(
        `${user.email} tiene pedidos como cliente: un cliente no puede ser trabajador. ` +
          "Usa una cuenta aparte para el personal.",
      );
    }

    const before = user.capabilities;
    const actualizado = await tx.user.update({ where: { id: user.id }, data: { capabilities } });
    const nada = (l) => (l.length ? l.join(", ") : "ninguna");
    await logFinance(tx, {
      kind: FINANCE_EVENT.CAPACIDADES,
      actorId,
      subjectUserId: user.id,
      note: `Capacidades de ${user.email}: ${nada(before)} → ${nada(capabilities)}`,
    });
    return { user: actualizado, before };
  });
}
