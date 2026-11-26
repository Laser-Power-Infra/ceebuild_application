-- M14 fabrication drawings, part 2 (26-Nov-2026): geometry the BOM lacks (holes, slots, bends,
-- welds, notches) per mark, entered once per approved drawing and reused; production confirmation
-- of a drawing set (items ticked) and the cutting-gate override log. Additive only.

CREATE TABLE IF NOT EXISTS "drawing_features" (
    "id" SERIAL PRIMARY KEY,
    "item_bom_id" INTEGER REFERENCES "item_boms"("id") ON DELETE CASCADE,
    "drawing_id" INTEGER,
    "mark_no" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "positions" TEXT,
    "dia_mm" DECIMAL(8,2),
    "offset_mm" DECIMAL(8,2),
    "face" TEXT,
    "count" INTEGER,
    "bend_angle" DECIMAL(6,2),
    "bend_radius" DECIMAL(8,2),
    "weld_type" TEXT,
    "weld_size" DECIMAL(6,2),
    "weld_length" DECIMAL(8,2),
    "weld_pitch" DECIMAL(8,2),
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "to_confirm" BOOLEAN NOT NULL DEFAULT FALSE,
    "note" TEXT,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "drawing_features_kind_chk" CHECK ("kind" IN ('HOLE', 'SLOT', 'BEND', 'WELD', 'NOTCH')),
    CONSTRAINT "drawing_features_source_chk" CHECK ("source" IN ('DRAWING', 'STANDARD', 'MANUAL')),
    CONSTRAINT "drawing_features_link_chk" CHECK ("item_bom_id" IS NOT NULL OR "drawing_id" IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS "drawing_features_item_bom_idx" ON "drawing_features" ("item_bom_id");
CREATE INDEX IF NOT EXISTS "drawing_features_drawing_idx" ON "drawing_features" ("drawing_id", "mark_no");

-- Production confirmation: which "to be confirmed" points were ticked.
ALTER TABLE "fab_drawing_sets" ADD COLUMN IF NOT EXISTS "confirmed_items" JSONB;
