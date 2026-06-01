-- Add NOT_LIVE to the DiamondStatus enum. Postgres lets us extend an existing enum.
ALTER TYPE "DiamondStatus" ADD VALUE IF NOT EXISTS 'NOT_LIVE';
