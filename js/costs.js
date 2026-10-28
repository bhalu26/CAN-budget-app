/* What your recurring and fixed bills cost, and what is safe to spend after the bills still due. Pure functions built on Recurring and M.
   Three kinds of recurring bill, as in "fixed / flexible / non-monthly" budgeting:
     fixed       same amount, every month (or twice a month, every 2 weeks, every week): rent, phone, Netflix
     varies      comes every month but the amount moves: hydro, groceries-like bills
     nonmonthly  every 2 months, quarterly or yearly: property tax, insurance, annual fees (set aside a little each month)
   Money-in items (paycheques) are not costs and are left out. Paused items are listed but not counted. */
var Costs = (function () {
  'use strict';
  var CLASS_LABEL = { fixed: 'Fixed every month', varies: 'Changes every month', nonmonthly: 'Quarterly and yearly' };

  function classOf(it) {
    var c = it.cadence;
    if (['bimonthly', 'quarterly', 'yearly'].indexOf(c) >= 0) return 'nonmonthly';
    return it.amountMode === 'varies' ? 'varies' : 'fixed';
  }
  /* Every expense item with its yearly and monthly cost and class. */
  function list(cfg) {
    var cm = M.catMap(cfg);
    return (cfg.recurring || []).filter(function (it) { return it.kind === 'expense'; }).map(function (it) {
      var py = Recurring.perYear(it.cadence, it.amount);
      return { it: it, cls: classOf(it), perYear: U.round2(py), perMonth: U.round2(py / 12), active: it.active !== false, cat: it.categoryId ? cm[it.categoryId] || null : null };
    });
  }
  function summary(cfg) {
    var all = list(cfg), on = all.filter(function (x) { return x.active; }), by = { fixed: { n: 0, perYear: 0 }, varies: { n: 0, perYear: 0 }, nonmonthly: { n: 0, perYear: 0 } }, cats = {};
    on.forEach(function (x) {
      by[x.cls].n++; by[x.cls].perYear = U.round2(by[x.cls].perYear + x.perYear);
      var k = x.it.categoryId || '__none'; cats[k] = U.round2((cats[k] || 0) + x.perYear);
    });
    var yearly = U.round2(on.reduce(function (a, x) { return a + x.perYear; }, 0));
    var byCategory = Object.keys(cats).map(function (id) { var c = M.catMap(cfg)[id]; return { id: id, name: c ? c.name : 'No category', perYear: cats[id] }; }).sort(function (a, b) { return b.perYear - a.perYear; });
    return { items: on.sort(function (a, b) { return b.perYear - a.perYear; }), paused: all.filter(function (x) { return !x.active; }), yearly: yearly, monthly: U.round2(yearly / 12), by: by, byCategory: byCategory,
      fixedMonthly: U.round2(by.fixed.perYear / 12), setAsideMonthly: U.round2(by.nonmonthly.perYear / 12) };
  }
  /* Average monthly income over the full months of a year (for "fixed costs are 41% of income"). */
  function avgIncome(cfg, txs, year, today) {
    var rows = Year.months(cfg, txs, year, today).rows.filter(function (r) { return !r.partial; });
    return rows.length ? U.round2(rows.reduce(function (a, r) { return a + r.income; }, 0) / rows.length) : 0;
  }

  /* ---------- the 12-month strip for one item ----------
     state per month: paid, changed (paid, but a different amount), late, due (today or a few days ago), future, none (nothing expected, or before the item existed) */
  function strip(it, txs, year, today) {
    var from = year + '-01-01', to = year + '-12-31';
    var seen = Recurring.matches(it, txs).map(function (t) { return t.date; }), first = seen.length ? seen[0] : (it.createdAt || today).slice(0, 10);
    var exp = Recurring.status(it, txs, from, to, today), months = [];
    for (var m = 1; m <= 12; m++) {
      var ym = year + '-' + U.pad(m), here = exp.filter(function (e) { return e.date.slice(0, 7) === ym; }), state = 'none', amount = 0, expected = 0;
      if (here.length && ym >= first.slice(0, 7)) {
        var sts = here.map(function (e) { return e.date > today && e.state !== 'paid' && e.state !== 'changed' ? 'future' : e.state; });
        amount = U.round2(here.reduce(function (a, e) { return a + (e.tx ? e.amount : 0); }, 0)); expected = U.round2(here.length * it.amount);
        state = sts.indexOf('late') >= 0 ? 'late' : sts.indexOf('due') >= 0 ? 'due' : sts.indexOf('future') >= 0 ? 'future' : sts.indexOf('changed') >= 0 ? 'changed' : 'paid';
      }
      months.push({ m: m, ym: ym, state: state, amount: amount, expected: expected });
    }
    return months;
  }
  /* Did the amount move? Looks at the payments matched to this item. -> null or { from, to, since, perYear } (perYear = what the change costs over a year) */
  function priceChange(it, txs) {
    if (it.amountMode === 'varies') return null;   // a bill that moves every month has no "rise"
    var ms = Recurring.matches(it, txs).map(function (t) { return { d: t.date, a: Recurring.paid(it, t) }; });
    if (ms.length < 2) return null;
    var now = ms[ms.length - 1].a, tol = Math.max(0.5, now * 0.02), i = ms.length - 1;
    while (i > 0 && Math.abs(ms[i - 1].a - now) <= tol) i--;
    if (i === 0) return null;   // always the same
    var from = ms[i - 1].a;
    return { from: from, to: now, since: ms[i].d, perYear: U.round2((now - from) * Recurring.perYear(it.cadence, 1)) };
  }

  /* Where a limit is lower than the fixed bills in that category already add up to. -> [{ cat, fixed, limit, short }] */
  function limitCheck(cfg) {
    var by = {};
    list(cfg).filter(function (x) { return x.active && x.cls === 'fixed' && x.cat && x.cat.period !== 'year'; }).forEach(function (x) { by[x.cat.id] = (by[x.cat.id] || { cat: x.cat, fixed: 0 }); by[x.cat.id].fixed = U.round2(by[x.cat.id].fixed + x.perMonth); });
    return Object.keys(by).map(function (k) { var r = by[k]; return { cat: r.cat, fixed: r.fixed, limit: r.cat.limit || 0, short: U.round2(r.fixed - (r.cat.limit || 0)) }; })
      .filter(function (r) { return r.limit > 0 && r.short > 0.5; }).sort(function (a, b) { return b.short - a.short; });
  }
  /* Monthly bills seen in your history that are the same amount each time but not in your recurring list yet. */
  function looksFixed(cfg, txs, today) {
    return Recurring.detect(txs, today, cfg.recurringIgnore || [], cfg.recurring || []).filter(function (f) { return f.kind === 'expense' && f.amountMode === 'fixed' && ['monthly', 'semimonthly', 'quarterly', 'yearly'].indexOf(f.cadence) >= 0; });
  }

  /* Left to spend minus the bills still to come this month. null for months other than this one. */
  function safe(cfg, txs, ym, today) {
    var est = Recurring.monthEstimate(cfg, txs, ym, today); if (!est) return null;
    var s = M.month(cfg, txs, ym, today), parts = est.parts.filter(function (p) { return p.kind === 'bill'; });
    return { left: s.left, bills: est.bills, safe: U.round2(s.left - est.bills), parts: parts };
  }
  return { CLASS_LABEL: CLASS_LABEL, classOf: classOf, list: list, summary: summary, avgIncome: avgIncome, strip: strip, priceChange: priceChange, limitCheck: limitCheck, looksFixed: looksFixed, safe: safe };
})();
