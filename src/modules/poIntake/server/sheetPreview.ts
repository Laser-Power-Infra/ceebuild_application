import 'server-only';
import * as XLSX from 'xlsx';
import { prisma } from '@/lib/prisma';
import { UserError } from '@/lib/actionResult';
import { getObject } from '@/lib/s3';
import { readWorkbook } from '@/modules/bom/server/workbook';

// M15: preview of an attached Excel / CSV (BOM) on the review screen, so the user can check it before
// Confirm. Values as shown in Excel (formatted text), at most 300 rows x 40 columns per sheet.

const MAX_ROWS = 300;
const MAX_COLS = 40;
const SHEET_RE = /\.(xlsx|xlsm|xls|csv)$/i;

export interface SheetPreview {
  fileName: string;
  sheets: { name: string; rows: string[][]; totalRows: number; totalCols: number }[];
}

export async function sheetPreview(documentId: number): Promise<SheetPreview> {
  const doc = await prisma.orderDocument.findUnique({ where: { id: documentId }, select: { fileName: true, s3Key: true } });
  if (!doc) throw new UserError('File not found.');
  if (!SHEET_RE.test(doc.fileName)) throw new UserError('Not an Excel / CSV file.');
  if (!doc.s3Key) throw new UserError('The file was not stored.');
  const obj = await getObject(doc.s3Key);
  if (!obj) throw new UserError('The file is missing in storage.');
  const wb = readWorkbook(Buffer.from(obj.body));
  const sheets = wb.SheetNames.slice(0, 10).map((name) => {
    const ws = wb.Sheets[name];
    const all = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '', blankrows: false });
    const totalCols = all.reduce((m, r) => Math.max(m, r.length), 0);
    const rows = all.slice(0, MAX_ROWS).map((r) => r.slice(0, MAX_COLS).map((c) => (c === null || c === undefined ? '' : String(c).slice(0, 200))));
    return { name, rows, totalRows: all.length, totalCols };
  });
  return { fileName: doc.fileName, sheets };
}
