-- AlterTable
ALTER TABLE "docket-party-name" ADD COLUMN IF NOT EXISTS "type" TEXT;
ALTER TABLE "docket-party-name" ADD COLUMN IF NOT EXISTS "attachments" TEXT;

-- AlterTable
ALTER TABLE "iteam-table" ADD COLUMN IF NOT EXISTS "section_mm" TEXT;
ALTER TABLE "iteam-table" ADD COLUMN IF NOT EXISTS "sectional_wt_kg_mtr" TEXT;
ALTER TABLE "iteam-table" ADD COLUMN IF NOT EXISTS "unit_wt_of_member_kg" TEXT;
