/* Reviewed months: snapshot, "changed since", what is still open. Run: node tests/unit/reviewed.test.js */
'use strict';
const T = require('./t'), A = require('./harness')(['funds.js', 'history.js', 'reviewed.js']);
const R = A.Reviewed, M = A.M, fx = require('./fixture')(A), TODAY = '2026-10-22', clone = o => JSON.parse(JSON.stringify(o));
const cfg = clone(fx.cfg); M.migrate(cfg);
T.eq(cfg.monthsReviewed, {}, 'migration adds an empty reviewed list');
const txs = fx.txs;
T.ok(!R.isReviewed(cfg, '2026-09') && R.status(cfg, txs, '2026-09', TODAY) === null, 'a month starts not reviewed (no status)');
const s = R.mark(cfg, txs, '2026-09', TODAY, '2026-10-01T09:00:00Z');
const m9 = M.month(cfg, txs, '2026-09', TODAY);
T.eq([s.spent, s.income, s.saved, s.count], [m9.spent, m9.income, m9.saved, m9.count], 'marking keeps a snapshot of the month\'s numbers');
T.ok(R.isReviewed(cfg, '2026-09'), 'the month is now reviewed');
let st = R.status(cfg, txs, '2026-09', TODAY);
T.eq([st.changed, st.diffs.length, st.edited.length, st.added.length], [false, 0, 0, 0], 'nothing changed since → not changed');

// an added line
const more = txs.concat([{ id: 'n1', date: '2026-09-20', amount: 12.45, type: 'expense', categoryId: 'dine-out', desc: 'CAFE', direction: 'out', createdAt: '2026-10-05T00:00:00Z', flags: [] }]);
st = R.status(cfg, more, '2026-09', TODAY);
T.eq([st.changed, st.diffs.map(d => d.key + ':' + (d.now - d.was).toFixed(2)), st.added.length], [true, ['spent:12.45', 'count:1.00'], 1], 'a line added later: spent +$12.45, one more line, listed as added');
// an edit that keeps totals the same is still noticed (via history)
const swapped = clone(txs); const t0 = swapped.find(t => t.date.startsWith('2026-09') && t.categoryId === 'groceries');
t0.categoryId = 'dine-out'; t0.history = [{ at: '2026-10-08T00:00:00Z', why: 'Edited', c: [{ f: 'categoryId', a: 'groceries', b: 'dine-out' }] }];
st = R.status(cfg, swapped, '2026-09', TODAY);
T.eq([st.changed, st.diffs.length, st.edited.length], [true, 0, 1], 'a category swap that leaves every total the same is still reported (1 line edited since)');
// an edit made before the review is not "since"
const early = clone(txs); early.find(t => t.date.startsWith('2026-09')).history = [{ at: '2026-09-28T00:00:00Z', why: 'Edited', c: [] }];
T.ok(!R.status(cfg, early, '2026-09', TODAY).changed, 'edits made before you marked it do not count');
// a deleted line
const less = txs.filter(t => !(t.date.startsWith('2026-09') && t.desc === 'NETFLIX.COM'));
st = R.status(cfg, less, '2026-09', TODAY);
T.ok(st.changed && st.diffs.some(d => d.key === 'spent' && d.now < d.was) && st.diffs.some(d => d.key === 'count'), 'a deleted line shows as less spent and one fewer line');
// other months are independent
T.ok(R.status(cfg, more, '2026-08', TODAY) === null, 'other months are unaffected');

// readiness
const open = txs.concat([{ id: 'w1', date: '2026-09-12', amount: 20, type: 'expense', categoryId: null, needsTag: true, desc: 'X', direction: 'out', flags: [] }]);
const health = { open: [{ kind: 'duplicate', txIds: ['w1'] }, { kind: 'review', txIds: ['w1'] }, { kind: 'duplicate', txIds: ['zzz'] }] };
T.eq(R.readiness(open, '2026-09', health), { waiting: 1, issues: 1, clean: false }, 'before marking: 1 line waiting for review and 1 Data health item in that month (other months\' items ignored)');
T.eq(R.readiness(txs, '2026-09', { open: [] }).clean, true, 'a clean month is ready');
// touched
T.eq(R.touched(cfg, ['2026-09-03', '2026-09-30', '2026-10-01', '', undefined]), { '2026-09': 2 }, 'dates in a reviewed month are counted for warnings');
// unmark
R.unmark(cfg, '2026-09'); T.ok(!R.isReviewed(cfg, '2026-09'), 'reopening removes the mark');
T.done();
