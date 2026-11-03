/* qsys.js - quality-systems helpers: Gage R&R (average and range), Pareto, QFD scoring,
 * PPAP readiness and 8D completeness checks. Plain JS, no dependencies.
 */
(function (root) {
  'use strict';

  /* ---------- Gage R&R, average and range method ----------
   * data[a][p] = array of trial readings for appraiser a, part p. Supports 2-3 appraisers, 2-3 trials, 2-10 parts.
   * K constants are 1/d2* for the relevant counts (AIAG MSA average-and-range method). */
  var K1 = { 2: 0.8862, 3: 0.5908 };
  var K2 = { 2: 0.7071, 3: 0.5231 };
  var K3 = { 2: 0.7071, 3: 0.5231, 4: 0.4467, 5: 0.4030, 6: 0.3742, 7: 0.3534, 8: 0.3375, 9: 0.3249, 10: 0.3146 };

  function mean(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s / a.length; }

  function grr(data, o) {
    o = o || {};
    var A = data.length;
    if (!K2[A]) throw new Error('Use 2 or 3 appraisers');
    var P = data[0].length;
    if (!K3[P]) throw new Error('Use 2 to 10 parts');
    var R = data[0][0].length;
    if (!K1[R]) throw new Error('Use 2 or 3 trials');
    var a, p, t, ranges = [], appMeans = [], partSums = [];
    for (p = 0; p < P; p++) partSums.push([]);
    for (a = 0; a < A; a++) {
      if (data[a].length !== P) throw new Error('Every appraiser needs the same parts');
      var all = [];
      for (p = 0; p < P; p++) {
        var tr = data[a][p];
        if (tr.length !== R) throw new Error('Every part needs the same number of trials');
        for (t = 0; t < R; t++) {
          if (typeof tr[t] !== 'number' || !isFinite(tr[t])) throw new Error('All readings must be numbers');
        }
        ranges.push(Math.max.apply(null, tr) - Math.min.apply(null, tr));
        all = all.concat(tr);
        partSums[p] = partSums[p].concat(tr);
      }
      appMeans.push(mean(all));
    }
    var rbar = mean(ranges);
    var ev = rbar * K1[R];
    var xdiff = Math.max.apply(null, appMeans) - Math.min.apply(null, appMeans);
    var av2 = Math.pow(xdiff * K2[A], 2) - (ev * ev) / (P * R);
    var av = av2 > 0 ? Math.sqrt(av2) : 0;
    var g = Math.sqrt(ev * ev + av * av);
    var partMeans = partSums.map(mean);
    var rp = Math.max.apply(null, partMeans) - Math.min.apply(null, partMeans);
    var pv = rp * K3[P];
    var tv = Math.sqrt(g * g + pv * pv);
    var out = {
      repeatability: ev, reproducibility: av, grr: g, partVariation: pv, totalVariation: tv,
      pctGrr: tv > 0 ? 100 * g / tv : NaN,
      pctEv: tv > 0 ? 100 * ev / tv : NaN,
      pctAv: tv > 0 ? 100 * av / tv : NaN,
      pctPv: tv > 0 ? 100 * pv / tv : NaN,
      ndc: g > 0 ? Math.floor(1.41 * pv / g) : Infinity,
      appraiserMeans: appMeans
    };
    if (o.tolerance > 0) out.pctTolerance = 100 * 6 * g / o.tolerance;
    out.verdict = out.pctGrr < 10 ? 'acceptable' : out.pctGrr <= 30 ? 'marginal' : 'not acceptable';
    return out;
  }

  /* ---------- Pareto ---------- */
  function pareto(items, cutoff) {
    cutoff = cutoff === undefined ? 80 : cutoff;
    var clean = items.filter(function (i) { return i.count > 0; }).slice().sort(function (x, y) { return y.count - x.count; });
    var total = clean.reduce(function (s, i) { return s + i.count; }, 0), cum = 0, vital = 0;
    var rows = clean.map(function (i, idx) {
      var before = cum;
      cum += i.count;
      var row = { name: i.name, count: i.count, pct: 100 * i.count / total, cumPct: 100 * cum / total };
      if (before / total * 100 < cutoff) vital = idx + 1;
      return row;
    });
    return { rows: rows, total: total, vitalFew: vital };
  }

  /* ---------- QFD scoring ----------
   * needs: [{name, importance}], reqs: [names], matrix[n][r] = relationship score (0,1,3,9 or any number).
   * Requirement importance = sum over needs of (need weight share x score). Returns raw, share, rank. */
  function qfd(needs, reqs, matrix) {
    var tot = needs.reduce(function (s, n) { return s + n.importance; }, 0);
    if (!(tot > 0)) throw new Error('Needs must have an importance above zero');
    var shares = needs.map(function (n) { return n.importance / tot; });
    var scores = reqs.map(function (name, r) {
      var s = 0;
      for (var n = 0; n < needs.length; n++) s += shares[n] * (matrix[n][r] || 0);
      return s;
    });
    var sum = scores.reduce(function (a, b) { return a + b; }, 0);
    var order = scores.map(function (s, i) { return i; }).sort(function (a, b) { return scores[b] - scores[a] || a - b; });
    var rank = []; order.forEach(function (idx, pos) { rank[idx] = pos + 1; });
    return {
      needShare: shares,
      reqs: reqs.map(function (name, i) { return { name: name, score: scores[i], pct: sum > 0 ? 100 * scores[i] / sum : 0, rank: rank[i] }; }),
      unaddressed: needs.map(function (n, i) { return { n: n.name, i: i }; }).filter(function (x) {
        return reqs.every(function (r, j) { return !(matrix[x.i][j] > 0); });
      }).map(function (x) { return x.n; })
    };
  }

  /* ---------- PPAP readiness ----------
   * items: [{id, status}] with status in notstarted | inprogress | done | na.
   * Level 1: only the PSW is required. Levels 2 to 5: every applicable element, with 2 and 4 flagged as customer-defined. */
  var PPAP_ELEMENTS = [
    { id: 'design', name: 'Design records and engineering drawings' },
    { id: 'ecn', name: 'Engineering change documents' },
    { id: 'custapproval', name: 'Customer engineering approval, where required' },
    { id: 'dfmea', name: 'Design FMEA' },
    { id: 'pfmea', name: 'Process FMEA' },
    { id: 'flow', name: 'Process flow diagram' },
    { id: 'cp', name: 'Control plan' },
    { id: 'msa', name: 'Measurement systems analysis (MSA) studies' },
    { id: 'dim', name: 'Dimensional results' },
    { id: 'tests', name: 'Material and performance test results' },
    { id: 'capability', name: 'Initial process studies, including capability (Cp/Cpk)' },
    { id: 'lab', name: 'Qualified laboratory documentation' },
    { id: 'aar', name: 'Appearance approval report, where applicable' },
    { id: 'samples', name: 'Sample production parts and master sample' },
    { id: 'aids', name: 'Checking aids' },
    { id: 'custspecific', name: 'Customer-specific requirements' },
    { id: 'psw', name: 'Part submission warrant (PSW)' }
  ];

  function ppap(items, level) {
    var byId = {}; items.forEach(function (i) { byId[i.id] = i.status; });
    var required = level === 1 ? ['psw'] : PPAP_ELEMENTS.map(function (e) { return e.id; });
    var applicable = required.filter(function (id) { return byId[id] !== 'na'; });
    var done = applicable.filter(function (id) { return byId[id] === 'done'; });
    var open = applicable.filter(function (id) { return byId[id] !== 'done'; });
    return {
      required: applicable.length, done: done.length,
      pct: applicable.length ? 100 * done.length / applicable.length : 100,
      open: open, ready: open.length === 0,
      note: (level === 2 || level === 4) ? 'The customer defines what Level ' + level + ' requires; confirm with them before trusting this checklist.' : ''
    };
  }

  /* ---------- 8D completeness ----------
   * r: {d1..d8 text fields, causeOccurrence, causeEscape, containmentRemoved (bool), verified (bool)}.
   * Returns the list of rule problems; empty means nothing blocks closing. */
  function eightD(r) {
    var issues = [], has = function (k) { return typeof r[k] === 'string' && r[k].trim().length > 0; };
    if (!has('d1')) issues.push('D1: no team named.');
    if (!has('d2')) issues.push('D2: problem not described with what, where, when and how many.');
    if (!has('d3')) issues.push('D3: no interim containment recorded.');
    if (!has('causeOccurrence')) issues.push('D4: cause of occurrence missing.');
    if (!has('causeEscape')) issues.push('D4: cause of escape missing; the customer stays exposed.');
    if (!has('d5')) issues.push('D5: no permanent corrective action.');
    if (r.containmentRemoved && !r.verified) issues.push('D3/D6: containment removed before the permanent fix was verified.');
    if (!r.containmentRemoved && r.verified && has('d6')) issues.push('D6: fix is verified; decide when to remove containment.');
    if (!has('d6')) issues.push('D6: implementation and validation not recorded.');
    if (!has('d7')) issues.push('D7: no prevention updates (FMEA, control plan, work instructions).');
    return issues;
  }

  var api = { grr: grr, pareto: pareto, qfd: qfd, ppap: ppap, PPAP_ELEMENTS: PPAP_ELEMENTS, eightD: eightD, K1: K1, K2: K2, K3: K3 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.QSys = api;
})(typeof window !== 'undefined' ? window : this);
