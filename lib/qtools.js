/* qtools.js - SPC, process capability, sigma level and FMEA helpers.
 * Plain JS, no dependencies. Works in the browser (window.QTools) and Node (require).
 */
(function (root) {
  'use strict';

  // Control chart constants for subgroup sizes 2..10 (standard SPC tables).
  var K = {
    d2: { 2: 1.128, 3: 1.693, 4: 2.059, 5: 2.326, 6: 2.534, 7: 2.704, 8: 2.847, 9: 2.970, 10: 3.078 },
    A2: { 2: 1.880, 3: 1.023, 4: 0.729, 5: 0.577, 6: 0.483, 7: 0.419, 8: 0.373, 9: 0.337, 10: 0.308 },
    D3: { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0.076, 8: 0.136, 9: 0.184, 10: 0.223 },
    D4: { 2: 3.267, 3: 2.574, 4: 2.282, 5: 2.114, 6: 2.004, 7: 1.924, 8: 1.864, 9: 1.816, 10: 1.777 }
  };

  function mean(a) {
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i];
    return s / a.length;
  }

  function stdev(a) { // sample standard deviation
    if (a.length < 2) return NaN;
    var m = mean(a), s = 0;
    for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return Math.sqrt(s / (a.length - 1));
  }

  // Parse pasted numbers separated by commas, spaces, tabs or newlines.
  function parseNumbers(text) {
    return String(text).split(/[\s,;]+/).filter(Boolean).map(Number).filter(function (x) { return isFinite(x); });
  }

  // erfc with fractional error < 1.2e-7 everywhere (Chebyshev fit, Numerical Recipes erfcc),
  // so tail probabilities such as 3.4 DPMO keep relative accuracy.
  function erfc(x) {
    var z = Math.abs(x), t = 1 / (1 + 0.5 * z);
    var r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
      t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 +
      t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? r : 2 - r;
  }

  // Standard normal CDF.
  function normCdf(z) { return 0.5 * erfc(-z / Math.SQRT2); }

  // Inverse normal CDF (Acklam's algorithm, relative error ~1e-9).
  function normInv(p) {
    if (p <= 0 || p >= 1) return p <= 0 ? -Infinity : Infinity;
    var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    var pl = 0.02425, q, r;
    if (p < pl) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > 1 - pl) {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  /* Individuals and moving range chart. Sigma(within) = MRbar / 1.128. */
  function imr(x) {
    var mr = [];
    for (var i = 1; i < x.length; i++) mr.push(Math.abs(x[i] - x[i - 1]));
    var cl = mean(x), mrbar = mean(mr);
    var sigma = mrbar / K.d2[2];
    return {
      type: 'I-MR', points: x, cl: cl, ucl: cl + 3 * sigma, lcl: cl - 3 * sigma, sigmaWithin: sigma,
      range: { points: mr, cl: mrbar, ucl: K.D4[2] * mrbar, lcl: 0 }
    };
  }

  /* Xbar-R chart with subgroup size n (2..10); trailing partial subgroup is ignored. */
  function xbarR(x, n) {
    if (!K.d2[n]) throw new Error('Subgroup size must be 2 to 10');
    var means = [], ranges = [];
    for (var i = 0; i + n <= x.length; i += n) {
      var g = x.slice(i, i + n);
      means.push(mean(g));
      ranges.push(Math.max.apply(null, g) - Math.min.apply(null, g));
    }
    var xbb = mean(means), rbar = mean(ranges);
    return {
      type: 'Xbar-R', n: n, points: means, cl: xbb, ucl: xbb + K.A2[n] * rbar, lcl: xbb - K.A2[n] * rbar,
      sigmaWithin: rbar / K.d2[n],
      range: { points: ranges, cl: rbar, ucl: K.D4[n] * rbar, lcl: K.D3[n] * rbar }
    };
  }

  /* Nelson rules 1-3 on a series with centre line and sigma of the plotted statistic.
   * 1: point beyond 3 sigma. 2: nine in a row on one side. 3: six in a row rising or falling. */
  function nelson(points, cl, sigma) {
    var out = [], i, k;
    for (i = 0; i < points.length; i++) {
      if (Math.abs(points[i] - cl) > 3 * sigma) out.push({ index: i, rule: 1 });
    }
    var run = 0, side = 0;
    for (i = 0; i < points.length; i++) {
      var s = points[i] > cl ? 1 : points[i] < cl ? -1 : 0;
      if (s !== 0 && s === side) run++; else { run = s === 0 ? 0 : 1; side = s; }
      if (run >= 9) out.push({ index: i, rule: 2 });
    }
    var up = 1, dn = 1;
    for (i = 1; i < points.length; i++) {
      up = points[i] > points[i - 1] ? up + 1 : 1;
      dn = points[i] < points[i - 1] ? dn + 1 : 1;
      if (up >= 6 || dn >= 6) out.push({ index: i, rule: 3 });
    }
    return out;
  }

  /* Capability. Within sigma from the chart (Cp, Cpk); overall sample sigma for Pp, Ppk. */
  function capability(x, sigmaWithin, lsl, usl) {
    var m = mean(x), so = stdev(x);
    var hasL = isFinite(lsl), hasU = isFinite(usl);
    var r = { mean: m, sigmaWithin: sigmaWithin, sigmaOverall: so };
    function idx(sigma) {
      var o = {};
      if (hasL && hasU) o.p = (usl - lsl) / (6 * sigma);
      if (hasU) o.u = (usl - m) / (3 * sigma);
      if (hasL) o.l = (m - lsl) / (3 * sigma);
      var ks = [];
      if (hasU) ks.push(o.u);
      if (hasL) ks.push(o.l);
      if (ks.length) o.pk = Math.min.apply(null, ks);
      return o;
    }
    var w = idx(sigmaWithin), ov = idx(so);
    r.Cp = w.p; r.Cpk = w.pk; r.Pp = ov.p; r.Ppk = ov.pk;
    // Expected out-of-spec fraction using overall sigma, normal assumption.
    var frac = 0;
    if (hasU) frac += 1 - normCdf((usl - m) / so);
    if (hasL) frac += normCdf((lsl - m) / so);
    r.expectedPpm = (hasU || hasL) ? frac * 1e6 : undefined;
    return r;
  }

  /* DPMO and sigma level. Long-term DPMO to short-term sigma with the conventional 1.5 shift. */
  function dpmo(defects, units, opportunities) {
    return defects / (units * opportunities) * 1e6;
  }
  function sigmaFromDpmo(d, shift) {
    if (shift === undefined) shift = 1.5;
    return normInv(1 - d / 1e6) + shift;
  }
  function dpmoFromSigma(s, shift) {
    if (shift === undefined) shift = 1.5;
    return (1 - normCdf(s - shift)) * 1e6;
  }
  function yieldFromDpmo(d) { return 1 - d / 1e6; }

  /* FMEA. RPN = S*O*D. AP below is an ILLUSTRATIVE severity-weighted rule, NOT the AIAG-VDA table,
   * which is copyrighted. Use apFromTable() with a table you are licensed to use. */
  function rpn(s, o, d) { return s * o * d; }

  function apIllustrative(s, o, d) {
    if (s <= 1) return 'L';
    if (s >= 9) {
      if (o >= 4) return 'H';
      if (o >= 2) return d >= 7 ? 'H' : 'M';
      return d >= 7 ? 'M' : 'L';
    }
    if (s >= 7) {
      if (o >= 6) return 'H';
      if (o >= 4) return d >= 5 ? 'H' : 'M';
      if (o >= 2) return d >= 7 ? 'M' : 'L';
      return 'L';
    }
    if (s >= 4) {
      if (o >= 8) return d >= 5 ? 'H' : 'M';
      if (o >= 6) return d >= 7 ? 'M' : 'L';
      return 'L';
    }
    return o >= 8 && d >= 7 ? 'M' : 'L';
  }

  /* Parse a CSV with header "S,O,D,AP" (one row per combination) into a lookup function. */
  function parseApTable(csv) {
    var map = {};
    String(csv).split(/\r?\n/).forEach(function (line, i) {
      var p = line.split(',').map(function (t) { return t.trim(); });
      if (p.length < 4 || i === 0 && isNaN(Number(p[0]))) return;
      var ap = p[3].toUpperCase().charAt(0);
      if ('HML'.indexOf(ap) >= 0) map[p[0] + '-' + p[1] + '-' + p[2]] = ap;
    });
    return function (s, o, d) { return map[s + '-' + o + '-' + d]; };
  }

  var api = {
    K: K, mean: mean, stdev: stdev, parseNumbers: parseNumbers, normCdf: normCdf, normInv: normInv,
    imr: imr, xbarR: xbarR, nelson: nelson, capability: capability,
    dpmo: dpmo, sigmaFromDpmo: sigmaFromDpmo, dpmoFromSigma: dpmoFromSigma, yieldFromDpmo: yieldFromDpmo,
    rpn: rpn, apIllustrative: apIllustrative, parseApTable: parseApTable
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.QTools = api;
})(typeof window !== 'undefined' ? window : this);
