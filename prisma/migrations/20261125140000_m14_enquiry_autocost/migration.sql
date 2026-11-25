-- M14 §2 stage 2: draft prices stored on the enquiry row. Additive only.
ALTER TABLE "enquiry_intakes" ADD COLUMN "auto_cost" JSONB;
