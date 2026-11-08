/* smed.js - changeover (SMED) analysis.
 *
 * The changeover time a line actually feels is the INTERNAL time: work done while the machine
 * is stopped. External work happens while it still runs. The classic finding is that shops do
 * external work internally, and simply separating the two is reported to give around 60%
 * before anything is bought.
 *
 * Three stages are modelled:
 *   baseline     every task currently done with the machine stopped
 *   separated    tasks that could be external are moved out
 *   streamlined  the remaining internal tasks are reduced to their target times
 *
 * Plain JS, no dependencies. Browser (window.SmedTools) and Node (require).
 */
(function (root) {
  'use strict';

  function isInternal(t) { return t.current !== 'external'; }
  function canBeExternal(t) { return t.canBe === 'external'; }
  function target(t) {
    var v = (t.targetMinutes === undefined || t.targetMinutes === null || t.targetMinutes === '') ? t.minutes : t.targetMinutes;
    return +v;
  }

  /* analyze(tasks) -> stage times and savings.
   * task: {name, minutes, current:'internal'|'external', canBe:'internal'|'external', targetMinutes?}
   */
  function analyze(tasks) {
    if (!tasks || !tasks.length) throw new Error('Add at least one changeover task');
    tasks.forEach(function (t, i) {
      var m = +t.minutes;
      if (!isFinite(m) || m < 0) throw new Error('Task ' + (i + 1) + ' needs a time of zero minutes or more');
      var tg = target(t);
      if (!isFinite(tg) || tg < 0) throw new Error('Task ' + (i + 1) + ' has an invalid target time');
    });

    var baseline = 0, separated = 0, streamlined = 0, externalAfter = 0;
    var warnings = [], movedOut = [], reduced = [];

    tasks.forEach(function (t) {
      var m = +t.minutes, tg = target(t);
      if (tg > m) warnings.push('"' + (t.name || 'a task') + '" has a target longer than its current time.');
      if (isInternal(t)) {
        baseline += m;
        if (canBeExternal(t)) {
          movedOut.push(t);
          externalAfter += m;
        } else {
          separated += m;
          streamlined += tg;
          if (tg < m) reduced.push(t);
        }
      } else {
        externalAfter += m;   // already external, does not stop the machine
      }
    });

    var pct = function (from, to) { return from > 0 ? 100 * (from - to) / from : 0; };
    return {
      baseline: baseline,
      separated: separated,
      streamlined: streamlined,
      externalAfter: externalAfter,
      savedBySeparating: baseline - separated,
      savedByStreamlining: separated - streamlined,
      pctBySeparating: pct(baseline, separated),
      pctTotal: pct(baseline, streamlined),
      // How many changeovers now fit in the time one used to take.
      multiplier: streamlined > 0 ? baseline / streamlined : Infinity,
      movedOut: movedOut,
      reduced: reduced,
      warnings: warnings
    };
  }

  /* What batch size a changeover time allows, given a daily time budget for changeovers.
   * changeovers per day = budget / changeover time; batch = demand / changeovers per day. */
  function batchSize(demandPerDay, budgetMinPerDay, changeoverMin) {
    if (!(demandPerDay > 0)) throw new Error('Demand per day must be above zero');
    if (!(budgetMinPerDay > 0)) throw new Error('Changeover time budget must be above zero');
    if (!(changeoverMin > 0)) throw new Error('Changeover time must be above zero');
    var per = budgetMinPerDay / changeoverMin;
    return { changeoversPerDay: per, batch: demandPerDay / per };
  }

  var api = { analyze: analyze, batchSize: batchSize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SmedTools = api;
})(typeof window !== 'undefined' ? window : this);
