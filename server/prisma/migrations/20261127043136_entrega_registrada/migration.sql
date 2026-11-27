-- Fase 4, entrega registrada: una prenda cuenta como entregada cuando el local
-- lo registra (día real, cuándo y quién), no cuando llega la fecha de retiro.
-- Los avisos al cliente ganan los tipos de la operación del local.

-- AlterEnum

ALTER TYPE "NoticeKind" ADD VALUE 'ENTREGA';
ALTER TYPE "NoticeKind" ADD VALUE 'DEVOLUCION';
ALTER TYPE "NoticeKind" ADD VALUE 'RETIRO_MOVIDO';
ALTER TYPE "NoticeKind" ADD VALUE 'ANULADO_SIN_RETIRO';
ALTER TYPE "NoticeKind" ADD VALUE 'GARANTIA';

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "deliveredById" INTEGER,
ADD COLUMN     "deliveredOn" DATE;

-- AlterTable
ALTER TABLE "notices" ADD COLUMN     "orderId" INTEGER;

-- AddForeignKey
ALTER TABLE "notices" ADD CONSTRAINT "notices_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_deliveredById_fkey" FOREIGN KEY ("deliveredById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Relleno de lo ya entregado antes de este cambio: la entrega era el paso a
-- mano de Reservada a En Alquiler, que no llevaba número de pedido. Se toma el
-- primero después de crear el pedido y antes de que otro pedido tomara la
-- prenda. El día real es el de ese registro en hora de Guayaquil (UTC−5).
WITH primera AS (
  SELECT DISTINCT ON (oi."id") oi."id", il."createdAt", il."actorId",
         GREATEST(o."start"::date, (il."createdAt" - INTERVAL '5 hours')::date) AS dia
  FROM "order_items" oi
  JOIN "orders" o ON o."id" = oi."orderId"
  JOIN "item_logs" il ON il."itemId" = oi."itemId"
  WHERE o."cancelledAt" IS NULL AND oi."deliveredAt" IS NULL
    AND il."from" = 'RESERVADA' AND il."to" = 'EN_ALQUILER'
    AND il."createdAt" >= o."createdAt"
    AND NOT EXISTS (
      SELECT 1 FROM "order_items" oi2 JOIN "orders" o2 ON o2."id" = oi2."orderId"
      WHERE oi2."itemId" = oi."itemId" AND o2."createdAt" > o."createdAt" AND o2."createdAt" <= il."createdAt"
    )
  ORDER BY oi."id", il."createdAt"
)
UPDATE "order_items" oi
SET "deliveredAt" = p."createdAt", "deliveredById" = p."actorId", "deliveredOn" = p.dia
FROM primera p
WHERE p."id" = oi."id";

-- Lo que ya se recibió también se entregó, aunque no quede rastro de cuándo.
UPDATE "order_items" oi
SET "deliveredAt" = oi."receivedAt", "deliveredOn" = o."start"::date
FROM "orders" o
WHERE o."id" = oi."orderId" AND oi."deliveredAt" IS NULL AND oi."receivedAt" IS NOT NULL;
