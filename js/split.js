/* Splitting one transaction (usually an imported bank line) across several categories. Pure: nothing is stored here.
   A split keeps everything the bank said (date, account, file, line, fingerprint) on every part, so a re-import still sees the line as
   already in. The parts must add up to the original amount to the cent. The first part keeps the original id; the others share
   `splitGroup` (the original id) and remember `splitTotal`, so a later edit that breaks the sum can be noticed. */
var Split = (function () {
  'use strict';
  function cents(v) { return Math.round(Math.abs(v) * 100); }
  function money(c) { return U.money(c / 100, { cents: true }); }

  /* -> { ok, why } : only spending lines can be split. */
  function canSplit(t) {
    if (!t) return { ok: false, why: 'Nothing to split.' };
    if (t.type !== 'expense') return { ok: false, why: 'Only spending lines can be split. Transfers, income and saving are one piece.' };
    if (t.share) return { ok: false, why: 'This line counts only your share of a group bill. Remove that first (Edit details), then split it.' };
    if (t.fundId) return { ok: false, why: 'This is paid from a big expense. Take it off the fund first (Edit details > Pay from), then split it.' };
    if (!t.amount) return { ok: false, why: 'A $0 line cannot be split.' };
    return { ok: true, why: '' };
  }
  function groupOf(txs, t) {
    if (!t.splitGroup) return [t];
    var g = txs.filter(function (x) { return x.splitGroup === t.splitGroup; });
    return g.length ? g.sort(function (a, b) { return (a.splitIndex || 0) - (b.splitIndex || 0) || (a.id === t.splitGroup ? -1 : 1); }) : [t];
  }
  /* The amount being divided: what the bank said (splitTotal), or the sum of the parts for a hand-made split. */
  function totalOf(parts) {
    var s = parts.find(function (p) { return p.splitTotal; });
    return s ? s.splitTotal : Math.round(parts.reduce(function (a, p) { return a + Math.abs(p.amount); }, 0) * 100) / 100;
  }

  /* lines: [{ amount: number >= 0.01 (always positive), cat, note? }]. -> { ok, error, remaining, parts: [tx...], removeIds: [ids no longer used] } */
  function build(cfg, parts, lines, stamp) {
    var first = parts[0], total = totalOf(parts), tc = cents(total), cm = M.catMap(cfg), sum = 0, i;
    var sign = first.amount < 0 ? -1 : 1;
    if (lines.length < 2) return { ok: false, error: 'A split needs at least two lines.', remaining: tc };
    for (i = 0; i < lines.length; i++) {
      var c = cents(lines[i].amount);
      if (!(c >= 1)) return { ok: false, error: 'Line ' + (i + 1) + ' needs an amount of at least $0.01.', remaining: tc };
      if (!lines[i].cat || !cm[lines[i].cat] || M.typeFor(cfg, lines[i].cat) !== 'expense') return { ok: false, error: 'Line ' + (i + 1) + ' needs a spending category (not a transfer or income).', remaining: tc };
      sum += c;
    }
    if (sum !== tc) return { ok: false, error: sum < tc ? money(tc - sum) + ' is still not placed.' : 'The lines are ' + money(sum - tc) + ' over the ' + money(tc) + ' total.', remaining: tc - sum };
    var base = JSON.parse(JSON.stringify(first)), group = first.splitGroup || first.id;
    var keepId = parts.filter(function (p) { return p.id === group; })[0] ? group : first.id;   // the original line keeps its id
    var out = lines.map(function (ln, k) {
      var p = JSON.parse(JSON.stringify(base));
      p.id = k === 0 ? keepId : U.uid();
      p.amount = sign * (cents(ln.amount) / 100); p.expr = null;
      p.categoryId = ln.cat; p.type = M.typeFor(cfg, ln.cat);
      if (ln.note !== undefined && ln.note !== '') p.note = ln.note; else if (k > 0) p.note = base.note || '';
      p.splitGroup = keepId; p.splitTotal = tc / 100; p.splitIndex = k + 1;
      p.needsTag = false; p.reviewReason = ''; p.conf = 'sure'; p.tagWhy = 'You split this line'; p.updatedAt = stamp; p.reviewedAt = stamp;
      delete p.linkId; delete p.fundId;
      if (!(p.tripId && cm[ln.cat] && cm[ln.cat].period === 'year')) p.tripId = null;   // a trip belongs on the travel part only
      p.flags = (base.flags || []).filter(function (f) { return !/^split/i.test(f); }).concat(['split ' + (k + 1) + ' of ' + lines.length + ' (bank amount ' + money(tc) + ')']);
      return p;
    });
    var keep = {}; out.forEach(function (p) { keep[p.id] = 1; });
    return { ok: true, error: '', remaining: 0, parts: out, removeIds: parts.map(function (p) { return p.id; }).filter(function (id) { return !keep[id]; }) };
  }

  /* Join a split back into one line with the category you choose. */
  function join(cfg, parts, catId, stamp) {
    var p = JSON.parse(JSON.stringify(parts.filter(function (x) { return x.id === (parts[0].splitGroup || parts[0].id); })[0] || parts[0]));
    var total = totalOf(parts), sign = parts[0].amount < 0 ? -1 : 1;
    p.amount = sign * total; p.categoryId = catId; p.type = M.typeFor(cfg, catId);
    delete p.splitGroup; delete p.splitTotal; delete p.splitIndex;
    p.flags = (p.flags || []).filter(function (f) { return !/^split/i.test(f); });
    p.needsTag = true; p.reviewReason = 'Joined back from a split: check the category'; p.conf = 'guess'; p.tagWhy = ''; p.updatedAt = stamp;
    return { tx: p, removeIds: parts.map(function (x) { return x.id; }).filter(function (id) { return id !== p.id; }) };
  }

  /* The most recent earlier split of the same merchant, as shares of its total (so it can be applied to a different amount). */
  function suggest(txs, t) {
    var key = M.merchantKey(t.desc); if (!key) return null;
    var groups = {};
    txs.forEach(function (x) { if (x.splitGroup && x.splitTotal && x.id !== t.id && x.splitGroup !== t.splitGroup && M.merchantKey(x.desc) === key) (groups[x.splitGroup] = groups[x.splitGroup] || []).push(x); });
    var best = null;
    Object.keys(groups).forEach(function (k) { var g = groups[k]; if (g.length > 1 && (!best || g[0].date > best[0].date)) best = g; });
    if (!best) return null;
    best.sort(function (a, b) { return (a.splitIndex || 0) - (b.splitIndex || 0); });
    var sum = best.reduce(function (a, p) { return a + Math.abs(p.amount); }, 0);   // from the parts themselves, so the shares always add to 100%
    return { date: best[0].date, shares: best.map(function (p) { return { cat: p.categoryId, share: Math.abs(p.amount) / sum }; }) };
  }
  /* Apply shares to a total in whole cents; the last line takes the rounding remainder so the sum is exact. */
  function applyShares(total, shares) {
    var tc = cents(total), left = tc;
    return shares.map(function (s, i) {
      var c = i === shares.length - 1 ? left : Math.min(left, Math.round(tc * s.share)); left -= c;
      return { amount: c / 100, cat: s.cat };
    });
  }
  return { canSplit: canSplit, groupOf: groupOf, totalOf: totalOf, build: build, join: join, suggest: suggest, applyShares: applyShares, cents: cents };
})();
