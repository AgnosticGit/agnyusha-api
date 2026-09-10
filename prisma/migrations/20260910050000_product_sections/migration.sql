-- Flexible product content tabs. Seed wipes and reloads catalog from data/.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "sections" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "products" DROP COLUMN IF EXISTS "description";
ALTER TABLE "products" DROP COLUMN IF EXISTS "ingredients";
