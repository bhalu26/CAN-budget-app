/* Command palette (Ctrl+K / ⌘+K): type to find a screen, an action, a category's transactions or a month,
   or quick-add an expense by typing an amount then a category ("12.50 groceries", "4.75+3.50 dine out starbucks").
   A centred dialog: focus stays in the search field, arrows move through the results, Enter runs one, Esc closes. */
var Palette = (function () {
  'use strict';
  var h = U.h, el = null, lastFocus = null, items = [], active = 0, query = '';

  function isOpen() { return !!el; }
  function toggle() { if (el) close(); else open(); }

  /* Score how well q matches text: whole-text contains beats word starts beats letters in order; -1 = no match. */
  function score(q, text) {
    q = q.toLowerCase().trim(); text = String(text).toLowerCase();
    if (!q) return 1;
    var at = text.indexOf(q);
    if (at === 0) return 1000 - text.length;
    if (at > 0) return (text.charAt(at - 1) === ' ' ? 800 : 600) - at;
    var words = q.split(/\s+/), all = true, s = 0;
    words.forEach(function (w) { var i = text.indexOf(w); if (i < 0) all = false; else s += (i === 0 || text.charAt(i - 1) === ' ') ? 40 : 20; });
    if (all) return 300 + s;
    var j = 0, run = 0, best = 0;
    for (var i = 0; i < text.length && j < q.length; i++) { if (text[i] === q[j]) { j++; run++; best = Math.max(best, run); } else run = 0; }
    // letters in order only count when a good part of them sit together (so "dine" does not match "Fees & Admin")
    var lead = text.charAt(0) === q.charAt(0) && (best >= 2 || q.length <= 2);   // shorthand like "grcr" or "tx"
    return j === q.length && (best >= Math.ceil(q.length * 0.6) || lead) ? 100 + best * 5 - text.length / 10 : -1;
  }

  /* "12.50 groceries at the corner store" -> {amount, expr, cat, desc}; null when the first word is not an amount. */
  function parseQuick(q) {
    var m = /^\s*(\S+)\s+(.+)$/.exec(q || '');
    if (!m || !/\d/.test(m[1])) return null;
    var amount = U.calc(m[1]);
    if (amount === null || amount === 0) return null;
    var words = m[2].trim().split(/\s+/), cats = App.cfg.categories.filter(function (c) { return !c.archived; }).concat(M.SPECIAL);
    var best = null;
    for (var n = Math.min(3, words.length); n >= 1 && !best; n--) {
      var part = words.slice(0, n).join(' ').toLowerCase().replace(/[^a-z0-9&/ ]/g, '');
      cats.forEach(function (c) {
        var name = c.name.toLowerCase(), sc = name === part ? 1000 : name.indexOf(part) === 0 ? 800 : name.split(/[\s/&]+/).some(function (w) { return w && w.indexOf(part) === 0; }) ? 600 : -1;
        if (part.length >= 2 && sc > 0 && (!best || sc > best.sc)) best = { c: c, sc: sc, used: n };
      });
    }
    return { amount: amount, expr: m[1], cat: best ? best.c : null, desc: best ? words.slice(best.used).join(' ') : m[2].trim() };
  }

  function quickAdd(p) {
    var stamp = new Date().toISOString();
    var t = { id: U.uid(), source: 'manual', createdAt: stamp, updatedAt: stamp, flags: [], amount: p.amount, expr: /[+\-*/]/.test(p.expr.replace(/^-/, '')) ? p.expr : null,
      categoryId: p.cat.id, type: M.typeFor(App.cfg, p.cat.id), date: U.today(), note: '', desc: p.desc, tripId: null, needsTag: false };
    return DB.putTx([t]).then(UI.reload).then(function () {
      App.render();
      UI.toast('Added ' + U.money(p.amount, { cents: true }) + ' to ' + p.cat.name + (p.desc ? ' (' + p.desc + ')' : '') + ', today.', function () {
        DB.deleteTx(t.id).then(UI.reload).then(App.render).then(function () { UI.toast('Removed.'); });
      });
    });
  }

  function go(hash) { return function () { location.hash = hash; }; }
  function sources(q) {
    var out = [], ro = App.readOnly, now = U.ym(U.today()), ym = App.month || now;
    var review = App.txs.filter(function (t) { return t.needsTag; }).length;
    // quick add first when the text starts with an amount
    var p = !ro && parseQuick(q);
    if (p) {
      if (p.cat) out.push({ group: 'Quick add', label: 'Add ' + U.money(p.amount, { cents: true }) + ' to ' + p.cat.name + (p.desc ? ' · ' + p.desc : ''), hint: 'today · Enter', run: function () { return quickAdd(p); }, pin: 2000 });
      out.push({ group: 'Quick add', label: 'Add ' + U.money(p.amount, { cents: true }) + (p.cat ? ' with more details…' : ' and choose a category…'), hint: 'opens the form', pin: 1900,
        run: function () { UI.expensePanel(null, App.render, { amount: p.expr, cat: p.cat ? p.cat.id : '', desc: p.desc }); } });
    }
    [['Home', '#/home', 'G H'], ['Transactions', '#/transactions', 'G T'], ['Insights', '#/insights', 'G I'], ro ? null : ['Review' + (review ? ' · ' + review + ' waiting' : ''), '#/review', 'G R'],
      ro ? null : ['Import bank files', '#/import', 'G M'], ro ? null : ['Data health: duplicates, balances, errors', '#/health', 'G D'], ro ? null : ['Settings', '#/settings', 'G S'],
      ro ? null : ['Settings: Bills & subscriptions', '#/bills', 'G B'], ro ? null : ['Settings: Rules (tagging rules)', '#/rules', 'G U'], ro ? null : ['Settings: Accounts', '#/accounts', 'G A'], ro ? null : ['Settings: Backup & sharing', '#/backup', 'G K']]
      .filter(Boolean).forEach(function (s) { out.push({ group: 'Go to', label: s[0], hint: s[2], run: go(s[1]) }); });
    [['Insights: month grid (categories × months)', 'grid', 'year grid heatmap table categories by month'], ['Insights: income, spent and saved by month', 'flow', 'year cash flow savings rate left over']].forEach(function (v) { out.push({ group: 'Go to', label: v[0], hint: 'Insights', keywords: v[2], run: function () { Insights.setView(v[1]); location.hash = '#/insights'; App.render(); } }); });
    if (!ro) out.push({ group: 'Actions', label: 'Add an expense', hint: 'N', run: function () { UI.expensePanel(null, App.render); } });
    if (!ro) out.push({ group: 'Actions', label: 'Bills & subscriptions', hint: 'G B', keywords: 'recurring upcoming due netflix subscription bill paycheque', run: go('#/bills') });
    out.push({ group: 'Actions', label: 'Show keyboard shortcuts', hint: '?', run: Keys.help });
    [['system', 'Match my computer'], ['light', 'Light'], ['dark', 'Dark']].forEach(function (o) {
      out.push({ group: 'Actions', label: 'Theme: ' + o[1] + (Theme.get() === o[0] ? ' (current)' : ''), keywords: 'appearance dark mode light mode colour color', run: function () { Theme.set(o[0]); } });
    });
    if (!ro) {
      out.push({ group: 'Actions', label: 'Download a backup', keywords: 'export save', run: function () { Settings.exportBackup(); } });
      if (App.cfg.share && App.cfg.share.salt) {
        out.push({ group: 'Actions', label: 'Save a shared snapshot', keywords: 'wife share read-only', run: Share.saveFlow });
        out.push({ group: 'Actions', label: 'Test opening a snapshot', keywords: 'restore check passphrase', run: Share.testFlow });
      }
      out.push({ group: 'Actions', label: 'Customize Home', keywords: 'reorder sections cards order', run: function () { location.hash = '#/home'; setTimeout(function () { if (window.Home && Home.customize) Home.customize(); }, 50); } });
    } else out.push({ group: 'Actions', label: 'Lock the snapshot', run: Share.lock });
    M.groupsWithCats(App.cfg).forEach(function (gc) {
      gc.cats.forEach(function (c) {
        out.push({ group: 'Categories', label: c.name + ': ' + U.monthLabel(ym), hint: gc.group.name, keywords: gc.group.name, run: go('#/transactions?cat=' + encodeURIComponent(c.id) + '&m=' + ym) });
        out.push({ group: 'Categories', label: c.name + ': ' + ym.slice(0, 4) + ' so far', hint: 'Insights', bias: -20, keywords: gc.group.name + ' year insights', run: function () { location.hash = '#/insights'; setTimeout(function () { if (Insights.openCategory) Insights.openCategory(c.id); }, 50); } });
      });
    });
    var months = {}; App.txs.forEach(function (t) { months[t.date.slice(0, 7)] = 1; }); months[now] = 1;
    Object.keys(months).sort().reverse().slice(0, 24).forEach(function (m) {
      out.push({ group: 'Months', label: U.monthLabel(m), hint: m === now ? 'this month' : '', run: function () { App.month = m; if (location.hash !== '#/home' && location.hash !== '') location.hash = '#/home'; else App.render(); } });
    });
    if (q.trim() && !p) {
      out.push({ group: 'Search', label: 'Find "' + q.trim() + '" in all transactions', pin: 1, run: go('#/transactions?scope=all&q=' + encodeURIComponent(q.trim())) });
      if (!ro) out.push({ group: 'Search', label: 'Test "' + q.trim() + '" against your tagging rules', pin: 0, keywords: 'rule merchant', run: go('#/rules?test=' + encodeURIComponent(q.trim())) });
    }
    return out;
  }

  function filter(q) {
    var list = sources(q);
    if (!q.trim()) return list.filter(function (it) { return it.group === 'Go to' || it.group === 'Actions'; }).slice(0, 12);
    var p = parseQuick(q);
    return list.map(function (it) {
      var kw = it.keywords ? score(q, it.keywords) : -1;
      var s = it.pin !== undefined ? it.pin : Math.max(score(q, it.label), kw >= 300 ? kw - 50 : -1);   // keywords count only on real word matches
      if (s >= 0 && it.bias) s += it.bias;
      return { it: it, s: p && it.group !== 'Quick add' ? -1 : s };
    }).filter(function (x) { return x.s >= 0; }).sort(function (a, b) { return b.s - a.s; }).slice(0, 14).map(function (x) { return x.it; });
  }

  function draw() {
    var list = el.querySelector('#pal-list'); U.clear(list);
    var input = el.querySelector('#pal-q');
    items = filter(query);
    active = Math.min(active, Math.max(0, items.length - 1));
    var lastGroup = null;
    items.forEach(function (it, i) {
      if (it.group !== lastGroup) { list.appendChild(h('li', { role: 'presentation', class: 'pal-group' }, it.group)); lastGroup = it.group; }
      list.appendChild(h('li', { id: 'pal-opt-' + i, role: 'option', class: 'pal-item', 'aria-selected': i === active ? 'true' : 'false',
        onmousemove: function () { if (active !== i) { active = i; mark(); } }, onclick: function () { run(i); } },
        h('span', null, it.label), it.hint ? h('span', { class: 'small muted' }, it.hint) : null));
    });
    if (!items.length) list.appendChild(h('li', { role: 'presentation', class: 'pal-empty muted' }, 'Nothing matches. Try a screen, a category, a month, or an amount and a category.'));
    input.setAttribute('aria-activedescendant', items.length ? 'pal-opt-' + active : '');
    el.querySelector('#pal-count').textContent = items.length ? items.length + ' result' + (items.length === 1 ? '' : 's') : 'No results';
  }
  function mark() {
    Array.prototype.forEach.call(el.querySelectorAll('.pal-item'), function (li, i) { li.setAttribute('aria-selected', i === active ? 'true' : 'false'); });
    el.querySelector('#pal-q').setAttribute('aria-activedescendant', 'pal-opt-' + active);
    var cur = el.querySelector('#pal-opt-' + active); if (cur) cur.scrollIntoView({ block: 'nearest' });
  }
  function run(i) {
    var it = items[i]; if (!it) return;
    close(true);
    Promise.resolve().then(it.run).catch(function (e) { UI.toast('That did not work: ' + e.message); });
  }

  function open() {
    if (el) return;
    if (document.getElementById('layer').firstChild) UI.closePanel();
    lastFocus = document.activeElement; query = ''; active = 0;
    var input = h('input', { id: 'pal-q', class: 'pal-input', type: 'text', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'pal-list', 'aria-autocomplete': 'list',
      'aria-label': 'Search screens, categories, months and actions, or type an amount and a category', placeholder: 'Search, or type "12.50 groceries" to add', autocomplete: 'off', spellcheck: 'false',
      oninput: function (e) { query = e.target.value; active = 0; draw(); },
      onkeydown: function (e) {
        if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); mark(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); mark(); }
        else if (e.key === 'Home' && e.ctrlKey) { e.preventDefault(); active = 0; mark(); }
        else if (e.key === 'Enter') { e.preventDefault(); run(active); }
        else if (e.key === 'Escape') { e.preventDefault(); close(); }
        else if (e.key === 'Tab') { e.preventDefault(); }   // focus stays in the palette
      } });
    el = h('div', { class: 'pal-overlay' },
      h('button', { type: 'button', class: 'scrim', 'aria-label': 'Close', tabindex: '-1', onclick: function () { close(); } }),
      h('div', { class: 'pal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Search and commands' },
        h('div', { class: 'pal-head' }, h('span', { class: 'pal-icon', 'aria-hidden': 'true' }, '⌕'), input, h('kbd', null, 'Esc')),
        h('ul', { id: 'pal-list', role: 'listbox', class: 'pal-list', 'aria-label': 'Results' }),
        h('div', { class: 'pal-foot small muted' }, h('span', { id: 'pal-count', 'aria-live': 'polite' }), h('span', null, h('kbd', null, '↑'), ' ', h('kbd', null, '↓'), ' to move · ', h('kbd', null, 'Enter'), ' to choose'))));
    document.body.appendChild(el);
    draw();
    input.focus();
  }
  function close(keepFocus) {
    if (!el) return;
    var old = el; el = null;
    Array.prototype.forEach.call(old.querySelectorAll('[id]'), function (e) { e.removeAttribute('id'); });
    old.classList.add('leaving'); setTimeout(function () { old.remove(); }, 150);
    if (!keepFocus && lastFocus && lastFocus.focus && document.body.contains(lastFocus)) lastFocus.focus();
  }

  return { open: open, close: close, toggle: toggle, isOpen: isOpen, _parseQuick: parseQuick, _score: score };
})();
