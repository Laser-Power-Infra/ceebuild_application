-- M15: Add Order from the PO copy (OCR + AI), PO lines, PO documents, intake log, hold flag, indent job.
-- Additive only: new nullable columns, two defaults, three new tables.
-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "advance_pct" DECIMAL(6,2),
ADD COLUMN     "amendment_date" DATE,
ADD COLUMN     "amendment_no" TEXT,
ADD COLUMN     "approval_letter_no" TEXT,
ADD COLUMN     "basic_value" DECIMAL(16,2),
ADD COLUMN     "billing_address" TEXT,
ADD COLUMN     "bom_ref" TEXT,
ADD COLUMN     "contact_email" TEXT,
ADD COLUMN     "contact_person" TEXT,
ADD COLUMN     "contact_phone" TEXT,
ADD COLUMN     "credit_days" INTEGER,
ADD COLUMN     "customer_gstin" TEXT,
ADD COLUMN     "delivery_address" TEXT,
ADD COLUMN     "delivery_schedule" TEXT,
ADD COLUMN     "drawing_ref" TEXT,
ADD COLUMN     "drawing_status" TEXT,
ADD COLUMN     "end_client" TEXT,
ADD COLUMN     "freight" TEXT,
ADD COLUMN     "galv_spec" TEXT,
ADD COLUMN     "gst_amount" DECIMAL(16,2),
ADD COLUMN     "gst_pct" DECIMAL(6,2),
ADD COLUMN     "hold_by_name" TEXT,
ADD COLUMN     "hold_reason" TEXT,
ADD COLUMN     "hold_since" TIMESTAMP(3),
ADD COLUMN     "inspection" TEXT,
ADD COLUMN     "job_at" TIMESTAMP(3),
ADD COLUMN     "job_note" TEXT,
ADD COLUMN     "job_status" TEXT,
ADD COLUMN     "ld_penalty" TEXT,
ADD COLUMN     "on_hold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "payment_terms" TEXT,
ADD COLUMN     "pbg_pct" DECIMAL(6,2),
ADD COLUMN     "po_extract" JSONB,
ADD COLUMN     "po_source" TEXT,
ADD COLUMN     "price_basis" TEXT,
ADD COLUMN     "project" TEXT,
ADD COLUMN     "scheme" TEXT,
ADD COLUMN     "sd_pct" DECIMAL(6,2),
ADD COLUMN     "state" TEXT,
ADD COLUMN     "test_certificates" TEXT,
ADD COLUMN     "total_value" DECIMAL(16,2),
ADD COLUMN     "warranty" TEXT;

-- AlterTable
ALTER TABLE "plan_settings" ADD COLUMN     "lead_time_days" INTEGER NOT NULL DEFAULT 45;

-- CreateTable
CREATE TABLE "order_po_lines" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "hsn" TEXT,
    "unit" TEXT,
    "qty" DECIMAL(16,3),
    "unit_rate" DECIMAL(16,2),
    "line_value" DECIMAL(16,2),
    "qty_var_pct" DECIMAL(6,2),
    "quoted_rate" DECIMAL(16,2),
    "quoted_item_id" INTEGER,

    CONSTRAINT "order_po_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_documents" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER,
    "intake_id" INTEGER,
    "kind" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "s3_key" TEXT,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'UPLOAD',
    "gmail_message_id" TEXT,
    "uploaded_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "po_intakes" (
    "id" SERIAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EXTRACTED',
    "source" TEXT NOT NULL DEFAULT 'UPLOAD',
    "gmail_message_id" TEXT,
    "mail_subject" TEXT,
    "model" TEXT,
    "extracted" JSONB,
    "error" TEXT,
    "order_id" INTEGER,
    "created_by_id" INTEGER,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),

    CONSTRAINT "po_intakes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_po_lines_order_id_idx" ON "order_po_lines"("order_id");

-- CreateIndex
CREATE INDEX "order_documents_order_id_idx" ON "order_documents"("order_id");

-- CreateIndex
CREATE INDEX "order_documents_intake_id_idx" ON "order_documents"("intake_id");

-- AddForeignKey
ALTER TABLE "order_po_lines" ADD CONSTRAINT "order_po_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_documents" ADD CONSTRAINT "order_documents_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_documents" ADD CONSTRAINT "order_documents_intake_id_fkey" FOREIGN KEY ("intake_id") REFERENCES "po_intakes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

