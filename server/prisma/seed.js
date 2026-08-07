/**
 * Siembra el catálogo inicial en la base.
 *
 * Estas prendas son las mismas que el frontend trae embebidas en `js/data.js`;
 * aquí la base pasa a ser la fuente de verdad. Las rutas de `imgs` son
 * relativas (img/products/N.webp) y las sirve el frontend: el navegador las
 * resuelve contra la página, no contra la API, así que siguen siendo locales.
 *
 * `imgs` es una lista de verdad en la base (Postgres). Con SQLite iba
 * serializado como JSON y la API tenía que deshacerlo en cada respuesta.
 *
 * **No borra nada.** La versión anterior empezaba con `deleteMany()`, y eso
 * hacía que la semilla dejara de funcionar en cuanto existía un pedido: un
 * `OrderItem` o un `Charge` apuntando a una prenda impiden borrarla. La guía de
 * despliegue manda ejecutar esto en producción, así que el fallo llegaba justo
 * donde más caro es. Y si la clave foránea no lo hubiera impedido, habría sido
 * peor: `Charge.productId` es opcional, así que borrar una prenda dejaría
 * cargos sin prenda — un importe que ya nadie puede explicar, que es
 * exactamente lo que el libro de cargos existe para evitar.
 */
import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";

export const PRODUCTS = [
  { id: 1,  name: "Blazer de lino",    cat: "Formal",   value: 35, stars: 5, size: "M",  color: "negro",  material: "lino",      weightKg: 0.5, imgs: ["img/products/1.webp", "img/products/1-2.webp", "img/products/1-3.webp"],  desc: "Blazer de lino fresco, corte recto. Ideal para eventos formales y de oficina." },
  { id: 2,  name: "Vestido de gala",   cat: "Fiesta",   value: 45, stars: 4, size: "S",  color: "blanco", material: "sintetico", weightKg: 0.4, imgs: ["img/products/2.webp", "img/products/2-2.webp", "img/products/2-3.webp"],  desc: "Vestido largo de gala con caída elegante. Perfecto para bodas y galas." },
  { id: 3,  name: "Jeans vintage",     cat: "Casual",   value: 15, stars: 3, size: "M",  color: "azul",   material: "algodon",   weightKg: 0.8, imgs: ["img/products/3.webp"],  desc: "Jeans de tiro alto estilo retro. Cómodos para el día a día." },
  { id: 4,  name: "Abrigo de lana",    cat: "Invierno", value: 55, stars: 5, size: "L",  color: "beige",  material: "lana",      weightKg: 1.2, imgs: ["img/products/4.webp"],  desc: "Abrigo de lana cálido y de gran caída. Abriga sin perder estilo." },
  { id: 5,  name: "Camisa formal",     cat: "Formal",   value: 14, stars: 4, size: "M",  color: "blanco", material: "algodon",   weightKg: 0.2, imgs: ["img/products/5.webp"],  desc: "Camisa formal de algodón, fácil de combinar para reuniones." },
  { id: 6,  name: "Falda plisada",     cat: "Casual",   value: 12, stars: 3, size: "S",  color: "beige",  material: "sintetico", weightKg: 0.3, imgs: ["img/products/6.webp"],  desc: "Falda plisada midi, ligera y versátil para cualquier ocasión." },
  { id: 7,  name: "Esmoquin clásico",  cat: "Fiesta",   value: 150, stars: 5, size: "L",  color: "negro",  material: "lana",      weightKg: 1.0, imgs: ["img/products/7.webp", "img/products/7-2.webp", "img/products/7-3.webp"],  desc: "Esmoquin negro clásico con solapa satinada. La opción para eventos de etiqueta." },
  { id: 8,  name: "Chaqueta de cuero", cat: "Casual",   value: 45, stars: 2, size: "M",  color: "negro",  material: "cuero",     weightKg: 1.3, imgs: ["img/products/8.webp"],  desc: "Chaqueta de cuero con carácter; muestra desgaste natural que le da estilo." },
  { id: 9,  name: "Sudadera bordada",  cat: "Casual",   value: 12, stars: 4, size: "L",  color: "blanco", material: "algodon",   weightKg: 0.5, imgs: ["img/products/9.webp"],  desc: "Sudadera de algodón con bordado, súper cómoda para el día a día." },
  { id: 10, name: "Gabardina beige",   cat: "Invierno", value: 40, stars: 4, size: "XL", color: "beige",  material: "algodon",   weightKg: 0.9, imgs: ["img/products/10.webp"] , desc: "Gabardina beige atemporal, perfecta para días de lluvia y entretiempo." },
  { id: 11, name: "Traje de catrina",   cat: "Disfraces", value: 30, stars: 4, size: "M",  color: "beige",  material: "sintetico", weightKg: 0.6, imgs: ["img/products/11.webp"], desc: "Vestido y tocado de catrina, con bordado floral. Para Día de Muertos y fiestas de disfraces." },
  { id: 12, name: "Capa con capucha",   cat: "Disfraces", value: 18, stars: 5, size: "L",  color: "rojo",   material: "sintetico", weightKg: 0.3, imgs: ["img/products/12.webp"], desc: "Capa larga con capucha y cierre al cuello. Ligera y de talla generosa; sirve de caperucita, vampiro o cuento a elección." },
  { id: 13, name: "Vestido de época",   cat: "Disfraces", value: 48, stars: 4, size: "S",  color: "blanco", material: "algodon",   weightKg: 0.9, imgs: ["img/products/13.webp"], desc: "Vestido largo de inspiración victoriana, con botonadura en la espalda y encaje en puños y cuello." },
  { id: 14, name: "Botines de cuero",   cat: "Calzado",   value: 40, stars: 4, size: "39", color: "negro",  material: "cuero",     weightKg: 1.1, imgs: ["img/products/14.webp"], desc: "Botines de caña baja en cuero, con cordones y suela de goma. Combinan con todo." },
  { id: 15, name: "Tacones de fiesta",  cat: "Calzado",   value: 25, stars: 5, size: "37", color: "negro",  material: "sintetico", weightKg: 0.6, imgs: ["img/products/15.webp"], desc: "Tacón de aguja de 8 cm, punta fina. Cómodos para una noche entera de pie." },
  { id: 16, name: "Zapatos oxford",     cat: "Calzado",   value: 35, stars: 3, size: "42", color: "negro",  material: "cuero",     weightKg: 1.2, imgs: ["img/products/16.webp"], desc: "Oxford clásicos de cuero con acabado pulido. El complemento del traje formal." },
];

/**
 * Inserta las prendas que falten y actualiza las que ya estén, sin borrar.
 *
 * Se puede correr tantas veces como haga falta y sobre una base con pedidos
 * vivos. Recibe el cliente en vez de crearlo para que las pruebas usen el mismo
 * de `src/db.js` y no abran una segunda conexión.
 * @param {import("@prisma/client").PrismaClient} db Cliente de Prisma.
 * @returns {Promise<{creadas: number, actualizadas: number, sobrantes: {id: number, name: string}[]}>}
 *   Recuento de la corrida y prendas de la base que ya no están en la lista.
 */
export async function seedCatalog(db) {
  let creadas = 0;
  let actualizadas = 0;

  for (const p of PRODUCTS) {
    // `id` es fijo en el catálogo (no autoincremental), así que sirve de clave
    // natural para el upsert: la misma prenda conserva su id entre corridas y
    // los pedidos que la referencian siguen apuntando a donde apuntaban.
    const { id, ...campos } = p;
    const previa = await db.product.findUnique({ where: { id }, select: { id: true } });
    await db.product.upsert({ where: { id }, create: p, update: campos });
    if (previa) actualizadas++;
    else creadas++;
  }

  // Las prendas que ya no figuran en la lista NO se borran: pueden tener
  // pedidos e historial contable colgando. Retirar una prenda del catálogo es
  // un cambio de estado del ejemplar, no un DELETE, y eso llega con la
  // separación modelo/ejemplar. Aquí solo se avisa de que están.
  const sobrantes = await db.product.findMany({
    where: { id: { notIn: PRODUCTS.map((p) => p.id) } },
    select: { id: true, name: true },
    orderBy: { id: "asc" },
  });

  return { creadas, actualizadas, sobrantes };
}

/** Punto de entrada de `pnpm db:seed`: siembra e informa de lo que hizo. */
async function main() {
  const db = new PrismaClient();
  try {
    const { creadas, actualizadas, sobrantes } = await seedCatalog(db);
    console.log(`Catálogo sembrado: ${creadas} creadas, ${actualizadas} actualizadas.`);
    if (sobrantes.length > 0) {
      console.warn(
        `Aviso: ${sobrantes.length} prenda(s) en la base fuera de la lista de la semilla ` +
          "(no se tocan; pueden tener pedidos asociados):",
      );
      for (const s of sobrantes) console.warn(`  · ${s.id} — ${s.name}`);
    }
  } finally {
    await db.$disconnect();
  }
}

// Solo siembra cuando se ejecuta el archivo; importarlo (las pruebas, el
// guardarraíl del catálogo) no debe tocar la base ni abrir una conexión.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
