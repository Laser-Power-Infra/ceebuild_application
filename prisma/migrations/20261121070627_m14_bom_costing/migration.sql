-- AlterTable
ALTER TABLE "bom_uploads" ADD COLUMN     "source" TEXT;

-- CreateTable
CREATE TABLE "rm_purchase_items" (
    "id" SERIAL NOT NULL,
    "section_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rm_purchase_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_rates" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT 'DEFAULT',
    "value" DECIMAL(14,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "source" TEXT,
    "created_by_id" INTEGER,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approved_drawings" (
    "id" SERIAL NOT NULL,
    "utility" TEXT NOT NULL,
    "state" TEXT,
    "item_type" TEXT NOT NULL,
    "drawing_no" TEXT NOT NULL,
    "revision" TEXT NOT NULL DEFAULT '0',
    "approval_letter_no" TEXT,
    "approval_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "file_link" TEXT,
    "remarks" TEXT,
    "from_item_bom_id" INTEGER,
    "created_by_id" INTEGER,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approved_drawings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approved_drawing_lines" (
    "id" SERIAL NOT NULL,
    "drawing_id" INTEGER NOT NULL,
    "row_no" INTEGER NOT NULL,
    "mark_no" TEXT,
    "description" TEXT,
    "section" TEXT,
    "section_key" TEXT,
    "length_mm" INTEGER,
    "qty_per_set" DECIMAL(14,3),
    "kg_per_m" DECIMAL(10,3),
    "unit_wt_kg" DECIMAL(14,3),
    "category" TEXT NOT NULL DEFAULT 'STRUCTURE',
    "rate_key" TEXT,

    CONSTRAINT "approved_drawing_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_boms" (
    "id" SERIAL NOT NULL,
    "item_id" INTEGER NOT NULL,
    "docket_id" INTEGER,
    "source" TEXT NOT NULL,
    "drawing_id" INTEGER,
    "drawing_ref" TEXT,
    "match_level" TEXT,
    "file_name" TEXT,
    "s3_key" TEXT,
    "structure_type" TEXT,
    "fab_type" TEXT NOT NULL DEFAULT 'PLAIN_CUT',
    "galvanised" BOOLEAN NOT NULL DEFAULT true,
    "billing_basis" TEXT NOT NULL DEFAULT 'GALV',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "extract_note" TEXT,
    "created_by_id" INTEGER,
    "created_by_name" TEXT,
    "confirmed_by_name" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_boms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_bom_lines" (
    "id" SERIAL NOT NULL,
    "bom_id" INTEGER NOT NULL,
    "row_no" INTEGER NOT NULL,
    "mark_no" TEXT,
    "description" TEXT,
    "section" TEXT,
    "section_key" TEXT,
    "length_mm" INTEGER,
    "qty_per_set" DECIMAL(14,3),
    "kg_per_m" DECIMAL(10,3),
    "unit_wt_kg" DECIMAL(14,3),
    "category" TEXT NOT NULL DEFAULT 'STRUCTURE',
    "scope" TEXT NOT NULL DEFAULT 'IN_SCOPE',
    "non_billable" BOOLEAN NOT NULL DEFAULT false,
    "rate_key" TEXT,

    CONSTRAINT "item_bom_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_costings" (
    "id" SERIAL NOT NULL,
    "bom_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "docket_id" INTEGER,
    "quote_date" DATE NOT NULL,
    "va_pct" DECIMAL(8,3) NOT NULL,
    "billing_basis" TEXT NOT NULL,
    "sets" DECIMAL(14,3) NOT NULL,
    "black_wt_kg" DECIMAL(16,3) NOT NULL,
    "galv_wt_kg" DECIMAL(16,3) NOT NULL,
    "cost_total" DECIMAL(16,2) NOT NULL,
    "sell_total" DECIMAL(16,2) NOT NULL,
    "sell_per_kg" DECIMAL(12,2) NOT NULL,
    "sell_per_set" DECIMAL(14,2) NOT NULL,
    "nb_sell_total" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "bo_sell_total" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "detail" JSONB NOT NULL,
    "flags" JSONB NOT NULL,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "applied_at" TIMESTAMP(3),
    "created_by_id" INTEGER,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_costings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rm_purchase_items_section_key_key" ON "rm_purchase_items"("section_key");

-- CreateIndex
CREATE INDEX "cost_rates_kind_subject_effective_from_idx" ON "cost_rates"("kind", "subject", "effective_from");

-- CreateIndex
CREATE INDEX "approved_drawings_item_type_idx" ON "approved_drawings"("item_type");

-- CreateIndex
CREATE UNIQUE INDEX "approved_drawings_drawing_no_revision_key" ON "approved_drawings"("drawing_no", "revision");

-- CreateIndex
CREATE INDEX "approved_drawing_lines_drawing_id_idx" ON "approved_drawing_lines"("drawing_id");

-- CreateIndex
CREATE INDEX "item_boms_item_id_idx" ON "item_boms"("item_id");

-- CreateIndex
CREATE INDEX "item_boms_docket_id_idx" ON "item_boms"("docket_id");

-- CreateIndex
CREATE INDEX "item_bom_lines_bom_id_idx" ON "item_bom_lines"("bom_id");

-- CreateIndex
CREATE INDEX "item_costings_item_id_idx" ON "item_costings"("item_id");

-- CreateIndex
CREATE INDEX "item_costings_docket_id_idx" ON "item_costings"("docket_id");

-- AddForeignKey
ALTER TABLE "approved_drawing_lines" ADD CONSTRAINT "approved_drawing_lines_drawing_id_fkey" FOREIGN KEY ("drawing_id") REFERENCES "approved_drawings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_boms" ADD CONSTRAINT "item_boms_drawing_id_fkey" FOREIGN KEY ("drawing_id") REFERENCES "approved_drawings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_bom_lines" ADD CONSTRAINT "item_bom_lines_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "item_boms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_costings" ADD CONSTRAINT "item_costings_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "item_boms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
