/**
 * Da, cambia o quita capacidades del personal desde la consola:
 *
 *   pnpm staff:grant <correo|googleSub> <admin|trabajador|ninguna|CAP,CAP…>
 *
 * Es la forma de dar de alta al primer administrador ahora que ADMIN_SUBS no
 * existe. Necesita acceso a la base (DATABASE_URL), que es justo la frontera:
 * quien no puede tocar la base no puede ascender a nadie.
 */
import { PrismaClient } from "@prisma/client";
import { parseCapabilities, setCapabilities } from "../src/staff.js";

/** Lee los argumentos, aplica el cambio e informa. */
async function main() {
  const [who, spec] = process.argv.slice(2);
  if (!who || !spec) {
    console.error("Uso: pnpm staff:grant <correo|googleSub> <admin|trabajador|ninguna|CAP,CAP…>");
    process.exitCode = 2;
    return;
  }
  const db = new PrismaClient();
  try {
    const { user, before } = await setCapabilities(db, { who, capabilities: parseCapabilities(spec) });
    const nada = (l) => (l.length ? l.join(", ") : "ninguna");
    console.log(`${user.email}: ${nada(before)} → ${nada(user.capabilities)} (anotado en la bitácora financiera).`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
