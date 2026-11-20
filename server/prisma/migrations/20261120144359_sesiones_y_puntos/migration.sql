-- Fase 3: sesiones propias (token opaco, solo su hash en la base) y puntos y
-- canjes en el servidor (§2 de PENDIENTE). Saldo = SUM(delta); las claves
-- únicas impiden acreditar dos veces un pedido o una meta, y gastar dos veces
-- un canje.

-- CreateEnum
CREATE TYPE "PointsReason" AS ENUM ('EARNED_DELIVERY', 'WATER_GOAL', 'REDEEMED', 'REVOKED_CANCEL', 'COUPON_REVOKED');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "pointsEarned" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "sessions" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "points_entries" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" "PointsReason" NOT NULL,
    "orderId" INTEGER,
    "couponId" INTEGER,
    "goalId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "points_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "rewardId" INTEGER NOT NULL,
    "cost" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedInOrderId" INTEGER,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "points_entries_userId_idx" ON "points_entries"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "points_entries_orderId_reason_key" ON "points_entries"("orderId", "reason");

-- CreateIndex
CREATE UNIQUE INDEX "points_entries_userId_goalId_key" ON "points_entries"("userId", "goalId");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_usedInOrderId_key" ON "coupons"("usedInOrderId");

-- CreateIndex
CREATE INDEX "coupons_userId_idx" ON "coupons"("userId");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "points_entries" ADD CONSTRAINT "points_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_usedInOrderId_fkey" FOREIGN KEY ("usedInOrderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
