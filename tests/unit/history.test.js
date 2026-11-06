/* Edit history: what is tracked, how it reads, the cap, undo. Run: node tests/unit/history.test.js */
'use strict';
const T = require('./t'), A = require('./harness')(['history.js']);
const H = A.Hist, clone = o => JSON.parse(JSON.stringify(o));
const names = { cat: id => ({ groceries: 'Groceries', 'dine-out': 'Dining out' })[id] || id, fund: id => 'Fund ' + id, trip: id => 'Trip ' + id };
const base = { id: 't1', date: '2026-10-05', amount: 84.2, categoryId: 'groceries', desc: 'SAFEWAY #4545', note: '', needsTag: false, createdAt: '2026-10-05T00:00:00Z' };

// diff
T.eq(H.diff(base, clone(base)), [], 'nothing changed → no entry');
T.eq(H.diff(base, Object.assign(clone(base), { amount: 84.95 })), [{ f: 'amount', a: 84.2, b: 84.95 }], 'an amount change is found');
T.eq(H.diff(base, Object.assign(clone(base), { note: '' , tripId: null })), [], 'empty, null and missing are the same (no false changes)');
T.eq(H.diff(base, Object.assign(clone(base), { updatedAt: 'x', reviewedAt: 'y', conf: 'sure', tagWhy: 'z' })), [], 'bookkeeping fields (updatedAt, confidence…) are not changes');
T.eq(H.diff(base, Object.assign(clone(base), { amount: 90, categoryId: 'dine-out', date: '2026-10-06' })).map(c => c.f), ['amount', 'categoryId', 'date'], 'several fields at once');

// how it reads
T.eq(H.say({ f: 'amount', a: 84.2, b: 84.95 }, names), 'Amount $84.20 → $84.95', '"Amount $84.20 → $84.95"');
T.eq(H.say({ f: 'categoryId', a: 'groceries', b: 'dine-out' }, names), 'Category Groceries → Dining out', 'categories read as names');
T.eq(H.say({ f: 'categoryId', a: null, b: 'groceries' }, names), 'Category none → Groceries', 'no category yet reads as "none"');
T.eq(H.say({ f: 'date', a: '2026-10-05', b: '2026-10-06' }, names), 'Date Oct 5 2026 → Oct 6 2026', 'dates read as dates');
T.eq(H.say({ f: 'desc', a: 'A', b: 'B' }, names), 'Description "A" → "B"', 'text is quoted');
T.eq(H.say({ f: 'needsTag', a: true, b: false }, names), 'Marked reviewed', 'confirming a line reads "Marked reviewed"');
T.eq(H.say({ f: 'needsTag', a: false, b: true }, names), 'Sent back to Review', '…and the reverse');
T.eq(H.say({ f: 'share', a: null, b: 31.2 }, names), 'Paid for a group: my share $31.20', 'a group share being set');
T.eq(H.say({ f: 'share', a: 31.2, b: null }, names), 'Group share removed (counts in full again)', '…and removed');

// apply
const map = { t1: base };
let after = Object.assign(clone(base), { amount: 84.95 });
T.ok(H.apply(map, after, 'Edited', '2026-10-23T10:00:00Z') && after.history.length === 1 && after.history[0].why === 'Edited' && after.history[0].at === '2026-10-23T10:00:00Z', 'a changed line gets one history entry with time and reason');
T.eq(after.history[0].c, [{ f: 'amount', a: 84.2, b: 84.95 }], '…recording what changed');
const unchanged = clone(base); T.ok(!H.apply(map, unchanged, 'Edited', 'now') && !unchanged.history, 'an unchanged line gets nothing');
T.ok(!H.apply(map, { id: 'new', amount: 5 }, 'Edited', 'now'), 'a brand-new line has no history (its origin is on the line)');
// history keeps accumulating from the stored line, even if the caller's copy lacks it (undo restores an older copy)
const stored = Object.assign(clone(base), { amount: 84.95, history: after.history });
const restored = clone(base);   // an older copy with no history
H.apply({ t1: stored }, restored, 'Undo', '2026-10-23T10:05:00Z');
T.eq(restored.history.map(e => e.why + ':' + e.c[0].a + '>' + e.c[0].b), ['Edited:84.2>84.95', 'Undo:84.95>84.2'], 'undo adds an entry; the earlier history is not lost');
// unchanged copy of a line that has history keeps it
const keep = clone(stored); delete keep.history; H.apply({ t1: stored }, keep, 'Edited', 'now');
T.eq(keep.history.length, 1, 'writing an unchanged older copy does not drop the history');
// cap
let cur = clone(base), m = { t1: cur };
for (let i = 0; i < 30; i++) { const n = Object.assign(clone(cur), { amount: 100 + i }); H.apply({ t1: cur }, n, 'Edited', '2026-10-23T10:' + String(i).padStart(2, '0') + ':00Z'); cur = n; }
T.eq([cur.history.length, cur.history[0].c[0].b, cur.history[24].c[0].b], [25, 105, 129], 'only the newest 25 entries are kept');
// applyAll + reason
H.why('Review');
const l1 = Object.assign(clone(base), { categoryId: 'dine-out' }), l2 = Object.assign(clone(base), { id: 't2' });
H.applyAll([base, Object.assign(clone(base), { id: 't2' })], [l1, l2], 'now');
T.eq([l1.history[0].why, l2.history], ['Review', undefined], 'applyAll uses the reason set for this write and only touches changed lines');
const l3 = Object.assign(clone(base), { amount: 1 }); H.applyAll([base], [l3], 'now');
T.eq(l3.history[0].why, 'Edited', 'the reason resets after one write');
// recent
const a = Object.assign(clone(base), { id: 'a', history: [{ at: '2026-10-01T00:00:00Z', why: 'Edited', c: [] }, { at: '2026-10-09T00:00:00Z', why: 'Bulk change', c: [] }] });
const b = Object.assign(clone(base), { id: 'b', history: [{ at: '2026-10-05T00:00:00Z', why: 'Review', c: [] }] });
T.eq(H.recent([a, b, base], 2).map(e => e.t.id + e.at.slice(8, 10)), ['a09', 'b05'], 'recent changes across lines, newest first, limited');
T.done();
