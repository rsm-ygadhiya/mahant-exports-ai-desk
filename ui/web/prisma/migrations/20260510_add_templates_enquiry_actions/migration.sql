-- Add new EnquiryStatus values
ALTER TYPE "EnquiryStatus" ADD VALUE IF NOT EXISTS 'APPROVED_MEMO';
ALTER TYPE "EnquiryStatus" ADD VALUE IF NOT EXISTS 'APPROVED_SALE';
ALTER TYPE "EnquiryStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- Enquiry: memo + order link + decision audit
ALTER TABLE "Enquiry"
  ADD COLUMN "memoLocation"      TEXT,
  ADD COLUMN "memoPickupAt"      TIMESTAMP(3),
  ADD COLUMN "orderId"           TEXT,
  ADD COLUMN "cancellationReason" TEXT,
  ADD COLUMN "decidedAt"         TIMESTAMP(3),
  ADD COLUMN "decidedBy"         TEXT;
CREATE UNIQUE INDEX "Enquiry_orderId_key" ON "Enquiry"("orderId");
ALTER TABLE "Enquiry"
  ADD CONSTRAINT "Enquiry_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- TemplateChannel + MessageTemplate
CREATE TYPE "TemplateChannel" AS ENUM ('SMS', 'EMAIL', 'BOTH');

CREATE TABLE "MessageTemplate" (
  "id"          TEXT NOT NULL,
  "key"         TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "subject"     TEXT,
  "body"        TEXT NOT NULL,
  "channel"     "TemplateChannel" NOT NULL DEFAULT 'BOTH',
  "isSystem"    BOOLEAN NOT NULL DEFAULT false,
  "updatedBy"   TEXT,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MessageTemplate_key_key" ON "MessageTemplate"("key");
