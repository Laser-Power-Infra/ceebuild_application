-- M14 (25-Nov-2026): fabrication drawing sets (one row per PDF revision) and their issue log.
-- Additive only. A set is linked to the item BOM it was drawn from and, later, to an order /
-- BOM upload / RM indent. Status DRAFT -> ISSUED -> CONFIRMED, or SUPERSEDED.

CREATE TABLE "fab_drawing_sets" (
    "id" SERIAL NOT NULL,
    "item_bom_id" INTEGER,
    "item_id" INTEGER,
    "docket_id" INTEGER,
    "order_id" INTEGER,
    "bom_upload_id" INTEGER,
    "indent_id" INTEGER,
    "client_code" TEXT NOT NULL,
    "item_code" TEXT NOT NULL,
    "drawing_no" TEXT NOT NULL,
    "rev" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "change_note" TEXT,
    "basis_ref" TEXT,
    "page_count" INTEGER,
    "cutting_hash" TEXT,
    "snapshot" JSONB,
    "s3_key" TEXT,
    "prepared_by_name" TEXT,
    "checked_by_name" TEXT,
    "approved_by_name" TEXT,
    "issued_to" TEXT,
    "issued_at" TIMESTAMP(3),
    "confirmed_by_name" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "confirm_remarks" TEXT,
    "created_by_id" INTEGER,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fab_drawing_sets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fab_drawing_sets_chk" CHECK ("status" IN ('DRAFT', 'ISSUED', 'CONFIRMED', 'SUPERSEDED') AND "rev" >= 0)
);

CREATE INDEX "fab_drawing_sets_item_bom_id_idx" ON "fab_drawing_sets"("item_bom_id");
CREATE INDEX "fab_drawing_sets_order_id_idx" ON "fab_drawing_sets"("order_id");
CREATE UNIQUE INDEX "fab_drawing_sets_drawing_no_rev_key" ON "fab_drawing_sets"("drawing_no", "rev");

ALTER TABLE "fab_drawing_sets" ADD CONSTRAINT "fab_drawing_sets_item_bom_id_fkey" FOREIGN KEY ("item_bom_id") REFERENCES "item_boms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "fab_drawing_issues" (
    "id" SERIAL NOT NULL,
    "set_id" INTEGER NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_to" TEXT NOT NULL,
    "cc" TEXT,
    "sent_by_name" TEXT,
    "message_id" TEXT,
    "result" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT,

    CONSTRAINT "fab_drawing_issues_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fab_drawing_issues_set_id_idx" ON "fab_drawing_issues"("set_id");

ALTER TABLE "fab_drawing_issues" ADD CONSTRAINT "fab_drawing_issues_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "fab_drawing_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
