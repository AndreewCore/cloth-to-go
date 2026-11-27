-- Fase 4, pestaña «Hoy»: mover el retiro de un pedido queda en la bitácora
-- general, ligado al pedido para que salga en su recorrido.

-- AlterEnum
ALTER TYPE "ActivityAction" ADD VALUE 'RETIRO_MOVIDO';

-- AlterTable
ALTER TABLE "activity_logs" ADD COLUMN     "orderId" INTEGER;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
