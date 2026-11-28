-- Order cancellation (Puja 28-11-2026): Cancelled / Superseded status, reason, replacing PO,
-- partial cancellation (MT). Additive only.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cancel_status" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cancel_reason" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cancel_note" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cancel_date" DATE;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "replaced_by_order_id" INTEGER;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cancelled_by_name" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cancelled_mt" DECIMAL(12,3);
