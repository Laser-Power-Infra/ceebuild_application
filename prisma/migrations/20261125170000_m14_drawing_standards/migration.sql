-- M14 (25-Nov-2026): fabrication drawings – drawing standards master (Admin-editable rules used
-- when the BOM / approved drawing has no geometry). Additive only. Seed = DEFAULT_STANDARDS in
-- src/lib/fabdrawing/standards.ts (tests/fabDrawings.test.ts checks the two match).

CREATE TABLE "drawing_standards" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "num_value" DECIMAL(12,3),
    "text_value" TEXT,
    "unit" TEXT,
    "note" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drawing_standards_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "drawing_standards_chk" CHECK (
      "kind" IN ('HOLE', 'GAUGE', 'EDGE', 'WELD', 'FINISH', 'MATERIAL', 'TOLERANCE', 'MARKING')
      AND ("num_value" IS NOT NULL OR "text_value" IS NOT NULL))
);

CREATE UNIQUE INDEX "drawing_standards_kind_key_key" ON "drawing_standards"("kind", "key");

INSERT INTO "drawing_standards" ("kind", "key", "num_value", "text_value", "unit", "note", "sort_order") VALUES
  ('HOLE', 'CLEARANCE', 1.5, NULL, 'mm', 'Hole dia = bolt dia + this (IS 800 normal clearance)', 10),
  ('HOLE', 'METHOD', NULL, 'PUNCHED', NULL, 'Holes punched, not gas-cut', 11),
  ('GAUGE', 'LEG_40', 22, NULL, 'mm', 'Gauge from heel for a 40 mm leg (IS SP:6)', 20),
  ('GAUGE', 'LEG_45', 25, NULL, 'mm', 'Gauge from heel for a 45 mm leg (IS SP:6)', 21),
  ('GAUGE', 'LEG_50', 28, NULL, 'mm', 'Gauge from heel for a 50 mm leg (IS SP:6)', 22),
  ('GAUGE', 'LEG_55', 30, NULL, 'mm', 'Gauge from heel for a 55 mm leg (IS SP:6)', 23),
  ('GAUGE', 'LEG_60', 35, NULL, 'mm', 'Gauge from heel for a 60 mm leg (IS SP:6)', 24),
  ('GAUGE', 'LEG_65', 35, NULL, 'mm', 'Gauge from heel for a 65 mm leg (IS SP:6)', 25),
  ('GAUGE', 'LEG_70', 40, NULL, 'mm', 'Gauge from heel for a 70 mm leg (IS SP:6)', 26),
  ('GAUGE', 'LEG_75', 40, NULL, 'mm', 'Gauge from heel for a 75 mm leg (IS SP:6)', 27),
  ('GAUGE', 'LEG_80', 45, NULL, 'mm', 'Gauge from heel for a 80 mm leg (IS SP:6)', 28),
  ('GAUGE', 'LEG_90', 50, NULL, 'mm', 'Gauge from heel for a 90 mm leg (IS SP:6)', 29),
  ('GAUGE', 'LEG_100', 55, NULL, 'mm', 'Gauge from heel for a 100 mm leg (IS SP:6)', 30),
  ('EDGE', 'FACTOR', 1.5, NULL, 'x hole dia', 'Minimum edge / end distance = factor x hole dia', 40),
  ('EDGE', 'FLAT_50', 25, NULL, 'mm', 'End distance used on 50 mm wide flats (centre line of the flat)', 41),
  ('WELD', 'MESH_TACK_LENGTH', 25, NULL, 'mm', 'Wire mesh tack weld length', 50),
  ('WELD', 'MESH_TACK_PITCH', 150, NULL, 'mm', 'Wire mesh tack weld pitch (c/c)', 51),
  ('WELD', 'STRIP_FILLET', 4, NULL, 'mm', 'Strip-to-rail fillet weld size, both sides', 52),
  ('FINISH', 'PAINT', NULL, 'Remove weld spatter, wire-brush / clean, 1 coat red-oxide primer + 2 coats enamel (shade as per approved drawing).', NULL, NULL, 60),
  ('FINISH', 'HDG', NULL, 'Hot-dip galvanised to IS 2629 after fabrication (no paint).', NULL, NULL, 61),
  ('FINISH', 'BLACK', NULL, 'Supplied black (no finish) unless the order says otherwise.', NULL, NULL, 62),
  ('MATERIAL', 'STEEL', NULL, 'Material IS 2062 E250A.', NULL, NULL, 70),
  ('MATERIAL', 'WELDING', NULL, 'Welding to IS 816 (E6013 electrodes).', NULL, NULL, 71),
  ('TOLERANCE', 'LENGTH', NULL, 'Tolerances as approved drawing; else up to 50 mm ±5%, 51-100 ±4%, 101-300 ±3%, above 300 ±2%.', NULL, NULL, 80),
  ('MARKING', 'ERECTION', NULL, 'Punch the erection mark on each member / assembly.', NULL, NULL, 90)
ON CONFLICT ("kind", "key") DO NOTHING;
