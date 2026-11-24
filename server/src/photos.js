/**
 * Tubería de subida de fotos (plan, «Seguridad»): todo archivo que entra se
 * trata como hostil.
 *
 * 1. `@fastify/multipart` corta por tamaño y por cantidad antes de leer de más.
 * 2. El tipo se decide por los **bytes mágicos**: la extensión y el
 *    `Content-Type` los escribe quien sube, así que no cuentan.
 * 3. `sharp` la **recodifica a WebP**: lo que se guarda es una imagen nueva,
 *    sin EXIF (GPS incluido) y sin restos de un archivo políglota. Antes de
 *    decodificar se limita el número de píxeles, contra las «bombas de
 *    descompresión» (un PNG pequeño que se expande a gigas).
 * 4. El nombre es un UUID (`storage.newKey()`); el original nunca se usa.
 */
import sharp from "sharp";
import { httpError } from "./auth.js";

/** Límites de las fotos (decisiones transversales: JPG/PNG, 5 MB, 6 por prenda). */
export const PHOTO_LIMITS = Object.freeze({
  maxBytes: 5 * 1024 * 1024,
  maxFiles: 6,
  /** 40 MP: sobra para cualquier móvil y corta las bombas de descompresión. */
  maxPixels: 40_000_000,
  /** Lado mayor tras recodificar: suficiente para ver costuras y manchas. */
  maxSide: 1600,
  quality: 80,
});

/** Opciones de `@fastify/multipart` que imponen los límites antes de leer. */
export const MULTIPART_LIMITS = Object.freeze({
  fileSize: PHOTO_LIMITS.maxBytes,
  files: PHOTO_LIMITS.maxFiles,
  fields: 10,
  fieldSize: 1024,
  parts: PHOTO_LIMITS.maxFiles + 10,
});

/**
 * Tipo real de una imagen por sus primeros bytes.
 * @param {Buffer} buf Archivo subido.
 * @returns {"jpeg"|"png"|null} null si no es JPG ni PNG.
 */
export function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  return null;
}

/**
 * Recodifica una foto a WebP limpio. `rotate()` sin argumentos aplica la
 * orientación EXIF antes de que se pierda: sin él, las fotos del móvil
 * saldrían de lado.
 * @param {Buffer} buf JPG o PNG ya comprobado.
 * @returns {Promise<Buffer>} WebP sin metadatos.
 */
export async function toWebp(buf) {
  try {
    return await sharp(buf, { limitInputPixels: PHOTO_LIMITS.maxPixels, failOn: "error" })
      .rotate()
      .resize({ width: PHOTO_LIMITS.maxSide, height: PHOTO_LIMITS.maxSide, fit: "inside", withoutEnlargement: true })
      .webp({ quality: PHOTO_LIMITS.quality })
      .toBuffer();
  } catch (err) {
    // El mensaje de libvips no le sirve a quien sube; el tipo de fallo, sí.
    if (/pixel limit/i.test(err.message)) throw httpError(400, "La foto es demasiado grande (más de 40 megapíxeles).");
    throw httpError(400, "La foto está dañada o no se puede leer.");
  }
}

/**
 * Lee una petición multipart: los campos de texto y las fotos ya validadas y
 * recodificadas. Si una sola falla, no se guarda ninguna (aún no se escribió
 * nada en el almacenamiento).
 * @param {import("fastify").FastifyRequest} req Petición `multipart/form-data`.
 * @returns {Promise<{fields: Record<string, string>, photos: Buffer[]}>}
 */
export async function readPhotoUpload(req) {
  if (!req.isMultipart()) throw httpError(415, "Envía las fotos como multipart/form-data.");
  const fields = {};
  const crudas = [];
  try {
    for await (const part of req.parts()) {
      if (part.type === "file") {
        const buf = await part.toBuffer();
        if (buf.length) crudas.push(buf);
      } else {
        fields[part.fieldname] = String(part.value ?? "");
      }
    }
  } catch (err) {
    if (err.code === "FST_REQ_FILE_TOO_LARGE") throw httpError(413, "Cada foto puede pesar 5 MB como máximo.");
    if (err.code === "FST_FILES_LIMIT") throw httpError(413, `Como máximo ${PHOTO_LIMITS.maxFiles} fotos por subida.`);
    if (err.code?.startsWith?.("FST_")) throw httpError(400, "La subida no es válida.");
    throw err;
  }
  if (!crudas.length) throw httpError(400, "No llegó ninguna foto.");
  for (const buf of crudas) {
    if (!sniffImage(buf)) throw httpError(415, "Solo se aceptan fotos JPG o PNG.");
  }
  const photos = [];
  // Una a una y no en paralelo: seis decodificaciones grandes a la vez son
  // un pico de memoria que el plan gratuito de Render no aguanta.
  for (const buf of crudas) photos.push(await toWebp(buf));
  return { fields, photos };
}

/**
 * Límite de subidas por persona en memoria, con ventana deslizante de un
 * minuto. Las rutas de subida son del personal, pero una cuenta robada no
 * debe poder llenar el almacenamiento en un bucle.
 * @param {{perMinute: number, now?: () => number}} cfg
 * @returns {(userId: number) => boolean} true si la subida puede pasar.
 */
export function createUploadLimiter({ perMinute, now = Date.now }) {
  const hits = new Map();
  return (userId) => {
    const t = now();
    const recientes = (hits.get(userId) ?? []).filter((ts) => t - ts < 60_000);
    if (recientes.length >= perMinute) {
      hits.set(userId, recientes);
      return false;
    }
    recientes.push(t);
    hits.set(userId, recientes);
    return true;
  };
}
