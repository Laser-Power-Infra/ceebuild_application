'use client';

import { useMemo, useState } from 'react';
import { Plus, Trash2, Upload } from 'lucide-react';
import { ServerTable, Kpi, fmtNum } from '@/components/ServerTable';
import { Modal, FormError, fieldCls, labelCls } from '@/components/Modal';
import { Button } from '@/components/ui/button';
import type { DataColumn } from '@/components/data-table/types';
import {
  deleteSectionAction,
  importSectionsAction,
  listSectionsAction,
  listSectionsFacetAction,
  updateSectionFieldAction,
  upsertSectionAction,
} from '@/app/actions/sections';
import { SECTION_COLUMNS, type SectionRow } from '../columns';

export function SectionsPage({ role }: { role: string }) {
  const isAdmin = role === 'Admin';
  const [reload, setReload] = useState(0);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ label: '', kgPerM: '', grade: 'IS 2062 E250A', source: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const columns = useMemo(() => {
    const cols: DataColumn<SectionRow>[] = SECTION_COLUMNS.map((c) => (c.edit ? { ...c, canEdit: () => isAdmin } : c));
    if (isAdmin) {
      cols.push({
        key: '_delete',
        label: '',
        kind: 'text',
        width: 50,
        render: (r) => (
          <button
            type="button"
            aria-label={`Delete ${r.label}`}
            className="rounded p-1 text-slate-400 hover:text-rose-600"
            onClick={async (e) => {
              e.stopPropagation();
              if (!window.confirm(`Delete section ${r.label}? Draft BOMs are re-checked.`)) return;
              const res = await deleteSectionAction(r.id);
              if (res.success) setReload((n) => n + 1);
              else setError(res.error);
            }}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ),
      });
    }
    return cols;
  }, [isAdmin]);

  const importFile = async (file: File) => {
    setError('');
    setMessage('Importing…');
    const fd = new FormData();
    fd.set('file', file);
    const r = await importSectionsAction(fd);
    if (!r.success) {
      setMessage('');
      return setError(r.error);
    }
    setMessage(`Imported: ${r.data.added} added, ${r.data.updated} updated${r.data.skipped.length ? `, skipped rows ${r.data.skipped.join(', ')}` : ''}. Draft BOMs were re-checked.`);
    setReload((n) => n + 1);
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900">GTP sections</h1>
        <p className="text-xs text-slate-500">
          Approved sections and their standard kg/m (e.g. SBPDCL letter 2333 dt 28-07-2025: IS 2062 E250A, IS 2629 610 g/m², ±5%). BOM rows are
          checked against this list; any change re-checks every draft BOM.
        </p>
      </div>
      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">{message}</div>}
      <FormError error={error} />
      <ServerTable<SectionRow>
        tableId="sections"
        columns={columns}
        rowId={(r) => String(r.id)}
        reloadToken={reload}
        fetchPage={listSectionsAction}
        fetchFacet={listSectionsFacetAction}
        searchPlaceholder="Search section, grade, source"
        onEdit={async (row, column, value) => {
          const r = await updateSectionFieldAction(row.id, column.key, value);
          if (!r.success) {
            setError(r.error);
            return false;
          }
          setError('');
          return true;
        }}
        header={({ total }) => (
          <div className="flex flex-wrap gap-3">
            <Kpi label="Sections" value={fmtNum(total, 0)} tone={total ? undefined : 'amber'} />
          </div>
        )}
        toolbar={
          isAdmin ? (
            <div className="flex gap-2">
              <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-medium hover:bg-slate-50">
                <Upload className="h-4 w-4" /> Import xlsx
                <input
                  type="file"
                  accept=".xlsx,.xlsm,.xls,.csv"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void importFile(f);
                  }}
                />
              </label>
              <Button onClick={() => setAdding(true)}>
                <Plus /> Add section
              </Button>
            </div>
          ) : (
            <span className="text-xs text-slate-500">Only Admins can change the section list</span>
          )
        }
      />
      {adding && (
        <Modal title="Add GTP section" onClose={() => setAdding(false)}>
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await upsertSectionAction(form);
              if (!r.success) return setError(r.error);
              setAdding(false);
              setForm((f) => ({ ...f, label: '', kgPerM: '' }));
              setReload((n) => n + 1);
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls} htmlFor="s-label">Section (e.g. ISA 50x50x6)</label>
                <input id="s-label" required className={fieldCls} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
              </div>
              <div>
                <label className={labelCls} htmlFor="s-kgm">Standard kg/m</label>
                <input id="s-kgm" required inputMode="decimal" className={fieldCls} value={form.kgPerM} onChange={(e) => setForm({ ...form, kgPerM: e.target.value })} />
              </div>
              <div>
                <label className={labelCls} htmlFor="s-grade">Grade</label>
                <input id="s-grade" className={fieldCls} value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} />
              </div>
              <div>
                <label className={labelCls} htmlFor="s-source">Source</label>
                <input id="s-source" placeholder="SBPDCL letter 2333 dt 28-07-2025" className={fieldCls} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
              </div>
            </div>
            <p className="text-[11px] text-slate-500">An existing section with the same match key is updated.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
              <Button type="submit">Save</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
