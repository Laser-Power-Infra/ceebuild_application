-- M14 (23-Nov-2026): fabrication rate per BOM line category (job-work chart), and the machine
-- master updated from the Ceebuild List of Machinery of 23-Nov. Additive / data only.

ALTER TABLE "item_bom_lines" ADD COLUMN "fab_cat" TEXT;

-- Machine master -------------------------------------------------------------------------------
-- Two more operations in the master: ANNEALING (furnace) and DRILLING (radial drills).
ALTER TABLE "machines" DROP CONSTRAINT "machines_chk";
ALTER TABLE "machines" ADD CONSTRAINT "machines_chk" CHECK (
  "operation" IN ('CROPPING', 'SHEARING', 'PUNCHING', 'NOTCHING', 'BENDING', 'WELDING', 'NUMBERING', 'THREADING', 'DRILLING', 'ANNEALING')
  AND "units" >= 1 AND "rate_per_hour" > 0 AND "shifts_per_day" BETWEEN 0 AND 3
  AND "hours_per_shift" > 0 AND "utilisation_pct" > 0 AND "utilisation_pct" <= 100);

-- Cropping: PP1 (83 T), PP11 (80 T), UP-1 (100 T, now one machine).
UPDATE "machines" SET "operation" = 'CROPPING', "rate_unit" = 'cuts', "name" = 'Pneumatic power press PP1 (cropping, 83 T)', "sort_order" = 11, "remarks" = 'List of Machinery 23-Nov-2026' WHERE "code" = 'PP1';
UPDATE "machines" SET "operation" = 'CROPPING', "rate_unit" = 'cuts', "name" = 'Power press PP11 (cropping, 80 T)', "sort_order" = 12, "remarks" = 'List of Machinery 23-Nov-2026' WHERE "code" = 'PP11';
UPDATE "machines" SET "units" = 1, "name" = 'Universal press UP-1 (cropping, 100 T)', "remarks" = 'One machine (earlier 2) – List of Machinery 23-Nov-2026' WHERE "code" = 'UP-1';
UPDATE "machines" SET "name" = 'Shearing machine SH1 (Pathak, 60 T)' WHERE "code" = 'SH1';

-- Not available / not working: out of planning.
UPDATE "machines" SET "active" = false, "remarks" = 'Not available – List of Machinery 23-Nov-2026' WHERE "code" = 'PP2';
UPDATE "machines" SET "active" = false, "remarks" = 'Needs repair – List of Machinery 23-Nov-2026' WHERE "code" = 'PP7';
UPDATE "machines" SET "active" = false, "remarks" = 'Not working – List of Machinery 23-Nov-2026' WHERE "code" = 'PP10';
UPDATE "machines" SET "active" = false, "remarks" = 'Shifted to Laser – threading (eye bolts) routed to Laser / outside' WHERE "code" IN ('LN1', 'LN2');

-- Punching: 9 presses (PP15 new; Sl 16 & 17 carry the duplicate ID "PP14" on the list -> PP16, PP17).
INSERT INTO "machines" ("code", "name", "operation", "units", "rate_per_hour", "rate_unit", "shifts_per_day", "sort_order", "remarks") VALUES
  ('PP15', 'Power press PP15 (punching, 80 T, Howrah)', 'PUNCHING', 1, 400, 'holes', 1, 37, 'List of Machinery 23-Nov-2026'),
  ('PP16', 'Power press PP16 (punching, 80 T, Howrah)', 'PUNCHING', 1, 400, 'holes', 1, 38, 'Sl 16 – listed as duplicate "PP14"; unique ID given'),
  ('PP17', 'Power press PP17 (punching, 80 T, Howrah)', 'PUNCHING', 1, 400, 'holes', 1, 39, 'Sl 17 – listed as duplicate "PP14"; unique ID given')
ON CONFLICT ("code") DO NOTHING;

-- Notching: BULL hydraulic 150 T.  Numbering: PP6 and the 100 T hydraulic press.
UPDATE "machines" SET "name" = 'BULL hydraulic notching press (150 T)' WHERE "code" = 'BULL';
UPDATE "machines" SET "name" = 'Hydraulic press (numbering, 100 T)' WHERE "code" = 'HYD-PRESS';

-- Welding: ESAB MIG x3 (W1, W2, W3), arc 201i, arc ARC1 – 5 sets.
UPDATE "machines" SET "name" = 'ESAB MIG-MAG welding W1 (400i)' WHERE "code" = 'W1';
UPDATE "machines" SET "name" = 'ESAB MIG-MAG welding W2 (400i)' WHERE "code" = 'W2';
UPDATE "machines" SET "code" = 'ARC1', "name" = 'Arc welding ARC1 (400 A)' WHERE "code" = 'AR1' AND NOT EXISTS (SELECT 1 FROM "machines" WHERE "code" = 'ARC1');
INSERT INTO "machines" ("code", "name", "operation", "units", "rate_per_hour", "rate_unit", "shifts_per_day", "sort_order", "remarks") VALUES
  ('W3',   'ESAB MIG-MAG welding W3 (401i)', 'WELDING', 1, 20, 'joints', 1, 63, 'List shows "W1,W2" for 3 machines; W3 added'),
  ('201I', 'Arc welding 201i (400 A)',       'WELDING', 1, 20, 'joints', 1, 64, 'List of Machinery 23-Nov-2026')
ON CONFLICT ("code") DO NOTHING;

-- Annealing furnace (now working) and radial drills (not working: drilling goes outside).
INSERT INTO "machines" ("code", "name", "operation", "units", "rate_per_hour", "rate_unit", "shifts_per_day", "sort_order", "active", "remarks") VALUES
  ('ANN1', 'Annealing furnace HARRIER-AE-MF-1800-1000P (80)', 'ANNEALING', 1, 1, 'pieces', 1, 90, true,  'Now working – List of Machinery 23-Nov-2026'),
  ('D1',   'Radial drill D1 (38 mm)',                         'DRILLING',  1, 30, 'holes', 1, 85, false, 'Under repair – 40 NB tube drilling outside'),
  ('D3',   'Radial drill D3 x3 (38 mm)',                      'DRILLING',  3, 30, 'holes', 1, 86, false, 'Not working – 40 NB tube drilling outside')
ON CONFLICT ("code") DO NOTHING;
