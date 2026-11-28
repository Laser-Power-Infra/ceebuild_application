-- C6 (Puja 28-11): where an item price came from. COSTING = applied BOM costing, MANUAL = typed,
-- shown as "manual – not system costed" and needs an Admin's approval. Additive only.
ALTER TABLE "iteam-table" ADD COLUMN IF NOT EXISTS "price_source" TEXT;
ALTER TABLE "iteam-table" ADD COLUMN IF NOT EXISTS "price_approved_by" TEXT;
