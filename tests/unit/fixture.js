/* A fixed, made-up data set (no real amounts or names) used by the unit tests. Same input every run. */
'use strict';
const fs = require('fs'), path = require('path');
const pick = (...c) => c.find(f => fs.existsSync(f));
module.exports = function fixture(A) {
  const seedFile = pick(process.env.BUDGET_SEED || '', path.resolve(__dirname, '../../private/budget-seed.json'));
  if (!seedFile) { console.log('SKIP: these tests need your private budget-seed.json (put it in private/ or set BUDGET_SEED=...). It is not in the repository.'); process.exit(0); }
  const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
  const cfg = A.M.fromSeed(seed);
  const txs = [];
  let n = 0;
  const add = (date, amount, categoryId, desc, extra) => { const type = A.M.typeFor(cfg, categoryId); txs.push(Object.assign({ id: 't' + (n++), date, amount, categoryId, type, desc, source: 'csv', direction: amount < 0 && type === 'expense' ? 'in' : (type === 'income' ? 'in' : 'out'), flags: [], createdAt: date + 'T00:00:00Z' }, extra || {})); };
  for (let m = 1; m <= 10; m++) {
    const mm = String(m).padStart(2, '0');
    add('2026-' + mm + '-01', 2300, 'rent', 'CHEXY RENT');
    add('2026-' + mm + '-03', 20.99, 'subscriptions', 'NETFLIX.COM');
    add('2026-' + mm + '-05', 84.17 + m, 'groceries', 'SAFEWAY #4545');
    add('2026-' + mm + '-12', 61.25 + m * 2, 'groceries', 'SAVE ON FOODS');
    add('2026-' + mm + '-09', 6.75, 'dine-out', 'JJ BEAN COFFEE');
    add('2026-' + mm + '-15', 3250, '_income', 'PAYROLL DEPOSIT');
    add('2026-' + mm + '-20', 300, 'savings', 'TFSA CONTRIBUTION');
    if (m % 2 === 0) add('2026-' + mm + '-18', 44 + m * 1.5, 'utilities', 'BC HYDRO');
    if (m === 6) add('2026-06-22', 1450, 'travel', 'WESTJET', { tripId: null });
    if (m === 7) add('2026-07-11', -40, 'clothing', 'WINNERS RETURN');
    if (m === 7) add('2026-07-04', 89.99, 'clothing', 'WINNERS');
    if (m === 9) add('2026-09-14', 812.4, '_transfer', 'PAYMENT THANK YOU');
    if (m === 10) add('2026-10-04', 60, null, 'E-TRANSFER SENT', { needsTag: true });
    if (m === 3) add('2026-03-10', 250, 'fees-admin', 'AMEX MEMBERSHIP FEE');
  }
  return { cfg, txs };
};
