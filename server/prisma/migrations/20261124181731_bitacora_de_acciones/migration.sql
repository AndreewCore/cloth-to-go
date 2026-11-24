-- Fase 4, Bitácora: las acciones del panel que no mueven dinero ni el estado de
-- una prenda (catálogo, fotos, taxonomía) quedan registradas con quién y cuándo.
-- Solo añadir, con el mismo disparador que las otras bitácoras.

-- CreateEnum
CREATE TYPE "ActivityAction" AS ENUM ('MODELO_ALTA', 'MODELO_EDICION', 'FOTO_CATALOGO_SUBIDA', 'FOTO_CATALOGO_QUITADA', 'FOTOS_CATALOGO_ORDEN', 'EJEMPLAR_EDICION', 'TAXONOMIA_ALTA', 'TAXONOMIA_EDICION', 'TAXONOMIA_ORDEN', 'TAXONOMIA_BAJA');

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" SERIAL NOT NULL,
    "action" "ActivityAction" NOT NULL,
    "actorId" INTEGER,
    "productId" INTEGER,
    "itemId" INTEGER,
    "note" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_logs_createdAt_idx" ON "activity_logs"("createdAt");

-- CreateIndex
CREATE INDEX "activity_logs_productId_idx" ON "activity_logs"("productId");

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Solo añadir
CREATE TRIGGER "activity_logs_solo_anadir" BEFORE UPDATE OR DELETE ON "activity_logs"
  FOR EACH ROW EXECUTE FUNCTION "bitacora_solo_anadir"();
