const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../lib/ops.js');

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('OEE: textbook example', () => {
  // 480 planned, 47 down, ideal 1 min, 19271 -> use a small clean case instead
  const r = O.oee({ plannedMin: 480, downMin: 48, idealCycleMin: 0.5, totalCount: 756, goodCount: 740 });
  near(r.availability, 432 / 480);
  near(r.performance, 378 / 432);
  near(r.quality, 740 / 756);
  near(r.oee, r.availability * r.performance * r.quality);
  near(r.oee, (0.5 * 740) / 480);          // equals fully productive time / planned time
  near(r.loss.availability + r.loss.speed + r.loss.quality + r.loss.productive, 480, 1e-9);
});

test('OEE rejects bad input and warns on impossible output', () => {
  assert.throws(() => O.oee({ plannedMin: 480, downMin: 500, idealCycleMin: 1, totalCount: 10, goodCount: 10 }));
  assert.throws(() => O.oee({ plannedMin: 480, downMin: 0, idealCycleMin: 1, totalCount: 10, goodCount: 11 }));
  assert.throws(() => O.oee({ plannedMin: 480, downMin: 0, idealCycleMin: 0, totalCount: 10, goodCount: 10 }));
  const r = O.oee({ plannedMin: 100, downMin: 0, idealCycleMin: 1, totalCount: 150, goodCount: 150 });
  assert.ok(r.warnings.length === 1);
});

test('takt and line balance', () => {
  assert.equal(O.takt(450, 90), 5);
  assert.throws(() => O.takt(450, 0));
  const b = O.lineBalance([{ name: 'a', time: 3 }, { name: 'b', time: 4 }, { name: 'c', time: 6 }], 5);
  assert.equal(b.totalWork, 13);
  assert.equal(b.minStations, 3);
  near(b.efficiency, 13 / 15);
  assert.deepEqual(b.tooLong, ['c']);
});

test("Little's Law solves for any missing term", () => {
  assert.deepEqual(O.little({ throughput: 100, leadTime: 2 }), { wip: 200, throughput: 100, leadTime: 2 });
  near(O.little({ wip: 200, leadTime: 2 }).throughput, 100);
  near(O.little({ wip: 200, throughput: 100 }).leadTime, 2);
  assert.throws(() => O.little({ wip: 1 }));
});

test('Kingman: M/M/1 at 90% utilization queues 9x process time', () => {
  const r = O.kingman({ utilization: 0.9, processTime: 10, cvArrival: 1, cvService: 1 });
  near(r.queueTime, 90);
  near(r.cycleTime, 100);
  assert.throws(() => O.kingman({ utilization: 1, processTime: 10, cvArrival: 1, cvService: 1 }));
});

test('simulation: deterministic CONWIP line matches theory', () => {
  // Three 2-minute stations, W=1: one job at a time, cycle time 6, throughput 1/6.
  const a = O.simulate({ means: [2, 2, 2], cv: 0, mode: 'conwip', wip: 1, jobs: 500 });
  near(a.cycleTime, 6, 1e-9);
  near(a.throughput, 1 / 6, 1e-6);
  // Large W: throughput limited by the slowest station.
  const b = O.simulate({ means: [2, 4, 2], cv: 0, mode: 'conwip', wip: 20, jobs: 2000 });
  near(b.throughput, 1 / 4, 1e-3);
});

test('simulation: Little holds and is reproducible with a seed', () => {
  const o = { means: [3, 4, 3], cv: 1, mode: 'conwip', wip: 6, jobs: 4000, seed: 7 };
  const a = O.simulate(o), b = O.simulate(o);
  assert.deepEqual(a, b);
  near(a.wip, a.throughput * a.cycleTime, 1e-12);
  assert.ok(a.wip <= 6 + 1e-6, 'average WIP cannot exceed the cap');
});

test('simulation: M/M/1 push matches theory within sampling error', () => {
  // arrival rate 0.8, service mean 1 -> utilization 0.8, expected cycle time 1/(1-0.8)=5
  const s = O.simulate({ means: [1], cv: 1, mode: 'push', rate: 0.8, jobs: 200000, seed: 3 });
  assert.ok(Math.abs(s.cycleTime - 5) < 0.5, String(s.cycleTime));
  assert.ok(Math.abs(s.throughput - 0.8) < 0.02, String(s.throughput));
});

test('sweep: more WIP raises cycle time and throughput saturates', () => {
  const r = O.sweepConwip({ means: [3, 4, 3], cv: 1, maxWip: 12, jobs: 6000, seed: 5 });
  assert.equal(r.length, 12);
  for (let i = 1; i < r.length; i++) assert.ok(r[i].cycleTime >= r[i - 1].cycleTime - 1e-9);
  assert.ok(r[11].throughput > r[0].throughput);
  assert.ok(r[11].throughput <= 1 / 4 + 0.01);
});

test('VSM arithmetic', () => {
  const r = O.vsm([
    { name: 'Turn', ct: 2, co: 30, uptime: 0.9, batch: 100, wipUnits: 200 },
    { name: 'Grind', ct: 4, co: 0, uptime: 1, batch: 1, wipUnits: 300 }
  ], 100, 400);
  near(r.takt, 4);
  near(r.waitDays, 5);
  near(r.valueAddedMin, 6);
  near(r.leadTimeDays, 5 + 6 / 400);
  near(r.vaRatio, (6 / 400) / (5 + 6 / 400));
  assert.equal(r.bottleneck, 'Grind');
  near(r.rows[0].effectiveMin, (2 + 0.3) / 0.9);
  assert.throws(() => O.vsm([{ name: 'x', ct: 0 }], 10, 100));
});

test('selector ranks by weighted score', () => {
  const r = O.recommend(['bottleneck', 'highmix']);
  assert.equal(r[0].slug, 'toc-dbr');
  assert.deepEqual(O.recommend([]), []);
  const top = O.recommend(['stockouts', 'forecast'])[0];
  assert.equal(top.slug, 'ddmrp');
  assert.equal(top.score, 6);
});
