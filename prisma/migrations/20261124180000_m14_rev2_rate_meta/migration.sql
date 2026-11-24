-- M14 Rev 2 (24-Nov-2026) §4.1: Costing Master rate metadata. Additive only (nullable columns).
-- Back up first: pg_dump -Fc -f backups/live-before-m14-rev2-<yyyymmdd-hhmm>.dump

ALTER TABLE "cost_rates" ADD COLUMN "rate_type" TEXT;
ALTER TABLE "cost_rates" ADD COLUMN "supplier" TEXT;
ALTER TABLE "cost_rates" ADD COLUMN "valid_to" DATE;
ALTER TABLE "cost_rates" ADD COLUMN "update_freq_days" INTEGER;
ALTER TABLE "cost_rates" ADD COLUMN "owner" TEXT;

ALTER TABLE "cost_rates" ADD CONSTRAINT "cost_rates_rate_type_chk"
  CHECK ("rate_type" IS NULL OR "rate_type" IN ('ESTIMATE', 'QUOTE', 'PO', 'GRN', 'ACTUAL'));

-- Rates loaded on 23-Nov as "INTERIM ..." are estimates.
UPDATE "cost_rates" SET "rate_type" = 'ESTIMATE' WHERE "rate_type" IS NULL AND "source" ~* '^\s*INTERIM\M';
