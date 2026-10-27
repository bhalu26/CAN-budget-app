/* Transactions: a month (or more) at a glance, by account, with on-the-fly and bulk category fixes. */
var Tx = (function () {
  'use strict';
  var h = U.h;
  var st = { q: '', f: 'all', acct: 'all', scope: 'month', cat: null, trip: null, editing: null, draft: '', always: false, sel: {}, bulkCat: '', bulkTrip: '' };

  /* Links can open Transactions already filtered: f (filter), acct, cat (category id), trip (trip id), m (YYYY-MM), scope (month/year/all), q (search). */
  function setFilterFromHash(q) {
    q = q || {};
    st.f = q.f || 'all';
    if (q.acct) st.acct = q.acct;
    st.cat = q.cat || null;
    st.trip = q.trip || null;
    if (/^\d{4}-\d{2}$/.test(q.m || '')) App.month = q.m;
    st.scope = q.scope === 'year' || q.scope === 'all' || q.scope === 'month' ? q.scope : (st.f === 'review' ? 'all' : 'month');   // Review shows everything waiting, whatever the month
    if (q.q !== undefined) st.q = q.q; else if (q.cat || q.trip) st.q = '';   // a link to a category or trip shows all of it, not what an old search left
    st.sel = {};
  }

  /* Accounts and other sources, grouped by bank, for the tabs. */
  function sources() {
    var list = (App.cfg.accounts || []).map(function (a) { return { id: a.id, name: a.name, bank: a.bank || 'Other banks', kind: a.kind, numbers: a.numbers || [] }; });
    list.sort(function (a, b) { return a.bank < b.bank ? -1 : a.bank > b.bank ? 1 : (a.name < b.name ? -1 : 1); });
    list.push({ id: '_excel', name: 'Excel history', bank: 'Other' }, { id: '_manual', name: 'Added by hand', bank: 'Other' });
    return list;
  }
  /* Only the sources that have at least one transaction (plus the one currently picked), so the list is not padded with empty accounts. */
  function usedSources(keep) {
    var seen = {}; App.txs.forEach(function (t) { seen[srcOf(t)] = 1; });
    return sources().filter(function (s) { return seen[s.id] || s.id === keep; });
  }
  function srcOf(t) { return t.source === 'excel' ? '_excel' : (t.accountId || '_manual'); }

  function inScope(t, ym) {
    if (st.scope === 'month') return t.date.slice(0, 7) === ym;
    if (st.scope === 'year') return t.date.slice(0, 4) === ym.slice(0, 4);
    return true;
  }

  function render(main) {
    var ym = App.month || U.ym(U.today()), cm = M.catMap(App.cfg);
    var scoped = App.txs.filter(function (t) { return inScope(t, ym); });
    var srcs = sources(), countBy = {}, reviewBy = {};
    scoped.forEach(function (t) { var s = srcOf(t); countBy[s] = (countBy[s] || 0) + 1; if (t.needsTag) reviewBy[s] = (reviewBy[s] || 0) + 1; });
    var acctTx = st.acct === 'all' ? scoped : scoped.filter(function (t) { return srcOf(t) === st.acct; });
    if (st.cat) acctTx = acctTx.filter(function (t) { return t.categoryId === st.cat; });
    if (st.trip) acctTx = acctTx.filter(function (t) { return t.tripId === st.trip; });
    var spent = 0, income = 0, saved = 0, other = 0;
    acctTx.forEach(function (t) { if (t.type === 'expense') spent += M.counted(t); else if (t.type === 'income') income += t.amount; else if (t.type === 'saving') saved += t.amount; else other += Math.abs(t.amount); });
    var scopeLabel = st.scope === 'month' ? U.monthLabel(ym) : st.scope === 'year' ? 'All of ' + ym.slice(0, 4) : 'All time';

    // Header: title, period, add
    main.appendChild(h('header', { class: 'row between' }, h('h1', null, st.f === 'review' ? 'Review' : 'Transactions'),
      h('div', { class: 'row' },
        st.scope !== 'all' ? h('button', { type: 'button', class: 'btn icon', 'aria-label': 'Previous ' + (st.scope === 'year' ? 'year' : 'month'), onclick: function () { App.month = U.shiftMonth(ym, st.scope === 'year' ? -12 : -1); st.sel = {}; App.render(); } }, '‹') : null,
        h('span', { class: 'strong', style: { minWidth: '130px', textAlign: 'center', fontSize: '16px' } }, scopeLabel),
        st.scope !== 'all' ? h('button', { type: 'button', class: 'btn icon', 'aria-label': 'Next ' + (st.scope === 'year' ? 'year' : 'month'), onclick: function () { App.month = U.shiftMonth(ym, st.scope === 'year' ? 12 : 1); st.sel = {}; App.render(); } }, '›') : null,
        h('select', { class: 'input', style: { width: 'auto' }, 'aria-label': 'Period', onchange: function (e) { st.scope = e.target.value; st.sel = {}; App.render(); } },
          [['month', 'Month'], ['year', 'Year'], ['all', 'All time']].map(function (o) { var op = h('option', { value: o[0] }, o[1]); if (st.scope === o[0]) op.selected = true; return op; })),
        App.readOnly ? null : h('button', { type: 'button', class: 'btn primary', onclick: function () { UI.expensePanel(null, App.render); } }, '+ Add'))));

    // Account filter: a drop-down that lists only accounts that have transactions (with how many this period)
    if (st.acct !== 'all' && !srcs.some(function (s) { return s.id === st.acct; })) st.acct = 'all';
    var used = usedSources(st.acct);
    var aSel = h('select', { id: 'acct-filter', class: 'input', style: { width: 'auto', minWidth: '240px' }, onchange: function (e) { st.acct = e.target.value; st.sel = {}; App.render(); } },
      h('option', { value: 'all' }, 'All accounts (' + scoped.length + (scoped.some(function (t) { return t.needsTag; }) ? ', ' + scoped.filter(function (t) { return t.needsTag; }).length + ' to review' : '') + ')'));
    var lastBank = null, grp = null;
    used.forEach(function (s) {
      if (s.bank !== lastBank) { grp = h('optgroup', { label: s.bank }); aSel.appendChild(grp); lastBank = s.bank; }
      grp.appendChild(h('option', { value: s.id }, s.name + (s.kind === 'card' ? ' (card)' : '') + ' · ' + (countBy[s.id] || 0) + (reviewBy[s.id] ? ', ' + reviewBy[s.id] + ' to review' : '')));
    });
    aSel.value = st.acct;
    main.appendChild(h('div', { class: 'field', style: { maxWidth: '420px' } }, h('label', { for: 'acct-filter' }, 'Account'), aSel));
    if (st.cat) main.appendChild(h('div', { class: 'row' }, h('span', { class: 'filter-chip' }, 'Category: ', h('strong', null, UI.catName(st.cat)),
      h('button', { type: 'button', class: 'btn icon small-icon', 'aria-label': 'Show all categories', title: 'Show all categories', onclick: function () { st.cat = null; App.render(); } }, '×'))));
    if (st.trip) { var ft = Trips.byId(App.cfg, st.trip); main.appendChild(h('div', { class: 'row' }, h('span', { class: 'filter-chip' }, 'Trip: ', h('strong', null, ft ? ft.name : 'a removed trip'),
      h('button', { type: 'button', class: 'btn icon small-icon', 'aria-label': 'Show all trips', title: 'Show all trips', onclick: function () { st.trip = null; App.render(); } }, '×')))); }
    if (st.acct !== 'all' && !srcs.some(function (s) { return s.id === st.acct; })) st.acct = 'all';

    main.appendChild(h('div', { class: 'grid-tiles' },
      tile('Spent', U.money(spent, { cents: true })), tile('Income', U.money(income, { cents: true })), tile('Saved', U.money(saved, { cents: true }), 'accent'), tile('Transfers and not counted', U.money(other, { cents: true }), 'muted')));

    var q = h('input', { id: 'q', class: 'input', value: st.q, placeholder: 'Merchant, category, note or amount', oninput: function (e) { st.q = e.target.value; drawList(); } });
    var reviewN = acctTx.filter(function (t) { return t.needsTag; }).length;
    var recKeys = {}; (App.cfg.recurring || []).forEach(function (it) { if (it.active !== false) recKeys[it.key + '|' + it.kind] = it.name; });
    var owedOpen = Group.open(App.txs), owedIds = {}; owedOpen.forEach(function (x) { owedIds[x.t.id] = 1; });
    var filters = [['all', 'All'], ['spend', 'Spending'], ['in', 'Income and saving'], ['review', 'Needs review · ' + reviewN], ['other', 'Transfers and not counted']].concat(owedOpen.length || st.f === 'owed' ? [['owed', 'Owed to you · ' + owedOpen.length]] : []);
    main.appendChild(h('div', { class: 'row', style: { alignItems: 'flex-end', gap: '12px' } },
      h('div', { class: 'field', style: { flex: '1 1 240px' } }, h('label', { for: 'q' }, 'Search'), q),
      h('div', { class: 'row', role: 'group', 'aria-label': 'Show' }, filters.map(function (f) {
        return h('button', { type: 'button', class: 'chip', 'aria-pressed': st.f === f[0] ? 'true' : 'false', onclick: function () { st.f = f[0]; st.sel = {}; App.render(); } }, f[1]);
      }))));

    var bulk = h('div');
    var count = h('div', { class: 'row between' });
    var list = h('div', { class: 'stack', style: { gap: '16px' } });
    main.appendChild(bulk); main.appendChild(count); main.appendChild(list);

    var shown = [];
    function drawList() {
      U.clear(list); U.clear(count);
      var ql = st.q.trim().toLowerCase();
      shown = acctTx.filter(function (t) {
        if (st.f === 'spend' && t.type !== 'expense') return false;
        if (st.f === 'review' && !t.needsTag) return false;
        if (st.f === 'owed' && !owedIds[t.id]) return false;
        if (st.f === 'other' && !(t.type === 'transfer' || t.type === 'exclude' || t.type === 'pending')) return false;
        if (st.f === 'in' && !(t.type === 'income' || t.type === 'saving')) return false;
        if (ql) {
          var hay = [t.desc, t.note, UI.acctName(t), cm[t.categoryId] ? cm[t.categoryId].name : 'needs a category', t.amount.toFixed(2), t.reviewReason].join(' ').toLowerCase();
          if (hay.indexOf(ql) < 0) return false;
        }
        return true;
      }).sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        var ca = a.createdAt || '', cb = b.createdAt || '';
        if (ca !== cb) return ca < cb ? 1 : -1;
        return (a.line || a.excelRow || 0) - (b.line || b.excelRow || 0) || (a.id < b.id ? -1 : 1);
      });
      var selN = shown.filter(function (t) { return st.sel[t.id]; }).length;
      count.appendChild(h('span', { class: 'muted', role: 'status' }, shown.length + ' of ' + acctTx.length + ' transactions · newest first'));
      count.appendChild(h('span', { class: 'row' },
        shown.length && !App.readOnly ? h('button', { type: 'button', class: 'btn link', onclick: function () { var all = selN < shown.length; shown.forEach(function (t) { if (all) st.sel[t.id] = true; else delete st.sel[t.id]; }); drawBulk(); drawList(); } }, selN < shown.length ? 'Select all ' + shown.length : 'Clear selection') : null,
        shown.length ? h('button', { type: 'button', class: 'btn link', onclick: function () { exportCsv(shown, cm, scopeLabel); } }, 'Export these as CSV') : null));
      if (!shown.length) {
        list.appendChild(h('div', { class: 'card pad row between' }, h('span', null, acctTx.length ? 'Nothing matches here. Try another word or show all.' : (st.f === 'review' ? 'Nothing waiting for review here.' : 'No transactions in this period yet.')),
          acctTx.length ? h('button', { type: 'button', class: 'btn', onclick: function () { st.q = ''; st.f = 'all'; App.render(); } }, 'Show all') :
            (App.readOnly ? null : h('a', { class: 'btn primary', href: '#/import' }, 'Import a bank file'))));
        return;
      }
      var byDay = {};
      shown.forEach(function (t) { (byDay[t.date] = byDay[t.date] || []).push(t); });
      var days = Object.keys(byDay).sort().reverse();
      var limit = st.showAll ? days.length : Math.min(days.length, 60);
      days.slice(0, limit).forEach(function (d) {
        var day = byDay[d], tot = day.filter(function (t) { return t.type === 'expense'; }).reduce(function (a, t) { return a + M.counted(t); }, 0);
        var card = h('div', { class: 'card' });
        day.forEach(function (t) { card.appendChild(row(t, cm)); });
        list.appendChild(h('section', { class: 'stack-sm' }, h('div', { class: 'day-head' }, h('span', null, U.dayLabel(d) + (st.scope !== 'month' ? ' ' + d.slice(0, 4) : '')), h('span', null, tot ? 'Spent ' + U.money(tot, { cents: true }) : '')), card));
      });
      if (limit < days.length) list.appendChild(h('button', { type: 'button', class: 'btn', onclick: function () { st.showAll = true; drawList(); } }, 'Show ' + (days.length - limit) + ' more days'));
    }

    function drawBulk() {
      U.clear(bulk);
      var ids = Object.keys(st.sel).filter(function (id) { return st.sel[id]; });
      if (!ids.length) return;
      var pick = UI.categorySelect('bulkcat', st.bulkCat, function (e) { st.bulkCat = e.target.value; }, { placeholder: 'Choose a category…' });
      var anyReview = App.txs.some(function (t) { return st.sel[t.id] && t.needsTag && t.categoryId; });
      bulk.appendChild(h('div', { class: 'bulk-bar', role: 'region', 'aria-label': 'Selected transactions' },
        h('strong', null, ids.length + ' selected'),
        h('div', { style: { flex: '1 1 220px' } }, pick),
        h('button', { type: 'button', class: 'btn primary', onclick: function () { if (!st.bulkCat) { UI.toast('Choose a category for the selected transactions.'); return; } bulkApply(ids, st.bulkCat); } }, 'Set category'),
        anyReview ? h('button', { type: 'button', class: 'btn', onclick: function () { bulkApply(ids, null); } }, 'Looks right (keep categories)') : null,
        (App.cfg.trips || []).length ? tripPick(ids) : null,
        h('button', { type: 'button', class: 'btn link', onclick: function () { st.sel = {}; drawBulk(); drawList(); } }, 'Clear')));
    }

    /* Put the selected lines on a trip (or take them off): bookings paid before the trip go on it too. */
    function tripPick(ids) {
      var trips = (App.cfg.trips || []).slice().sort(function (a, b) { return a.start < b.start ? 1 : -1; });
      var sel = h('select', { id: 'bulktrip', class: 'input', 'aria-label': 'Trip for the selected transactions', style: { width: 'auto' }, onchange: function (e) { st.bulkTrip = e.target.value; } },
        h('option', { value: '' }, 'Choose a trip…'), trips.map(function (t) { return h('option', { value: t.id }, t.name + ' (' + U.shortDate(t.start) + ' ' + t.start.slice(0, 4) + ')'); }), h('option', { value: '_none' }, 'Take off their trip'));
      sel.value = st.bulkTrip;
      return h('div', { class: 'row', style: { gap: '8px' } }, sel, h('button', { type: 'button', class: 'btn', onclick: function () {
        if (!st.bulkTrip) { UI.toast('Choose a trip for the selected transactions.'); return; }
        var tripId = st.bulkTrip === '_none' ? null : st.bulkTrip, trip = tripId && Trips.byId(App.cfg, tripId);
        var befores = [], changed = [], skipped = {};
        App.txs.forEach(function (t) { if (!st.sel[t.id]) return; var r = Trips.tag(App.cfg, t, tripId); if (r.t) { befores.push(JSON.parse(JSON.stringify(t))); changed.push(r.t); } else skipped[r.skip] = (skipped[r.skip] || 0) + 1; });
        var why = Object.keys(skipped).map(function (k) { return skipped[k] + ' ' + k; }).join(', ');
        if (!changed.length) { UI.toast('Nothing changed' + (why ? ': ' + why + '.' : '.')); return; }
        var stamp = new Date().toISOString(); changed.forEach(function (t) { t.updatedAt = stamp; });
        Hist.why('Trip');
        DB.putTx(changed).then(UI.reload).then(function () {
          st.sel = {}; st.bulkTrip = ''; st.flash = { at: Date.now(), ids: changed.reduce(function (a, t) { a[t.id] = 1; return a; }, {}) }; App.render();
          UI.toast((trip ? changed.length + ' put on ' + trip.name : changed.length + ' taken off their trip') + (why ? ' (skipped: ' + why + ')' : '') + '.', function () {
            Hist.why('Undo'); DB.putTx(befores).then(UI.reload).then(function () { App.render(); UI.toast('Undone.'); }); });
        });
      } }, 'Set trip'));
    }

    function row(t, cm) {
      var c = cm[t.categoryId], dim = t.type === 'transfer' || t.type === 'exclude' || t.type === 'pending';
      var label = !c ? (t.type === 'pending' ? 'Money in: needs a category' : 'Needs a category') : (t.needsTag ? c.name + '?' : c.name);
      var meta = [t.source === 'excel' ? 'Excel row ' + t.excelRow : (UI.acctName(t) || 'Added by hand')];
      if (t.tripId) { var tr = (App.cfg.trips || []).filter(function (x) { return x.id === t.tripId; })[0]; if (tr) meta.push(tr.name); }
      if (t.fundId) { var fd = (App.cfg.bigExpenses || []).filter(function (x) { return x.id === t.fundId; })[0]; if (fd) meta.push('Paid from big expense: ' + fd.name); }
      if (Group.isGroup(t)) { var gb = Group.balance(t, App.txs); meta.push('Your share ' + U.money(t.share, { cents: true }) + ' of ' + U.money(t.amount, { cents: true }) + (gb.left ? ' · ' + U.money(gb.left, { cents: true }) + ' still owed to you' : ' · all paid back ✓')); }
      if (!t.notRecurring && recKeys[M.merchantKey(t.desc || '') + '|' + Recurring.kindOf(t)]) meta.push('Recurring: ' + recKeys[M.merchantKey(t.desc || '') + '|' + Recurring.kindOf(t)]);
      if (t.repaysId) { var rb = App.txs.filter(function (x) { return x.id === t.repaysId; })[0]; meta.push('Repays ' + (rb ? rb.desc || 'a group bill' : 'a deleted bill') + ' (not income)'); }
      if (t.note) meta.push(t.note);
      if (t.needsTag && t.reviewReason) meta.push(t.reviewReason);
      if ((t.history || []).length) meta.push('edited ' + U.shortDate(t.history[t.history.length - 1].at.slice(0, 10)));
      var conf = t.source === 'csv' && t.conf && c ? UI.confLabel(t.conf, t.tagWhy) : null;
      (t.flags || []).forEach(function (f) { meta.push(f); });
      var editing = st.editing === t.id;
      var flash = st.flash && Date.now() - st.flash.at < 600 && st.flash.ids[t.id];
      var el = h('div', { class: 'tx' + (dim ? ' dim' : '') + (st.sel[t.id] ? ' picked' : '') + (flash ? ' flash' : '') },
        App.readOnly ? null : h('input', { type: 'checkbox', class: 'pick', checked: !!st.sel[t.id], 'aria-label': 'Select ' + (t.desc || 'transaction'), onchange: function (e) { if (e.target.checked) st.sel[t.id] = true; else delete st.sel[t.id]; el.classList.toggle('picked', e.target.checked); drawBulk(); } }),
        h('div', { class: 'who' },
          h('button', { type: 'button', class: 'btn link name', style: { padding: 0, minHeight: '24px', textAlign: 'left', color: 'var(--text)', textDecoration: 'none', fontWeight: '600', justifyContent: 'flex-start' }, onclick: function () { UI.expensePanel(t, App.render); } },
            t.desc || (c ? c.name : 'Transaction')),
          h('span', { class: 'small muted' }, meta.join(' · '), conf ? ' · ' : null, conf)),
        App.readOnly ? h('span', { class: 'tag ro' + (t.needsTag || !c ? ' review' : (t.type === 'income' || t.type === 'saving' ? ' money-in' : (dim ? ' muted-tag' : ''))) }, label) :
        h('button', { type: 'button', class: 'tag' + (t.needsTag || !c ? ' review' : (t.type === 'income' || t.type === 'saving' ? ' money-in' : (dim ? ' muted-tag' : ''))), 'aria-expanded': editing ? 'true' : 'false',
          'aria-label': 'Change category for ' + (t.desc || 'this transaction') + ', now ' + label,
          onclick: function () { st.editing = editing ? null : t.id; st.editAt = Date.now(); st.draft = t.categoryId || ''; st.always = false; App.render(); } }, label + ' ▾'),
        h('span', { class: 'amt' + (t.type === 'income' || (t.type === 'expense' && t.amount < 0) ? ' ok' : '') }, (t.type === 'income' || (t.type === 'expense' && t.amount < 0) || (t.direction === 'in' && t.type !== 'expense') ? '+' : '') + U.money(Math.abs(t.amount), { cents: true })));
      if (editing && !App.readOnly) el.appendChild(editor(t));
      return el;
    }
    drawBulk();
    drawList();
  }

  function tile(label, value, cls) {
    return h('div', { class: 'card tile' }, h('div', { class: 'small muted' }, label), h('div', { class: 'big ' + (cls || '') }, value));
  }

  function editor(t) {
    var key = M.merchantKey(t.desc);
    var sameCount = key ? App.txs.filter(function (o) { return o.id !== t.id && M.merchantKey(o.desc) === key; }).length : 0;
    return h('div', { class: 'editor' + (U.fresh(st.editAt) ? ' enter' : '') },
      h('div', { class: 'field' }, h('label', { for: 'cat-' + t.id }, 'Category'), UI.categorySelect('cat-' + t.id, st.draft, function (e) { st.draft = e.target.value; }, { placeholder: 'Choose…' })),
      key ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.always, onchange: function (e) { st.always = e.target.checked; } }),
        h('span', null, 'Always tag "' + t.desc + '" like this' + (sameCount ? ' (' + sameCount + ' more)' : ''))) : null,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn primary', onclick: function () { save(t, key); } }, 'Save'),
        t.needsTag && t.categoryId ? h('button', { type: 'button', class: 'btn', onclick: function () { st.draft = t.categoryId; save(t, key); } }, 'Looks right') : null,
        h('button', { type: 'button', class: 'btn', onclick: function () { st.editing = null; App.render(); } }, 'Cancel')));
  }

  function commit(after, before, msg, rulesBefore, rulesChanged) {
    st.flash = { at: Date.now(), ids: {} }; after.forEach(function (t) { st.flash.ids[t.id] = 1; });
    Hist.why(after.length > 1 ? 'Bulk change' : 'Edited');
    DB.putTx(after).then(function () { return rulesChanged ? UI.saveCfg() : null; }).then(UI.reload).then(function () {
      App.render();
      UI.toast(msg, function () {
        if (rulesChanged) App.cfg.rules = rulesBefore;
        Hist.why('Undo'); DB.putTx(before).then(UI.saveCfg).then(UI.reload).then(App.render);
      });
    });
  }

  function save(t, key) {
    if (!st.draft) { UI.toast('Choose a category first.'); return; }
    var targets = [t];
    if (st.always && key) targets = targets.concat(App.txs.filter(function (o) { return o.id !== t.id && M.merchantKey(o.desc) === key; }));
    var before = targets.map(function (o) { return JSON.parse(JSON.stringify(o)); });
    var cat = st.draft, stamp = new Date().toISOString();
    var after = targets.map(function (o) { var n = M.retype(App.cfg, o, cat); n.needsTag = false; n.reviewedAt = stamp; n.updatedAt = stamp; n.conf = 'sure'; n.tagWhy = 'You chose this'; return n; });
    var rulesBefore = (App.cfg.rules || []).slice();
    if (st.always && key) App.cfg.rules = rulesBefore.filter(function (r) { return r.merchant !== key; }).concat([{ merchant: key, categoryId: cat, createdAt: stamp }]);
    var msg = (t.desc || 'Transaction') + ' → ' + UI.catName(cat) + '.' + (st.always && key ? ' Rule saved' + (targets.length > 1 ? '; ' + (targets.length - 1) + ' more updated.' : '.') : '');
    st.editing = null;
    commit(after, before, msg, rulesBefore, st.always && key);
  }

  /* Bulk: set one category for all selected, or keep their categories and clear the review flag. */
  function bulkApply(ids, cat) {
    var targets = App.txs.filter(function (t) { return ids.indexOf(t.id) >= 0; });
    if (!cat) targets = targets.filter(function (t) { return t.categoryId; });
    var before = targets.map(function (o) { return JSON.parse(JSON.stringify(o)); });
    var stamp = new Date().toISOString();
    var after = targets.map(function (o) { var n = cat ? M.retype(App.cfg, o, cat) : JSON.parse(JSON.stringify(o)); n.needsTag = false; n.reviewedAt = stamp; n.updatedAt = stamp; n.conf = 'sure'; n.tagWhy = cat ? 'You chose this' : 'You confirmed this'; return n; });
    st.sel = {}; st.bulkCat = '';
    commit(after, before, cat ? after.length + ' transactions set to ' + UI.catName(cat) + '.' : after.length + ' transactions marked as reviewed.', null, false);
  }

  function exportCsv(list, cm, label) {
    var rows = [['Date', 'Description', 'Account', 'Category', 'Type', 'Amount', 'Needs review', 'Note', 'Source', 'My share']];
    list.forEach(function (t) {
      rows.push([t.date, t.desc || '', t.source === 'excel' ? 'Excel' : (UI.acctName(t) || 'Added by hand'), cm[t.categoryId] ? cm[t.categoryId].name : '', t.type, t.amount.toFixed(2), t.needsTag ? 'yes' : '', t.note || '', t.source || '', M.counted(t) !== t.amount ? M.counted(t).toFixed(2) : '']);
    });
    var text = U.csv(rows);
    U.download('transactions-' + label.replace(/\s+/g, '-').toLowerCase() + '.csv', text, 'text/csv');
    UI.toast('Exported ' + list.length + ' transactions. The file has your real data; keep it private.');
  }

  return { render: render, setFilterFromHash: setFilterFromHash, sources: sources, usedSources: usedSources, srcOf: srcOf };
})();
