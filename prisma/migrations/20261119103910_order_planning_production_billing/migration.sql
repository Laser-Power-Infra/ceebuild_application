-- AlterTable
ALTER TABLE "dispatches" ADD COLUMN     "eway_bill_no" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "contract_value" DECIMAL(16,2),
ADD COLUMN     "delivery_due" DATE;

-- AlterTable
ALTER TABLE "section_master" ADD COLUMN     "max_bar_mm" INTEGER;

-- CreateTable
CREATE TABLE "plan_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "std_bar_mm" INTEGER NOT NULL DEFAULT 6000,
    "max_custom_mm" INTEGER NOT NULL DEFAULT 6000,
    "end_allowance_mm" INTEGER NOT NULL DEFAULT 0,
    "kerf_mm" INTEGER NOT NULL DEFAULT 0,
    "tol_plus_mm" INTEGER NOT NULL DEFAULT 20,
    "buffer_pct" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "min_offcut_mm" INTEGER NOT NULL DEFAULT 300,
    "custom_min_bars" INTEGER NOT NULL DEFAULT 5,
    "bom_due_days" INTEGER NOT NULL DEFAULT 7,
    "galv_alert_days" INTEGER NOT NULL DEFAULT 7,
    "di_alert_days" INTEGER NOT NULL DEFAULT 7,
    "payment_terms_days" INTEGER NOT NULL DEFAULT 30,
    "work_days_per_week" INTEGER NOT NULL DEFAULT 6,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "updated_by_name" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rm_indents" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "indent_no" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PRIMARY',
    "strategy" TEXT NOT NULL DEFAULT 'MIXED',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "bom_upload_id" INTEGER,
    "settings" JSONB NOT NULL,
    "comparison" JSONB,
    "plan" JSONB,
    "total_bars" INTEGER NOT NULL DEFAULT 0,
    "total_wt_kg" DECIMAL(16,3) NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "created_by_id" INTEGER,
    "created_by_name" TEXT,
    "issued_by_name" TEXT,
    "issued_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rm_indents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rm_indent_lines" (
    "id" SERIAL NOT NULL,
    "indent_id" INTEGER NOT NULL,
    "section_key" TEXT NOT NULL,
    "section_label" TEXT,
    "bar_length_mm" INTEGER NOT NULL,
    "line_type" TEXT NOT NULL,
    "for_mark" TEXT,
    "pieces_per_bar" INTEGER,
    "bars" INTEGER NOT NULL,
    "buffer_bars" INTEGER NOT NULL DEFAULT 0,
    "kg_per_m" DECIMAL(10,3),
    "wt_kg" DECIMAL(16,3),

    CONSTRAINT "rm_indent_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rm_receipts" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "indent_id" INTEGER,
    "receipt_no" TEXT NOT NULL,
    "receipt_date" DATE NOT NULL,
    "supplier" TEXT,
    "invoice_no" TEXT,
    "remarks" TEXT,
    "created_by_id" INTEGER,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rm_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rm_receipt_lots" (
    "id" SERIAL NOT NULL,
    "receipt_id" INTEGER NOT NULL,
    "section_key" TEXT NOT NULL,
    "section_label" TEXT,
    "ordered_length_mm" INTEGER NOT NULL,
    "measured_length_mm" INTEGER NOT NULL,
    "nos" INTEGER NOT NULL,
    "wt_kg" DECIMAL(14,3),
    "heat_no" TEXT,
    "length_status" TEXT NOT NULL,
    "decision" TEXT NOT NULL DEFAULT 'ACCEPTED',
    "debit_note_no" TEXT,
    "remarks" TEXT,

    CONSTRAINT "rm_receipt_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cutting_plans" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "settings" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "pieces_planned" INTEGER NOT NULL DEFAULT 0,
    "pieces_short" INTEGER NOT NULL DEFAULT 0,
    "offcuts" INTEGER NOT NULL DEFAULT 0,
    "supplementary_indent_id" INTEGER,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cutting_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machines" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 1,
    "rate_per_hour" DECIMAL(10,2) NOT NULL,
    "rate_unit" TEXT NOT NULL,
    "shifts_per_day" INTEGER NOT NULL DEFAULT 1,
    "hours_per_shift" DECIMAL(4,2) NOT NULL DEFAULT 8,
    "utilisation_pct" DECIMAL(5,2) NOT NULL DEFAULT 75,
    "rate_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "machines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "piece_routings" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "mark_no" TEXT NOT NULL,
    "cut_op" TEXT NOT NULL DEFAULT 'SHEARING',
    "holes" INTEGER NOT NULL DEFAULT 0,
    "notches" INTEGER NOT NULL DEFAULT 0,
    "bends" INTEGER NOT NULL DEFAULT 0,
    "welds" INTEGER NOT NULL DEFAULT 0,
    "threads" INTEGER NOT NULL DEFAULT 0,
    "numbering" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_name" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "piece_routings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_entries" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "entry_date" DATE NOT NULL,
    "shift" TEXT NOT NULL DEFAULT 'A',
    "machine_id" INTEGER NOT NULL,
    "operation" TEXT NOT NULL,
    "mark_no" TEXT NOT NULL,
    "pieces" INTEGER NOT NULL,
    "operator_name" TEXT,
    "remarks" TEXT,
    "created_by_id" INTEGER,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stage_inspections" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "inspection_date" DATE NOT NULL,
    "stage" TEXT NOT NULL,
    "mark_no" TEXT,
    "pieces_offered" INTEGER NOT NULL,
    "pieces_accepted" INTEGER NOT NULL,
    "pieces_rejected" INTEGER NOT NULL DEFAULT 0,
    "inspector" TEXT,
    "remarks" TEXT,
    "created_by_id" INTEGER,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stage_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "dispatch_id" INTEGER,
    "invoice_no" TEXT NOT NULL,
    "invoice_date" DATE NOT NULL,
    "wt_kg" DECIMAL(14,3),
    "taxable_amount" DECIMAL(16,2),
    "total_amount" DECIMAL(16,2) NOT NULL,
    "due_date" DATE,
    "remarks" TEXT,
    "created_by_id" INTEGER,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "invoice_id" INTEGER,
    "receipt_date" DATE NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'RTGS',
    "reference" TEXT,
    "retention" DECIMAL(16,2),
    "remarks" TEXT,
    "created_by_id" INTEGER,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_securities" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "ref_no" TEXT,
    "bank" TEXT,
    "amount" DECIMAL(16,2) NOT NULL,
    "issue_date" DATE,
    "expiry_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "released_date" DATE,
    "remarks" TEXT,
    "created_by_id" INTEGER,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_securities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rm_indents_indent_no_key" ON "rm_indents"("indent_no");

-- CreateIndex
CREATE INDEX "rm_indents_order_id_idx" ON "rm_indents"("order_id");

-- CreateIndex
CREATE INDEX "rm_indent_lines_indent_id_idx" ON "rm_indent_lines"("indent_id");

-- CreateIndex
CREATE UNIQUE INDEX "rm_receipts_order_id_receipt_no_key" ON "rm_receipts"("order_id", "receipt_no");

-- CreateIndex
CREATE INDEX "rm_receipt_lots_receipt_id_idx" ON "rm_receipt_lots"("receipt_id");

-- CreateIndex
CREATE INDEX "cutting_plans_order_id_idx" ON "cutting_plans"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "machines_code_key" ON "machines"("code");

-- CreateIndex
CREATE UNIQUE INDEX "piece_routings_order_id_mark_no_key" ON "piece_routings"("order_id", "mark_no");

-- CreateIndex
CREATE INDEX "production_entries_order_id_mark_no_idx" ON "production_entries"("order_id", "mark_no");

-- CreateIndex
CREATE INDEX "production_entries_entry_date_idx" ON "production_entries"("entry_date");

-- CreateIndex
CREATE INDEX "stage_inspections_order_id_idx" ON "stage_inspections"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_no_key" ON "invoices"("invoice_no");

-- CreateIndex
CREATE INDEX "invoices_order_id_idx" ON "invoices"("order_id");

-- CreateIndex
CREATE INDEX "collections_order_id_idx" ON "collections"("order_id");

-- CreateIndex
CREATE INDEX "collections_invoice_id_idx" ON "collections"("invoice_id");

-- CreateIndex
CREATE INDEX "order_securities_order_id_idx" ON "order_securities"("order_id");

-- AddForeignKey
ALTER TABLE "rm_indents" ADD CONSTRAINT "rm_indents_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rm_indent_lines" ADD CONSTRAINT "rm_indent_lines_indent_id_fkey" FOREIGN KEY ("indent_id") REFERENCES "rm_indents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rm_receipts" ADD CONSTRAINT "rm_receipts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rm_receipts" ADD CONSTRAINT "rm_receipts_indent_id_fkey" FOREIGN KEY ("indent_id") REFERENCES "rm_indents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rm_receipt_lots" ADD CONSTRAINT "rm_receipt_lots_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "rm_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_plans" ADD CONSTRAINT "cutting_plans_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_routings" ADD CONSTRAINT "piece_routings_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_entries" ADD CONSTRAINT "production_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_entries" ADD CONSTRAINT "production_entries_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_inspections" ADD CONSTRAINT "stage_inspections_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_dispatch_id_fkey" FOREIGN KEY ("dispatch_id") REFERENCES "dispatches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_securities" ADD CONSTRAINT "order_securities_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Integrity checks (enum-like text columns and non-negative quantities).
-- ---------------------------------------------------------------------------
ALTER TABLE "plan_settings" ADD CONSTRAINT "plan_settings_single_row" CHECK ("id" = 1);
ALTER TABLE "plan_settings" ADD CONSTRAINT "plan_settings_positive" CHECK (
  "std_bar_mm" > 0 AND "max_custom_mm" > 0 AND "end_allowance_mm" >= 0 AND "kerf_mm" >= 0
  AND "tol_plus_mm" >= 0 AND "buffer_pct" >= 0 AND "min_offcut_mm" >= 0 AND "custom_min_bars" >= 1);
ALTER TABLE "rm_indents" ADD CONSTRAINT "rm_indents_kind_chk" CHECK ("kind" IN ('PRIMARY', 'SUPPLEMENTARY'));
ALTER TABLE "rm_indents" ADD CONSTRAINT "rm_indents_strategy_chk" CHECK ("strategy" IN ('MIXED', 'STANDARD'));
ALTER TABLE "rm_indents" ADD CONSTRAINT "rm_indents_status_chk" CHECK ("status" IN ('DRAFT', 'ISSUED', 'CANCELLED'));
ALTER TABLE "rm_indent_lines" ADD CONSTRAINT "rm_indent_lines_chk" CHECK (
  "line_type" IN ('CUSTOM', 'STANDARD', 'OVERLENGTH') AND "bar_length_mm" > 0 AND "bars" >= 0 AND "buffer_bars" >= 0);
ALTER TABLE "rm_receipt_lots" ADD CONSTRAINT "rm_receipt_lots_chk" CHECK (
  "length_status" IN ('OK', 'SHORT', 'OVER_TOL') AND "decision" IN ('ACCEPTED', 'REJECTED', 'DEBIT_NOTE')
  AND "ordered_length_mm" > 0 AND "measured_length_mm" > 0 AND "nos" > 0);
ALTER TABLE "machines" ADD CONSTRAINT "machines_chk" CHECK (
  "operation" IN ('CROPPING', 'SHEARING', 'PUNCHING', 'NOTCHING', 'BENDING', 'WELDING', 'NUMBERING', 'THREADING')
  AND "units" >= 1 AND "rate_per_hour" > 0 AND "shifts_per_day" BETWEEN 0 AND 3
  AND "hours_per_shift" > 0 AND "utilisation_pct" > 0 AND "utilisation_pct" <= 100);
ALTER TABLE "piece_routings" ADD CONSTRAINT "piece_routings_chk" CHECK (
  "cut_op" IN ('CROPPING', 'SHEARING', 'NONE') AND "holes" >= 0 AND "notches" >= 0 AND "bends" >= 0 AND "welds" >= 0 AND "threads" >= 0);
ALTER TABLE "production_entries" ADD CONSTRAINT "production_entries_chk" CHECK ("pieces" > 0 AND "shift" IN ('A', 'B', 'C'));
ALTER TABLE "stage_inspections" ADD CONSTRAINT "stage_inspections_chk" CHECK (
  "pieces_offered" > 0 AND "pieces_accepted" >= 0 AND "pieces_rejected" >= 0
  AND "pieces_accepted" + "pieces_rejected" <= "pieces_offered");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amount_chk" CHECK ("total_amount" >= 0);
ALTER TABLE "collections" ADD CONSTRAINT "collections_chk" CHECK ("amount" > 0 AND "mode" IN ('RTGS', 'LC', 'CHEQUE', 'OTHER'));
ALTER TABLE "order_securities" ADD CONSTRAINT "order_securities_chk" CHECK (
  "kind" IN ('PBG', 'ABG', 'LC', 'RETENTION', 'SD') AND "status" IN ('ACTIVE', 'RELEASED', 'CLAIMED') AND "amount" >= 0);

-- ---------------------------------------------------------------------------
-- Seed: planning defaults (to be confirmed by the plant) and the Ceebuild List of Machinery.
-- Rates are indicative placeholders (rate_confirmed = false) until the plant gives real ones.
-- ---------------------------------------------------------------------------
INSERT INTO "plan_settings" ("id") VALUES (1) ON CONFLICT DO NOTHING;

INSERT INTO "machines" ("code", "name", "operation", "units", "rate_per_hour", "rate_unit", "shifts_per_day", "sort_order") VALUES
  ('UP-1',     'Universal cropping machine UP-1 (x2)', 'CROPPING',  2, 120, 'cuts',    1, 10),
  ('SH1',      'Shearing machine SH1',                 'SHEARING',  1, 150, 'cuts',    1, 20),
  ('PP1',      'Power press PP1 (shearing)',           'SHEARING',  1, 150, 'cuts',    1, 21),
  ('PP11',     'Power press PP11 (shearing)',          'SHEARING',  1, 150, 'cuts',    1, 22),
  ('PP2',      'Power press PP2 (punching)',           'PUNCHING',  1, 400, 'holes',   1, 30),
  ('PP4',      'Power press PP4 (punching)',           'PUNCHING',  1, 400, 'holes',   1, 31),
  ('PP5',      'Power press PP5 (punching)',           'PUNCHING',  1, 400, 'holes',   1, 32),
  ('PP8',      'Power press PP8 (punching)',           'PUNCHING',  1, 400, 'holes',   1, 33),
  ('PP9',      'Power press PP9 (punching)',           'PUNCHING',  1, 400, 'holes',   1, 34),
  ('PP12',     'Power press PP12 (punching)',          'PUNCHING',  1, 400, 'holes',   1, 35),
  ('PP14',     'Power press PP14 (punching)',          'PUNCHING',  1, 400, 'holes',   1, 36),
  ('PP7',      'Power press PP7 (notching)',           'NOTCHING',  1, 120, 'notches', 1, 40),
  ('BULL',     'Bull notching machine',                'NOTCHING',  1, 120, 'notches', 1, 41),
  ('PP3',      'Power press PP3 (bending)',            'BENDING',   1,  60, 'bends',   1, 50),
  ('PP13',     'Power press PP13 (bending)',           'BENDING',   1,  60, 'bends',   1, 51),
  ('W1',       'Welding set W1',                       'WELDING',   1,  20, 'joints',  1, 60),
  ('W2',       'Welding set W2',                       'WELDING',   1,  20, 'joints',  1, 61),
  ('AR1',      'Arc welding AR1',                      'WELDING',   1,  20, 'joints',  1, 62),
  ('PP6',      'Power press PP6 (numbering)',          'NUMBERING', 1, 200, 'pieces',  1, 70),
  ('PP10',     'Power press PP10 (numbering)',         'NUMBERING', 1, 200, 'pieces',  1, 71),
  ('HYD-PRESS','Hydraulic press (numbering)',          'NUMBERING', 1, 200, 'pieces',  1, 72),
  ('LN1',      'Threading machine LN1',                'THREADING', 1,  60, 'threads', 1, 80),
  ('LN2',      'Threading machine LN2',                'THREADING', 1,  60, 'threads', 1, 81)
ON CONFLICT ("code") DO NOTHING;
