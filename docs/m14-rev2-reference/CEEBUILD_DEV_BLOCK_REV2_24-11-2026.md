# CEEBUILD DASHBOARD – CONSOLIDATED DEV BLOCK (REV 2, 24-11-2026)

Owner: Puja Agarwal (GM – R&D and Operations, Laser Power & Infra Limited) · Developer: Minmoy Dholey · Guide: Asmita Mallick
App: https://ceebuild.gmdalui.co.in · This file SUPERSEDES all earlier M14 instructions and addenda (23–24 Nov). Where anything conflicts, this file wins.

Rules for the implementer (Claude): read the whole file first; back up the database before every migration; work section by section in the order given; never hard-code a rate – every value lives in a versioned master; every change is logged (user, date-time, old, new); nothing is ever sent to a customer and no Quotation No. is filled without Puja's approval.

---

## 0. Principles
1. The dashboard is the only base data for Ceebuild. No Google Sheet is referred to in future; old sheets are imported once (§9) and frozen.
2. One-person running: data comes in automatically (mail, ERP), the system does the work, the human only reviews, approves and handles flags.
3. Every master value is effective-dated (§6).
4. Every enquiry must end in an offer or an approved Regret (§2).

## 1. Status of what is already live (keep, regression-test)
- Add order from PO copy (n8n pick-up from info@ceebuildcompany.com, Gemini read, yellow flags, edit log, PO details tab, hold).
- Intake fixes (all 11, done 24-11): attachment classification (OUR_OFFER never read as PO), thread read oldest→newest (latest wins), own-identity block for customer contact, PO-vs-quote on latest revision with per-kg normalisation and "item not in offer", same-party docket first, drawing status from PO + mail, Drawing/GTP no. hygiene, HSN from item master, GST 18% "as per law", BOM Excel preview, proposed delivery date, "Read again".
- Open on your side: mail-archive full-thread fix on the server; own-contact list in server settings.
- Confirmed: HSN list 7308 / 7217 / 7312 / 7313 / 8310 (danger boards – Puja to reconfirm) / 7318; standard lead time 45 days (editable setting).

## 2. Enquiry automation (NEW – mandatory)
E1 Trigger: every mail to info@ceebuildcompany.com (incl. internal forwards cc info@) is classified ENQUIRY / PO / AMENDMENT / CLARIFICATION / OTHER. Backfill last 90 days once and list enquiries without a docket.
E2 Read (OCR + AI, same rules as PO intake): party, customer contact (never our people), project, utility, state, delivery location, enquiry no./date, due date, item lines (description, unit, qty), terms asked, notes; classify attachments BOQ / BOM / drawing / GTP / spec. Duplicate = same party + items + project within 60 days → link; revised BOQ → new revision of the same docket.
E3 Docket created automatically ("Enquiry – to cost"), files and source mail attached.
E4 BOM: attached BOM/BOQ → else the bill-of-material table of the attached approved drawing/GTP → else our historically approved drawing for the same utility/state/item. Unit conversion for sqm / set / km enquiries (fencing: 1 enclosure = 28.8 sqm, editable). Flags in yellow.
E5 Offer is MANDATORY:
- Same day as the docket: auto-cost + draft offer (our format, enquiry terms) + draft reply mail. Missing inputs are filled with the latest available value (estimate / last quoted / nearest history), marked ESTIMATE and listed as assumptions in the offer.
- No BOM/drawing → budgetary offer from the historically approved drawing, marked "Budgetary – subject to drawing/BOM", with what is needed from the party.
- An enquiry can only close as "Offer sent" or "Regret" (reason + Puja's approval).
- Escalation: draft not approved → daily reminder to Puja; due date − 2 days → WhatsApp + mail to Puja and Asmita; due date passed → red, top of Control Tower.
E6 Tracker per enquiry: received → docket → BOM → costed → draft → approved → sent → PO / lost, with dates and time in each step.
Test: KESCo fencing (Laser purchase mail 18-09-2026), CEE-000534 NKC Sasaram, CEE-000533 JSW Mahanadi.

## 3. Costing formula (per item, then docket)
Cost base = RM + fabrication + GI (labour + zinc + GI transport) + nuts & bolts (separate line) + freight + interest
Price before discount = cost base × (1 + VA%) ; VA default 12% (zinc INCLUDED in the base)
Final price = price before discount − discount (§7) ; then GST.
Cost sheet shows every component, its source, rate type (ESTIMATE / QUOTE / PO / GRN / ACTUAL) and date; blanks/estimates highlighted.

## 4. Costing Master tabs
### 4.1 Base RM Rates
Fields: section family, size (optional), Rs/kg excl. GST, basis, credit days, rate type, source, supplier, valid_from/valid_to, update frequency (set by Puja), next-update-due, owner (default Purchase – Baptu), history. Overdue → red + alert to owner; costing not blocked, only flagged. Lookup: size row → family row → "No RM rate".
Seed (ESTIMATE, 20-11-2026, Anchal Ispat L1, carriage paid Dhulagarh, 10 days credit): ISMC all 50.50 · Angles all 50.00 · MS flats all 50.50 · MS round 50.50. MR Steel L2 stored as QUOTE, not used. Later rows come automatically from ERP PO/GRN (§8).
### 4.2 Fabrication rates (Satya ji's job-work chart – live)
Per kg on black weight: channel/angle cut-punch-number 1.60; clamps FB 65x6/50x10/50x8/50x6 1.70; FB 40x6/40x5 1.80; radius clamps 1.80; welded/tower items 2.50; taper V-cross 2.80; FB 30x3/25x3 2.85; square washer 3.50. Per piece: 40 NB tube 3000 drilling 16 (TO CONFIRM – chart also shows 100); 1800 drilling 14; 16 mm angle bow 6; 16 mm rod cut 560 mm 0.50 / 1800 mm 1.50; plate 200x200x6 punching 1. Unmatched lines flagged. Eye-bolt threading now outside job work – rate pending.
### 4.3 GI / Galvanising Master (from AD report history)
GI cost/kg black = labour + zinc issue % × zinc rate + GI transport (+ kanta share). Galvaniser invoices in history include 18% GST – store excl.
Labour Rs/kg excl.: Solitare 3.80 (DEFAULT) · Sinha 4.03 · Bright Engg 4.40–4.59 · KMC 3.17–3.23 · DC Power 6.00 (re-GI 10.00) · Vikram 3.80/4.00.
Zinc issue: IS 3.8% (DC Power 4%), commercial 2.8–3.4% (default 3.0%), pipe 10%. Zinc rate: Rs 379/kg excl. (Hind Commercial 18-07-2026, Rs 447.22 incl.), update Weekly.
GI transport default Rs 0.70/kg both ways (ESTIMATE – old Jan-2025 data, Puja to confirm); kanta Rs 50–200/trip.
Example: 3.80 + 3.8% × 379 + 0.70 = Rs 18.90/kg black, excl. GST. Galvaniser choice and transport rate: Puja to confirm.
### 4.4 Nuts & bolts (bought-out, separate line; rate type PO, owner Purchase, Monthly)
GI nut + bolt + washer, M12–M20, Gr 4.6/5.6, Rs/kg excl. GST: DEFAULT 93.50 (R G International 22-07-2026, 3,305 kg) for ≥ 100 kg; small lots < 100 kg 146–148 (Fasteners India May/Jun-2026). History rows: Fasteners India 01-10-2026 94.43; GMD 20-05-2026 114.24; GMD 14-10-2026 115.00. M10 (KESCo) – no history, flag "no rate".
### 4.5 Finance
Default terms: 45 days credit under LC / MSME vendor bill discounting (VBD). Interest = credit days ÷ 30 × 1% of selling value before GST (45 days = 1.5%), separate line. Party terms override; advance/payment before dispatch = 0%. Editable, versioned, Admin only.
### 4.6 VA
Default 12% on the full cost base (incl. zinc). Per-docket override by Admin with reason. Minimum VA % setting – value pending from Accounts.
### 4.7 Still pending (blank-flagged)
Accounts: LC/BG charges beyond interest, inspection charges, packing, minimum VA %. Satya ji: kerf / end allowance (0, "not confirmed"), 40 NB tube rate, eye-bolt threading rate. Puja: galvaniser choice, GI transport rate, HSN 8310.

## 5. Freight Master (interlinked, no manual entry)
Source: ERP freight-order tables behind Power BI "FREIGHT HISTORY RECORD" (or the dataset via Power BI REST executeQueries with a service principal). Report export is disabled – do not scrape. Access/table names from Vikas.
Sync: nightly after Power BI refresh + "Sync now"; incremental upsert by FO_NO + FO_DATE; never delete; run log.
Cleaning: vehicle master (normalised names, rated capacity MT, body length m); location master keyed on PIN; zero-weight rows (multi-drop) kept but excluded – one FO = one trip; prefer TRNPT_BILL FREIGHT AMT over FO_RATE.
Rate per TO_PIN/district × vehicle type: trips ≤ 6 months → lowest; only older → latest + 5%; no history → nearest place in same state ("nearest: <place>, <km>"); > 25% from lane median → "Abnormal freight" review list, excluded until approved; no delivery location → ex-works.
Ceebuild = TRUCKS ONLY: setting "allowed vehicle types" per company (Ceebuild default excludes TRAILER / 40 ft / LPT); trailer only by Admin on a docket with reason; lane with only trailer history → nearest truck history, flagged.
Full-load: Rs/kg = trip rate ÷ rated capacity (kg); choose the truck type with lowest Rs/kg for the order tonnage; trips = ROUNDUP(MT ÷ capacity); last part-load charged as full trip; exclude trucks shorter than the longest BOM piece; phased delivery → per lot.
Alerts: lane changed after sync → "re-cost?" on open dockets; no trip 6 months amber, 12 months red; Admin override with reason and expiry.
Test (trucks): Dhulagarh → Jamui Truck-10MT Rs 28,500 (Aug-25, +5%), Munger Truck-12MT Rs 33,999 (Feb-25, +5%), Banka Truck-10MT Rs 26,000 (Aug-25, +5%).

## 6. Effective-dated masters
Every master value has valid_from / valid_to; a change creates a new version from a chosen date (future or back-dated), never overwrites. Admin can re-cost any docket "as on <date>". Default costing date = today; price-variation offers = enquiry base date. Back-dated changes never alter already-quoted snapshots.

## 7. Docket discount
% or Rs (per kg / per unit / lump sum), item-wise or whole docket, with reason, Admin only. Cost sheet: cost base → VA → price before discount → discount → final price → effective VA % after discount (red if below minimum VA %).

## 8. ERP / Power BI interlinks (same sync pattern as §5; access via Vikas)
Sources: "CEEBUILD INDENT TO EXECUTION" (HOME, STOCK Ceebuild & Dailmer, LEDGER BALANCE, PAY & RECEIVED, ORDER TO EXECUTION, DEBTORS, CREDITORS) and "PURCHASE HISTORY".
- Indent → PO → GRN: import ERP indents (CIND…), POs (CB-PO…), GRNs; link to the dashboard RM indent (ERP indent no. shown on it); per line PO qty, balance to PO, GRN qty, balance to GRN, status; GRN opens the receipt entry (actual lengths) of RM Receipt & Re-plan; alert when required date passed with balance.
- RM rates from purchases: PO/GRN rows feed §4.1 automatically (Ceebuild first, Laser/GMD purchase history as fallback); same for nuts & bolts and zinc. Costing uses latest PO/GRN within the update frequency, else quote/estimate (flagged); show both when they differ (e.g. MS flat PO Rs 44.00–44.28 vs comparative 50.50).
- Stock: free stock deducted before indenting; reserve stock to an order.
- Billing & collection: receivables (ageing, overdue alerts, payment terms from the order) and payables; ledger read-only for Admin.
- Order to execution: dispatch/invoice status per order; ERP is the book of record for invoiced quantities; differences flagged.
Mapping agreed with Vikas by 26-11; first sync by 28-11.

## 9. One-time import of the old AD report (Google Sheet)
Tabs IN-OUT → inward register; OUT → job-out/outward challans; PI → proforma invoices; Consumption → RM consumption/scrap; Sheet7 → transport rates. Clean party-name variants (DCPOWER/DC POWER, KMC UDDYOG/YDDYOG, UNISTAR variants…), mixed date formats, comma numbers; failures to an exception list. Then derive §4.3 history from it. Plan + exception count by 26-11.

## 10. Order → BOM → drawing → RM indent (module)
On order Confirm: pick the order's BOM (client BOM → approved drawing BOM → historical drawing), check sections against the approved GTP (missing → HOLD with client query; approved substitute → recalc with new kg/m), then generate the indent:
- 6000 mm standard bars; custom length only an exact multiple of ONE piece length, max 6000 mm (ISMC 100x50 up to 6600 = 3 × 2200; per-section setting).
- Tolerance +0 / +20 mm, NO negative tolerance (printed on indent); no buffer; kerf/end allowance setting (0 for now).
- Custom bars = floor(required pieces ÷ pieces per bar); balance pieces nested on 6 m bars (first-fit decreasing).
- Offcut/stock first: deduct usable offcuts and full bars in store before ordering (as Satya's offcut sheet), reserve them to the order.
- Output Excel: INDENT, SECTION SUMMARY, CHANGES/HOLD, OFFCUT USED, NOTES; revision no., date and reason; older revision marked superseded.
- Receipt re-plan: on GRN enter actual lengths → re-plan (exact multiple first, then best fit); any bar below ordered length flagged for rejection/debit note; shortfall → supplementary indent.
- Machine plan from the updated machine master (below).
Acceptance: Lanarsy SBPDCL must reproduce Rev 3 = 4,267 bars, 101.40 MT (Rev 2 = 4,311 bars, 102.00 MT before offcuts); LCC vs INDT/2627/0001; AKS shows drawing hold. Reference files attached (code renamed .txt because Gmail blocks .py/.js – the 23-11 mail bounced).

### Machine master (updated list)
Working: cropping PP1, PP11, UP-1 (1 machine); shearing SH1; punching PP4, PP5, PP8, PP9, PP12, PP14, PP15, PP16, PP17; notching BULL; clamp bending PP3, PP13; numbering PP6, hydraulic press 100 T; welding W1, W2, W3, 201i, ARC1; annealing furnace. Excluded: PP2, PP7 (repair), PP10, LN1/LN2 (shifted to Laser – threading outside), radial drills D1/D3 (drilling outside), Rockwell tester, bar bending machine, electro-plating.

## 11. Costing snapshot and history
On approval/sending of an offer, freeze an immutable snapshot: quotation no., quoted date, costing date, every rate used per item, VA %, discount, final price, terms, approver. Docket shows "Costing history": every run and every quoted revision (Rev 0, Rev 1 …) with date, plus live re-cost today vs quoted (Rs/kg and %). All changes logged.

## 12. Pending offers to produce now (via §2–§3, drafts only)
1. CEE-000535 – Laser Power & Infra, 24-11-2026, GI fabricated structures 2,550 kg, ex-works, 30 days MSME.
2. CEE-000534 – N K C Project, SBPDCL Sasaram tender: structures (kg), 11 kV stay set 95, GI nut & bolt (kg), danger plates 50 – re-cost; show VA % of the manual prices (89/kg, 1,950/set, 115/kg, 650/no).
3. CEE-000533 – JSW Mahanadi, Akaltara CG, GI pipe earthing 2.85 m × 25 mm, 36 sets, ex-works, 10% advance.
4. KESCo Kanpur DTR fencing – create docket from the 18-09-2026 enquiry; BOM file sent separately; Sl 7.08 7,520 sqm (262 enclosures, 50x50 mesh), Sl 7.09 2,835.20 sqm (99 enclosures, 100x100 mesh), per sqm, Laser store Kanpur; assumptions: paint vs GI, mesh, site count.
Deliver 4 cost sheets + draft offers + draft replies by 25-11, 13:00.

## 13. Deadlines
- 25-11 11:00 – screenshots of intake re-runs (AKS, Lanarsy, LCC); §4 masters seeded (RM, GI, nuts & bolts, finance, VA).
- 25-11 13:00 – §12 pending offers (drafts).
- 25-11 – plan + dates for §2, §6, §7, §10, §11.
- 26-11 – §8 / §5 source mapping with Vikas; §9 import plan.
- 28-11 – first ERP / freight sync live.
Reply each time with: what changed, what was tested, what is still blocked; update the M14 tracker row.
