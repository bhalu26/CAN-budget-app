/* Shared app state and pieces used by several screens: nav, panels, toasts, category picker, add/edit expense. */
var App = { cfg: null, txs: [], route: 'home', month: null, readOnly: false };
var UI = (function () {
  'use strict';
  var h = U.h;

  function reload() {
    if (App.readOnly) return Promise.resolve();   // a read-only snapshot lives in memory only
    return Promise.all([DB.getConfig(), DB.allTx()]).then(function (r) { App.cfg = M.migrate(r[0] || null); App.txs = r[1] || []; });
  }
  function saveCfg() { return DB.saveConfig(App.cfg); }
  /* The account's current name (so a rename shows on every old transaction); falls back to the text saved with the line. */
  function acctName(t) { var a = t.accountId && (App.cfg.accounts || []).filter(function (x) { return x.id === t.accountId; })[0]; return a ? a.name : (t.account || ''); }

  /* Nav */
  /* Menu behind a ☰ button. On a computer the choice (open or folded into a slim rail) is remembered;
     on a phone it is a drop-down that folds away after you pick a screen. */
  var phone = window.matchMedia ? window.matchMedia('(max-width: 640px)') : { matches: false };
  var phoneOpen = false, menuAt = 0;
  function menuOpen() {
    if (phone.matches) return phoneOpen;
    try { return localStorage.getItem('budget-menu') === 'open'; } catch (e) { return false; }
  }
  function toggleMenu() {
    var open = !menuOpen();
    menuAt = Date.now();
    if (phone.matches) phoneOpen = open; else try { localStorage.setItem('budget-menu', open ? 'open' : 'closed'); } catch (e) {}
    nav();
    var b = document.querySelector('.nav-toggle'); if (b) b.focus();
  }
  function closeMenu() { if (phone.matches && phoneOpen) { phoneOpen = false; } }
  if (phone.addEventListener) phone.addEventListener('change', function () { phoneOpen = false; if (App.cfg) nav(); });

  function nav() {
    var el = U.clear(document.getElementById('nav'));
    var open = menuOpen();
    el.className = 'nav' + (open ? ' open' : '');
    var tag = App.txs.filter(function (t) { return t.needsTag; }).length;
    var reviewing = App.route === 'review' || (App.route === 'transactions' && App.routeQ && App.routeQ.f === 'review');
    var items = App.readOnly ? [['home', 'Home', '#/home'], ['transactions', 'Transactions', '#/transactions'], ['insights', 'Insights', '#/insights']] :
      [['home', 'Home', '#/home'], ['transactions', 'Transactions', '#/transactions'], ['insights', 'Insights', '#/insights'], ['review', 'Review', '#/review'], ['import', 'Import', '#/import'], ['health', 'Data health', '#/health'], ['settings', 'Settings', '#/settings']];
    var inSettings = ['settings', 'bills', 'rules', 'accounts', 'backup'].indexOf(App.route) >= 0;
    var here = items.filter(function (it) { return it[0] === 'review' ? reviewing : it[0] === 'settings' ? inSettings : (App.route === it[0] && !(it[0] === 'transactions' && reviewing)); })[0];
    el.appendChild(h('div', { class: 'nav-top' },
      h('button', { type: 'button', class: 'btn icon nav-toggle', 'aria-expanded': open ? 'true' : 'false', 'aria-controls': 'nav-links',
        'aria-label': (open ? 'Hide menu' : 'Show menu') + (tag && !App.readOnly ? ', ' + tag + ' to review' : ''), title: open ? 'Hide menu' : 'Show menu', onclick: toggleMenu },
        '☰', !open && tag && !App.readOnly ? h('span', { class: 'dot', 'aria-hidden': 'true' }) : null),
      h('div', { class: 'brand' }, 'Our Budget', App.readOnly ? h('span', { class: 'small muted', style: { display: 'block', fontWeight: '400' } }, 'Read-only') : null,
        !open && here ? h('span', { class: 'small muted where', style: { fontWeight: '400' } }, here[1]) : null)));
    var hl = !App.readOnly && typeof HealthUI !== 'undefined' ? HealthUI.summary() : null;
    var links = h('div', { id: 'nav-links', class: 'nav-links' + (U.fresh(menuAt) ? ' enter' : '') });
    items.forEach(function (it) {
      links.appendChild(h('a', { href: it[2], 'aria-current': it === here ? 'page' : null },
        h('span', null, it[1]), it[0] === 'review' && tag ? h('span', { class: 'badge', 'aria-label': tag + ' to review' }, String(tag)) : null,
        it[0] === 'health' && hl && hl.high ? h('span', { class: 'badge', 'aria-label': hl.high + ' affect your numbers' }, String(hl.high)) : null));
    });
    el.appendChild(links);
  }

  /* Side panel with focus kept inside and returned afterwards. */
  var lastFocus = null, keyHandler = null;
  var closeHooks = [];
  /* run fn once when the panel now open closes (by any route: a button, Escape, the backdrop) */
  function onPanelClose(fn) { closeHooks.push(fn); }
  function openPanel(build, opts) {
    opts = opts || {};
    closeHooks = [];
    lastFocus = document.activeElement;
    var layer = U.clear(document.getElementById('layer'));
    var panel = h('div', { class: 'panel' + (opts.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.label || 'Panel', tabindex: '-1' });
    var wrap = h('div', { class: 'overlay' }, h('button', { class: 'scrim', type: 'button', 'aria-label': 'Close', onclick: closePanel }), panel);
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    keyHandler = function (e) {
      if (!document.getElementById('layer').firstChild) return;
      if (e.key === 'Escape') { e.preventDefault(); closePanel(); return; }
      if (!panel.contains(document.activeElement)) { var f0 = panel.querySelector('input, select, button'); if (f0 && e.key === 'Tab') { e.preventDefault(); f0.focus(); } return; }
      if (e.key === 'Tab') {
        var f = panel.querySelectorAll('button, input, select, a[href], [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', keyHandler);
    layer.appendChild(wrap);
    build(panel);
    var first = panel.querySelector('[autofocus]') || panel.querySelector('input, select, button');
    if (first) first.focus();
    return panel;
  }
  function closePanel() {
    var hooks = closeHooks; closeHooks = [];
    hooks.forEach(function (fn) { try { fn(); } catch (e) {} });
    Safety.guard('add', false);
    if (keyHandler) { document.removeEventListener('keydown', keyHandler); keyHandler = null; }
    var layer = document.getElementById('layer'), wrap = layer.firstChild;
    // the panel is gone at once (Escape, focus, "is a panel open" checks); a copy slides out on top for 150ms
    if (wrap) { Array.prototype.forEach.call(wrap.querySelectorAll('[id]'), function (e) { e.removeAttribute('id'); }); wrap.classList.add('leaving'); wrap.setAttribute('aria-hidden', 'true'); wrap.inert = true; document.body.appendChild(wrap); setTimeout(function () { wrap.remove(); }, 150); }
    U.clear(layer);
    if (lastFocus && lastFocus.focus && document.body.contains(lastFocus)) lastFocus.focus();
  }
  function panelHead(title, sub) {
    return h('div', { class: 'row between', style: { alignItems: 'flex-start' } },
      h('div', { class: 'stack-sm' }, sub ? h('span', { class: 'small muted' }, sub) : null, h('h2', { style: { fontSize: '24px' } }, title)),
      h('button', { type: 'button', class: 'btn icon', 'aria-label': 'Close', onclick: closePanel }, '×'));
  }

  /* Category <select> with every category grouped by budget group, plus Income / Transfer / Not counted. */
  function categorySelect(id, value, onchange, opts) {
    opts = opts || {};
    var sel = h('select', { id: id, class: 'input', onchange: onchange });
    if (opts.placeholder) sel.appendChild(h('option', { value: '' }, opts.placeholder));
    M.groupsWithCats(App.cfg).forEach(function (gc) {
      var og = h('optgroup', { label: gc.group.name });
      gc.cats.forEach(function (c) { og.appendChild(h('option', { value: c.id }, c.name)); });
      sel.appendChild(og);
    });
    var sp = h('optgroup', { label: 'Not spending' });
    M.SPECIAL.forEach(function (s) { sp.appendChild(h('option', { value: s.id }, s.name)); });
    sel.appendChild(sp);
    sel.value = value || '';
    return sel;
  }
  function catName(id) { var c = M.catMap(App.cfg)[id]; return c ? c.name : 'Needs a category'; }
  function travelCat() { return App.cfg.categories.filter(function (c) { return c.period === 'year' && !c.archived; })[0]; }
  function recentCats(n) {
    var seen = {}, out = [];
    App.txs.slice().sort(function (a, b) { return (b.createdAt || b.date) < (a.createdAt || a.date) ? -1 : 1; }).forEach(function (t) {
      if (t.type === 'expense' && t.categoryId && !seen[t.categoryId] && out.length < n) { var c = M.catMap(App.cfg)[t.categoryId]; if (c && !c.archived && c.period !== 'year') { seen[t.categoryId] = 1; out.push(t.categoryId); } }
    });
    ['dine-out', 'groceries', 'taxi', 'other-household', 'clothing', 'personal-care'].forEach(function (id) { if (out.length < n && !seen[id] && M.catMap(App.cfg)[id]) { seen[id] = 1; out.push(id); } });
    return out;
  }

  /* Add or edit an expense (also income, saving, transfer). Stays open after adding so the next one is quick. */
  /* prefill (new expense only): { amount, cat, desc } from quick add. */
  /* Names for ids in the history ("Category Groceries → Dining out"). */
  function histSay(c) {
    return Hist.say(c, { cat: catName,
      fund: function (id) { var f = (App.cfg.bigExpenses || []).filter(function (x) { return x.id === id; })[0]; return f ? f.name : 'a deleted big expense'; },
      trip: function (id) { var t = (App.cfg.trips || []).filter(function (x) { return x.id === id; })[0]; return t ? t.name : 'a deleted trip'; } });
  }
  function stamp(iso) { var d = new Date(iso); return isNaN(d) ? iso : U.shortDate(iso.slice(0, 10)) + ' ' + iso.slice(0, 4) + ', ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  /* Is this line part of a recurring bill? Mark it, unmark it, or make a new recurring item from it. */
  function recurLinks(t, onDone) {
    if (App.readOnly) return null;
    var kind = Recurring.kindOf(t), key = M.merchantKey(t.desc || ''); if (!kind || !key) return null;
    function flip(on) {
      var before = JSON.parse(JSON.stringify(t)), u = JSON.parse(JSON.stringify(t)); if (on) u.notRecurring = true; else delete u.notRecurring; u.updatedAt = new Date().toISOString();
      closePanel(); Hist.why('Recurring');
      DB.putTx([u]).then(reload).then(function () { App.render(); if (onDone) onDone(); toast(on ? 'Marked as not part of a recurring bill.' : 'Part of the recurring bill again.', function () { Hist.why('Undo'); DB.putTx([before]).then(reload).then(function () { App.render(); if (onDone) onDone(); toast('Undone.'); }); }); });
    }
    var item = (App.cfg.recurring || []).filter(function (x) { return x.key === key && x.kind === kind; })[0];
    if (t.notRecurring) return h('div', { class: 'row between rec-links' }, h('span', { class: 'small' }, 'Marked as not part of a recurring bill.'), h('button', { type: 'button', class: 'btn', onclick: function () { flip(false); } }, 'Part of it after all'));
    if (item) return h('div', { class: 'row between rec-links' }, h('span', { class: 'small' }, 'Recurring: ' + item.name + ' (' + ((Recurring.BY_ID[item.cadence] || {}).label || item.cadence).toLowerCase() + (item.active === false ? ', paused' : '') + ')'),
      h('span', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: function () { closePanel(); RecurringUI.open(); } }, 'Open in Bills'), h('button', { type: 'button', class: 'btn', onclick: function () { flip(true); } }, 'Not part of it')));
    if (t.amount <= 0) return null;
    return h('div', { class: 'row between rec-links' }, h('span', { class: 'small muted' }, 'Does this repeat?'), h('button', { type: 'button', class: 'btn', onclick: function () {
      var g = Recurring.guess(App.txs, t, U.today()); if (!g) return;
      closePanel();
      RecurringUI.open({ add: { name: t.desc, key: key, amount: String(Math.abs(t.amount)), cadence: g.cadence, date: g.anchor, cat: t.categoryId && t.categoryId.charAt(0) !== '_' ? t.categoryId : '', kind: kind, day2: g.day2 ? String(g.day2) : '' } });
      if (!g.certain) toast('Only one payment so far, so "every month" is a guess. Change it if it is not.');
    } }, 'Make this recurring…'));
  }
  /* Links to the repayment tools for a group bill, or for a line that repays one. */
  function groupLinks(t, onDone) {
    if (Group.isGroup(t)) { var b = Group.balance(t, App.txs);
      return h('div', { class: 'row between grp-links' }, h('span', { class: 'small' }, 'Group bill: others owe ' + U.money(b.owed, { cents: true }) + (b.repaid ? ', ' + U.money(b.repaid, { cents: true }) + ' paid back' : '') + (b.left ? ', ' + U.money(b.left, { cents: true }) + ' still owed.' : ': all paid back ✓')),
        h('button', { type: 'button', class: 'btn', onclick: function () { closePanel(); GroupUI.open(t, onDone); } }, 'Track repayments…')); }
    if (t.repaysId) { var bill = App.txs.filter(function (x) { return x.id === t.repaysId; })[0];
      return h('div', { class: 'row between grp-links' }, h('span', { class: 'small' }, 'Repays ' + (bill ? bill.desc || 'a group bill' : 'a bill that no longer exists')), h('button', { type: 'button', class: 'btn', onclick: function () { closePanel(); GroupUI.unlink(t, onDone); } }, 'Unlink')); }
    if ((t.direction === 'in' || t.type === 'pending') && t.type !== 'income' && t.type !== 'saving' && Group.open(App.txs).length)
      return h('div', { class: 'row between grp-links' }, h('span', { class: 'small muted' }, 'Did someone pay you back for a group bill?'), h('button', { type: 'button', class: 'btn', onclick: function () { closePanel(); GroupUI.repayFrom(t, onDone); } }, 'Repays a group bill…'));
    return null;
  }
  /* History of one line, folded away until asked for; starts with where the line came from. */
  function historyBox(t, st, redraw) {
    var hist = (t.history || []).slice().reverse(), n = hist.length;
    var origin = t.source === 'manual' ? 'Added by hand' : t.source === 'excel' ? 'From your Excel history' + (t.excelRow ? ', row ' + t.excelRow : '') : 'Imported' + (t.file ? ' from ' + t.file + (t.line ? ', line ' + t.line : '') : '');
    var box = h('div', { class: 'stack-sm hist' }, h('button', { type: 'button', class: 'btn link', style: { alignSelf: 'flex-start' }, 'aria-expanded': st.showHist ? 'true' : 'false', 'aria-controls': 'hist-list',
      onclick: function () { st.showHist = !st.showHist; redraw(); } }, (st.showHist ? 'Hide history' : 'History') + (n ? ' (' + n + ' change' + (n === 1 ? '' : 's') + ')' : '')));
    if (st.showHist) box.appendChild(h('ul', { id: 'hist-list', class: 'hist-list' },
      hist.map(function (e) { return h('li', null, h('div', { class: 'small muted' }, stamp(e.at) + ' · ' + e.why), e.c.map(function (c) { return h('div', null, histSay(c)); })); }),
      h('li', null, h('div', { class: 'small muted' }, (t.createdAt ? stamp(t.createdAt) + ' · ' : '') + origin), n ? null : h('div', { class: 'small muted' }, 'No changes since.'))));
    return box;
  }
  function expensePanel(existing, onDone, prefill) {
    if (App.readOnly) { if (existing) Share.detail(existing); return; }
    var editing = !!existing, pre = !editing && prefill || {};
    var st = { amount: existing ? (existing.expr || String(existing.amount)) : (pre.amount || ''), cat: existing ? existing.categoryId || '' : (pre.cat || recentCats(1)[0] || ''),
      date: existing ? existing.date : (pre.date || U.today()), trip: existing ? existing.tripId || '' : '', note: existing ? existing.note || '' : '', desc: existing ? existing.desc || '' : (pre.desc || ''),
      fund: existing ? existing.fundId || '' : (pre.fund || ''), group: !!(existing && existing.share), people: existing && existing.people ? String(existing.people) : '2', share: existing && existing.share ? String(existing.share) : '', shareAuto: !(existing && existing.share), split: false, lines: [{ amount: '', cat: '' }, { amount: '', cat: '' }], confirmDel: false, catTouched: !!existing || !!pre.cat, catWhy: '',
      more: !!(existing && (existing.note || existing.tripId || existing.fundId || existing.share)) || !!pre.fund };
    openPanel(function (p) {
      function draw() {
        U.clear(p);
        p.appendChild(panelHead(editing ? 'Edit transaction' : 'Add expense', editing && existing.source === 'excel' ? 'From your Excel history, row ' + existing.excelRow : null));
        var rvn = ReviewedUI.note([st.date, existing && existing.date], editing ? 'Saving this' : 'Adding this'); if (rvn) p.appendChild(rvn);
        var val = U.calc(st.amount);
        var amt = h('input', { id: 'amt', class: 'input big', inputmode: 'decimal', autocomplete: 'off', value: st.amount, placeholder: 'e.g. 56+25.44', autofocus: true,
          oninput: function (e) { st.amount = e.target.value; Safety.guard('add', !!st.amount); if (st.group) syncGroup(); hint.textContent = hintText(); hint.className = 'small ' + (U.calc(st.amount) === null && st.amount ? 'red' : 'muted'); },
          onkeydown: function (e) { if (e.key === 'Enter') save(); } });
        function hintText() { var v = U.calc(st.amount); return st.amount === '' ? 'You can type sums like 56+25.44 or a refund as -20' : (v === null ? 'Check the amount: numbers and + - * / only' : '= ' + U.money(v, { cents: true })); }
        var hint = h('div', { class: 'small ' + (val === null && st.amount ? 'red' : 'muted'), 'aria-live': 'polite' }, hintText());
        if (!st.split) p.appendChild(h('div', { class: 'field' }, h('label', { for: 'amt' }, 'Amount'), amt, hint));

        // any trip can be picked: flights, hotels and deposits are usually paid before the trip's dates
        var tripOpts = Trips.options(App.cfg, U.validDate(st.date) ? st.date : U.today()), tc = travelCat();
        if (st.trip && !Trips.byId(App.cfg, st.trip)) st.trip = '';
        if (st.trip && tc && !st.fund) st.cat = tc.id;

        /* 1 Amount, 2 Where, 3 Category (a past choice for the same shop is filled in), 4 Date, 5 the rest folded under "More options" */
        if (!st.split) {
          p.appendChild(h('div', { class: 'field' }, h('label', { for: 'desc' }, 'Where'), h('input', { id: 'desc', class: 'input', value: st.desc, placeholder: 'e.g. Starbucks', autocomplete: 'off',
            oninput: function (e) { st.desc = e.target.value; }, onchange: function (e) { st.desc = e.target.value; suggestCat(); } })));
          var chips = h('div', { class: 'row', role: 'group', 'aria-label': 'Quick picks' });
          recentCats(5).forEach(function (id) {
            chips.appendChild(h('button', { type: 'button', class: 'chip', 'data-cat': id, 'aria-pressed': st.cat === id ? 'true' : 'false', disabled: !!st.trip && !st.fund, onclick: function () { st.cat = id; st.catTouched = true; st.catWhy = ''; draw(); } }, catName(id)));
          });
          p.appendChild(h('div', { class: 'stack-sm' }, chips,
            h('div', { class: 'field' }, h('label', { for: 'allcat' }, 'Category'), categorySelect('allcat', st.cat, function (e) { st.cat = e.target.value; st.catTouched = true; st.catWhy = ''; draw(); }, { placeholder: 'Choose…' })),
            h('div', { id: 'cat-why', class: 'small muted cat-why', 'aria-live': 'polite' }, st.trip && !st.fund ? 'Trip spending goes to ' + (tc ? tc.name : 'Travel') + '.' : st.catWhy)));
        } else {
          var box = h('div', { class: 'stack' }, h('div', { class: 'label' }, 'Split across categories'));
          st.lines.forEach(function (ln, i) {
            box.appendChild(h('div', { class: 'row', style: { alignItems: 'flex-end' } },
              h('div', { class: 'field', style: { flex: '0 1 140px' } }, h('label', { for: 'sa' + i }, 'Amount ' + (i + 1)), h('input', { id: 'sa' + i, class: 'input', inputmode: 'decimal', value: ln.amount, oninput: function (e) { ln.amount = e.target.value; } })),
              h('div', { class: 'field', style: { flex: '1 1 200px' } }, h('label', { for: 'sc' + i }, 'Category ' + (i + 1)), categorySelect('sc' + i, ln.cat, function (e) { ln.cat = e.target.value; }, { placeholder: 'Choose…' }))));
          });
          if (st.lines.length < 6) box.appendChild(h('button', { type: 'button', class: 'btn link', style: { alignSelf: 'flex-start' }, onclick: function () { st.lines.push({ amount: '', cat: '' }); draw(); } }, 'Add another line'));
          p.appendChild(box);
          p.appendChild(h('div', { class: 'field' }, h('label', { for: 'desc' }, 'Where'), h('input', { id: 'desc', class: 'input', value: st.desc, placeholder: 'e.g. Costco', oninput: function (e) { st.desc = e.target.value; } })));
        }

        var td = U.today(), yd = Recurring.addDays(td, -1);
        p.appendChild(h('div', { class: 'field' }, h('label', { for: 'dt' }, 'Date'),
          h('div', { class: 'row' }, h('input', { id: 'dt', type: 'date', class: 'input', style: { width: 'auto' }, value: st.date, onchange: function (e) { st.date = e.target.value; draw(); } }),
            h('button', { type: 'button', class: 'chip', 'aria-pressed': st.date === td ? 'true' : 'false', onclick: function () { st.date = td; draw(); } }, 'Today'),
            h('button', { type: 'button', class: 'chip', 'aria-pressed': st.date === yd ? 'true' : 'false', onclick: function () { st.date = yd; draw(); } }, 'Yesterday'))));

        /* Paid for a group: the bank amount stays, spending counts only my share */
        function syncGroup() {
          var v = U.calc(st.amount) || 0, sh = U.calc(st.share), hint = document.getElementById('grp-hint');
          if (st.shareAuto) { var e = Group.equalShare(v, st.people); st.share = e === null ? '' : String(e); sh = e; var si = document.getElementById('grp-s'); if (si) si.value = st.share; }
          if (hint) { var chk = Group.validate(v, sh); hint.textContent = !v ? 'Enter the bill amount above first.' : chk.ok ? 'Counts as ' + U.money(sh, { cents: true }) + ' in your spending. Others owe you ' + U.money(v - sh, { cents: true }) + '.' : chk.error; hint.className = 'small ' + (chk.ok || !v ? 'muted' : 'red'); }
        }
        /* a past choice for this shop: filled in place (no redraw, so a click on Save is never lost) until you pick a category yourself */
        function suggestCat() {
          if (editing || st.catTouched || st.split || st.trip || !st.desc.trim()) return;
          var hs = Learn.history(Learn.index(App.txs, U.today()), st.desc, 'out');
          if (!hs || !(Learn.sure(hs) || Learn.likely(hs)) || M.typeFor(App.cfg, hs.categoryId) !== 'expense' || hs.categoryId === st.cat) return;
          st.cat = hs.categoryId; st.catWhy = 'Usual choice here: ' + catName(hs.categoryId) + ' (' + hs.count + ' of ' + hs.total + ' times at ' + hs.key.toLowerCase() + ').';
          var sel = document.getElementById('allcat'), why = document.getElementById('cat-why');
          if (sel) sel.value = st.cat; if (why) why.textContent = st.catWhy;
          [].slice.call(p.querySelectorAll('.chip[data-cat]')).forEach(function (c) { c.setAttribute('aria-pressed', c.getAttribute('data-cat') === st.cat ? 'true' : 'false'); });
        }

        var more = h('details', { class: 'more', open: st.more ? true : null, ontoggle: function (e) { st.more = e.target.open; } },
          h('summary', { class: 'strong' }, 'More options', h('span', { class: 'muted small', style: { fontWeight: '400' } }, ' · note, trip, big expense, paid for others')));
        var moreBody = h('div', { class: 'stack more-body' });
        moreBody.appendChild(h('div', { class: 'field' }, h('label', { for: 'note' }, 'Note'), h('input', { id: 'note', class: 'input', value: st.note, oninput: function (e) { st.note = e.target.value; }, onkeydown: function (e) { if (e.key === 'Enter') save(); } })));
        var tripName = function (t) { return t.name + ' (' + U.shortDate(t.start) + ' – ' + U.shortDate(t.end) + ' ' + t.end.slice(0, 4) + ')'; };
        var tripSel = h('select', { id: 'trip', class: 'input', 'aria-describedby': 'trip-hint', onchange: function (e) { st.trip = e.target.value; draw(); } }, h('option', { value: '' }, 'No trip'),
          tripOpts.on.length ? h('optgroup', { label: 'On this date' }, tripOpts.on.map(function (t) { return h('option', { value: t.id }, tripName(t)); })) : null,
          tripOpts.other.length ? h('optgroup', { label: tripOpts.on.length ? 'Other trips (booked before or after)' : 'Trips (booked before or after)' }, tripOpts.other.map(function (t) { return h('option', { value: t.id }, tripName(t)); })) : null);
        tripSel.value = st.trip;
        var curTrip = st.trip && Trips.byId(App.cfg, st.trip), away = curTrip && U.validDate(st.date) ? Trips.say(curTrip, st.date) : null;
        moreBody.appendChild(h('div', { class: 'field' }, h('label', { for: 'trip' }, 'Trip'), tripSel,
          h('div', { id: 'trip-hint', class: 'small muted' }, !(App.cfg.trips || []).length ? 'No trips yet. Add trips in Settings.'
            : away ? 'Paid ' + away + ': it counts toward ' + curTrip.name + '\'s total, and in Travel for ' + U.monthLabel(st.date.slice(0, 7)) + '.'
            : curTrip ? 'Counts toward ' + curTrip.name + '\'s total.' : 'Flights, hotels and other bookings can go on a trip even when paid before it.')));
        var funds = App.cfg.bigExpenses || [];
        if (st.fund && !funds.some(function (f) { return f.id === st.fund; })) st.fund = '';
        if (funds.length && !st.split) {
          var fundSel = h('select', { id: 'fund', class: 'input', 'aria-describedby': 'fund-hint', onchange: function (e) {
            st.fund = e.target.value;
            var f = funds.filter(function (x) { return x.id === st.fund; })[0];
            if (f && f.categoryId) st.cat = f.categoryId;   // the fund knows where it belongs; still changeable
            draw();
          } }, h('option', { value: '' }, 'This month\'s budget'), funds.map(function (f) { return h('option', { value: f.id }, f.name); }));
          fundSel.value = st.fund;
          moreBody.appendChild(h('div', { class: 'field' }, h('label', { for: 'fund' }, 'Pay from'), fundSel,
            h('div', { id: 'fund-hint', class: 'small muted' }, st.fund ? 'Paid from money set aside: it will not count against this month\'s limits.' : 'Pick a big expense to pay this from the money set aside for it.')));
        }
        if (!st.split && !st.fund && !(existing && existing.splitGroup) && (!st.cat || M.typeFor(App.cfg, st.cat) === 'expense')) {
          var grpBox = h('div', { class: 'stack-sm grp' }, h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'grp', checked: st.group, 'aria-describedby': 'grp-hint', onchange: function (e) {
            st.group = e.target.checked; if (st.group && !st.share) st.shareAuto = true; st.more = true; draw(); var n = document.getElementById(st.group ? 'grp-n' : 'grp'); if (n) n.focus(); } }),
            h('span', null, 'I paid for others too: count only my share')));
          if (st.group) grpBox.appendChild(h('div', { class: 'row', style: { alignItems: 'flex-end' } },
            h('div', { class: 'field', style: { flex: '0 1 170px' } }, h('label', { for: 'grp-n' }, 'People at the table (with me)'), h('input', { id: 'grp-n', class: 'input', type: 'number', min: '2', step: '1', value: st.people, oninput: function (e) { st.people = e.target.value; syncGroup(); } })),
            h('div', { class: 'field', style: { flex: '0 1 150px' } }, h('label', { for: 'grp-s' }, 'My share'), h('input', { id: 'grp-s', class: 'input', inputmode: 'decimal', value: st.share, oninput: function (e) { st.share = e.target.value; st.shareAuto = false; syncGroup(); } }))));
          grpBox.appendChild(h('div', { id: 'grp-hint', class: 'small muted', 'aria-live': 'polite' }, st.group ? '' : 'Dining out and you picked up the whole bill? The bank amount stays as it is; only your share counts in your spending.'));
          moreBody.appendChild(grpBox);
        }
        more.appendChild(moreBody); p.appendChild(more);
        if (st.group && p.querySelector('#grp-hint')) syncGroup();

        if (editing) { var gl = groupLinks(existing, onDone); if (gl) p.appendChild(gl); var rl = recurLinks(existing, onDone); if (rl) p.appendChild(rl); }
        if (editing) p.appendChild(historyBox(existing, st, draw));
        var actions = h('div', { class: 'stack-sm' },
          h('button', { type: 'button', class: 'btn primary', style: { minHeight: '48px' }, onclick: save }, editing ? 'Save changes' : 'Save expense'),
          h('div', { class: 'row between small muted' }, h('span', null, editing ? '' : 'Enter saves · stays open for the next one'),
            !editing ? h('button', { type: 'button', class: 'btn link small', onclick: function () { st.split = !st.split; draw(); var f = p.querySelector(st.split ? '#sa0' : '#amt'); if (f) { f.focus({ preventScroll: true }); U.reveal(f); } } }, st.split ? 'Back to one category' : 'Split across categories')
              : Split.canSplit(existing).ok ? h('button', { type: 'button', class: 'btn link small', onclick: function () { closePanel(); SplitUI.open(existing, onDone); } }, existing.splitGroup ? 'Change the split…' : 'Split this line…')
              : existing.type === 'expense' ? h('span', { class: 'small muted' }, Split.canSplit(existing).why) : null));
        p.appendChild(actions);
        if (editing) {
          // the question replaces the button in the same place and takes focus on the safe answer
          if (!st.confirmDel) p.appendChild(h('button', { type: 'button', id: 'del-ask', class: 'btn danger', onclick: function () { st.confirmDel = true; draw(); var k = document.getElementById('del-keep'); if (k) k.focus({ preventScroll: true }); U.reveal(document.getElementById('del-q')); } }, 'Delete this transaction'));
          else p.appendChild(h('div', { id: 'del-q', class: 'toast warn', role: 'alert' }, h('span', null, 'Delete "' + (existing.desc || catName(existing.categoryId)) + '", ' + U.money(existing.amount, { cents: true }) + '?' + (ReviewedUI.noteText([existing.date]) ? ' ' + ReviewedUI.noteText([existing.date]) : '')),
            h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn danger', onclick: del }, 'Delete'), h('button', { type: 'button', id: 'del-keep', class: 'btn', onclick: function () { st.confirmDel = false; draw(); var a = document.getElementById('del-ask'); if (a) a.focus({ preventScroll: true }); } }, 'Keep it'))));
        }
        if (st.msg) p.appendChild(h('div', { id: 'add-msg', class: st.msgBad ? 'toast warn' : 'toast', role: 'status' }, st.msg));
      }
      /* a problem with what was typed: say so where it can be seen */
      function fail(msg) { st.msg = msg; st.msgBad = true; draw(); U.reveal(document.getElementById('add-msg')); }
      function save() {
        if (!U.validDate(st.date)) return fail('Pick a date first.');
        var stamp = new Date().toISOString(), list = [];
        if (st.split) {
          var group = U.uid();
          for (var i = 0; i < st.lines.length; i++) {
            var ln = st.lines[i]; if (!ln.amount && !ln.cat) continue;
            var v = U.calc(ln.amount);
            if (v === null || !ln.cat) return fail('Line ' + (i + 1) + ' needs an amount and a category.');
            list.push(mk(v, ln.amount, ln.cat, group));
          }
          if (list.length < 2) return fail('A split needs at least two lines.');
        } else {
          var val = U.calc(st.amount);
          if (val === null || val === 0) return fail('Enter an amount, like 12.50.');
          if (!st.cat) return fail('Choose a category.');
          if (st.group && !st.fund && !(existing && existing.splitGroup) && M.typeFor(App.cfg, st.cat) === 'expense' && val > 0) { var chk = Group.validate(val, U.calc(st.share)); if (!chk.ok) return fail(chk.error); }
          list.push(mk(val, st.amount, st.cat));
        }
        function mk(v, expr, cat, group) {
          var base = existing ? JSON.parse(JSON.stringify(existing)) : { id: U.uid(), source: 'manual', createdAt: stamp, flags: [] };
          base.amount = v; base.expr = /[+\-*/]/.test(String(expr).replace(/^-/, '')) ? String(expr) : null;
          base.categoryId = cat; base.type = M.typeFor(App.cfg, cat); base.date = st.date; base.note = st.note.trim(); base.desc = st.desc.trim();
          base.tripId = st.trip || null; base.needsTag = false; base.updatedAt = stamp; if (group) base.splitGroup = group;
          if (!group && st.fund && base.type === 'expense') base.fundId = st.fund; else delete base.fundId;
          if (!group && st.group && !st.fund && !base.splitGroup && base.type === 'expense' && base.amount > 0) { base.share = U.calc(st.share); var pn = Math.floor(+st.people); if (pn >= 2) base.people = pn; else delete base.people; } else { delete base.share; delete base.people; }
          return base;
        }
        DB.putTx(list).then(reload).then(function () {
          if (onDone) onDone();
          if (editing) {
            closePanel();
            var was = JSON.parse(JSON.stringify(existing)), newIds = list.map(function (t) { return t.id; });
            toast('Saved.', function () { DB.deleteTx(newIds.filter(function (id) { return id !== was.id; })).then(function () { Hist.why('Undo'); return DB.putTx([was]); }).then(reload).then(function () { if (onDone) onDone(); toast('Undone.'); }); });
            return;
          }
          var total = list.reduce(function (a, t) { return a + t.amount; }, 0);
          st.msg = 'Saved ' + U.money(total, { cents: true }) + (list.length > 1 ? ' across ' + list.length + ' categories' : ' to ' + catName(list[0].categoryId)) + '. Add the next one or close.';
          st.msgBad = false; st.amount = ''; Safety.guard('add', false); st.group = false; st.share = ''; st.people = '2'; st.shareAuto = true; st.note = ''; st.desc = ''; st.catTouched = false; st.catWhy = ''; st.split = false; st.lines = [{ amount: '', cat: '' }, { amount: '', cat: '' }];
          draw(); var a = p.querySelector('#amt'); if (a) a.focus();
        }).catch(function (e) { fail('Could not save: ' + e.message); });
      }
      function del() {
        var was = JSON.parse(JSON.stringify(existing));
        DB.deleteTx(existing.id).then(reload).then(function () {
          closePanel(); if (onDone) onDone();
          toast('Deleted "' + (was.desc || catName(was.categoryId)) + '".', function () { DB.putTx([was]).then(reload).then(function () { if (onDone) onDone(); toast('Restored.'); }); });
        });
      }
      draw();
    }, { label: editing ? 'Edit transaction' : 'Add expense' });
  }

  /* Small confirmation bar at the top of the screen. */
  /* The last message survives a screen redraw for a few seconds (and an Undo stays until used or replaced). */
  var lastToast = null;
  function toast(text, undo) { lastToast = { text: text, undo: undo || null, at: Date.now() }; showToast(); }
  function showToast() {
    var main = document.getElementById('main'), old = document.getElementById('toast'); if (old) old.remove();
    if (!lastToast || !main || (!lastToast.undo && Date.now() - lastToast.at > 6000)) return;
    var cur = lastToast;
    var t = h('div', { id: 'toast', class: 'toast' + (U.fresh(cur.at) ? ' enter' : ''), role: 'status' }, h('span', null, cur.text),
      cur.undo ? h('button', { type: 'button', class: 'btn link', style: { color: 'inherit' }, onclick: function () { lastToast = null; t.remove(); cur.undo(); } }, 'Undo') : null);
    // with a side panel open the bar goes inside it (under its heading), so Undo is never hidden behind the panel
    var panel = document.querySelector('#layer .panel');
    if (panel && panel.firstChild) panel.insertBefore(t, panel.firstChild.nextSibling); else main.insertBefore(t, main.firstChild);
    if (!cur.undo) setTimeout(function () { if (t.parentNode) t.remove(); if (lastToast === cur) lastToast = null; }, 6000 - (Date.now() - cur.at));
  }
  function dropToast(olderThanMs) { if (lastToast && Date.now() - lastToast.at > (olderThanMs || 0)) lastToast = null; }

  /* Screen-reader announcement through one live region that is always on the page. */
  function announce(msg) {
    var a = document.getElementById('announcer');
    if (!a) { a = h('div', { id: 'announcer', class: 'sr-only', 'aria-live': 'polite', role: 'status' }); document.body.appendChild(a); }
    a.textContent = ''; setTimeout(function () { a.textContent = msg; }, 30);
  }

  /* Confidence label: a word plus a dot whose fill also differs (full, half, empty), with the reason in a tooltip and for screen readers. */
  function confLabel(conf, why) {
    if (!conf) return null;
    var word = Learn.WORD[conf] || conf;
    return h('span', { class: 'conf conf-' + conf, title: why || '' }, h('span', { class: 'conf-dot', 'aria-hidden': 'true' }), word, why ? h('span', { class: 'sr-only' }, ': ' + why) : null);
  }

  function statusClass(level) { return level === 'red' ? 'red' : level === 'amber' ? 'amber' : 'ok'; }
  function bar(pct, level, pace) {
    var fill = h('div', { class: 'fill' + (level === 'red' ? ' red' : level === 'amber' ? ' amber' : level === 'save' ? ' save' : '') });
    fill.style.width = Math.max(0, Math.min(100, pct * 100)) + '%';
    var b = h('div', { class: 'bar', 'aria-hidden': 'true' }, fill);
    if (pace !== null && pace !== undefined && pace > 0 && pace < 1) { var m = h('div', { class: 'pace' }); m.style.left = (pace * 100) + '%'; b.appendChild(m); }
    return b;
  }

  return { confLabel: confLabel, announce: announce, reload: reload, saveCfg: saveCfg, nav: nav, closeMenu: closeMenu, openPanel: openPanel, closePanel: closePanel, onPanelClose: onPanelClose, panelHead: panelHead, categorySelect: categorySelect,
    acctName: acctName, catName: catName, histSay: histSay, histStamp: stamp, expensePanel: expensePanel, toast: toast, showToast: showToast, dropToast: dropToast, statusClass: statusClass, bar: bar, travelCat: travelCat };
})();
