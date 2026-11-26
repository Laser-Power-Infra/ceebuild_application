import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileForPo, filesForPart, partKey, partTargets, partThreadId, splitThreadId } from '../src/lib/po/multiPo';
import { normaliseExtraction } from '../src/lib/po/normalise';
import type { MailFile } from '../src/lib/mailFiles';

const f = (name: string, kind: MailFile['kind'], driveId = name.replace(/\W/g, '').slice(0, 12)): MailFile => ({ name, kind, driveId }) as MailFile;

// The UPCL second-lot mail of 26-11-2026.
const files = [
  f('PO Ceebuild2 NC26Y-00016.PDF', 'PO'),
  f('PO Ceebuild OBND O226Y-00051.PDF', 'PO'),
  f('PO Ceebuild1 NC26Y-00008.PDF', 'PO'),
  f('MC Ceebuild OBND RC26Y-020.PDF', 'PO'),
  f('Ceebuild SUMMARY SHEET.pdf', 'PO'),
  f('icon.png', 'SKIP'),
];

test('part thread ids', () => {
  assert.equal(partKey('LIL/SBPDCL/RDSS/2026-27/112'), 'LIL-SBPDCL-RDSS-2026-27-112');
  assert.equal(partThreadId('1a01a21c810f0436', 'NC26Y-00008'), '1a01a21c810f0436~NC26Y-00008');
  assert.deepEqual(splitThreadId('1a01a21c810f0436~NC26Y-00008'), { threadId: '1a01a21c810f0436', part: 'NC26Y-00008' });
  assert.deepEqual(splitThreadId('1a01a21c810f0436'), { threadId: '1a01a21c810f0436', part: null });
});

test('file of a PO: by the name the AI gave, else by the PO no. in the name', () => {
  assert.equal(fileForPo(files, 'NC26Y-00008', 'po ceebuild1 nc26y-00008.pdf')?.name, 'PO Ceebuild1 NC26Y-00008.PDF');
  assert.equal(fileForPo(files, 'O226Y-00051', null)?.name, 'PO Ceebuild OBND O226Y-00051.PDF');
  assert.equal(fileForPo(files, 'XX99', null), null);
});

test('other POs of the mail: the one read, existing orders and repeats are left out', () => {
  const t = partTargets(
    '1a01a21c810f0436',
    'NC26Y-00016',
    [
      { poNumber: 'NC26Y-00008', fileName: 'PO Ceebuild1 NC26Y-00008.PDF' },
      { poNumber: 'O226Y-00051', fileName: null },
      { poNumber: 'NC26Y 00016', fileName: null },
      { poNumber: 'nc26y-00008', fileName: null },
      { poNumber: 'BB26Y-00017', fileName: null },
      { poNumber: 'ZZ26Y-00099', fileName: null },
    ],
    files,
    ['BB26Y-00017'],
  );
  assert.deepEqual(
    t.map((x) => [x.partId, x.file.name]),
    [
      ['1a01a21c810f0436~NC26Y-00008', 'PO Ceebuild1 NC26Y-00008.PDF'],
      ['1a01a21c810f0436~O226Y-00051', 'PO Ceebuild OBND O226Y-00051.PDF'],
    ],
  );
  const part = filesForPart([...files, f('BOM lot2.xlsx', 'BOM')], t[0].file).map((x) => x.name);
  assert.deepEqual(part, ['PO Ceebuild1 NC26Y-00008.PDF', 'BOM lot2.xlsx']);
});

test('OTHER_PO lines become otherPos, not warnings', () => {
  const ex = normaliseExtraction({ documentType: 'PURCHASE_ORDER', fields: {}, lines: [], bomPieces: [], warnings: ['OTHER_PO: NC26Y-00008 | PO Ceebuild1 NC26Y-00008.PDF', 'other_po: O226Y-00051', 'Totals differ'] } as never, 'gemini');
  assert.deepEqual(ex.otherPos, [
    { poNumber: 'NC26Y-00008', fileName: 'PO Ceebuild1 NC26Y-00008.PDF' },
    { poNumber: 'O226Y-00051', fileName: null },
  ]);
  assert.deepEqual(ex.warnings, ['Totals differ']);
});
