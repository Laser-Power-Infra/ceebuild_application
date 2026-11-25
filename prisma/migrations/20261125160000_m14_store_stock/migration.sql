-- M14 Rev 2 §10: store stock register (offcuts / spare bars used before ordering). Additive.
-- CreateTable
CREATE TABLE "rm_store_stock" (
    "id" SERIAL NOT NULL,
    "section" TEXT NOT NULL,
    "section_key" TEXT NOT NULL,
    "length_mm" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OFFCUT',
    "for_piece_length_mm" INTEGER,
    "location" TEXT,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "reserved_indent_no" TEXT,
    "created_by_name" TEXT,
    "updated_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rm_store_stock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rm_store_stock_section_key_idx" ON "rm_store_stock"("section_key");

