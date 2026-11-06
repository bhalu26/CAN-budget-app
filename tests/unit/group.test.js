/* Paid for a group: counted share, owed, repayments, effect on the numbers. Run: node tests/unit/group.test.js */
'use strict';
const T = require('./t'), A = require('./harness')(['funds.js', 'group.js']);
const G = A.Group, M = A.M, U = A.U, fx = require('./fixture')(A), TODAY = '2026-10-22', clone = o => JSON.parse(JSON.stringify(o));
const bill = (o) => Object.assign({ id: 'b1', date: '2026-10-10', amount: 120, desc: 'THE KEG', categoryId: 'dine-out', type: 'expense', direction: 'out', source: 'csv', flags: [] }, o || {});
const money = (id, amt, date, extra) => Object.assign({ id, date, amount: amt, desc: 'E-TRANSFER FROM ' + id, type: 'pending', categoryId: null, direction: 'in', needsTag: true, flags: [] }, extra || {});

// counted
T.eq(M.counted(bill()), 120, 'no share: the whole amount counts');
T.eq(M.counted(bill({ share: 30 })), 30, 'a $30 share of a $120 bill counts $30');
T.eq([M.counted(bill({ share: 120 })), M.counted(bill({ share: 0 })), M.counted(bill({ share: 150 })), M.counted(bill({ share: null }))], [120, 120, 120, 120], 'a share of zero, the whole bill, more than the bill, or none counts in full (never hides spending)');
T.eq(M.counted(bill({ type: 'income', share: 30 })), 120, 'only spending lines use a share');
T.eq(M.counted(bill({ amount: -20, share: 5 })), -20, 'a refund is never reduced by a share');

// helpers
T.eq([G.equalShare(120, 4), G.equalShare(100, 3), G.equalShare(100, 1), G.equalShare(100, 'x')], [30, 33.33, null, null], 'equal share: $120 for 4 = $30; $100 for 3 = $33.33; fewer than 2 people = none');
T.ok(G.validate(120, 30).ok && !G.validate(120, 120).ok && !G.validate(120, 0).ok && !G.validate(120, NaN).ok, 'share must be more than $0 and less than the bill');
T.ok(/less than the whole bill \(\$120\.00\)/.test(G.validate(120, 150).error), '…and the message says why');
T.ok(G.isGroup(bill({ share: 30 })) && !G.isGroup(bill()), 'a bill with a share is a group bill');
T.eq(G.owedOf(bill({ share: 30 })), 90, 'others owe $90');

// repayments
const b = bill({ share: 30 });
let txs = [b, money('m1', 40, '2026-10-12'), money('m2', 30, '2026-10-14')];
T.eq(G.balance(b, txs), { owed: 90, repaid: 0, left: 90, extra: 0 }, 'nothing paid back yet: $90 left');
const l1 = G.link(txs[1], b, 'now');
T.eq([l1.repaysId, l1.type, l1.categoryId, l1.needsTag, l1.tagWhy, l1.amount, l1.direction], ['b1', 'exclude', '_exclude', false, 'Repays THE KEG', 40, 'in'], 'linking marks the incoming $40 as a repayment: not income, not spending, amount unchanged');
txs = [b, l1, money('m2', 30, '2026-10-14')];
T.eq(G.balance(b, txs), { owed: 90, repaid: 40, left: 50, extra: 0 }, 'after $40 back: $50 left');
const l2 = G.link(txs[2], b, 'now'); txs = [b, l1, l2];
T.eq(G.balance(b, txs).left, 20, 'after $70 back: $20 left');
T.eq(G.balance(Object.assign(clone(b), { settled: 20 }), txs).left, 0, '$20 received in cash settles the rest');
T.eq(G.balance(Object.assign(clone(b), { settled: 50 }), txs).extra, 30, 'paid back more than owed shows the extra');
T.eq(G.open(txs).length, 1, 'an open bill is listed');
T.eq(G.open([b, l1, l2, money('x', 20, '2026-10-20', { repaysId: 'b1' })]).length, 0, 'fully repaid: no longer open');
T.eq(G.totalOpen(txs), 20, 'total still owed to you');
const un = G.unlink(l1, 'now');
T.eq([un.repaysId, un.type, un.needsTag], [undefined, 'pending', true], 'unlinking sends the line back to Review as money in');
// candidates
const cands = G.candidates([b, money('early', 5, '2026-10-01'), money('ok', 40, '2026-10-12'), Object.assign(money('inc', 40, '2026-10-12'), { type: 'income' }), l1, bill({ id: 'o', date: '2026-10-12' })], b);
T.eq(cands.map(x => x.id), ['ok'], 'candidates: money in on/after the bill, not income, not already linked, not spending');

// the numbers
const cfg = fx.cfg, base = clone(fx.txs);
const dinner = { id: 'dn', date: '2026-10-09', amount: 120, desc: 'THE KEG', categoryId: 'dine-out', type: 'expense', direction: 'out', flags: [] };
const before = M.month(cfg, base.concat([dinner]), '2026-10', TODAY);
const shared = M.month(cfg, base.concat([Object.assign({ share: 30 }, dinner)]), '2026-10', TODAY);
T.eq(U.round2(before.spent - shared.spent), 90, 'spent drops by what others owe: $120 → $30');
T.eq(U.round2(shared.left - before.left), 90, 'left to spend rises by the same $90');
const dineRow = m => (m.groups.flatMap(g => g.rows).find(r => r.cat.id === 'dine-out') || { spent: 0 }).spent;
T.eq(U.round2(dineRow(before) - dineRow(shared)), 90, 'the Dine out category counts $30, not $120');
T.eq(shared.count, before.count, 'the line still counts as one line');
const yb = M.ytd(cfg, base.concat([dinner]), '2026', TODAY), ys = M.ytd(cfg, base.concat([Object.assign({ share: 30 }, dinner)]), '2026', TODAY);
T.eq(U.round2(yb.spent - ys.spent), 90, 'year to date follows the share too');
T.eq(M.month(cfg, base, '2026-10', TODAY).spent, M.month(cfg, base.map(t => Object.assign(t, { share: undefined })), '2026-10', TODAY).spent, 'lines with no share are untouched (golden numbers unchanged)');
// a linked repayment is neither income nor spending
const rep = G.link(money('m9', 90, '2026-10-12'), Object.assign({ share: 30 }, dinner), 'now');
const withRep = M.month(cfg, base.concat([Object.assign({ share: 30 }, dinner), rep]), '2026-10', TODAY);
T.eq([withRep.income, withRep.spent], [shared.income, shared.spent], 'a repayment adds nothing to income or spending');
T.eq(U.round2(withRep.other - shared.other), 90, '…it shows only under "moved between accounts / not counted"');
T.done();
