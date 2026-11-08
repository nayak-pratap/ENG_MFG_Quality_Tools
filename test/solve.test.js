const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/solve.js');

const COMPLETE = {
  title: 'Insert chipping on grade X',
  background: 'Customer returns rose in Q3; ties to the plant quality objective.',
  current: 'Chipping on 4.2% of inserts from line 2, measured over 3 weeks, against a 1% standard.',
  goal: 'Below 1% by 28 February 2027.',
  analysis: 'Edge prep varies with wheel wear; wheels changed on time, not on condition.',
  countermeasures: 'Change wheels on measured condition; add an edge-radius check at setup.',
  plan: 'Ravi updates the standard by 20 Jan; Mei adds the gauge check by 27 Jan.',
  followup: 'Re-measure chipping rate weekly for 8 weeks; revert if above 2%.',
  wentToGemba: true,
  ownerNamed: true,
  followUpDate: '2027-02-28'
};

test('a complete A3 passes with no blockers', () => {
  const r = S.review(COMPLETE);
  assert.deepEqual(r.issues, []);
  assert.equal(r.ready, true);
  assert.equal(r.completeness, 100);
  assert.equal(r.sectionsFilled, 7);
});

test('an empty A3 flags every section', () => {
  const r = S.review({});
  assert.equal(r.sectionsFilled, 0);
  assert.equal(r.completeness, 0);
  assert.equal(r.ready, false);
  S.SECTIONS.forEach(s => assert.ok(r.issues.some(i => i.section === s.id), s.id));
});

test('current condition without numbers is a blocker', () => {
  const r = S.review({ ...COMPLETE, current: 'Quality is poor and operators are frustrated.' });
  const i = r.blockers.find(x => x.section === 'current');
  assert.ok(i, 'expected a blocker on current condition');
  assert.ok(i.text.includes('no numbers'));
  assert.equal(r.ready, false);
});

test('a goal without a number is a warning, not a blocker', () => {
  const r = S.review({ ...COMPLETE, goal: 'Reduce chipping substantially.' });
  assert.ok(r.warnings.some(x => x.section === 'goal'));
  assert.equal(r.blockers.length, 0);
  assert.equal(r.ready, true);
});

test('countermeasures without analysis is flagged as jumping to the solution', () => {
  const r = S.review({ ...COMPLETE, analysis: '' });
  assert.ok(r.blockers.some(x => x.text.includes('jumping to the solution')));
});

test('countermeasures without a follow-up date is a blocker', () => {
  const r = S.review({ ...COMPLETE, followUpDate: '' });
  assert.ok(r.blockers.some(x => x.section === 'followup' && x.text.includes('follow-up date')));
});

test('not going to the gemba is a warning', () => {
  const r = S.review({ ...COMPLETE, wentToGemba: false });
  assert.ok(r.warnings.some(x => x.text.includes('going to see the work')));
  assert.equal(r.ready, true);
});

test('no named owner is a warning only when there is a plan', () => {
  assert.ok(S.review({ ...COMPLETE, ownerNamed: false }).warnings.some(x => x.section === 'plan'));
  const noPlan = S.review({ ...COMPLETE, plan: '', ownerNamed: false });
  assert.equal(noPlan.warnings.filter(x => x.section === 'plan').length, 0);
});

test('whitespace does not count as filled in', () => {
  const r = S.review({ ...COMPLETE, background: '   \n  ' });
  assert.ok(r.blockers.some(x => x.section === 'background'));
  assert.equal(r.sectionsFilled, 6);
});

test('hasNumber detects digits anywhere', () => {
  assert.equal(S.hasNumber('down to 1%'), true);
  assert.equal(S.hasNumber('much better'), false);
  assert.equal(S.hasNumber(undefined), false);
});

test('markdown export includes every section and the follow-up state', () => {
  const md = S.toMarkdown(COMPLETE);
  S.SECTIONS.forEach(s => assert.ok(md.includes('## ' + s.name), s.name));
  assert.ok(md.includes('# A3: Insert chipping on grade X'));
  assert.ok(md.includes('Follow-up date: 2027-02-28'));
  assert.ok(md.includes('Went to see the work: yes'));
  const empty = S.toMarkdown({});
  assert.ok(empty.includes('_not filled in_'));
  assert.ok(empty.includes('untitled'));
});
