/* ops.js - OEE, takt, line balance, Little's Law, queueing, WIP simulation, VSM and framework selector.
 * Plain JS, no dependencies. Browser (window.OpsTools) and Node (require).
 */
(function (root) {
  'use strict';

  function num(x, name) {
    if (typeof x !== 'number' || !isFinite(x)) throw new Error(name + ' must be a number');
    return x;
  }

  /* ---------- OEE ----------
   * Availability = run time / planned time. Performance = (ideal cycle x total count) / run time.
   * Quality = good / total. Losses are expressed in minutes of planned time. */
  function oee(o) {
    var planned = num(o.plannedMin, 'Planned time'), down = num(o.downMin, 'Downtime'),
      ideal = num(o.idealCycleMin, 'Ideal cycle time'), total = num(o.totalCount, 'Total count'),
      good = num(o.goodCount, 'Good count');
    if (planned <= 0) throw new Error('Planned time must be above zero');
    if (down < 0 || down > planned) throw new Error('Downtime must be between 0 and planned time');
    if (ideal <= 0) throw new Error('Ideal cycle time must be above zero');
    if (total < 0 || good < 0 || good > total) throw new Error('Good count must be between 0 and total count');
    var run = planned - down;
    if (run <= 0) throw new Error('No run time left after downtime');
    var idealTime = ideal * total;
    var warn = [];
    if (idealTime > run * 1.0001) warn.push('Output exceeds what the ideal cycle time allows in the run time; check the ideal cycle time or counts.');
    var a = run / planned, p = idealTime / run, q = total === 0 ? 0 : good / total;
    var productive = ideal * good;
    return {
      availability: a, performance: p, quality: q, oee: a * p * q,
      runMin: run,
      loss: { availability: down, speed: Math.max(0, run - idealTime), quality: ideal * (total - good), productive: productive },
      warnings: warn
    };
  }

  /* ---------- Takt and line balance ---------- */
  function takt(availableMin, demand) {
    num(availableMin, 'Available time'); num(demand, 'Demand');
    if (availableMin <= 0 || demand <= 0) throw new Error('Available time and demand must be above zero');
    return availableMin / demand;
  }

  /* tasks: [{name, time}] in minutes per unit. Returns theoretical minimum stations and balance efficiency. */
  function lineBalance(tasks, taktMin) {
    if (!(taktMin > 0)) throw new Error('Takt must be above zero');
    var total = 0, tooLong = [];
    tasks.forEach(function (t) {
      if (!(t.time >= 0)) throw new Error('Task times must be zero or more');
      total += t.time;
      if (t.time > taktMin) tooLong.push(t.name);
    });
    var minStations = Math.max(1, Math.ceil(total / taktMin - 1e-9));
    return { totalWork: total, minStations: minStations, efficiency: total / (minStations * taktMin), tooLong: tooLong };
  }

  /* ---------- Little's Law: WIP = throughput x lead time. Pass two, get the third. ---------- */
  function little(o) {
    var has = function (k) { return o[k] !== undefined && o[k] !== null && isFinite(o[k]); };
    var n = (has('wip') ? 1 : 0) + (has('throughput') ? 1 : 0) + (has('leadTime') ? 1 : 0);
    if (n !== 2) throw new Error('Provide exactly two of WIP, throughput and lead time');
    if (!has('wip')) return { wip: o.throughput * o.leadTime, throughput: o.throughput, leadTime: o.leadTime };
    if (!has('throughput')) {
      if (o.leadTime <= 0) throw new Error('Lead time must be above zero');
      return { wip: o.wip, throughput: o.wip / o.leadTime, leadTime: o.leadTime };
    }
    if (o.throughput <= 0) throw new Error('Throughput must be above zero');
    return { wip: o.wip, throughput: o.throughput, leadTime: o.wip / o.throughput };
  }

  /* Kingman (VUT) approximation for a single-server queue.
   * Wq = ((ca^2 + cs^2) / 2) x (u / (1 - u)) x te. Cycle time = Wq + te. */
  function kingman(o) {
    var u = o.utilization, te = o.processTime, ca = o.cvArrival, cs = o.cvService;
    if (!(u >= 0 && u < 1)) throw new Error('Utilization must be at least 0 and below 1');
    if (!(te > 0)) throw new Error('Process time must be above zero');
    if (!(ca >= 0 && cs >= 0)) throw new Error('CV values must be zero or more');
    var wq = ((ca * ca + cs * cs) / 2) * (u / (1 - u)) * te;
    return { queueTime: wq, cycleTime: wq + te, queueToProcess: wq / te };
  }

  /* ---------- Seeded random numbers ---------- */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function normal(r) {
    var u = 0, v = 0;
    while (u === 0) u = r();
    v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function sampler(r, mean, cv) {
    if (cv <= 0) return function () { return mean; };
    var s2 = Math.log(1 + cv * cv), mu = Math.log(mean) - s2 / 2, s = Math.sqrt(s2);
    return function () { return Math.exp(mu + s * normal(r)); };
  }

  /* ---------- Serial line simulation: push vs CONWIP ----------
   * Single-server FIFO stations in series with unlimited buffers, so the exact recursion
   *   D[i][j] = max(D[i-1][j], D[i][j-1]) + S[i][j]
   * applies. Push releases jobs as a Poisson stream at `rate`. CONWIP releases job j when job j-W
   * leaves the line (W jobs start at time 0). Metrics use jobs after the warm-up fraction. */
  function simulate(o) {
    var means = o.means, k = means.length, n = o.jobs || 5000, cv = o.cv === undefined ? 1 : o.cv;
    if (!k) throw new Error('At least one station is required');
    means.forEach(function (m) { if (!(m > 0)) throw new Error('Station times must be above zero'); });
    var r = rng(o.seed === undefined ? 1 : o.seed);
    var svc = means.map(function (m) { return sampler(r, m, cv); });
    var rel = new Array(n), prev = new Array(k), j, i;
    for (i = 0; i < k; i++) prev[i] = 0;
    var out = new Array(n);
    var t = 0;
    if (o.mode === 'push') {
      if (!(o.rate > 0)) throw new Error('Release rate must be above zero');
    } else {
      if (!(o.wip >= 1)) throw new Error('WIP cap must be at least 1');
    }
    for (j = 0; j < n; j++) {
      if (o.mode === 'push') { t += -Math.log(1 - r()) / o.rate; rel[j] = t; }
      else rel[j] = j < o.wip ? 0 : out[j - o.wip];
      var d = rel[j];
      for (i = 0; i < k; i++) {
        var start = Math.max(d, prev[i]);
        d = start + svc[i]();
        prev[i] = d;
      }
      out[j] = d;
    }
    var w = Math.floor(n * (o.warmup === undefined ? 0.2 : o.warmup)), sum = 0, cnt = 0;
    for (j = w; j < n; j++) { sum += out[j] - rel[j]; cnt++; }
    var span = out[n - 1] - out[Math.max(0, w - 1)];
    var th = span > 0 ? cnt / span : 0, ct = sum / cnt;
    return { throughput: th, cycleTime: ct, wip: th * ct, jobs: cnt };
  }

  /* Sweep WIP caps to show the throughput versus cycle-time trade-off. */
  function sweepConwip(o) {
    var res = [];
    for (var w = 1; w <= o.maxWip; w++) {
      var s = simulate({ means: o.means, cv: o.cv, mode: 'conwip', wip: w, jobs: o.jobs, seed: o.seed });
      res.push({ wip: w, throughput: s.throughput, cycleTime: s.cycleTime });
    }
    return res;
  }

  /* ---------- Value stream map arithmetic ----------
   * steps: [{name, ct (min/unit), co (changeover min), uptime (0-1), batch (units), wipUnits (waiting before step)}]
   * Demand and available minutes are per day. Waiting time = wipUnits / demand per day. */
  function vsm(steps, demandPerDay, availMinPerDay) {
    var tk = takt(availMinPerDay, demandPerDay), perDay = demandPerDay;
    var va = 0, wait = 0, rows = [], bottleneck = null, worst = -1;
    steps.forEach(function (s) {
      var up = s.uptime === undefined ? 1 : s.uptime;
      if (!(s.ct > 0)) throw new Error('Cycle time must be above zero for ' + (s.name || 'a step'));
      if (!(up > 0 && up <= 1)) throw new Error('Uptime must be above 0 and at most 100% for ' + (s.name || 'a step'));
      var batch = s.batch > 0 ? s.batch : 1, co = s.co > 0 ? s.co : 0;
      var eff = (s.ct + co / batch) / up; // effective minutes per unit
      var waitDays = (s.wipUnits > 0 ? s.wipUnits : 0) / perDay;
      va += s.ct; wait += waitDays;
      var load = eff / tk;
      if (load > worst) { worst = load; bottleneck = s.name; }
      rows.push({ name: s.name, effectiveMin: eff, load: load, waitDays: waitDays });
    });
    var processDays = va / availMinPerDay; // value-adding time as a fraction of one available day
    var lead = wait + processDays;
    return { takt: tk, rows: rows, leadTimeDays: lead, valueAddedMin: va, waitDays: wait, vaRatio: processDays / lead, bottleneck: bottleneck, bottleneckLoad: worst };
  }

  /* ---------- Framework selector ----------
   * Each symptom adds weight to frameworks. Scores are summed; ties break by order listed.
   * It is a starting-point heuristic, not a diagnosis. */
  var SYMPTOMS = [
    { id: 'leadtime', text: 'Lead time is long and there is a lot of WIP', w: { 'flow-pull-vsm': 3, 'conwip-polca': 2, 'factory-physics': 2, 'toc-dbr': 1 } },
    { id: 'downtime', text: 'Machines stop unexpectedly or run slowly', w: { 'tpm-oee': 3, 'standard-work-5s': 1, 'daily-management': 1 } },
    { id: 'bottleneck', text: 'One resource always limits output', w: { 'toc-dbr': 3, 'tpm-oee': 1, 'factory-physics': 1 } },
    { id: 'recurring', text: 'The same problem keeps coming back', w: { 'a3': 3, 'daily-management': 2, 'standard-work-5s': 1 } },
    { id: 'shifts', text: 'Results differ between shifts or people', w: { 'standard-work-5s': 3, 'daily-management': 2 } },
    { id: 'strategy', text: 'Improvement is not linked to business goals', w: { 'hoshin-kanri': 3, 'a3': 1, 'sop-ibp': 1 } },
    { id: 'launch', text: 'We are launching a new product or process', w: { 'fmea-practice': 3, 'apqp-ppap': 2, 'tps-house': 1 } },
    { id: 'fade', text: 'Gains fade after the project team leaves', w: { 'shingo': 2, 'daily-management': 3, 'hoshin-kanri': 1, 'kaizen': 2 } },
    { id: 'digital', text: 'We want to use sensors, AI or digital boards', w: { 'digital-lean': 3, 'tpm-oee': 1 } },
    { id: 'stockouts', text: 'Stock-outs and excess inventory exist together', w: { 'ddmrp': 3, 'sop-ibp': 1, 'flow-pull-vsm': 1 } },
    { id: 'forecast', text: 'Demand is volatile and forecasts are unreliable', w: { 'ddmrp': 3, 'sop-ibp': 2 } },
    { id: 'alignment', text: 'Sales, operations and finance plan from different numbers', w: { 'sop-ibp': 3, 'hoshin-kanri': 1 } },
    { id: 'highmix', text: 'High mix, low volume; every job is different', w: { 'conwip-polca': 3, 'factory-physics': 2, 'toc-dbr': 1 } },
    { id: 'variability', text: 'Queues explode as machines get busier', w: { 'factory-physics': 3, 'conwip-polca': 1, 'toc-dbr': 1 } },
    { id: 'escapes', text: 'Defects reached a customer', w: { 'eight-d': 3, 'a3': 1, 'fmea-practice': 1 } },
    { id: 'ppap', text: 'A customer requires PPAP or a launch approval package', w: { 'apqp-ppap': 3, 'fmea-practice': 1, 'msa-grr': 1 } },
    { id: 'gauges', text: 'We do not trust the measurements or gauges', w: { 'msa-grr': 3, 'dmaic': 1 } },
    { id: 'datavariation', text: 'A variation problem needs a data-driven, project-style fix', w: { 'dmaic': 3, 'msa-grr': 1, 'a3': 1 } },
    { id: 'voc', text: 'Unclear what customers value or which specs matter', w: { 'qfd': 3, 'apqp-ppap': 1 } },
    { id: 'smallfixes', text: 'Small everyday problems never get fixed', w: { 'kaizen': 3, 'daily-management': 2, 'standard-work-5s': 1 } },
    { id: 'eventfade', text: 'Improvement happens in events, then fades afterwards', w: { 'kaizen': 3, 'daily-management': 2, 'shingo': 1 } }
  ];

  function recommend(selectedIds, topN) {
    var score = {}, why = {}, order = [];
    SYMPTOMS.forEach(function (s) {
      if (selectedIds.indexOf(s.id) < 0) return;
      Object.keys(s.w).forEach(function (slug) {
        if (!(slug in score)) { score[slug] = 0; why[slug] = []; order.push(slug); }
        score[slug] += s.w[slug];
        why[slug].push(s.text);
      });
    });
    return order.map(function (slug, i) { return { slug: slug, score: score[slug], why: why[slug], i: i }; })
      .sort(function (a, b) { return b.score - a.score || a.i - b.i; })
      .slice(0, topN || 3);
  }

  var api = { oee: oee, takt: takt, lineBalance: lineBalance, little: little, kingman: kingman, simulate: simulate, sweepConwip: sweepConwip, vsm: vsm, SYMPTOMS: SYMPTOMS, recommend: recommend, rng: rng };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.OpsTools = api;
})(typeof window !== 'undefined' ? window : this);
