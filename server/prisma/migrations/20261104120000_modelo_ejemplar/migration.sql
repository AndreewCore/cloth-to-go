-- Fase 2: modelo y ejemplar, dueño, taxonomía como tablas, capacidades y
-- las dos bitácoras.
--
-- Escrita a mano sobre lo que genera `prisma migrate diff`, porque Prisma no
-- sabe mover datos: cada prenda actual pasa a ser un MODELO con un único
-- EJEMPLAR (su talla y su color), y los pedidos y cargos que apuntaban a la
-- prenda pasan a apuntar a ese ejemplar. Corre sobre una base con pedidos sin
-- perder ni una línea del ledger.

-- ---------------------------------------------------------------- Enums

CREATE TYPE "SizeScale" AS ENUM ('ROPA', 'CALZADO');
CREATE TYPE "OwnerKind" AS ENUM ('OFICIAL', 'LOCAL', 'USUARIO');
CREATE TYPE "PartnerDelivery" AS ENUM ('CTG', 'LOCAL', 'SOLO_RETIRO');
CREATE TYPE "PricingScheme" AS ENUM ('CTG', 'SOCIO');
CREATE TYPE "ItemStatus" AS ENUM ('DISPONIBLE', 'RESERVADA', 'EN_ALQUILER', 'EN_LAVADO', 'NO_ALQUILABLE', 'PERDIDA');
CREATE TYPE "UnrentableReason" AS ENUM ('DESPERFECTO', 'RETIRADA');
CREATE TYPE "LaundryKind" AS ENUM ('PROPIO', 'EXTERNO');
CREATE TYPE "ItemCondition" AS ENUM ('NUEVA', 'COMO_NUEVA', 'BUENA', 'USO_VISIBLE');
CREATE TYPE "Custody" AS ENUM ('CTG', 'SOCIO');
CREATE TYPE "Capability" AS ENUM ('MOSTRADOR', 'CAJA', 'INVENTARIO', 'ADMINISTRACION', 'MODERACION', 'SOCIOS');
CREATE TYPE "FinanceEvent" AS ENUM ('COBRO_CONFIRMADO', 'GARANTIA_LIBERADA', 'PENALIZACION', 'ANULACION', 'CAPACIDADES');

-- ------------------------------------------------------------ Taxonomía
-- Se siembra aquí y no en seed.js: las prendas que ya existen necesitan sus
-- claves para poder apuntarles. Después la edita el panel.

CREATE TABLE "categories" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "categories_pkey" PRIMARY KEY ("key"),
    -- El prefijo entra en el código de inventario: tres mayúsculas, sin más.
    CONSTRAINT "categories_prefix_check" CHECK ("prefix" ~ '^[A-Z]{3}$')
);
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");
CREATE UNIQUE INDEX "categories_prefix_key" ON "categories"("prefix");
INSERT INTO "categories" ("key", "name", "prefix", "sort") VALUES
  ('formal',    'Formal',    'FOR', 1),
  ('fiesta',    'Fiesta',    'FIE', 2),
  ('casual',    'Casual',    'CAS', 3),
  ('invierno',  'Invierno',  'INV', 4),
  ('disfraces', 'Disfraces', 'DIS', 5),
  ('calzado',   'Calzado',   'CAL', 6);

CREATE TABLE "colors" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hex" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "colors_pkey" PRIMARY KEY ("key")
);
-- La misma paleta que COLOR_LABELS / COLOR_HEX de js/data.js.
INSERT INTO "colors" ("key", "name", "hex", "sort") VALUES
  ('negro',    'Negro',    '#1e1e1e', 1),
  ('gris',     'Gris',     '#9aa0a6', 2),
  ('blanco',   'Blanco',   '#f6f5f1', 3),
  ('beige',    'Beige',    '#d8c3a0', 4),
  ('cafe',     'Café',     '#6d4a2f', 5),
  ('rojo',     'Rojo',     '#c0392b', 6),
  ('naranja',  'Naranja',  '#e07b2c', 7),
  ('amarillo', 'Amarillo', '#e3c355', 8),
  ('verde',    'Verde',    '#4a7c59', 9),
  ('turquesa', 'Turquesa', '#3fb8ad', 10),
  ('celeste',  'Celeste',  '#7fc4e8', 11),
  ('azul',     'Azul',     '#33609c', 12),
  ('morado',   'Morado',   '#7b5ea7', 13),
  ('rosa',     'Rosa',     '#e2a0bb', 14);

CREATE TABLE "materials" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "laundryCents" INTEGER NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "materials_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "materials_laundry_check" CHECK ("laundryCents" >= 0)
);
-- Los costes de LAUNDRY_BY_MATERIAL en src/pricing.js, en centavos.
INSERT INTO "materials" ("key", "name", "laundryCents", "sort") VALUES
  ('algodon',   'Algodón',   150, 1),
  ('lana',      'Lana',      500, 2),
  ('lino',      'Lino',      250, 3),
  ('cuero',     'Cuero',     300, 4),
  ('sintetico', 'Sintético', 150, 5);

CREATE TABLE "sizes" (
    "scale" "SizeScale" NOT NULL,
    "label" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "sizes_pkey" PRIMARY KEY ("scale","label")
);
INSERT INTO "sizes" ("scale", "label", "sort") VALUES
  ('ROPA', 'XS', 1), ('ROPA', 'S', 2), ('ROPA', 'M', 3),
  ('ROPA', 'L', 4), ('ROPA', 'XL', 5), ('ROPA', 'XXL', 6),
  ('CALZADO', '34', 1), ('CALZADO', '35', 2), ('CALZADO', '36', 3),
  ('CALZADO', '37', 4), ('CALZADO', '38', 5), ('CALZADO', '39', 6),
  ('CALZADO', '40', 7), ('CALZADO', '41', 8), ('CALZADO', '42', 9),
  ('CALZADO', '43', 10), ('CALZADO', '44', 11), ('CALZADO', '45', 12);

CREATE TABLE "occasions" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "occasions_pkey" PRIMARY KEY ("key")
);
INSERT INTO "occasions" ("key", "name", "sort") VALUES
  ('boda',       'Boda',              1),
  ('graduacion', 'Graduación',        2),
  ('gala',       'Gala o etiqueta',   3),
  ('oficina',    'Oficina',           4),
  ('fiesta',     'Fiesta',            5),
  ('disfraz',    'Disfraz o temática', 6),
  ('diario',     'Día a día',         7);

CREATE TABLE "seasons" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "seasons_pkey" PRIMARY KEY ("key")
);
INSERT INTO "seasons" ("key", "name", "sort") VALUES
  ('todo',   'Todo el año',   1),
  ('calido', 'Clima cálido',  2),
  ('fresco', 'Clima fresco',  3);

CREATE TABLE "audiences" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "audiences_pkey" PRIMARY KEY ("key")
);
INSERT INTO "audiences" ("key", "name", "sort") VALUES
  ('mujer',  'Mujer',  1),
  ('hombre', 'Hombre', 2),
  ('unisex', 'Unisex', 3),
  ('ninos',  'Niños',  4);

-- --------------------------------------------------------------- Dueños

CREATE TABLE "owners" (
    "id" SERIAL NOT NULL,
    "kind" "OwnerKind" NOT NULL,
    "name" TEXT NOT NULL,
    "userId" INTEGER,
    "commissionBps" INTEGER,
    "delivery" "PartnerDelivery",
    "damagePolicy" TEXT,
    "damagePolicyVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "owners_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "owners_commission_check" CHECK ("commissionBps" IS NULL OR "commissionBps" BETWEEN 0 AND 10000)
);
CREATE UNIQUE INDEX "owners_userId_key" ON "owners"("userId");
-- El dueño Oficial es el id 1: es el valor por defecto de products.ownerId.
INSERT INTO "owners" ("id", "kind", "name") VALUES (1, 'OFICIAL', 'CLOTH TO GO');
SELECT setval(pg_get_serial_sequence('owners', 'id'), 1);

-- --------------------------------------------------- Modelo (products)

ALTER TABLE "products"
  ADD COLUMN "categoryKey" TEXT,
  ADD COLUMN "audienceKey" TEXT,
  ADD COLUMN "brand" TEXT,
  ADD COLUMN "seasonKey" TEXT,
  ADD COLUMN "ownerId" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "pricing" "PricingScheme" NOT NULL DEFAULT 'CTG',
  ADD COLUMN "priceOverride" DOUBLE PRECISION,
  ADD COLUMN "depositOverride" INTEGER,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- `cat` guardaba el nombre visible; ahora la prenda guarda la clave.
UPDATE "products" p SET "categoryKey" = c."key" FROM "categories" c WHERE c."name" = p."cat";
ALTER TABLE "products" ALTER COLUMN "categoryKey" SET NOT NULL;

-- ------------------------------------------------------------ Ejemplares

CREATE TABLE "items" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "code" TEXT,
    "sizeScale" "SizeScale" NOT NULL,
    "size" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "condition" "ItemCondition",
    "measurements" JSONB,
    "custody" "Custody" NOT NULL DEFAULT 'CTG',
    "status" "ItemStatus" NOT NULL DEFAULT 'DISPONIBLE',
    "statusSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unrentableReason" "UnrentableReason",
    "laundryKind" "LaundryKind",
    "laundryPlace" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "items_code_check" CHECK ("code" IS NULL OR "code" ~ '^[A-Z]{3}-[0-9]{2}-[0-9]{4}$'),
    -- En Lavado exige saber quién lava y dónde; fuera de ese estado no hay
    -- lavado que describir. Lo comprueba también el código, pero esta es la
    -- regla que no se salta una consulta a mano.
    CONSTRAINT "items_laundry_check" CHECK (
      ("status" = 'EN_LAVADO') = ("laundryKind" IS NOT NULL AND "laundryPlace" IS NOT NULL)
    ),
    CONSTRAINT "items_unrentable_check" CHECK (
      ("status" = 'NO_ALQUILABLE') = ("unrentableReason" IS NOT NULL)
    )
);
CREATE UNIQUE INDEX "items_code_key" ON "items"("code");
CREATE INDEX "items_productId_idx" ON "items"("productId");

-- Un ejemplar por prenda actual, sin código: las 16 de demostración no
-- existen físicamente (§5). La escala se deduce como en el frontend: talla
-- numérica ⇒ calzado.
INSERT INTO "items" ("productId", "sizeScale", "size", "color")
SELECT "id",
       CASE WHEN "size" ~ '^[0-9]+$' THEN 'CALZADO'::"SizeScale" ELSE 'ROPA'::"SizeScale" END,
       "size", "color"
FROM "products" ORDER BY "id";

-- ------------------------------------------- Pedidos: de prenda a ejemplar

DROP INDEX "order_items_orderId_productId_key";
DROP INDEX "order_items_productId_idx";
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_productId_fkey";
ALTER TABLE "order_items"
  ADD COLUMN "itemId" INTEGER,
  ADD COLUMN "start" DATE,
  ADD COLUMN "end" DATE,
  ADD COLUMN "releasedAt" TIMESTAMP(3);
-- Las fechas del pedido son texto YYYY-MM-DD validado por la API: el cast es
-- exacto. Un pedido anulado deja la reserva liberada en el instante en que se
-- anuló.
UPDATE "order_items" oi
SET "itemId" = i."id",
    "start" = o."start"::date,
    "end" = o."end"::date,
    "releasedAt" = o."cancelledAt"
FROM "items" i, "orders" o
WHERE i."productId" = oi."productId" AND o."id" = oi."orderId";
ALTER TABLE "order_items"
  ALTER COLUMN "itemId" SET NOT NULL,
  ALTER COLUMN "start" SET NOT NULL,
  ALTER COLUMN "end" SET NOT NULL,
  DROP COLUMN "productId",
  ADD CONSTRAINT "order_items_range_check" CHECK ("end" >= "start");
CREATE UNIQUE INDEX "order_items_orderId_itemId_key" ON "order_items"("orderId", "itemId");
CREATE INDEX "order_items_itemId_idx" ON "order_items"("itemId");

ALTER TABLE "charges" DROP CONSTRAINT "charges_productId_fkey";
ALTER TABLE "charges" ADD COLUMN "itemId" INTEGER;
UPDATE "charges" c SET "itemId" = i."id" FROM "items" i WHERE i."productId" = c."productId";
ALTER TABLE "charges" DROP COLUMN "productId";

-- Los ejemplares con una reserva viva y pendiente quedan Reservados, como si
-- el pedido se hubiera hecho con estas reglas.
UPDATE "items" i SET "status" = 'RESERVADA'
WHERE EXISTS (
  SELECT 1 FROM "order_items" oi
  WHERE oi."itemId" = i."id" AND oi."releasedAt" IS NULL AND oi."end" >= CURRENT_DATE
);

-- Talla y color ya son del ejemplar; `disponibles` ya no es un número sino
-- cuántos ejemplares hay.
ALTER TABLE "products"
  DROP COLUMN "cat",
  DROP COLUMN "size",
  DROP COLUMN "color",
  DROP COLUMN "disponibles";

-- Los ids del catálogo eran fijos; a partir de aquí los modelos nuevos los
-- numera la base, empezando después del último existente.
CREATE SEQUENCE "products_id_seq" OWNED BY "products"."id";
ALTER TABLE "products" ALTER COLUMN "id" SET DEFAULT nextval('products_id_seq');
SELECT setval('products_id_seq', GREATEST((SELECT MAX("id") FROM "products"), 1));

CREATE TABLE "_OccasionToProduct" (
    "A" TEXT NOT NULL,
    "B" INTEGER NOT NULL,
    CONSTRAINT "_OccasionToProduct_AB_pkey" PRIMARY KEY ("A","B")
);
CREATE INDEX "_OccasionToProduct_B_index" ON "_OccasionToProduct"("B");

-- --------------------------------------------------- Inventario y personal

CREATE TABLE "inventory_sequences" (
    "prefix" TEXT NOT NULL,
    "year" TEXT NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "inventory_sequences_pkey" PRIMARY KEY ("prefix","year")
);

ALTER TABLE "users" ADD COLUMN "capabilities" "Capability"[] DEFAULT ARRAY[]::"Capability"[];

-- ------------------------------------------------------------- Bitácoras

CREATE TABLE "item_logs" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "actorId" INTEGER,
    "from" "ItemStatus",
    "to" "ItemStatus" NOT NULL,
    "note" TEXT,
    "laundryKind" "LaundryKind",
    "laundryPlace" TEXT,
    "orderId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "item_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "item_logs_itemId_idx" ON "item_logs"("itemId");

CREATE TABLE "finance_logs" (
    "id" SERIAL NOT NULL,
    "kind" "FinanceEvent" NOT NULL,
    "actorId" INTEGER,
    "orderId" INTEGER,
    "subjectUserId" INTEGER,
    "amountCents" INTEGER,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "finance_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "finance_logs_orderId_idx" ON "finance_logs"("orderId");

-- ------------------------------------------------------- Claves foráneas

ALTER TABLE "owners" ADD CONSTRAINT "owners_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_categoryKey_fkey" FOREIGN KEY ("categoryKey") REFERENCES "categories"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_material_fkey" FOREIGN KEY ("material") REFERENCES "materials"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_audienceKey_fkey" FOREIGN KEY ("audienceKey") REFERENCES "audiences"("key") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_seasonKey_fkey" FOREIGN KEY ("seasonKey") REFERENCES "seasons"("key") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "items" ADD CONSTRAINT "items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "items" ADD CONSTRAINT "items_sizeScale_size_fkey" FOREIGN KEY ("sizeScale", "size") REFERENCES "sizes"("scale", "label") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "items" ADD CONSTRAINT "items_color_fkey" FOREIGN KEY ("color") REFERENCES "colors"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "charges" ADD CONSTRAINT "charges_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "item_logs" ADD CONSTRAINT "item_logs_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "item_logs" ADD CONSTRAINT "item_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "item_logs" ADD CONSTRAINT "item_logs_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "finance_logs" ADD CONSTRAINT "finance_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "finance_logs" ADD CONSTRAINT "finance_logs_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "finance_logs" ADD CONSTRAINT "finance_logs_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "_OccasionToProduct" ADD CONSTRAINT "_OccasionToProduct_A_fkey" FOREIGN KEY ("A") REFERENCES "occasions"("key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_OccasionToProduct" ADD CONSTRAINT "_OccasionToProduct_B_fkey" FOREIGN KEY ("B") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ------------------------------------------- Sin solape de reservas (§3)
-- La regla que impide el sobrealquiler vive en la base, no en el código: dos
-- checkouts simultáneos sobre el mismo ejemplar pasan los dos cualquier
-- comprobación previa, pero solo uno pasa esta restricción. Rango INCLUSIVO
-- ('[]'): el día de devolución está ocupado. Una reserva liberada (pedido
-- anulado) no cuenta.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_sin_solape"
  EXCLUDE USING gist ("itemId" WITH =, daterange("start", "end", '[]') WITH &&)
  WHERE ("releasedAt" IS NULL);

-- --------------------------------------------- Bitácoras de solo añadir (§3.1)
-- Una entrada no se edita ni se borra: es lo que se le enseña a quien reclama.
-- La única puerta es `ctg.purge`, una variable de sesión que solo usan las
-- pruebas para limpiar lo que crearon; no la expone ninguna ruta de la API.
CREATE FUNCTION "bitacora_solo_anadir"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('ctg.purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'La bitácora % es de solo añadir: no admite %', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "item_logs_solo_anadir" BEFORE UPDATE OR DELETE ON "item_logs"
  FOR EACH ROW EXECUTE FUNCTION "bitacora_solo_anadir"();
CREATE TRIGGER "finance_logs_solo_anadir" BEFORE UPDATE OR DELETE ON "finance_logs"
  FOR EACH ROW EXECUTE FUNCTION "bitacora_solo_anadir"();
