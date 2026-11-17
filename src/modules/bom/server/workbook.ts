import 'server-only';
import * as XLSX from 'xlsx';
import { UserError } from '@/lib/actionResult';

export const MAX_BOM_BYTES = 20 * 1024 * 1024;
const MAX_ROWS = 20000;
const ALLOWED = /\.(xlsx|xlsm|xls|csv)$/i;

/** Uploaded File -> bytes, after size/type checks. */
export async function fileBytes(file: unknown): Promise<{ name: string; type: string; buffer: Buffer }> {
  if (!(file instanceof File)) throw new UserError('Choose an Excel file (.xlsx, .xls or .csv).');
  if (!ALLOWED.test(file.name)) throw new UserError('Only .xlsx, .xlsm, .xls or .csv files can be imported.');
  if (file.size === 0) throw new UserError('The file is empty.');
  if (file.size > MAX_BOM_BYTES) throw new UserError('The file is larger than 20 MB.');
  return { name: file.name, type: file.type, buffer: Buffer.from(await file.arrayBuffer()) };
}

export function readWorkbook(buffer: Buffer) {
  try {
    return XLSX.read(buffer, { type: 'buffer', cellDates: true, dense: true });
  } catch {
    throw new UserError('Could not read this file as a spreadsheet.');
  }
}

/** Cell grid of one sheet (first sheet when `sheet` is blank), values as typed in Excel. */
export function sheetCells(wb: XLSX.WorkBook, sheet?: string | null): { sheetName: string; cells: unknown[][] } {
  const sheetName = sheet && wb.SheetNames.includes(sheet) ? sheet : wb.SheetNames[0];
  if (!sheetName) throw new UserError('The workbook has no sheets.');
  const cells = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, raw: true, defval: '', blankrows: true });
  if (cells.length > MAX_ROWS) throw new UserError(`The sheet has more than ${MAX_ROWS} rows.`);
  return { sheetName, cells };
}
