/* Data health: everything that could make the numbers wrong, found by reading the data. Pure functions, nothing is changed here,
   and nothing in this file feeds the budget maths. Dates are 'YYYY-MM-DD'.
   An issue: { key, kind, level: 'high'|'medium'|'low', title, detail, txIds[], amount, accountId?, rows? }
   "high" = it changes what Home shows; "medium" = worth a look; "low" = for information.
   Ignored issues are remembered in cfg.healthIgnore by key. */
var Health = (function () {
  'use strict';
  var LEVEL_WORD = { high: 'Affects your numbers', medium: 'Worth checking', low: 'For information' };
  function day(d) { var p = d.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5; }
  function addDays(d, k) { var x = new Date((day(d) + k) * 864e5); return x.getUTCFullYear() + '-' + U.pad(x.getUTCMonth() + 1) + '-' + U.pad(x.getUTCDate()); }
  function cents(v) { return Math.round(Math.abs(v) * 100); }
  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; }
  function signedOut(t) { return t.direction ? t.direction === 'out' : t.amount > 0; }   // money leaving, as the transaction itself says
  function byId(txs) { var o = {}; txs.forEach(function (t) { o[t.id] = t; }); return o; }
  function validDate(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d || '') && +d.slice(0, 4) >= 2000; }

  /* ---------- running balance inside one file ----------
     entries: [{ date, amount (+ money in, − money out), balance, line }] in file order.
     The balance after each day should equal the balance before it plus that day's lines (or minus, for a card that shows what is owed).
     Within one day banks list lines in any order, so a day is checked as a whole: some line's balance must equal opening + the day's total. */
  function fileCheck(entries) {
    var list = entries.filter(function (e) { return validDate(e.date) && e.balance !== null && e.balance !== undefined && !isNaN(e.balance) && e.amount !== null && e.amount !== undefined; });
    if (list.length < 2) return { checked: 0, rows: list.length, breaks: [], ok: true, conv: 1, opening: null, closing: null, firstDate: null };
    if (list[0].date > list[list.length - 1].date) list = list.slice().reverse();   // newest first → oldest first
    var days = [], cur = null;
    list.forEach(function (e) { if (!cur || cur.date !== e.date) days.push(cur = { date: e.date, rows: [] }); cur.rows.push(e); });
    function run(conv) {
      var open = U.round2(days[0].rows[0].balance - conv * days[0].rows[0].amount), breaks = [], matched = 0, openings = [open];
      days.forEach(function (d) {
        var sum = U.round2(d.rows.reduce(function (a, r) { return a + r.amount; }, 0)), want = U.round2(open + conv * sum);
        var hit = d.rows.filter(function (r) { return Math.abs(r.balance - want) < 0.011; })[0];
        if (hit) { matched++; open = hit.balance; }
        else {
          var end = d.rows[d.rows.length - 1].balance;
          breaks.push({ date: d.date, before: open, after: end, lines: sum, unexplained: U.round2((end - open) - conv * sum), rows: d.rows.map(function (r) { return r.line; }) });
          open = end;
        }
      });
      return { conv: conv, breaks: breaks, matched: matched, opening: openings[0], closing: open };
    }
    var a = run(1), b = run(-1), r = b.breaks.length < a.breaks.length ? b : a;   // a card that lists what is owed rises with spending
    return { checked: days.length, rows: list.length, breaks: r.breaks, ok: !r.breaks.length, conv: r.conv, opening: r.opening, closing: r.closing, firstDate: days[0].date };
  }
  /* Does the file start where the account's last recorded balance left off? Only when that balance is from before the file. */
  function openingGap(acct, check) {
    if (!acct || !check || check.opening === null || !check.checked) return null;
    var prev = Accounts.balanceOn(acct, addDays(check.firstDate, -1));
    if (!prev) return null;
    var mine = Accounts.isDebt(acct) ? Math.abs(check.opening) : check.opening, diff = U.round2(mine - prev.amount);
    return Math.abs(diff) < 0.011 ? null : { prev: prev, opening: mine, diff: diff };
  }

  /* ---------- recorded balances against transactions ----------
     Between two balances, the change should equal the account's lines after the first up to and including the second's date.
     Not checked: an account with no lines at all (one you only update by hand). An account with lines is always checked,
     even with nothing between two balances: a statement may be missing. */
  function balanceCheck(cfg, txs) {
    var out = [];
    (cfg.accounts || []).forEach(function (a) {
      if (a.closed) return;
      var bs = (a.balances || []).slice().sort(function (x, y) { return x.date < y.date ? -1 : 1; }), debt = Accounts.isDebt(a);
      if (!txs.some(function (t) { return t.accountId === a.id && t.direction; })) return;   // an account you only update by hand (a TFSA): no lines to check its balances against
      for (var i = 1; i < bs.length; i++) {
        var b1 = bs[i - 1], b2 = bs[i], flow = 0, n = 0;
        txs.forEach(function (t) {
          if (t.accountId !== a.id || !t.direction || t.date <= b1.date || t.date > b2.date) return;
          flow += t.direction === 'in' ? Math.abs(t.amount) : -Math.abs(t.amount); n++;
        });
        var expect = U.round2(debt ? -flow : flow), actual = U.round2(b2.amount - b1.amount), diff = U.round2(actual - expect);
        if (Math.abs(diff) > 0.009) out.push({ acct: a, from: b1, to: b2, lines: n, expected: expect, actual: actual, diff: diff });
      }
    });
    return out;
  }

  /* ---------- duplicates ---------- */
  function sameMerchant(a, b) {
    var ka = M.merchantKey(a.desc), kb = M.merchantKey(b.desc);
    if (!ka || !kb) return !!a.categoryId && a.categoryId === b.categoryId;   // a hand-entered line with no name: same category will do
    if (ka === kb) return true;
    var s = ka.length <= kb.length ? ka : kb, l = s === ka ? kb : ka;
    return s.length >= 4 && l.indexOf(s) === 0;
  }
  function duplicates(txs) {
    var buckets = {}, pairs = [];
    txs.forEach(function (t) {
      if (!validDate(t.date) || !t.amount || t.type === 'exclude') return;
      (buckets[cents(t.amount) + (signedOut(t) ? 'o' : 'i')] = buckets[cents(t.amount) + (signedOut(t) ? 'o' : 'i')] || []).push(t);
    });
    Object.keys(buckets).forEach(function (k) {
      var b = buckets[k].sort(function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : 0; });
      for (var i = 0; i < b.length; i++) for (var j = i + 1; j < b.length; j++) {
        var x = b[i], y = b[j], gap = day(y.date) - day(x.date);
        if (gap > 3) break;
        if (x.linkId && x.linkId === y.linkId) continue;
        if (x.splitGroup && x.splitGroup === y.splitGroup) continue;   // parts of one split often share an amount
        if (!sameMerchant(x, y)) continue;
        var sameFile = x.batchId && x.batchId === y.batchId, manual = x.source === 'manual' || y.source === 'manual';
        var level, why;
        if (sameFile) { if (gap > 0) continue; level = 'low'; why = 'Repeated in the same file'; }
        else if (gap === 0) { level = 'high'; why = manual ? 'Typed by hand and also imported' : 'In two different imports'; }
        else if (gap <= (manual ? 3 : 2)) { level = 'medium'; why = manual ? 'Typed by hand, then imported a day or two later' : 'Same amount and merchant a day or two apart'; }
        else continue;
        pairs.push({ a: x, b: y, level: level, why: why });
      }
    });
    // join pairs that share a line into one group
    var parent = {}; function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
    pairs.forEach(function (p) { [p.a.id, p.b.id].forEach(function (i) { if (parent[i] === undefined) parent[i] = i; }); parent[find(p.a.id)] = find(p.b.id); });
    var groups = {}, rank = { high: 3, medium: 2, low: 1 };
    pairs.forEach(function (p) {
      var g = groups[find(p.a.id)] || (groups[find(p.a.id)] = { ids: {}, level: 'low', why: '' });
      g.ids[p.a.id] = 1; g.ids[p.b.id] = 1;
      if (rank[p.level] > rank[g.level] || !g.why) { g.level = p.level; g.why = p.why; }
    });
    return Object.keys(groups).map(function (k) { var g = groups[k]; return { ids: Object.keys(g.ids).sort(), level: g.level, why: g.why }; });
  }

  /* ---------- everything together ---------- */
  function check(cfg, txs, today) {
    var issues = [], tx = byId(txs), cm = M.catMap(cfg), special = {}, ignore = {};
    M.SPECIAL.forEach(function (s) { special[s.id] = 1; });
    (cfg.healthIgnore || []).forEach(function (k) { ignore[k] = 1; });
    var counts = {};
    function add(i) { counts[i.kind] = (counts[i.kind] || 0) + 1; i.ignored = !!ignore[i.key]; issues.push(i); }
    function list(ids) { return ids.map(function (id) { return tx[id]; }).filter(Boolean); }
    function total(ids) { return U.round2(list(ids).reduce(function (a, t) { return a + Math.abs(t.amount); }, 0)); }
    var acctName = {}; (cfg.accounts || []).forEach(function (a) { acctName[a.id] = a.name; });

    // 1. balances that do not add up
    balanceCheck(cfg, txs).forEach(function (b) {
      add({ key: 'bal|' + b.acct.id + '|' + b.from.date + '|' + b.to.date, kind: 'balance', level: 'high', accountId: b.acct.id, txIds: [], amount: Math.abs(b.diff),
        title: b.acct.name + ': balances and transactions do not add up',
        detail: 'Your balance went from ' + U.money(b.from.amount, { cents: true }) + ' on ' + U.shortDate(b.from.date) + ' to ' + U.money(b.to.amount, { cents: true }) + ' on ' + U.shortDate(b.to.date) +
          ' (a change of ' + U.money(b.actual, { cents: true }) + '), but the ' + b.lines + ' line' + (b.lines === 1 ? '' : 's') + ' in between explain ' + U.money(b.expected, { cents: true }) +
          '. ' + U.money(Math.abs(b.diff), { cents: true }) + ' is unexplained: a line may be missing, counted twice, or dated outside this period.' });
    });
    // 1b. months you marked reviewed that have changed since
    if (typeof Reviewed !== 'undefined') Object.keys(cfg.monthsReviewed || {}).sort().forEach(function (ym) {
      var st = Reviewed.status(cfg, txs, ym, today); if (!st || !st.changed) return;
      var d = st.diffs.filter(function (x) { return x.key !== 'count'; }).map(function (x) { return x.label.toLowerCase() + ' ' + (x.now > x.was ? '+' : '−') + U.money(Math.abs(x.now - x.was), { cents: true }); });
      add({ key: 'rev|' + ym + '|' + cfg.monthsReviewed[ym].at, kind: 'reviewed', level: 'medium', txIds: st.edited.concat(st.added).map(function (t) { return t.id; }), amount: 0, month: ym,
        title: U.MONTHS[+ym.slice(5) - 1] + ' ' + ym.slice(0, 4) + ' changed since you marked it reviewed',
        detail: (d.length ? d.join(', ') + '. ' : 'The totals are the same, but ') + st.edited.length + ' line' + (st.edited.length === 1 ? '' : 's') + ' edited and ' + st.added.length + ' added since. If that is expected, review the month again.' });
    });
    // 2. duplicates
    duplicates(txs).forEach(function (g) {
      var ts = list(g.ids).sort(function (a, b) { return a.date < b.date ? -1 : 1; }), each = Math.abs(ts[0].amount);
      add({ key: 'dup|' + g.ids.join('|'), kind: 'duplicate', level: g.level, txIds: g.ids, amount: U.round2(each * (ts.length - 1)),
        title: ts.length + ' lines that look the same: ' + (ts[0].desc || 'no name') + ' ' + U.money(each, { cents: true }),
        detail: g.why + '. If one is a repeat, ' + U.money(each * (ts.length - 1), { cents: true }) + ' is being counted twice.' });
    });
    // 3. waiting for review: counted or not
    var wait = txs.filter(function (t) { return t.needsTag; });
    if (wait.length) {
      var counted = wait.filter(function (t) { return t.type === 'expense'; }), idle = wait.filter(function (t) { return t.type !== 'expense'; });
      add({ key: 'review', kind: 'review', level: counted.length ? 'high' : 'medium', txIds: wait.map(function (t) { return t.id; }), amount: U.round2(counted.reduce(function (a, t) { return a + Math.abs(t.amount); }, 0)),
        title: wait.length + ' line' + (wait.length === 1 ? '' : 's') + ' waiting for review',
        detail: (counted.length ? U.money(counted.reduce(function (a, t) { return a + Math.abs(t.amount); }, 0), { cents: true }) + ' across ' + counted.length + ' is counted as spending until you confirm it (an e-Transfer to yourself, for example, would not be spending). ' : '') +
          (idle.length ? idle.length + ' more (' + U.money(idle.reduce(function (a, t) { return a + Math.abs(t.amount); }, 0), { cents: true }) + ') are not counted anywhere yet.' : ''), link: '#/review', linkText: 'Open Review' });
    }
    // 4. categories that no longer exist
    var lost = txs.filter(function (t) { return t.categoryId && !cm[t.categoryId] && !special[t.categoryId] && !t.needsTag; });
    if (lost.length) add({ key: 'nocat', kind: 'category', level: 'high', txIds: lost.map(function (t) { return t.id; }), amount: total(lost.map(function (t) { return t.id; })),
      title: lost.length + ' line' + (lost.length === 1 ? '' : 's') + ' in a category that no longer exists', detail: 'They show as "Unknown category" in Insights and have no limit. Give them a category.' });
    // 5. odd lines: future dates, impossible dates, zero amounts, unusually large for the merchant
    var odd = [], past = {};
    txs.forEach(function (t) {
      if (!validDate(t.date)) { odd.push([t, 'date', 'The date is missing or impossible']); return; }
      if (t.date > addDays(today, 7)) odd.push([t, 'future', 'Dated ' + U.shortDate(t.date) + ' ' + t.date.slice(0, 4) + ', more than a week ahead']);
      if (t.amount === 0 && t.type !== 'exclude') odd.push([t, 'zero', 'The amount is $0']);
      if (t.type === 'expense' && t.amount > 0 && t.desc && !t.splitGroup) { var k = M.merchantKey(t.desc); if (k) (past[k] = past[k] || []).push(t); }
    });
    Object.keys(past).forEach(function (k) {
      var h = past[k]; if (h.length < 5) return;
      h.forEach(function (t) {
        var others = h.filter(function (o) { return o.id !== t.id; }).map(function (o) { return o.amount; }), m = median(others);
        if (t.amount >= 50 && t.amount > m * 5 && t.amount > m + 100) odd.push([t, 'large', 'About ' + Math.round(t.amount / m) + '× your usual ' + U.money(m, { cents: true }) + ' here']);
      });
    });
    odd.forEach(function (o) {
      var t = o[0];
      add({ key: 'odd|' + o[1] + '|' + t.id, kind: 'odd', level: o[1] === 'large' ? 'medium' : o[1] === 'zero' ? 'low' : 'high', txIds: [t.id], amount: Math.abs(t.amount),
        title: (o[1] === 'large' ? 'Unusually large: ' : o[1] === 'future' ? 'Future date: ' : o[1] === 'zero' ? 'Zero amount: ' : 'Bad date: ') + (t.desc || 'no name') + ' ' + U.money(t.amount, { cents: true }),
        detail: o[2] + (o[1] === 'large' ? '. A slipped decimal or a typo?' : '.') });
    });
    // 5b. splits whose parts no longer add up to the bank amount (a part was edited or deleted)
    var sg = {};
    txs.forEach(function (t) { if (t.splitGroup && t.splitTotal) (sg[t.splitGroup] = sg[t.splitGroup] || []).push(t); });
    Object.keys(sg).forEach(function (k) {
      var parts = sg[k], want = Math.round(parts[0].splitTotal * 100), got = Math.round(parts.reduce(function (a, p) { return a + Math.abs(p.amount); }, 0) * 100);
      if (got === want) return;
      add({ key: 'split|' + k + '|' + got, kind: 'split', level: 'high', txIds: parts.map(function (p) { return p.id; }), amount: Math.abs(got - want) / 100,
        title: 'A split no longer adds up: ' + (parts[0].desc || 'no name'),
        detail: 'The bank line was ' + U.money(want / 100, { cents: true }) + ', but its ' + parts.length + ' part' + (parts.length === 1 ? '' : 's') + ' now total ' + U.money(got / 100, { cents: true }) + ' (' + U.money(Math.abs(got - want) / 100, { cents: true }) + (got < want ? ' missing' : ' extra') + '). A part may have been edited or deleted.' });
    });
    // 5c. group bills: a share that makes no sense, money still owed for a long time, repayments whose bill is gone
    var bad = txs.filter(function (t) { return t.type === 'expense' && t.share !== undefined && t.share !== null && t.amount > 0 && !(t.share > 0 && t.share < t.amount); });
    bad.forEach(function (t) {
      add({ key: 'grp|bad|' + t.id, kind: 'group', level: 'high', txIds: [t.id], amount: Math.abs(t.amount),
        title: 'Group share does not fit the bill: ' + (t.desc || 'no name'), detail: 'My share is ' + U.money(t.share, { cents: true }) + ' but the bill is ' + U.money(t.amount, { cents: true }) + ', so the whole bill is being counted as your spending. Change the share or remove it.' });
    });
    txs.filter(function (t) { return t.type === 'expense' && M.counted(t) !== t.amount; }).forEach(function (t) {
      var got = txs.filter(function (x) { return x.repaysId === t.id; }).reduce(function (a, x) { return a + Math.abs(x.amount); }, 0) + (+t.settled || 0), left = Math.round((t.amount - t.share - got) * 100) / 100;
      if (left > 0.004 && validDate(t.date) && t.date < addDays(today, -30)) add({ key: 'grp|old|' + t.id, kind: 'group', level: 'low', txIds: [t.id], amount: left,
        title: U.money(left, { cents: true }) + ' still owed to you from ' + (t.desc || 'a group bill'), detail: 'You paid for the group on ' + U.shortDate(t.date) + ' and not everything has been paid back. Link the repayments you received, or note cash.' });
    });
    txs.filter(function (x) { return x.repaysId && !tx[x.repaysId]; }).forEach(function (x) {
      add({ key: 'grp|gone|' + x.id, kind: 'group', level: 'medium', txIds: [x.id], amount: Math.abs(x.amount),
        title: 'A repayment points at a bill that no longer exists: ' + (x.desc || 'no name'), detail: 'It is marked as repaying a group bill, but that bill was deleted. Open it and choose what it really is.' });
    });
    // 6. transfers with no other side (only when there is more than one account to match against)
    if ((cfg.accounts || []).filter(function (a) { return !a.closed; }).length > 1) {
      var lone = txs.filter(function (t) { return t.type === 'transfer' && !t.linkId && !t.needsTag && validDate(t.date) && t.date < addDays(today, -7); });
      if (lone.length) add({ key: 'transfers', kind: 'transfer', level: 'medium', txIds: lone.map(function (t) { return t.id; }), amount: total(lone.map(function (t) { return t.id; })),
        title: lone.length + ' transfer' + (lone.length === 1 ? '' : 's') + ' with no matching other side',
        detail: 'A card payment or move between your accounts should show up on both. If the other account is not imported yet, import it; if the money really left your household, change the category so it counts.' });
    }
    // 7. months with nothing in an account that normally has something
    (cfg.accounts || []).forEach(function (a) {
      if (a.closed) return;
      var months = {}; txs.forEach(function (t) { if (t.accountId === a.id && t.source === 'csv' && validDate(t.date)) months[t.date.slice(0, 7)] = 1; });
      var ks = Object.keys(months).sort(); if (ks.length < 3) return;
      var gaps = [], m = ks[0];
      while (m < ks[ks.length - 1]) { if (!months[m]) gaps.push(m); m = U.shiftMonth(m, 1); }
      if (gaps.length) add({ key: 'gap|' + a.id + '|' + gaps.join(','), kind: 'gap', level: 'low', accountId: a.id, txIds: [], amount: 0,
        title: a.name + ': nothing imported for ' + gaps.slice(0, 4).map(U.monthLabel).join(', ') + (gaps.length > 4 ? ' and ' + (gaps.length - 4) + ' more' : ''),
        detail: 'There are lines before and after, so a statement may be missing.' });
    });

    var rank = { high: 0, medium: 1, low: 2 };
    issues.sort(function (a, b) { return a.ignored - b.ignored || rank[a.level] - rank[b.level] || b.amount - a.amount; });
    var open = issues.filter(function (i) { return !i.ignored; });
    var checks = [['balance', 'Balances against transactions'], ['reviewed', 'Reviewed months that changed'], ['duplicate', 'Possible duplicates'], ['review', 'Lines waiting for review'], ['category', 'Missing categories'],
      ['odd', 'Odd dates and amounts'], ['split', 'Splits that add up'], ['group', 'Group bills and repayments'], ['transfer', 'Transfers without another side'], ['gap', 'Months with nothing imported']]
      .map(function (c) { return { id: c[0], label: c[1], count: open.filter(function (i) { return i.kind === c[0]; }).length }; });
    return { issues: issues, open: open, high: open.filter(function (i) { return i.level === 'high'; }).length, checks: checks, ignored: issues.length - open.length, lines: txs.length };
  }

  return { check: check, fileCheck: fileCheck, openingGap: openingGap, balanceCheck: balanceCheck, duplicates: duplicates, LEVEL_WORD: LEVEL_WORD, addDays: addDays };
})();
