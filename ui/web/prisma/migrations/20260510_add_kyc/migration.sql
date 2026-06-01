-- Enums
CREATE TYPE "KycStatus" AS ENUM ('NOT_SUBMITTED','SUBMITTED','MORE_DOCS_NEEDED','APPROVED','REJECTED');
CREATE TYPE "DocumentKind" AS ENUM ('GST','PAN','COMPANY_PROOF','ADDRESS_PROOF','BANK_DETAILS','OTHER');

-- Customer KYC + uniqueCode fields
ALTER TABLE "Customer"
  ADD COLUMN "uniqueCode"         TEXT,
  ADD COLUMN "kycStatus"          "KycStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
  ADD COLUMN "kycSubmittedAt"     TIMESTAMP(3),
  ADD COLUMN "kycReviewedAt"      TIMESTAMP(3),
  ADD COLUMN "kycReviewedBy"      TEXT,
  ADD COLUMN "kycRejectionReason" TEXT;
CREATE UNIQUE INDEX "Customer_uniqueCode_key" ON "Customer"("uniqueCode");

-- CustomerDocument
CREATE TABLE "CustomerDocument" (
  "id"         TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "kind"       "DocumentKind" NOT NULL,
  "label"      TEXT NOT NULL,
  "filename"   TEXT NOT NULL,
  "mimeType"   TEXT NOT NULL,
  "sizeBytes"  INTEGER NOT NULL,
  "fileBytes"  BYTEA NOT NULL,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerDocument_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CustomerDocument_customerId_idx" ON "CustomerDocument"("customerId");
CREATE INDEX "CustomerDocument_kind_idx"       ON "CustomerDocument"("kind");
ALTER TABLE "CustomerDocument"
  ADD CONSTRAINT "CustomerDocument_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Counter for sequential ID generation
CREATE TABLE "Counter" (
  "key"       TEXT NOT NULL,
  "value"     INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Counter_pkey" PRIMARY KEY ("key")
);
