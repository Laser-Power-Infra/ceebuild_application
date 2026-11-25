# Add Order = attach the PO copy (M15)

An order is added by attaching the customer's PO copy. It is read by OCR + AI (Google Gemini),
every field is filled, the user checks the yellow fields and clicks **Confirm**. The order is saved
with the PO copy, and the indent job (BOM → drawing → indent) starts by itself.

Screens: `/orders` → **Add order (attach PO)** → `/orders/new`; each order has a **PO details** tab.
Typed entry stays available to Admins as **Manual entry** (old POs without a copy).

## Where the automatic work runs (n8n)

```
mail sync ──> MySQL mail archive (threads; attachments on Google Drive)
                     │  email portal API /api/db-emails/ceebuild-po (MAIL_API_URL, LAN)
                     ▼
      dashboard GET /api/n8n/po-mails  ◄── n8n "Ceebuild – Read PO mails" (every 15 min)
                                              │ Drive download (Minmoy@laser)
                                              │ Gemini generateContent (PAID API credential)
      dashboard POST /api/n8n/po-intake ◄─────┘ files (base64) + Gemini answer
                     │
                     ▼
      Orders → Add order: "Read from mail by n8n – waiting for review" → Confirm → indent job
```

- **n8n workflows** (project of puja.agarwal@, both created **inactive**):
  - `Ceebuild – Read PO mails (n8n → dashboard)` – schedule every 15 min + webhook `ceebuild-read-po-mail`
    (the dashboard's "Pick from Ceebuild mail" button). One Gemini call per mail; files go back to the
    dashboard and are stored in S3 against the intake.
  - `Ceebuild – Gemini proxy (PO reading)` – webhook `ceebuild-gemini`; used for uploaded PO copies,
    so the dashboard needs no Gemini key (`GEMINI_API_KEY` empty).
- **Dashboard** keeps what needs its own database in one transaction: duplicate check, docket match,
  review screen, Confirm, edit log, indent job, hold.
- Which mails: Ceebuild mail (`company = 'CEEBUILD'` or a ceebuildcompany.com address) of the last 21
  days with attachments, whose subject / file names look like a customer order. Ceebuild's own supplier
  POs and other non-POs are recorded as *Not a PO (AI)* and not offered again. A failed mail is retried
  up to 3 times. Files are typed from their names (`src/lib/mailFiles.ts`).
- Auth: n8n → dashboard uses `x-api-key` (= `N8N_API_KEY`) plus the Cloudflare service token
  `n8n-ceebuild-api` (Access app "Ceebuild n8n API" on `ceebuild.gmdalui.co.in/api/n8n`, created by
  `infrastructure/cloudflare/m15_setup.py`). Dashboard → n8n uses `x-ceebuild-key` (= `N8N_WEBHOOK_KEY`).
  `/api/n8n/*` is outside the session proxy (`src/proxy.ts`).

## Flow

1. **Attach** – POs n8n has already read wait at the top of the page. Otherwise upload the PO (PDF,
   scanned PDF, JPG/PNG) or pick the mail from the Ceebuild mail archive; n8n reads it within a minute or
   two. The whole thread's attachments are offered, so the BOM sent a day later in the same thread can be
   ticked too. Each file is marked PO copy / BOM / Drawing.
2. **Read** – the PO copy and drawings go to Gemini in one call (scanned pages are OCR'd by the
   model). It returns every field with a confidence, the PO lines, and – if a drawing/BOM table is
   printed – the piece list. `src/lib/po/normalise.ts` cleans dates, amounts, %, GSTIN (check digit
   verified), units; anything it cannot read drops to *low* confidence.
3. **Review** – PO on the left, form on the right. Missing or low-confidence fields are **yellow**
   until changed. Docket (our offer) is matched automatically (party name, utility, items,
   quantity) and can be changed. Live checks:
   - duplicate PO (same customer + PO no.) – **blocks** Confirm;
   - qty × rate ≠ line value, line total ≠ basic value, GST ≠ basic × GST %, basic + GST ≠ total – flagged;
   - delivery date earlier than today + standard lead time (`/admin/planning`, default 45 days) – flagged;
   - PO rate vs our quoted rate (docket items), compared per kg when one side is per MT – shown,
     flagged when the PO rate is below our quote.
4. **Confirm** – order + PO fields + PO lines (with our quoted rate) + files are saved in one
   transaction. Every field the reviewer changed from the AI reading is written to the edit log
   (field, AI value, new value, user); later edits on the PO tab are logged the same way.

## Reading rules (GM review of intake 3, 24-11-2026)

| Rule | Where |
|---|---|
| Files are typed PO / **OFFER** (our own price offer, e.g. "AKS_Revised Price.pdf") / BOM / DRAWING; the AI also types each document and its word wins. Prices and terms are read from the PO only; an offer is never read as the PO. | `src/lib/mailFiles.ts`, `extract.ts` (`documents`), `intake.ts` `aiKind()` |
| The mail thread goes to the AI oldest -> newest, each message dated, quoted text removed, newest kept when long; the LATEST message decides. Superseded statements are not flags. Open items at the latest mail come back as `pending` (with the date) and `latestPosition`. | `src/lib/mailThread.ts`, `extract.ts`; email portal returns the thread start + end (30k chars) |
| Our own company names / mail domains (in code) and our people / phone numbers (server setting `PO_OWN_CONTACTS`) never fill customer fields: blanked and yellow. | `normalise.ts` `ownCompanyHit()` |
| Drawing / GTP no. holds document numbers only; an item list is removed. | `normalise.ts` `drawingNumbersOnly()` |
| Docket: the customer's own offers first, the latest revision (highest docket no.) pre-selected; other parties only under "Other matches". | `checks.ts` `rankDockets()` |
| PO rate vs quote: quoted price is per the offer's price unit (`uom_of_qtn`); per-NOS / per-MTR rates are converted with the unit weight (`weight_per_piece`); 11 kV never matches 33 kV; sizes must match exactly; a line with no item on the offer is flagged "item not in offer". | `checks.ts` |
| Drawing status comes from the PO and the latest mail; pending items put the order on hold with the item and the mail date. | `intake.ts` `suggestHold()` |
| HSN from the item master when the PO has none (marked "item master", yellow); missing -> flagged. GST "extra at actual" -> 18 % as per law, GST and total calculated (yellow). | `src/lib/po/hsn.ts`, `src/lib/po/enrich.ts` |
| No delivery date on the PO -> proposed PO date + standard lead time with an Accept button; the field stays yellow until accepted. | `enrich.ts`, review screen |
| BOM Excel / CSV attachments have a preview (sheet tabs) in the file viewer. | `sheetPreview.ts`, `shared.tsx` |
| **Read again** on the review screen re-reads a PO with the current rules (mail: through n8n; upload: from the stored files); the old reading is discarded and logged. | `intake.ts` `rereadIntake()` |

## Only POs we received; orders made automatically (25-11-2026)

- **Direction.** Only POs a party sent TO Ceebuild count. Left out of the PO mail list and never made
  into orders: our purchase team's POs to suppliers (subject "P.O-125/Durga Trading Company/...",
  "P.O REQUIRED", PO no. "CB-PO/...", material delivered to our works at Dhulagarh / Sankrail with no
  project) and bounce / auto-reply mails. Rules in `src/lib/po/direction.ts`; the AI prompt says the same.
- **Laser Power & Infra is a buyer.** It places most POs on Ceebuild, so its name / GSTIN / billing
  address stay in the customer fields; only Ceebuild (also misspelt "Cee Bulid") is blanked. Laser's
  people and mail ids are still never the customer contact.
- **Customer from the mail** when the PO does not name the buyer clearly: the sender's company name,
  else the docket party matching the sender's mail domain (lanarsy.com -> LANARSY INFRA LIMITED).
- **Automatic orders.** Each 15-minute n8n call (`GET /api/n8n/po-mails`) first runs
  `autoCreateOrders`: a PO read at least 5 minutes ago becomes an order (user "n8n (automatic)", edit
  log as usual, hold from the latest mail, indent job runs) when the docket is unambiguous
  (`autoDocketPick`): same party; same utility when the PO names one; offer entered no later than
  7 days after the PO date; and the only such offer, or the latest revision that also matches the
  items best (within 5 points, at least 50 %); no newer offer to the party with the utility blank.
  Optional fields that cannot be saved as read (e.g. GST "15.12.000.00") are left blank and named in
  the order remarks. Everything else waits on **Orders -> "POs received by mail – not orders yet"**
  with the reason; "Make orders now" runs the same check at once.

## Indent job (runs on Confirm, "Re-run" on the PO tab)

| Step | What it does | Stops with |
|---|---|---|
| Hold | Order on hold → nothing else runs | `ON_HOLD` |
| BOM | Attached BOM workbook (structure-wise SBPDCL layout read with set counts; else columns auto-mapped) → else the BOM table read from the PO/drawing → else the quotation BOM copied at order creation | `BOM_NEEDED` |
| BOM check | No flags → marked ✓ Correct by the job; flags → user fixes on the BOM tab | `BOM_FLAGS` |
| Indent | Draft PRIMARY indent, Mixed (custom + 6 m) | `INDENT_DRAFTED` |

The job never issues an indent; a person checks and issues it on the RM Indent tab.

## Hold – "BOM/drawing on hold – awaiting client confirmation"

Suggested on the review screen when the PO says the drawing / BOM is still to be approved or confirmed
(this wins over attached drawings: mail threads often carry older ones), or when the PO does not show the
drawing as approved at all (no approval letter, no Approved Drawing Library match, no drawing/BOM attached). The reviewer can tick or untick
it. While on hold the order status shows the hold and the indent job stops. **Client confirmed –
release hold** on the PO tab continues the job. Set/release is logged.

## Set-up

`.env.production` (server only, never in the database or the browser):

```
N8N_WEBHOOK_URL="https://pujagrwal1506.app.n8n.cloud/webhook"
N8N_WEBHOOK_KEY="..."   # same value as WEBHOOK_KEY / "Key OK?" in both n8n workflows
N8N_API_KEY="..."       # same value as the x-api-key header in the reader workflow
MAIL_API_URL="http://192.168.1.190:6002"   # email portal (Match Emails Portal backend), LAN
GEMINI_API_KEY=""       # leave empty: Gemini runs in n8n. Set only to call Gemini directly.
GEMINI_MODEL=""         # optional, default gemini-2.5-flash
PO_OWN_CONTACTS="Name One; Name Two; 98xxxxxxxx"   # our own people + phones: never filled into customer fields
```

n8n: run `python infrastructure/cloudflare/m15_setup.py` once (creates the service token and saves it
to `C:\Users\Niloy Paul\cf-ceebuild-service-token-gmdalui.co.in.txt`), paste the id / secret into the two
dashboard HTTP nodes of the reader workflow, then activate both workflows.

The older Gmail-API mailbox picker (`GMAIL_*`, `npm run gmail-auth`) is still supported but not needed
when the mail archive is set.

S3 storage must be configured (the PO copy is kept against the order).

## Deploy

1. Back up the database (`pg_dump -Fc`).
2. `npx prisma migrate deploy` applies `20261124090000_m15_po_intake`: new nullable columns on
   `orders`, `plan_settings.lead_time_days` (default 45), new tables `order_po_lines`,
   `order_documents`, `po_intakes`. No existing data is changed.
3. Add the env values above and restart.
4. Cloudflare + n8n as in Set-up; activate the two n8n workflows.

## Code

- `src/lib/po/` – field list, normalisers, checks, docket/rate matching (pure; `tests/po.test.ts`).
- `src/lib/gemini.ts` – Gemini (direct with a key, or through the n8n proxy); `src/lib/n8n.ts` – n8n link.
- `src/lib/mailDb.ts` – mail archive via the email portal route `/api/db-emails/ceebuild-po`
  (`Match Emails Portal/Backend/server.js`; the dashboard has no MySQL login); `src/lib/mailFiles.ts` – attachment pairing / typing.
- `src/app/api/n8n/po-mails`, `src/app/api/n8n/po-intake` – the endpoints n8n calls.
- `src/lib/mailbox.ts` – Gmail API client (older picker).
- `src/modules/poIntake/server/` – `extract.ts` (prompt + schema), `intake.ts` (attach → review →
  confirm), `job.ts` (indent job, hold), `orderPo.ts` (PO tab), `columns.ts` (field ↔ column).
- `src/modules/poIntake/ui/` – `PoIntakePage.tsx` (`/orders/new`), `MailArchive.tsx` (waiting list,
  mail picker), `OrderPoTab.tsx`, `shared.tsx`.
- `src/app/actions/poIntake.ts` – server actions.
