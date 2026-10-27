/* The year in two tables, built on M.month and M.ytd so every number matches Home and Insights. Pure; nothing is stored.
   months(): one row per month: income, spent, paid from big expenses, saved, what is left, savings rate.
   grid():   categories down, months across (the "year at a glance"), with group and month totals. */
var Year = (function () {
  'use strict';
  /* Months shown: all 12 for a past year, up to this month for the current one, none for a future year. */
  function lastMonth(year, today) { var ty = today.slice(0, 4); return String(year) < ty ? 12 : String(year) > ty ? 0 : +today.slice(5, 7); }

  function months(cfg, txs, year, today) {
    var n = lastMonth(year, today), rows = [];
    for (var m = 1; m <= n; m++) {
      var ym = year + '-' + U.pad(m), s = M.month(cfg, txs, ym, today);
      var left = U.round2(s.income - s.spent - s.fromFunds - s.saved);
      rows.push({ ym: ym, m: m, income: s.income, spent: s.spent, fromFunds: s.fromFunds, saved: s.saved, left: left, other: s.other,
        rate: s.income > 0 ? s.saved / s.income : null, partial: year === today.slice(0, 4) && m === n, count: s.count });
    }
    var t = { income: 0, spent: 0, fromFunds: 0, saved: 0, left: 0, other: 0 };
    rows.forEach(function (r) { Object.keys(t).forEach(function (k) { t[k] = U.round2(t[k] + r[k]); }); });
    t.rate = t.income > 0 ? t.saved / t.income : null;
    var full = rows.filter(function (r) { return !r.partial; }), avg = { n: full.length };
    ['income', 'spent', 'fromFunds', 'saved', 'left'].forEach(function (k) { avg[k] = full.length ? U.round2(full.reduce(function (a, r) { return a + r[k]; }, 0) / full.length) : 0; });
    return { year: year, rows: rows, total: t, avg: avg, count: n };
  }

  /* y = M.ytd(...). Months before this one that have no spending anywhere still get a column. */
  function grid(y) {
    var n = Math.max(1, y.lastMonth), mt = [], groups = [];
    for (var i = 0; i < n; i++) mt.push(0);
    y.groups.forEach(function (g) {
      var gm = []; for (var i = 0; i < n; i++) gm.push(0);
      var rows = g.rows.map(function (r) {
        var months = []; for (var i = 0; i < n; i++) { months.push(r.months[i] || 0); gm[i] = U.round2(gm[i] + (r.months[i] || 0)); mt[i] = U.round2(mt[i] + (r.months[i] || 0)); }
        return { cat: r.cat, months: months, total: r.spent, avg: r.avg, limit: r.cat.period === 'year' ? 0 : (r.cat.limit || 0), yearly: r.cat.period === 'year' };
      });
      groups.push({ group: g.group, rows: rows, months: gm, total: g.spent });
    });
    return { n: n, groups: groups, months: mt, total: y.spent };
  }
  /* How a cell compares with its monthly limit: 'none' (no limit or nothing spent), 'ok', 'over' (up to 25% above) or 'over2' (more). */
  function cellState(v, limit) {
    if (!(limit > 0) || !(v > 0)) return 'none';
    if (v <= limit + 0.005) return 'ok';
    return v > limit * 1.25 ? 'over2' : 'over';
  }
  return { months: months, grid: grid, cellState: cellState, lastMonth: lastMonth };
})();
