const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../lib/smed.js');

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('separating external work out of the stopped window is the whole first stage', () => {
  const tasks = [
    { name: 'Fetch tooling', minutes: 12, current: 'internal', canBe: 'external' },
    { name: 'Pre-heat die', minutes: 8, current: 'internal', canBe: 'external' },
    { name: 'Unbolt and remove', minutes: 10, current: 'internal', canBe: 'internal' },
    { name: 'Fit and align', minutes: 10, current: 'internal', canBe: 'internal' }
  ];
  const r = M.analyze(tasks);
  near(r.baseline, 40);
  near(r.separated, 20);
  near(r.savedBySeparating, 20);
  near(r.pctBySeparating, 50);
  near(r.streamlined, 20);         // no targets given, so nothing streamlined
  near(r.pctTotal, 50);
  assert.deepEqual(r.movedOut.map(t => t.name), ['Fetch tooling', 'Pre-heat die']);
  near(r.multiplier, 2);
});

test('streamlining reduces only the tasks that stay internal', () => {
  const tasks = [
    { name: 'Fetch tooling', minutes: 12, current: 'internal', canBe: 'external', targetMinutes: 3 },
    { name: 'Unbolt and remove', minutes: 10, current: 'internal', canBe: 'internal', targetMinutes: 6 },
    { name: 'Fit and align', minutes: 10, current: 'internal', canBe: 'internal', targetMinutes: 4 }
  ];
  const r = M.analyze(tasks);
  near(r.baseline, 32);
  near(r.separated, 20);
  near(r.streamlined, 10);         // the external task's target does not count
  near(r.savedByStreamlining, 10);
  near(r.pctTotal, 100 * 22 / 32);
  assert.deepEqual(r.reduced.map(t => t.name), ['Unbolt and remove', 'Fit and align']);
});

test('work already done externally never counts toward the stopped time', () => {
  const tasks = [
    { name: 'Stage trolley', minutes: 20, current: 'external', canBe: 'external' },
    { name: 'Clamp', minutes: 5, current: 'internal', canBe: 'internal' }
  ];
  const r = M.analyze(tasks);
  near(r.baseline, 5);
  near(r.separated, 5);
  near(r.externalAfter, 20);
  near(r.pctTotal, 0);
});

test('external load after the change is reported, since someone still does that work', () => {
  const r = M.analyze([
    { name: 'Fetch', minutes: 12, current: 'internal', canBe: 'external' },
    { name: 'Prep kit', minutes: 6, current: 'external', canBe: 'external' },
    { name: 'Align', minutes: 9, current: 'internal', canBe: 'internal' }
  ]);
  near(r.externalAfter, 18);
  near(r.baseline, 21);
  near(r.separated, 9);
});

test('a target longer than the current time is warned about, not silently used', () => {
  const r = M.analyze([{ name: 'Align', minutes: 5, current: 'internal', canBe: 'internal', targetMinutes: 9 }]);
  assert.equal(r.warnings.length, 1);
  assert.ok(r.warnings[0].includes('Align'));
  near(r.streamlined, 9);
});

test('empty target falls back to the current time', () => {
  const r = M.analyze([{ name: 'Align', minutes: 5, current: 'internal', canBe: 'internal', targetMinutes: '' }]);
  near(r.streamlined, 5);
});

test('everything external gives a zero changeover and an infinite multiplier', () => {
  const r = M.analyze([{ name: 'Prep', minutes: 10, current: 'internal', canBe: 'external' }]);
  near(r.baseline, 10);
  near(r.streamlined, 0);
  near(r.pctTotal, 100);
  assert.equal(r.multiplier, Infinity);
});

test('validation', () => {
  assert.throws(() => M.analyze([]), /at least one/);
  assert.throws(() => M.analyze([{ name: 'x', minutes: -1, current: 'internal', canBe: 'internal' }]), /zero minutes or more/);
  assert.throws(() => M.analyze([{ name: 'x', minutes: 'abc', current: 'internal', canBe: 'internal' }]));
  assert.throws(() => M.analyze([{ name: 'x', minutes: 5, current: 'internal', canBe: 'internal', targetMinutes: -2 }]), /invalid target/);
});

test('batch size falls as changeover time falls', () => {
  const before = M.batchSize(500, 60, 40);
  const after = M.batchSize(500, 60, 10);
  near(before.changeoversPerDay, 1.5);
  near(before.batch, 500 / 1.5);
  near(after.changeoversPerDay, 6);
  near(after.batch, 500 / 6);
  assert.ok(after.batch < before.batch);
});

test('batch size validates its inputs', () => {
  assert.throws(() => M.batchSize(0, 60, 10), /Demand/);
  assert.throws(() => M.batchSize(500, 0, 10), /budget/);
  assert.throws(() => M.batchSize(500, 60, 0), /Changeover time must/);
});
