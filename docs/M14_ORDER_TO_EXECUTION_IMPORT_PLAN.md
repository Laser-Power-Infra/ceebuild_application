# M14 – Order to Execution: sheet import plan

Source: Souvik's Google Sheet "Copy of CEEBUILD ORDER TO EXECUTION.", tab **BOM AGAINST PLANING** (about 3,440 rows × 113 columns).
Asked by: Puja (GM), 25-11-2026. Written: Wed 25-11-2026.
Goal: import the sheet once into the dashboard Execution module. After that the dashboard is the record and the sheet is frozen.

**We have not seen the sheet yet.** The columns below come from Puja's description of a row. Every header name is assumed.
Tags in the tables:
- **GUESS** – header name or meaning is assumed. Confirm when we open the sheet.
- **NEW FIELD** – the schema has no field for it. Listed in section 2.
- **NEW TABLE** – goes to a table that does not exist yet.

One sheet row = one BOM line (one drawing mark) of one planning no.

Screens that already exist and will show the data: Orders (`/orders/[id]`: BOM, RM, Production, Billing tabs), RM Indent
and RM Receipt & Re-plan (`/planning/indent`, `/planning/receipt`), Daily Production (`/production`), Shop plan / WIP and
bottleneck (`/planning/production`), Machine master (`/admin/machines`), Execution registers (`/execution`: stage inspection,
galvanising, inspection/MC, DI, dispatch) and Billing (`/billing`).

## 1. Field mapping (sheet column → dashboard field)

### a) Planning – link to the order and its BOM lines

| Sheet column (assumed) | Dashboard field | Transform | Tags / notes |
|---|---|---|---|
| Planning No | `production_plannings.planning_no` | trim, upper | NEW TABLE. One row per planning no. Key of the import. |
| Planning Date | `production_plannings.planning_date` | date (see f) | NEW TABLE |
| Party PO No | match key → `orders.po_number`; copy to `production_plannings.party_po_no` | normalise (see 3.3) | Main match key |
| Party PO Date | check against `orders.po_date` | date | Mismatch = exception, not overwritten |
| Tally Order No | `orders.tally_order_no` | trim | NEW FIELD |
| Project | `orders.project` | text | Fill only when blank on the order |
| Party | `orders.client` via party master | party master (see 3.4) | Fill only when blank |
| MC No / MC Date / MC Qty | `production_plannings.mc_no`, `mc_date`, `mc_qty` | text / date / number | NEW TABLE. GUESS: MC = material clearance / client's call-off. Second match key. |
| Planning Qty | `production_plannings.planning_qty` | number | NEW TABLE. GUESS: sets or MT? |
| Item | `bom_pieces.item_name` | text | NEW FIELD. The structure (PO line) the mark belongs to. |
| Member | `bom_pieces.description` | text | |
| Drawing Mark | `bom_pieces.mark_no` | trim, upper | Key with planning no |
| RM Type | `bom_pieces.rm_type` | text (CHANNEL / ANGLE / FLAT …) | NEW FIELD. GUESS meaning |
| Section | `bom_pieces.section`, `section_key` | `sectionKey()` | Unknown section = exception |
| Length | `bom_pieces.length_mm` | mm, integer | GUESS unit (mm or m) |
| Unit Wt | `bom_pieces.unit_wt_kg` | number | |
| Cutting Length | `bom_pieces.cutting_length_mm` | mm | NEW FIELD |
| Production Unit Wt | `bom_pieces.prod_unit_wt_kg` | number | NEW FIELD |
| RM Indent Weight | `bom_pieces.rm_indent_wt_kg` | number | NEW FIELD |
| Qty per Structure | `bom_pieces.qty_per_set` | number | |
| Sets Required | `bom_pieces.sets` | number | |
| Required Qty (Nos) | `bom_pieces.total_qty` | number | Check = qty/set × sets |
| Required Qty (Kg) | `bom_pieces.total_wt_kg` | number | Check = nos × unit wt (±1 %) |
| Final Stage (SFG/FG) | `bom_pieces.final_stage` | SFG \| FG | NEW FIELD |
| Require Date | `production_plannings.require_date` | date | NEW TABLE. GUESS: per planning, not per line |
| Drawing (attachment link) | `order_documents` kind DRAWING, `link_url`, `bom_piece_id` | keep URL as is | NEW FIELD ×2. Link kept; file not copied. |

### b) Production tracking – routing, stage done/balance, job allocation

| Sheet column (assumed) | Dashboard field | Transform | Tags / notes |
|---|---|---|---|
| Cutting | `piece_routings.cut_op` | Y → SHEARING (angle/flat) or CROPPING (channel); blank → NONE | GUESS: sheet has Y/N, not the machine |
| Punching / Notching / Bending / Welding / Threading | `piece_routings.holes`, `notches`, `bends`, `welds`, `threads` | Y → 1, blank → 0 | GUESS: sheet has Y/N, not counts. Real counts stay a to-do per mark (exception "count unknown"). |
| Marking | `piece_routings.numbering` | Y/N → bool | |
| Annealing (route) | `piece_routings.annealing` | bool | NEW FIELD |
| Galvanising (route) | `piece_routings.galvanising` | bool | NEW FIELD |
| Packing | `piece_routings.packing` | bool | NEW FIELD |
| Segregation | `piece_routings.segregation` | bool | NEW FIELD |
| Sale | – | always last step | No field needed |
| `<Stage>` Done (Nos) / Done (Kg), one pair per stage | `production_openings` (order, mark, stage, done_nos, done_kg, as_of) | number | NEW TABLE. See section 4. |
| `<Stage>` Balance (Nos) / Balance (Kg) | not stored | check only: balance = required − done | Mismatch = exception |
| Job Allocated Date | `job_allocations.allocated_date` | date | NEW TABLE |
| Job Allocated To | `job_allocations.allocated_to` | text (person / contractor) | NEW TABLE. GUESS: a person, not a machine |
| Target Date | `job_allocations.target_date` | date | NEW TABLE |
| Actual Return Date | `job_allocations.actual_return_date` | date | NEW TABLE. Late = target < actual or today |

Stage-wise done/balance in nos and kg for about 13 stages is the bulk of the 113 columns (13 × 4 = 52). That is a GUESS until we count them.

### c) Job work – annealing and galvanising

| Sheet column (assumed) | Dashboard field | Transform | Tags / notes |
|---|---|---|---|
| Annealing Party | `galv_challans.job_worker` with `process = ANNEAL` | party master | NEW FIELD `process` (GALV \| ANNEAL) |
| Annealing Out (Nos / Kg) | one opening OUT challan per planning no; `galv_challan_lines.pieces`; `black_wt_kg` | number | Challan no `OPEN-<planning no>-OUT`, date = cut-over date. GUESS: no challan no in the sheet. |
| Annealing In (Nos / Kg) | opening IN challan; `galv_wt_kg` | number | Balance = out − in, computed |
| GI Party (e.g. Sudarshan / Sinha) | `galv_challans.job_worker`, `process = GALV` | party master | |
| GI Out (Nos / Kg) | opening OUT challan; `black_wt_kg` | number | |
| GI In (Nos / Kg) | opening IN challan; `galv_wt_kg` | number | Zinc pick-up % = (in − out) / out, shown in the register already |

GI master actuals: zinc % and labour Rs/kg by party go to `cost_rates` (`GALV_RATE`, `ZINC_PCT`, `rate_type = ACTUAL`,
`supplier` = party) **only after Puja approves**. Labour needs the job-work bill rate; the sheet probably has no rate (GUESS).

### d) RM link

| Sheet column (assumed) | Dashboard field | Transform | Tags / notes |
|---|---|---|---|
| RM Indent No | `bom_pieces.erp_indent_no`; join to `erp_indent_lines.indent_no` → `erp_po_lines` (PO, GRN) | trim, upper | NEW FIELD. GUESS: ERP number (INDT/…), not a dashboard `rm_indents.indent_no` |
| RM Order Length | `bom_pieces.rm_order_length_mm` | mm | NEW FIELD. Bar length asked for. |
| RM Ordered Length / Qty | `bom_pieces.rm_ordered_length_mm`, `rm_ordered_qty` | mm / nos | NEW FIELD ×2 |
| RM Received Length / Qty | `bom_pieces.rm_received_length_mm`, `rm_received_qty` | mm / nos | NEW FIELD ×2. Not turned into `rm_receipt_lots`: no GRN no/date in the sheet (GUESS). New receipts go through RM Receipt & Re-plan. |

### e) Quality and dispatch

| Sheet column (assumed) | Dashboard field | Transform | Tags / notes |
|---|---|---|---|
| Inspection Offer (date) | `production_plannings.insp_offer_date`; `inspections.offered_date` when an inspection row exists | date | NEW FIELD on inspections |
| Inspection Done (date) | `production_plannings.insp_done_date`; `inspections.inspection_date` | date | Inspection row made only when an inspection/MC no is present (GUESS) |
| DI Received | `production_plannings.di_received_date`; `dispatch_instructions` when a DI no is present | Y/date | GUESS: Y/N or date, no DI no |
| Ready for Sale | `production_plannings.ready_for_sale_nos` / `_kg` | number | NEW TABLE. GUESS: = "Sale" stage done |
| Estimated Finish Weight | `bom_pieces.est_finish_wt_kg` | number | NEW FIELD |
| Actual Finish Weight | `bom_pieces.actual_finish_wt_kg` | number | NEW FIELD. Feeds billing weight check (galv basis) |

### f) Clean-up rules (all columns)
- `#N/A`, `#REF!`, `#VALUE!`, `#DIV/0!`, `#ERROR!`, `-` → blank. Each one is written to the exception list (row, column, old value).
- Dates: accept dd-mm-yyyy, dd/mm/yy, dd.mm.yyyy, Sheets serial numbers. Two-digit years = 20yy. Anything else → blank + exception.
- Numbers: strip commas, "kg", "nos", spaces. Text in a number column → blank + exception.
- Parties: one party master (3.4). Raw text kept in staging.
- Drawing links: kept as links in `order_documents`. Broken or non-Drive link → exception.

## 2. Schema additions

**New tables (6):**
1. `exec_import_rows` – staging: run label, sheet row no, raw row (Json), matched order id, status.
2. `exec_import_exceptions` – run label, row no, column, category, old value, note.
3. `production_plannings` – planning no (unique), date, order id, party PO no, MC no/date/qty, planning qty, require date,
   inspection offer/done dates, DI received date, ready for sale nos/kg.
4. `production_openings` – order id, planning id, mark no, stage, done nos, done kg, as-of date, source (`SHEET_IMPORT`).
5. `job_allocations` – order id, planning id, mark no, stage, allocated to, allocated / target / actual return dates.
6. `parties` – canonical name, kind (CLIENT / JOB_WORKER / SUPPLIER), aliases (text array), active.

**New fields (24):**
- `orders.tally_order_no` (1)
- `bom_pieces`: `planning_id`, `item_name`, `rm_type`, `cutting_length_mm`, `prod_unit_wt_kg`, `rm_indent_wt_kg`,
  `final_stage`, `est_finish_wt_kg`, `actual_finish_wt_kg`, `erp_indent_no`, `rm_order_length_mm`, `rm_ordered_length_mm`,
  `rm_ordered_qty`, `rm_received_length_mm`, `rm_received_qty` (15)
- `piece_routings`: `annealing`, `galvanising`, `packing`, `segregation` (4)
- `galv_challans.process` (GALV | ANNEAL, default GALV) (1)
- `inspections.offered_date` (1)
- `order_documents`: `link_url`, `bom_piece_id` (2)

All additive and nullable. One migration. Backup before it, as usual.

## 3. Import steps

1. **Read.** Google Sheets API (`spreadsheets.values.get`, `UNFORMATTED_VALUE` + `FORMATTED_STRING` both, so we see `#N/A` and
   the real number). Fallback: CSV export of the tab. Script `scripts/m14_import_order_exec.ts`, same style as `m14_import_pbi.ts`.
2. **Stage.** Write every row as-is to `exec_import_rows`. Nothing else is touched. Re-runnable: a new run label each time.
3. **Match orders.**
   1. Normalise party PO no: upper, trim, collapse spaces, drop `PO NO`, `.`, `:`; keep `/` and `-`.
   2. Exact match on `orders.po_number`, then on the normalised value.
   3. No match → MC no against `production_plannings.mc_no` / `inspections.mc_no`.
   4. Still none → party + PO date (±3 days). Must be one order only.
   5. None or more than one → exception `ORDER_NOT_FOUND` / `ORDER_AMBIGUOUS`. Row waits.
   Old orders not in the dashboard need a decision from Puja (see 7): create them (they need a docket) or skip closed ones.
4. **Party master.** Build `parties` from `docket-party-name.party_name`, `master-values` (PARTY_NAME), ERP PO parties and the
   sheet. Normalise: upper, strip `M/S`, `PVT LTD`/`PRIVATE LIMITED`, `LTD`, dots, double spaces. Same key = same party.
   Near matches (e.g. "SUDARSHAN GALV" vs "SUDARSHAN GALVANIZERS") listed for Souvik to confirm, never merged silently.
5. **BOM lines.** Order already has a confirmed BOM → match marks; add the new fields and `planning_id` only.
   Order has no BOM → one `bom_uploads` row (`source = SHEET_IMPORT`, `column_map` = this mapping) with its pieces.
6. **Write** plannings, routings, openings, job allocations, opening challans, drawing links, RM fields, quality dates – in one
   transaction per order. A failed order rolls back alone.
7. **Check.** Totals per order (nos, kg, done per stage) sheet vs dashboard. Must match to the kg.
8. **Freeze.** Sheet set to view-only on the cut-over date. Daily entry from then on in the dashboard.

**Exception categories:** `ERROR_CELL` (#N/A, #REF! …), `BAD_DATE`, `BAD_NUMBER`, `BLANK_KEY` (no planning no or mark),
`ORDER_NOT_FOUND`, `ORDER_AMBIGUOUS`, `PO_DATE_MISMATCH`, `PARTY_UNKNOWN`, `SECTION_UNKNOWN`, `DUPLICATE_MARK`
(same planning + mark twice), `QTY_CHECK` (nos ≠ qty/set × sets, kg ≠ nos × unit wt), `BALANCE_MISMATCH` (balance ≠ required −
done), `DONE_OVER_REQUIRED`, `JOBWORK_IN_OVER_OUT`, `ROUTE_COUNT_UNKNOWN` (Y/N only), `INDENT_NOT_IN_ERP`, `LINK_BROKEN`.

## 4. Stage-wise done/balance: snapshot, not ProductionEntry rows

The sheet holds running totals, not daily history. `production_entries` needs a date, a shift and a machine for every row.
Making fake entries (one per mark per stage, a dummy machine) would spoil the machine load, the daily report and any
output-per-machine figure.

So:
- Done per mark per stage → one `production_openings` row, dated the cut-over day. Balance is not stored; it is always
  required − (opening + entries after cut-over).
- `loadProduced()` (production module) adds openings to entries, so Progress, Remaining-work plan and the bottleneck use both.
- Stages with no machine (annealing, galvanising, packing, segregation, sale) are tracked from openings + challans + dispatch.
- From the cut-over day, Daily Production entries are the only way to add done quantities.

## 5. Exception count – not possible yet

We cannot count exceptions until we read the sheet. The dry run (steps 1–3, nothing written to live tables) gives the count by
category within about 2 hours of getting access. Expected large groups (GUESS): error cells from formula columns, old orders
not in the dashboard, Y/N routing without counts, and party spellings.

## 6. Effort and dates (Mon–Sat work days)

About **6 work days**. Dates assume access by Thu 26-11 morning. Each day late moves everything by a day. The ERP feed
(§5/§8, live 27-11) runs on the same days, so this gets about half of each day until 28-11.

| Date | Work |
|---|---|
| Wed 25-11 | This plan sent with the mapping. |
| Thu 26-11 | Access → confirm 113 headers, fix the mapping, dry run, **exception count to Puja by evening**. |
| Fri 27-11 | Migration (6 tables, 24 fields) on a backup copy; import script; party master list to Souvik. |
| Sat 28-11 | Full test import on the copy; totals check; exception review with Souvik. |
| Mon 30-11 | Screens: planning no on the order, job allocation list, openings in Progress / WIP, ANNEAL filter on the galv register. |
| Tue 01-12 | Fix remaining exceptions; Puja/Souvik check 5 orders on the copy. |
| Wed 02-12 | **Live import, sheet frozen (view-only).** Souvik enters daily from here. |
| Thu 03-12 | New-order flow: Confirm order → BOM → indent fills the same BOM-against-planning fields and creates the planning no. |

## 7. Needed from Puja / Souvik

1. Share the sheet (viewer is enough) with **minmoy.dholey@laserpowerinfra.com**. Also the drawing folder, so links can be checked.
2. Confirm the header row (which row, any merged headers) and the 113 column names, or send a 20-row sample.
3. What MC no means and whether PO no or MC no is the key for an order.
4. Old or closed orders not in the dashboard: import them (we create a docket per party) or skip closed ones?
5. Are routing columns Y/N or counts (holes, bends, welds)?
6. Is "done" cumulative? Is "balance" a formula?
7. Job-work parties: full list, and which do annealing vs galvanising. Labour rate per party, if not in the sheet.
8. Cut-over date and who enters daily production after it.
