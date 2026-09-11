-- Convert MANAGER → STAFF with former role capabilities as permissions,
-- then drop MANAGER from UserRole.

INSERT INTO "user_permissions" ("user_id", "permission")
SELECT u.id, 'USER_MANAGE'::"StaffPermission"
FROM "users" u
WHERE u.role = 'MANAGER'
ON CONFLICT ("user_id", "permission") DO NOTHING;

INSERT INTO "user_permissions" ("user_id", "permission")
SELECT u.id, 'ANALYTICS_VIEW'::"StaffPermission"
FROM "users" u
WHERE u.role = 'MANAGER'
ON CONFLICT ("user_id", "permission") DO NOTHING;

UPDATE "users" SET role = 'STAFF' WHERE role = 'MANAGER';

CREATE TYPE "UserRole_new" AS ENUM ('USER', 'STAFF', 'ADMIN');

ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users"
  ALTER COLUMN "role" TYPE "UserRole_new"
  USING (role::text::"UserRole_new");

DROP TYPE "UserRole";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";

ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'USER'::"UserRole";
