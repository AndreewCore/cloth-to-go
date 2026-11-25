-- Fase 4, Avisos: lo que el local le dice a un cliente (por ahora, el rechazo
-- de una reseña con su motivo). Se lee en la app y la web; el correo es aparte
-- y queda apuntado en emailedAt.

-- CreateEnum
CREATE TYPE "NoticeKind" AS ENUM ('RESENA_RECHAZADA');

-- CreateTable
CREATE TABLE "notices" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "kind" "NoticeKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "reviewId" INTEGER,
    "readAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notices_userId_readAt_idx" ON "notices"("userId", "readAt");

-- AddForeignKey
ALTER TABLE "notices" ADD CONSTRAINT "notices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notices" ADD CONSTRAINT "notices_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "reviews"("id") ON DELETE SET NULL ON UPDATE CASCADE;
