/* Recurring bills, subscriptions and paycheques, and the month-end estimate. Pure functions: "today" is always passed in,
   nothing is stored about matches (everything is recomputed from transactions, so edits, deletes and imports update at once).
   An item: { id, name, key, kind: 'expense'|'income', cadence, anchor: 'YYYY-MM-DD', amount, amountMode: 'fixed'|'varies', categoryId, active,
              autoLog (false = never log it for you), logged: dates already logged for you } */
var Recurring = (function () {
  'use strict';
  var CADENCES = [
    { id: 'weekly', label: 'Every week', min: 6, max: 8, days: 7, tol: 3 },
    { id: 'biweekly', label: 'Every 2 weeks', min: 13, max: 16, days: 14, tol: 3 },
    { id: 'monthly', label: 'Every month', min: 26, max: 35, months: 1, tol: 5 },
    { id: 'bimonthly', label: 'Every 2 months', min: 55, max: 66, months: 2, tol: 7 },
    { id: 'quarterly', label: 'Every 3 months', min: 85, max: 97, months: 3, tol: 7 },
    { id: 'yearly', label: 'Every year', min: 350, max: 380, months: 12, tol: 10 },
    { id: 'semimonthly', label: 'Twice a month', min: 13, max: 17, days: 15, per: 24, tol: 3, semi: true }   // two fixed days of the month (item.day2 is the second; 31 = last day)
  ];
  var BY_ID = {}; CADENCES.forEach(function (c) { BY_ID[c.id] = c; });

  /* ---------- dates (UTC arithmetic on YYYY-MM-DD, so no time-zone drift) ---------- */
  function d2n(d) { var p = d.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5; }
  function n2d(n) { var x = new Date(n * 864e5); return x.getUTCFullYear() + '-' + U.pad(x.getUTCMonth() + 1) + '-' + U.pad(x.getUTCDate()); }
  function addDays(d, k) { return n2d(d2n(d) + k); }
  function addMonths(d, k, day) {   // keeps the day of month; the 31st becomes the last day of a shorter month
    var p = d.split('-'), y = +p[0], m = +p[1] - 1 + k;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    var dd = Math.min(day || +p[2], U.daysInMonth(y, m + 1));
    return y + '-' + U.pad(m + 1) + '-' + U.pad(dd);
  }
  function gap(a, b) { return d2n(b) - d2n(a); }
  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; }
  /* Two days a month: the days of month of a payment series that comes in pairs (1st and 15th, 15th and month end...). null if it does not. */
  function semiPattern(dates) {
    var months = {}; dates.forEach(function (d) { (months[d.slice(0, 7)] = months[d.slice(0, 7)] || []).push(+d.slice(8, 10)); });
    var keys = Object.keys(months).sort(); if (keys.length < 4) return null;
    var inner = keys.slice(1, -1), pairs = inner.filter(function (k) { return months[k].length === 2; });
    if (pairs.length < 3 || pairs.length / inner.length < 0.75) return null;
    var a = pairs.map(function (k) { return Math.min(months[k][0], months[k][1]); }), b = pairs.map(function (k) { return Math.max(months[k][0], months[k][1]); });
    if (Math.max.apply(null, a) - Math.min.apply(null, a) > 4 || Math.max.apply(null, b) - Math.min.apply(null, b) > 4 || median(b) - median(a) < 10) return null;
    var d2 = Math.round(median(b)); return { d1: Math.round(median(a)), d2: d2 >= 28 ? 31 : d2 };
  }
  function kindOf(t) {
    if (t.type === 'income') return 'income';
    if ((t.type === 'expense' || t.type === 'saving') && t.amount > 0) return 'expense';
    return null;   // transfers, not counted, pending, refunds
  }

  /* ---------- detection: suggestions only ---------- */
  function detect(txs, today, ignore, existing) {
    var from = addMonths(today, -26), skip = {}, groups = {};   // 26 months: a yearly charge needs two payments
    (ignore || []).forEach(function (k) { skip[k] = 1; });                         // dismissed: "KEY|kind"
    (existing || []).forEach(function (it) { skip[it.key + '|' + it.kind] = 1; });   // already one of your items
    txs.forEach(function (t) {
      if (!t.desc || t.notRecurring || t.auto || t.date < from || t.date > today) return;   // a line logged for you is not a payment seen
      var kind = kindOf(t); if (!kind) return;
      var key = M.merchantKey(t.desc); if (!key) return;
      var g = groups[key + '|' + kind] || (groups[key + '|' + kind] = { key: key, kind: kind, byDate: {}, cats: {}, names: [] });
      g.byDate[t.date] = U.round2((g.byDate[t.date] || 0) + Math.abs(t.amount));   // split parts on one day count once
      if (t.categoryId) g.cats[t.categoryId] = (g.cats[t.categoryId] || 0) + 1;
      g.names.push([t.date, t.desc]);
    });
    var out = [];
    Object.keys(groups).forEach(function (gk) {
      var g = groups[gk];
      if (skip[gk]) return;
      var dates = Object.keys(g.byDate).sort();
      if (dates.length < 2) return;
      var gaps = []; for (var i = 1; i < dates.length; i++) gaps.push(gap(dates[i - 1], dates[i]));
      var med = median(gaps), semi = semiPattern(dates), cad = semi ? BY_ID.semimonthly : CADENCES.filter(function (c) { return !c.semi && med >= c.min && med <= c.max; })[0];
      if (!cad) return;
      var amts0 = dates.map(function (d) { return g.byDate[d]; }), mid0 = median(amts0), fixed0 = amts0.every(function (a) { return Math.abs(a - mid0) <= Math.max(1, mid0 * 0.02); });
      // a yearly charge shows up after 2 payments; a quarterly one after 2 if the amount is identical (otherwise it needs 3)
      if (dates.length < (cad.id === 'yearly' || (cad.id === 'quarterly' && fixed0) ? 2 : 3)) return;
      var regular = semi ? 1 : gaps.filter(function (x) { return x >= cad.min && x <= cad.max; }).length / gaps.length;
      if (regular < 0.75) return;
      var last = dates[dates.length - 1];
      if (gap(last, today) > (cad.days || cad.months * 30.5) * 2 + cad.tol) return;   // stopped: no longer suggested
      var amts = dates.map(function (d) { return g.byDate[d]; }), mid = median(amts);
      var fixed = amts.every(function (a) { return Math.abs(a - mid) <= Math.max(1, mid * 0.02); });
      var cat = Object.keys(g.cats).sort(function (a, b) { return g.cats[b] - g.cats[a]; })[0] || null;
      var name = g.names.sort(function (a, b) { return a[0] < b[0] ? 1 : -1; })[0][1];
      var amount = fixed ? g.byDate[last] : U.round2(mid);
      out.push({ key: g.key, kind: g.kind, name: name, cadence: cad.id, anchor: last, amount: amount, amountMode: fixed ? 'fixed' : 'varies',
        low: Math.min.apply(null, amts), high: Math.max.apply(null, amts), categoryId: cat, count: dates.length, yearly: U.round2(perYear(cad.id, amount)), day2: semi ? semi.d2 : undefined });
    });
    return out.sort(function (a, b) { return b.yearly - a.yearly || (a.key < b.key ? -1 : 1); });
  }
  function perYear(cadence, amount) { var c = BY_ID[cadence]; if (c.per) return amount * c.per; return c.days ? amount * 365 / c.days : amount * 12 / c.months; }

  /* ---------- schedule ---------- */
  function schedule(item, from, to) {
    var c = BY_ID[item.cadence], out = [], k, d;
    if (!c || !item.anchor) return out;
    if (c.semi) {   // two fixed days of each month
      var d1 = +item.anchor.slice(8, 10), d2 = +item.day2 || (d1 <= 15 ? d1 + 15 : d1 - 15), y = +from.slice(0, 4), m = +from.slice(5, 7), guard2 = 0;
      while ((y + '-' + U.pad(m)) <= to.slice(0, 7) && guard2++ < 600) {
        var dim = U.daysInMonth(y, m), ds = [Math.min(d1, dim), Math.min(d2, dim)].sort(function (a, b) { return a - b; });
        ds.forEach(function (dd, i) { if (i && dd === ds[0]) return; var date = y + '-' + U.pad(m) + '-' + U.pad(dd); if (date >= from && date <= to) out.push(date); });
        m++; if (m > 12) { m = 1; y++; }
      }
      return out;
    }
    var day = +item.anchor.slice(8, 10);
    var step = function (n) { return c.days ? addDays(item.anchor, n * c.days) : addMonths(item.anchor, n * c.months, day); };
    // start from a step at or before "from"
    k = c.days ? Math.floor(gap(item.anchor, from) / c.days) - 1 : Math.floor(gap(item.anchor, from) / (c.months * 30.44)) - 1;
    for (var guard = 0; guard < 2000; guard++, k++) {
      d = step(k);
      if (d > to) break;
      if (d >= from) out.push(d);
    }
    return out;
  }

  /* ---------- matching and status ---------- */
  function matches(item, txs) {
    return txs.filter(function (t) { return !t.notRecurring && ((item.id && t.recurringId === item.id) || (t.desc && kindOf(t) === item.kind && M.merchantKey(t.desc) === item.key)); })   // a line logged for it counts too
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  }
  /* Expected dates between from and to, each matched to at most one transaction (closest within the tolerance). */
  function status(item, txs, from, to, today) {
    var c = BY_ID[item.cadence]; if (!c) return [];
    var tol = c.tol, cand = matches(item, txs), used = {};
    return schedule(item, from, to).map(function (d) {
      var best = null;
      cand.forEach(function (t) { var g = Math.abs(gap(d, t.date)); if (g <= tol && !used[t.id] && (!best || g < best.g)) best = { t: t, g: g }; });
      if (best) {
        used[best.t.id] = 1;
        var amt = Math.abs(best.t.amount), diff = Math.abs(amt - item.amount) > Math.max(1, item.amount * 0.02);   // a fixed bill that moved by more than 2% (a $100 rent rise is 4%)
        return { date: d, state: item.amountMode === 'fixed' && diff ? 'changed' : 'paid', amount: amt, tx: best.t };
      }
      return { date: d, state: gap(d, today) > tol ? 'late' : 'due', amount: item.amount, tx: null };
    });
  }
  /* Everything expected from the start of this month (so late ones show) to today + days, for active items. */
  function upcoming(cfg, txs, today, days) {
    var from = today.slice(0, 8) + '01', to = addDays(today, days || 30), out = [];
    (cfg.recurring || []).filter(function (it) { return it.active !== false; }).forEach(function (it) {
      status(it, txs, from, to, today).forEach(function (s) {
        if (s.date < today && s.state !== 'late' && s.date.slice(0, 7) !== today.slice(0, 7)) return;
        if (s.date < today && (s.state === 'paid' || s.state === 'changed') && gap(s.date, today) > 10) return;   // paid a while ago: not "coming up"
        out.push({ item: it, date: s.date, state: s.state, amount: s.amount, tx: s.tx });
      });
    });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.item.name < b.item.name ? -1 : 1); });
  }

  /* ---------- month-end estimate ----------
     estimate = spent so far in monthly categories
              + bills still to come (fixed-bill categories not yet paid: their recurring items, or their usual amount)
              + everyday spending for the days left (each everyday category at its usual pace, or its unpaid recurring items if larger)
     "usual" = median of the last 3 full months. Travel (yearly budget) and saving are left out, as in "left to spend". */
  function monthEstimate(cfg, txs, ym, today) {
    if (today.slice(0, 7) !== ym) return null;
    var s = M.month(cfg, txs, ym, today), p = ym.split('-'), dim = U.daysInMonth(+p[0], +p[1]);
    var daysLeft = dim - +today.slice(8, 10), monthEnd = ym + '-' + U.pad(dim);
    var spent = U.round2(s.limit - s.left);
    var prev = [1, 2, 3].map(function (k) { return addMonths(ym + '-01', -k).slice(0, 7); }), per = {}, funded = M.fundIds(cfg);
    txs = txs.filter(function (t) { return !(t.fundId && funded[t.fundId]); });   // big expenses are paid from money set aside
    txs.forEach(function (t) { var i = prev.indexOf(t.date.slice(0, 7)); if (i < 0 || t.type !== 'expense' || !t.categoryId) return; var a = per[t.categoryId] || (per[t.categoryId] = [0, 0, 0]); a[i] += M.counted(t); });
    var unpaid = {};
    (cfg.recurring || []).filter(function (it) { return it.active !== false && it.kind === 'expense' && it.categoryId; }).forEach(function (it) {
      status(it, txs, ym + '-01', monthEnd, today).forEach(function (st) { if (st.state === 'due' || st.state === 'late') unpaid[it.categoryId] = U.round2((unpaid[it.categoryId] || 0) + st.amount); });
    });
    var bills = 0, everyday = 0, parts = [];
    var spentBy = {}; txs.forEach(function (t) { if (t.date.slice(0, 7) === ym && t.type === 'expense' && t.categoryId) spentBy[t.categoryId] = (spentBy[t.categoryId] || 0) + M.counted(t); });
    M.groupsWithCats(cfg).forEach(function (gc) {
      if (gc.group.kind === 'saving') return;
      gc.cats.forEach(function (c) {
        if (c.period === 'year') return;
        var usual = per[c.id] ? U.round2(median(per[c.id])) : 0, add;
        var asBill = c.fixed;
        if (c.fixed) {
          add = unpaid[c.id] !== undefined ? unpaid[c.id] : ((spentBy[c.id] || 0) > 0 ? 0 : usual);
          bills += add;
        } else {
          var pace = usual * daysLeft / dim, due = unpaid[c.id] || 0;
          if (due > 0 && due >= pace) { add = due; bills += add; asBill = true; }   // a recurring bill (monthly, quarterly...) in an everyday category is still a bill to come
          else { add = pace; everyday += add; }
        }
        if (add > 0.005) parts.push({ cat: c, add: U.round2(add), kind: asBill ? 'bill' : 'everyday', usual: usual });
      });
    });
    bills = U.round2(bills); everyday = U.round2(everyday);
    var estimate = U.round2(spent + bills + everyday);
    return { spent: spent, bills: bills, everyday: everyday, estimate: estimate, limit: s.limit, left: U.round2(s.limit - estimate), daysLeft: daysLeft, parts: parts.sort(function (a, b) { return b.add - a.add; }) };
  }

  /* ---------- logging what was not recorded ----------
     Once a month is over (and the item's few days' leeway have passed), a date with nothing recorded for it is logged for you:
     a transaction with the item's name, amount and category. Only from cfg.autoLogFrom (the month this came in) and the day
     the item was added, for active items not set to "don't log". Each date is logged once: a logged line you delete stays deleted.
     When the real payment turns up later (an import), the logged line is no longer needed and is dropped, unless you edited it.
     -> { add: [new transactions], drop: [logged lines to remove], logged: { itemId: [dates] }, unlog: { itemId: [dates] } } */
  function autoLog(cfg, txs, today, nowIso) {
    var out = { add: [], drop: [], logged: {}, unlog: {} }, start = (cfg.autoLogFrom || today.slice(0, 7)) + '-01', monthEnd = addDays(today.slice(0, 8) + '01', -1);
    var real = txs.filter(function (t) { return !t.auto; });
    (cfg.recurring || []).forEach(function (it) {
      var c = BY_ID[it.cadence];
      if (!c || !it.id || it.active === false || it.autoLog === false || !(it.amount > 0) || (it.kind !== 'expense' && it.kind !== 'income')) return;
      var from = start, made = (it.createdAt || '').slice(0, 10), to = monthEnd, settled = addDays(today, -c.tol - 1);
      if (/^\d{4}-\d\d-\d\d$/.test(made) && made > from) from = made;   // nothing from before you added it
      if (settled < to) to = settled;
      if (to < from) return;
      var done = {}, mine = {};
      (it.logged || []).forEach(function (d) { done[d] = 1; });
      txs.forEach(function (t) { if (t.auto && t.auto.item === it.id) mine[t.auto.date] = t; });
      status(it, real, from, to, today).forEach(function (s) {
        var a = mine[s.date];
        if (s.tx) {   // recorded for real: a logged line you did not touch goes
          if (a && a.updatedAt === a.createdAt) { out.drop.push(a); (out.unlog[it.id] = out.unlog[it.id] || []).push(s.date); }
          return;
        }
        if (a || done[s.date]) return;
        var cat = it.kind === 'income' ? (it.categoryId || '_income') : (it.categoryId || null);
        out.add.push({ id: 'auto-' + it.id + '-' + s.date, source: 'manual',   // one id per bill and date: two tabs logging at once write the same line, never two
          createdAt: nowIso, updatedAt: nowIso, flags: ['Logged automatically'], amount: U.round2(it.amount), expr: null,
          categoryId: cat, type: cat ? M.typeFor(cfg, cat) : 'pending', date: s.date, desc: it.name, note: 'Logged automatically: ' + it.name + ' was not recorded by the end of the month.',
          tripId: null, needsTag: !cat, reviewReason: cat ? undefined : 'Logged automatically; choose a category', recurringId: it.id, auto: { item: it.id, date: s.date } });
        (out.logged[it.id] = out.logged[it.id] || []).push(s.date);
      });
    });
    return out;
  }

  /* For "Make this recurring" from one transaction: its likely cadence (from other payments to the same place) and the next date on or after today. */
  function guess(txs, t, today) {
    var kind = kindOf(t), key = M.merchantKey(t.desc || ''); if (!kind || !key) return null;
    var dates = {}; txs.forEach(function (x) { if (!x.notRecurring && !x.auto && x.desc && kindOf(x) === kind && M.merchantKey(x.desc) === key) dates[x.date] = 1; }); dates[t.date] = 1;
    var ds = Object.keys(dates).sort(), gaps = []; for (var i = 1; i < ds.length; i++) gaps.push(gap(ds[i - 1], ds[i]));
    var semi = ds.length >= 4 ? semiPattern(ds) : null, med = median(gaps);
    var cad = semi ? BY_ID.semimonthly : gaps.length ? CADENCES.filter(function (c) { return !c.semi && med >= c.min && med <= c.max; })[0] : null;
    var cadence = cad ? cad.id : 'monthly', last = ds[ds.length - 1];
    var item = { cadence: cadence, anchor: last, day2: semi ? semi.d2 : undefined }, next = schedule(item, today, addMonths(today, 14))[0] || last;
    return { cadence: cadence, certain: !!cad, anchor: next, day2: item.day2, kind: kind, key: key, count: ds.length };
  }
  /* A suggestion from detect() as a recurring item (what "Confirm" saves). */
  function itemFrom(f, nowIso) {
    return { id: U.uid(), name: f.name, key: f.key, kind: f.kind, cadence: f.cadence, anchor: f.anchor, amount: f.amount, amountMode: f.amountMode, categoryId: f.categoryId, day2: f.day2, active: true, createdAt: nowIso };
  }
  return { autoLog: autoLog, itemFrom: itemFrom, matches: matches, guess: guess, kindOf: kindOf, CADENCES: CADENCES, BY_ID: BY_ID, detect: detect, schedule: schedule, status: status, upcoming: upcoming, monthEstimate: monthEstimate, perYear: perYear, addDays: addDays, addMonths: addMonths, gap: gap, median: median };
})();
