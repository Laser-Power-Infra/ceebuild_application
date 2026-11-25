# M14 – Rev 2 implementation plan (24-11-2026)

Source: Puja's mail chain of 24-11-2026, 16:12 → 17:54 IST. The last mail, "CONSOLIDATED DEV BLOCK Rev 2",
supersedes all earlier M14 mails and addenda. The Rev 2 file and its reference files are in
`docs/m14-rev2-reference/`, together with the KESCo BOM and indent sent separately.

Mails covered (all from Puja, cc Asmita):
16:12 Order intake review: 11 points (answered by Minmoy 17:35, all fixed) · 16:16 dev instructions + current RM rates ·
Addendum 1 (Base RM Rates, GI from the AD report, no Google Sheets) · Addendum 2/3 + correction (freight, vehicle based, trucks only, FREIGHT HISTORY RECORD) ·
Nuts & bolts rate · Finance 45 days LC / MSME VBD · Addendum 4 (Power BI / ERP interlinks) · Pending offers (4 dockets, drafts only) ·
KESCo BOM + indent · Enquiry automation · Default VA 12% · VA base includes zinc · Date-wise rates + docket discount + snapshot ·
E5 correction (every enquiry must get an offer) · **CONSOLIDATED DEV BLOCK Rev 2** (17:54).

Ground rules from Rev 2: back up the database before every migration (pg_dump -Fc into `backups/`). Never hard-code a rate:
every value lives in the dated `cost_rates` master. Log every change in `edit-logs`. Send nothing to a customer and fill no
Quotation No. without Puja's approval.

## What exists today (code map)
| Rev 2 § | Area | State | Where |
|---|---|---|---|
| 1 | PO intake + the 11 fixes | live | `src/modules/poIntake/*`, `src/lib/po/*` |
| 2 | Enquiry automation | **absent** (dockets are entered by hand) | `src/modules/dockets`, `src/app/api/dockets` |
| 3 | Costing formula | exists, differs from Rev 2 | `src/lib/costing/calc.ts` |
| 4 | Costing Master | `cost_rates` is dated. It has no rate type, supplier, valid-to, update frequency or owner | `src/modules/costing/server/master.ts` |
| 5 | Freight Master | Rs/MT per state only | `FREIGHT_MT` kind |
| 6 | Effective-dated masters | `cost_rates` only | `pickRate` |
| 7 | Docket discount | **absent** | – |
| 8 | ERP / Power BI | **absent** | – |
| 9 | AD report import | **absent** | – |
| 10 | Order → BOM → indent, machine master | exists. Indent is CSV, not Excel | `src/lib/planning/cutting.ts`, `src/modules/rm/*`, `src/modules/production/server/machines.ts` |
| 11 | Costing snapshot / history | partial (`item_costings` has a detail JSON) | `src/modules/costing/server/compute.ts` |

## Phases (in deadline order)

### Phase 1 – due 25-11 11:00: §3 formula + §4 masters seeded + intake re-runs
1. **Formula changes in `calc.ts`** (§3, §4.5, §4.6), with unit tests:
   - Interest = credit days ÷ 30 × monthly % (1%) **of the selling value before GST**, shown as its own line. Solved in closed form:
     P = B·(1+VA) / (1 − i·(1+VA)), where B is the base without interest and i = days/30 × %.
   - VA: the default comes from a new `VA_PCT` master (12%). The docket override stays. N&B and bought-out lines use VA% unless their own margin is set.
   - GI cost/kg black = labour (`GALV_RATE`) + zinc issue % (`ZINC_PCT`) × zinc rate (new `ZINC_RATE`) + transport (`GALV_TRANSPORT`). Zinc is inside the VA base.
   - Pending masters no longer block costing. Minimum VA, LC/BG, inspection and packing are flagged "pending – 0 used". With no destination the docket is **ex-works** (freight 0), not "missing".
2. **Migration** `cost_rates` + columns `rate_type` (ESTIMATE/QUOTE/PO/GRN/ACTUAL), `supplier`, `valid_to`, `update_freq_days`, `owner`.
   The UI shows the rate type and marks overdue rates red. **Backup first.**
3. **Seed script** `scripts/m14_load_rev2_masters.ts` (idempotent, `--dry`):
   - RM: Anchal Ispat L1, 20-11 ESTIMATE (already loaded on 23-11; the script tags it with the rate type)
   - GI: Solitare labour 3.80, zinc 3.8% IS, zinc Rs 379, transport 0.70 ESTIMATE
   - N&B 93.50 Rs/kg PO (R G International), interest 1%/30 days, credit 45 days, VA 12%
   - Kerf, end allowance and minimum VA stay pending
4. Re-run intake 3 (AKS), Lanarsy (SBPDCL) and LCC (Chelligada) on the live app and take screenshots. *Manual step, in the browser.*

### Phase 2 – due 25-11 13:00: §12 the 4 pending offers (drafts only)
CEE-000535 Laser 2,550 kg · CEE-000534 NKC Sasaram (re-cost and show VA % of the manual prices 89/kg, 1,950/set, 115/kg, 650/no) ·
CEE-000533 JSW Mahanadi pipe earthing 36 sets · KESCo DTR fencing (new docket from the 18-09 enquiry and Puja's BOM; per sqm, 1 enclosure = 28.8 sqm).
For each: BOM → costing → cost sheet with ESTIMATE flags → offer (Quotation No. blank) → Gmail **draft** reply. Nothing is sent.

### Phase 3 – plan + dates to Puja on 25-11: §2, §6, §7, §10, §11
- §7 Docket discount: % or Rs (per kg / unit / lump sum), item-wise or whole docket, Admin only, with a reason. Effective VA after discount, red when below minimum VA. *(~1 day)*
- §6 Effective-dated masters for sections, machines and settings. "Re-cost as on <date>". Back-dated changes never touch snapshots. *(~1 day)*
- §11 Immutable quotation snapshot when an offer is approved or sent, plus "Costing history" (Rev 0, 1 …, live vs quoted). *(~1 day)*
- §10 Indent: Excel output (INDENT / SECTION SUMMARY / CHANGES-HOLD / OFFCUT USED / NOTES) to the reference `indent_excel_rev3_offcut_reference.py`.
  Acceptance: Lanarsy Rev 3 = 4,267 bars, 101.40 MT. Then LCC vs INDT/2627/0001, AKS drawing hold, and the machine master updated to the Rev 2 list. *(~2 days)*
- §2 Enquiry automation: n8n classifier (ENQUIRY / PO / AMENDMENT / CLARIFICATION / OTHER) on info@, Gemini read, auto docket, BOM fallback chain, auto-cost + draft offer, tracker, escalations (WhatsApp via the notifier), 90-day backfill. *(~4–5 days)*

### Phase 4 – 26-11 / 28-11: §5, §8, §9 (needs Vikas)
- §5 Freight Master sync from the ERP freight-order tables (or Power BI executeQueries with a service principal):
  vehicle and PIN masters, lane rate rules, trucks only for Ceebuild, full-load Rs/kg, alerts.
- §8 ERP interlinks: indent → PO → GRN, PO/GRN rates feeding §4.1, stock, receivables and payables, order to execution.
- §9 AD report one-time import with an exception list, then GI history (§4.3).
- Blocked on table names and access from Vikas (mapping 26-11, first sync 28-11).

## Blocked / pending inputs (shown blank-flagged)
- Accounts: LC/BG charges, inspection, packing, minimum VA %
- Satya ji: kerf / end allowance, 40 NB tube rate (16 vs 100), eye-bolt threading rate
- Puja: galvaniser choice, GI transport rate, HSN 8310
- Vikas: ERP / Power BI access

## 25-11 new mails from Puja (08:00 → 08:59 IST) – changes to the plan
1. **Power BI exports attached** (freight FO 39,706 rows, Ceebuild indent 240, PO 1,397) + Souvik's "ORDER TO EXECUTION" sheet
   (BOM AGAINST PLANING, ~3,440 × 113) → one-time import into an Execution module; send the field mapping + exception count with tomorrow's plan.
2. **§5/§8 no longer wait for Vikas.** Daily refresh = Power Automate (Puja's M365, 02:00, DAX "Run a query against a dataset",
   fallback Export to file / subscription) → OneDrive/mail → n8n upsert. Send flow design + exact queries; live by **27-11**.
   Until then: Google Sheet "CEEBUILD EXECUTION TRACKING" is the daily feed.
3. **Today, status by EOD:**
   - CEE-000533 JSW: BOM from Drive file + L&T drawings (DA 22 sets, DC/DD 14 sets; 25 NB tube 3000 mm, flats 50×6, bolts bought-out; 699.5 kg black). DAP Akaltara CG.
   - CEE-000534 NKC: keep billing state Haryana, **add a separate delivery state = Bihar** (new field). Link the 21-11 sent quotation as Rev 0. BOM from Lanarsy SBPDCL approved drawings; rest → missing list.
   - CEE-000535 Laser: no enquiry found – tell Puja who raised it + attach source.
   - KESCo docket: create, VA 25% override, freeze the quoted snapshot (§11) at 991 / 1,619 / 1,516 (GI 1,116 / 1,889 / 1,786) per sqm. Add GI wire mesh 66 Rs/kg to RM master.
   - **Freight load basis** WEIGHT/SPACE per item/BOM; SPACE: trips = ROUNDUP(sets / sets per truck), freight/set = trip rate / sets per truck.
4. **C1 decisions → masters today:** galvaniser Sinha 4.03 (others history), GI transport 0.50, zinc 3.8%, **minimum VA 8%** (block < 8%,
   8–12% needs Puja's approval + reason), HSN default 7308 (danger plates 8310). Frequencies: steel daily (carry forward with IEEMA index
   estimate, overdue by 12:00 → red + alert), zinc LME × USD/INR / 1000 × (1 + premium, calibrated on Rs 379), N&B + freight monthly.
   Then re-run KESCo, JSW, NKC costings.
5. **New module: fabrication drawings from BOM** (A3 PDF, title block, GA + member sheets + cutting list matching the indent,
   Drawing-standards master, revisions, issue to Satya + "confirmed by production" gate). Test = KESCo Rev 0. Plan + date by 26-11.

## Status log
- 25-11 10:15 – deploy of `9971291` **did not happen**: the commit dropped `src/lib/gemini.ts` (build failed). Restored in `dfb1365`; server restarted 10:17.
- 25-11 10:35 backup `backups/live-before-m14-25nov-20261125-1035.dump`; migration `20261125100000_m14_25nov` applied (delivery state,
  item HSN, BOM load basis / sets per truck / painted, `quotation_snapshots`, `erp_po_lines`, `erp_indent_lines`, `freight_history`).
- Power BI seed (`scripts/m14_import_pbi.ts`): PO 1,400 · indent 242 · freight 39,708 rows; 643 exceptions (232 FO without no/from/to,
  407 FO rate 0, 4 PO without no/item). Freight lanes: 282 lanes, 26 states -> FREIGHT_MT + FREIGHT_TRIP (16 MT lane, Dhulagarh,
  trucks only). RM PO history monthly since 11-2025 (45 rows, rate type PO; the 20-11 ESTIMATE stays current).
- Masters (`scripts/m14_25nov_masters_dockets.ts`): Sinha 4.03, GI transport 0.50, zinc 3.8%, min VA 8%, wire mesh 66, paint 7,
  M10 set 6, latch 150, wire fabric per sqm; steel daily / zinc daily / N&B + freight monthly.
- Code: VA band (<8% blocked, 8–12% Admin approval + reason), freight by space, painted finish, delivery state, HSN on offer,
  §11 quotation snapshots + history, PIPE / WIRE_MESH families, "ISMC 75X40X6" -> ISMC75X40. 86/86 tests.
- 25-11 midday – n8n:
  - "Ceebuild – Read PO mails": published draft was a Claude variant the dashboard cannot read (`ai` vs `gemini`); restored
    the Gemini version, schedule fixed to every 15 min (it ran once a day), retries on the first call. Republished.
  - NEW "Ceebuild – Power BI daily feed" (webhook `ceebuild-erp-feed` → `/api/n8n/erp-import`, 03:30 stale check mails
    Minmoy). Published, tested end to end. Seed rows re-keyed to content hashes: re-sending the 25-11 files inserts 0.
    Flow design + DAX in `docs/M14_POWER_AUTOMATE_FLOW.md` (needs Puja's Power Automate).
  - NEW "Ceebuild – Read enquiry mails" (§2 stage 1: classify → Gemini → docket / link; backfill lists old ones as
    BACKLOG without taking docket numbers). Tracker: Quotation → Enquiries (`/costing/enquiries`).
  - Enquiry backfill (90 days, 47 threads): 18 LINKED (test cases: KESCo → CEE-000536, JSW → CEE-000533, NKC → CEE-000534,
    KUSUM → CEE-000535), 16 BACKLOG (no docket – Puja to decide), 5 not enquiries. Workflow published (every 15 min, 7 days).
  - §2 stage 2 (part 1): a new enquiry docket gets draft prices the same day – BOM from the matching approved drawing +
    costing (not applied), else last quoted (ESTIMATE), else "needs BOM / drawing". Shown on the Enquiries tracker.
  - Afternoon: draft offer page per enquiry, Admin "Approve → docket" for backlog, close as PO / Lost / Regret (reason),
    daily 09:30 reminder mail (n8n "Ceebuild – Enquiry reminders", to Minmoy for now).
  - §10: Rev 2 piece-length rule live (Planning Settings, 300 m); store-stock register (/planning/store-stock), used
    first by new indents, deducted on issue; RM indent Excel (Lanarsy = 4,267 bars / 101.40 MT).
  - Fabrication drawings slice 1: Drawing Standards (/admin/drawing-standards), A3 PDF from a confirmed BOM (notes,
    member sheets, cutting list = BOM), drawing sets + issue log tables. KESCo Type A/B tested.
  - Still open (need inputs): Gmail draft reply from info@ (no info@ceebuild credential in n8n), WhatsApp alerts,
    holes/bends/assembly entry + Satya mail + cutting gate, Souvik sheet import, Power Automate flow, LME zinc.
  - Plans written: `docs/M14_FABRICATION_DRAWINGS_PLAN.md` (target 10-12), `docs/M14_ORDER_TO_EXECUTION_IMPORT_PLAN.md`
    (live import 02-12, needs sheet access).
- Dockets: CEE-000534 delivery state Bihar; BOMs + draft costings (not applied) for CEE-000533, 534 (structures mix + N&B),
  535 (KUSUM STR req sheet); KESCo docket CEE-000536 with 3 items, BOMs, costing at VA 25%, snapshot Rev 0 frozen.
- 24-11 evening – plan written. Phase 1 code done locally, 79/79 tests pass, typecheck clean (outside scratch/):
  - `src/lib/costing/calc.ts`: Rev 2 interest (days/30 × % of selling value, closed form), `VA_PCT` default, GI = labour + zinc% × `ZINC_RATE` + transport, ex-works with no destination, pending masters non-blocking, N&B / bought-out margin falls back to VA %.
  - `prisma/migrations/20261124180000_m14_rev2_rate_meta`: `cost_rates.rate_type`, `supplier`, `valid_to`, `update_freq_days`, `owner`. Tags the INTERIM rows as ESTIMATE.
  - `master.ts` + `CostingMasterPage.tsx`: new fields, rate-type badge, "update overdue" in red.
  - `scripts/m14_load_rev2_masters.ts`: GI, zinc, N&B, finance and VA seeds.
  - Live check (read-only): live has only RM (12 rows, 20-11 Anchal) and FAB (14 rows). No N&B margin, so N&B takes VA 12%.
- 24-11 18:18 backup `backups/live-before-m14-rev2-20261124-1818.dump`. ~18:25 migration `20261124180000_m14_rev2_rate_meta` applied on live. Rev 2 masters seeded (12 rows: RM families, GI, zinc, N&B, credit, interest, VA). Commit `9971291` pushed to main, so CI deploy is running.
- Also done locally and pushed: RM family fallback, docket discount (§7), cost-sheet build-up (cost → VA → before discount → discount → final → effective VA).
- §12 check (read-only): CEE-000533 (item 5758), 000534 (5759–5762) and 000535 (5763) have **no BOM and no costing**. Each needs a BOM before it can be costed. CEE-000534 has state "Haryana" but Sasaram is in Bihar – to correct.
- (superseded) Waiting for go-ahead: pg_dump → `prisma migrate deploy` → seed `--dry` then real → commit and push (CI deploys to the server).
- Still to do in Phase 1: RM family fallback (size row → family row, e.g. all angles 50.00 when the size is not on the purchase list); intake re-run screenshots.
