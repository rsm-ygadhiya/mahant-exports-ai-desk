CREATE TYPE "ScheduleFrequency" AS ENUM ('DAILY','WEEKLY','CUSTOM');

CREATE TABLE "PricingSchedule" (
  "id"              TEXT NOT NULL DEFAULT 'default',
  "enabled"         BOOLEAN NOT NULL DEFAULT false,
  "frequency"       "ScheduleFrequency" NOT NULL DEFAULT 'DAILY',
  "timeOfDay"       TEXT NOT NULL DEFAULT '02:00',
  "dayOfWeek"       INTEGER NOT NULL DEFAULT 1,
  "customCron"      TEXT,
  "mode"            TEXT NOT NULL DEFAULT 'heuristic',
  "rapDiscountPct"  NUMERIC(5,2) NOT NULL DEFAULT 95,
  "skipIfRecentHrs" INTEGER NOT NULL DEFAULT 20,
  "lastRunAt"       TIMESTAMP(3),
  "lastRunId"       TEXT,
  "lastRunStatus"   TEXT,
  "lastError"       TEXT,
  "nextRunAt"       TIMESTAMP(3),
  "updatedBy"       TEXT,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PricingSchedule_pkey" PRIMARY KEY ("id")
);
