-- AdminRole enum
CREATE TYPE "AdminRole" AS ENUM ('OWNER', 'SALES', 'ACCOUNTS');

-- Migrate existing string `role` column to enum.
-- Step 1: add new typed column with default OWNER.
ALTER TABLE "Admin" ADD COLUMN "role_new" "AdminRole" NOT NULL DEFAULT 'OWNER';
-- Step 2: map existing string values where we can (anything non-trivial → OWNER).
UPDATE "Admin" SET "role_new" = 'OWNER' WHERE "role" IS NULL OR "role" IN ('admin','superadmin','owner');
-- Step 3: drop old column, rename new one.
ALTER TABLE "Admin" DROP COLUMN "role";
ALTER TABLE "Admin" RENAME COLUMN "role_new" TO "role";

-- New columns on Admin.
ALTER TABLE "Admin" ADD COLUMN "permissions" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "Admin" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Admin" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AuditLog table.
CREATE TABLE "AuditLog" (
  "id"         TEXT NOT NULL,
  "actorId"    TEXT NOT NULL,
  "action"     TEXT NOT NULL,
  "targetType" TEXT,
  "targetId"   TEXT,
  "oldValue"   JSONB,
  "newValue"   JSONB,
  "notes"      TEXT,
  "ipAddress"  TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_actorId_idx"               ON "AuditLog"("actorId");
CREATE INDEX "AuditLog_targetType_targetId_idx"   ON "AuditLog"("targetType","targetId");
CREATE INDEX "AuditLog_action_idx"                ON "AuditLog"("action");
CREATE INDEX "AuditLog_createdAt_idx"             ON "AuditLog"("createdAt");

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
