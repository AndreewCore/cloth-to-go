/**
 * Almacenamiento de fotos (fase 4). Dos cubos, como dice el plan: uno
 * **público** para el catálogo (lo ve cualquiera, con URL estable) y uno
 * **privado** para las fotos de estado de cada ejemplar (evidencia interna,
 * solo con enlaces firmados de corta duración).
 *
 * Dos conductores con la misma interfaz:
 * - **disco**: en local y en las pruebas, bajo `MEDIA_DIR` (por defecto
 *   `server/uploads/`, ignorado por git). La API misma sirve los archivos.
 * - **Supabase Storage**: en producción, cuando hay `SUPABASE_URL` y
 *   `SUPABASE_SERVICE_KEY`. Se habla con su API REST con `fetch`; no hace
 *   falta el SDK para subir, borrar y firmar.
 *
 * Las claves (`catalogo/<uuid>.webp`, `ejemplares/<uuid>.webp`) son lo único
 * que se guarda en la base: así cambiar de conductor no rompe ninguna fila.
 */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** Cubos lógicos. */
export const BUCKET = Object.freeze({ PUBLIC: "public", PRIVATE: "private" });

/** Carpeta de cada cubo dentro de la clave. */
const PREFIX = { [BUCKET.PUBLIC]: "catalogo", [BUCKET.PRIVATE]: "ejemplares" };

/** Clave válida: prefijo conocido + UUID + `.webp`. Nada que el usuario escriba. */
const KEY_RE = /^(catalogo|ejemplares)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

/** Duración de un enlace firmado a una foto privada, en segundos. */
export const SIGNED_TTL = 10 * 60;

/**
 * Crea una clave nueva para un cubo. El nombre original del archivo nunca se
 * usa: podría traer rutas, caracteres raros o datos personales.
 * @param {string} bucket `BUCKET.PUBLIC` o `BUCKET.PRIVATE`.
 * @returns {string}
 */
export function newKey(bucket) {
  return `${PREFIX[bucket]}/${randomUUID()}.webp`;
}

/** Indica si un texto es una clave del almacenamiento (y no una ruta antigua). */
export const isStorageKey = (k) => typeof k === "string" && KEY_RE.test(k);

/** Cubo al que pertenece una clave. */
const bucketOf = (key) => (key.startsWith(`${PREFIX[BUCKET.PUBLIC]}/`) ? BUCKET.PUBLIC : BUCKET.PRIVATE);

/**
 * Conductor de disco.
 * @param {object} opts
 * @param {string} opts.dir Carpeta raíz.
 * @param {string} [opts.secret] Secreto de las firmas; uno aleatorio por
 *   proceso si falta, que solo invalida los enlaces vivos al reiniciar.
 * @returns {object} Almacenamiento.
 */
export function createDiskStorage({ dir, secret = randomBytes(32).toString("hex") }) {
  const ruta = (key) => {
    if (!isStorageKey(key)) throw new Error(`Clave de almacenamiento no válida: ${key}`);
    return path.join(dir, key);
  };
  const firma = (key, exp) => createHmac("sha256", secret).update(`${key}:${exp}`).digest("base64url");

  return {
    driver: "disk",
    async put(key, body) {
      await mkdir(path.dirname(ruta(key)), { recursive: true });
      // `wx`: una clave es un UUID nuevo; si ya existe, algo va muy mal y no
      // se pisa la foto anterior.
      await writeFile(ruta(key), body, { flag: "wx" });
    },
    async remove(key) {
      await unlink(ruta(key)).catch((err) => { if (err.code !== "ENOENT") throw err; });
    },
    /** Bytes de una foto, o null si no está. Solo existe en este conductor. */
    async read(key) {
      return readFile(ruta(key)).catch((err) => { if (err.code === "ENOENT") return null; throw err; });
    },
    publicUrl(key, origin) {
      return `${origin}/media/${key}`;
    },
    async signedUrl(key, origin, ttl = SIGNED_TTL, now = Date.now()) {
      const exp = Math.floor(now / 1000) + ttl;
      return `${origin}/media/${key}?exp=${exp}&sig=${firma(key, exp)}`;
    },
    /**
     * Comprueba un enlace firmado. Compara en tiempo constante para no dar
     * pistas de la firma correcta por lo que tarda en rechazar.
     */
    verify(key, exp, sig, now = Date.now()) {
      const n = Number(exp);
      if (!isStorageKey(key) || !Number.isInteger(n) || n < Math.floor(now / 1000)) return false;
      const esperado = Buffer.from(firma(key, n));
      const dado = Buffer.from(String(sig ?? ""));
      return esperado.length === dado.length && timingSafeEqual(esperado, dado);
    },
  };
}

/**
 * Conductor de Supabase Storage (REST).
 * @param {object} opts
 * @param {string} opts.url `SUPABASE_URL`, p. ej. `https://xyz.supabase.co`.
 * @param {string} opts.serviceKey Clave de servicio: solo vive en el servidor.
 * @param {{public: string, private: string}} opts.buckets Nombres de los cubos.
 * @param {typeof fetch} [opts.fetchImpl] Para las pruebas.
 * @returns {object} Almacenamiento.
 */
export function createSupabaseStorage({ url, serviceKey, buckets, fetchImpl = fetch }) {
  const base = `${url.replace(/\/+$/, "")}/storage/v1`;
  const headers = { authorization: `Bearer ${serviceKey}`, apikey: serviceKey };
  const cubo = (key) => {
    if (!isStorageKey(key)) throw new Error(`Clave de almacenamiento no válida: ${key}`);
    return bucketOf(key) === BUCKET.PUBLIC ? buckets.public : buckets.private;
  };
  /** Lanza con el estado y el cuerpo de Supabase para que quede en el log. */
  const ok = async (res, what) => {
    if (res.ok) return res;
    throw new Error(`Supabase Storage (${what}): ${res.status} ${await res.text().catch(() => "")}`);
  };

  return {
    driver: "supabase",
    async put(key, body) {
      await ok(await fetchImpl(`${base}/object/${cubo(key)}/${key}`, {
        method: "POST",
        headers: { ...headers, "content-type": "image/webp", "cache-control": "31536000", "x-upsert": "false" },
        body,
      }), "subir");
    },
    async remove(key) {
      await ok(await fetchImpl(`${base}/object/${cubo(key)}`, {
        method: "DELETE",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ prefixes: [key] }),
      }), "borrar");
    },
    publicUrl(key) {
      return `${base}/object/public/${cubo(key)}/${key}`;
    },
    async signedUrl(key, _origin, ttl = SIGNED_TTL) {
      const res = await ok(await fetchImpl(`${base}/object/sign/${cubo(key)}/${key}`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ expiresIn: ttl }),
      }), "firmar");
      const { signedURL } = await res.json();
      return `${base}${signedURL}`;
    },
  };
}

/**
 * Elige el conductor según el entorno. Sin Supabase configurado se usa el
 * disco, también en producción: allí avisa, porque el disco de Render se
 * pierde en cada despliegue.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{warn: Function}} [log]
 * @returns {object} Almacenamiento.
 */
export function storageFromEnv(env = process.env, log = console) {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
    return createSupabaseStorage({
      url: env.SUPABASE_URL,
      serviceKey: env.SUPABASE_SERVICE_KEY,
      buckets: {
        public: env.SUPABASE_BUCKET_PUBLIC || "catalogo",
        private: env.SUPABASE_BUCKET_PRIVATE || "ejemplares-privado",
      },
    });
  }
  if (env.NODE_ENV === "production") {
    log.warn("Fotos en disco local: sin SUPABASE_URL/SUPABASE_SERVICE_KEY se pierden en cada despliegue.");
  }
  const dir = env.MEDIA_DIR || fileURLToPath(new URL("../uploads/", import.meta.url));
  return createDiskStorage({ dir, secret: env.MEDIA_SIGNING_SECRET || undefined });
}

/**
 * URL con la que el cliente ve una foto del catálogo. Las rutas antiguas
 * (`img/products/…`, relativas al sitio) se dejan como están: la app y la web
 * ya saben resolverlas.
 * @param {object} storage Almacenamiento.
 * @param {string} img Clave o ruta guardada en `products.imgs`.
 * @param {string} origin Origen de la API vista por quien pregunta.
 * @returns {string}
 */
export function catalogPhotoUrl(storage, img, origin) {
  return isStorageKey(img) ? storage.publicUrl(img, origin) : img;
}

/**
 * Origen de la API tal como lo ve quien hizo la petición (protocolo y host).
 * Con `trustProxy` en Render, el protocolo es el https del proxy.
 * @param {import("fastify").FastifyRequest} req
 * @returns {string}
 */
export const requestOrigin = (req) => `${req.protocol}://${req.host}`;
