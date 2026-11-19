-- LOCAL DEV ONLY: sample order for testing the planning/production/billing screens.
-- Never run against the server database. Run with:
--   docker exec -i ceebuild-dev-db psql -U ceebuild -d ceebuild-items < scripts/dev-seed-orders.sql
-- Re-runnable: it removes its own rows (PO DEV-LANARSY-001) first.

BEGIN;

DELETE FROM orders WHERE po_number = 'DEV-LANARSY-001';
DELETE FROM "docket-party-name" WHERE docket_no_qtn_no = 'CEE-DEV-001';

INSERT INTO "docket-party-name" (docket_no_qtn_no, party_name, state, utility, delivery_location, type, updated_at)
VALUES ('CEE-DEV-001', 'LANARSY INFRA LIMITED', 'Bihar', 'SBPDCL', 'Patna, Bihar', 'Purchase', now());

-- Approved GTP sections (indicative kg/m; real list comes from SBPDCL letter 2333).
INSERT INTO section_master (section_key, label, kg_per_m, grade, approved, max_bar_mm, source, updated_at) VALUES
  ('ISA50X50X6',  'ISA 50x50x6',  4.500, 'IS 2062 E250A', true, NULL, 'DEV SAMPLE', now()),
  ('ISA65X65X6',  'ISA 65x65x6',  5.800, 'IS 2062 E250A', true, NULL, 'DEV SAMPLE', now()),
  ('ISA75X75X6',  'ISA 75x75x6',  6.800, 'IS 2062 E250A', true, NULL, 'DEV SAMPLE', now()),
  ('ISMC100X50',  'ISMC 100x50',  9.560, 'IS 2062 E250A', true, 6600, 'DEV SAMPLE', now()),
  ('FLAT50X6',    'FLAT 50x6',    2.360, 'IS 2062 E250A', true, NULL, 'DEV SAMPLE', now())
ON CONFLICT (section_key) DO NOTHING;

WITH d AS (SELECT id FROM "docket-party-name" WHERE docket_no_qtn_no = 'CEE-DEV-001'),
o AS (
  INSERT INTO orders (docket_id, docket_no, po_number, po_date, client, contract_value, delivery_due, created_by_name, updated_at)
  SELECT id, 'CEE-DEV-001', 'DEV-LANARSY-001', DATE '2026-11-13', 'LANARSY INFRA LIMITED', 9500000, DATE '2027-01-31', 'dev seed', now() FROM d
  RETURNING id
),
u AS (
  INSERT INTO bom_uploads (order_id, file_name, column_map, row_count, status, uploaded_by_name, confirmed_by_name, confirmed_at)
  SELECT id, 'SBPDCL_100MT_sample.xlsx', '{}'::jsonb, 9, 'CORRECT', 'dev seed', 'dev seed', now() FROM o
  RETURNING id, order_id
)
INSERT INTO bom_pieces (upload_id, order_id, row_no, mark_no, description, section, section_key, length_mm, qty_per_set, sets, total_qty, kg_per_m, unit_wt_kg, total_wt_kg)
SELECT u.id, u.order_id, x.row_no, x.mark, x.descr, x.section, x.skey, x.len, x.qps, x.sets, x.qps * x.sets, x.kgm,
       round(x.len / 1000.0 * x.kgm, 3), round(x.len / 1000.0 * x.kgm * x.qps * x.sets, 3)
FROM u, (VALUES
  (1, 'A1', 'Leg member',        'ISA 50x50x6', 'ISA50X50X6', 1450, 4, 100, 4.500),
  (2, 'A2', 'Bracing',           'ISA 50x50x6', 'ISA50X50X6', 2200, 2,  60, 4.500),
  (3, 'A3', 'Main leg',          'ISA 65x65x6', 'ISA65X65X6', 1980, 3, 100, 5.800),
  (4, 'A4', 'Cleat',             'ISA 65x65x6', 'ISA65X65X6',  760, 1,  90, 5.800),
  (5, 'B1', 'Channel cross arm', 'ISMC 100x50', 'ISMC100X50', 2200, 3,  50, 9.560),
  (6, 'B2', 'Channel top',       'ISMC 100x50', 'ISMC100X50', 3100, 1,  12, 9.560),
  (7, 'C1', 'Clamp flat',        'FLAT 50x6',   'FLAT50X6',    350, 6, 100, 2.360),
  (8, 'C2', 'Long leg',          'ISA 75x75x6', 'ISA75X75X6', 6400, 1,   4, 6.800),
  (9, 'D1', 'Strut',             'ISA 75x75x6', 'ISA75X75X6', 2875, 1,  60, 6.800)
) AS x(row_no, mark, descr, section, skey, len, qps, sets, kgm);

COMMIT;
