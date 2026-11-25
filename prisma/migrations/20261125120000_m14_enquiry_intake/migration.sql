-- M14 Rev 2 §2 stage 1: enquiry intake (n8n reads info@ mails; enquiry -> docket). Additive only.
CREATE TABLE "enquiry_intakes" (
    "id" SERIAL NOT NULL,
    "thread_ref" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "subject" TEXT,
    "sender" TEXT,
    "mail_date" TIMESTAMP(3),
    "party_name" TEXT,
    "enquiry_no" TEXT,
    "due_date" DATE,
    "docket_id" INTEGER,
    "docket_no" TEXT,
    "files" JSONB,
    "extracted" JSONB,
    "model" TEXT,
    "error" TEXT,
    "outcome" TEXT,
    "outcome_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "enquiry_intakes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "enquiry_intakes_thread_ref_idx" ON "enquiry_intakes"("thread_ref");
CREATE INDEX "enquiry_intakes_docket_id_idx" ON "enquiry_intakes"("docket_id");
