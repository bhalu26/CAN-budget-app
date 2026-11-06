/* Feature 3: big expenses as sinking funds. Run: node tests/unit/funds.test.js */
'use strict';
const T = require('./t'), A = require('./harness')(['funds.js']);
const F = A.Funds, M = A.M, fx = require('./fixture')(A);
const TODAY = '2026-10-22';
const clone = o => JSON.parse(JSON.stringify(o));

// migration of the three existing big expenses (never overwrites, fills what is missing)
const cfg = clone(fx.cfg);
cfg.bigExpenses.forEach(f => F.migrateOne(f, '2026-10'));
const by = n => cfg.bigExpenses.find(f => new RegExp(n, 'i').test(f.name));
const ircc = by('ircc'), amex = by('amex'), utah = by('utah');
T.ok(ircc && ircc.due === '2026-12' && ircc.start === '2026-10' && ircc.categoryId === 'fees-admin' && ircc.match === 'IMMIGRATION CANADA', 'IRCC: due Dec 2026 (from its year), saving from Oct, Fees & Admin, matches "IMMIGRATION CANADA"');
T.ok(amex && amex.repeats === 'yearly' && amex.due === '2027-09' && amex.dueGuessed === true && amex.match === 'MEMBERSHIP FEE', 'Amex fee: yearly, due month unknown → a guess 11 months ahead, flagged so the owner is asked');
T.ok(utah && utah.due === '2026-12' && utah.categoryId === 'travel', 'Utah trip: due Dec 2026, Travel');
const again = clone(ircc); F.migrateOne(again, '2027-05');
T.eq([again.due, again.start, again.categoryId, again.match], [ircc.due, ircc.start, ircc.categoryId, ircc.match], 'migrating twice changes nothing');
const s0 = M.migrate(clone(fx.cfg));
T.ok(s0.schema === M.SCHEMA && Array.isArray(s0.recurring), 'M.migrate still adds the feature-1 fields');

// money set aside each month
let st = F.status(ircc, [], '2026-10');
T.eq([st.monthly, st.setAside, st.monthsLeft, st.state], [433.33, 433.33, 3, 'saving'], 'IRCC $1,300 due Dec, from Oct: $433.33 a month, 3 months left');
st = F.status(ircc, [], '2026-12');
T.eq([st.setAside, st.monthsLeft], [1299.99, 1], 'by the due month almost all of it is set aside (rounding cents only)');
T.eq(F.status(ircc, [], '2026-09').state, 'not started', 'before the start month: not started, nothing to set aside');
T.eq(F.status(ircc, [], '2027-01').state, 'overdue', 'after the due month and not paid: overdue');
T.eq(F.totalMonthly(cfg, [], '2026-10'), A.U.round2(F.status(ircc, [], '2026-10').monthly + F.status(amex, [], '2026-10').monthly + F.status(utah, [], '2026-10').monthly), 'total to set aside = sum of funds');

// payments
const pay = (id, date, amount, fundId, extra) => Object.assign({ id, date, amount, desc: 'IMMIGRATION CANADA ONLINE', categoryId: 'fees-admin', type: 'expense', direction: 'out', fundId }, extra || {});
T.eq(F.status(ircc, [pay('p1', '2026-12-03', 1300, ircc.id)], '2026-12').state, 'paid', 'paid in full → paid');
T.eq(F.status(ircc, [pay('p1', '2026-11-03', 500, ircc.id)], '2026-11').state, 'partly paid', 'part paid → partly paid');
T.eq(F.status(ircc, [pay('p1', '2027-01-04', 1300, ircc.id)], '2027-01').state, 'paid', 'paid the month after the due month: still on time, not overdue');
T.eq(F.status(ircc, [pay('p1', '2026-12-03', 1350, ircc.id)], '2026-12').over, 50, 'paid more than planned: shows $50 over');
T.ok(F.status(ircc, [pay('p1', '2026-12-03', 1300, ircc.id), pay('p2', '2026-12-09', -1300, ircc.id)], '2026-12').state !== 'paid', 'a refund to the fund takes the payment back');

// yearly cycles
const yr = { id: 'y1', name: 'Card fee', amount: 120, repeats: 'yearly', due: '2026-03', start: '2025-04' };
T.eq(F.cycle(yr, '2026-05'), { start: '2026-04', due: '2027-03', months: 12 }, 'yearly: after the due month the next cycle starts (Apr → next Mar, 12 months)');
T.eq(F.status(yr, [], '2026-05').monthly, 10, 'yearly $120 → $10 a month');
T.eq(F.status(yr, [pay('c1', '2026-04-02', 120, 'y1')], '2026-03').state, 'paid', 'a payment posted the month after belongs to the cycle that was due');
T.eq(F.status(yr, [pay('c1', '2026-04-02', 120, 'y1')], '2026-05').state, 'saving', '…and the new cycle starts fresh');

// budget numbers: a fund payment is not this month's spending
const base = clone(cfg), txs = clone(fx.txs);
const fee = txs.find(t => t.desc === 'AMEX MEMBERSHIP FEE');
const before = M.month(base, txs, '2026-03', TODAY), ytdBefore = M.ytd(base, txs, '2026', TODAY);
fee.fundId = amex.id;
const after = M.month(base, txs, '2026-03', TODAY), ytdAfter = M.ytd(base, txs, '2026', TODAY);
const feeRow = s => s.groups.flatMap(g => g.rows).concat(s.bills.map(b => ({ cat: b.cat, spent: b.spent }))).find(r => r.cat.id === 'fees-admin');
T.eq(feeRow(after).spent, A.U.round2(feeRow(before).spent - 250), 'Amex $250 paid from its fund: Fees & Admin no longer shows it');
T.eq(after.left, A.U.round2(before.left + 250), '…and left to spend is not reduced by it');
T.eq([after.spent, after.fromFunds], [A.U.round2(before.spent - 250), 250], 'month total excludes it; "$250 paid from big expenses" shown separately');
T.eq(after.count, before.count, 'the transaction is still counted and listed');
T.eq(ytdAfter.spent, A.U.round2(ytdBefore.spent - 250), 'year to date excludes it too');
T.eq(ytdAfter.fromFunds, 250, 'year to date reports it as paid from funds');
base.bigExpenses = base.bigExpenses.filter(f => f.id !== amex.id);
const gone = M.month(base, txs, '2026-03', TODAY);
T.eq([gone.left, gone.spent, gone.fromFunds], [before.left, before.spent, 0], 'fund deleted → the payment counts as ordinary spending again (nothing lost)');
fee.fundId = 'no-such-fund';
T.eq(M.month(cfg, txs, '2026-03', TODAY).left, before.left, 'a payment pointing at an unknown fund counts normally');

// import suggestion
const c2 = clone(cfg), i2 = c2.bigExpenses.find(f => f.id === ircc.id);
T.eq((F.suggest(c2, [], 'IMMIGRATION CANADA ONLINE 1234', '2026-11-20', 1300) || {}).id, i2.id, 'import: an IRCC charge near its due month is suggested for the IRCC fund');
T.eq(F.suggest(c2, [], 'IMMIGRATION CANADA ONLINE', '2026-06-20', 1300), null, '…not months before it is due');
T.eq(F.suggest(c2, [], 'IMMIGRATION CANADA ONLINE', '2026-11-20', -1300), null, '…not for money coming in');
T.eq(F.suggest(c2, [pay('p1', '2026-11-03', 1300, i2.id)], 'IMMIGRATION CANADA ONLINE', '2026-12-01', 1300), null, '…not once the fund is paid');
T.eq(F.suggest(c2, [], 'SAFEWAY #4545', '2026-11-20', 80), null, 'other text: no suggestion');
T.done();
