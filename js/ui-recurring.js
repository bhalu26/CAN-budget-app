/* Bills & subscriptions: a page under Settings. A summary, what was found in your history (Confirm / Not recurring),
   your recurring items as compact rows (Edit in place, Pause, Delete), and "Add". Every change saves at once and offers Undo. */
var RecurringUI = (function () {
  'use strict';
  var h = U.h;
  var BLANK = { name: '', key: '', amount: '', cadence: 'monthly', date: '', cat: '', kind: 'expense', day2: '' };
  var st = { adding: false, focusAdd: false, form: null, err: '', editing: null, confirmDel: null, filter: 'all', q: '' };
  function blank() { return Object.assign({}, BLANK, { date: U.today() }); }
  function label(c) { return (Recurring.BY_ID[c] || {}).label || c; }
  function amountText(it) { return it.amountMode === 'varies' ? 'about ' + U.money(it.amount, { cents: true }) : U.money(it.amount, { cents: true }); }
  function nextDate(it, today) { var s = Recurring.schedule(it, today, Recurring.addMonths(today, 13)); return s[0] || ''; }
  function days(from, to) { return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000); }
  function inWords(d, today) { var n = days(today, d); return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n < 0 ? Math.abs(n) + ' days ago' : 'in ' + n + ' days'; }
  function isSub(it) { return it.kind === 'expense' && it.categoryId === 'subscriptions'; }
  function perYear(it) { return Recurring.perYear(it.cadence, it.amount); }
  function snapshot() { return { r: JSON.parse(JSON.stringify(App.cfg.recurring)), i: App.cfg.recurringIgnore.slice() }; }
  function save(msg, undo) { return UI.saveCfg().then(function () { App.render(); UI.toast(msg, undo); return autoLog({ force: true }); }); }
  function restore(b) { return function () { App.cfg.recurring = b.r; App.cfg.recurringIgnore = b.i; save('Undone.'); }; }

  /* Other screens call this (a bill's "Make this recurring…", G B, links): go to the page, with the Add form filled in when asked. */
  function open(opts) {
    if (App.readOnly) { UI.toast('This is a read-only copy.'); return; }
    if (opts && opts.add) { st.adding = true; st.focusAdd = true; st.form = Object.assign(blank(), opts.add); st.err = ''; }
    UI.closePanel();
    if (location.hash === '#/bills') App.render(); else location.hash = '#/bills';
  }

  function render(main) {
    if (!st.form) st.form = blank();
    var today = U.today(), items = App.cfg.recurring || [], found = Recurring.detect(App.txs, today, App.cfg.recurringIgnore, items);
    var on = items.filter(function (it) { return it.active !== false && it.kind === 'expense'; });
    var yearly = on.reduce(function (a, it) { return a + perYear(it); }, 0), subs = on.filter(isSub).reduce(function (a, it) { return a + perYear(it); }, 0);
    var soon = items.filter(function (it) { return it.active !== false && it.kind === 'expense'; }).map(function (it) { return { it: it, d: nextDate(it, today) }; }).filter(function (x) { return x.d && days(today, x.d) <= 30; });
    var soonSum = soon.reduce(function (a, x) { return a + x.it.amount; }, 0);

    main.appendChild(h('div', { class: 'row between' }, h('h1', null, 'Bills & subscriptions'),
      h('button', { type: 'button', class: 'btn primary', onclick: function () { st.adding = true; st.focusAdd = true; st.err = ''; App.render(); } }, '+ Add')));
    main.appendChild(Settings.subnav('bills'));
    main.appendChild(h('p', { class: 'muted', style: { margin: 0 } }, 'What repeats: rent, phone, subscriptions, paycheques. Found from your transactions; nothing leaves this computer. Anything not recorded by the end of its month is logged for you (marked "Logged automatically"), and taken out again when the real payment is imported.'));
    if (on.length) main.appendChild(h('div', { class: 'grid-tiles' },
      h('div', { class: 'card tile' }, h('div', { class: 'small muted' }, 'Recurring bills'), h('div', { class: 'big' }, U.money(yearly, { whole: true }) + ' a year'), h('div', { class: 'small muted' }, 'about ' + U.money(yearly / 12, { whole: true }) + ' a month · ' + on.length + ' bill' + (on.length === 1 ? '' : 's'))),
      h('div', { class: 'card tile' }, h('div', { class: 'small muted' }, 'Subscriptions'), h('div', { class: 'big' }, U.money(subs, { whole: true }) + ' a year'), h('div', { class: 'small muted' }, on.filter(isSub).length + ' in the Subscriptions category')),
      h('div', { class: 'card tile' }, h('div', { class: 'small muted' }, 'Due in the next 30 days'), h('div', { class: 'big' }, U.money(soonSum, { whole: true })), h('div', { class: 'small muted' }, soon.length + ' bill' + (soon.length === 1 ? '' : 's'))),
      h('a', { class: 'card tile tile-link', href: '#/insights', onclick: function () { Insights.setView('recurring'); }, 'aria-label': 'What your recurring bills cost over the year, by month. Open Insights.' },
        h('div', { class: 'small muted' }, 'Over the year'), h('div', { class: 'big' }, 'Month by month'), h('div', { class: 'small muted' }, 'paid, changed, late'), h('span', { class: 'tile-go', 'aria-hidden': 'true' }, '›'))));

    // found in your history
    if (found.length) {
      var box = h('div', { class: 'card' });
      found.forEach(function (f) {
        box.appendChild(h('div', { class: 'rc-row' },
          h('div', { class: 'who' }, h('strong', null, f.name), h('span', { class: 'small muted' }, [label(f.cadence), f.amountMode === 'fixed' ? U.money(f.amount, { cents: true }) : U.money(f.low, { cents: true }) + '–' + U.money(f.high, { cents: true }) + ' (usually ' + U.money(f.amount, { cents: true }) + ')',
            f.kind === 'income' ? 'money in' : UI.catName(f.categoryId), f.count + ' times, last ' + U.shortDate(f.anchor)].join(' · '))),
          h('div', { class: 'row' },
            h('button', { type: 'button', class: 'btn primary', 'aria-label': 'Confirm ' + f.name + ' as recurring', onclick: function () {
              var b = snapshot();
              App.cfg.recurring = items.concat([{ id: U.uid(), name: f.name, key: f.key, kind: f.kind, cadence: f.cadence, anchor: f.anchor, amount: f.amount, amountMode: f.amountMode, categoryId: f.categoryId, day2: f.day2, active: true, createdAt: new Date().toISOString() }]);
              save(f.name + ' added: ' + label(f.cadence).toLowerCase() + ', next ' + U.shortDate(nextDate(App.cfg.recurring[App.cfg.recurring.length - 1], today)) + '.', restore(b));
            } }, 'Confirm'),
            h('button', { type: 'button', class: 'btn', 'aria-label': f.name + ' is not recurring', onclick: function () {
              var b = snapshot(); App.cfg.recurringIgnore = App.cfg.recurringIgnore.concat([f.key + '|' + f.kind]);
              save(f.name + ' will not be suggested again.', restore(b));
            } }, 'Not recurring'))));
      });
      main.appendChild(h('section', { class: 'stack-sm', 'aria-labelledby': 'rc-found' }, h('h2', { id: 'rc-found' }, 'Found in your history (' + found.length + ')'),
        h('p', { class: 'small muted', style: { margin: 0 } }, 'Same place, regular gap. Confirm the real ones; they then count in Coming up and in the month-end estimate.'), box));
    } else if (!items.length) main.appendChild(h('section', { class: 'card pad stack-sm', 'aria-labelledby': 'rc-found' }, h('h2', { id: 'rc-found' }, 'Found in your history'),
      h('p', { class: 'small muted', style: { margin: 0 } }, 'Nothing found yet: it takes 3 payments at a regular gap (2 for yearly ones). Use + Add for your rent, phone and subscriptions.')));

    if (st.adding) main.appendChild(addForm(items, today));

    // your items
    var counts = { all: items.length, bills: items.filter(function (it) { return it.kind === 'expense' && it.active !== false && !isSub(it); }).length, subs: items.filter(function (it) { return isSub(it) && it.active !== false; }).length,
      income: items.filter(function (it) { return it.kind === 'income' && it.active !== false; }).length, paused: items.filter(function (it) { return it.active === false; }).length };
    var FILTERS = [['all', 'All'], ['bills', 'Bills'], ['subs', 'Subscriptions'], ['income', 'Money in'], ['paused', 'Paused']].filter(function (f) { return f[0] === 'all' || f[0] === st.filter || counts[f[0]] > 0; });
    var list = h('div', { class: 'stack-sm' });
    function show(it) {
      if (st.filter === 'paused') { if (it.active !== false) return false; }
      else if (st.filter === 'bills') { if (it.kind !== 'expense' || it.active === false || isSub(it)) return false; }
      else if (st.filter === 'subs') { if (!isSub(it) || it.active === false) return false; }
      else if (st.filter === 'income') { if (it.kind !== 'income' || it.active === false) return false; }
      var q = st.q.trim().toUpperCase();
      return !q || (it.name + ' ' + it.key + ' ' + UI.catName(it.categoryId)).toUpperCase().indexOf(q) >= 0;
    }
    function drawList() {
      U.clear(list);
      var rows = items.filter(show).sort(function (a, b) { return (a.active === false) - (b.active === false) || (nextDate(a, today) < nextDate(b, today) ? -1 : 1); });
      if (!rows.length) list.appendChild(h('div', { class: 'card pad muted' }, items.length ? 'Nothing matches. Try another word or "All".' : 'None yet. Confirm one above or use + Add.'));
      rows.forEach(function (it) { list.appendChild(itemRow(it, items, today)); });
    }
    var q = h('input', { id: 'rc-q', class: 'input', value: st.q, placeholder: 'Name, bank text or category', oninput: function (e) { st.q = e.target.value; drawList(); } });
    if (items.length) {
      main.appendChild(h('h2', null, 'Your bills and subscriptions (' + items.length + ')'));
      main.appendChild(h('div', { class: 'row', style: { alignItems: 'flex-end', gap: '12px' } },
        h('div', { class: 'field', style: { flex: '1 1 220px', maxWidth: '320px' } }, h('label', { for: 'rc-q' }, 'Search'), q),
        h('div', { class: 'row', role: 'group', 'aria-label': 'Show' }, FILTERS.map(function (f) {
          return h('button', { type: 'button', class: 'chip', 'aria-pressed': st.filter === f[0] ? 'true' : 'false', onclick: function () { st.filter = f[0]; App.render(); } }, f[1] + (f[0] === 'all' ? '' : ' ' + counts[f[0]]));
        }))));
    }
    drawList(); main.appendChild(list);
    if (st.adding && st.focusAdd) { st.focusAdd = false; var n = document.getElementById('rc-n'); if (n) n.focus(); }
  }

  /* One item: a compact row; Edit opens its fields right under it. */
  function itemRow(it, items, today) {
    var uid = it.id, nd = nextDate(it, today), open = st.editing === uid;
    function change(field, v, msg) { var b = snapshot(); App.cfg.recurring = items.map(function (x) { return x.id === uid ? Object.assign({}, x, (function () { var o = {}; o[field] = v; return o; })()) : x; }); save(msg, restore(b)); }
    var yr = U.money(perYear(it), { whole: true }) + ' a year' + (['monthly', 'weekly'].indexOf(it.cadence) < 0 ? ' (about ' + U.money(perYear(it) / 12, { cents: true }) + ' a month)' : '');
    var row = h('div', { class: 'card pad stack-sm rc-item' + (it.active === false ? ' paused' : '') },
      h('div', { class: 'rc-line' },
        h('div', { class: 'rc-name' }, h('strong', null, it.name + (it.active === false ? ' (paused)' : '')), h('span', { class: 'small muted' }, [it.kind === 'income' ? 'money in' : UI.catName(it.categoryId), label(it.cadence)].filter(Boolean).join(' · '))),
        h('div', { class: 'rc-sum' }, h('strong', null, amountText(it)), h('span', { class: 'small muted' }, yr)),
        h('div', { class: 'rc-when' }, it.active === false ? h('span', { class: 'small muted' }, 'Paused') : nd ? [h('span', null, 'Next ' + U.shortDate(nd)), h('span', { class: 'small muted' }, inWords(nd, today))] : null),
        h('div', { class: 'row rc-act' },
          h('button', { type: 'button', class: 'btn', 'aria-expanded': open ? 'true' : 'false', 'aria-label': (open ? 'Close editing ' : 'Edit ') + it.name, onclick: function () { st.editing = open ? null : uid; st.confirmDel = null; App.render(); if (!open) { var f = document.getElementById('rc-name-' + uid); if (f) f.focus(); } } }, open ? 'Done' : 'Edit'),
          h('button', { type: 'button', class: 'btn', 'aria-label': (it.active === false ? 'Resume ' : 'Pause ') + it.name, onclick: function () { change('active', it.active === false, it.name + (it.active === false ? ' resumed.' : ' paused.')); } }, it.active === false ? 'Resume' : 'Pause'))));
    if (!open) return row;
    var cad = h('select', { id: 'rc-cad-' + uid, class: 'input', onchange: function (e) { change('cadence', e.target.value, it.name + ': ' + label(e.target.value).toLowerCase() + '.'); } }, Recurring.CADENCES.map(function (c) { return h('option', { value: c.id }, c.label); }));
    cad.value = it.cadence;
    var amt = h('input', { id: 'rc-amt-' + uid, class: 'input num', inputmode: 'decimal', value: String(it.amount), onchange: function (e) { var v = U.calc(e.target.value); if (v === null || v < 0) { e.target.value = String(it.amount); UI.toast('Enter an amount like 20.99.'); return; } change('amount', U.round2(v), it.name + ': ' + U.money(v, { cents: true }) + '.'); } });
    var date = h('input', { id: 'rc-date-' + uid, type: 'date', class: 'input', value: nd, onchange: function (e) { if (!U.validDate(e.target.value)) return; change('anchor', e.target.value, it.name + ': next on ' + U.shortDate(e.target.value) + '.'); } });
    var cat = UI.categorySelect('rc-cat-' + uid, it.categoryId || '', function (e) { change('categoryId', e.target.value || null, it.name + ' → ' + UI.catName(e.target.value) + '.'); }, { placeholder: 'No category' });
    row.appendChild(h('div', { class: 'rc-grid' },
      h('div', { class: 'field' }, h('label', { for: 'rc-name-' + uid }, 'Name'), h('input', { id: 'rc-name-' + uid, class: 'input', value: it.name, onchange: function (e) { var v = e.target.value.trim(); if (!v) { e.target.value = it.name; return; } change('name', v, 'Renamed to ' + v + '.'); } })),
      h('div', { class: 'field' }, h('label', { for: 'rc-amt-' + uid }, it.amountMode === 'varies' ? 'Usual amount' : 'Amount'), amt),
      h('div', { class: 'field' }, h('label', { for: 'rc-cad-' + uid }, 'How often'), cad),
      h('div', { class: 'field' }, h('label', { for: 'rc-date-' + uid }, 'Next on'), date),
      it.cadence === 'semimonthly' ? h('div', { class: 'field' }, h('label', { for: 'rc-d2-' + uid }, 'Other day of the month'), h('input', { id: 'rc-d2-' + uid, class: 'input num', type: 'number', min: '1', max: '31', value: String(it.day2 || ''), onchange: function (e) { var v = Math.floor(+e.target.value); if (!(v >= 1 && v <= 31)) { e.target.value = String(it.day2 || ''); return; } change('day2', v, it.name + ': also on day ' + v + '.'); } })) : null,
      h('div', { class: 'field' }, h('label', { for: 'rc-cat-' + uid }, 'Category'), cat)));
    row.appendChild(h('div', { class: 'row' },
      h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: it.amountMode === 'varies', onchange: function (e) { change('amountMode', e.target.checked ? 'varies' : 'fixed', it.name + (e.target.checked ? ': amount varies.' : ': fixed amount.')); } }), h('span', null, 'Amount varies')),
      h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: it.autoLog !== false, onchange: function (e) { change('autoLog', e.target.checked, e.target.checked ? it.name + ' will be logged for you if it is not recorded by the end of the month.' : it.name + ' will not be logged for you.'); } }), h('span', null, 'Log it for me if it is not recorded by the end of the month')),
      st.confirmDel === uid ? null : h('button', { type: 'button', class: 'btn link', 'aria-label': 'Delete ' + it.name, onclick: function () { st.confirmDel = uid; App.render(); } }, 'Delete')));
    if (st.confirmDel === uid) row.appendChild(h('div', { class: 'toast warn', role: 'alert' }, h('span', null, 'Delete "' + it.name + '"? Its transactions stay as they are.'),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn danger', onclick: function () { var b = snapshot(); st.confirmDel = null; st.editing = null; App.cfg.recurring = items.filter(function (x) { return x.id !== uid; }); save(it.name + ' deleted.', restore(b)); } }, 'Delete'),
        h('button', { type: 'button', class: 'btn', onclick: function () { st.confirmDel = null; App.render(); } }, 'Keep it'))));
    return row;
  }

  /* Logs bills and paycheques not recorded by the end of their month (Recurring.autoLog): on start-up, when the date changes,
     after an import or opening a file, and when a bill's setting changes. Resolves to a sentence about what it did ('' for nothing);
     quiet: no message of its own (the caller adds the sentence to its own). Undo takes the logged lines out again. */
  var ranOn = '';
  function autoLog(o) {
    o = o || {};
    if (App.readOnly || !App.cfg) return Promise.resolve('');
    var today = U.today(); if (!o.force && ranOn === today) return Promise.resolve(''); ranOn = today;
    return UI.reload().then(function () { return App.cfg ? logNow(o, today) : ''; });   // fresh from storage, so another open tab's logged lines are seen
  }
  function logNow(o, today) {
    var first = !App.cfg.autoLogFrom; if (first) App.cfg.autoLogFrom = today.slice(0, 7);   // nothing from before this month is logged
    var r = Recurring.autoLog(App.cfg, App.txs, today, new Date().toISOString());
    if (!r.add.length && !r.drop.length) return (first ? DB.saveConfig(App.cfg, true) : Promise.resolve()).then(function () { return ''; });
    App.cfg.recurring = App.cfg.recurring.map(function (it) {
      var add = r.logged[it.id] || [], gone = r.unlog[it.id] || []; if (!add.length && !gone.length) return it;
      return Object.assign({}, it, { logged: (it.logged || []).filter(function (d) { return gone.indexOf(d) < 0; }).concat(add).slice(-120) });
    });
    var names = function (l) { var x = l.slice(0, 3).map(function (t) { return t.desc + ' ' + U.money(t.amount, { cents: true }) + ' (' + U.shortDate(t.date) + ')'; }).join(', '); return x + (l.length > 3 ? ' and ' + (l.length - 3) + ' more' : ''); };
    var msg = [r.add.length ? 'Logged ' + r.add.length + ' recurring item' + (r.add.length === 1 ? '' : 's') + ' not recorded by the end of the month: ' + names(r.add) + '.' : '',
      r.drop.length ? 'Removed ' + r.drop.length + ' automatically logged line' + (r.drop.length === 1 ? '' : 's') + ' now that the real payment is in: ' + names(r.drop) + '.' : ''].filter(Boolean).join(' ');
    var addIds = r.add.map(function (t) { return t.id; });
    return DB.putAll(App.cfg, r.add).then(function () { return r.drop.length ? DB.deleteTx(r.drop.map(function (t) { return t.id; })) : null; }).then(UI.reload).then(function () {
      if (o.quiet) return msg;
      App.render();
      UI.toast(msg, function () {   // the logged lines go; the removed ones come back as yours (so they are not removed again)
        var stamp = new Date().toISOString(), back = r.drop.map(function (t) { return Object.assign({}, t, { updatedAt: stamp }); });
        DB.deleteTx(addIds).then(function () { return back.length ? DB.putTx(back) : null; }).then(UI.reload).then(function () { App.render(); UI.toast('Undone. Those dates will not be logged again.'); });
      });
      return msg;
    });
  }

  function addForm(items, today) {
    var f = st.form, add = h('section', { class: 'card pad stack-sm', 'aria-labelledby': 'rc-add' }, h('h2', { id: 'rc-add' }, 'Add a bill, subscription or paycheque'));
    var kind = h('select', { id: 'rc-k', class: 'input', onchange: function (e) { f.kind = e.target.value; } }, h('option', { value: 'expense' }, 'Money out (bill, subscription)'), h('option', { value: 'income' }, 'Money in (paycheque)'));
    kind.value = f.kind;
    var quick = h('div', { class: 'row', role: 'group', 'aria-label': 'Common schedules' }, h('span', { class: 'muted small' }, 'Quick pick:'), [['monthly', 'Monthly'], ['quarterly', 'Quarterly (every 3 months)'], ['yearly', 'Yearly']].map(function (q) {
      return h('button', { type: 'button', class: 'chip', 'aria-pressed': f.cadence === q[0] ? 'true' : 'false', onclick: function () { f.cadence = q[0]; App.render(); var n = document.getElementById('rc-nc'); if (n) n.focus(); } }, q[1]); }));
    var ncad = h('select', { id: 'rc-nc', class: 'input', onchange: function (e) { f.cadence = e.target.value; App.render(); var n = document.getElementById('rc-nc'); if (n) n.focus(); } }, Recurring.CADENCES.map(function (c) { return h('option', { value: c.id }, c.label); }));
    ncad.value = f.cadence;
    add.appendChild(quick);
    add.appendChild(h('div', { class: 'rc-grid' },
      h('div', { class: 'field' }, h('label', { for: 'rc-n' }, 'Name'), h('input', { id: 'rc-n', class: 'input', value: f.name, placeholder: 'e.g. Spotify', oninput: function (e) { f.name = e.target.value; } })),
      h('div', { class: 'field' }, h('label', { for: 'rc-m' }, 'Bank text to match'), h('input', { id: 'rc-m', class: 'input', value: f.key, placeholder: 'as on your statement, e.g. SPOTIFY', oninput: function (e) { f.key = e.target.value; } })),
      h('div', { class: 'field' }, h('label', { for: 'rc-a' }, 'Amount'), h('input', { id: 'rc-a', class: 'input num', inputmode: 'decimal', value: f.amount, oninput: function (e) { f.amount = e.target.value; } })),
      h('div', { class: 'field' }, h('label', { for: 'rc-nc' }, 'How often'), ncad),
      h('div', { class: 'field' }, h('label', { for: 'rc-d' }, 'Next on'), h('input', { id: 'rc-d', type: 'date', class: 'input', value: f.date, onchange: function (e) { f.date = e.target.value; } })),
      h('div', { class: 'field' }, h('label', { for: 'rc-c' }, 'Category'), UI.categorySelect('rc-c', f.cat, function (e) { f.cat = e.target.value; }, { placeholder: 'Choose…' })),
      f.cadence === 'semimonthly' ? h('div', { class: 'field' }, h('label', { for: 'rc-d2' }, 'Other day of the month'), h('input', { id: 'rc-d2', class: 'input num', type: 'number', min: '1', max: '31', value: f.day2, placeholder: '15, or 31 for the last day', oninput: function (e) { f.day2 = e.target.value; } })) : null,
      h('div', { class: 'field' }, h('label', { for: 'rc-k' }, 'Type'), kind)));
    if (st.err) add.appendChild(h('div', { class: 'small red', role: 'alert' }, st.err));
    add.appendChild(h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onclick: function () {
      var v = U.calc(f.amount), key = M.merchantKey(f.key || f.name);
      st.err = !f.name.trim() ? 'Give it a name.' : !key ? 'Type the bank text to match (letters, as on your statement).' : v === null || v <= 0 ? 'Enter the amount, like 9.99.' : !U.validDate(f.date) ? 'Pick the next date.' : f.cadence === 'semimonthly' && !(+f.day2 >= 1 && +f.day2 <= 31) ? 'Enter the other day of the month (1 to 31) for a twice-a-month bill.' : '';
      if (st.err) { App.render(); return; }
      var b = snapshot();
      App.cfg.recurring = items.concat([{ id: U.uid(), name: f.name.trim(), key: key, kind: f.kind, cadence: f.cadence, anchor: f.date, amount: U.round2(v), amountMode: 'fixed', categoryId: f.cat || null, day2: f.cadence === 'semimonthly' ? Math.floor(+f.day2) : undefined, active: true, createdAt: new Date().toISOString() }]);
      var nm = f.name.trim(); st.adding = false; st.form = blank();
      save(nm + ' added.', restore(b));
    } }, 'Add'), h('button', { type: 'button', class: 'btn', onclick: function () { st.adding = false; st.err = ''; st.form = blank(); App.render(); } }, 'Cancel')));
    return add;
  }
  return { render: render, open: open, autoLog: autoLog };
})();
