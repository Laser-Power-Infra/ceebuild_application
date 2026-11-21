# BOM-based quotation costing (tracker M14)

The price on a docket item is now calculated from a BOM instead of being typed by hand.
Flow: **Docket item → Create BOM → cost from the Costing Master → price on the offer PDF → same BOM into the order**.

Screens:

- Dockets table: the calculator icon on each item opens `/costing/<itemId>` (BOM and costing). The calculator icon in the docket's Actions column opens `/costing/docket/<docketId>`, which shows every item and the docket total.
- Administration → **Costing Master** (`/admin/costing`) and **Approved Drawings** (`/admin/drawings`).

## 1. Create BOM (each docket item)

- **(a) Drawing received with the enquiry.** Upload a PDF or xlsx file.
  - xlsx is read with the same header rules as the order BOM import.
  - A PDF is read in the browser with pdf.js (loaded from cdnjs). The text is sent to Groq (`GROQ_API_KEY`) to pull out the mark, section, length and qty per set.
  - A scanned PDF has no text. Its page images go to a Groq vision model instead.
  - The user checks or edits every line, then saves.
- **(b) Our approved drawing.** The library is searched in this order:
  1. same utility + item type;
  2. same state + item type (docket state or delivery state);
  3. any approved drawing of the item type, shown as *Reference only – confirm*.

  Superseded drawings are never offered. The BOM shows its source, the drawing no. and revision, the approval letter and the match level.
- **Confirm BOM** locks the BOM. A confirmed BOM that has been copied into an order can only be reopened by an Admin.

## 2. Approved Drawing Library

Each drawing records:

- utility, state, item type;
- drawing no., revision;
- approval letter no. and date;
- status (Approved / Superseded);
- Laser Drive link;
- its BOM lines.

To add an approval, either add it in the library or use **Add to Approved Drawing Library** on a confirmed item BOM. Saving a new revision supersedes the older ones.

## 3. Scope and line categories

Each BOM line has two tags.

**Scope:**

- In scope
- Not in scope
- Bought-out
- Client supply

Only *In scope* and *Bought-out* lines are costed. A line marked *Non-billable* is listed and flagged but not priced.

**Category:**

- Structure
- **Nuts & Bolts – separate item**
- Bought-out

Nuts & bolts are costed from `NB_RATE`, keyed by size (e.g. M16X40), in Rs/kg or Rs/set. They are kept out of the structure weight and the per-kg price. The offer PDF shows them as their own line, and only when they are in scope.

## 4. Costing Master

There are no hard-coded numbers. Every factor is a dated row in `cost_rates`:

- a change is a new version, and old versions are kept;
- a quotation uses the rates in force on its "rates as on" date;
- only Admins can make changes, and every change is written to the audit log;
- a version that a saved costing used cannot be deleted.

**RM purchase list** (`rm_purchase_items`): a short, fixed list. A structure line must map to one item on it. A section outside the list is flagged and not costed.

| Factor | Kind | Keyed by |
|---|---|---|
| RM rate (Rs/kg, from the latest PO/GRN) | RM_RATE | purchase item |
| Wastage % override | WASTAGE_PCT | purchase item / DEFAULT |
| Fabrication (Rs/kg) | FAB_RATE | Plain cut / Clamp-bent / Welded |
| Galvanising (Rs/kg black or galv), zinc pick-up %, transport | GALV_RATE, ZINC_PCT, GALV_TRANSPORT | – |
| Freight (Rs/MT, FOR) | FREIGHT_MT | destination state / DEFAULT |
| Interest %, credit days, LC/BG %, inspection, packing | INTEREST_PCT, CREDIT_DAYS, LC_BG_PCT, INSPECTION, PACKING | – |
| Minimum VA % | MIN_VA_PCT | – |
| Nuts & bolts | NB_RATE | size / DEFAULT |
| Bought-out items | BOUGHT_OUT | item name |

## 5. Calculation (per line, one set; `src/lib/costing/calc.ts`, tested in `tests/costing.test.ts`)

- black wt = qty/set × length × kg/m. kg/m comes from GTP Sections, or from the drawing as a fallback, marked `*`.
- galv wt = black wt × (1 + zinc %).
- cost = black wt × (RM rate × (1 + wastage %) + fab) + galvanising + freight + inspection/packing, then interest (credit days) and LC/BG on top.
- Wastage % comes from the Costing Master override if one exists. Otherwise it is the cutting plan's scrap ÷ net for that section: `planIndent` in MIXED mode (6 m standard bars plus exact-multiple custom lengths, per Planning Settings) for the item's sets.
- selling = cost × (1 + VA %). It is shown per kg (black or galvanised, per the client's billing basis), per set and for the docket total.
- Sets: if the item qty is in KG or MT, sets = qty ÷ set weight. If it is in NOS or SET, sets = qty.

**Save & apply** writes the price to the docket item (`price`, `uomOfQtn`, `weightPerPiece`), so it flows into the offer PDF. Each save stores a `item_costings` snapshot: the rates used (ids and dates), every line and the checks.

## 6. Checks

- Price below the minimum VA %: only an Admin can apply it.
- Variance against the last quoted price for the same item type: the last applied costing, or else the last hand-typed Rs/kg price.
- A line with a blank weight or rate, or a section outside the purchase list, blocks **Apply**.
- **Apply** also needs a confirmed BOM.

## 7. One BOM end to end: link to the order module (for Asmita)

`createOrder` (`src/modules/orders/server/mutations.ts`) now calls `copyQuotationBomToOrder` (`src/modules/costing/server/orderLink.ts`) inside the same transaction.

**What gets copied.** The docket items' latest confirmed item BOMs become the order's first `bom_uploads` row:

- `source = 'QUOTATION'`, status DRAFT;
- `column_map.itemBomIds` lists the item BOMs used;
- each piece's `raw` holds `itemBomId` and `itemBomLineId`.

**Which lines.** Only Structure lines that are In scope and billable are copied. Nuts & bolts and bought-out lines are not cut, so they stay out.

**Quantities and marks.**

- sets = the applied costing's sets, rounded up to a whole set;
- total qty = qty/set × sets;
- kg/m comes from GTP Sections;
- with more than one item, marks are prefixed `<item no>-`.

**After that, nothing changes in the order module.** The GTP checks run on the copy. "✓ Correct BOM" → RM Indent (`loadPlanningInput`) → re-plan → Machine Plan all read these pieces, so the quotation and execution use the same numbers. A client BOM uploaded later becomes a newer version, as before.

## Deploy

1. Back up the database.
2. Run `npx prisma migrate deploy`. It applies `20261121070627_m14_bom_costing`, which is additive only:
   - 7 new tables;
   - one new nullable column, `bom_uploads.source`.
3. Fill the masters. Without them every line is flagged and nothing is costed:
   - GTP Sections (kg/m);
   - Costing Master: the RM purchase list and all rates (GI cost master values from Puja);
   - Planning Settings: end allowance and kerf (wastage depends on them).
