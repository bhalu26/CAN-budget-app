/* Year views: income / spent / saved by month and the category × month grid. Run: node tests/unit/year.test.js */
'use strict';
const T = require('./t'), A = require('./harness')(['funds.js', 'year.js']);
const Y = A.Year, M = A.M, U = A.U, fx = require('./fixture')(A), TODAY = '2026-10-22';
const sumBy = (txs, type, ym) => U.round2(txs.filter(t => t.type === type && t.date.slice(0, 7) === ym).reduce((a, t) => a + t.amount, 0));

const yr = Y.months(fx.cfg, fx.txs, '2026', TODAY);
T.eq(yr.rows.length, 10, 'current year: one row per month up to October');
T.eq(yr.rows.map(r => r.ym).slice(0, 2), ['2026-01', '2026-02'], 'rows are in month order');
let bad = [];
yr.rows.forEach(r => { ['income', 'expense', 'saving'].forEach(ty => { const k = ty === 'income' ? 'income' : ty === 'expense' ? 'spent' : 'saved'; if (sumBy(fx.txs, ty, r.ym) !== r[k]) bad.push(r.ym + ' ' + k + ' ' + r[k] + ' vs ' + sumBy(fx.txs, ty, r.ym)); }); });
T.eq(bad, [], 'every month: income, spent and saved equal the plain sums of the transactions (independent of M.month)');
const jan = yr.rows[0];
T.eq([jan.income, jan.saved, jan.spent], [3250, 300, U.round2(2300 + 20.99 + 85.17 + 63.25 + 6.75)], 'January by hand: $3,250 in, $300 saved, $2,476.16 spent');
T.eq(jan.left, U.round2(3250 - 2476.16 - 300), 'left over = income − spent − paid from big expenses − saved');
T.eq(jan.rate, 300 / 3250, 'savings rate = saved ÷ income');
T.eq(yr.total.income, 32500, 'ten months of income: $32,500');
T.eq(yr.total.spent, U.round2(yr.rows.reduce((a, r) => a + r.spent, 0)), 'year total is the sum of the months');
T.eq(yr.total.spent, M.ytd(fx.cfg, fx.txs, '2026', TODAY).spent, 'year spent equals Insights year-to-date spent (same number everywhere)');
T.ok(yr.rows[9].partial && !yr.rows[8].partial, 'only the current month is marked "so far"');
T.eq(yr.avg.n, 9, 'the average uses full months only (Jan–Sep)');
T.eq(yr.avg.income, 3250, 'average full-month income $3,250');

// big-expense payments stay out of "spent" and appear on their own
const cfg = JSON.parse(JSON.stringify(fx.cfg)); cfg.bigExpenses.forEach(f => A.Funds.migrateOne(f, '2026-10'));
const amex = cfg.bigExpenses.find(f => /amex/i.test(f.name));
const txs = JSON.parse(JSON.stringify(fx.txs)); txs.find(t => t.desc === 'AMEX MEMBERSHIP FEE').fundId = amex.id;
const mar = Y.months(cfg, txs, '2026', TODAY).rows[2], marBefore = yr.rows[2];
T.eq([mar.spent, mar.fromFunds], [U.round2(marBefore.spent - 250), 250], 'March: the $250 fee paid from its fund moves out of "spent" into "paid from big expenses"');
T.eq(mar.left, marBefore.left, '…and "left over" is the same either way (the money still left)');

// other years
T.eq(Y.months(fx.cfg, fx.txs, '2025', TODAY).rows.length, 12, 'a past year shows all 12 months');
T.eq(Y.months(fx.cfg, fx.txs, '2027', TODAY).rows.length, 0, 'a future year has no months');
T.eq(Y.months(fx.cfg, [], '2026', TODAY).total.income, 0, 'no data: zeros, no errors');

// grid
const y = M.ytd(fx.cfg, fx.txs, '2026', TODAY), g = Y.grid(y);
T.eq(g.n, 10, 'grid has 10 month columns');
T.eq(g.months.map(v => v), yr.rows.map(r => r.spent), 'grid month totals equal the spent column of the income table, month by month');
T.eq(U.round2(g.months.reduce((a, v) => a + v, 0)), y.spent, 'grid grand total equals year-to-date spent');
const rent = g.groups.flatMap(x => x.rows).find(r => r.cat.id === 'rent');
T.eq([rent.months[0], rent.months[9], rent.total], [2300, 2300, 23000], 'Rent row: $2,300 each month, $23,000 total');
const groc = g.groups.flatMap(x => x.rows).find(r => r.cat.id === 'groceries');
T.eq(groc.months[0], U.round2(84.17 + 1 + 61.25 + 2), 'Groceries January: both shops added');
T.eq(U.round2(g.groups.reduce((a, x) => a + x.total, 0)), y.spent, 'group totals add up to the same total');
T.ok(g.groups.every(x => x.rows.every(r => r.months.length === 10)), 'every row has a value for every month');

// cell states
T.eq([Y.cellState(0, 100), Y.cellState(50, 0), Y.cellState(100, 100), Y.cellState(110, 100), Y.cellState(130, 100)], ['none', 'none', 'ok', 'over', 'over2'], 'cell state: nothing/no limit = none, at limit = ok, up to 25% over = over, more = over2');
T.done();
