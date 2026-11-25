-- M14 Rev 2 §10: piece-length custom-bar rule (Puja Rev 3 indent, 300 m). Additive.
ALTER TABLE "plan_settings" ADD COLUMN "custom_min_metres" INTEGER NOT NULL DEFAULT 0;
UPDATE "plan_settings" SET "custom_min_metres" = 300 WHERE "id" = 1;
