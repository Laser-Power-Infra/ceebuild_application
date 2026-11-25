# Power BI → Ceebuild dashboard daily feed (Rev 2 §5 / §8, Puja 25-11)

No dependency on Vikas ji or ERP database access: the data comes from Power BI through Puja's Microsoft 365 login.

```
Power Automate (Puja's M365)          n8n (cloud)                               Ceebuild dashboard
02:00 daily                           "Ceebuild – Power BI daily feed"          /api/n8n/erp-import
Run a query against a dataset  ──►    webhook ceebuild-erp-feed        ──►      upsert (content hash, never delete)
(one action per source)               key check, 5,000-row parts                freight lanes + RM PO rates refreshed
                                      03:30 check: source not loaded            run log in edit-logs
                                      in 30 h → mail Minmoy
```

## Flow (Power Automate, cloud flow, owner Puja)

1. **Trigger:** Recurrence, every 1 day at 02:00 (India Standard Time), after the Power BI dataset refresh.
2. **For each source** (3 parallel branches):
   - Action **Power BI → Run a query against a dataset** (workspace + dataset of the report; query below).
   - Action **HTTP** (premium connector; if not licensed, see Fallback):
     - Method `POST`, URI `https://pujagrwal1506.app.n8n.cloud/webhook/ceebuild-erp-feed`
     - Headers: `Content-Type: application/json`, `x-ceebuild-key: <key given separately>`
     - Body: `{ "source": "FREIGHT", "label": "Power BI @{utcNow()}", "rows": @{body('Run_a_query_against_a_dataset')?['results'][0]['tables'][0]['rows']} }`
       (n8n also accepts the raw action output as `{ "source": ..., "results": [...] }`.)
3. **On failure** (Configure run after → has failed): send an e-mail to Minmoy with the action error.

Only rows changed in the last 3 days are sent each night (the filters below), so a run stays small; rows already in the
dashboard are skipped, so re-sending is harmless. For a full reload, remove the date filter once.

## Queries (DAX) – to confirm table / column names on the dataset

Exact names: open the report → **Optimize → Performance analyzer → Start recording → refresh the visual → Copy query**.
The column names below are the ones in the 25-11 exports; the dashboard accepts either `Column` or `Table[Column]`.

```dax
// FREIGHT – FREIGHT HISTORY RECORD, FO table
EVALUATE
FILTER (
    'FO',
    'FO'[OUR DOC DATE] >= TODAY () - 3 || 'FO'[FO_DATE] >= TODAY () - 3
)
```

```dax
// PO – CEEBUILD INDENT TO EXECUTION, PO details
EVALUATE
FILTER ( 'PO Details', 'PO Details'[Ord. Dt.] >= TODAY () - 3 )
```

```dax
// INDENT – CEEBUILD INDENT TO EXECUTION, Indent details (PO qty / balance change after the indent date: send all open ones)
EVALUATE
FILTER ( 'Indent Details', 'Indent Details'[Indent date] >= TODAY () - 3 || 'Indent Details'[Bal to Po] > 0 )
```

Next sources (same pattern, new `source` names to be added on the dashboard when their tables are known): Stock, Debtors,
Creditors, Pay & Received, Order to execution, PURCHASE HISTORY (RM / N&B / zinc PO-GRN rates).

## Fallback (if "Run a query against a dataset" is not allowed on these reports)

- **Export to file for Power BI reports** (same flow) → CSV → mail to a dedicated inbox; n8n reads the attachment
  (Gmail trigger) and posts it to the same dashboard endpoint, or
- **Power BI subscription with data attachment** to the same inbox.
- Until the flow is live, Puja exports by hand; the files are loaded with `scripts/m14_import_pbi.ts` (same hashing,
  so nothing is duplicated).

## Status (25-11)

- Dashboard endpoint `/api/n8n/erp-import`: live. Seed loaded: PO 1,400 · indent 242 · freight 39,708; re-sending the same
  files inserts 0 rows (tested).
- n8n "Ceebuild – Power BI daily feed": published, tested end to end (Cloudflare → dashboard).
- Needed from Puja: create the Power Automate flow on her account (or share the dataset with the flow owner), and confirm
  the table names from Performance analyzer. Target: live 27-11.
