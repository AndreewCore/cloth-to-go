-- Fase 4, Calendario: el horario de atención del local pasa a la base (antes era
-- un texto fijo en js/data.js) y se edita desde el panel, igual que los
-- feriados. Las acciones de calendario entran en la bitácora del panel.

-- AlterEnum


ALTER TYPE "ActivityAction" ADD VALUE 'FERIADO_ALTA';
ALTER TYPE "ActivityAction" ADD VALUE 'FERIADO_EDICION';
ALTER TYPE "ActivityAction" ADD VALUE 'FERIADO_BAJA';
ALTER TYPE "ActivityAction" ADD VALUE 'HORARIO';

-- CreateTable
CREATE TABLE "business_hours" (
    "weekday" INTEGER NOT NULL,
    "open" TEXT,
    "close" TEXT,

    CONSTRAINT "business_hours_pkey" PRIMARY KEY ("weekday")
);

-- El horario que se anunciaba: lunes a sábado de 10:00 a 20:00. El sábado se
-- atiende, pero sin retiros ni devoluciones (CLOSED_WEEKDAYS de dates.js).
ALTER TABLE "business_hours" ADD CONSTRAINT "business_hours_weekday_check" CHECK ("weekday" BETWEEN 0 AND 6);
INSERT INTO "business_hours" ("weekday", "open", "close") VALUES
  (0, NULL, NULL),
  (1, '10:00', '20:00'),
  (2, '10:00', '20:00'),
  (3, '10:00', '20:00'),
  (4, '10:00', '20:00'),
  (5, '10:00', '20:00'),
  (6, '10:00', '20:00');
