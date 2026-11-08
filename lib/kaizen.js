/* kaizen.js - improvement sustainment tracking and kaizen-event readiness.
 *
 * The point of this module is the follow-up, not the idea list. Longitudinal research
 * (Glover 2010, 65 events in 8 organizations, re-surveyed 9-18 months later) found that
 * post-event performance review and the work area's own improvement habit predict whether
 * gains hold. So an improvement here carries a baseline, a target and dated re-checks, and
 * the module reports what decayed and what nobody has looked at since.
 *
 * Plain JS, no dependencies. Browser (window.KaizenTools) and Node (require).
 */
(function (root) {
  'use strict';

  var DAY = 86400000;

  function parseDate(s, what) {
    var t = Date.parse(s);
    if (isNaN(t)) throw new Error((what || 'Date') + ' must be a valid date (YYYY-MM-DD)');
    return t;
  }

  function daysBetween(later, earlier) {
    return Math.floor((parseDate(later) - parseDate(earlier)) / DAY);
  }

  /* Gain in the improving direction. Direction is inferred: if target is above baseline,
   * higher is better; otherwise lower is better. */
  function gainOf(baseline, target, value) {
    return target >= baseline ? value - baseline : baseline - value;
  }

  /* progress(imp, opts) -> status of one improvement.
   * imp: {baseline, target, date, checks:[{date, value}]}
   * opts: {holdThreshold (percent of target gain, default 80), reviewDays (default 90), today}
   * status: 'unverified' (no check yet) | 'holding' | 'decayed' (reached target, then fell back)
   *       | 'short' (never reached the threshold)
   */
  function progress(imp, opts) {
    opts = opts || {};
    var thr = opts.holdThreshold === undefined ? 80 : opts.holdThreshold;
    var reviewDays = opts.reviewDays === undefined ? 90 : opts.reviewDays;
    var today = opts.today || new Date().toISOString().slice(0, 10);

    if (typeof imp.baseline !== 'number' || !isFinite(imp.baseline)) throw new Error('Baseline must be a number');
    if (typeof imp.target !== 'number' || !isFinite(imp.target)) throw new Error('Target must be a number');
    if (imp.baseline === imp.target) throw new Error('Target must differ from baseline, or there is nothing to track');
    parseDate(imp.date, 'Implementation date');

    var targetGain = Math.abs(imp.target - imp.baseline);
    var checks = (imp.checks || []).slice().sort(function (a, b) { return parseDate(a.date) - parseDate(b.date); });
    checks.forEach(function (c) {
      if (typeof c.value !== 'number' || !isFinite(c.value)) throw new Error('Every check needs a numeric value');
      parseDate(c.date, 'Check date');
    });

    var series = checks.map(function (c) {
      var g = gainOf(imp.baseline, imp.target, c.value);
      return { date: c.date, value: c.value, gain: g, pctOfTarget: 100 * g / targetGain, days: daysBetween(c.date, imp.date) };
    });

    var last = series.length ? series[series.length - 1] : null;
    var peak = series.reduce(function (m, s) { return (m === null || s.pctOfTarget > m) ? s.pctOfTarget : m; }, null);
    var sinceLast = daysBetween(today, last ? last.date : imp.date);

    var status;
    if (!last) status = 'unverified';
    else if (last.pctOfTarget >= thr) status = 'holding';
    else if (peak >= thr) status = 'decayed';
    else status = 'short';

    return {
      targetGain: targetGain,
      direction: imp.target >= imp.baseline ? 'up' : 'down',
      checks: series,
      latest: last,
      peakPctOfTarget: peak,
      pctOfTarget: last ? last.pctOfTarget : null,
      status: status,
      daysSinceReview: sinceLast,
      overdue: sinceLast > reviewDays,
      // How much of the best result achieved has been given back, in percentage points.
      decayPoints: (last && peak !== null) ? Math.max(0, peak - last.pctOfTarget) : 0
    };
  }

  /* boardStats(improvements, opts) -> programme-level view. */
  function boardStats(improvements, opts) {
    opts = opts || {};
    var rows = improvements.map(function (imp) {
      return { imp: imp, p: progress(imp, opts) };
    });
    var counts = { holding: 0, decayed: 0, short: 0, unverified: 0 };
    var overdue = [], owners = {}, byType = { daily: 0, event: 0 };
    rows.forEach(function (r) {
      counts[r.p.status]++;
      if (r.p.overdue) overdue.push(r.imp);
      if (r.imp.owner) owners[String(r.imp.owner).trim().toLowerCase()] = 1;
      if (r.imp.type === 'event') byType.event++; else byType.daily++;
    });
    var verified = rows.length - counts.unverified;
    return {
      rows: rows,
      total: rows.length,
      counts: counts,
      verified: verified,
      // Share of improvements that have been checked and are still at or above the threshold.
      holdingRate: verified ? 100 * counts.holding / verified : null,
      // Share never re-checked: the blind spot the research points at.
      unverifiedRate: rows.length ? 100 * counts.unverified / rows.length : 0,
      overdue: overdue,
      distinctOwners: Object.keys(owners).length,
      byType: byType
    };
  }

  /* Readiness prompts. These restate the four factors Glover (2010) found to predict
   * sustainability. They are discussion prompts, NOT his validated survey instrument. */
  var READINESS_FACTORS = [
    { id: 'learning', name: 'Learning and stewardship in the work area',
      prompt: 'Do the people in this area already take ownership of how the work runs, and learn from problems?' },
    { id: 'experimentation', name: 'Experimentation and continuous improvement habit',
      prompt: 'Does this area already try small changes on its own, without being asked?' },
    { id: 'review', name: 'Post-event performance review',
      prompt: 'Is there a date in the diary, and a named person, to re-check the result months from now?' },
    { id: 'acceptance', name: 'Accepting changes',
      prompt: 'When a change is made here, does it stick, or does the old method come back?' }
  ];

  /* readiness(scores) -> scores is {factorId: 1..5}. Returns total, weakest factors and a verdict. */
  function readiness(scores) {
    var vals = READINESS_FACTORS.map(function (f) {
      var v = scores[f.id];
      if (typeof v !== 'number' || !isFinite(v) || v < 1 || v > 5) throw new Error('Score every factor from 1 to 5');
      return { id: f.id, name: f.name, score: v };
    });
    var total = vals.reduce(function (s, v) { return s + v.score; }, 0);
    var min = Math.min.apply(null, vals.map(function (v) { return v.score; }));
    return {
      total: total, max: READINESS_FACTORS.length * 5,
      factors: vals,
      weakest: vals.filter(function (v) { return v.score === min; }),
      verdict: total >= 16 ? 'conditions look supportive'
        : total >= 11 ? 'mixed: fix the weak factor before running an event'
          : 'weak: an event here is likely to fade, build the daily habit first'
    };
  }

  var api = { progress: progress, boardStats: boardStats, readiness: readiness, READINESS_FACTORS: READINESS_FACTORS, daysBetween: daysBetween, gainOf: gainOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.KaizenTools = api;
})(typeof window !== 'undefined' ? window : this);
