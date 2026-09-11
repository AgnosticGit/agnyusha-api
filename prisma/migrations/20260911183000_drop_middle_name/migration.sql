-- Drop patronymic: we no longer collect or store it.
ALTER TABLE "users" DROP COLUMN IF EXISTS "middle_name";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "middle_name";
