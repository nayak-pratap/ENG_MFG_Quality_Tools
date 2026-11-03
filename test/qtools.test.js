const test = require('node:test');
const assert = require('node:assert/strict');
const Q = require('../lib/qtools.js');

const near = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('normInv and normCdf are inverses and match known values', () => {
  near(Q.normInv(0.975), 1.959964, 1e-5);
  near(Q.normCdf(1.959964), 0.975, 1e-6);
  near(Q.normCdf(Q.normInv(0.001)) / 0.001, 1, 1e-6);
});

test('sigma level: 3.4 DPMO is about 6 sigma, 66807 DPMO is about 3 sigma (1.5 shift)', () => {
  near(Q.sigmaFromDpmo(3.4), 6.0, 0.01);
  near(Q.sigmaFromDpmo(66807), 3.0, 0.01);
  near(Q.dpmoFromSigma(6), 3.4, 0.01);
});

test('dpmo calculation', () => {
  assert.equal(Q.dpmo(25, 500, 10), 5000);
});

test('I-MR limits use MRbar/1.128 and 2.66*MRbar', () => {
  const x = [10, 12, 11, 13, 12, 10, 11, 12];
  const c = Q.imr(x);
  const mrbar = (2 + 1 + 2 + 1 + 2 + 1 + 1) / 7;
  near(c.range.cl, mrbar);
  near(c.sigmaWithin, mrbar / 1.128);
  near(c.ucl - c.cl, 2.66 * mrbar, 0.01);
  near(c.range.ucl, 3.267 * mrbar);
});

test('Xbar-R limits use A2 and ignore a trailing partial subgroup', () => {
  const x = [5, 6, 7, 5, 7, 6, 6, 8, 7, 9];
  const c = Q.xbarR(x, 3);
  assert.equal(c.points.length, 3);
  const rbar = (2 + 2 + 2) / 3;
  near(c.ucl - c.cl, 1.023 * rbar, 1e-6);
  near(c.sigmaWithin, rbar / 1.693, 1e-6);
});

test('Nelson rule 1, 2 and 3', () => {
  const r1 = Q.nelson([0, 0, 5, 0], 0, 1);
  assert.deepEqual(r1.filter(v => v.rule === 1).map(v => v.index), [2]);
  const r2 = Q.nelson([1, 1, 1, 1, 1, 1, 1, 1, 1, -1], 0, 10);
  assert.deepEqual(r2.filter(v => v.rule === 2).map(v => v.index), [8]);
  const r3 = Q.nelson([1, 2, 3, 4, 5, 6], 3.5, 100);
  assert.deepEqual(r3.filter(v => v.rule === 3).map(v => v.index), [5]);
});

test('capability: centred process Cp equals Cpk; offset process Cpk < Cp', () => {
  const x = [9.9, 10.1, 10.0, 9.8, 10.2, 10.0, 10.1, 9.9];
  const centred = Q.capability(x, Q.stdev(x), 9, 11);
  near(centred.Cp, centred.Cpk, 1e-6);
  const shifted = x.map(v => v + 0.4);
  const off = Q.capability(shifted, Q.stdev(shifted), 9, 11);
  assert.ok(off.Cpk < off.Cp);
  near(off.Cp, (11 - 9) / (6 * Q.stdev(shifted)), 1e-9);
});

test('one-sided spec gives Cpk but no Cp', () => {
  const x = [10, 10.2, 9.8, 10.1];
  const c = Q.capability(x, Q.stdev(x), NaN, 11);
  assert.equal(c.Cp, undefined);
  assert.ok(c.Cpk > 0);
});

test('RPN and its known ambiguity', () => {
  assert.equal(Q.rpn(10, 2, 5), 100);
  assert.equal(Q.rpn(2, 5, 10), 100);
  assert.equal(Q.rpn(4, 5, 5), 100);
});

test('illustrative AP weights severity more than RPN does', () => {
  assert.equal(Q.apIllustrative(10, 4, 3), 'H');
  assert.equal(Q.apIllustrative(2, 5, 10), 'L');
  assert.equal(Q.apIllustrative(1, 10, 10), 'L');
});

test('parseApTable reads a licensed table from CSV', () => {
  const f = Q.parseApTable('S,O,D,AP\n10,1,1,L\n10,10,10,H\n');
  assert.equal(f(10, 10, 10), 'H');
  assert.equal(f(10, 1, 1), 'L');
  assert.equal(f(5, 5, 5), undefined);
});

test('parseNumbers handles mixed separators', () => {
  assert.deepEqual(Q.parseNumbers('1, 2\n3\t4;5 x'), [1, 2, 3, 4, 5]);
});
