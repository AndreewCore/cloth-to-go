-- Fase 4, retención de garantía (§6.2): lo que el local se queda por un
-- desperfecto es una línea RETENTION (ingreso) y un evento RETENCION en la
-- bitácora financiera; la garantía se libera entera con DEPOSIT_RELEASE.

-- AlterEnum
ALTER TYPE "ChargeType" ADD VALUE 'RETENTION';

-- AlterEnum
ALTER TYPE "FinanceEvent" ADD VALUE 'RETENCION';
