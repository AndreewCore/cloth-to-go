-- Feriados nacionales de Ecuador que cierran el local (§6.0 de DECISIONES).
-- Fechas ya trasladadas según la Ley de Servicio Público: martes → lunes;
-- miércoles y jueves → viernes; sábado → viernes; domingo → lunes. Carnaval,
-- Viernes Santo, 1 de enero y 25 de diciembre se descansan en su día salvo
-- fin de semana. Revisar contra el decreto anual; el panel (fase 4) los edita.

CREATE TABLE "holidays" (
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "holidays_pkey" PRIMARY KEY ("date")
);

INSERT INTO "holidays" ("date", "name") VALUES
  ('2026-01-01', 'Año Nuevo'),
  ('2026-02-16', 'Carnaval'),
  ('2026-02-17', 'Carnaval'),
  ('2026-04-03', 'Viernes Santo'),
  ('2026-05-01', 'Día del Trabajo'),
  ('2026-05-25', 'Batalla de Pichincha (trasladado)'),
  ('2026-08-10', 'Primer Grito de Independencia'),
  ('2026-10-09', 'Independencia de Guayaquil'),
  ('2026-11-02', 'Día de Difuntos'),
  ('2026-11-03', 'Independencia de Cuenca'),
  ('2026-12-25', 'Navidad'),
  ('2027-01-01', 'Año Nuevo'),
  ('2027-02-08', 'Carnaval'),
  ('2027-02-09', 'Carnaval'),
  ('2027-03-26', 'Viernes Santo'),
  ('2027-04-30', 'Día del Trabajo (trasladado)'),
  ('2027-05-24', 'Batalla de Pichincha'),
  ('2027-08-09', 'Primer Grito de Independencia (trasladado)'),
  ('2027-10-08', 'Independencia de Guayaquil (trasladado)'),
  ('2027-11-02', 'Día de Difuntos'),
  ('2027-11-03', 'Independencia de Cuenca'),
  ('2027-12-24', 'Navidad (trasladado)')
ON CONFLICT ("date") DO NOTHING;
