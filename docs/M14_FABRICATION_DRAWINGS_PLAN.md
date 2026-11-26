# M14 – Fabrication drawings from the BOM: plan (25-11-2026)

Request: Puja, 25-11-2026. Flow: order → BOM → approved drawing → RM indent → **fabrication drawing** → production confirms → cutting.
**Status 26-11:** slice 1 (25-11: standards master, A3 PDF, cutting list) and part 2 (26-11: geometry per mark with
library reuse, revisions with stored PDF, issue log, production confirmation, out-of-date check, cutting gate) are live.
Still open: assembly templates (panel / gate GA views), hole / bend counts into `piece_routings`, the n8n mail sender to
Satya (needs his e-mail and the sending account), Lanarsy and JSW templates.

Inputs: `docs/m14-rev2-reference/` (her generator `.py.txt`, KESCo Rev 0 PDF, KESCo BOM xlsx). Plan only; no code yet.

## 1. What we build
- **Order page → "Generate fabrication drawings"**. Shown when the order BOM is "✓ Correct" and it has an RM indent that is not cancelled.
- **One PDF, A3 landscape**, vector. Every sheet has a frame and title block: Ceebuild Company Pvt. Ltd., project, drawing no.
  `CB/<client>/<item>/<sheet>` (e.g. CB/KESCo/FEN/01), Rev, date, basis (approved drawing ref.), prepared / checked / approved.
- **Sheet 1**: general arrangement, notes, "design decisions" and "to be confirmed by production before cutting".
- **Sheets 2…n**: one per assembly / member type: elevation, overall dimensions, marks, holes (dia, gauge, edge), bends, welds, qty per set.
- **Last sheet**: cutting list per set and total (mark, section, cut length, qty, holes, bend/weld, bar it is cut from).
- **Drawing standards master** (Admin only), **revisions + issue log**, **mail to Satya cc management**, **confirmation gate on cutting**.

## 2. Rendering decision: pdf-lib inside the dashboard (no Python)
| Option | For | Against |
|---|---|---|
| **pdf-lib (pure JS) in the Next.js server – chosen** | No native code, no font files read from disk, so the `output: 'standalone'` Docker build works unchanged. Vector lines, circles, SVG paths, text width measuring. Can embed a page of the approved-drawing PDF on sheet 1. Testable with the existing `node --test` suite. | We draw primitives ourselves (arrows, dimensions, tables). ~1 day for a small helper library. |
| pdfkit | Richer API (dash, clip, text wrap). | Reads AFM font files from `node_modules` at run time; standalone tracing misses them. Needs extra Next config. |
| Her Python/matplotlib in a sidecar or n8n | Code exists. | The app image is `node:20-alpine` with no Python. A new container + matplotlib (~150 MB), a second code path and a data API. n8n's Python cannot load matplotlib. **Her script is KESCo-specific (hard-coded), so it must be rewritten as templates either way.** |

Fonts: Helvetica (standard PDF font) covers ×, –, ±, Ø, °. Coordinates in mm on a 420 × 297 sheet; each view auto-scales and is marked "Not to scale – dims in mm".
Code: `src/lib/fabdrawing/` (pure: `primitives.ts` frame / title block / dimension / hole / weld symbol / table; `templates/` member, panel, gate, bent flat, clamp; `render.ts`) and `src/modules/fabdrawings/server/` (build the model from the DB, save, issue, confirm). PDF stored in S3 (`src/lib/s3.ts`, key `fab-drawings/<order>/…`) and opened through the existing `/api/attachments/[key]` route (PDF already allowed inline).
Note: `node_modules/next/dist/docs` is not present in the installed Next 16.4.6; Server Action / route-handler conventions will be checked against the existing code before coding.

## 3. Data model (one migration, database backup first)
| Table | Purpose / key fields |
|---|---|
| `drawing_standards` | Admin-editable rules. `kind` + `key` + value + unit + note. Seed: HOLE (M10→11.5, M12→13.5, M16→17.5, rule dia + 1.5, method PUNCHED); GAUGE by angle leg per IS SP:6 (40→22, 50→28, 65→35, 75→40, rest of the SP:6 table to be confirmed); EDGE (1.5 × hole dia, default 25 for 50-wide flats); WELD (mesh tack 25 @ 150 c/c; strip-to-rail fillet both sides, size 4); FINISH (paint text, HDG IS 2629 text, chosen from the BOM `painted` / `galvanised` flags); MATERIAL, TOLERANCE, MARKING notes; MAIL (production to, management cc); CONFIRMERS (users allowed to confirm). Every change audited. |
| `drawing_features` | Geometry the BOM lacks, per mark. Type HOLE / SLOT / BEND / WELD / NOTCH; position from end A, offset or gauge, leg/face, dia or bolt size, count + pitch, bend angle + inside radius, weld type/size/length/pitch, note. `source` = DRAWING (on the customer drawing) / STANDARD (filled from the rules) / MANUAL. `toConfirm` flag. Linked to an **approved-drawing library line** (reused on every later order of that drawing) or, as an override, to one order's BOM line. |
| `drawing_assemblies` | One per assembly / sheet: template (MEMBER, PANEL, GATE, BENT_FLAT, CLAMP), parameters (JSON, e.g. width 3000, height 2400, rail levels 25/1200/2375, strip pitch 500), members (mark + qty per assembly), assemblies per set. Linked to the approved drawing or to the order. |
| `fab_drawing_sets` | One row per PDF revision: order, item / structure scope, client code, item code, rev 0, 1…, change note, status DRAFT → ISSUED → CONFIRMED, or SUPERSEDED / OUT_OF_DATE; basis ref; `bomUploadId` + `indentId`; cutting-list hash; snapshots of standards and geometry used; S3 key; prepared / checked / approved names + dates; confirmed by / at / remarks. |
| `fab_drawing_issues` | Issue log: set, sent at, to, cc, sent by, n8n message id, result. |

Where geometry comes from, in order: (1) approved-drawing library features, (2) order override, (3) standards defaults (hole dia from bolt size, gauge from leg, edge distance, weld rules) – these are listed automatically as **design decisions**; anything flagged `toConfirm` goes to the **to-be-confirmed** list. A mark with no geometry still gets a plain member view; sheet 1 lists it as "holes not defined".
On confirmation, hole / bend / weld counts are written to `piece_routings`, so the machine plan uses the drawing.

## 4. Cutting list = RM indent, by construction
- The cutting list is not recalculated. It is built from the same `bom_pieces` (the "✓ Correct" upload) that `loadPlanningInput` gives the indent; the mark is mapped back through `raw.itemBomLineId`.
- The set stores `bomUploadId`, `indentId` and a hash of (mark, section, cut length, total qty). Generation checks it against the indent's stored bar patterns (every cut of every pattern). Any difference = no PDF, with the rows shown.
- The drawing never changes a length. If a bent member's developed length differs from the BOM length, generation stops: fix the BOM, re-run the indent.
- A new BOM upload or a new / cancelled indent marks the set **OUT_OF_DATE**; it cannot be issued or confirmed until a new Rev is made.
- The cutting list shows the indent bar per mark (e.g. 5600 = 2 × 2800).

## 5. Revisions, issue and confirmation gate
- Generate = new DRAFT Rev (Rev 0 first). Later Revs need a change note; on issue the previous Rev is marked SUPERSEDED (also stamped on its PDF).
- **Issue**: dashboard calls n8n (`callN8n`, like PO intake) – new workflow "Ceebuild – Send fabrication drawing" sends from the company Gmail to Satya, cc management, PDF attached, and returns the message id. The dashboard itself cannot send (its Gmail access is read-only).
- **Confirm**: a user in CONFIRMERS (Satya) ticks each to-be-confirmed item, adds remarks, presses "Confirmed by production". If he wants a change → new Rev. Fallback: Admin records his mail reply with a reference.
- **Gate**: Production entries for CROPPING / SHEARING are refused for a mark until a CONFIRMED, current set covers it. Admin override only with a reason (audited). The production plan shows "drawing not confirmed".

## 6. Phases and dates (work days Mon–Sat)
| # | Work | Days | Done by |
|---|---|---|---|
| 0 | Plan sign-off, questions below answered | 0.5 | Thu 26-11 |
| 1 | Migration + standards master page (Admin) + seed | 1 | Fri 27-11 |
| 2 | Geometry: features + assemblies editor, defaults from standards, library reuse | 2 | Mon 30-11 |
| 3 | pdf-lib renderer: primitives, title block, sheet 1, member / panel / gate templates, cutting list; KESCo test | 3 | Thu 03-12 |
| 4 | Revisions, issue log, n8n mail, confirm, cutting gate, out-of-date check | 1 | Fri 04-12 |
| 5 | **KESCo acceptance with Puja, deploy** | 1 | **Sat 05-12** |
| 6 | Lanarsy SBPDCL: cross arms, clamps (bent), channels; many structures per order | 2 | Tue 08-12 |
| 7 | JSW pipe earthing: flats C and D (bent flat) | 1 | Wed 09-12 |
| 8 | Buffer, fixes, handover note | 1 | **Thu 10-12** |

**Targets: KESCo live Sat 05-12-2026; all three test cases Thu 10-12-2026.**
KESCo acceptance: same 5 sheets, same marks, lengths, qty/set, holes, notes and design decisions as Rev 0; cutting list equal to the KESCo indent (custom 5600 / 4700 / 4400); totals for 262 + 99 sets. Checked by an automated test that reads the PDF text.

## 7. Points found in Rev 0 (need Puja's call)
1. Type B panel P4: sheet 3 and the BOM give **18** strips (3 × 26 + 18 = 96); note 7 on sheet 1 says **17**. We will print 18 unless told otherwise.
2. Rev 0 title block has no checked / approved boxes and says "Prepared: Claude for Puja Agarwal". New title block uses dashboard user names.
3. Rev 0 cutting list has per-set qty only; the new one adds total qty (× 262 / × 99), as asked in point 4.

## 8. Risks
| Risk | Mitigation |
|---|---|
| Holes / bends are not in any BOM; entry takes time per drawing | Entered once per approved drawing and reused; standards fill most of it; templates generate rail / post holes. |
| Lanarsy has ~30 structures – one huge PDF | One set per item / structure group, same numbering. |
| "Generic" drawings look poorer than hand-made ones | Templates for repeat products (fencing, cross arm, clamp, earthing flat); plain member sheet for the rest. |
| KESCo order not yet in the dashboard | Test on a fixture built from the KESCo docket BOM (CEE-000536) until the PO comes. |
| Mail sent from wrong account / not delivered | n8n returns the message id; failure logged and shown; resend button. |
| Gate blocks urgent work | Admin override with reason, audited. |

## 9. Needed from Puja / Satya
- **Puja**: OK on pdf-lib and the target dates; answer section 7; client / item codes (KESCo/FEN…); who prepares / checks / approves; management cc list; which Gmail account sends; is the KESCo PO coming (order) or test on the docket.
- **Satya**: confirm Rev 0 items 2, 3 and 5 (gauge 22, hole levels 475 / 1600 / 2775, mesh tack 25 @ 150); the full gauge table he uses; punch sizes available; dashboard login for confirming (or confirm by mail reply).
- **Both**: Lanarsy SBPDCL and JSW approved drawings as PDF (hole positions, bend details) by Mon 30-11.
