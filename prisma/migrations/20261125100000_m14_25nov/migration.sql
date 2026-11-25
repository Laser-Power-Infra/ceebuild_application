-- M14 25-11: delivery state, HSN on items, freight load basis, painted finish, quotation snapshots (§11),
-- ERP seed tables (PO, indent, freight history) from the Power BI exports. Additive only.
-- AlterTable
ALTER TABLE "docket-party-name" ADD COLUMN     "delivery_state" TEXT;

-- AlterTable
ALTER TABLE "iteam-table" ADD COLUMN     "hsn" TEXT;

-- AlterTable
ALTER TABLE "item_boms" ADD COLUMN     "load_basis" TEXT NOT NULL DEFAULT 'WEIGHT',
ADD COLUMN     "sets_per_truck" DECIMAL(10,2),
ADD COLUMN     "painted" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "quotation_snapshots" (
    "id" SERIAL NOT NULL,
    "docket_id" INTEGER NOT NULL,
    "docket_no" TEXT,
    "rev" INTEGER NOT NULL,
    "quoted_on" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "note" TEXT,
    "sent_to" TEXT,
    "total_value" DECIMAL(16,2),
    "payload" JSONB NOT NULL,
    "created_by_id" INTEGER,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotation_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_po_lines" (
    "id" SERIAL NOT NULL,
    "row_hash" TEXT NOT NULL,
    "indent_no" TEXT,
    "po_no" TEXT,
    "party" TEXT,
    "order_date" DATE,
    "item_name" TEXT,
    "uom" TEXT,
    "rate" DECIMAL(14,4),
    "po_qty" DECIMAL(16,3),
    "grn_qty" DECIMAL(16,3),
    "bal_to_grn" DECIMAL(16,3),
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_po_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_indent_lines" (
    "id" SERIAL NOT NULL,
    "row_hash" TEXT NOT NULL,
    "indent_no" TEXT,
    "indent_date" DATE,
    "item_name" TEXT,
    "uom" TEXT,
    "indent_qty" DECIMAL(16,3),
    "requisition_by" TEXT,
    "indent_by" TEXT,
    "purpose" TEXT,
    "require_date" DATE,
    "delivery_sch" TEXT,
    "po_qty" DECIMAL(16,3),
    "bal_to_po" DECIMAL(16,3),
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_indent_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "freight_history" (
    "id" SERIAL NOT NULL,
    "row_hash" TEXT NOT NULL,
    "fo_no" TEXT,
    "fo_date" DATE,
    "doc_no" TEXT,
    "doc_date" DATE,
    "from_loc" TEXT,
    "from_pin" TEXT,
    "to_loc" TEXT,
    "to_pin" TEXT,
    "vehicle_type" TEXT,
    "truck_no" TEXT,
    "net_weight" DECIMAL(14,3),
    "fo_rate" DECIMAL(14,2),
    "freight_value" DECIMAL(14,2),
    "distance" DECIMAL(10,1),
    "bill_no" TEXT,
    "bill_amount" DECIMAL(14,2),
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "freight_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quotation_snapshots_docket_id_rev_key" ON "quotation_snapshots"("docket_id", "rev");

-- CreateIndex
CREATE UNIQUE INDEX "erp_po_lines_row_hash_key" ON "erp_po_lines"("row_hash");

-- CreateIndex
CREATE INDEX "erp_po_lines_item_name_idx" ON "erp_po_lines"("item_name");

-- CreateIndex
CREATE UNIQUE INDEX "erp_indent_lines_row_hash_key" ON "erp_indent_lines"("row_hash");

-- CreateIndex
CREATE UNIQUE INDEX "freight_history_row_hash_key" ON "freight_history"("row_hash");

-- CreateIndex
CREATE INDEX "freight_history_to_pin_idx" ON "freight_history"("to_pin");

