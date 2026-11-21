-- AlterTable
ALTER TABLE "approved_drawings" ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by_name" TEXT;

-- AlterTable
ALTER TABLE "item_bom_lines" ADD COLUMN     "group_id" INTEGER;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "drawing_editor" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "item_bom_groups" (
    "id" SERIAL NOT NULL,
    "bom_id" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "drawing_no" TEXT,
    "drawing_id" INTEGER,
    "sets" DECIMAL(14,3),
    "site_sets" JSONB,

    CONSTRAINT "item_bom_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "item_bom_groups_bom_id_idx" ON "item_bom_groups"("bom_id");

-- AddForeignKey
ALTER TABLE "item_bom_groups" ADD CONSTRAINT "item_bom_groups_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "item_boms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_bom_lines" ADD CONSTRAINT "item_bom_lines_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "item_bom_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
