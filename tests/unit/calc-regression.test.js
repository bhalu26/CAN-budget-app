/* Golden numbers: the month summary, year to date and rule results for a fixed data set must not change unless a change
   is intended. First run (or --update) records them in golden.json; later runs compare and list every difference.
   Run: node tests/unit/calc-regression.test.js [--update] */
'use strict';
const fs = require('fs'), path = require('path');
const A = require('./harness')(), fx = require('./fixture')(A);
const pick = (...c) => c.find(f => fs.existsSync(f));
const GEN = pick(path.resolve(__dirname, '../../rules/rules-general.csv'), process.env.BUDGET_RULES || '');
const PERS = pick(path.resolve(__dirname, '../../private/rules-personal.csv'), process.env.BUDGET_RULES_PERSONAL || '');
const GOLD = path.join(__dirname, 'golden.json');
const TODAY = '2026-10-22';

function compute() {
  const out = { month: {}, ytd: null, classify: {} };
  for (let m = 1; m <= 10; m++) {
    const ym = '2026-' + String(m).padStart(2, '0'), s = A.M.month(fx.cfg, fx.txs, ym, TODAY);
    out.month[ym] = { left: s.left, limit: s.limit, spent: s.spent, saved: s.saved, income: s.income, other: s.other, needsTag: s.needsTag, count: s.count,
      attention: s.attention.map(r => r.cat.id + ':' + r.spent), bills: s.bills.map(b => b.cat.id + ':' + b.spent + (b.paid ? ':paid' : '')),
      groups: s.groups.map(g => g.group.id + ':' + g.spent + '/' + g.limit + ':' + g.level), yearly: s.yearly.map(y => y.cat.id + ':' + y.spent + '/' + y.limit) };
  }
  const y = A.M.ytd(fx.cfg, fx.txs, '2026', TODAY);
  out.ytd = { spent: y.spent, budget: y.budget, avg: y.avg, lastMonth: y.lastMonth, fullMonths: y.fullMonths, cats: y.cats.map(r => r.cat.id + ':' + r.spent + '/' + r.budget + ':' + r.months.join(',')) };
  const read = f => A.Engine.parseCSV(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')).rows;
  const rules = A.Engine.loadRules(read(GEN)).concat(A.Engine.loadRules(read(PERS)));
  ['SAFEWAY #4545', 'COSTCO WHOLESALE W123', 'AMZN MKTP CA*12', 'NETFLIX.COM', 'PAYMENT - THANK YOU', 'E-TRANSFER SENT JOHN', 'CHEXY RENT', 'TELUS HEALTH', 'BC HYDRO EV CHARGING',
    'JJ BEAN COFFEE', 'PAYROLL DEPOSIT', 'TFSA CONTRIBUTION', 'CRA TAX REFUND', 'WINNERS 245', 'UBER* TRIP', 'MYSTERY SHOP 77', 'DEBIT TO AFFIRM', 'CASH BACK REDEEMED']
    .forEach(d => { const c = A.Engine.classify(d, rules); out.classify[d] = [c.type, c.category, c.status, c.typeRule || c.catRule].join('|'); });
  return out;
}
function diff(a, b, p, list) {
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) { if (JSON.stringify(a) !== JSON.stringify(b)) list.push(p + ': was ' + JSON.stringify(a) + ', now ' + JSON.stringify(b)); return list; }
  new Set(Object.keys(a).concat(Object.keys(b))).forEach(k => diff(a[k], b[k], p + '.' + k, list));
  return list;
}
const now = compute();
if (process.argv.includes('--update') || !fs.existsSync(GOLD)) { fs.writeFileSync(GOLD, JSON.stringify(now, null, 1)); console.log('golden.json written (' + Object.keys(now.month).length + ' months, ' + now.ytd.cats.length + ' categories, ' + Object.keys(now.classify).length + ' descriptions)'); process.exit(0); }
const d = diff(JSON.parse(fs.readFileSync(GOLD, 'utf8')), now, 'golden', []);
d.forEach(x => console.log('DIFF ' + x));
console.log(d.length ? d.length + ' DIFFERENCES' : 'ALL PASSED (numbers unchanged)');
process.exit(d.length ? 1 : 0);
