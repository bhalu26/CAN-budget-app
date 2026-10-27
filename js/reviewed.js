/* "Reviewed" months. You can mark a month as checked; the app keeps a snapshot of its numbers and later says whether anything changed.
   This only informs: it never blocks an edit, an import or a delete. Pure functions; the mark lives in cfg.monthsReviewed:
   { 'YYYY-MM': { at: ISO time, spent, income, saved, count, fromFunds, other } } */
var Reviewed = (function () {
  'use strict';
  var KEYS = [['spent', 'Spent'], ['income', 'Income'], ['saved', 'Saved'], ['fromFunds', 'Paid from big expenses'], ['count', 'Number of lines']];

  function snap(cfg, txs, ym, today, nowIso) {
    var s = M.month(cfg, txs, ym, today);
    return { at: nowIso, spent: s.spent, income: s.income, saved: s.saved, fromFunds: s.fromFunds, other: s.other, count: s.count };
  }
  function isReviewed(cfg, ym) { return !!(cfg.monthsReviewed && cfg.monthsReviewed[ym]); }
  /* -> null if the month is not marked; else { at, changed, diffs: [{ key, label, was, now }], edited: [lines edited after], added: [lines added after] } */
  function status(cfg, txs, ym, today) {
    var r = cfg.monthsReviewed && cfg.monthsReviewed[ym]; if (!r) return null;
    var now = M.month(cfg, txs, ym, today), diffs = [];
    KEYS.forEach(function (k) {
      var was = r[k[0]] || 0, cur = now[k[0]] || 0;
      if (Math.abs(was - cur) > 0.004) diffs.push({ key: k[0], label: k[1], was: was, now: cur });
    });
    var inMonth = txs.filter(function (t) { return t.date && t.date.slice(0, 7) === ym; });
    var edited = inMonth.filter(function (t) { return (t.history || []).some(function (e) { return e.at > r.at; }); });
    var added = inMonth.filter(function (t) { return t.createdAt && t.createdAt > r.at && edited.indexOf(t) < 0; });
    return { at: r.at, changed: diffs.length > 0 || edited.length > 0 || added.length > 0, diffs: diffs, edited: edited, added: added };
  }
  /* What is still open in a month, for the "mark reviewed anyway?" note. */
  function readiness(txs, ym, health) {
    var inMonth = {}; txs.forEach(function (t) { if (t.date && t.date.slice(0, 7) === ym) inMonth[t.id] = 1; });
    var waiting = txs.filter(function (t) { return inMonth[t.id] && t.needsTag; }).length;
    var issues = (health ? health.open : []).filter(function (i) { return i.kind !== 'review' && i.txIds.some(function (id) { return inMonth[id]; }); });
    return { waiting: waiting, issues: issues.length, clean: !waiting && !issues.length };
  }
  function mark(cfg, txs, ym, today, nowIso) { cfg.monthsReviewed = cfg.monthsReviewed || {}; cfg.monthsReviewed[ym] = snap(cfg, txs, ym, today, nowIso); return cfg.monthsReviewed[ym]; }
  function unmark(cfg, ym) { if (cfg.monthsReviewed) delete cfg.monthsReviewed[ym]; }
  /* Reviewed months that a set of dates would touch (for warnings before an import or an edit). */
  function touched(cfg, dates) {
    var out = {}; dates.forEach(function (d) { var ym = (d || '').slice(0, 7); if (isReviewed(cfg, ym)) out[ym] = (out[ym] || 0) + 1; });
    return out;
  }
  return { snap: snap, status: status, readiness: readiness, mark: mark, unmark: unmark, isReviewed: isReviewed, touched: touched, KEYS: KEYS };
})();
