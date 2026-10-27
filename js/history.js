/* Edit history on a transaction: "Amount $84.20 → $84.95". Pure functions; nothing here touches storage.
   Every write goes through DB.putTx / DB.putAll, which calls Hist.applyAll first, so every way of changing a line (edit, retag, bulk,
   Review, split, undo) is recorded without each screen having to remember. Newly created lines have no history (their origin is
   already on the line). History is kept on the line, so it travels with backups and restores. Capped at 25 entries per line. */
var Hist = (function () {
  'use strict';
  var CAP = 25, reason = 'Edited';
  /* field, label */
  var TRACK = [['amount', 'Amount'], ['categoryId', 'Category'], ['date', 'Date'], ['desc', 'Description'], ['note', 'Note'], ['share', 'My share'], ['settled', 'Paid back in cash'], ['repaysId', 'Repayment link'], ['notRecurring', 'Recurring'], ['fundId', 'Big expense'], ['tripId', 'Trip'], ['needsTag', 'Review']];

  function norm(v) { return v === undefined || v === null || v === '' ? null : v; }
  function same(a, b) { return JSON.stringify(norm(a)) === JSON.stringify(norm(b)); }
  /* -> [{ f, a, b }] for the tracked fields that differ */
  function diff(before, after) {
    var out = [];
    TRACK.forEach(function (t) { if (!same(before[t[0]], after[t[0]])) out.push({ f: t[0], a: norm(before[t[0]]), b: norm(after[t[0]]) }); });
    return out;
  }
  /* Say what one change was. names: { cat(id), fund(id), trip(id) } so ids read as names. */
  function say(c, names) {
    names = names || {};
    var label = TRACK.filter(function (t) { return t[0] === c.f; })[0][1];
    function show(v) {
      if (v === null) return 'none';
      if (c.f === 'amount' || c.f === 'share' || c.f === 'settled') return U.money(v, { cents: true });
      if (c.f === 'categoryId') return names.cat ? names.cat(v) : String(v);
      if (c.f === 'fundId') return names.fund ? names.fund(v) : String(v);
      if (c.f === 'tripId') return names.trip ? names.trip(v) : String(v);
      if (c.f === 'date') return U.shortDate(v) + ' ' + v.slice(0, 4);
      return '"' + String(v) + '"';
    }
    if (c.f === 'notRecurring') return c.b ? 'Marked as not part of a recurring bill' : 'Part of a recurring bill again';
    if (c.f === 'repaysId') return c.b ? 'Linked as a repayment for a group bill' : 'Repayment link removed';
    if (c.f === 'needsTag') return c.b ? 'Sent back to Review' : 'Marked reviewed';
    if (c.f === 'share' && c.a === null) return 'Paid for a group: my share ' + show(c.b);
    if (c.f === 'share' && c.b === null) return 'Group share removed (counts in full again)';
    return label + ' ' + show(c.a) + ' → ' + show(c.b);
  }
  /* Called for every line being written. map: id → the line as it is now. Mutates t.history only. */
  function apply(map, t, why, now) {
    var before = map[t.id];
    if (!before) return false;
    var c = diff(before, t);
    if (!c.length) { if (before.history && !t.history) t.history = before.history; return false; }
    t.history = (before.history || []).concat([{ at: now, why: why || 'Edited', c: c }]).slice(-CAP);
    return true;
  }
  function applyAll(txs, list, now) {
    var map = {}; (txs || []).forEach(function (x) { map[x.id] = x; });
    var why = reason; reason = 'Edited';
    list.forEach(function (t) { apply(map, t, why, now || new Date().toISOString()); });
  }
  /* Newest changes across all lines: [{ t, at, why, c }] */
  function recent(txs, limit) {
    var out = [];
    txs.forEach(function (t) { (t.history || []).forEach(function (e) { out.push({ t: t, at: e.at, why: e.why, c: e.c }); }); });
    return out.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; }).slice(0, limit || 20);
  }
  return { diff: diff, say: say, apply: apply, applyAll: applyAll, recent: recent, CAP: CAP, why: function (r) { reason = r; }, TRACK: TRACK };
})();
