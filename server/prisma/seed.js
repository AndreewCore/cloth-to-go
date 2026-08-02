/**
 * Siembra el catálogo inicial en la base.
 *
 * Estas 10 prendas son las mismas que el frontend traía embebidas en
 * `js/data.js`; aquí la base pasa a ser la fuente de verdad. Las rutas de
 * `imgs` son relativas (img/products/N.webp) y las sirve el frontend: el
 * navegador las resuelve contra la página, no contra la API, así que siguen
 * siendo locales.
 *
 * `imgs` va serializado como JSON porque SQLite no guarda listas de escalares.
 * La API lo devuelve ya convertido a array (ver src/app.js): el formato del
 * almacén no debe llegar al cliente.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PRODUCTS = [
  { id: 1,  name: "Blazer de lino",    cat: "Formal",   value: 35, stars: 5, size: "M",  color: "negro",  material: "lino",      weightKg: 0.5, imgs: JSON.stringify(["img/products/1.webp", "img/products/1-2.webp", "img/products/1-3.webp"]),  desc: "Blazer de lino fresco, corte recto. Ideal para eventos formales y de oficina." },
  { id: 2,  name: "Vestido de gala",   cat: "Fiesta",   value: 45, stars: 4, size: "S",  color: "blanco", material: "sintetico", weightKg: 0.4, imgs: JSON.stringify(["img/products/2.webp", "img/products/2-2.webp", "img/products/2-3.webp"]),  desc: "Vestido largo de gala con caída elegante. Perfecto para bodas y galas." },
  { id: 3,  name: "Jeans vintage",     cat: "Casual",   value: 15, stars: 3, size: "M",  color: "azul",   material: "algodon",   weightKg: 0.8, imgs: JSON.stringify(["img/products/3.webp"]),  desc: "Jeans de tiro alto estilo retro. Cómodos para el día a día." },
  { id: 4,  name: "Abrigo de lana",    cat: "Invierno", value: 55, stars: 5, size: "L",  color: "beige",  material: "lana",      weightKg: 1.2, imgs: JSON.stringify(["img/products/4.webp"]),  desc: "Abrigo de lana cálido y de gran caída. Abriga sin perder estilo." },
  { id: 5,  name: "Camisa formal",     cat: "Formal",   value: 14, stars: 4, size: "M",  color: "blanco", material: "algodon",   weightKg: 0.2, imgs: JSON.stringify(["img/products/5.webp"]),  desc: "Camisa formal de algodón, fácil de combinar para reuniones." },
  { id: 6,  name: "Falda plisada",     cat: "Casual",   value: 12, stars: 3, size: "S",  color: "beige",  material: "sintetico", weightKg: 0.3, imgs: JSON.stringify(["img/products/6.webp"]),  desc: "Falda plisada midi, ligera y versátil para cualquier ocasión." },
  { id: 7,  name: "Esmoquin clásico",  cat: "Fiesta",   value: 150, stars: 5, size: "L",  color: "negro",  material: "lana",      weightKg: 1.0, imgs: JSON.stringify(["img/products/7.webp", "img/products/7-2.webp", "img/products/7-3.webp"]),  desc: "Esmoquin negro clásico con solapa satinada. La opción para eventos de etiqueta." },
  { id: 8,  name: "Chaqueta de cuero", cat: "Casual",   value: 45, stars: 2, size: "M",  color: "negro",  material: "cuero",     weightKg: 1.3, imgs: JSON.stringify(["img/products/8.webp"]),  desc: "Chaqueta de cuero con carácter; muestra desgaste natural que le da estilo." },
  { id: 9,  name: "Sudadera bordada",  cat: "Casual",   value: 12, stars: 4, size: "L",  color: "blanco", material: "algodon",   weightKg: 0.5, imgs: JSON.stringify(["img/products/9.webp"]),  desc: "Sudadera de algodón con bordado, súper cómoda para el día a día." },
  { id: 10, name: "Gabardina beige",   cat: "Invierno", value: 40, stars: 4, size: "XL", color: "beige",  material: "algodon",   weightKg: 0.9, imgs: JSON.stringify(["img/products/10.webp"]) , desc: "Gabardina beige atemporal, perfecta para días de lluvia y entretiempo." },
  { id: 11, name: "Traje de catrina",   cat: "Disfraces", value: 30, stars: 4, size: "M",  color: "beige",  material: "sintetico", weightKg: 0.6, imgs: JSON.stringify(["img/products/11.webp"]), desc: "Vestido y tocado de catrina, con bordado floral. Para Día de Muertos y fiestas de disfraces." },
  { id: 12, name: "Capa con capucha",   cat: "Disfraces", value: 18, stars: 5, size: "L",  color: "rojo",   material: "sintetico", weightKg: 0.3, imgs: JSON.stringify(["img/products/12.webp"]), desc: "Capa larga con capucha y cierre al cuello. Ligera y de talla generosa; sirve de caperucita, vampiro o cuento a elección." },
  { id: 13, name: "Vestido de época",   cat: "Disfraces", value: 48, stars: 4, size: "S",  color: "blanco", material: "algodon",   weightKg: 0.9, imgs: JSON.stringify(["img/products/13.webp"]), desc: "Vestido largo de inspiración victoriana, con botonadura en la espalda y encaje en puños y cuello." },
  { id: 14, name: "Botines de cuero",   cat: "Calzado",   value: 40, stars: 4, size: "39", color: "negro",  material: "cuero",     weightKg: 1.1, imgs: JSON.stringify(["img/products/14.webp"]), desc: "Botines de caña baja en cuero, con cordones y suela de goma. Combinan con todo." },
  { id: 15, name: "Tacones de fiesta",  cat: "Calzado",   value: 25, stars: 5, size: "37", color: "negro",  material: "sintetico", weightKg: 0.6, imgs: JSON.stringify(["img/products/15.webp"]), desc: "Tacón de aguja de 8 cm, punta fina. Cómodos para una noche entera de pie." },
  { id: 16, name: "Zapatos oxford",     cat: "Calzado",   value: 35, stars: 3, size: "42", color: "negro",  material: "cuero",     weightKg: 1.2, imgs: JSON.stringify(["img/products/16.webp"]), desc: "Oxford clásicos de cuero con acabado pulido. El complemento del traje formal." },
];

/** Vacía la tabla y reinserta el catálogo; idempotente entre corridas. */
async function main() {
  await prisma.product.deleteMany();
  for (const p of PRODUCTS) {
    await prisma.product.create({ data: p });
  }
  console.log(`Sembradas ${PRODUCTS.length} prendas.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
