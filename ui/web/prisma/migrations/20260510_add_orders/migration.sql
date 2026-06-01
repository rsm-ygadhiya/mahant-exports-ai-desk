-- Enums
CREATE TYPE "OrderStatus"    AS ENUM ('DRAFT','CONFIRMED','CANCELLED');
CREATE TYPE "PaymentMethod"  AS ENUM ('BANK_TRANSFER','CASH','CHEQUE','UPI','OTHER');
CREATE TYPE "PaymentStatus"  AS ENUM ('PENDING_CASH_APPROVAL','CONFIRMED','REJECTED');
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING','SENT','FAILED','CANCELLED');

-- Order
CREATE TABLE "Order" (
  "id"               TEXT NOT NULL,
  "orderCode"        TEXT NOT NULL,
  "customerId"       TEXT NOT NULL,
  "status"           "OrderStatus" NOT NULL DEFAULT 'DRAFT',
  "totalAmount"      NUMERIC(14,2) NOT NULL,
  "currency"         TEXT NOT NULL DEFAULT 'USD',
  "dueDate"          TIMESTAMP(3),
  "notes"            TEXT,
  "remindersEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdBy"        TEXT NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt"      TIMESTAMP(3),
  "cancelledAt"      TIMESTAMP(3),
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Order_orderCode_key" ON "Order"("orderCode");
CREATE INDEX "Order_customerId_idx"        ON "Order"("customerId");
CREATE INDEX "Order_status_idx"            ON "Order"("status");
CREATE INDEX "Order_createdAt_idx"         ON "Order"("createdAt");
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- OrderItem
CREATE TABLE "OrderItem" (
  "id"            TEXT NOT NULL,
  "orderId"       TEXT NOT NULL,
  "diamondId"     TEXT NOT NULL,
  "pricePerCarat" NUMERIC(12,2) NOT NULL,
  "totalPrice"    NUMERIC(14,2) NOT NULL,
  CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OrderItem_orderId_idx"   ON "OrderItem"("orderId");
CREATE INDEX "OrderItem_diamondId_idx" ON "OrderItem"("diamondId");
ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_diamondId_fkey"
  FOREIGN KEY ("diamondId") REFERENCES "Diamond"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Payment
CREATE TABLE "Payment" (
  "id"              TEXT NOT NULL,
  "orderId"         TEXT NOT NULL,
  "amount"          NUMERIC(14,2) NOT NULL,
  "method"          "PaymentMethod" NOT NULL,
  "status"          "PaymentStatus" NOT NULL,
  "transactionRef"  TEXT,
  "notes"           TEXT,
  "approvalHash"    TEXT,
  "rejectionReason" TEXT,
  "recordedBy"      TEXT NOT NULL,
  "recordedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedBy"     TEXT,
  "confirmedAt"     TIMESTAMP(3),
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");
CREATE INDEX "Payment_status_idx"  ON "Payment"("status");
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PaymentReminder
CREATE TABLE "PaymentReminder" (
  "id"           TEXT NOT NULL,
  "orderId"      TEXT NOT NULL,
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "status"       "ReminderStatus" NOT NULL DEFAULT 'PENDING',
  "channel"      TEXT NOT NULL DEFAULT 'sms',
  "message"      TEXT,
  "sentAt"       TIMESTAMP(3),
  "response"     TEXT,
  CONSTRAINT "PaymentReminder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PaymentReminder_orderId_idx"          ON "PaymentReminder"("orderId");
CREATE INDEX "PaymentReminder_scheduledFor_status_idx" ON "PaymentReminder"("scheduledFor","status");
ALTER TABLE "PaymentReminder"
  ADD CONSTRAINT "PaymentReminder_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
