-- Items are linked to dockets by docket number text. Store it in one canonical form
-- (trimmed, upper-case) so exact matching works everywhere.
UPDATE "docket-party-name" SET "docket_no_qtn_no" = upper(btrim("docket_no_qtn_no"))
  WHERE "docket_no_qtn_no" IS NOT NULL AND "docket_no_qtn_no" <> upper(btrim("docket_no_qtn_no"));
UPDATE "docket-party-name" SET "docket_no_qtn_no" = NULL WHERE "docket_no_qtn_no" = '';
UPDATE "iteam-table" SET "docket_no_qtn_no" = upper(btrim("docket_no_qtn_no"))
  WHERE "docket_no_qtn_no" IS NOT NULL AND "docket_no_qtn_no" <> upper(btrim("docket_no_qtn_no"));

-- The Groq API key must live only in the server .env, never in this publicly readable table.
DELETE FROM "master-values" WHERE "type" IN ('GROQ_API_KEY', 'SETTING');

-- CreateIndex: two concurrent saves can no longer get the same docket number.
CREATE UNIQUE INDEX "docket-party-name_docket_no_qtn_no_key" ON "docket-party-name"("docket_no_qtn_no");
