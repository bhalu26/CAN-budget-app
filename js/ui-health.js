/* Data health screen: what could make the numbers wrong, why, and a way to fix or dismiss each one. Nothing changes without a click, and every fix has Undo. */
var HealthUI = (function () {
  'use strict';
  var h = U.h, showRecent = false, showIgnored = false, confirmId = null, open = {}, cache = null;

  /* The same result for the menu badge, Home and this screen, recomputed only when the data changes. */
  function summary() {
    var cfg = App.cfg; if (!cfg || !App.txs) return null;
    var sig = JSON.stringify([U.today(), cfg.healthIgnore || [], (cfg.categories || []).length, (cfg.accounts || []).map(function (a) { var b = a.balances || []; return [a.id, a.closed, b.length, b.length ? b[b.length - 1].amount : 0]; })]);
    if (!cache || cache.txs !== App.txs || cache.sig !== sig) cache = { txs: App.txs, sig: sig, res: Health.check(cfg, App.txs, U.today()) };
    return cache.res;
  }
  function byId() { var o = {}; App.txs.forEach(function (t) { o[t.id] = t; }); return o; }
  function acctName(t) { return UI.acctName(t) || (t.source === 'manual' ? 'Added by hand' : ''); }
  function setIgnore(key, on) {
    var before = (App.cfg.healthIgnore || []).slice();
    App.cfg.healthIgnore = on ? before.concat([key]) : before.filter(function (k) { return k !== key; });
    UI.saveCfg().then(function () {
      App.render();
      UI.toast(on ? 'Ignored. It stays listed under Ignored.' : 'Back on the list.', function () { App.cfg.healthIgnore = before; UI.saveCfg().then(function () { App.render(); UI.toast('Undone.'); }); });
    });
  }
  function removeTx(t) {
    var was = JSON.parse(JSON.stringify(t)); confirmId = null;
    DB.deleteTx(t.id).then(UI.reload).then(function () {
      App.render();
      UI.toast('Deleted "' + (was.desc || 'line') + '" ' + U.money(Math.abs(was.amount), { cents: true }) + '.', function () { DB.putTx([was]).then(UI.reload).then(function () { App.render(); UI.toast('Restored.'); }); });
    });
  }

  function txRow(t, issue) {
    var ck = issue.key + '|' + t.id, asked = confirmId === ck;
    return h('li', { class: 'hl-tx' },
      h('div', { class: 'hl-tx-main' },
        h('span', { class: 'strong' }, t.desc || 'No name'), h('span', { class: 'muted' }, ' · ' + (t.date ? U.shortDate(t.date) + ' ' + t.date.slice(0, 4) : 'no date') + ' · ' + acctName(t) + (t.source === 'manual' ? '' : t.file ? ' · ' + t.file : '') + ' · ' + UI.catName(t.categoryId))),
      h('div', { class: 'hl-tx-amt' }, (t.direction === 'in' || t.type === 'income' ? 'in ' : 'out ') + U.money(Math.abs(t.amount), { cents: true })),
      h('div', { class: 'row hl-tx-act' },
        h('button', { type: 'button', class: 'btn link', 'aria-label': 'Edit ' + (t.desc || 'line') + ' ' + U.money(Math.abs(t.amount), { cents: true }), onclick: function () { UI.expensePanel(t, App.render); } }, 'Edit'),
        issue.kind === 'duplicate' ? h('button', { type: 'button', class: 'btn link', 'aria-label': 'Delete this copy of ' + (t.desc || 'line'), onclick: function () { confirmId = ck; App.render(); } }, 'Delete this one') : null),
      asked ? h('div', { class: 'toast warn hl-confirm', role: 'alert' }, h('span', null, 'Delete "' + (t.desc || 'line') + '" ' + U.money(Math.abs(t.amount), { cents: true }) + ' from ' + U.shortDate(t.date) + '? The other copy stays.'),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn danger', onclick: function () { removeTx(t); } }, 'Delete'), h('button', { type: 'button', class: 'btn', onclick: function () { confirmId = null; App.render(); } }, 'Keep it'))) : null);
  }

  function card(i, ids) {
    var ts = i.txIds.map(function (id) { return ids[id]; }).filter(Boolean), id = 'hl-' + i.key.replace(/[^a-z0-9]+/gi, '-'), more = ts.length > 5 && !open[i.key];
    var shown = more ? ts.slice(0, 5) : ts;
    var acts = [];
    if (i.link) acts.push(h('a', { class: 'btn', href: i.link }, i.linkText));
    if (i.kind === 'split' && ts[0]) acts.push(h('button', { type: 'button', class: 'btn', onclick: function () { SplitUI.open(ts[0], App.render); } }, 'Change the split'));
    if (i.kind === 'reviewed') acts.push(h('button', { type: 'button', class: 'btn', onclick: function () { ReviewedUI.changes(i.month); } }, 'See what changed'), h('button', { type: 'button', class: 'btn', onclick: function () { ReviewedUI.mark(i.month, true); } }, 'Review again'));
    if (i.kind === 'balance') acts.push(h('a', { class: 'btn', href: '#/accounts' }, 'Open Accounts'), h('a', { class: 'btn', href: '#/transactions' }, 'See transactions'));
    if (i.kind === 'gap' || i.kind === 'transfer') acts.push(h('a', { class: 'btn', href: i.kind === 'gap' ? '#/import' : '#/transactions?f=other&scope=all' }, i.kind === 'gap' ? 'Import a file' : 'See them'));
    acts.push(i.ignored
      ? h('button', { type: 'button', class: 'btn', onclick: function () { setIgnore(i.key, false); } }, 'Stop ignoring')
      : h('button', { type: 'button', class: 'btn', onclick: function () { setIgnore(i.key, true); } }, i.kind === 'duplicate' ? 'Not a duplicate: keep all' : i.kind === 'odd' ? 'It is correct' : 'Ignore this'));
    return h('article', { class: 'hl-card hl-' + i.level + (i.ignored ? ' hl-off' : ''), 'aria-labelledby': id },
      h('div', { class: 'row between' }, h('span', { class: 'hl-level' }, Health.LEVEL_WORD[i.level]), i.amount ? h('span', { class: 'muted small' }, U.money(i.amount, { cents: true }) + (i.kind === 'duplicate' ? ' possibly counted twice' : i.kind === 'review' ? ' counted before you confirm' : '')) : null),
      h('h3', { id: id }, i.title), h('p', { class: 'hl-detail' }, i.detail),
      shown.length ? h('ul', { class: 'hl-list' }, shown.map(function (t) { return txRow(t, i); })) : null,
      more ? h('button', { type: 'button', class: 'btn link', onclick: function () { open[i.key] = true; App.render(); } }, 'Show all ' + ts.length) : null,
      h('div', { class: 'row' }, acts));
  }

  function render(main) {
    var res = summary(), ids = byId(), live = res.open, by = { high: 0, medium: 0, low: 0 };
    live.forEach(function (i) { by[i.level]++; });
    main.appendChild(h('header', { class: 'stack-sm' },
      h('h1', null, live.length ? (live.length + ' thing' + (live.length === 1 ? '' : 's') + ' to check') : 'All clear'),
      h('p', { class: 'muted', style: { margin: 0 } }, live.length
        ? by.high + ' affect' + (by.high === 1 ? 's' : '') + ' your numbers · ' + by.medium + ' worth checking · ' + by.low + ' for information. Nothing changes until you click.'
        : 'No duplicates, unbalanced accounts or odd lines found in ' + res.lines + ' transactions' + (res.ignored ? ' (' + res.ignored + ' ignored)' : '') + '.')));
    main.appendChild(h('section', { class: 'card pad stack-sm', 'aria-labelledby': 'hl-checked' }, h('h2', { id: 'hl-checked' }, 'What is checked'),
      h('ul', { class: 'hl-checks' }, res.checks.map(function (c) { return h('li', null, h('span', { class: c.count ? 'amber strong' : 'ok strong' }, c.count ? c.count + ' to look at' : '✓ none'), h('span', null, ' ' + c.label)); }))));
    ['high', 'medium', 'low'].forEach(function (lv) {
      var list = live.filter(function (i) { return i.level === lv; });
      if (list.length) main.appendChild(h('section', { class: 'stack', 'aria-label': Health.LEVEL_WORD[lv] }, list.map(function (i) { return card(i, ids); })));
    });
    var rc = Hist.recent(App.txs, 20);
    if (rc.length) {
      main.appendChild(h('button', { type: 'button', class: 'btn link', 'aria-expanded': showRecent ? 'true' : 'false', style: { alignSelf: 'flex-start' }, onclick: function () { showRecent = !showRecent; App.render(); } }, (showRecent ? 'Hide' : 'Show') + ' recent changes (' + rc.length + ')'));
      if (showRecent) main.appendChild(h('section', { class: 'card pad stack-sm', 'aria-labelledby': 'hl-recent' }, h('h2', { id: 'hl-recent' }, 'Recent changes'),
        h('p', { class: 'small muted', style: { margin: 0 } }, 'The latest edits to your lines, newest first. Open one to see its full history or change it back.'),
        h('ul', { class: 'hist-list' }, rc.map(function (e) {
          return h('li', null, h('div', { class: 'row between' }, h('span', null, h('strong', null, e.t.desc || 'No name'), h('span', { class: 'muted small' }, ' · ' + U.shortDate(e.t.date) + ' · ' + UI.histStamp(e.at) + ' · ' + e.why)),
            h('button', { type: 'button', class: 'btn link', 'aria-label': 'Open ' + (e.t.desc || 'line') + ' ' + U.money(Math.abs(e.t.amount), { cents: true }), onclick: function () { UI.expensePanel(e.t, App.render); } }, 'Open')),
            e.c.map(function (c) { return h('div', { class: 'small' }, UI.histSay(c)); }));
        }))));
    }
    if (res.ignored) {
      main.appendChild(h('button', { type: 'button', class: 'btn link', 'aria-expanded': showIgnored ? 'true' : 'false', style: { alignSelf: 'flex-start' }, onclick: function () { showIgnored = !showIgnored; App.render(); } }, (showIgnored ? 'Hide' : 'Show') + ' ignored (' + res.ignored + ')'));
      if (showIgnored) main.appendChild(h('section', { class: 'stack', 'aria-label': 'Ignored' }, res.issues.filter(function (i) { return i.ignored; }).map(function (i) { return card(i, ids); })));
    }
  }
  return { render: render, summary: summary };
})();
