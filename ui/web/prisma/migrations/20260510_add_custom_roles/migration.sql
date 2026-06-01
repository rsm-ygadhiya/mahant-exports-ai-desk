-- Role table
CREATE TABLE "Role" (
  "id"          TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "slug"        TEXT NOT NULL,
  "isOwnerLike" BOOLEAN NOT NULL DEFAULT false,
  "isSystem"    BOOLEAN NOT NULL DEFAULT false,
  "permissions" JSONB NOT NULL DEFAULT '{}',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");
CREATE UNIQUE INDEX "Role_slug_key" ON "Role"("slug");

-- Seed the three built-in roles. Permissions will be backfilled by the seeder
-- using DEFAULT_PERMISSIONS so we don't duplicate the matrix in SQL.
INSERT INTO "Role" ("id", "name", "slug", "isOwnerLike", "isSystem")
VALUES
  ('role_owner',    'Owner',    'owner',    true,  true),
  ('role_sales',    'Sales',    'sales',    false, true),
  ('role_accounts', 'Accounts', 'accounts', false, true);

-- Admin.roleId FK
ALTER TABLE "Admin" ADD COLUMN "roleId" TEXT;
ALTER TABLE "Admin"
  ADD CONSTRAINT "Admin_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Admin_roleId_idx" ON "Admin"("roleId");

-- Backfill existing admins to point at the matching system role.
UPDATE "Admin" SET "roleId" = 'role_owner'    WHERE "role" = 'OWNER';
UPDATE "Admin" SET "roleId" = 'role_sales'    WHERE "role" = 'SALES';
UPDATE "Admin" SET "roleId" = 'role_accounts' WHERE "role" = 'ACCOUNTS';
