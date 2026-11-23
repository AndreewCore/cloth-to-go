-- Fase 4, Operación: la recepción de cada prenda devuelta. Dos fechas (§6.3):
-- el día real en que volvió (`returnedOn`, de donde salen los días extra) y
-- cuándo y quién lo registró. Más el evento financiero de los días extra.

-- AlterEnum
ALTER TYPE "FinanceEvent" ADD VALUE 'DIAS_EXTRA';

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "receivedAt" TIMESTAMP(3),
ADD COLUMN     "receivedById" INTEGER,
ADD COLUMN     "returnedOn" DATE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
