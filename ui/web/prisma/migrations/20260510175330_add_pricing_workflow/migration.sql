-- CreateEnum
CREATE TYPE "PricingRunStatus" AS ENUM ('DRAFT', 'APPLIED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'APPLIED');

-- CreateTable
CREATE TABLE "RapRate" (
    "id" TEXT NOT NULL,
    "sheetDate" TIMESTAMP(3) NOT NULL,
    "shape" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "clarity" TEXT NOT NULL,
    "caratMin" DECIMAL(6,2) NOT NULL,
    "caratMax" DECIMAL(6,2) NOT NULL,
    "ratePerCt" DECIMAL(12,2) NOT NULL,
    "filename" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RapRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingRun" (
    "id" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "status" "PricingRunStatus" NOT NULL DEFAULT 'DRAFT',
    "mode" TEXT NOT NULL,
    "rapDate" TIMESTAMP(3),
    "notes" TEXT,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "PricingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingProposal" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "diamondId" TEXT NOT NULL,
    "oldPpc" DECIMAL(12,2) NOT NULL,
    "proposedPpc" DECIMAL(12,2) NOT NULL,
    "rapPrice" DECIMAL(12,2),
    "changePct" DECIMAL(6,2) NOT NULL,
    "reasoning" TEXT NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "PricingProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RapRate_shape_color_clarity_idx" ON "RapRate"("shape", "color", "clarity");

-- CreateIndex
CREATE INDEX "RapRate_sheetDate_idx" ON "RapRate"("sheetDate");

-- CreateIndex
CREATE UNIQUE INDEX "RapRate_sheetDate_shape_color_clarity_caratMin_caratMax_key" ON "RapRate"("sheetDate", "shape", "color", "clarity", "caratMin", "caratMax");

-- CreateIndex
CREATE INDEX "PricingRun_status_idx" ON "PricingRun"("status");

-- CreateIndex
CREATE INDEX "PricingProposal_runId_idx" ON "PricingProposal"("runId");

-- CreateIndex
CREATE INDEX "PricingProposal_status_idx" ON "PricingProposal"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PricingProposal_runId_diamondId_key" ON "PricingProposal"("runId", "diamondId");

-- AddForeignKey
ALTER TABLE "PricingProposal" ADD CONSTRAINT "PricingProposal_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PricingRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingProposal" ADD CONSTRAINT "PricingProposal_diamondId_fkey" FOREIGN KEY ("diamondId") REFERENCES "Diamond"("id") ON DELETE CASCADE ON UPDATE CASCADE;
