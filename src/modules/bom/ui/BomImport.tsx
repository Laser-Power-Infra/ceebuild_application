'use client';

import { useState } from 'react';
import { Modal, FormError, fieldCls, labelCls } from '@/components/Modal';
import { Button } from '@/components/ui/button';
import { importBomAction, previewBomAction } from '@/app/actions/bom';
import { FIELD_LABELS, PIECE_FIELDS, type ColumnMap, type PieceField } from '@/lib/bom/parse';

type Preview = Extract<Awaited<ReturnType<typeof previewBomAction>>, { success: true }>['data'];

/** Upload a client BOM: pick file -> check sheet, header row and column mapping -> import. */
export function BomImport({ orderId, onClose, onImported }: { orderId: number; onClose: () => void; onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [map, setMap] = useState<ColumnMap>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (f: File, sheet?: string, headerRow?: number) => {
    setBusy(true);
    setError('');
    const form = new FormData();
    form.set('file', f);
    if (sheet) form.set('sheet', sheet);
    if (headerRow !== undefined) form.set('headerRow', String(headerRow));
    const r = await previewBomAction(form);
    setBusy(false);
    if (!r.success) return setError(r.error);
    setPreview(r.data);
    setMap(r.data.map);
  };

  const doImport = async () => {
    if (!file || !preview) return;
    setBusy(true);
    setError('');
    const form = new FormData();
    form.set('file', file);
    form.set('orderId', String(orderId));
    form.set('sheet', preview.sheetName);
    form.set('headerRow', String(preview.headerRow));
    form.set('map', JSON.stringify(map));
    const r = await importBomAction(form);
    setBusy(false);
    if (!r.success) return setError(r.error);
    onImported();
  };

  return (
    <Modal title="Upload client BOM" onClose={onClose} wide>
      <div className="flex flex-col gap-4">
        <div>
          <label className={labelCls} htmlFor="bom-file">Excel file (.xlsx, .xls, .csv; max 20 MB)</label>
          <input
            id="bom-file"
            type="file"
            accept=".xlsx,.xlsm,.xls,.csv"
            className="block text-sm"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              setPreview(null);
              if (f) void load(f);
            }}
          />
        </div>

        {preview && file && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls} htmlFor="bom-sheet">Sheet</label>
                <select id="bom-sheet" className={fieldCls} value={preview.sheetName} onChange={(e) => void load(file, e.target.value)}>
                  {preview.sheets.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls} htmlFor="bom-header">Header row (spreadsheet row number)</label>
                <input
                  id="bom-header"
                  type="number"
                  min={1}
                  className={fieldCls}
                  value={preview.headerRow + 1}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isInteger(n) && n >= 1) void load(file, preview.sheetName, n - 1);
                  }}
                />
              </div>
            </div>

            <div>
              <p className={labelCls}>Columns ({preview.dataRows} data rows). Check each field points at the right column.</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-5">
                {PIECE_FIELDS.map((f: PieceField) => (
                  <div key={f}>
                    <label className="mb-0.5 block text-[11px] font-bold text-slate-600" htmlFor={`map-${f}`}>
                      {FIELD_LABELS[f]}
                    </label>
                    <select
                      id={`map-${f}`}
                      className={`${fieldCls} py-1 text-xs ${map[f] ? '' : 'text-slate-400'}`}
                      value={map[f] ?? ''}
                      onChange={(e) => setMap((m) => ({ ...m, [f]: e.target.value || undefined }))}
                    >
                      <option value="">— not in file —</option>
                      {preview.headers.filter(Boolean).map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Needed: Mark no or Section, Length, and Total qty or Qty per set. A length column headed in metres (e.g. &quot;Length (m)&quot;) is converted to mm.
              </p>
            </div>

            <div className="max-h-64 overflow-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-slate-100">
                  <tr>
                    {preview.headers.map((h, i) => (
                      <th key={i} className="whitespace-nowrap px-2 py-1 text-left font-bold text-slate-700">
                        {h || <span className="text-slate-400">(blank)</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((r, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      {r.map((c, j) => (
                        <td key={j} className="whitespace-nowrap px-2 py-1 text-slate-700">{c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <FormError error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!preview || busy} onClick={doImport}>
            {busy ? 'Working…' : 'Import and check'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
