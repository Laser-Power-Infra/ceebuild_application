-- CreateTable
CREATE TABLE "iteam-table" (
    "id" SERIAL NOT NULL,
    "unique_no" TEXT,
    "docket_no_qtn_no" TEXT,
    "item_name_party" TEXT,
    "uom" TEXT,
    "qty" TEXT,
    "our_item_not" TEXT,
    "type_of_item" TEXT,
    "our_item_name" TEXT,
    "size" TEXT,
    "length_in_mtr" TEXT,
    "weight_per_piece" TEXT,
    "price" TEXT,
    "uom_of_qtn" TEXT,
    "a" TEXT,
    "freight_per_kg" TEXT,
    "status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "iteam-table_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "docket-party-name" (
    "id" SERIAL NOT NULL,
    "docket_no_qtn_no" TEXT,
    "party_name" TEXT,
    "address" TEXT,
    "state" TEXT,
    "utility" TEXT,
    "delivery_location" TEXT,
    "price" TEXT,
    "payment" TEXT,
    "delivery" TEXT,
    "warranty" TEXT,
    "approval" TEXT,
    "inspection" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "docket-party-name_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tream-and-conditions" (
    "id" SERIAL NOT NULL,
    "price" TEXT,
    "payment" TEXT,
    "delivery" TEXT,
    "warranty" TEXT,
    "approval" TEXT,
    "inspection" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tream-and-conditions_pkey" PRIMARY KEY ("id")
);
