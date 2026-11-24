# Orders and execution (tracker task A15, phase 1)

When an offer (docket) becomes a PO, an **order** is created from it. The order carries a
snapshot of the docket's quotation lines, the client BOM (piece list) and the after-fabrication
registers. Screens: `/orders`, `/orders/<id>`, `/execution`, `/admin/sections`.

PO intake (Add Order = attach PO copy, M15): see `docs/PO_INTAKE.md`.

Built now: step 0 (order from PO), step 1 (BOM import + check) and step 5 (galvanising,
inspection/MC, DI, dispatch). **Not built yet:** step 2 (RM indent / cutting plan), step 3 (RM
receipt + re-plan) and step 4 (machine production plan). They wait for Puja's prototype, the
plant-confirmed end allowance, the buffer % and machine rates.

## Deploy

1. Back up the database.
2. `npx prisma migrate deploy` applies `prisma/migrations/20261118000000_order_execution`. It only
   creates 10 new tables (`orders`, `order_lines`, `bom_uploads`, `bom_pieces`, `section_master`,
   `galv_challans`, `galv_challan_lines`, `inspections`, `dispatch_instructions`, `dispatches`);
   no existing table is changed.
3. Optional: set `S3_ACCESS_KEY` / `S3_SECRET_KEY` (and `S3_ENDPOINT_URL`, `S3_BUCKET`) to keep a
   copy of each uploaded BOM file. Without them the BOM is imported but the file is not archived.

## Who can do what

Everyone can view. Signed-in Users and Admins create orders, upload/edit BOMs and add register
entries. Admins also delete orders and register entries, override "Correct BOM" with a note, and
maintain the GTP section list. Every change is written to the audit log.

## BOM checks

Upload the client xlsx; the header row and columns are detected and can be corrected before
import. Each row is flagged for:

- the same mark with different lengths;
- blank quantity;
- a fractional number of sets;
- kg/m more than ±5% off the section's standard;
- a section that is not approved in the GTP.

The last two use `/admin/sections` and are skipped while that list is empty. Editing a cell
re-runs the checks. "✓ Correct BOM" locks the BOM; it needs no flags left, or an Admin override
with a note.

## Order status

Status is derived from the data, never typed:
PO received → BOM uploaded → BOM correct → At galvanising → Galvanised → Inspected → DI issued →
Part dispatched → Dispatched (dispatched weight ≥ BOM weight).

Galvanising-in pieces per mark can never exceed pieces sent out. Dispatching more weight than
was inspected/cleared is allowed but shows a warning.

## Code layout

The GMD dashboard standard is ported into this single app:

- `src/modules/<screen>/` holds `columns.ts`, `server/` (SQL, mutations) and `ui/`.
- Server Actions are in `src/app/actions/`. They check the user (`src/lib/actionResult.ts`) and
  return `{success, error}`.
- The table kit is copied from GMD `@gmd/ui` to `src/components/data-table/`. Paging, sorting,
  filters, search, facets and KPI totals run in SQL (`src/lib/serverTable.ts`).
- Query state lives in a Redux slice (`src/lib/opsSlice.ts`).
- The BOM parsing and checks are pure functions in `src/lib/bom/`, tested by `npm test`.
