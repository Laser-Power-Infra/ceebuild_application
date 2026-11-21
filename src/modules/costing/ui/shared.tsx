'use client';

import { useState } from 'react';
import { FileUp, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { extractAiAction, extractSheetAction } from '@/app/actions/costing';
import { CATEGORIES, CATEGORY_LABELS } from '@/lib/costing/calc';
import type { BomLineDraft } from '@/lib/costing/drawings';

export const cellInput = 'h-8 w-full rounded border border-slate-300 bg-white px-2 text-[13px] text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-900';
export const th = 'border-b border-slate-300 bg-slate-100 px-2 py-2 text-left text-xs font-bold uppercase tracking-wide text-slate-800';
export const td = 'border-b border-slate-200 px-2 py-1.5 align-middle text-[13px] text-slate-900';
export const card = 'rounded-xl border border-slate-200 bg-white p-4';

export const inr = (n: number | null | undefined, d = 2) =>
  n === null || n === undefined || Number.isNaN(n) ? '–' : n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });

// ---------------------------------------------------------------------------
// PDF text / images in the browser (pdf.js from cdnjs, loaded on first use).
// ---------------------------------------------------------------------------

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

type PdfJs = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: { data: ArrayBuffer }) => { promise: Promise<PdfDoc> };
};
type PdfPage = {
  getTextContent: () => Promise<{ items: { str?: string; transform?: number[] }[] }>;
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
};
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> };

async function loadPdfJs(): Promise<PdfJs> {
  const w = window as unknown as { pdfjsLib?: PdfJs };
  if (!w.pdfjsLib) {
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDFJS;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load the PDF reader.'));
      document.body.appendChild(s);
    });
  }
  w.pdfjsLib!.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  return w.pdfjsLib!;
}

/** Text of a PDF with rows kept on one line (items grouped by their y position), plus page images when there is no text. */
export async function readPdf(file: File): Promise<{ text: string; images: string[] }> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = Math.min(doc.numPages, 15);
  let text = '';
  for (let p = 1; p <= pages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const it of tc.items) {
      if (!it.str || !it.str.trim() || !it.transform) continue;
      const y = Math.round(it.transform[5] / 3) * 3;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y)!.push({ x: it.transform[4], s: it.str.trim() });
    }
    const lines = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, r]) => r.sort((a, b) => a.x - b.x).map((c) => c.s).join(' | '));
    text += `\n--- page ${p} ---\n${lines.join('\n')}`;
  }
  const images: string[] = [];
  if (text.replace(/[\s|-]|page \d+/g, '').length < 40) {
    for (let p = 1; p <= Math.min(doc.numPages, 2); p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1.6 });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width;
      canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
      images.push(canvas.toDataURL('image/jpeg', 0.8));
    }
  }
  return { text, images };
}

/** Upload a drawing/BOM (PDF or xlsx) and get draft lines back (AI for PDFs). */
export function DrawingExtractor({ onLines, disabled }: { onLines: (lines: BomLineDraft[], note: string, file: File) => void; disabled?: boolean }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const run = async (file: File) => {
    setError('');
    try {
      if (/\.pdf$/i.test(file.name)) {
        setBusy('Reading PDF…');
        const { text, images } = await readPdf(file);
        setBusy('AI is extracting the piece list…');
        const r = await extractAiAction({ text, images, fileName: file.name });
        if (!r.success) throw new Error(r.error);
        onLines(r.data.lines, r.data.note, file);
      } else {
        setBusy('Reading sheet…');
        const fd = new FormData();
        fd.set('file', file);
        const r = await extractSheetAction(fd);
        if (!r.success) throw new Error(r.error);
        onLines(r.data.lines, r.data.note, file);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the file.');
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <label className={`inline-flex h-9 w-fit cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium hover:bg-slate-50 ${disabled || busy ? 'pointer-events-none opacity-60' : ''}`}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
        {busy || 'Upload drawing / BOM (PDF or xlsx)'}
        <input
          type="file"
          accept=".pdf,.xlsx,.xlsm,.xls,.csv"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void run(f);
          }}
        />
      </label>
      <p className="flex items-center gap-1 text-xs text-slate-700">
        <Sparkles className="h-3 w-3" /> PDF drawings are read by AI (mark no, section, length, qty per set); spreadsheets by their column headings. You check every line before saving.
      </p>
      {error && <p className="text-xs font-semibold text-rose-800">{error}</p>}
    </div>
  );
}

const numOrNull = (s: string) => {
  const n = Number(s.replace(/,/g, ''));
  return s.trim() === '' || Number.isNaN(n) ? null : n;
};

/** Editable draft lines (nothing saved until the caller saves them). */
export function DraftLinesEditor({ lines, onChange }: { lines: BomLineDraft[]; onChange: (l: BomLineDraft[]) => void }) {
  const set = (i: number, patch: Partial<BomLineDraft>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="max-h-[50vh] overflow-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[900px] border-collapse">
        <thead className="sticky top-0">
          <tr>
            <th className={th}>#</th>
            <th className={th}>Mark</th>
            <th className={th}>Description</th>
            <th className={th}>Section / size</th>
            <th className={th}>Length mm</th>
            <th className={th}>Qty / set</th>
            <th className={th}>kg/m (drg)</th>
            <th className={th}>Unit wt kg</th>
            <th className={th}>Category</th>
            <th className={th} />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className={`${td} text-slate-700`}>{i + 1}</td>
              <td className={td}><input className={cellInput} value={l.markNo ?? ''} onChange={(e) => set(i, { markNo: e.target.value || null })} /></td>
              <td className={td}><input className={cellInput} value={l.description ?? ''} onChange={(e) => set(i, { description: e.target.value || null })} /></td>
              <td className={td}><input className={cellInput} value={l.section ?? ''} onChange={(e) => set(i, { section: e.target.value || null })} /></td>
              <td className={td}><input className={`${cellInput} text-right`} inputMode="decimal" value={l.lengthMm ?? ''} onChange={(e) => set(i, { lengthMm: numOrNull(e.target.value) })} /></td>
              <td className={td}><input className={`${cellInput} text-right`} inputMode="decimal" value={l.qtyPerSet ?? ''} onChange={(e) => set(i, { qtyPerSet: numOrNull(e.target.value) })} /></td>
              <td className={td}><input className={`${cellInput} text-right`} inputMode="decimal" value={l.kgPerM ?? ''} onChange={(e) => set(i, { kgPerM: numOrNull(e.target.value) })} /></td>
              <td className={td}><input className={`${cellInput} text-right`} inputMode="decimal" value={l.unitWtKg ?? ''} onChange={(e) => set(i, { unitWtKg: numOrNull(e.target.value) })} /></td>
              <td className={td}>
                <select className={cellInput} value={l.category} onChange={(e) => set(i, { category: e.target.value as BomLineDraft['category'] })}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                  ))}
                </select>
              </td>
              <td className={td}>
                <button type="button" aria-label={`Remove line ${i + 1}`} className="rounded p-1 text-slate-700 hover:text-rose-600" onClick={() => onChange(lines.filter((_, j) => j !== i))}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-slate-100 p-1.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange([...lines, { markNo: null, description: null, section: null, sectionKey: null, lengthMm: null, qtyPerSet: null, kgPerM: null, unitWtKg: null, category: 'STRUCTURE', rateKey: null }])}
        >
          <Plus /> Add line
        </Button>
      </div>
    </div>
  );
}

export function Badge({ tone, children }: { tone: 'green' | 'amber' | 'red' | 'blue' | 'slate'; children: React.ReactNode }) {
  const cls = {
    green: 'border-emerald-300 bg-emerald-100 text-emerald-900',
    amber: 'border-amber-300 bg-amber-100 text-amber-900',
    red: 'border-rose-300 bg-rose-100 text-rose-900',
    blue: 'border-blue-300 bg-blue-100 text-blue-900',
    slate: 'border-slate-300 bg-slate-100 text-slate-800',
  }[tone];
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${cls}`}>{children}</span>;
}
