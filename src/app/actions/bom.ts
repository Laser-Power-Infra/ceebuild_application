'use server';

import { read, write, cleanQuery, toId, UserError } from '@/lib/actionResult';
import { currentUpload, listPieces, listPiecesFacet } from '@/modules/bom/server/query';
import { confirmBom, importBom, previewBom, reopenBom, updatePiece } from '@/modules/bom/server/mutations';
import { fileBytes } from '@/modules/bom/server/workbook';

export async function currentUploadAction(orderId: unknown) {
  return read(() => currentUpload(toId(orderId, 'order')));
}

export async function listPiecesAction(query: unknown) {
  const q = cleanQuery(query);
  return read(() => listPieces(toId(q.extra?.uploadId, 'BOM'), q));
}

export async function listPiecesFacetAction(key: unknown, query: unknown) {
  const q = cleanQuery(query);
  return read(() => listPiecesFacet(toId(q.extra?.uploadId, 'BOM'), String(key), q));
}

const optInt = (v: FormDataEntryValue | null) => (v === null || v === '' ? null : Number(v));

/** Reading a file changes nothing, but it is still limited to editors (it is the first step of an import). */
export async function previewBomAction(form: FormData) {
  return write(async () => {
    const file = await fileBytes(form.get('file'));
    const headerRow = optInt(form.get('headerRow'));
    if (headerRow !== null && !Number.isInteger(headerRow)) throw new UserError('Invalid header row.');
    return previewBom(file.buffer, (form.get('sheet') as string) || null, headerRow);
  });
}

export async function importBomAction(form: FormData) {
  return write(async (user) => {
    const file = await fileBytes(form.get('file'));
    let map: unknown;
    try {
      map = JSON.parse(String(form.get('map') ?? '{}'));
    } catch {
      throw new UserError('Invalid column mapping.');
    }
    const headerRow = optInt(form.get('headerRow'));
    return importBom(toId(form.get('orderId'), 'order'), file, { sheet: (form.get('sheet') as string) || null, headerRow, map }, user);
  }, { fallback: 'Import failed' });
}

export async function updatePieceAction(pieceId: unknown, field: unknown, value: unknown) {
  return write((user) => updatePiece(toId(pieceId, 'row'), String(field), String(value ?? '').slice(0, 200), user));
}

export async function confirmBomAction(uploadId: unknown, note: unknown) {
  return write((user) => confirmBom(toId(uploadId, 'BOM'), String(note ?? ''), user));
}

export async function reopenBomAction(uploadId: unknown) {
  return write((user) => reopenBom(toId(uploadId, 'BOM'), user));
}
