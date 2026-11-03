const test = require('node:test');
const assert = require('node:assert/strict');
const Q = require('../lib/qsys.js');
const { rng } = require('../lib/ops.js');

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

// Simulate a crossed study with known variance components.
function simulate(A, P, R, sdPart, sdAppraiser, sdRepeat, seed) {
  const r = rng(seed);
  const norm = () => { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
  const part = Array.from({ length: P }, () => 50 + sdPart * norm());
  const app = Array.from({ length: A }, () => sdAppraiser * norm());
  return app.map(ab => part.map(pv => Array.from({ length: R }, () => pv + ab + sdRepeat * norm())));
}

test('GRR recovers known repeatability and part variation', () => {
  // Average many studies to remove sampling noise.
  let ev = 0, pv = 0, n = 200;
  for (let s = 1; s <= n; s++) {
    const d = simulate(3, 10, 3, 10, 0, 1, s);
    const g = Q.grr(d);
    ev += g.repeatability; pv += g.partVariation;
  }
  assert.ok(Math.abs(ev / n - 1) < 0.08, 'EV ' + ev / n);
  assert.ok(Math.abs(pv / n - 10) < 1.5, 'PV ' + pv / n);
});

test('GRR recovers reproducibility when appraisers differ', () => {
  let av = 0, n = 300;
  for (let s = 1; s <= n; s++) av += Q.grr(simulate(3, 10, 3, 10, 2, 0.5, 1000 + s)).reproducibility;
  // with 3 appraisers the range estimator is biased slightly; allow a loose band
  assert.ok(av / n > 1.3 && av / n < 2.6, 'AV ' + av / n);
});

test('GRR hand-checked tiny case', () => {
  // 2 appraisers, 2 parts, 2 trials
  const d = [
    [[10, 12], [20, 20]],
    [[11, 13], [21, 23]]
  ];
  const g = Q.grr(d);
  const rbar = (2 + 0 + 2 + 2) / 4;               // 1.5
  near(g.repeatability, rbar * 0.8862);
  const m1 = (10 + 12 + 20 + 20) / 4, m2 = (11 + 13 + 21 + 23) / 4; // 15.5, 17
  const av = Math.sqrt(Math.pow((m2 - m1) * 0.7071, 2) - Math.pow(rbar * 0.8862, 2) / 4);
  near(g.reproducibility, av);
  const pm = [(10 + 12 + 11 + 13) / 4, (20 + 20 + 21 + 23) / 4];
  near(g.partVariation, Math.abs(pm[1] - pm[0]) * 0.7071);
  near(g.totalVariation, Math.sqrt(g.grr ** 2 + g.partVariation ** 2));
  near(g.pctEv ** 2 + g.pctPv ** 2 + g.pctAv ** 2 > 0 ? 1 : 0, 1);
});

test('GRR verdict thresholds, tolerance percent, input validation', () => {
  const good = Q.grr(simulate(3, 10, 3, 10, 0.1, 0.1, 5), { tolerance: 100 });
  assert.equal(good.verdict, 'acceptable');
  assert.ok(good.ndc >= 5);
  assert.ok(good.pctTolerance > 0);
  const bad = Q.grr(simulate(3, 10, 3, 1, 3, 3, 6));
  assert.equal(bad.verdict, 'not acceptable');
  assert.throws(() => Q.grr([[[1, 2]]]));
  assert.throws(() => Q.grr([[[1, 2], [1, 2]], [[1, 2], [1]]]));
});

test('Pareto sorts, accumulates and finds the vital few', () => {
  const p = Q.pareto([{ name: 'c', count: 5 }, { name: 'a', count: 50 }, { name: 'b', count: 30 }, { name: 'd', count: 15 }, { name: 'z', count: 0 }]);
  assert.deepEqual(p.rows.map(r => r.name), ['a', 'b', 'd', 'c']);
  assert.equal(p.total, 100);
  near(p.rows[1].cumPct, 80);
  assert.equal(p.vitalFew, 2);
  near(p.rows[3].cumPct, 100);
});

test('QFD worked example from importance share x score', () => {
  const needs = [{ name: 'Long tool life', importance: 4 }, { name: 'Good finish', importance: 1 }];
  const r = Q.qfd(needs, ['Coating', 'Edge prep', 'Packaging'], [[9, 3, 0], [3, 9, 0]]);
  near(r.needShare[0], 0.8);
  near(r.reqs[0].score, 0.8 * 9 + 0.2 * 3);
  near(r.reqs[1].score, 0.8 * 3 + 0.2 * 9);
  assert.equal(r.reqs[0].rank, 1);
  assert.equal(r.reqs[2].rank, 3);
  near(r.reqs.reduce((s, x) => s + x.pct, 0), 100);
  assert.deepEqual(r.unaddressed, []);
  const u = Q.qfd([{ name: 'x', importance: 1 }, { name: 'orphan', importance: 1 }], ['r'], [[3], [0]]);
  assert.deepEqual(u.unaddressed, ['orphan']);
});

test('PPAP readiness by level', () => {
  const all = Q.PPAP_ELEMENTS.map(e => ({ id: e.id, status: 'done' }));
  assert.equal(Q.PPAP_ELEMENTS.length, 17);
  assert.equal(Q.ppap(all, 3).ready, true);
  const missing = all.map(i => i.id === 'cp' ? { id: 'cp', status: 'inprogress' } : i);
  const r3 = Q.ppap(missing, 3);
  assert.equal(r3.ready, false);
  assert.deepEqual(r3.open, ['cp']);
  assert.equal(Q.ppap(missing, 1).ready, true);        // level 1 needs only the PSW
  const na = missing.map(i => i.id === 'cp' ? { id: 'cp', status: 'na' } : i);
  assert.equal(Q.ppap(na, 3).ready, true);
  assert.ok(Q.ppap(all, 2).note.length > 0);
  near(Q.ppap(missing, 3).pct, 100 * 16 / 17);
});

test('8D rules', () => {
  assert.ok(Q.eightD({}).length >= 6);
  const ok = { d1: 'team', d2: 'what/where', d3: 'sort stock', causeOccurrence: 'x', causeEscape: 'y', d5: 'fix', d6: 'done', d7: 'FMEA updated', verified: true, containmentRemoved: true };
  assert.deepEqual(Q.eightD(ok), []);
  const early = Object.assign({}, ok, { verified: false });
  assert.ok(Q.eightD(early).some(s => s.includes('containment removed before')));
  const noEscape = Object.assign({}, ok, { causeEscape: '' });
  assert.ok(Q.eightD(noEscape).some(s => s.includes('escape')));
});
