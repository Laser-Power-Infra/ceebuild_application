'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, BookPlus, CheckCircle2, FileSpreadsheet, Library, Lock, Pencil, Plus, RefreshCw, Trash2, Unlock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormError, Modal, fieldCls, labelCls } from '@/components/Modal';
import {
  addBomLineAction,
  addGroupFromDrawingAction,
  deleteGroupAction,
  listDrawingsAction,
  updateGroupAction,
  addBomToLibraryAction,
  archiveDrawingAction,
  confirmItemBomAction,
  createBomFromDrawingAction,
  createBomFromLinesAction,
  deleteBomLineAction,
  itemCostingAction,
  previewCostingAction,
  reopenItemBomAction,
  saveCostingAction,
  suggestDrawingsAction,
  updateBomLineAction,
  updateBomMetaAction,
} from '@/app/actions/costing';
import { CATEGORIES, CATEGORY_LABELS, DISCOUNT_LABELS, DISCOUNT_MODES, SCOPES, SCOPE_LABELS, type Category, type Scope } from '@/lib/costing/calc';
import { FAB_CATS, FAB_CAT_BY_CODE, fabCatLabel } from '@/lib/costing/fab';
import { MATCH_LABELS, type BomLineDraft, type MatchLevel } from '@/lib/costing/drawings';
import type { BomGroupRow, BomLineRow, DocketInfo, DrawingSuggestion, ItemBomInfo, ItemInfo } from '../server/itemBom';
import type { MixedGroup } from '@/lib/costing/mixedBom';
import type { DrawingRow } from '../server/drawings';
import type { CostingPreview, SavedCosting } from '../server/compute';
import { Badge, DraftLinesEditor, DrawingExtractor, card, cellInput, inr, td, th } from './shared';
import { FabDrawingsButton } from '@/modules/fabdrawings/ui/FabDrawingsButton';

type Data = { item: ItemInfo; docket: DocketInfo | null; bom: ItemBomInfo | null; suggestions: DrawingSuggestion[]; costings: SavedCosting[] };

const SOURCE_LABELS: Record<string, string> = { ENQUIRY_DRAWING: 'Drawing received with the enquiry', APPROVED_DRAWING: 'Our approved drawing', MANUAL: 'Entered manually' };
const levelTone = (l: string | null) => (l === 'UTILITY_ITEM' ? 'green' : l === 'STATE_ITEM' ? 'blue' : 'amber');
const today = () => new Date().toISOString().slice(0, 10);

export function ItemCostingPage({ itemId, role }: { itemId: number; role: string }) {
  const canEdit = role === 'Admin' || role === 'User';
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState<null | 'ENQUIRY' | 'APPROVED'>(null);

  const load = useCallback(async () => {
    const r = await itemCostingAction(itemId);
    if (!r.success) return setError(r.error);
    setData(r.data);
    setError('');
  }, [itemId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!data) return <div className="p-6 text-sm text-slate-700">{error || 'Loading…'}</div>;
  const { item, docket, bom } = data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-700">
            <Link href="/?tab=dockets" className="inline-flex items-center gap-1 hover:text-slate-800">
              <ArrowLeft className="h-3.5 w-3.5" /> Dockets
            </Link>
            {docket && (
              <>
                <span>/</span>
                <Link href={`/costing/docket/${docket.id}`} className="hover:text-slate-800">{docket.docketNo} costing</Link>
              </>
            )}
          </div>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">BOM &amp; costing – {item.itemNameParty || item.ourItemName || `item #${item.id}`}</h1>
          <p className="text-xs text-slate-700">
            {docket ? `${docket.docketNo} · ${docket.partyName ?? ''} · ${docket.utility ?? 'no utility'} · ${docket.state ?? ''}${docket.deliveryLocation ? ` → ${docket.deliveryLocation}` : ''}` : 'No docket found for this item'} · Qty{' '}
            <b>{item.qty ?? '–'} {item.uom ?? ''}</b> · Our item: {item.ourItemName ?? '–'} · Current price: <b>{item.price ? `Rs ${item.price}/${item.uomOfQtn ?? item.uom ?? ''}` : 'blank'}</b>
          </p>
        </div>
      </div>
      <FormError error={error} />

      {!bom || creating ? (
        <CreateBom data={data} canEdit={canEdit} mode={creating} setMode={setCreating} onDone={() => { setCreating(null); void load(); }} onError={setError} />
      ) : (
        <>
          <BomCard data={data} bom={bom} canEdit={canEdit} reload={load} onError={setError} onNew={(m) => setCreating(m)} />
          <CostingCard data={data} bom={bom} canEdit={canEdit} role={role} reload={load} onError={setError} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create BOM: (a) drawing received with the enquiry, (b) our approved drawing, or manual.
// ---------------------------------------------------------------------------

function CreateBom({
  data,
  canEdit,
  mode,
  setMode,
  onDone,
  onError,
}: {
  data: Data;
  canEdit: boolean;
  mode: null | 'ENQUIRY' | 'APPROVED';
  setMode: (m: null | 'ENQUIRY' | 'APPROVED') => void;
  onDone: () => void;
  onError: (e: string) => void;
}) {
  const { item, docket } = data;
  const [draft, setDraft] = useState<BomLineDraft[]>([]);
  const [groups, setGroups] = useState<MixedGroup[] | null>(null);
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [drawingRef, setDrawingRef] = useState('');
  const [structureType, setStructureType] = useState(data.bom?.structureType ?? item.ourItemName ?? '');
  const [suggestions, setSuggestions] = useState<DrawingSuggestion[]>(data.suggestions);
  const [busy, setBusy] = useState(false);
  const tab = mode ?? (data.suggestions.length && !docket ? 'APPROVED' : 'ENQUIRY');

  const search = async () => {
    const r = await suggestDrawingsAction(item.id, structureType);
    if (!r.success) return onError(r.error);
    setSuggestions(r.data);
  };

  const saveDraft = async (source: 'ENQUIRY_DRAWING' | 'MANUAL') => {
    setBusy(true);
    let s3Key: string | null = null;
    if (file) {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('itemId', String(item.id));
      const a = await archiveDrawingAction(fd);
      if (a.success) s3Key = a.data;
    }
    const r = await createBomFromLinesAction(item.id, { source, lines: groups ? [] : draft, groups: groups ?? undefined, fileName: file?.name ?? null, s3Key, drawingRef, note, structureType });
    setBusy(false);
    if (!r.success) return onError(r.error);
    onDone();
  };

  return (
    <section className={card}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Create BOM</h2>
          <p className="text-xs text-slate-700">The quotation price is calculated from this BOM. It is copied into the order when the PO comes, so quotation and execution use the same numbers.</p>
        </div>
        {data.bom && (
          <Button variant="outline" size="sm" onClick={() => setMode(null)}>
            Cancel – keep current BOM
          </Button>
        )}
      </div>
      <div className="mb-3 flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
        <button type="button" onClick={() => setMode('ENQUIRY')} className={`flex-1 rounded-md px-3 py-1.5 font-medium ${tab === 'ENQUIRY' ? 'bg-white shadow' : 'text-slate-700'}`}>
          (a) Drawing received with the enquiry
        </button>
        <button type="button" onClick={() => setMode('APPROVED')} className={`flex-1 rounded-md px-3 py-1.5 font-medium ${tab === 'APPROVED' ? 'bg-white shadow' : 'text-slate-700'}`}>
          (b) Our approved drawing {suggestions.length ? `(${suggestions.length})` : ''}
        </button>
      </div>

      <div className="mb-3 grid max-w-xl grid-cols-[1fr_auto] items-end gap-2">
        <div>
          <label className={labelCls} htmlFor="st">Item / structure type (used to find approved drawings)</label>
          <input id="st" className={fieldCls} value={structureType} onChange={(e) => setStructureType(e.target.value)} placeholder="e.g. V Cross Arm 11 kV" />
        </div>
        <Button variant="outline" onClick={() => void search()}>
          <RefreshCw /> Search
        </Button>
      </div>

      {tab === 'ENQUIRY' ? (
        <div className="flex flex-col gap-3">
          <DrawingExtractor
            disabled={!canEdit}
            onLines={(l, n, f, extra) => {
              setDraft(l);
              setGroups(extra?.groups ?? null);
              setNote(n);
              setFile(f);
              if (!drawingRef) setDrawingRef(f.name.replace(/\.[^.]+$/, ''));
            }}
          />
          {note && <p className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-900">{note}</p>}
          <div className="max-w-xl">
            <label className={labelCls} htmlFor="dref">Drawing no. / reference</label>
            <input id="dref" className={fieldCls} value={drawingRef} onChange={(e) => setDrawingRef(e.target.value)} />
          </div>
          {groups ? <StructuresPreview groups={groups} onChange={setGroups} /> : <DraftLinesEditor lines={draft} onChange={setDraft} />}
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || (groups ? groups.length === 0 : draft.length === 0)} onClick={() => void saveDraft('ENQUIRY_DRAWING')}>
                <CheckCircle2 /> I have checked the lines – save BOM
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => void saveDraft('MANUAL')} title="Save the lines typed above as a manual BOM (no drawing)">
                <Pencil /> Save as manual BOM
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-slate-700">
            Search order: same utility + item → same state + item → any approved drawing of the item type (reference only – confirm). Utility: <b>{docket?.utility ?? '–'}</b>, states:{' '}
            <b>{[docket?.state, docket?.deliveryLocation].filter(Boolean).join(', ') || '–'}</b>.
          </p>
          {suggestions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-700">
              No approved drawing for “{structureType || '–'}”. Use the enquiry drawing, or add the drawing in the{' '}
              <Link href="/admin/drawings" className="text-blue-800 underline">Approved Drawing Library</Link>.
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={th}>Match</th>
                  <th className={th}>Drawing</th>
                  <th className={th}>Utility / state</th>
                  <th className={th}>Item type</th>
                  <th className={th}>Approval</th>
                  <th className={`${th} text-right`}>Lines</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {suggestions.map((s, i) => (
                  <tr key={s.id} className={i === 0 ? 'bg-emerald-50/40' : ''}>
                    <td className={td}><Badge tone={levelTone(s.level)}>{MATCH_LABELS[s.level]}</Badge></td>
                    <td className={`${td} font-semibold`}>{s.drawingNo} rev {s.revision}</td>
                    <td className={td}>{s.utility} / {s.state ?? '–'}</td>
                    <td className={td}>{s.itemType}</td>
                    <td className={td}>{[s.approvalLetterNo, s.approvalDate && `dt ${s.approvalDate}`].filter(Boolean).join(' ') || '–'}</td>
                    <td className={`${td} text-right`}>{s.lineCount}</td>
                    <td className={td}>
                      {canEdit && (
                        <Button
                          size="sm"
                          variant={i === 0 ? 'default' : 'outline'}
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            const r = await createBomFromDrawingAction(item.id, s.id, structureType);
                            setBusy(false);
                            if (!r.success) return onError(r.error);
                            onDone();
                          }}
                        >
                          Use this drawing
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Current BOM: lines with scope / category tags, confirm, add to library.
// ---------------------------------------------------------------------------

function EditCell({ line, field, disabled, onSaved, onError, numeric }: { line: BomLineRow; field: keyof BomLineRow; disabled: boolean; onSaved: () => void; onError: (e: string) => void; numeric?: boolean }) {
  const initial = String(line[field] ?? '');
  const [v, setV] = useState(initial);
  useEffect(() => setV(initial), [initial]);
  return (
    <input
      className={`${cellInput} ${numeric ? 'text-right' : ''}`}
      value={v}
      disabled={disabled}
      inputMode={numeric ? 'decimal' : undefined}
      onChange={(e) => setV(e.target.value)}
      onBlur={async () => {
        if (v === initial) return;
        const r = await updateBomLineAction(line.id, field, v);
        if (!r.success) {
          setV(initial);
          return onError(r.error);
        }
        onSaved();
      }}
    />
  );
}

function BomCard({ data, bom, canEdit, reload, onError, onNew }: { data: Data; bom: ItemBomInfo; canEdit: boolean; reload: () => void; onError: (e: string) => void; onNew: (m: 'ENQUIRY' | 'APPROVED') => void }) {
  const draft = bom.status === 'DRAFT';
  const locked = !canEdit || !draft;
  const [lib, setLib] = useState<null | { drawingNo: string; revision: string; approvalLetterNo: string; approvalDate: string; fileLink: string; itemType: string }>(null);
  const set = async (lineId: number, field: string, value: string) => {
    const r = await updateBomLineAction(lineId, field, value);
    if (!r.success) return onError(r.error);
    reload();
  };
  const [adding, setAdding] = useState(false);
  const blocks = useMemo(() => {
    if (bom.groups.length === 0) return [{ g: null as BomGroupRow | null, lines: bom.lines }];
    const out: { g: BomGroupRow | null; lines: BomLineRow[] }[] = bom.groups.map((g) => ({ g, lines: bom.lines.filter((l) => l.groupId === g.id) }));
    const orphans = bom.lines.filter((l) => !bom.groups.some((g) => g.id === l.groupId));
    if (orphans.length) out.push({ g: null, lines: orphans });
    return out;
  }, [bom.groups, bom.lines]);
  const counts = useMemo(() => {
    const c = { costed: 0, nb: 0, excluded: 0 };
    for (const l of bom.lines) {
      if (l.scope === 'NOT_IN_SCOPE' || l.scope === 'CLIENT_SUPPLY') c.excluded++;
      else if (l.category === 'NUTS_BOLTS') c.nb++;
      else c.costed++;
    }
    return c;
  }, [bom.lines]);

  return (
    <section className={card}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">BOM</h2>
            {draft ? <Badge tone="amber">Draft – check and confirm</Badge> : <Badge tone="green">Confirmed by {bom.confirmedByName}</Badge>}
            <Badge tone="slate">{SOURCE_LABELS[bom.source] ?? bom.source}</Badge>
            {bom.matchLevel && <Badge tone={levelTone(bom.matchLevel)}>{MATCH_LABELS[bom.matchLevel as MatchLevel]}</Badge>}
            {bom.versions > 1 && <span className="text-xs text-slate-700">version {bom.versions}</span>}
          </div>
          <p className="text-xs text-slate-700">
            Drawing: <b>{bom.drawingRef || bom.fileName || '–'}</b>
            {bom.drawing?.fileLink && (
              <a href={bom.drawing.fileLink} target="_blank" rel="noreferrer" className="ml-1 text-blue-800 underline">open</a>
            )}
            {bom.drawing?.status === 'SUPERSEDED' && <span className="ml-1 font-semibold text-rose-800">(drawing since superseded)</span>} · Structure type: <b>{bom.structureType ?? '–'}</b> · {counts.costed} structure/bought-out, {counts.nb} nuts &amp; bolts, {counts.excluded} excluded
          </p>
          {bom.extractNote && <p className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-900">{bom.extractNote}</p>}
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {draft ? (
              <>
                <Button size="sm" variant="outline" onClick={() => setAdding(true)} title="Add a structure from the Approved Drawing Library, with its set count (mixed BOM)">
                  <Library /> Add structure
                </Button>
                <Button size="sm" onClick={async () => { const r = await confirmItemBomAction(bom.id); if (!r.success) return onError(r.error); reload(); }}>
                  <Lock /> Confirm BOM
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="outline" onClick={async () => { const r = await reopenItemBomAction(bom.id); if (!r.success) return onError(r.error); reload(); }}>
                  <Unlock /> Reopen
                </Button>
                <FabDrawingsButton bomId={bom.id} onError={onError} />
                {!bom.drawingId && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setLib({ drawingNo: bom.drawingRef ?? '', revision: '0', approvalLetterNo: '', approvalDate: '', fileLink: '', itemType: bom.structureType ?? '' })}
                    title="When the client approves this drawing, add it to the library for the next enquiry"
                  >
                    <BookPlus /> Add to Approved Drawing Library
                  </Button>
                )}
              </>
            )}
            <Button size="sm" variant="ghost" onClick={() => onNew('ENQUIRY')}>
              <FileSpreadsheet /> New BOM from drawing
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onNew('APPROVED')}>
              <Library /> New BOM from approved drawing
            </Button>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1150px] border-collapse">
          <thead>
            <tr>
              <th className={th}>#</th>
              <th className={th}>Mark</th>
              <th className={th}>Description</th>
              <th className={th}>Section / size</th>
              <th className={`${th} text-right`}>Length mm</th>
              <th className={`${th} text-right`}>Qty / set</th>
              <th className={`${th} text-right`}>Unit wt kg</th>
              <th className={th}>Category</th>
              <th className={th}>Scope</th>
              <th className={th}>Rate key</th>
              <th className={th} title="Job-work chart category: picks the fabrication rate (Rs/kg on black weight, or Rs/pc on qty)">Fab category</th>
              <th className={th}>Non-billable</th>
              {!locked && <th className={th} />}
            </tr>
          </thead>
          <tbody>
            {bom.lines.length === 0 && (
              <tr>
                <td className={`${td} py-4 text-center text-slate-700`} colSpan={13}>No lines. Add lines or create the BOM from a drawing.</td>
              </tr>
            )}
            {blocks.map(({ g, lines: gl }) => (
              <Fragment key={g?.id ?? 0}>
                {g && (bom.groups.length > 1 || g.sets !== null || !locked) && (
                  <GroupHeaderRow g={g} bom={bom} locked={locked} reload={reload} onError={onError} colSpan={locked ? 12 : 13} />
                )}
            {gl.map((l) => {
              const out = l.scope === 'NOT_IN_SCOPE' || l.scope === 'CLIENT_SUPPLY';
              return (
                <tr key={l.id} className={out ? 'bg-slate-50 text-slate-600' : l.category === 'NUTS_BOLTS' ? 'bg-violet-50/40' : ''}>
                  <td className={`${td} text-slate-700`}>{l.rowNo}</td>
                  <td className={`${td} w-20`}><EditCell line={l} field="markNo" disabled={locked} onSaved={reload} onError={onError} /></td>
                  <td className={td}><EditCell line={l} field="description" disabled={locked} onSaved={reload} onError={onError} /></td>
                  <td className={`${td} w-36`}><EditCell line={l} field="section" disabled={locked} onSaved={reload} onError={onError} /></td>
                  <td className={`${td} w-24`}><EditCell line={l} field="lengthMm" numeric disabled={locked} onSaved={reload} onError={onError} /></td>
                  <td className={`${td} w-20`}><EditCell line={l} field="qtyPerSet" numeric disabled={locked} onSaved={reload} onError={onError} /></td>
                  <td className={`${td} w-20`}><EditCell line={l} field="unitWtKg" numeric disabled={locked} onSaved={reload} onError={onError} /></td>
                  <td className={`${td} w-44`}>
                    <select className={cellInput} disabled={locked} value={l.category} onChange={(e) => void set(l.id, 'category', e.target.value)}>
                      {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                    </select>
                  </td>
                  <td className={`${td} w-32`}>
                    <select className={cellInput} disabled={locked} value={l.scope} onChange={(e) => void set(l.id, 'scope', e.target.value)}>
                      {SCOPES.map((s) => <option key={s} value={s}>{SCOPE_LABELS[s]}</option>)}
                    </select>
                  </td>
                  <td className={`${td} w-28`}>
                    {l.category === 'STRUCTURE' && l.scope !== 'BOUGHT_OUT' ? (
                      <span className="text-xs text-slate-700">{l.sectionKey ?? ''}</span>
                    ) : (
                      <EditCell line={l} field="rateKey" disabled={locked} onSaved={reload} onError={onError} />
                    )}
                  </td>
                  <td className={`${td} w-52`}>
                    {l.category === 'STRUCTURE' ? (
                      <select
                        className={`${cellInput} ${!l.fabCat && !l.fabCatAuto ? 'border-rose-400 bg-rose-50' : ''}`}
                        disabled={!canEdit}
                        value={l.fabCat ?? ''}
                        title={l.fabCat ? 'Set by hand' : l.fabCatAuto ? 'Picked from section / description' : 'No category matches: the line is flagged, not costed'}
                        onChange={(e) => void set(l.id, 'fabCat', e.target.value)}
                      >
                        <option value="">{l.fabCatAuto ? `Auto: ${fabCatLabel(l.fabCatAuto)}` : 'Auto: none matches (flagged)'}</option>
                        {FAB_CATS.map((c) => <option key={c.code} value={c.code}>{c.label} ({c.unit})</option>)}
                      </select>
                    ) : (
                      <span className="text-xs text-slate-700">–</span>
                    )}
                  </td>
                  <td className={`${td} w-24 text-center`}>
                    <input type="checkbox" disabled={locked} checked={l.nonBillable} onChange={(e) => void set(l.id, 'nonBillable', String(e.target.checked))} aria-label="Non-billable" />
                  </td>
                  {!locked && (
                    <td className={td}>
                      <button type="button" aria-label={`Delete row ${l.rowNo}`} className="rounded p-1 text-slate-700 hover:text-rose-600" onClick={async () => { const r = await deleteBomLineAction(l.id); if (!r.success) return onError(r.error); reload(); }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-700">
        Only <b>In scope</b> and <b>Bought-out</b> lines are costed. <b>Non-billable</b> lines are supplied, so they are costed, but their weight is not billed (the cost is carried on the billable kg). Nuts &amp; bolts are costed from their own rate (rate key = size, e.g. M16X40) and quoted as a separate line – not in the
        structure weight or per-kg price. Not in scope / Client supply lines are listed but not priced. Weight always uses kg/m from GTP Sections.
      </p>

      {adding && <AddStructureModal bomId={bom.id} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} onError={onError} />}
      {lib && (
        <Modal title="Add to Approved Drawing Library" onClose={() => setLib(null)}>
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await addBomToLibraryAction(bom.id, lib);
              if (!r.success) return onError(r.error);
              setLib(null);
              reload();
            }}
          >
            <p className="text-xs text-slate-700">Utility and state are taken from the docket ({data.docket?.utility ?? '–'}, {data.docket?.deliveryLocation || data.docket?.state || '–'}).</p>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ['itemType', 'Item / structure type'],
                  ['drawingNo', 'Drawing no.'],
                  ['revision', 'Revision'],
                  ['approvalLetterNo', 'Approval letter no.'],
                ] as const
              ).map(([k, label]) => (
                <div key={k}>
                  <label className={labelCls} htmlFor={`l-${k}`}>{label}</label>
                  <input id={`l-${k}`} className={fieldCls} value={lib[k]} onChange={(e) => setLib({ ...lib, [k]: e.target.value })} />
                </div>
              ))}
              <div>
                <label className={labelCls} htmlFor="l-date">Approval date</label>
                <input id="l-date" type="date" className={fieldCls} value={lib.approvalDate} onChange={(e) => setLib({ ...lib, approvalDate: e.target.value })} />
              </div>
              <div>
                <label className={labelCls} htmlFor="l-link">File link (Laser Drive)</label>
                <input id="l-link" className={fieldCls} value={lib.fileLink} onChange={(e) => setLib({ ...lib, fileLink: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setLib(null)}>Cancel</Button>
              <Button type="submit">Add</Button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Costing: choices, live calculation, checks, save / apply to the quotation.
// ---------------------------------------------------------------------------

function CostingCard({ data, bom, canEdit, role, reload, onError }: { data: Data; bom: ItemBomInfo; canEdit: boolean; role: string; reload: () => void; onError: (e: string) => void }) {
  const [va, setVa] = useState('');
  const [date, setDate] = useState(today());
  const [p, setP] = useState<CostingPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  // Rev 2 §7 discount (Admin only, with a reason).
  const [discMode, setDiscMode] = useState('PCT');
  const [discVal, setDiscVal] = useState('');
  const [discReason, setDiscReason] = useState('');
  const discount = discVal.trim() === '' ? null : { mode: discMode, value: discVal, reason: discReason };
  // VA between the minimum and the default: Admin approval with a reason (25-11).
  const [vaReason, setVaReason] = useState('');
  const [spt, setSpt] = useState(bom.setsPerTruck === null ? '' : String(bom.setsPerTruck));

  const run = useCallback(async () => {
    const r = await previewCostingAction(bom.id, { vaPct: va === '' ? null : va, quoteDate: date, discount: discVal.trim() === '' ? null : { mode: discMode, value: discVal, reason: discReason } });
    if (!r.success) return onError(r.error);
    setP(r.data);
  }, [bom.id, va, date, discMode, discVal, discReason, onError]);
  // Re-run whenever the BOM (lines/choices) or the inputs change.
  const sig = JSON.stringify([bom.lines, bom.fabType, bom.galvanised, bom.painted, bom.billingBasis, bom.loadBasis, bom.setsPerTruck, bom.status]);
  useEffect(() => {
    const t = setTimeout(() => void run(), 250);
    return () => clearTimeout(t);
  }, [run, sig]);

  const meta = async (field: string, value: string) => {
    const r = await updateBomMetaAction(bom.id, field, value);
    if (!r.success) return onError(r.error);
    reload();
  };

  const save = async (apply: boolean) => {
    setBusy(true);
    const r = await saveCostingAction(bom.id, { vaPct: va === '' ? null : va, quoteDate: date, apply, discount, vaApprovalReason: vaReason });
    setBusy(false);
    if (!r.success) return onError(r.error);
    setMsg(apply ? 'Saved and applied: the price is now on the docket item and the offer PDF.' : 'Costing saved.');
    reload();
  };

  const res = p?.result;
  const basisLabel = bom.billingBasis === 'GALV' ? 'galvanised' : 'black';
  const perKgPrice = p?.setsBasis === 'WEIGHT' || p?.setsBasis === 'STRUCTURES' || !p?.result.perSet;
  const unitLabel = perKgPrice ? `per kg (${basisLabel})` : 'per set';

  return (
    <section className={card}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Costing</h2>
        <Link href="/admin/costing" className="text-xs text-blue-800 hover:underline">Costing Master →</Link>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <label className={labelCls} htmlFor="c-galv">Galvanised</label>
          <select
            id="c-galv"
            className={fieldCls}
            disabled={!canEdit}
            value={bom.galvanised ? 'GI' : bom.painted ? 'PAINT' : 'BLACK'}
            onChange={(e) => void (e.target.value === 'GI' ? meta('galvanised', 'true') : e.target.value === 'PAINT' ? meta('painted', 'true') : meta('galvanised', 'false').then(() => meta('painted', 'false')))}
          >
            <option value="GI">Galvanised (GI)</option>
            <option value="PAINT">Painted</option>
            <option value="BLACK">Black (no finish)</option>
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="c-lb">Freight load basis</label>
          <select id="c-lb" className={fieldCls} disabled={!canEdit} value={bom.loadBasis} onChange={(e) => void meta('loadBasis', e.target.value)}>
            <option value="WEIGHT">Weight (Rs/MT)</option>
            <option value="SPACE">Space (bulky: trips)</option>
          </select>
        </div>
        {bom.loadBasis === 'SPACE' && (
          <div>
            <label className={labelCls} htmlFor="c-spt">Sets per truck</label>
            <input id="c-spt" className={fieldCls} disabled={!canEdit} inputMode="decimal" value={spt} onChange={(e) => setSpt(e.target.value)} onBlur={() => spt !== String(bom.setsPerTruck ?? '') && void meta('setsPerTruck', spt)} />
          </div>
        )}
        <div>
          <label className={labelCls} htmlFor="c-bb">Client billing basis</label>
          <select id="c-bb" className={fieldCls} disabled={!canEdit} value={bom.billingBasis} onChange={(e) => void meta('billingBasis', e.target.value)}>
            <option value="GALV">Galvanised weight</option>
            <option value="BLACK">Black weight</option>
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="c-va">VA % (blank = default {res ? `${res.vaPct}%` : '12%'})</label>
          <input id="c-va" className={fieldCls} inputMode="decimal" placeholder={res?.minVaPct !== null && res?.minVaPct !== undefined ? String(res.minVaPct) : ''} value={va} onChange={(e) => setVa(e.target.value)} />
        </div>
        <div>
          <label className={labelCls} htmlFor="c-date">Rates as on</label>
          <input id="c-date" type="date" className={fieldCls} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <span className={labelCls}>Sets</span>
          <div className="py-2 text-sm font-semibold">
            {res ? (res.sets !== null ? inr(res.sets, 3) : `${res.groups.length} structures`) : '–'}
            <span className="ml-1 text-xs font-normal text-slate-700">
              {p?.setsBasis === 'WEIGHT' ? `= ${data.item.qty} ${data.item.uom} ÷ set wt` : p?.setsBasis === 'SETS' ? '= set count of the BOM' : p?.setsBasis === 'STRUCTURES' ? `${inr(res?.totalSets ?? 0, 0)} sets in all` : ''}
            </span>
          </div>
        </div>
      </div>
      {role === 'Admin' && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className={labelCls} htmlFor="c-dm">Discount (Admin)</label>
            <select id="c-dm" className={fieldCls} value={discMode} onChange={(e) => setDiscMode(e.target.value)}>
              {DISCOUNT_MODES.map((m) => (
                <option key={m} value={m}>{DISCOUNT_LABELS[m]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="c-dv">Discount value (blank = none)</label>
            <input id="c-dv" className={fieldCls} inputMode="decimal" value={discVal} onChange={(e) => setDiscVal(e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className={labelCls} htmlFor="c-dr">Discount reason (required)</label>
            <input id="c-dr" className={fieldCls} value={discReason} onChange={(e) => setDiscReason(e.target.value)} />
          </div>
        </div>
      )}

      {res && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {res.perSet ? (
              <>
                <Stat label="Black wt / set" value={`${inr(res.perSet.blackWtKg, 3)} kg`} />
                <Stat label="Galv wt / set" value={`${inr(res.perSet.galvWtKg, 3)} kg`} />
              </>
            ) : (
              <>
                <Stat label="Net black wt (all)" value={`${inr((p?.netKg ?? res.structure.blackWtKg) / 1000, 3)} MT`} />
                <Stat label={`Billable ${basisLabel} wt`} value={`${inr(res.structure.billedWtKg / 1000, 3)} MT`} />
              </>
            )}
            <Stat label={`Cost / kg (${basisLabel})`} value={`Rs ${inr(res.structure.costPerKg)}`} />
            <Stat label={`Selling / kg (${basisLabel})`} value={`Rs ${inr(res.structure.sellPerKg)}`} strong tone={res.checks.belowMinVa ? 'red' : undefined} />
            {res.perSet ? (
              <Stat label="Selling / set (structure)" value={`Rs ${inr(res.perSet.sell)}`} />
            ) : (
              <Stat label="Selling / MT (billable)" value={`Rs ${inr(res.structure.sellPerKg * 1000, 0)}`} strong />
            )}
            <Stat label="N&B + bought-out (separate)" value={`Rs ${inr(res.nutsBolts.sell + res.boughtOut.sell, 0)}`} />
            <Stat label="Item total (all sets)" value={`Rs ${inr(res.grandSell, 0)}`} strong />
          </div>
          {/* Rev 2 §7 build-up: cost base -> VA -> price before discount -> discount -> final -> effective VA */}
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            <Stat label="Total cost (base)" value={`Rs ${inr(res.costTotal, 0)}`} />
            <Stat label={`VA ${res.vaPct}%`} value={`Rs ${inr(res.vaAmount, 0)}`} />
            <Stat label="Price before discount" value={`Rs ${inr(res.grandSell, 0)}`} />
            <Stat label="Discount" value={res.discount ? `– Rs ${inr(res.discount.amount, 0)}` : '–'} />
            <Stat label="Final price (before GST)" value={`Rs ${inr(res.discount ? res.discount.finalPrice : res.grandSell, 0)}`} strong />
            <Stat
              label="Effective VA %"
              value={`${inr(res.checks.effectiveVaPct)}%`}
              strong
              tone={res.checks.belowMinVa ? 'red' : res.checks.vaNeedsApproval ? 'amber' : undefined}
            />
          </div>
          {res.freight && !res.freight.exWorks && (
            <p className="mt-2 text-xs text-slate-700">
              Freight ({res.freight.basis === 'SPACE' ? 'load by space' : 'load by weight'}):{' '}
              {res.freight.basis === 'SPACE'
                ? `${res.freight.trips ?? '–'} trip(s) × Rs ${inr(res.freight.tripRate ?? 0, 0)} (${res.freight.setsPerTruck ?? '–'} sets per truck) = Rs ${inr(res.freight.total, 0)}${res.freight.perSet !== null ? `, Rs ${inr(res.freight.perSet)} per set` : ''}`
                : `Rs ${inr(res.freight.ratePerMt, 0)}/MT = Rs ${inr(res.freight.total, 0)}`}{' '}
              to {p?.destState}.
            </p>
          )}

          <div className="mt-3 flex flex-col gap-1">
            {res.checks.messages.map((m, i) => (
              <div key={i} className={`flex items-start gap-1.5 text-xs ${/below|blank|not in|zero|draft|No line|reference/.test(m) ? 'text-rose-800' : 'text-slate-700'}`}>
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {m}
              </div>
            ))}
            {res.checks.blankLines.concat(res.checks.outsidePurchaseList).slice(0, 15).map((m, i) => (
              <div key={`b${i}`} className="pl-5 text-xs text-rose-800">• {m}</div>
            ))}
            {p?.planNote && <div className="text-xs text-slate-700">{p.planNote}</div>}
          </div>

          {res.groups.length > 1 && <StructureSummary res={res} basisLabel={basisLabel} />}
          {p && p.sectionWeights.length > 0 && <SectionWeights p={p} />}

          <div className="mt-1">
            {res.checks.messages.length === 0 && <div className="flex items-center gap-1.5 text-xs text-emerald-800"><CheckCircle2 className="h-3.5 w-3.5" /> All checks passed.</div>}
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[1150px] border-collapse">
              <thead>
                <tr>
                  <th className={th}>#</th>
                  <th className={th}>Mark</th>
                  <th className={th}>Section</th>
                  <th className={th}>Status</th>
                  <th className={`${th} text-right`}>Qty/set</th>
                  <th className={`${th} text-right`}>kg/m</th>
                  <th className={`${th} text-right`}>Black kg</th>
                  <th className={`${th} text-right`}>Galv kg</th>
                  <th className={`${th} text-right`}>Wastage %</th>
                  <th className={`${th} text-right`}>RM rate</th>
                  <th className={`${th} text-right`}>RM</th>
                  <th className={`${th} text-right`}>Fab</th>
                  <th className={`${th} text-right`}>Galv</th>
                  <th className={`${th} text-right`}>Freight</th>
                  <th className={`${th} text-right`}>Insp+pack{bom.painted ? '+paint' : ''}</th>
                  <th className={`${th} text-right`} title="LC/BG + interest (credit days ÷ 30 × % of the selling value)">Interest / finance cost</th>
                  <th className={`${th} text-right`}>Cost</th>
                  <th className={`${th} text-right`}>Selling</th>
                </tr>
              </thead>
              <tbody>
                {res.lines.map((l, i) => (
                  <Fragment key={l.rowNo}>
                  {l.group && l.group !== res.lines[i - 1]?.group && (
                    <tr>
                      <td colSpan={18} className="border-b border-slate-300 bg-slate-100 px-2 py-1.5 text-[13px] font-bold text-slate-900">
                        {l.group} <span className="font-semibold text-slate-700">· {inr(l.sets, l.sets % 1 ? 3 : 0)} sets</span>
                      </td>
                    </tr>
                  )}
                  <tr className={l.status === 'EXCLUDED' ? 'text-slate-700' : l.status === 'FLAGGED' ? 'bg-rose-50' : ''}>
                    <td className={td}>{l.rowNo}</td>
                    <td className={td}>{l.markNo ?? ''}</td>
                    <td className={td}>{l.section ?? CATEGORY_LABELS[l.category as Category]}</td>
                    <td className={td}>
                      {l.status === 'COSTED' ? (
                        <Badge tone={l.category === 'STRUCTURE' ? 'green' : 'blue'}>{l.category === 'STRUCTURE' ? 'Costed' : CATEGORY_LABELS[l.category as Category]}</Badge>
                      ) : (
                        <span title={l.note ?? ''}><Badge tone={l.status === 'FLAGGED' ? 'red' : 'slate'}>{l.note ?? l.status}</Badge></span>
                      )}
                    </td>
                    <td className={`${td} text-right`}>{l.qtyPerSet}</td>
                    <td className={`${td} text-right`} title={l.kgPerMSource ?? ''}>{l.kgPerM ?? '–'}{l.kgPerMSource === 'DRAWING' ? '*' : ''}</td>
                    <td className={`${td} text-right`}>{inr(l.blackWtKg, 3)}</td>
                    <td className={`${td} text-right`}>{inr(l.galvWtKg, 3)}</td>
                    <td className={`${td} text-right`} title={l.wastageSource ?? ''}>{l.wastagePct === null ? '–' : `${l.wastagePct}${l.wastageSource === 'MASTER' ? ' (M)' : l.wastageSource === 'CUTTING_PLAN' ? ' (P)' : ''}`}</td>
                    <td className={`${td} text-right`} title={l.rmInterim ? 'Interim rate (supplier quote) – to be replaced by the PO/GRN rate' : ''}>
                      {l.rmRate === null ? '–' : inr(l.rmRate)}
                      {l.rmInterim && <span className="ml-1 text-[11px] font-semibold text-amber-700">(interim)</span>}
                    </td>
                    <td className={`${td} text-right`}>{inr(l.rm)}</td>
                    <td className={`${td} text-right`} title={l.fabCat ? `${fabCatLabel(l.fabCat)}${l.fabRate !== null ? ` @ Rs ${l.fabRate} ${FAB_CAT_BY_CODE[l.fabCat]?.unit === 'Rs/pc' ? '/pc' : '/kg'}` : ''}` : ''}>{inr(l.fab)}</td>
                    <td className={`${td} text-right`}>{inr(l.galv)}</td>
                    <td className={`${td} text-right`}>{inr(l.freight)}</td>
                    <td className={`${td} text-right`}>{inr(l.inspPack + (l.paint ?? 0))}</td>
                    <td className={`${td} text-right`}>{inr(l.commercial)}</td>
                    <td className={`${td} text-right font-semibold`}>{inr(l.cost)}</td>
                    <td className={`${td} text-right font-semibold`}>{inr(l.sell)}</td>
                  </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-xs text-slate-700">
              Per one set, Rs. Wastage (P) = from the cutting plan, (M) = Costing Master override. kg/m* = from the drawing (section missing in GTP Sections). VA {res.vaPct}%
              {res.minVaPct !== null ? ` (minimum ${res.minVaPct}%)` : ''}.
            </p>
          </div>

          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-semibold text-slate-700">Rates used ({res.ratesUsed.length}) – as on {p?.quoteDate}</summary>
            <table className="mt-1 border-collapse">
              <tbody>
                {res.ratesUsed.map((r) => (
                  <tr key={r.id}>
                    <td className={td}>{r.kind}</td>
                    <td className={td}>{r.subject}</td>
                    <td className={`${td} text-right`}>{r.value}</td>
                    <td className={td}>{r.unit}</td>
                    <td className={td}>from {r.effectiveFrom}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>

          {canEdit && (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              <Button variant="outline" disabled={busy} onClick={() => void save(false)}>Save costing</Button>
              {res.checks.vaNeedsApproval && role === 'Admin' && (
                <input
                  className={`${fieldCls} w-72`}
                  placeholder={`Approval reason: VA ${res.checks.effectiveVaPct}% below the default`}
                  value={vaReason}
                  onChange={(e) => setVaReason(e.target.value)}
                />
              )}
              <Button
                disabled={busy || !res.checks.ok || p?.bomStatus !== 'CONFIRMED' || (res.checks.vaNeedsApproval && (role !== 'Admin' || !vaReason.trim()))}
                onClick={() => void save(true)}
                title={!res.checks.ok ? 'Fix the flagged lines first' : p?.bomStatus !== 'CONFIRMED' ? 'Confirm the BOM first' : ''}
              >
                <CheckCircle2 /> Save &amp; apply Rs {inr(perKgPrice || !res.perSet ? res.structure.sellPerKg : res.perSet.sell)} {unitLabel} to the quotation
              </Button>
              {res.checks.belowMinVa && <span className="text-xs text-rose-800">Below the minimum VA {res.minVaPct}%: blocked.</span>}
              {res.checks.vaNeedsApproval && role !== 'Admin' && <span className="text-xs text-amber-800">VA below the default: needs an Admin's approval with a reason.</span>}
              {msg && <span className="text-xs font-semibold text-emerald-800">{msg}</span>}
            </div>
          )}
        </>
      )}

      {data.costings.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <h3 className="mb-1 text-xs font-semibold text-slate-700">Saved costings</h3>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>#</th>
                <th className={th}>Rates as on</th>
                <th className={`${th} text-right`}>VA %</th>
                <th className={`${th} text-right`}>Sets</th>
                <th className={`${th} text-right`}>Rs/kg</th>
                <th className={`${th} text-right`}>Rs/set</th>
                <th className={`${th} text-right`}>N&amp;B</th>
                <th className={`${th} text-right`}>Total</th>
                <th className={th}>By</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {data.costings.map((c) => (
                <tr key={c.id}>
                  <td className={td}>{c.id}</td>
                  <td className={td}>{c.quoteDate}</td>
                  <td className={`${td} text-right`}>{c.vaPct}</td>
                  <td className={`${td} text-right`}>{inr(c.sets, 3)}</td>
                  <td className={`${td} text-right`}>{inr(c.sellPerKg)}</td>
                  <td className={`${td} text-right`}>{inr(c.sellPerSet)}</td>
                  <td className={`${td} text-right`}>{inr(c.nbSellTotal, 0)}</td>
                  <td className={`${td} text-right font-semibold`}>{inr(c.sellTotal, 0)}</td>
                  <td className={td}>{c.createdByName} · {c.createdAt.slice(0, 10)}</td>
                  <td className={td}>{c.applied ? <Badge tone="green">On quotation</Badge> : c.okToApply ? '' : <Badge tone="amber">had flags</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'red' | 'amber' }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${tone === 'red' ? 'border-rose-200 bg-rose-50' : tone === 'amber' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
      <div className="text-xs text-slate-700">{label}</div>
      <div className={`text-sm ${strong ? 'font-bold text-slate-900' : 'font-semibold text-slate-800'}`}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mixed BOM (several structures, each with its own set count).
// ---------------------------------------------------------------------------

const fmtSets = (n: number) => String(Math.round(n * 1000) / 1000);

/** Structures read from a mixed BOM, before saving: names and set counts can be corrected. */
function StructuresPreview({ groups, onChange }: { groups: MixedGroup[]; onChange: (g: MixedGroup[]) => void }) {
  const lines = groups.reduce((a, g) => a + g.lines.length, 0);
  const nonBill = groups.reduce((a, g) => a + g.lines.filter((l) => l.nonBillable).length, 0);
  return (
    <div className="max-h-[55vh] overflow-auto rounded-lg border border-slate-200">
      <div className="sticky top-0 border-b border-slate-200 bg-blue-50 px-3 py-2 text-[13px] text-blue-900">
        <b>Mixed BOM:</b> {groups.length} structures, {lines} lines ({nonBill} non-billable). Check every set count against the client BOM; the price is built from these counts.
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={th}>#</th>
            <th className={th}>Structure</th>
            <th className={th}>Drawing no.</th>
            <th className={th}>Sets by site</th>
            <th className={`${th} text-right`}>Sets</th>
            <th className={`${th} text-right`}>Lines</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g, i) => (
            <tr key={i} className={g.sets === 0 ? 'text-slate-500' : ''}>
              <td className={td}>{i + 1}</td>
              <td className={td}>
                <input className={cellInput} value={g.name} onChange={(e) => onChange(groups.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              </td>
              <td className={td}>{g.drawingNo ?? '–'}</td>
              <td className={`${td} text-xs`}>
                {Object.entries(g.siteSets)
                  .filter(([, n]) => n)
                  .map(([site, n]) => `${site} ${fmtSets(n)}`)
                  .join(' · ') || '–'}
              </td>
              <td className={`${td} w-28`}>
                <input
                  className={`${cellInput} text-right ${g.sets !== null && g.sets % 1 ? 'border-amber-500 bg-amber-50' : ''}`}
                  inputMode="decimal"
                  value={g.sets ?? ''}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    const n = v === '' ? null : Number(v);
                    onChange(groups.map((x, j) => (j === i ? { ...x, sets: n === null || Number.isNaN(n) ? null : n } : x)));
                  }}
                  title={g.sets !== null && g.sets % 1 ? 'Fractional set count – check' : ''}
                />
              </td>
              <td className={`${td} text-right`}>{g.lines.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupHeaderRow({ g, bom, locked, reload, onError, colSpan }: { g: BomGroupRow; bom: ItemBomInfo; locked: boolean; reload: () => void; onError: (e: string) => void; colSpan: number }) {
  const initial = g.sets === null ? '' : String(g.sets);
  const [sets, setSets] = useState(initial);
  useEffect(() => setSets(initial), [initial]);
  const sites = Object.entries(g.siteSets ?? {}).filter(([, n]) => n);
  const single = bom.groups.length === 1;
  return (
    <tr>
      <td colSpan={colSpan} className="border-b border-slate-300 bg-slate-100 px-2 py-1.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-slate-900">
          <span className="font-bold">
            {g.seq}. {g.name}
          </span>
          <span className="text-slate-700">
            Drawing: <b>{g.drawingNo ?? '–'}</b>
          </span>
          <label className="flex items-center gap-1.5">
            <span className="font-semibold">Sets</span>
            <input
              className={`${cellInput} w-28 text-right ${g.sets !== null && g.sets % 1 ? 'border-amber-500 bg-amber-50' : ''}`}
              disabled={locked}
              inputMode="decimal"
              placeholder={single ? 'from item qty' : 'required'}
              value={sets}
              onChange={(e) => setSets(e.target.value)}
              onBlur={async () => {
                if (sets === initial) return;
                const r = await updateGroupAction(g.id, 'sets', sets);
                if (!r.success) {
                  setSets(initial);
                  return onError(r.error);
                }
                reload();
              }}
            />
          </label>
          {sites.length > 0 && <span className="text-xs text-slate-700">{sites.map(([site, n]) => `${site} ${fmtSets(n)}`).join(' · ')}</span>}
          <span className="text-xs text-slate-700">{g.lineCount} lines</span>
          {!locked && (
            <span className="ml-auto flex gap-3">
              <button
                type="button"
                className="text-xs font-semibold text-blue-800 hover:underline"
                onClick={async () => {
                  const r = await addBomLineAction(bom.id, g.id);
                  if (!r.success) return onError(r.error);
                  reload();
                }}
              >
                + line
              </button>
              {!single && (
                <button
                  type="button"
                  className="text-xs font-semibold text-rose-800 hover:underline"
                  onClick={async () => {
                    if (!window.confirm(`Remove structure "${g.name}" and its ${g.lineCount} lines from this BOM?`)) return;
                    const r = await deleteGroupAction(g.id);
                    if (!r.success) return onError(r.error);
                    reload();
                  }}
                >
                  remove structure
                </button>
              )}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

/** Add an approved drawing as one more structure (with its set count) to a draft BOM. */
function AddStructureModal({ bomId, onClose, onDone, onError }: { bomId: number; onClose: () => void; onDone: () => void; onError: (e: string) => void }) {
  const [list, setList] = useState<DrawingRow[]>([]);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<number | null>(null);
  const [sets, setSets] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    void listDrawingsAction().then((r) => (r.success ? setList(r.data.drawings.filter((d) => d.status === 'APPROVED')) : setErr(r.error)));
  }, []);
  const needle = q.trim().toLowerCase();
  const shown = list.filter((d) => !needle || `${d.drawingNo} ${d.itemType} ${d.utility} ${d.state ?? ''}`.toLowerCase().includes(needle)).slice(0, 60);
  return (
    <Modal title="Add structure from an approved drawing" wide onClose={onClose}>
      <div className="flex flex-col gap-3">
        <input className={fieldCls} placeholder="Search drawing no., structure type, utility" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-[45vh] overflow-auto rounded-lg border border-slate-200">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th} />
                <th className={th}>Drawing</th>
                <th className={th}>Structure type</th>
                <th className={th}>Utility / state</th>
                <th className={`${th} text-right`}>Set wt kg</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => (
                <tr key={d.id} className={`cursor-pointer ${pick === d.id ? 'bg-blue-50' : 'hover:bg-slate-50'}`} onClick={() => setPick(d.id)}>
                  <td className={td}>
                    <input type="radio" checked={pick === d.id} onChange={() => setPick(d.id)} aria-label={d.drawingNo} />
                  </td>
                  <td className={`${td} font-semibold`}>
                    {d.drawingNo} rev {d.revision}
                  </td>
                  <td className={td}>{d.itemType}</td>
                  <td className={td}>
                    {d.utility} / {d.state ?? '–'}
                  </td>
                  <td className={`${td} text-right`}>{inr(d.setWtKg, 3)}</td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={5} className={`${td} py-4 text-center`}>
                    No approved drawing found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-end gap-3">
          <div className="w-40">
            <label className={labelCls} htmlFor="as-sets">
              Number of sets
            </label>
            <input id="as-sets" className={fieldCls} inputMode="decimal" value={sets} onChange={(e) => setSets(e.target.value)} />
          </div>
          <FormError error={err} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!pick || sets.trim() === ''}
            onClick={async () => {
              const r = await addGroupFromDrawingAction(bomId, pick, sets);
              if (!r.success) {
                setErr(r.error);
                return onError(r.error);
              }
              onDone();
            }}
          >
            Add structure
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function StructureSummary({ res, basisLabel }: { res: CostingPreview['result']; basisLabel: string }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <h3 className="mb-1 text-sm font-semibold text-slate-900">By structure</h3>
      <table className="w-full min-w-[900px] border-collapse">
        <thead>
          <tr>
            <th className={th}>Structure</th>
            <th className={`${th} text-right`}>Sets</th>
            <th className={`${th} text-right`}>Black kg / set</th>
            <th className={`${th} text-right`}>Billable {basisLabel} kg / set</th>
            <th className={`${th} text-right`}>Selling / set</th>
            <th className={`${th} text-right`}>Black kg (all)</th>
            <th className={`${th} text-right`}>Selling (structure)</th>
            <th className={`${th} text-right`}>N&amp;B / bought-out</th>
          </tr>
        </thead>
        <tbody>
          {res.groups.map((g) => (
            <tr key={g.name} className={g.sets === 0 ? 'text-slate-500' : ''}>
              <td className={`${td} font-medium`}>{g.name}</td>
              <td className={`${td} text-right ${g.sets % 1 ? 'font-bold text-amber-800' : ''}`}>{inr(g.sets, g.sets % 1 ? 3 : 0)}</td>
              <td className={`${td} text-right`}>{inr(g.blackWtPerSet, 3)}</td>
              <td className={`${td} text-right`}>{inr(g.billedWtPerSet, 3)}</td>
              <td className={`${td} text-right`}>{inr(g.sellPerSet)}</td>
              <td className={`${td} text-right`}>{inr(g.blackWtKg, 1)}</td>
              <td className={`${td} text-right font-semibold`}>{inr(g.sell, 0)}</td>
              <td className={`${td} text-right`}>{g.otherSell ? inr(g.otherSell, 0) : '–'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className={`${td} font-bold`}>Total</td>
            <td className={`${td} text-right font-bold`}>{inr(res.totalSets, 0)}</td>
            <td className={td} colSpan={3} />
            <td className={`${td} text-right font-bold`}>{inr(res.structure.blackWtKg, 1)}</td>
            <td className={`${td} text-right font-bold`}>{inr(res.structure.sell, 0)}</td>
            <td className={`${td} text-right font-bold`}>{inr(res.nutsBolts.sell + res.boughtOut.sell, 0)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="mt-1 text-xs text-slate-700">Only lines that could be costed are in these totals; flagged lines are listed above.</p>
    </div>
  );
}

/** Net weight by section, for checking against an independent take-off (e.g. 100.07 MT for SBPDCL). */
function SectionWeights({ p }: { p: CostingPreview }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <h3 className="mb-1 text-sm font-semibold text-slate-900">Weight by section (net black, all supplied pieces)</h3>
      <table className="border-collapse">
        <thead>
          <tr>
            <th className={th}>Section</th>
            <th className={`${th} text-right`}>Total MT</th>
            <th className={`${th} text-right`}>Billable MT</th>
            <th className={th}>GTP</th>
          </tr>
        </thead>
        <tbody>
          {p.sectionWeights.map((sw) => (
            <tr key={sw.key}>
              <td className={td}>{sw.label}</td>
              <td className={`${td} text-right`}>{inr(sw.kg / 1000, 3)}</td>
              <td className={`${td} text-right`}>{inr(sw.billableKg / 1000, 3)}</td>
              <td className={td}>{!sw.inGtp ? <Badge tone="red">not in GTP</Badge> : sw.approved ? <Badge tone="green">approved</Badge> : <Badge tone="amber">not approved – confirm</Badge>}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className={`${td} font-bold`}>Total</td>
            <td className={`${td} text-right font-bold`}>{inr(p.netKg / 1000, 3)}</td>
            <td className={`${td} text-right font-bold`}>{inr(p.sectionWeights.reduce((a, sw) => a + sw.billableKg, 0) / 1000, 3)}</td>
            <td className={td} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
