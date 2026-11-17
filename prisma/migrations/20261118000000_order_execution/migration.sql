-- CreateTable
CREATE TABLE "orders" (
    "id" SERIAL NOT NULL,
    "docket_id" INTEGER NOT NULL,
    "docket_no" TEXT,
    "po_number" TEXT NOT NULL,
    "po_date" DATE NOT NULL,
    "client" TEXT,
    "remarks" TEXT,
    "created_by_id" INTEGER,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_lines" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "source_item_id" INTEGER,
    "item_name" TEXT,
    "our_item_name" TEXT,
    "uom" TEXT,
    "qty" TEXT,
    "price" TEXT,
    "weight_per_piece" TEXT,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bom_uploads" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "file_name" TEXT NOT NULL,
    "s3_key" TEXT,
    "sheet_name" TEXT,
    "column_map" JSONB NOT NULL,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "uploaded_by_id" INTEGER,
    "uploaded_by_name" TEXT,
    "confirmed_by_id" INTEGER,
    "confirmed_by_name" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "override_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bom_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bom_pieces" (
    "id" SERIAL NOT NULL,
    "upload_id" INTEGER NOT NULL,
    "order_id" INTEGER NOT NULL,
    "row_no" INTEGER NOT NULL,
    "mark_no" TEXT,
    "description" TEXT,
    "section" TEXT,
    "section_key" TEXT,
    "length_mm" INTEGER,
    "qty_per_set" DECIMAL(14,3),
    "sets" DECIMAL(14,3),
    "total_qty" DECIMAL(14,3),
    "kg_per_m" DECIMAL(10,3),
    "unit_wt_kg" DECIMAL(14,3),
    "total_wt_kg" DECIMAL(16,3),
    "raw" JSONB,
    "flag_mark_length" BOOLEAN NOT NULL DEFAULT false,
    "flag_blank_qty" BOOLEAN NOT NULL DEFAULT false,
    "flag_kgm" BOOLEAN NOT NULL DEFAULT false,
    "flag_fractional_sets" BOOLEAN NOT NULL DEFAULT false,
    "flag_section" BOOLEAN NOT NULL DEFAULT false,
    "issues" TEXT,

    CONSTRAINT "bom_pieces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "section_master" (
    "id" SERIAL NOT NULL,
    "section_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kg_per_m" DECIMAL(10,3) NOT NULL,
    "grade" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "section_master_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "galv_challans" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "challan_no" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "challan_date" DATE NOT NULL,
    "job_worker" TEXT,
    "black_wt_kg" DECIMAL(14,3),
    "galv_wt_kg" DECIMAL(14,3),
    "remarks" TEXT,
    "created_by_id" INTEGER,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "galv_challans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "galv_challan_lines" (
    "id" SERIAL NOT NULL,
    "challan_id" INTEGER NOT NULL,
    "mark_no" TEXT NOT NULL,
    "pieces" INTEGER NOT NULL,

    CONSTRAINT "galv_challan_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspections" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "inspection_no" TEXT NOT NULL,
    "mc_no" TEXT,
    "inspection_date" DATE NOT NULL,
    "pieces_cleared" INTEGER,
    "wt_cleared_kg" DECIMAL(14,3),
    "remarks" TEXT,
    "created_by_id" INTEGER,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatch_instructions" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "di_no" TEXT NOT NULL,
    "di_date" DATE NOT NULL,
    "pieces" INTEGER,
    "wt_kg" DECIMAL(14,3),
    "remarks" TEXT,
    "created_by_id" INTEGER,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispatch_instructions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatches" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "di_id" INTEGER,
    "invoice_no" TEXT,
    "lr_no" TEXT,
    "vehicle_no" TEXT,
    "dispatch_date" DATE NOT NULL,
    "pieces" INTEGER,
    "wt_kg" DECIMAL(14,3),
    "remarks" TEXT,
    "created_by_id" INTEGER,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_po_number_key" ON "orders"("po_number");

-- CreateIndex
CREATE INDEX "orders_docket_id_idx" ON "orders"("docket_id");

-- CreateIndex
CREATE INDEX "order_lines_order_id_idx" ON "order_lines"("order_id");

-- CreateIndex
CREATE INDEX "bom_uploads_order_id_idx" ON "bom_uploads"("order_id");

-- CreateIndex
CREATE INDEX "bom_pieces_upload_id_idx" ON "bom_pieces"("upload_id");

-- CreateIndex
CREATE INDEX "bom_pieces_order_id_mark_no_idx" ON "bom_pieces"("order_id", "mark_no");

-- CreateIndex
CREATE UNIQUE INDEX "section_master_section_key_key" ON "section_master"("section_key");

-- CreateIndex
CREATE UNIQUE INDEX "galv_challans_order_id_challan_no_direction_key" ON "galv_challans"("order_id", "challan_no", "direction");

-- CreateIndex
CREATE INDEX "galv_challan_lines_challan_id_idx" ON "galv_challan_lines"("challan_id");

-- CreateIndex
CREATE INDEX "inspections_order_id_idx" ON "inspections"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "dispatch_instructions_order_id_di_no_key" ON "dispatch_instructions"("order_id", "di_no");

-- CreateIndex
CREATE INDEX "dispatches_order_id_idx" ON "dispatches"("order_id");

-- CreateIndex
CREATE INDEX "dispatches_di_id_idx" ON "dispatches"("di_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_docket_id_fkey" FOREIGN KEY ("docket_id") REFERENCES "docket-party-name"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_uploads" ADD CONSTRAINT "bom_uploads_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_pieces" ADD CONSTRAINT "bom_pieces_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "bom_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_pieces" ADD CONSTRAINT "bom_pieces_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "galv_challans" ADD CONSTRAINT "galv_challans_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "galv_challan_lines" ADD CONSTRAINT "galv_challan_lines_challan_id_fkey" FOREIGN KEY ("challan_id") REFERENCES "galv_challans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_instructions" ADD CONSTRAINT "dispatch_instructions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_di_id_fkey" FOREIGN KEY ("di_id") REFERENCES "dispatch_instructions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

