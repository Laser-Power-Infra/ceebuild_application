'use server';

import { read, write, toId, UserError } from '@/lib/actionResult';
import { ADMIN_ROLES } from '@/lib/auth/server';
import { archiveFile } from '@/lib/s3';
import { toNum } from '@/lib/bom/parse';
import { DISCOUNT_MODES, type DiscountInput } from '@/lib/costing/calc';
import { addRate, deleteRate, listPurchaseItems, listRates, upsertPurchaseItem } from '@/modules/costing/server/master';
import {
  approveDrawing,
  canAddDrawings,
  createDrawing,
  deleteDrawing,
  drawingLines,
  listDrawings,
  listTechnicalUsers,
  setDrawingEditor,
  updateDrawingField,
} from '@/modules/costing/server/drawings';
import { getSessionUser } from '@/lib/auth/server';
import {
  addBomLine,
  addBomToLibrary,
  addGroupFromDrawing,
  deleteGroup,
  updateGroup,
  confirmItemBom,
  createBomFromDrawing,
  createBomFromLines,
  currentBom,
  deleteBomLine,
  docketInfo,
  itemInfo,
  loadItem,
  reopenItemBom,
  suggestDrawings,
  updateBomLine,
  updateBomMeta,
} from '@/modules/costing/server/itemBom';
import { costingDetail, docketCosting, listCostings, previewCosting, saveCosting } from '@/modules/costing/server/compute';
import { extractFromSheet, extractWithAi } from '@/modules/costing/server/extract';
import { freezeQuotation, quotationHistory } from '@/modules/costing/server/snapshot';

const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const optNum = (v: unknown) => (v === null || v === undefined || v === '' ? null : toNum(v));

// ---- Costing Master (Admin only for changes) ----

export async function costingMasterAction() {
  return read(async () => ({ purchaseItems: await listPurchaseItems(), rates: await listRates() }));
}
export async function upsertPurchaseItemAction(input: unknown) {
  return write((user) => upsertPurchaseItem(obj(input), user), { roles: ADMIN_ROLES });
}
export async function addRateAction(input: unknown) {
  return write((user) => addRate(obj(input), user), { roles: ADMIN_ROLES });
}
export async function deleteRateAction(id: unknown) {
  return write((user) => deleteRate(toId(id, 'rate'), user), { roles: ADMIN_ROLES });
}

// ---- Approved Drawing Library ----

export async function listDrawingsAction() {
  return read(async () => {
    const user = await getSessionUser().catch(() => null);
    return { drawings: await listDrawings(), canAdd: user ? await canAddDrawings(user) : false };
  });
}
export async function approveDrawingAction(id: unknown) {
  return write((user) => approveDrawing(toId(id, 'drawing'), user), { roles: ADMIN_ROLES });
}
export async function technicalUsersAction() {
  return write(() => listTechnicalUsers(), { roles: ADMIN_ROLES });
}
export async function setDrawingEditorAction(userId: unknown, on: unknown) {
  return write((user) => setDrawingEditor(toId(userId, 'user'), on === true, user), { roles: ADMIN_ROLES });
}
export async function drawingLinesAction(id: unknown) {
  return read(() => drawingLines(toId(id, 'drawing')));
}
export async function createDrawingAction(header: unknown, lines: unknown) {
  return write((user) => createDrawing(obj(header), lines, user));
}
export async function updateDrawingFieldAction(id: unknown, field: unknown, value: unknown) {
  return write((user) => updateDrawingField(toId(id, 'drawing'), String(field), String(value ?? ''), user));
}
export async function deleteDrawingAction(id: unknown) {
  return write((user) => deleteDrawing(toId(id, 'drawing'), user), { roles: ADMIN_ROLES });
}

// ---- Drawing / BOM extraction (preview only; nothing is saved) ----

const SHEET = /\.(xlsx|xlsm|xls|csv)$/i;

export async function extractSheetAction(form: FormData) {
  return write(async () => {
    const file = form.get('file');
    if (!(file instanceof File) || !SHEET.test(file.name)) throw new UserError('Choose an Excel file (.xlsx, .xls or .csv).');
    if (file.size > 20 * 1024 * 1024) throw new UserError('The file is larger than 20 MB.');
    return extractFromSheet(Buffer.from(await file.arrayBuffer()));
  }, { fallback: 'Could not read the file' });
}

export async function extractAiAction(input: unknown) {
  const o = obj(input);
  return write(
    () =>
      extractWithAi({
        text: typeof o.text === 'string' ? o.text : '',
        images: Array.isArray(o.images) ? (o.images as string[]) : [],
        fileName: typeof o.fileName === 'string' ? o.fileName.slice(0, 200) : undefined,
      }),
    { fallback: 'AI extraction failed' },
  );
}

/** Keep a copy of the enquiry drawing (when S3 is configured). Returns the key or null. */
export async function archiveDrawingAction(form: FormData) {
  return write(async () => {
    const file = form.get('file');
    if (!(file instanceof File)) throw new UserError('No file.');
    if (file.size > 20 * 1024 * 1024) throw new UserError('The file is larger than 20 MB.');
    return archiveFile(`drawings/item-${toId(form.get('itemId'), 'item')}`, file.name, Buffer.from(await file.arrayBuffer()), file.type);
  }, { fallback: 'Could not store the drawing' });
}

// ---- Item BOM + costing ----

export async function itemCostingAction(itemId: unknown) {
  return read(async () => {
    const id = toId(itemId, 'item');
    const { item, docket } = await loadItem(id);
    const bom = await currentBom(id);
    const d = docketInfo(docket);
    const structureType = bom?.structureType ?? item.ourItemName;
    return {
      item: itemInfo(item),
      docket: d,
      bom,
      suggestions: await suggestDrawings(structureType, d),
      costings: await listCostings(id),
    };
  });
}

export async function suggestDrawingsAction(itemId: unknown, structureType: unknown) {
  return read(async () => {
    const { docket } = await loadItem(toId(itemId, 'item'));
    return suggestDrawings(String(structureType ?? '').trim() || null, docketInfo(docket));
  });
}

export async function createBomFromLinesAction(itemId: unknown, input: unknown) {
  const o = obj(input);
  return write((user) =>
    createBomFromLines(
      toId(itemId, 'item'),
      {
        source: o.source === 'MANUAL' ? 'MANUAL' : 'ENQUIRY_DRAWING',
        lines: o.lines,
        fileName: typeof o.fileName === 'string' ? o.fileName : null,
        s3Key: typeof o.s3Key === 'string' ? o.s3Key : null,
        drawingRef: typeof o.drawingRef === 'string' ? o.drawingRef : null,
        note: typeof o.note === 'string' ? o.note : null,
        groups: o.groups,
        structureType: typeof o.structureType === 'string' ? o.structureType : null,
      },
      user,
    ),
  );
}

export async function createBomFromDrawingAction(itemId: unknown, drawingId: unknown, structureType: unknown) {
  return write((user) => createBomFromDrawing(toId(itemId, 'item'), toId(drawingId, 'drawing'), typeof structureType === 'string' ? structureType : null, user));
}

export async function updateBomLineAction(lineId: unknown, field: unknown, value: unknown) {
  return write((user) => updateBomLine(toId(lineId, 'line'), String(field), String(value ?? '').slice(0, 200), user));
}
export async function addBomLineAction(bomId: unknown, groupId?: unknown) {
  return write((user) => addBomLine(toId(bomId, 'BOM'), groupId === undefined || groupId === null ? null : toId(groupId, 'structure'), user));
}
export async function addGroupFromDrawingAction(bomId: unknown, drawingId: unknown, sets: unknown) {
  return write((user) => addGroupFromDrawing(toId(bomId, 'BOM'), toId(drawingId, 'drawing'), optNum(sets), user));
}
export async function updateGroupAction(groupId: unknown, field: unknown, value: unknown) {
  return write((user) => updateGroup(toId(groupId, 'structure'), String(field), String(value ?? '').slice(0, 200), user));
}
export async function deleteGroupAction(groupId: unknown) {
  return write((user) => deleteGroup(toId(groupId, 'structure'), user));
}
export async function deleteBomLineAction(lineId: unknown) {
  return write((user) => deleteBomLine(toId(lineId, 'line'), user));
}
export async function updateBomMetaAction(bomId: unknown, field: unknown, value: unknown) {
  return write((user) => updateBomMeta(toId(bomId, 'BOM'), String(field), String(value ?? ''), user));
}
export async function confirmItemBomAction(bomId: unknown) {
  return write((user) => confirmItemBom(toId(bomId, 'BOM'), user));
}
export async function reopenItemBomAction(bomId: unknown) {
  return write((user) => reopenItemBom(toId(bomId, 'BOM'), user));
}
export async function addBomToLibraryAction(bomId: unknown, header: unknown) {
  return write((user) => addBomToLibrary(toId(bomId, 'BOM'), obj(header), user));
}

/** Rev 2 §7 discount from the form: { mode, value, reason } or null. */
function optDiscount(v: unknown): DiscountInput | null {
  if (!v || typeof v !== 'object') return null;
  const d = v as Record<string, unknown>;
  const mode = String(d.mode ?? '').toUpperCase();
  const value = optNum(d.value);
  if (!(DISCOUNT_MODES as readonly string[]).includes(mode) || value === null || !(value > 0)) return null;
  return { mode: mode as DiscountInput['mode'], value, reason: typeof d.reason === 'string' ? d.reason.slice(0, 300) : null };
}

export async function previewCostingAction(bomId: unknown, opts: unknown) {
  const o = obj(opts);
  return read(() => previewCosting(toId(bomId, 'BOM'), { vaPct: optNum(o.vaPct), quoteDate: typeof o.quoteDate === 'string' ? o.quoteDate : null, discount: optDiscount(o.discount) }));
}

export async function saveCostingAction(bomId: unknown, opts: unknown) {
  const o = obj(opts);
  return write((user) =>
    saveCosting(toId(bomId, 'BOM'), { vaPct: optNum(o.vaPct), quoteDate: typeof o.quoteDate === 'string' ? o.quoteDate : null, apply: o.apply === true, discount: optDiscount(o.discount), vaApprovalReason: typeof o.vaApprovalReason === 'string' ? o.vaApprovalReason : null }, user),
  );
}

export async function costingDetailAction(id: unknown) {
  return read(() => costingDetail(toId(id, 'costing')));
}

export async function docketCostingAction(docketId: unknown) {
  return read(() => docketCosting(toId(docketId, 'docket')));
}

// ---- Rev 2 §11: frozen quotation snapshots + costing history ----

export async function quotationHistoryAction(docketId: unknown) {
  return read(() => quotationHistory(toId(docketId, 'docket')));
}
export async function freezeQuotationAction(docketId: unknown, input: unknown) {
  const o = obj(input);
  return write((user) => freezeQuotation(toId(docketId, 'docket'), { quotedOn: o.quotedOn, status: o.status, note: o.note, sentTo: o.sentTo }, user), { roles: ADMIN_ROLES });
}
