/* Which copy of the budget is the newest. Pure; nothing here touches storage.
   Every budget gets an id the first time a file is saved; each saved file (Save file, Download budget file, a shared
   snapshot) is one "save" with a random id and a revision number, and carries the list of saves it descends from
   (cfg.lineage, inside the locked file). Each device remembers the newest save it has written or opened ("known").
   compare(): opening a file is  new (never seen here) · same · newer (descends from what this device knows) ·
              older (this device knows a later save) · diverged (both changed since a common save: a fork) · unknown
              (a file from before version 23, which has no lineage).
   diff()/merge(): two copies side by side, from the save they share: lines added, changed or deleted on each side. */
var Lineage = (function () {
  'use strict';
  var KEEP = 400;   // saves remembered in a file (about 40 bytes each); a fork older than that is still found as "diverged"

  function uid() { return U.uid(); }
  /* the record for a new save, made from the budget's current lineage (or none yet) */
  function stamp(lin, at) {
    var base = lin && lin.id ? lin : { id: 'b' + uid(), rev: 0, saves: [] };
    var s = { s: uid(), r: (base.rev || 0) + 1, at: at };
    return { id: base.id, rev: s.r, save: s.s, at: at, saves: (base.saves || []).concat([s]).slice(-KEEP) };
  }
  function ids(lin) { var o = {}; (lin && lin.saves || []).forEach(function (x) { o[x.s] = x; }); return o; }
  /* the newest save both histories contain: where two copies parted */
  function common(a, b) {
    var inB = ids(b), best = null;
    (a.saves || []).forEach(function (x) { if (inB[x.s] && (!best || x.r > best.r)) best = x; });
    return best;
  }
  function compare(file, known) {
    if (!file || !file.id) return { state: known ? 'unknown' : 'new' };
    if (!known || known.id !== file.id) return { state: 'new' };
    var out = { file: { rev: file.rev, at: file.at }, known: { rev: known.rev, at: known.at, name: known.name || null } };
    if (file.save === known.save) { out.state = 'same'; return out; }
    if (ids(file)[known.save]) { out.state = 'newer'; return out; }
    if (ids(known)[file.save]) { out.state = 'older'; return out; }
    out.state = 'diverged'; out.fork = common(file, known);
    return out;
  }
  /* what this device should remember after writing or opening a file: never go back to an older save */
  function remember(known, lin, name) {
    if (!lin || !lin.id) return known || null;
    var c = compare(lin, known);
    if (c.state === 'older' || c.state === 'same') return known;
    if (c.state === 'diverged') {   // opened a fork anyway: remember both lines of saves, the opened one as current
      var all = ids(known), merged = (known.saves || []).slice();
      (lin.saves || []).forEach(function (x) { if (!all[x.s]) merged.push(x); });
      merged.sort(function (p, q) { return p.r - q.r || (p.at < q.at ? -1 : 1); });
      return { id: lin.id, rev: lin.rev, save: lin.save, at: lin.at, name: name || null, saves: merged.slice(-KEEP) };
    }
    return { id: lin.id, rev: lin.rev, save: lin.save, at: lin.at, name: name || null, saves: (lin.saves || []).slice(-KEEP) };
  }

  /* ---------- comparing two copies ---------- */
  function same(a, b) {
    var strip = function (t) { var c = Object.assign({}, t); delete c.history; return JSON.stringify(c, Object.keys(c).sort()); };
    return strip(a) === strip(b);
  }
  function touched(t) { var h = t.history && t.history.length ? t.history[t.history.length - 1].at : ''; return [t.updatedAt || '', h, t.createdAt || ''].sort().pop(); }
  /* mine and theirs: { config, transactions }. since: when the copies parted (the common save), or null if unknown.
     A line in one copy only is "added" there if it was made after they parted, otherwise "deleted" in the other.
     A line in both that differs keeps the side edited last. */
  function diff(mine, theirs, since) {
    var A = {}, B = {}, out = { addedMine: [], addedTheirs: [], deletedMine: [], deletedTheirs: [], changedMine: [], changedTheirs: [], same: 0 };
    mine.transactions.forEach(function (t) { A[t.id] = t; });
    theirs.transactions.forEach(function (t) { B[t.id] = t; });
    Object.keys(A).forEach(function (id) {
      var a = A[id], b = B[id];
      if (!b) { if (since && a.createdAt && a.createdAt <= since) out.deletedTheirs.push(a); else out.addedMine.push(a); return; }
      if (same(a, b)) { out.same++; return; }
      if (touched(b) > touched(a)) out.changedTheirs.push({ mine: a, theirs: b }); else out.changedMine.push({ mine: a, theirs: b });
    });
    Object.keys(B).forEach(function (id) {
      if (A[id]) return;
      var b = B[id];
      if (since && b.createdAt && b.createdAt <= since) out.deletedMine.push(b); else out.addedTheirs.push(b);
    });
    return out;
  }
  /* the merged budget: both sides' additions, the later edit of a line changed on both, deletions from either side.
     settings: 'mine' or 'theirs' (categories, limits, rules, bills…), both lineages joined so either older file now
     shows as older than the merge. */
  function merge(mine, theirs, since, o) {
    o = o || {};
    var d = diff(mine, theirs, since), keep = {};
    mine.transactions.forEach(function (t) { keep[t.id] = t; });
    d.deletedTheirs.forEach(function (t) { delete keep[t.id]; });
    d.addedTheirs.forEach(function (t) { keep[t.id] = t; });
    d.changedTheirs.forEach(function (c) { keep[c.mine.id] = c.theirs; });
    var cfg = JSON.parse(JSON.stringify(o.settings === 'theirs' ? theirs.config : mine.config));
    var la = mine.config.lineage, lb = theirs.config.lineage;
    if (la && lb && la.id === lb.id) {
      var all = ids(la), saves = (la.saves || []).slice();
      (lb.saves || []).forEach(function (x) { if (!all[x.s]) saves.push(x); });
      saves.sort(function (p, q) { return p.r - q.r || (p.at < q.at ? -1 : 1); });
      var top = Math.max(la.rev || 0, lb.rev || 0), last = la.rev >= lb.rev ? la : lb;
      cfg.lineage = { id: la.id, rev: top, save: last.save, at: last.at, saves: saves.slice(-KEEP) };
    }
    return { config: cfg, transactions: Object.keys(keep).map(function (id) { return keep[id]; }), diff: d };
  }

  return { stamp: stamp, compare: compare, remember: remember, common: common, diff: diff, merge: merge, KEEP: KEEP };
})();
