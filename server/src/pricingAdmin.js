/**
 * Precio desde el panel (fase 4): ver de dónde sale el precio de un modelo,
 * ajustarlo a mano y dejar constancia de quién lo cambió.
 *
 * El ajuste sustituye solo el **primer día**; la escalera, el descuento por
 * volumen y el suelo de `rentalFloor()` siguen igual, así que ni un ajuste
 * bajo se cobra a pérdida. Nunca puede bajar de `cycleCost()`.
 *
 * Todo cambio queda en la bitácora financiera (`PRECIO`, con `productId`):
 * es dinero de cada alquiler futuro y alguien tiene que poder explicarlo.
 */
import prisma from "./db.js";
import { CAPABILITY, httpError } from "./auth.js";
import { LADDER_DAYS, pricedItem, routeId } from "./catalog.js";
import { FINANCE_EVENT, logFinance } from "./logs.js";
import { cycleCost, depositFor, rentalFloor, rentalListPrice, rentalPrice, validatePriceOverride } from "./pricing.js";

/** Redondea a centavos para enseñar, sin arrastrar decimales de coma flotante. */
const usd = (x) => Math.round(x * 100) / 100;

/**
 * Lee un ajuste del cuerpo o de la consulta. `undefined` = no se toca; `null`
 * o `""` = volver a la fórmula.
 */
function parseOverride(v) {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : NaN;
}

/** Valida la garantía fija: dólares enteros y positivos, o null. */
function depositError(d) {
  if (d === null) return null;
  return Number.isInteger(d) && d > 0 && d <= 500 ? null : "La garantía fija va en dólares enteros, de 1 a 500.";
}

/**
 * Todo lo que explica el precio de un modelo: la fórmula, el ajuste, el coste
 * y el suelo, y la escalera y la garantía que resultan. Usa las mismas
 * funciones que cobran, así la vista previa es exactamente lo que se cobrará.
 * @param {object} modelo Modelo con `materialRef`.
 * @param {{priceOverride?: number|null, depositOverride?: number|null}} [cambios] Vista previa.
 * @returns {object}
 */
export function pricingView(modelo, cambios = {}) {
  const base = pricedItem({ id: null, product: modelo });
  const p = {
    ...base,
    ...(cambios.priceOverride !== undefined ? { priceOverride: cambios.priceOverride } : {}),
    ...(cambios.depositOverride !== undefined ? { depositOverride: cambios.depositOverride } : {}),
  };
  const formula = { ...p, priceOverride: null, depositOverride: null };
  return {
    pricing: modelo.pricing,
    value: modelo.value,
    stars: modelo.stars,
    laundry: usd(p.laundryCost),
    formulaDay1: usd(rentalListPrice(formula, 1)),
    priceOverride: p.priceOverride ?? null,
    cycleCost: usd(cycleCost(p)),
    floor: usd(rentalFloor(p)),
    ladder: Array.from({ length: LADDER_DAYS }, (_, i) => rentalPrice(p, i + 1, 1)),
    depositFormula: depositFor(formula),
    depositOverride: p.depositOverride ?? null,
    deposit: depositFor(p),
  };
}

/** "$3.00" o "fórmula ($2.40)" para la nota de la bitácora. */
const describe = (override, formula, entero = false) =>
  (override == null ? `fórmula ($${entero ? formula : formula.toFixed(2)})` : `$${entero ? override : override.toFixed(2)}`);

/** Carga un modelo con lo que necesita el cálculo, o 404. */
async function loadModel(db, id) {
  const modelo = await db.product.findUnique({ where: { id }, include: { materialRef: true } });
  if (!modelo) throw httpError(404, "Modelo no encontrado.");
  return modelo;
}

/**
 * Anota en la bitácora un cambio de valor o estrellas hecho desde la edición
 * del modelo: también mueve el precio y la garantía.
 * @param {object} tx Transacción.
 * @param {object} antes Modelo antes del cambio.
 * @param {object} data Campos cambiados.
 * @param {number} actorId Quién.
 */
export async function logValueChange(tx, antes, data, actorId) {
  const partes = [];
  if ("value" in data && data.value !== antes.value) partes.push(`Valor de reposición: $${antes.value} → $${data.value}`);
  if ("stars" in data && data.stars !== antes.stars) partes.push(`Estrellas: ${antes.stars} → ${data.stars}`);
  if (!partes.length) return;
  await logFinance(tx, { kind: FINANCE_EVENT.PRECIO, actorId, productId: antes.id, note: `${antes.name} · ${partes.join(" · ")}` });
}

/**
 * Registra las rutas de precio.
 * @param {import("fastify").FastifyInstance} app Instancia Fastify.
 * @param {{requireCapability: Function}} guards preHandlers de autorización.
 */
export function registerPricingAdminRoutes(app, { requireCapability }) {
  // Precio de un modelo y su historial. Con `?priceOverride=…&depositOverride=…`
  // es una vista previa: calcula con esos valores sin guardar nada. Lo ve
  // Inventario (es quien da de alta); ajustar es de Administración.
  app.get("/api/products/:id/pricing", { preHandler: requireCapability(CAPABILITY.INVENTARIO) }, async (req) => {
    const id = routeId(req.params.id, "Modelo");
    const modelo = await loadModel(prisma, id);
    const cambios = {
      priceOverride: parseOverride(req.query?.priceOverride),
      depositOverride: parseOverride(req.query?.depositOverride),
    };
    if (Number.isNaN(cambios.priceOverride) || Number.isNaN(cambios.depositOverride)) throw httpError(400, "Los importes van como números.");
    const errPrecio = cambios.priceOverride === undefined ? null : validatePriceOverride(pricedItem({ id: null, product: modelo }), cambios.priceOverride);
    const errGarantia = cambios.depositOverride === undefined ? null : depositError(cambios.depositOverride);
    const historial = await prisma.financeLog.findMany({
      where: { productId: id, kind: FINANCE_EVENT.PRECIO },
      orderBy: { id: "desc" },
      take: 50,
      include: { actor: { select: { name: true } } },
    });
    return {
      ...pricingView(modelo, errPrecio || errGarantia ? {} : cambios),
      error: errPrecio ?? errGarantia ?? null,
      history: historial.map((h) => ({ at: h.createdAt, by: h.actor?.name ?? "sistema", note: h.note })),
    };
  });

  // Ajuste manual del primer día y garantía fija, con su registro.
  app.patch("/api/products/:id/pricing", { preHandler: requireCapability(CAPABILITY.ADMINISTRACION) }, async (req) => {
    const id = routeId(req.params.id, "Modelo");
    const body = req.body ?? {};
    const motivo = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 300) : null;

    return prisma.$transaction(async (tx) => {
      const modelo = await loadModel(tx, id);
      if (modelo.pricing !== "CTG") {
        // Un local fija sus propias tarifas: CTG no le ajusta nada (§9).
        throw httpError(409, "Este modelo usa la tarifa de su socio.");
      }
      const data = {};
      if ("priceOverride" in body) {
        const v = parseOverride(body.priceOverride);
        const err = Number.isNaN(v) ? "El precio ajustado debe ser un importe positivo." : validatePriceOverride(pricedItem({ id: null, product: modelo }), v);
        if (err) throw httpError(400, err);
        if (v !== modelo.priceOverride) data.priceOverride = v;
      }
      if ("depositOverride" in body) {
        const d = parseOverride(body.depositOverride);
        const err = Number.isNaN(d) ? "La garantía fija va en dólares enteros." : depositError(d);
        if (err) throw httpError(400, err);
        if (d !== modelo.depositOverride) data.depositOverride = d;
      }
      if (Object.keys(data).length === 0) throw httpError(400, "No hay nada que ajustar.");

      const antes = pricingView(modelo);
      const actualizado = await tx.product.update({ where: { id }, data, include: { materialRef: true } });
      const partes = [];
      if ("priceOverride" in data) {
        partes.push(`1er día: ${describe(modelo.priceOverride, antes.formulaDay1)} → ${describe(data.priceOverride, antes.formulaDay1)}`);
      }
      if ("depositOverride" in data) {
        partes.push(`Garantía: ${describe(modelo.depositOverride, antes.depositFormula, true)} → ${describe(data.depositOverride, antes.depositFormula, true)}`);
      }
      if (motivo) partes.push(`Motivo: ${motivo}`);
      await logFinance(tx, { kind: FINANCE_EVENT.PRECIO, actorId: req.user.id, productId: id, note: `${modelo.name} · ${partes.join(" · ")}` });

      return {
        id,
        priceOverride: actualizado.priceOverride,
        depositOverride: actualizado.depositOverride,
        ...pricingView(actualizado),
      };
    });
  });
}
