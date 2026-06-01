-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "DiamondStatus" AS ENUM ('AVAILABLE', 'HOLD', 'SOLD');

-- CreateEnum
CREATE TYPE "GrowthMethod" AS ENUM ('CVD', 'HPHT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PricingMode" AS ENUM ('BASE', 'ADJUST_PCT', 'HIDDEN');

-- CreateEnum
CREATE TYPE "EnquiryStatus" AS ENUM ('NEW', 'CONTACTED', 'CLOSED');

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT,
    "companyName" TEXT NOT NULL,
    "contactPerson" TEXT NOT NULL,
    "country" TEXT,
    "city" TEXT,
    "status" "CustomerStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Admin" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Otp" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Otp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Diamond" (
    "id" TEXT NOT NULL,
    "stoneId" TEXT NOT NULL,
    "certificateNo" TEXT,
    "lab" TEXT,
    "certificateUrl" TEXT,
    "videoUrl" TEXT,
    "imageUrl" TEXT,
    "shape" TEXT NOT NULL,
    "carat" DECIMAL(6,2) NOT NULL,
    "color" TEXT NOT NULL,
    "clarity" TEXT NOT NULL,
    "cut" TEXT,
    "polish" TEXT,
    "symmetry" TEXT,
    "fluorescence" TEXT,
    "measurements" TEXT,
    "length" DECIMAL(6,2),
    "width" DECIMAL(6,2),
    "depth" DECIMAL(6,2),
    "tablePct" DECIMAL(5,2),
    "depthPct" DECIMAL(5,2),
    "ratio" DECIMAL(5,3),
    "growthMethod" "GrowthMethod" NOT NULL DEFAULT 'UNKNOWN',
    "growthType" TEXT,
    "shade" TEXT,
    "milky" TEXT,
    "eyeClean" TEXT,
    "luster" TEXT,
    "rapPrice" DECIMAL(12,2),
    "discountPct" DECIMAL(6,2),
    "pricePerCarat" DECIMAL(12,2) NOT NULL,
    "totalPrice" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "location" TEXT,
    "remarks" TEXT,
    "status" "DiamondStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Diamond_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingRule" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "mode" "PricingMode" NOT NULL DEFAULT 'BASE',
    "adjustPct" DECIMAL(6,2),
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartItem" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "diamondId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enquiry" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "EnquiryStatus" NOT NULL DEFAULT 'NEW',
    "channel" TEXT NOT NULL DEFAULT 'app',
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Enquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnquiryItem" (
    "id" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "diamondId" TEXT NOT NULL,
    "pricePerCarat" DECIMAL(12,2) NOT NULL,
    "totalPrice" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "EnquiryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockUpload" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "rowsTotal" INTEGER NOT NULL,
    "rowsCreated" INTEGER NOT NULL,
    "rowsUpdated" INTEGER NOT NULL,
    "rowsFailed" INTEGER NOT NULL,
    "errorsJson" JSONB,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushToken" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'all',
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_mobile_key" ON "Customer"("mobile");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_email_key" ON "Customer"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Admin_email_key" ON "Admin"("email");

-- CreateIndex
CREATE INDEX "Otp_mobile_code_idx" ON "Otp"("mobile", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Diamond_stoneId_key" ON "Diamond"("stoneId");

-- CreateIndex
CREATE UNIQUE INDEX "Diamond_certificateNo_key" ON "Diamond"("certificateNo");

-- CreateIndex
CREATE INDEX "Diamond_status_idx" ON "Diamond"("status");

-- CreateIndex
CREATE INDEX "Diamond_shape_color_clarity_idx" ON "Diamond"("shape", "color", "clarity");

-- CreateIndex
CREATE INDEX "Diamond_carat_idx" ON "Diamond"("carat");

-- CreateIndex
CREATE INDEX "Diamond_pricePerCarat_idx" ON "Diamond"("pricePerCarat");

-- CreateIndex
CREATE UNIQUE INDEX "PricingRule_customerId_key" ON "PricingRule"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_customerId_diamondId_key" ON "CartItem"("customerId", "diamondId");

-- CreateIndex
CREATE UNIQUE INDEX "PushToken_token_key" ON "PushToken"("token");

-- AddForeignKey
ALTER TABLE "Otp" ADD CONSTRAINT "Otp_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_diamondId_fkey" FOREIGN KEY ("diamondId") REFERENCES "Diamond"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnquiryItem" ADD CONSTRAINT "EnquiryItem_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnquiryItem" ADD CONSTRAINT "EnquiryItem_diamondId_fkey" FOREIGN KEY ("diamondId") REFERENCES "Diamond"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
