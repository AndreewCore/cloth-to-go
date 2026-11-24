-- Fase 4, Catálogo: fotos de cómo salió y cómo llegó cada ejemplar. El archivo
-- vive en el almacenamiento privado; aquí solo su clave, quién la sacó y en
-- qué pedido. Es evidencia para retener una garantía, así que es de solo
-- añadir, con el mismo disparador que las bitácoras (y la misma única puerta,
-- `ctg.purge`, para que las pruebas limpien lo suyo).

-- CreateEnum
CREATE TYPE "PhotoKind" AS ENUM ('SALIDA', 'LLEGADA', 'ESTADO');

-- CreateTable
CREATE TABLE "item_photos" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "orderId" INTEGER,
    "kind" "PhotoKind" NOT NULL,
    "key" TEXT NOT NULL,
    "takenById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "item_photos_key_key" ON "item_photos"("key");

-- CreateIndex
CREATE INDEX "item_photos_itemId_idx" ON "item_photos"("itemId");

-- AddForeignKey
ALTER TABLE "item_photos" ADD CONSTRAINT "item_photos_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_photos" ADD CONSTRAINT "item_photos_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_photos" ADD CONSTRAINT "item_photos_takenById_fkey" FOREIGN KEY ("takenById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Solo añadir
CREATE TRIGGER "item_photos_solo_anadir" BEFORE UPDATE OR DELETE ON "item_photos"
  FOR EACH ROW EXECUTE FUNCTION "bitacora_solo_anadir"();
