/* solve.js - structured problem solving: A3 completeness review.
 *
 * Parallel to the 8D checker in qsys.js, but the rules differ. An 8D is driven by a customer
 * escape, so its hard rules are containment and escape cause. An A3 is a thinking document,
 * so its failure modes are different: no measured current condition, a target that is not a
 * number, countermeasures written before any analysis, and no follow-up date.
 *
 * Plain JS, no dependencies. Browser (window.SolveTools) and Node (require).
 */
(function (root) {
  'use strict';

  var SECTIONS = [
    { id: 'background', name: 'Background', prompt: 'Why this problem, and why now? What higher objective does it serve?' },
    { id: 'current', name: 'Current condition', prompt: 'What is happening, seen at the gemba, with numbers. Show the gap to standard.' },
    { id: 'goal', name: 'Goal or target condition', prompt: 'What measurable condition, by when?' },
    { id: 'analysis', name: 'Analysis', prompt: 'Why does the gap exist? Follow the cause to something you can act on, and show the evidence.' },
    { id: 'countermeasures', name: 'Countermeasures', prompt: 'What changes will close the gap, and why these rather than others?' },
    { id: 'plan', name: 'Plan', prompt: 'What, who, when. One owner per action.' },
    { id: 'followup', name: 'Follow-up', prompt: 'How and when you will confirm the result, and what you will do if it did not work.' }
  ];

  function filled(r, k) {
    return typeof r[k] === 'string' && r[k].trim().length > 0;
  }

  // Does the text contain a digit? A current condition or goal without one is usually an opinion.
  function hasNumber(s) {
    return typeof s === 'string' && /\d/.test(s);
  }

  /* review(r) -> {issues: [{section, text, severity}], completeness, ready}
   * severity: 'blocker' stops the A3 being useful; 'warning' is worth fixing.
   * r fields: the SECTION ids above, plus booleans wentToGemba, ownerNamed, and string followUpDate.
   */
  function review(r) {
    r = r || {};
    var issues = [];
    function add(section, text, severity) { issues.push({ section: section, text: text, severity: severity || 'blocker' }); }

    SECTIONS.forEach(function (s) {
      if (!filled(r, s.id)) add(s.id, s.name + ': not filled in.');
    });

    // The failure modes that matter even when every box has words in it.
    if (filled(r, 'current') && !hasNumber(r.current)) {
      add('current', 'Current condition has no numbers. Without a measured starting point there is no gap and nothing to check later.');
    }
    if (filled(r, 'goal') && !hasNumber(r.goal)) {
      add('goal', 'Goal has no number or date, so you cannot tell whether you reached it.', 'warning');
    }
    if (filled(r, 'countermeasures') && !filled(r, 'analysis')) {
      add('analysis', 'Countermeasures are written but the analysis is empty: this is jumping to the solution.');
    }
    if (filled(r, 'analysis') && !hasNumber(r.current)) {
      add('analysis', 'Analysis rests on a current condition with no data.', 'warning');
    }
    if (filled(r, 'plan') && !r.ownerNamed) {
      add('plan', 'No single owner named for the actions.', 'warning');
    }
    if (filled(r, 'countermeasures') && !r.followUpDate) {
      add('followup', 'No follow-up date set. An A3 closed without a check is a guess.');
    }
    if (!r.wentToGemba) {
      add('current', 'Nobody has recorded going to see the work. An A3 written from a meeting room describes the problem people believe in, not the one they have.', 'warning');
    }

    var done = SECTIONS.filter(function (s) { return filled(r, s.id); }).length;
    return {
      issues: issues,
      blockers: issues.filter(function (i) { return i.severity === 'blocker'; }),
      warnings: issues.filter(function (i) { return i.severity === 'warning'; }),
      sectionsFilled: done,
      completeness: 100 * done / SECTIONS.length,
      ready: issues.filter(function (i) { return i.severity === 'blocker'; }).length === 0
    };
  }

  /* Render an A3 as markdown, in the order the sections are meant to be worked. */
  function toMarkdown(r) {
    r = r || {};
    var out = ['# A3: ' + ((r.title || '').trim() || 'untitled'), ''];
    if (r.owner || r.date) {
      out.push([r.owner ? 'Owner: ' + r.owner : '', r.date ? 'Date: ' + r.date : ''].filter(Boolean).join('  |  '), '');
    }
    SECTIONS.forEach(function (s) {
      out.push('## ' + s.name, '', filled(r, s.id) ? r[s.id] : '_not filled in_', '');
    });
    out.push('Went to see the work: ' + (r.wentToGemba ? 'yes' : 'no'));
    out.push('Follow-up date: ' + (r.followUpDate || 'not set'));
    return out.join('\n');
  }

  var api = { SECTIONS: SECTIONS, review: review, toMarkdown: toMarkdown, hasNumber: hasNumber };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SolveTools = api;
})(typeof window !== 'undefined' ? window : this);
