-- Fase 4, Precio: cada cambio de lo que fija el precio de un modelo (ajuste del
-- primer día, garantía fija, valor o estrellas) queda en la bitácora financiera
-- con quién lo hizo. `productId` permite pedir el historial de un modelo. La
-- bitácora sigue siendo de solo añadir: añadir una columna no toca filas.

-- AlterEnum
ALTER TYPE "FinanceEvent" ADD VALUE 'PRECIO';

-- AlterTable
ALTER TABLE "finance_logs" ADD COLUMN     "productId" INTEGER;

-- CreateIndex
CREATE INDEX "finance_logs_productId_idx" ON "finance_logs"("productId");

-- AddForeignKey
ALTER TABLE "finance_logs" ADD CONSTRAINT "finance_logs_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
