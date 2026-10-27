/* Big expenses as sinking funds. Pure functions; months are 'YYYY-MM'.
   A fund: { id, name, amount, repeats: 'once'|'yearly', due: 'YYYY-MM', start: 'YYYY-MM', categoryId, match, note }
   Money set aside is virtual (nothing moves between accounts): the amount is spread evenly over the months from start to due.
   Payments are transactions with t.fundId; they are kept out of monthly limits (see M.month / M.ytd). */
var Funds = (function () {
  'use strict';
  function ymNum(ym) { return +ym.slice(0, 4) * 12 + +ym.slice(5, 7) - 1; }
  function numYm(n) { return Math.floor(n / 12) + '-' + U.pad(n % 12 + 1); }
  function addYm(ym, k) { return numYm(ymNum(ym) + k); }
  function span(a, b) { return ymNum(b) - ymNum(a) + 1; }   // months from a to b, both included

  /* The cycle that month ym belongs to: { start, due, months }. Yearly funds repeat every 12 months after their first due month. */
  function cycle(f, ym) {
    var due = f.due, start = f.start || f.due;
    if (f.repeats === 'yearly') {
      while (ymNum(due) < ymNum(ym)) due = addYm(due, 12);
      var prevDue = addYm(due, -12);
      if (ymNum(prevDue) >= ymNum(start)) start = addYm(prevDue, 1);
    }
    if (ymNum(start) > ymNum(due)) start = due;
    return { start: start, due: due, months: span(start, due) };
  }
  /* Payments belong to the cycle whose due month is the first one at or after (payment month − 1): a bill posted the month after is still on time. */
  function paidIn(f, txs, c) {
    var ids = {}; return U.round2(txs.reduce(function (a, t) {
      if (t.fundId !== f.id || t.type !== 'expense' || ids[t.id]) return a;
      ids[t.id] = 1;
      var pm = t.date.slice(0, 7), owner = cycle(f, addYm(pm, -1));
      return owner.due === c.due ? a + t.amount : a;
    }, 0));
  }
  /* Everything Home and Settings show about one fund in month ym. */
  function status(f, txs, ym) {
    var c = cycle(f, ym), amount = +f.amount || 0, paid = paidIn(f, txs, c);
    var before = ymNum(ym) < ymNum(c.start), after = ymNum(ym) > ymNum(c.due);
    var elapsed = before ? 0 : Math.min(c.months, span(c.start, ym));
    var monthly = U.round2(amount / c.months);
    var setAside = U.round2(Math.min(amount, monthly * elapsed));
    var monthsLeft = before ? c.months : Math.max(0, span(ym, c.due));
    var done = paid >= amount - 1 && amount > 0;
    var state = done ? 'paid' : after ? 'overdue' : before ? 'not started' : paid > 0 ? 'partly paid' : 'saving';
    return { cycle: c, amount: amount, paid: paid, setAside: setAside, monthly: done || after || before ? 0 : monthly, monthsLeft: monthsLeft, state: state,
      over: U.round2(Math.max(0, paid - amount)), pct: amount ? Math.min(1, Math.max(setAside, paid) / amount) : 0 };
  }
  function totalMonthly(cfg, txs, ym) { return U.round2((cfg.bigExpenses || []).reduce(function (a, f) { return a + status(f, txs, ym).monthly; }, 0)); }
  function ids(cfg) { return M.fundIds(cfg); }
  /* Import: a money-out line whose text contains a fund's match text, in or near its due month, and the fund not yet paid. */
  function suggest(cfg, txs, desc, date, amountOut) {
    if (!(amountOut > 0)) return null;
    var n = Engine.normalize(desc), ym = date.slice(0, 7);
    return (cfg.bigExpenses || []).filter(function (f) {
      if (!f.match || n.indexOf(Engine.normalize(f.match)) < 0) return false;
      var c = cycle(f, addYm(ym, -1)), s = status(f, txs, c.due);
      return s.state !== 'paid' && ymNum(ym) >= ymNum(c.due) - 2 && ymNum(ym) <= ymNum(c.due) + 1;
    })[0] || null;
  }
  /* Fill in fields older versions did not have, from what is known (never overwrites). */
  function migrateOne(f, nowYm) {
    var name = String(f.name || '').toLowerCase();
    if (!/^\d{4}-\d{2}$/.test(f.due || '')) {
      if (f.repeats !== 'yearly' && f.year) f.due = f.year + '-12';
      else { f.due = addYm(nowYm, 11); f.dueGuessed = true; }
    }
    if (!/^\d{4}-\d{2}$/.test(f.start || '')) f.start = ymNum(nowYm) <= ymNum(f.due) ? nowYm : f.due;
    if (f.categoryId === undefined) f.categoryId = /amex|fee|ircc|immigration|passport|licen/.test(name) ? 'fees-admin' : /trip|travel|flight|holiday/.test(name) ? 'travel' : null;
    if (f.match === undefined) f.match = /amex/.test(name) ? 'MEMBERSHIP FEE' : /ircc|immigration/.test(name) ? 'IMMIGRATION CANADA' : '';
    return f;
  }
  return { cycle: cycle, status: status, totalMonthly: totalMonthly, ids: ids, suggest: suggest, migrateOne: migrateOne, span: span, addYm: addYm, ymNum: ymNum };
})();
