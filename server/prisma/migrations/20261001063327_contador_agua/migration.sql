-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "waterLiters" INTEGER;

-- CreateTable
CREATE TABLE "water_counter" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "liters" BIGINT NOT NULL DEFAULT 0,
    "cutAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "water_counter_pkey" PRIMARY KEY ("id")
);

-- La fila única del contador nace con la migración y no con el seed: el seed
-- solo corre en desarrollo y CI, y en producción la ruta la necesita desde el
-- primer despliegue. Arranca en 0 L, y con un corte en el pasado para que la
-- primera lectura ya haga el primero.
INSERT INTO "water_counter" ("id", "liters", "cutAt") VALUES (1, 0, '1970-01-01T00:00:00Z');
