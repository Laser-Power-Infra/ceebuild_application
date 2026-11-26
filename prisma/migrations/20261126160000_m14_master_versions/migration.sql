-- Rev 2 §6: effective-dated values for sections, machines and planning settings.
-- One row = one field of one master record from a date (future or back-dated). The live row in the
-- master table always holds the value as on today; costing "as on <date>" reads these versions.
CREATE TABLE IF NOT EXISTS "master_versions" (
  "id" SERIAL PRIMARY KEY,
  "table_name" TEXT NOT NULL,
  "record_key" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "value" TEXT,
  "valid_from" DATE NOT NULL,
  "applied" BOOLEAN NOT NULL DEFAULT TRUE,
  "reason" TEXT,
  "changed_by_id" INTEGER,
  "changed_by_name" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "master_versions_table_chk" CHECK ("table_name" IN ('section_master', 'machines', 'plan_settings'))
);
CREATE INDEX IF NOT EXISTS "master_versions_lookup_idx" ON "master_versions" ("table_name", "record_key", "field", "valid_from");
CREATE INDEX IF NOT EXISTS "master_versions_due_idx" ON "master_versions" ("applied", "valid_from") WHERE NOT "applied";
