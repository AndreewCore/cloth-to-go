-- Fase 4, Moderación: las reseñas se aprueban, rechazan (con un motivo de una
-- lista cerrada), ocultan o vuelven a mostrarse, y quedan en la bitácora. Los
-- clientes reportan las publicadas; con tres reportes abiertos de cuentas
-- distintas la reseña vuelve sola a la cola.

-- CreateEnum
CREATE TYPE "ReviewReason" AS ENUM ('OFENSIVO', 'SPAM', 'DATOS_PERSONALES', 'FUERA_DE_TEMA');

-- AlterEnum

ALTER TYPE "ActivityAction" ADD VALUE 'RESENA_APROBADA';
ALTER TYPE "ActivityAction" ADD VALUE 'RESENA_RECHAZADA';
ALTER TYPE "ActivityAction" ADD VALUE 'RESENA_OCULTA';
ALTER TYPE "ActivityAction" ADD VALUE 'RESENA_MOSTRADA';
ALTER TYPE "ActivityAction" ADD VALUE 'RESENA_AUTO_OCULTA';

-- AlterTable
ALTER TABLE "reviews" ADD COLUMN     "moderatedAt" TIMESTAMP(3),
ADD COLUMN     "moderatedById" INTEGER,
ADD COLUMN     "rejectReason" "ReviewReason";

-- CreateTable
CREATE TABLE "review_reports" (
    "id" SERIAL NOT NULL,
    "reviewId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "reason" "ReviewReason" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "review_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "review_reports_reviewId_userId_key" ON "review_reports"("reviewId", "userId");

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_moderatedById_fkey" FOREIGN KEY ("moderatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
