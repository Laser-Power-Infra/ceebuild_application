import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMachinePlan,
  defaultRouting,
  machineCapacityPerDay,
  operationsOf,
  unitsPerPiece,
  type PlanMachine,
  type Routing,
} from '../src/lib/planning/machines';

const machine = (o: Partial<PlanMachine> & { code: string; operation: string }): PlanMachine => ({
  id: Math.floor(Math.random() * 1e6),
  name: o.code,
  units: 1,
  ratePerHour: 100,
  shiftsPerDay: 1,
  hoursPerShift: 8,
  utilisationPct: 100,
  active: true,
  rateConfirmed: true,
  ...o,
});
const route = (o: Partial<Routing> = {}): Routing => ({ ...defaultRouting('ISA 50x50x6'), ...o });

test('defaultRouting: channels are cropped, angles/flats sheared, numbered by default', () => {
  assert.equal(defaultRouting('ISMC 100x50').cutOp, 'CROPPING');
  assert.equal(defaultRouting('ISMC100X50').cutOp, 'CROPPING');
  assert.equal(defaultRouting('MC 75').cutOp, 'CROPPING');
  assert.equal(defaultRouting('ISA 65x65x6').cutOp, 'SHEARING');
  assert.equal(defaultRouting('FLAT 50x6').cutOp, 'SHEARING');
  assert.equal(defaultRouting(null).cutOp, 'SHEARING');
  const r = defaultRouting('ISA 50x50x6');
  assert.deepEqual([r.holes, r.notches, r.bends, r.welds, r.threads, r.numbering], [0, 0, 0, 0, 0, true]);
});

test('unitsPerPiece and operationsOf follow the routing', () => {
  const r = route({ holes: 4, bends: 2 });
  assert.equal(unitsPerPiece(r, 'SHEARING'), 1);
  assert.equal(unitsPerPiece(r, 'CROPPING'), 0);
  assert.equal(unitsPerPiece(r, 'PUNCHING'), 4);
  assert.deepEqual(operationsOf(r), ['SHEARING', 'PUNCHING', 'BENDING', 'NUMBERING']);
  assert.deepEqual(operationsOf(route({ cutOp: 'NONE', numbering: false })), []);
});

test('capacity = rate x units x shifts x hours x utilisation; inactive or zero shifts give 0', () => {
  assert.equal(machineCapacityPerDay(machine({ code: 'UP-1', operation: 'CROPPING', ratePerHour: 120, units: 2, shiftsPerDay: 2, hoursPerShift: 8, utilisationPct: 75 })), 2880);
  assert.equal(machineCapacityPerDay(machine({ code: 'X', operation: 'CROPPING', active: false })), 0);
  assert.equal(machineCapacityPerDay(machine({ code: 'X', operation: 'CROPPING', shiftsPerDay: 0 })), 0);
});

test('load splits across an operation in proportion to capacity; bottleneck is the slowest operation', () => {
  const machines = [
    machine({ code: 'SH1', operation: 'SHEARING', ratePerHour: 100 }), // 800/day
    machine({ code: 'PP1', operation: 'SHEARING', ratePerHour: 300 }), // 2400/day
    machine({ code: 'PP2', operation: 'PUNCHING', ratePerHour: 50 }), // 400/day
    machine({ code: 'PP6', operation: 'NUMBERING', ratePerHour: 1000 }),
  ];
  const plan = computeMachinePlan([{ markNo: 'A1', qty: 3200, routing: route({ holes: 2 }) }], machines, 6);
  const shear = plan.operations.find((o) => o.operation === 'SHEARING')!;
  assert.equal(shear.load, 3200);
  assert.equal(shear.days, 1);
  assert.deepEqual(shear.machines.map((m) => [m.code, m.load, m.days]), [['SH1', 800, 1], ['PP1', 2400, 1]]);
  const punch = plan.operations.find((o) => o.operation === 'PUNCHING')!;
  assert.equal(punch.load, 6400);
  assert.equal(punch.days, 16);
  assert.deepEqual(plan.bottleneck, { operation: 'PUNCHING', days: 16 });
  assert.equal(plan.totalDays, 16);
  assert.equal(plan.weeks, 2.7);
});

test('an operation with load but no active machine blocks the plan instead of dividing by zero', () => {
  const plan = computeMachinePlan([{ markNo: 'T1', qty: 10, routing: route({ bends: 2, numbering: false }) }], [machine({ code: 'SH1', operation: 'SHEARING' })]);
  const bend = plan.operations.find((o) => o.operation === 'BENDING')!;
  assert.equal(bend.noMachine, true);
  assert.equal(bend.outside, false);
  assert.equal(bend.days, null);
  assert.deepEqual(plan.bottleneck, { operation: 'BENDING', days: null });
  assert.equal(plan.totalDays, null);
  assert.equal(plan.weeks, null);
});

test('threading with no in-house machine goes to outside job work (Laser) and does not block', () => {
  const plan = computeMachinePlan(
    [{ markNo: 'T1', qty: 10, routing: route({ threads: 2, numbering: false }) }],
    [machine({ code: 'SH1', operation: 'SHEARING' }), machine({ code: 'LN1', operation: 'THREADING', active: false })],
  );
  const thread = plan.operations.find((o) => o.operation === 'THREADING')!;
  assert.equal(thread.noMachine, true);
  assert.equal(thread.outside, true);
  assert.equal(thread.days, null);
  assert.notEqual(plan.totalDays, null);
  assert.equal(plan.bottleneck?.operation, 'SHEARING');
});

test('REMAINING basis subtracts what is already produced per operation and never goes negative', () => {
  const machines = [machine({ code: 'SH1', operation: 'SHEARING' }), machine({ code: 'PP2', operation: 'PUNCHING' }), machine({ code: 'PP6', operation: 'NUMBERING' })];
  const plan = computeMachinePlan(
    [{ markNo: 'A1', qty: 100, routing: route({ holes: 3 }), produced: { SHEARING: 100, PUNCHING: 40, NUMBERING: 500 } }],
    machines,
  );
  assert.equal(plan.operations.find((o) => o.operation === 'SHEARING'), undefined);
  assert.equal(plan.operations.find((o) => o.operation === 'NUMBERING'), undefined);
  assert.equal(plan.operations.find((o) => o.operation === 'PUNCHING')!.load, 180);
});

test('unconfirmed rates are reported; empty input gives an empty plan', () => {
  const plan = computeMachinePlan([{ markNo: 'A1', qty: 5, routing: route() }], [machine({ code: 'SH1', operation: 'SHEARING', rateConfirmed: false }), machine({ code: 'PP6', operation: 'NUMBERING' })]);
  assert.equal(plan.unconfirmedRates, true);
  const empty = computeMachinePlan([], []);
  assert.deepEqual([empty.operations.length, empty.bottleneck, empty.totalDays], [0, null, 0]);
});
