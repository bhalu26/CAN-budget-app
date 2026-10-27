/* Review: flagged lines one at a time, as a card. Every choice is saved before the next card shows
   (never advances past an unsaved choice); Z or ← undoes the last decision and brings its card back.
   Keys: Enter/Y looks right · 1–9 choose · A always-tag toggle · S/→ skip · Z/← undo. */
var ReviewStack = (function () {
  'use strict';
  var h = U.h;
  var st = { skipped: {}, always: false, history: [], shownAt: 0, pick: '' };

  function queue() {
    return App.txs.filter(function (t) { return t.needsTag && !st.skipped[t.id]; })
      .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.id < b.id ? -1 : 1); });
  }
  function waiting() { return App.txs.filter(function (t) { return t.needsTag; }).length; }

  /* Up to 9 likely categories: the suggestion, what this merchant was tagged before, recent picks, then the special ones. */
  function choices(t) {
    var out = [], seen = {}, cm = M.catMap(App.cfg), key = M.merchantKey(t.desc);
    function add(id) { if (id && !seen[id] && (cm[id] && !cm[id].archived || /^_/.test(id)) && out.length < 9) { seen[id] = 1; out.push(id); } }
    add(t.categoryId);
    var past = {};
    App.txs.forEach(function (o) { if (o.id !== t.id && !o.needsTag && o.categoryId && key && M.merchantKey(o.desc) === key) past[o.categoryId] = (past[o.categoryId] || 0) + 1; });
    Object.keys(past).sort(function (a, b) { return past[b] - past[a]; }).forEach(add);
    if (t.direction === 'in' || t.type === 'pending') { add('_income'); add('_transfer'); }
    var recent = {};
    App.txs.slice().sort(function (a, b) { return (b.reviewedAt || b.createdAt || '') < (a.reviewedAt || a.createdAt || '') ? -1 : 1; })
      .forEach(function (o) { if (o.categoryId && !o.needsTag && Object.keys(recent).length < 12) recent[o.categoryId] = 1; });
    Object.keys(recent).forEach(add);
    ['groceries', 'dine-out', 'other-household', 'taxi', '_transfer', '_exclude', '_income'].forEach(add);
    return out;
  }

  /* Save one decision (cat = null keeps the category: "Looks right"). With Always, saves a rule and updates the same merchant everywhere. */
  function decide(t, cat) {
    cat = cat || t.categoryId;
    if (!cat) { UI.toast('Choose a category for this one first.'); return; }
    var key = M.merchantKey(t.desc), always = st.always && !!key;
    var targets = [t].concat(always ? App.txs.filter(function (o) { return o.id !== t.id && M.merchantKey(o.desc) === key; }) : []);
    var before = targets.map(function (o) { return JSON.parse(JSON.stringify(o)); });
    var stamp = new Date().toISOString();
    var confirmed = cat === t.categoryId;
    var after = targets.map(function (o) { var n = M.retype(App.cfg, o, cat); n.needsTag = false; n.reviewedAt = stamp; n.updatedAt = stamp; n.conf = 'sure'; n.tagWhy = confirmed ? 'You confirmed this' : 'You chose this'; return n; });
    var rulesBefore = (App.cfg.rules || []).slice();
    if (always) App.cfg.rules = rulesBefore.filter(function (r) { return r.merchant !== key; }).concat([{ merchant: key, categoryId: cat, createdAt: stamp }]);
    st.history.push({ before: before, rulesBefore: always ? rulesBefore : null, id: t.id });
    st.always = false; st.pick = '';
    Hist.why('Review');
    var save = always ? DB.putAll(App.cfg, after) : DB.putTx(after);
    return save.then(UI.reload).then(function () {
      st.shownAt = Date.now();
      App.render();
      UI.toast((t.desc || 'Transaction') + ' → ' + UI.catName(cat) + '.' + (always ? ' Rule saved' + (targets.length > 1 ? '; ' + (targets.length - 1) + ' more updated.' : '.') : ''), undo);
    }).catch(function (e) { st.history.pop(); if (always) App.cfg.rules = rulesBefore; UI.toast('Could not save: ' + e.message); });
  }
  function undo() {
    var last = st.history.pop();
    if (!last) { UI.toast('Nothing to undo here.'); return; }
    if (last.rulesBefore) App.cfg.rules = last.rulesBefore;
    delete st.skipped[last.id];
    Hist.why('Undo');
    (last.rulesBefore ? DB.putAll(App.cfg, last.before) : DB.putTx(last.before)).then(UI.reload).then(function () {
      st.shownAt = Date.now(); App.render(); UI.toast('Undone. ' + (last.before[0].desc || 'It') + ' is back for review.');
    });
  }
  function skip(t) { st.skipped[t.id] = true; st.always = false; st.pick = ''; st.shownAt = Date.now(); App.render(); }

  function render(main) {
    var q = queue(), total = waiting(), done = st.history.length, t = q[0];
    var skippedN = Object.keys(st.skipped).filter(function (id) { return App.txs.some(function (x) { return x.id === id && x.needsTag; }); }).length;
    main.appendChild(h('header', { class: 'row between' }, h('h1', null, 'Review'),
      h('div', { class: 'row' },
        h('a', { class: 'btn', href: '#/transactions?f=review' }, 'See all as a list'),
        h('button', { type: 'button', class: 'btn icon', 'aria-label': 'Keyboard shortcuts', title: 'Keyboard shortcuts (?)', onclick: Keys.help }, '?'))));
    if (!t) {
      main.appendChild(h('div', { class: 'card pad stack' },
        h('h2', null, skippedN ? 'Only skipped ones left' : 'Nothing waiting for review'),
        h('p', { class: 'muted', style: { margin: 0 } }, skippedN ? 'You skipped ' + skippedN + ' for now.' : (done ? 'You reviewed ' + done + ' this time. Every line has a category.' : 'Imported lines that need a look will wait here.')),
        h('div', { class: 'row' }, skippedN ? h('button', { type: 'button', class: 'btn primary', onclick: function () { st.skipped = {}; App.render(); } }, 'Review the skipped ones')
          : h('a', { class: 'btn primary', href: '#/transactions' }, 'Go to transactions'),
          st.history.length ? h('button', { type: 'button', class: 'btn', onclick: undo }, 'Undo the last one') : null)));
      return;
    }
    var pos = done + 1, of = done + q.length + skippedN;
    var prog = h('div', { class: 'bar', 'aria-hidden': 'true' }, h('div', { class: 'fill save', style: { width: Math.round(done / Math.max(1, of) * 100) + '%' } }));
    main.appendChild(h('div', { class: 'stack-sm' }, h('div', { class: 'row between small muted', role: 'status' },
      h('span', null, (done ? done + ' done · ' : '') + q.length + ' left' + (skippedN ? ' · ' + skippedN + ' skipped' : '')), h('span', null, 'Card ' + pos + ' of ' + of)), prog));

    var cm = M.catMap(App.cfg), c = cm[t.categoryId], key = M.merchantKey(t.desc);
    var sameN = key ? App.txs.filter(function (o) { return o.id !== t.id && M.merchantKey(o.desc) === key; }).length : 0;
    var moneyIn = t.direction === 'in' || t.type === 'income' || (t.type === 'expense' && t.amount < 0);
    var rvNote = ReviewedUI.note([t.date], 'Reviewing this line');
    var meta = [U.dayLabel(t.date) + ', ' + t.date.slice(0, 4), t.source === 'excel' ? 'Excel row ' + t.excelRow : (UI.acctName(t) || 'Added by hand')];
    if (t.note) meta.push(t.note);
    var card = h('section', { class: 'card review-card' + (U.fresh(st.shownAt) ? ' enter' : ''), 'aria-label': 'Transaction to review' },
      h('div', { class: 'row between', style: { alignItems: 'flex-start' } },
        h('div', { class: 'stack-sm', style: { minWidth: 0 } }, h('h2', { class: 'review-merchant' }, t.desc || 'No description'), h('span', { class: 'small muted' }, meta.join(' · '))),
        h('div', { class: 'review-amount' + (moneyIn ? ' ok' : '') }, (moneyIn ? '+' : '') + U.money(Math.abs(t.amount), { cents: true }), h('span', { class: 'small muted' }, moneyIn ? 'money in' : 'money out'))),
      h('div', { class: 'notice' }, h('div', { class: 'row', style: { gap: '4px 12px' } }, h('strong', null, c ? 'Suggested: ' + c.name : (t.type === 'pending' ? 'Money in with no category yet' : 'No category yet')), c && t.conf ? UI.confLabel(t.conf, t.tagWhy) : null),
        c && t.tagWhy ? h('div', { class: 'small' }, 'Why: ' + t.tagWhy) : null,
        t.reviewReason ? h('div', { class: 'small' }, t.reviewReason) : null,
        (t.flags || []).length ? h('div', { class: 'small' }, t.flags.join(' · ')) : null));

    var list = choices(t);
    var grid = h('div', { class: 'choice-grid', role: 'group', 'aria-label': 'Choose a category' });
    list.forEach(function (id, i) {
      grid.appendChild(h('button', { type: 'button', class: 'choice' + (id === t.categoryId ? ' suggested' : ''), onclick: function () { decide(t, id); } },
        h('kbd', null, String(i + 1)), h('span', null, UI.catName(id)), id === t.categoryId ? h('span', { class: 'small muted' }, 'suggested') : null));
    });
    card.appendChild(h('div', { class: 'stack-sm' }, h('div', { class: 'label' }, 'Choose a category'), grid));
    var other = UI.categorySelect('rv-other', st.pick, function (e) { st.pick = e.target.value; }, { placeholder: 'Any other category…' });
    card.appendChild(h('div', { class: 'row', style: { alignItems: 'flex-end' } },
      h('div', { class: 'field', style: { flex: '1 1 220px' } }, h('label', { for: 'rv-other' }, 'Or pick any category'), other),
      h('button', { type: 'button', class: 'btn', onclick: function () { if (!st.pick) { UI.toast('Pick a category in the list first.'); return; } decide(t, st.pick); } }, 'Use this one')));
    if (key) card.appendChild(h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'rv-always', checked: st.always, onchange: function (e) { st.always = e.target.checked; } }),
      h('span', null, 'Always tag "' + key + '" like this' + (sameN ? ' (updates ' + sameN + ' more)' : '')), h('kbd', { class: 'push' }, 'A')));
    var fund = (App.cfg.bigExpenses || []).filter(function (f) { return f.id === (t.fundId || t.fundWas); })[0];
    if (fund) card.appendChild(h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'rv-fund', checked: !!t.fundId, onchange: function (e) {
        var u = JSON.parse(JSON.stringify(t)); if (e.target.checked) { u.fundId = fund.id; delete u.fundWas; } else { u.fundWas = fund.id; delete u.fundId; }
        DB.putTx([u]).then(UI.reload).then(function () { App.render(); UI.announce(e.target.checked ? 'Paid from ' + fund.name + '.' : 'Counts as this month\'s spending.'); var b = document.getElementById('rv-fund'); if (b) b.focus(); });
      } }),
      h('span', null, 'Pay from big expense "' + fund.name + '" (not this month\'s budget)')));
    card.appendChild(h('div', { class: 'row review-actions' },
      c ? h('button', { type: 'button', class: 'btn primary', onclick: function () { decide(t, null); } }, 'Looks right: ' + c.name, h('kbd', { class: 'on-primary' }, 'Enter')) : null,
      h('button', { type: 'button', class: 'btn', onclick: function () { skip(t); } }, 'Skip for now', h('kbd', null, 'S')),
      st.history.length ? h('button', { type: 'button', class: 'btn link', onclick: undo }, 'Undo last (Z)') : null,
      (moneyIn && !t.repaysId && t.type !== 'income' && Group.open(App.txs).length) ? h('button', { type: 'button', class: 'btn', onclick: function () { GroupUI.repayFrom(t, App.render); } }, 'Repays a group bill…') : null,
      Split.canSplit(t).ok ? h('button', { type: 'button', class: 'btn', onclick: function () { SplitUI.open(t, App.render); } }, t.splitGroup ? 'Change the split…' : 'Split…') : null,
      h('button', { type: 'button', class: 'btn link', onclick: function () { UI.expensePanel(t, App.render); } }, 'Edit details')));
    if (rvNote) card.insertBefore(rvNote, card.firstChild);
    main.appendChild(card);
    main.appendChild(h('p', { class: 'small muted', style: { margin: 0 } }, 'Press a number to choose, Enter if it looks right, S to skip, Z to undo. Each choice is saved before the next card.'));
  }

  /* Called by Keys on the Review screen. Returns true when the key was used. */
  function key(e, k) {
    var t = queue()[0];
    if (k === 'z' || k === 'ArrowLeft') { undo(); return true; }
    if (!t) return false;
    if (k === 'Enter' || k === 'y') { if (e.target && e.target.closest && e.target.closest('button, a, select')) return false; if (t.categoryId) decide(t, null); else UI.toast('No suggestion yet: press a number to choose.'); return true; }
    if (k === 's' || k === 'ArrowRight') { skip(t); return true; }
    if (k === 'a') { st.always = !st.always; var b = document.getElementById('rv-always'); if (b) b.checked = st.always; UI.toast(st.always ? 'Always: on for this one.' : 'Always: off.'); return true; }
    if (/^[1-9]$/.test(k)) { var id = choices(t)[+k - 1]; if (id) { decide(t, id); return true; } }
    return false;
  }
  return { render: render, key: key };
})();
