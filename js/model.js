/* Budget rules and calculations. Pure functions: no storage, no screen code. */
var M = (function () {
  'use strict';

  /* Special "categories" that are really transaction types. */
  var SPECIAL = [
    { id: '_income', name: 'Income', type: 'income' },
    { id: '_transfer', name: 'Transfer (own account)', type: 'transfer' },
    { id: '_exclude', name: 'Not counted', type: 'exclude' }
  ];

  /* Build the app's settings from budget-seed.json. */
  function fromSeed(seed) {
    if (!seed || !Array.isArray(seed.groups)) throw new Error('This file does not look like a budget seed (no "groups" list).');
    var groups = [], cats = [];
    seed.groups.forEach(function (g, gi) {
      var gid = g.id || U.slug(g.name);
      groups.push({ id: gid, name: g.name, kind: g.kind === 'saving' ? 'saving' : 'expense', order: gi });
      (g.categories || []).forEach(function (c, ci) {
        cats.push({
          id: c.id || U.slug(c.name), groupId: gid, name: c.name, kind: g.kind === 'saving' ? 'saving' : 'expense',
          limit: g.kind === 'saving' ? 0 : Number(c.limit) || 0, target: g.kind === 'saving' ? Number(c.target) || 0 : 0,
          fixed: !!c.fixed, period: c.period === 'year' ? 'year' : 'month', yearlyLimit: Number(c.yearlyLimit) || 0,
          excelName: c.excelName || '', note: c.note || '', archived: false, order: ci
        });
      });
    });
    (seed.archived || []).forEach(function (a) {
      if (!a.name) return;
      var sav = groups.filter(function (g) { return g.kind === 'saving'; })[0] || groups[groups.length - 1];
      cats.push({ id: U.slug(a.name), groupId: sav.id, name: a.name, kind: sav.kind, limit: 0, target: 0, fixed: false, period: 'month', yearlyLimit: 0, excelName: a.name, note: a.note || '', archived: true, order: 99 });
    });
    return {
      version: 1, currency: seed.currency || 'CAD', cutOver: seed.cutOver || '', statusRule: 'green = at or under, amber = over by $10 or less, red = over by more than $10',
      settings: seed.settings || {}, groups: groups, categories: cats, trips: [], rules: [],
      bigExpenses: (seed.bigExpenses || []).map(function (b) { return { id: U.uid(), name: b.name, amount: Number(b.amount) || 0, repeats: b.repeats || 'once', year: b.year || null, due: b.due || '', note: b.note || '' }; }),
      createdAt: new Date().toISOString()
    };
  }

  function catMap(cfg) { var m = {}; cfg.categories.forEach(function (c) { m[c.id] = c; }); SPECIAL.forEach(function (s) { m[s.id] = { id: s.id, name: s.name, kind: s.type, special: true }; }); return m; }
  function groupsWithCats(cfg, includeArchived) {
    return cfg.groups.slice().sort(function (a, b) { return a.order - b.order; }).map(function (g) {
      return { group: g, cats: cfg.categories.filter(function (c) { return c.groupId === g.id && (includeArchived || !c.archived); }).sort(function (a, b) { return a.order - b.order; }) };
    });
  }
  /* Type of a transaction from the chosen category id. */
  function typeFor(cfg, catId) {
    var s = SPECIAL.filter(function (x) { return x.id === catId; })[0];
    if (s) return s.type;
    var c = catMap(cfg)[catId];
    return c && c.kind === 'saving' ? 'saving' : 'expense';
  }

  /* Status uses the sheet's rule. */
  function status(spent, limit) {
    var over = U.round2(spent - limit);
    if (over > 10) return { level: 'red', over: over, text: U.money(over) + ' over' };
    if (over > 0) return { level: 'amber', over: over, text: U.money(over) + ' over' };
    if (limit === 0) return { level: 'ok', over: over, text: spent === 0 ? 'None this month' : 'Covered' };
    return { level: 'ok', over: over, text: U.money(limit - spent) + ' left' };
  }

  /* What a line counts for in spending. Normally its amount; when you paid for a group it is only your share (the bank amount stays on the line). */
  function counted(t) { return t.type === 'expense' && t.share !== undefined && t.share !== null && t.amount > 0 && t.share > 0 && t.share < t.amount ? t.share : t.amount; }

  /* Month summary for Home and Transactions. */
  function month(cfg, txs, ymStr, todayStr) {
    var cm = catMap(cfg), year = ymStr.slice(0, 4);
    var p = ymStr.split('-'), dim = U.daysInMonth(+p[0], +p[1]);
    var cur = U.ym(todayStr);
    var pace = ymStr < cur ? 1 : (ymStr > cur ? 0 : (+todayStr.slice(8, 10)) / dim);
    var by = {}, savedBy = {}, income = 0, other = 0, spentAll = 0, saved = 0, needsTag = 0, count = 0;
    var yearTravel = {}, trips = {}, funded = fundIds(cfg), fromFunds = 0;
    txs.forEach(function (t) {
      if (t.type === 'expense' && t.fundId && funded[t.fundId]) { if (t.date.slice(0, 7) === ymStr) { count++; if (t.needsTag) needsTag++; fromFunds += t.amount; } return; }   // paid from money set aside: not this month's spending
      if (t.date.slice(0, 4) === year && t.type === 'expense' && cm[t.categoryId] && cm[t.categoryId].period === 'year') {
        if (t.date <= (ymStr + '-31')) { yearTravel[t.categoryId] = (yearTravel[t.categoryId] || 0) + counted(t); if (t.tripId) trips[t.tripId] = (trips[t.tripId] || 0) + counted(t); }
      }
      if (t.date.slice(0, 7) !== ymStr) return;
      count++;
      if (t.needsTag) needsTag++;
      if (t.type === 'expense') { by[t.categoryId] = (by[t.categoryId] || 0) + counted(t); spentAll += counted(t); }
      else if (t.type === 'saving') { savedBy[t.categoryId] = (savedBy[t.categoryId] || 0) + t.amount; saved += t.amount; }
      else if (t.type === 'income') income += t.amount;
      else other += Math.abs(t.amount);
    });
    var groups = [], bills = [], monthlyLimit = 0, monthlySpent = 0, attention = [], savingRows = [], yearly = [];
    groupsWithCats(cfg).forEach(function (gc) {
      if (gc.group.kind === 'saving') {
        gc.cats.forEach(function (c) { savingRows.push({ cat: c, saved: U.round2(savedBy[c.id] || 0), target: c.target }); });
        return;
      }
      var rows = [];
      gc.cats.forEach(function (c) {
        var spent = U.round2(by[c.id] || 0);
        if (c.period === 'year') {
          var ys = U.round2(yearTravel[c.id] || 0), yl = c.yearlyLimit || c.limit * 12;
          var yearPace = ymStr < cur ? (+ymStr.slice(5) / 12) : (ymStr > cur ? 0 : dayOfYear(todayStr) / daysInYear(+year));
          yearly.push({ cat: c, spent: ys, limit: yl, monthSpent: spent, pace: Math.min(1, yearPace), st: status(ys, yl) });
          return;
        }
        monthlyLimit += c.limit; monthlySpent += spent;
        if (c.fixed) { bills.push({ cat: c, spent: spent, paid: spent > 0 }); return; }
        var st = status(spent, c.limit);
        var row = { cat: c, spent: spent, limit: c.limit, pct: c.limit ? Math.min(1, spent / c.limit) : (spent > 0 ? 1 : 0), pace: pace, st: st, ahead: c.limit > 0 && spent > c.limit * pace + 0.005 && pace < 1 };
        rows.push(row);
        var sev = st.level === 'red' ? 3e6 + st.over : st.level === 'amber' ? 2e6 + st.over : (row.ahead ? 1e6 + (spent - c.limit * pace) / (c.limit || 1) * 1000 : 0);
        if (sev > 0) attention.push({ row: row, sev: sev });
      });
      if (rows.length) {
        var gs = rows.reduce(function (a, r) { return a + r.spent; }, 0), gl = rows.reduce(function (a, r) { return a + r.limit; }, 0);
        var worst = rows.some(function (r) { return r.st.level === 'red'; }) ? 'red' : rows.some(function (r) { return r.st.level === 'amber'; }) ? 'amber' : 'ok';
        groups.push({ group: gc.group, rows: rows, spent: U.round2(gs), limit: gl, level: worst });
      }
    });
    attention.sort(function (a, b) { return b.sev - a.sev; });
    var tripRows = (cfg.trips || []).filter(function (t) { return t.start.slice(0, 4) === year; }).map(function (t) { return { trip: t, spent: U.round2(trips[t.id] || 0) }; });
    return {
      ym: ymStr, pace: pace, groups: groups, bills: bills, yearly: yearly, trips: tripRows, saving: savingRows,
      attention: attention.slice(0, 3).map(function (a) { return a.row; }),
      left: U.round2(monthlyLimit - monthlySpent), limit: monthlyLimit, spent: U.round2(spentAll), saved: U.round2(saved), fromFunds: U.round2(fromFunds),
      savingTarget: savingRows.reduce(function (a, r) { return a + r.target; }, 0), income: U.round2(income), other: U.round2(other), needsTag: needsTag, count: count
    };
  }
  /* Ids of big-expense funds that exist. A payment to a deleted fund counts as ordinary spending again. */
  function fundIds(cfg) { var o = {}; (cfg.bigExpenses || []).forEach(function (f) { o[f.id] = 1; }); return o; }
  function dayOfYear(d) { var p = d.split('-'); return Math.round((new Date(+p[0], +p[1] - 1, +p[2]) - new Date(+p[0], 0, 1)) / 864e5) + 1; }
  function daysInYear(y) { return (new Date(y, 1, 29).getMonth() === 1) ? 366 : 365; }

  /* Year to date by category, for Insights. */
  function ytd(cfg, txs, year, todayStr) {
    var cm = catMap(cfg), ty = todayStr.slice(0, 4);
    var monthsGone = year < ty ? 12 : (year > ty ? 0 : (+todayStr.slice(5, 7) - 1) + (+todayStr.slice(8, 10)) / U.daysInMonth(+ty, +todayStr.slice(5, 7)));
    var lastMonth = year < ty ? 12 : (year > ty ? 0 : +todayStr.slice(5, 7));
    var fullMonths = year < ty ? 12 : Math.max(1, lastMonth - 1);
    var yearShare = year < ty ? 1 : (year > ty ? 0 : dayOfYear(todayStr) / daysInYear(+year));
    var per = {}, funded = fundIds(cfg), fromFunds = 0;
    txs.forEach(function (t) {
      if (t.type !== 'expense' || t.date.slice(0, 4) !== String(year)) return;
      if (t.fundId && funded[t.fundId]) { fromFunds += t.amount; return; }
      var m = +t.date.slice(5, 7) - 1, key = t.needsTag || !t.categoryId ? '__none' : t.categoryId;
      var arr = per[key] || (per[key] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      arr[m] += counted(t);
    });
    var groups = [], cats = [], totS = 0, totB = 0, fullSum = 0;
    groupsWithCats(cfg, true).forEach(function (gc) {
      if (gc.group.kind === 'saving') return;
      var rows = [];
      gc.cats.forEach(function (c) {
        var months = (per[c.id] || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).slice(0, Math.max(lastMonth, 1)).map(U.round2);
        var spent = U.round2(months.reduce(function (a, b) { return a + b; }, 0));
        if (c.archived && spent === 0) return;
        var budget = c.period === 'year' ? U.round2((c.yearlyLimit || c.limit * 12) * yearShare) : U.round2(c.limit * monthsGone);
        var full = months.slice(0, fullMonths).reduce(function (a, b) { return a + b; }, 0);
        fullSum += full;
        var r = { cat: c, months: months, spent: spent, budget: budget, avg: U.round2(full / fullMonths), st: status(spent, budget), group: gc.group };
        rows.push(r); cats.push(r); totS += spent; totB += budget;
      });
      if (rows.length) {
        var gs = U.round2(rows.reduce(function (a, r) { return a + r.spent; }, 0)), gb = U.round2(rows.reduce(function (a, r) { return a + r.budget; }, 0));
        groups.push({ group: gc.group, rows: rows, spent: gs, budget: gb, st: status(gs, gb) });
      }
    });
    // spending in categories that no longer exist (or uncategorized) is still shown, never dropped
    var known = {}; cats.forEach(function (r) { known[r.cat.id] = 1; });
    Object.keys(per).forEach(function (id) {
      if (known[id]) return;
      var months = per[id].slice(0, Math.max(lastMonth, 1)).map(U.round2), spent = U.round2(months.reduce(function (a, b) { return a + b; }, 0));
      var c = id === '__none' ? { id: '__none', name: 'Needs a category', limit: 0 } : (cm[id] || { id: id, name: 'Unknown category', limit: 0 });
      var r = { cat: c, months: months, spent: spent, budget: 0, avg: U.round2(months.slice(0, fullMonths).reduce(function (a, b) { return a + b; }, 0) / fullMonths), st: status(spent, 0), group: { name: 'Other' } };
      cats.push(r); totS += spent;
      var g = groups.filter(function (x) { return x.group.name === 'Other'; })[0];
      if (!g) { g = { group: { name: 'Other' }, rows: [], spent: 0, budget: 0 }; groups.push(g); }
      g.rows.push(r); g.spent = U.round2(g.spent + spent); g.st = status(g.spent, 0);
    });
    return { year: year, lastMonth: lastMonth, fullMonths: fullMonths, monthsGone: monthsGone, yearShare: yearShare, groups: groups, cats: cats, spent: U.round2(totS), budget: U.round2(totB), avg: U.round2(fullSum / fullMonths), fromFunds: U.round2(fromFunds) };
  }

  /* Normalised merchant text for "always tag" rules. */
  function merchantKey(desc) {
    return String(desc || '').toUpperCase().replace(/[^A-Z0-9& ]+/g, ' ').replace(/\b\d{3,}\b/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /* Brings any saved config up to the current shape. Only ADDS missing fields with defaults; never changes existing values,
     so a backup made by a newer version still restores in an older one (which ignores the new fields). */
  var SCHEMA = 2;
  function migrate(cfg) {
    if (!cfg) return cfg;
    if (!Array.isArray(cfg.recurring)) cfg.recurring = [];          // v12 feature 1
    if (!Array.isArray(cfg.recurringIgnore)) cfg.recurringIgnore = [];
    if (!Array.isArray(cfg.healthIgnore)) cfg.healthIgnore = [];
    if (!cfg.monthsReviewed || typeof cfg.monthsReviewed !== 'object') cfg.monthsReviewed = {};   // v16: months you marked reviewed                     // v13: data-health items you chose to ignore
    if (Array.isArray(cfg.bigExpenses) && typeof Funds !== 'undefined') {           // v12 feature 3: due month, start month, category, match text
      var nowYm = U.today().slice(0, 7);
      cfg.bigExpenses.forEach(function (f) { Funds.migrateOne(f, nowYm); });
    }
    if (Array.isArray(cfg.accounts) && typeof Accounts !== 'undefined') cfg.accounts.forEach(Accounts.migrateOne);   // v12 feature 4: type, balances, currency
    cfg.schema = Math.max(cfg.schema || 1, SCHEMA);
    return cfg;
  }

  /* The rule rows the importer uses: personal then general, in the standard 8 columns, without rules turned off in the app.
     Each set keeps its own header, so a file with its columns in another order still lines up. */
  var RULE_COLS = ['rule_id', 'kind', 'pattern', 'match_type', 'value', 'priority', 'apply', 'notes', 'min_amount', 'max_amount', 'direction'];   // last three optional (v12)
  function ruleRows(cfg) {
    var sets = cfg.ruleSets || {}, off = cfg.ruleOff || {}, out = [RULE_COLS.slice()];
    ['personal', 'general'].forEach(function (k) {
      var rows = sets[k] && sets[k].rows; if (!rows || !rows.length) return;
      var hd = rows[0].map(function (x) { return String(x).trim().toLowerCase(); }), ix = RULE_COLS.map(function (c) { return hd.indexOf(c); });
      rows.slice(1).forEach(function (r) {
        var row = ix.map(function (i) { return i >= 0 ? (r[i] || '') : ''; });
        if (row[2] && !off[row[0]]) out.push(row);
      });
    });
    return out;
  }

  /* Change a transaction's category and keep its amount the right way round.
     Bank lines keep their direction: money out is spending (positive), money in on a spending category is a refund (negative). */
  function retype(cfg, t, catId) {
    var n = JSON.parse(JSON.stringify(t));
    var type = typeFor(cfg, catId);
    n.categoryId = catId; n.type = type;
    if (t.direction) {
      var mag = Math.abs(t.amount), raw = t.direction === 'out' ? -mag : mag;
      n.amount = type === 'income' ? raw : (type === 'transfer' || type === 'exclude') ? mag : -raw;
    }
    if (type !== 'expense') delete n.fundId;   // only spending can be paid from a big-expense fund
    return n;
  }

  /* Money leaving one of your accounts and the same amount arriving in another within 3 days is one transfer.
     Both lines are linked and kept flagged for review; a line with no category yet is suggested as a transfer. */
  function linkTransfers(cfg, txs) {
    var names = {}; (cfg.accounts || []).forEach(function (a) { names[a.id] = a.name; });
    var open = txs.filter(function (t) { return t.accountId && t.direction && !t.linkId && (t.type === 'transfer' || !t.categoryId || t.needsTag); });
    var outs = open.filter(function (t) { return t.direction === 'out'; }), ins = open.filter(function (t) { return t.direction === 'in'; });
    var changed = {}, used = {};
    function days(a, b) { return Math.abs((new Date(a) - new Date(b)) / 864e5); }
    outs.sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (o) {
      var best = null;
      ins.forEach(function (i) {
        if (used[i.id] || i.accountId === o.accountId || Math.abs(Math.abs(i.amount) - Math.abs(o.amount)) > 0.005) return;
        var d = days(i.date, o.date); if (d > 5) return;   // a pre-authorized payment can take a few business days to arrive
        if (!best || d < best.d) best = { t: i, d: d };
      });
      if (!best) return;
      var i = best.t; used[i.id] = true;
      var link = U.uid();
      [[o, i], [i, o]].forEach(function (p) {
        var n = changed[p[0].id] || JSON.parse(JSON.stringify(p[0]));
        n.linkId = link;
        n.flags = (n.flags || []).concat(['matches ' + (p[1].direction === 'in' ? '+' : '−') + U.money(Math.abs(p[1].amount), { cents: true }) + ' in ' + (names[p[1].accountId] || 'another account') + ' on ' + U.shortDate(p[1].date)]);
        if (!n.categoryId) { n = retype(cfg, n, '_transfer'); n.reviewReason = 'Looks like the other side of a transfer; check it'; }
        n.needsTag = true;
        changed[n.id] = n;
      });
    });
    return Object.keys(changed).map(function (k) { return changed[k]; });
  }

  return { migrate: migrate, SCHEMA: SCHEMA, RULE_COLS: RULE_COLS, ruleRows: ruleRows, linkTransfers: linkTransfers, retype: retype, SPECIAL: SPECIAL, fromSeed: fromSeed, catMap: catMap, groupsWithCats: groupsWithCats, typeFor: typeFor, status: status, counted: counted, month: month, ytd: ytd, fundIds: fundIds, merchantKey: merchantKey };
})();
