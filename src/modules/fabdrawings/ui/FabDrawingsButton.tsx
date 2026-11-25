'use client';

import { useState } from 'react';
import { DraftingCompass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { generateFabDrawingsAction } from '@/app/actions/fabdrawings';

function downloadPdf(base64: string, fileName: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** "Generate fabrication drawings" for a confirmed item BOM: downloads the PDF (a DRAFT revision). */
export function FabDrawingsButton({ bomId, onError }: { bomId: number; onError: (e: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const run = async () => {
    setBusy(true);
    setDone('');
    let r = await generateFabDrawingsAction(bomId, {});
    // After an issued revision a change note is required for the next Rev.
    if (!r.success && /change note/i.test(r.error)) {
      const note = window.prompt(`${r.error}\n\nChange note:`);
      if (note?.trim()) r = await generateFabDrawingsAction(bomId, { changeNote: note });
    }
    setBusy(false);
    if (!r.success) return onError(r.error);
    downloadPdf(r.data.base64, r.data.fileName);
    setDone(`${r.data.drawingNo} Rev ${r.data.rev}: ${r.data.pageCount} sheets, ${r.data.toConfirm} point(s) to confirm`);
  };
  return (
    <>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void run()} title="A3 PDF from this confirmed BOM: notes, design decisions, member sheets and the cutting list (DRAFT until production confirms)">
        <DraftingCompass /> {busy ? 'Generating…' : 'Generate fabrication drawings'}
      </Button>
      {done && <span className="self-center text-xs text-slate-600">{done}</span>}
    </>
  );
}
