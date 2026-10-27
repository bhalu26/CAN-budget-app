/* Account balances and net worth. Pure functions; dates are 'YYYY-MM-DD'.
   An account: { id, name, kind: 'bank'|'card' (how imports read amounts), type, currency, rate, rateDate, closed,
                 balances: [{ date, amount, source: 'import'|'manual', batchId? }] }
   Balances are what the bank says: for a credit card, the amount you owe (a positive number). Nothing is fetched; rates are typed in. */
var Accounts = (function () {
  'use strict';
  var TYPES = [
    { id: 'chequing', label: 'Chequing', group: 'cash' }, { id: 'savings', label: 'Savings', group: 'cash' },
    { id: 'investment', label: 'Investment (TFSA, RRSP, FHSA, RESP…)', group: 'invest' },
    { id: 'credit', label: 'Credit card', group: 'debt' },
    { id: 'other', label: 'Other', group: 'cash' }
  ];
  var BY_ID = {}; TYPES.forEach(function (t) { BY_ID[t.id] = t; });
  BY_ID.loan = { id: 'loan', label: 'Loan (older entry)', group: 'debt' };   // no longer offered; an account saved that way still counts as owed
  var GROUPS = [['cash', 'Cash'], ['invest', 'Investments'], ['debt', 'Credit cards']];
  function groupOf(a) { return (BY_ID[a.type] || BY_ID.other).group; }
  function isDebt(a) { return groupOf(a) === 'debt'; }

  /* Latest recorded balance on or before date (one per date; the later entry for a date wins). */
  function balanceOn(a, date) {
    var best = null;
    (a.balances || []).forEach(function (b) { if (b.date <= date && (!best || b.date >= best.date)) best = b; });
    return best;
  }
  /* Recorded balance + this account's transactions after it, up to date. Money in raises a bank balance and lowers a debt. */
  function estimate(a, txs, date) {
    var b = balanceOn(a, date); if (!b) return null;
    var flow = 0, n = 0;
    txs.forEach(function (t) {
      if (t.date <= b.date || t.date > date || !t.direction) return;
      if (t.accountId === a.id) { flow += t.direction === 'in' ? Math.abs(t.amount) : -Math.abs(t.amount); n++; }
    });
    return { from: b, amount: U.round2(isDebt(a) ? b.amount - flow : b.amount + flow), moved: U.round2(flow), count: n };
  }
  function inCad(a, v) { return a.currency && a.currency !== 'CAD' ? U.round2(v * (+a.rate || 0)) : v; }
  /* Assets − debts on date, using each open account's estimate. Accounts with no balance yet are listed, not guessed. */
  function netWorth(cfg, txs, date) {
    var assets = 0, debts = 0, rows = [], missing = [];
    (cfg.accounts || []).forEach(function (a) {
      if (a.closed) return;
      var e = estimate(a, txs, date);
      if (!e) { missing.push(a); return; }
      var v = inCad(a, e.amount);
      if (isDebt(a)) debts += v; else assets += v;
      rows.push({ acct: a, est: e, cad: v });
    });
    return { assets: U.round2(assets), debts: U.round2(debts), value: U.round2(assets - debts), rows: rows, missing: missing };
  }
  /* Net worth at the end of each of the last n months (this month: today). Months before any balance are left out. */
  function series(cfg, txs, n, today) {
    var out = [], ym = today.slice(0, 7);
    for (var k = n - 1; k >= 0; k--) {
      var m = U.shiftMonth(ym, -k), p = m.split('-'), end = k === 0 ? today : m + '-' + U.pad(U.daysInMonth(+p[0], +p[1]));
      var w = netWorth(cfg, txs, end);
      if (w.rows.length) out.push({ ym: m, date: end, value: w.value, partial: k === 0 });
    }
    return out;
  }
  /* Add or replace the balance for a date (returns a new list, sorted). */
  function setBalance(a, date, amount, source, batchId) {
    var list = (a.balances || []).filter(function (b) { return b.date !== date; });
    var b = { date: date, amount: U.round2(amount), source: source }; if (batchId) b.batchId = batchId;
    return list.concat([b]).sort(function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : 0; });
  }
  /* The closing balance in an imported file: the latest date; for several lines on that date, the last one in time
     (the last row when the file runs oldest-first, the first row when it runs newest-first). */
  function fromFile(entries) {
    var list = entries.filter(function (e) { return e.date && e.balance !== null && e.balance !== undefined; });
    if (!list.length) return null;
    var newestFirst = list.length > 1 && list[0].date > list[list.length - 1].date, best = null;
    list.forEach(function (e) { if (!best || e.date > best.date || (e.date === best.date && !newestFirst)) best = e; });
    return { date: best.date, amount: best.balance };
  }
  /* Older accounts get a type from how they were imported, and an empty balance list. Never overwrites. */
  function migrateOne(a) {
    if (!a.type) a.type = a.kind === 'card' ? 'credit' : 'chequing';
    if (!Array.isArray(a.balances)) a.balances = [];
    if (!a.currency) a.currency = 'CAD';
    return a;
  }
  return { TYPES: TYPES, BY_ID: BY_ID, GROUPS: GROUPS, groupOf: groupOf, isDebt: isDebt, balanceOn: balanceOn, estimate: estimate, inCad: inCad,
    netWorth: netWorth, series: series, setBalance: setBalance, fromFile: fromFile, migrateOne: migrateOne };
})();
