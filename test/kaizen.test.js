const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../lib/kaizen.js');

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const TODAY = '2026-11-08';

test('gain direction is inferred from target vs baseline', () => {
  // lower is better: scrap 5% -> 2%
  near(K.gainOf(5, 2, 3), 2);
  // higher is better: OEE 60 -> 80
  near(K.gainOf(60, 80, 70), 10);
  // a move the wrong way is a negative gain either way
  near(K.gainOf(5, 2, 6), -1);
  near(K.gainOf(60, 80, 55), -5);
});

test('progress: holding when the latest check is at or above the threshold', () => {
  const p = K.progress({
    baseline: 10, target: 4, date: '2026-01-10',
    checks: [{ date: '2026-02-10', value: 4.5 }, { date: '2026-05-10', value: 5 }]
  }, { today: TODAY });
  near(p.targetGain, 6);
  assert.equal(p.direction, 'down');
  near(p.pctOfTarget, 100 * 5 / 6);          // 83.3% of the target gain
  assert.equal(p.status, 'holding');
  near(p.peakPctOfTarget, 100 * 5.5 / 6);
  near(p.decayPoints, 100 * 5.5 / 6 - 100 * 5 / 6);
});

test('progress: decayed means it reached the threshold, then fell back', () => {
  const p = K.progress({
    baseline: 100, target: 150, date: '2026-01-01',
    checks: [{ date: '2026-02-01', value: 148 }, { date: '2026-08-01', value: 112 }]
  }, { today: TODAY });
  assert.equal(p.status, 'decayed');
  near(p.peakPctOfTarget, 96);
  near(p.pctOfTarget, 24);
  near(p.decayPoints, 72);
});

test('progress: short means it never reached the threshold', () => {
  const p = K.progress({ baseline: 100, target: 150, date: '2026-01-01', checks: [{ date: '2026-02-01', value: 110 }] }, { today: TODAY });
  assert.equal(p.status, 'short');
  near(p.pctOfTarget, 20);
  assert.equal(p.decayPoints, 0);
});

test('progress: no check means unverified, and overdue counts from implementation', () => {
  const p = K.progress({ baseline: 10, target: 5, date: '2026-01-01', checks: [] }, { today: TODAY });
  assert.equal(p.status, 'unverified');
  assert.equal(p.latest, null);
  assert.equal(p.pctOfTarget, null);
  assert.equal(p.daysSinceReview, K.daysBetween(TODAY, '2026-01-01'));
  assert.equal(p.overdue, true);
});

test('progress: overdue respects the review interval and the latest check date', () => {
  const imp = { baseline: 10, target: 5, date: '2026-01-01', checks: [{ date: '2026-10-20', value: 5 }] };
  assert.equal(K.progress(imp, { today: TODAY }).overdue, false);        // 19 days, under 90
  assert.equal(K.progress(imp, { today: TODAY, reviewDays: 10 }).overdue, true);
});

test('progress: checks are sorted, so out-of-order entry is safe', () => {
  const p = K.progress({
    baseline: 0, target: 10, date: '2026-01-01',
    checks: [{ date: '2026-06-01', value: 3 }, { date: '2026-02-01', value: 9 }]
  }, { today: TODAY });
  assert.deepEqual(p.checks.map(c => c.date), ['2026-02-01', '2026-06-01']);
  near(p.pctOfTarget, 30);
  assert.equal(p.status, 'decayed');
});

test('progress: threshold is configurable', () => {
  const imp = { baseline: 0, target: 10, date: '2026-01-01', checks: [{ date: '2026-03-01', value: 7 }] };
  assert.equal(K.progress(imp, { today: TODAY }).status, 'short');                      // 70% < 80
  assert.equal(K.progress(imp, { today: TODAY, holdThreshold: 70 }).status, 'holding');
});

test('progress: validates inputs', () => {
  assert.throws(() => K.progress({ baseline: 5, target: 5, date: '2026-01-01' }, { today: TODAY }), /differ from baseline/);
  assert.throws(() => K.progress({ baseline: 1, target: 2, date: 'not a date' }, { today: TODAY }));
  assert.throws(() => K.progress({ baseline: 1, target: 2, date: '2026-01-01', checks: [{ date: '2026-02-01', value: 'x' }] }, { today: TODAY }));
  assert.throws(() => K.progress({ target: 2, date: '2026-01-01' }, { today: TODAY }), /Baseline/);
});

test('boardStats counts statuses, owners and the unverified blind spot', () => {
  const imps = [
    { title: 'a', owner: 'Ravi', type: 'daily', baseline: 10, target: 5, date: '2026-01-01', checks: [{ date: '2026-10-01', value: 5 }] },
    { title: 'b', owner: 'ravi ', type: 'event', baseline: 10, target: 5, date: '2026-01-01', checks: [{ date: '2026-02-01', value: 5 }, { date: '2026-09-01', value: 9 }] },
    { title: 'c', owner: 'Mei', type: 'daily', baseline: 10, target: 5, date: '2026-01-01', checks: [] },
    { title: 'd', owner: 'Mei', type: 'daily', baseline: 10, target: 5, date: '2026-03-01', checks: [{ date: '2026-04-01', value: 9 }] }
  ];
  const s = K.boardStats(imps, { today: TODAY });
  assert.equal(s.total, 4);
  assert.deepEqual(s.counts, { holding: 1, decayed: 1, short: 1, unverified: 1 });
  assert.equal(s.verified, 3);
  near(s.holdingRate, 100 / 3);
  near(s.unverifiedRate, 25);
  assert.equal(s.distinctOwners, 2);                 // 'Ravi' and 'ravi ' are one person
  assert.deepEqual(s.byType, { daily: 3, event: 1 });
  // 'b' was checked 68 days ago, inside the 90-day window, so it is decayed but not overdue.
  assert.deepEqual(s.overdue.map(i => i.title), ['c', 'd']);
  assert.equal(K.progress(imps[1], { today: TODAY }).daysSinceReview, 68);
});

test('boardStats on an empty board does not divide by zero', () => {
  const s = K.boardStats([], { today: TODAY });
  assert.equal(s.total, 0);
  assert.equal(s.holdingRate, null);
  assert.equal(s.unverifiedRate, 0);
});

test('readiness scores the four factors and names the weakest', () => {
  assert.equal(K.READINESS_FACTORS.length, 4);
  const good = K.readiness({ learning: 5, experimentation: 4, review: 4, acceptance: 4 });
  assert.equal(good.total, 17);
  assert.equal(good.max, 20);
  assert.ok(good.verdict.includes('supportive'));
  const weak = K.readiness({ learning: 2, experimentation: 2, review: 1, acceptance: 3 });
  assert.equal(weak.total, 8);
  assert.deepEqual(weak.weakest.map(w => w.id), ['review']);
  assert.ok(weak.verdict.includes('likely to fade'));
  const mixed = K.readiness({ learning: 4, experimentation: 4, review: 1, acceptance: 3 });
  assert.equal(mixed.total, 12);
  assert.ok(mixed.verdict.includes('weak factor'));
  assert.throws(() => K.readiness({ learning: 6, experimentation: 1, review: 1, acceptance: 1 }));
  assert.throws(() => K.readiness({ learning: 3 }));
});

test('daysBetween is whole days and order-sensitive', () => {
  assert.equal(K.daysBetween('2026-01-11', '2026-01-01'), 10);
  assert.equal(K.daysBetween('2026-01-01', '2026-01-11'), -10);
});
