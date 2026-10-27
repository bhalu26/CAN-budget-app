/* Where the money went in a year: top merchants and biggest single expenses. Pure functions.
   Counts what a line counts for in your spending (your share of a group bill), net of refunds, and includes payments made from
   big-expense funds so the list answers "where did my money go" (they are marked). Transfers, income and saving are not spending. */
var Spending = (function () {
  'use strict';
  function lines(txs, year) { return txs.filter(function (t) { return t.type === 'expense' && t.date && t.date.slice(0, 4) === String(year); }); }
  /* the same shop with a different store number ("#12", "#4545") is one merchant */
  function key(t) { return M.merchantKey(String(t.desc || '').replace(/#\s*\d+/g, ' ')) || '(no name)'; }

  /* -> { rows: [{ key, name, total, count, avg, catId, share, last, fund }], total } sorted by total, highest first */
  function merchants(txs, year) {
    var by = {}, total = 0;
    lines(txs, year).forEach(function (t) {
      var k = key(t), c = M.counted(t), g = by[k] || (by[k] = { key: k, total: 0, count: 0, names: {}, cats: {}, last: '', fund: 0 });
      g.total += c; g.count++; total += c; g.names[t.desc || '(no name)'] = (g.names[t.desc || '(no name)'] || 0) + 1;
      if (t.categoryId) g.cats[t.categoryId] = (g.cats[t.categoryId] || 0) + Math.abs(c);
      if (t.date > g.last) g.last = t.date; if (t.fundId) g.fund++;
    });
    var best = function (o) { return Object.keys(o).sort(function (a, b) { return o[b] - o[a] || (a < b ? -1 : 1); })[0] || null; };
    var rows = Object.keys(by).map(function (k) {
      var g = by[k];
      return { key: k, name: best(g.names), total: U.round2(g.total), count: g.count, avg: U.round2(g.total / g.count), catId: best(g.cats), share: 0, last: g.last, fund: g.fund };
    }).filter(function (r) { return r.total > 0; }).sort(function (a, b) { return b.total - a.total || (a.key < b.key ? -1 : 1); });
    total = U.round2(total);
    rows.forEach(function (r) { r.share = total > 0 ? r.total / total : 0; });
    return { rows: rows, total: total };
  }
  /* The n biggest single lines by what they count for. */
  function biggest(txs, year, n) {
    return lines(txs, year).map(function (t) { return { t: t, counted: M.counted(t) }; }).filter(function (x) { return x.counted > 0; })
      .sort(function (a, b) { return b.counted - a.counted || (a.t.date < b.t.date ? 1 : -1); }).slice(0, n || 15);
  }
  return { merchants: merchants, biggest: biggest };
})();
