/* Insights views "Recurring & fixed" and "Top spending", and the "Bills still due" panel on Home. Numbers come from costs.js and spending.js. */
var CostsUI = (function () {
  'use strict';
  var h = U.h, topN = 15;
  function whole(v) { return U.money(v, { whole: true }); }
  function cents(v) { return U.money(v, { cents: true }); }
  function link(params, label, text, cls) { return h('a', { href: '#/transactions?' + params, class: cls || 'yg-cell', 'aria-label': label }, text); }
  function note(text) { return h('p', { class: 'small muted', style: { margin: 0, maxWidth: '78ch' } }, text); }
  function snap() { return { r: JSON.parse(JSON.stringify(App.cfg.recurring || [])), i: (App.cfg.recurringIgnore || []).slice(), c: JSON.parse(JSON.stringify(App.cfg.categories || [])) }; }
  function undoer(b) { return function () { App.cfg.recurring = b.r; App.cfg.recurringIgnore = b.i; App.cfg.categories = b.c; UI.saveCfg().then(function () { App.render(); UI.toast('Undone.'); }); }; }
  function save(msg, b) { return UI.saveCfg().then(function () { App.render(); UI.toast(msg, undoer(b)); }); }
  var SYM = { paid: '✓', changed: '≠', late: '✗', due: '•', future: '·', none: '' };
  var WORD = { paid: 'paid', changed: 'paid a different amount', late: 'not seen yet', due: 'due now', future: 'coming up', none: 'nothing expected' };

  function render(main, d, view) { if (view === 'recurring') recurring(main, d); else top(main, d); }

  /* ---------- Recurring & fixed ---------- */
  function sample(it) { var ms = Recurring.matches(it, App.txs); return ms.length ? ms[ms.length - 1].desc : it.name; }
  function stripCells(x, year, today) {
    var it = x.it, cells = Costs.strip(it, App.txs, year, today), name = sample(it);
    return cells.map(function (c) {
      var ml = U.MONTHS[c.m - 1], txt = ml + ': ' + WORD[c.state] + (c.amount ? ', ' + cents(c.amount) : '');
      if (c.state === 'none') return h('td', { class: 'sc-td' });
      var inner = [h('span', { class: 'sc sc-' + c.state, 'aria-hidden': 'true' }, SYM[c.state]), h('span', { class: 'sr-only' }, txt)];
      return h('td', { class: 'sc-td' }, c.amount ? h('a', { class: 'sc-link', href: '#/transactions?f=spend&scope=month&m=' + c.ym + '&q=' + encodeURIComponent(name), title: txt }, inner) : h('span', { class: 'sc-link', title: txt }, inner));
    });
  }
  function billRow(x, year, today, total, showStrip) {
    var it = x.it, pc = Costs.priceChange(it, App.txs), cat = x.cat ? x.cat.name : 'No category';
    var next = Recurring.schedule(it, today, Recurring.addMonths(today, 14))[0];
    return h('tr', null,
      h('th', { scope: 'row' }, h('button', { type: 'button', class: 'btn link ins-name', 'aria-label': 'Open ' + it.name + ' in Bills & subscriptions', onclick: function () { RecurringUI.open(); } }, it.name),
        h('div', { class: 'small muted' }, cat + ' · ' + ((Recurring.BY_ID[it.cadence] || {}).label || it.cadence).toLowerCase()),
        pc ? h('div', { class: 'small amber strong' }, '↑ ' + cents(pc.from) + ' → ' + cents(pc.to) + ' since ' + U.shortDate(pc.since) + ' (' + (pc.perYear >= 0 ? '+' : '−') + whole(Math.abs(pc.perYear)) + ' a year)') : null),
      h('td', { class: 'r' }, (it.amountMode === 'varies' ? '~' : '') + cents(it.amount)),
      h('td', { class: 'r strong' }, whole(x.perYear), h('div', { class: 'small muted' }, total ? Math.round(x.perYear / total * 100) + '%' : '')),
      showStrip ? stripCells(x, year, today) : [h('td', { class: 'r' }, whole(x.perMonth)), h('td', { class: 'r' }, next ? U.shortDate(next) : '–')]);
  }
  function section(title, id, rows, year, today, total, strip) {
    if (!rows.length) return null;
    var head = h('tr', null, h('th', { scope: 'col' }, 'Bill'), h('th', { scope: 'col', class: 'r' }, 'Amount'), h('th', { scope: 'col', class: 'r' }, 'Per year'));
    if (strip) for (var m = 0; m < 12; m++) head.appendChild(h('th', { scope: 'col', class: 'sc-th' }, U.MON[m].charAt(0), h('span', { class: 'sr-only' }, U.MONTHS[m])));
    else { head.appendChild(h('th', { scope: 'col', class: 'r' }, 'A month')); head.appendChild(h('th', { scope: 'col', class: 'r' }, 'Next due')); }
    var sub = rows.reduce(function (a, x) { return a + x.perYear; }, 0);
    return h('section', { class: 'card pad stack', 'aria-labelledby': id }, h('div', { class: 'row between' }, h('h2', { id: id }, title), h('span', { class: 'muted' }, rows.length + ' bill' + (rows.length === 1 ? '' : 's') + ' · ' + whole(sub) + ' a year · about ' + whole(sub / 12) + ' a month')),
      h('div', { class: 'scroll-x', role: 'region', 'aria-label': title, tabindex: '0' }, h('table', { class: 't yg sc', style: { minWidth: strip ? '780px' : '560px' } }, h('caption', { class: 'sr-only' }, title + ' in ' + year), h('thead', null, head),
        h('tbody', null, rows.map(function (x) { return billRow(x, year, today, total, strip); })))));
  }

  function recurring(main, d) {
    var cfg = App.cfg, year = d.year, today = d.todayStr, sm = Costs.summary(cfg), inc = Costs.avgIncome(cfg, App.txs, year, today);
    var rises = sm.items.map(function (x) { return { x: x, c: Costs.priceChange(x.it, App.txs) }; }).filter(function (r) { return r.c && r.c.perYear > 0; }), riseTotal = U.round2(rises.reduce(function (a, r) { return a + r.c.perYear; }, 0));
    if (st_acct()) main.appendChild(note('Recurring bills are shown across all your accounts, whatever account is picked above.'));
    if (!sm.items.length) main.appendChild(h('div', { class: 'card pad stack' }, h('h2', null, 'No recurring bills yet'),
      h('p', { class: 'muted', style: { margin: 0 } }, 'Add your rent, phone, subscriptions and insurance and this page shows what they cost a year, which ones are the same every month, and when one goes up.'),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onclick: RecurringUI.open }, 'Find bills & subscriptions'))));
    else {
      main.appendChild(h('div', { class: 'grid-tiles' },
        YearUI.tile('Recurring bills', whole(sm.yearly) + ' a year', 'about ' + whole(sm.monthly) + ' a month · ' + sm.items.length + ' bill' + (sm.items.length === 1 ? '' : 's'), '', { fn: RecurringUI.open, label: 'Open Bills & subscriptions.' }),
        YearUI.tile('Fixed every month', whole(sm.fixedMonthly) + ' a month', inc > 0 ? Math.round(sm.fixedMonthly / inc * 100) + '% of your average monthly income (' + whole(inc) + ')' : sm.by.fixed.n + ' bills'),
        YearUI.tile('Quarterly and yearly', whole(sm.by.nonmonthly.perYear) + ' a year', sm.by.nonmonthly.n ? 'set aside about ' + whole(sm.setAsideMonthly) + ' a month' : 'none'),
        YearUI.tile('Price rises', rises.length ? '+' + whole(riseTotal) + ' a year' : 'None', rises.length ? rises.length + ' bill' + (rises.length === 1 ? ' costs' : 's cost') + ' more than before' : 'every bill is the same as before', rises.length ? 'red' : 'ok')));
      var fixed = sm.items.filter(function (x) { return x.cls === 'fixed'; }), varies = sm.items.filter(function (x) { return x.cls === 'varies'; }), non = sm.items.filter(function (x) { return x.cls === 'nonmonthly'; });
      var s1 = section('Fixed every month', 'rc-fixed', fixed, year, today, sm.yearly, true), s2 = section('Changes every month', 'rc-varies', varies, year, today, sm.yearly, true), s3 = section('Quarterly and yearly', 'rc-non', non, year, today, sm.yearly, false);
      [s1, s2, s3].forEach(function (s) { if (s) main.appendChild(s); });
      if (s1 || s2) main.appendChild(h('div', { class: 'small muted legend' }, ['paid', 'changed', 'late', 'due', 'future'].map(function (k) { return h('span', { class: 'legend-key' }, h('span', { class: 'sc sc-' + k, 'aria-hidden': 'true' }, SYM[k]), ' ' + WORD[k]); }), h('span', null, '· Click a month to see its payment.')));
      if (sm.byCategory.length > 1) main.appendChild(h('section', { class: 'card pad stack-sm', 'aria-labelledby': 'rc-cats' }, h('h2', { id: 'rc-cats' }, 'By category'),
        h('ul', { class: 'hist-list' }, sm.byCategory.slice(0, 8).map(function (c) { return h('li', null, h('div', { class: 'row between' }, h('span', null, c.name), h('span', null, h('strong', null, whole(c.perYear)), h('span', { class: 'muted small' }, ' a year · ' + Math.round(c.perYear / sm.yearly * 100) + '%'))), h('div', { class: 'bar', 'aria-hidden': 'true' }, h('div', { class: 'fill save', style: { width: Math.round(c.perYear / sm.byCategory[0].perYear * 100) + '%' } }))); }))));
      var lc = Costs.limitCheck(cfg);
      if (lc.length) main.appendChild(h('section', { class: 'card pad stack-sm', 'aria-labelledby': 'rc-lim' }, h('h2', { id: 'rc-lim' }, 'Limits lower than your fixed bills'),
        h('p', { class: 'small muted', style: { margin: 0 } }, 'These monthly limits are less than the fixed bills in that category already add up to, so the category shows as over budget every month.'),
        lc.map(function (r) {
          var to = Math.ceil(r.fixed);
          return h('div', { class: 'row between' }, h('span', null, h('strong', null, r.cat.name), ': fixed bills ' + cents(r.fixed) + ' a month, limit ' + cents(r.limit) + ' (' + cents(r.short) + ' short)'),
            h('button', { type: 'button', class: 'btn', 'aria-label': 'Raise the ' + r.cat.name + ' limit to ' + whole(to), onclick: function () { var b = snap(); App.cfg.categories.filter(function (c) { return c.id === r.cat.id; })[0].limit = to; save(r.cat.name + ' limit is now ' + whole(to) + ' a month.', b); } }, 'Raise limit to ' + whole(to)));
        })));
    }
    // fixed-looking spending that is not in the list yet
    var lf = Costs.looksFixed(cfg, App.txs, today);
    if (lf.length) main.appendChild(h('section', { class: 'card pad stack-sm', 'aria-labelledby': 'rc-lf' }, h('h2', { id: 'rc-lf' }, 'Looks fixed, not in your list yet (' + lf.length + ')'),
      h('p', { class: 'small muted', style: { margin: 0 } }, 'Same amount at the same place on a regular schedule. Add the real ones so they count here and in your month-end estimate.'),
      lf.slice(0, 8).map(function (f) {
        return h('div', { class: 'row between' }, h('span', null, h('strong', null, f.name), h('span', { class: 'muted small' }, ' · ' + ((Recurring.BY_ID[f.cadence] || {}).label || f.cadence).toLowerCase() + ' · ' + cents(f.amount) + ' · paid ' + f.count + ' times · ' + whole(f.yearly) + ' a year')),
          h('span', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', 'aria-label': 'Add ' + f.name + ' to recurring bills', onclick: function () { var b = snap(); App.cfg.recurring = (App.cfg.recurring || []).concat([Recurring.itemFrom(f, new Date().toISOString())]); save(f.name + ' added to your recurring bills.', b); } }, 'Add'),
            h('button', { type: 'button', class: 'btn', 'aria-label': f.name + ' is not recurring', onclick: function () { var b = snap(); App.cfg.recurringIgnore = (App.cfg.recurringIgnore || []).concat([f.key + '|' + f.kind]); save(f.name + ' will not be suggested again.', b); } }, 'Not recurring')));
      })));
    main.appendChild(note('Costs use each bill\'s amount and how often it comes. Paused bills and money-in items (paycheques) are left out. "≠" means it was paid, but not the amount on file.'));
  }
  function st_acct() { return document.getElementById('ins-acct') && document.getElementById('ins-acct').value !== 'all'; }

  /* ---------- Top spending ---------- */
  function top(main, d) {
    var year = d.year, m = Spending.merchants(d.txs, year), big = Spending.biggest(d.txs, year, 15);
    if (!m.rows.length) { main.appendChild(h('div', { class: 'card pad muted' }, 'No spending recorded for ' + year + ' yet.')); return; }
    var most = m.rows.slice().sort(function (a, b) { return b.count - a.count || b.total - a.total; })[0];
    main.appendChild(h('div', { class: 'grid-tiles' },
      YearUI.tile('Biggest merchant', m.rows[0].name, whole(m.rows[0].total) + ' · ' + Math.round(m.rows[0].share * 100) + '% of all spending', '', { href: '#/transactions?f=spend&scope=year&m=' + year + '-01&q=' + encodeURIComponent(m.rows[0].name), label: 'See ' + m.rows[0].name + ' transactions this year.' }),
      YearUI.tile('Most visits', most.name, most.count + ' times · ' + whole(most.total) + ' in total', '', { href: '#/transactions?f=spend&scope=year&m=' + year + '-01&q=' + encodeURIComponent(most.name), label: 'See ' + most.name + ' transactions this year.' }),
      big[0] ? YearUI.tile('Biggest single expense', cents(big[0].counted), (big[0].t.desc || 'No name') + ' · ' + U.shortDate(big[0].t.date), '', { fn: function () { UI.expensePanel(big[0].t, App.render); }, label: 'Open this transaction.' }) : null,
      YearUI.tile('Merchants', String(m.rows.length), 'in ' + year + ' · ' + whole(m.total) + ' spent')));
    var shown = m.rows.slice(0, topN), max = shown.length ? shown[0].total : 1;
    main.appendChild(h('section', { class: 'card pad stack', 'aria-labelledby': 'tp-m' }, h('h2', { id: 'tp-m' }, 'Top merchants'),
      h('div', { class: 'scroll-x', role: 'region', 'aria-label': 'Top merchants', tabindex: '0' }, h('table', { class: 't yg', style: { minWidth: '640px' } }, h('caption', { class: 'sr-only' }, 'Top merchants in ' + year + ', biggest first'),
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, '#'), h('th', { scope: 'col' }, 'Merchant'), h('th', { scope: 'col' }, 'Mostly'), h('th', { scope: 'col', class: 'r' }, 'Times'), h('th', { scope: 'col', class: 'r' }, 'Average'), h('th', { scope: 'col', class: 'r' }, 'Total'), h('th', { scope: 'col' }, 'Share'))),
        h('tbody', null, shown.map(function (r, i) {
          return h('tr', null, h('td', { class: 'muted' }, String(i + 1)),
            h('th', { scope: 'row' }, h('a', { class: 'ins-link strong', href: '#/transactions?f=spend&scope=year&m=' + year + '-01&q=' + encodeURIComponent(r.name), 'aria-label': r.name + ': ' + cents(r.total) + ' in ' + r.count + ' transactions. Open them.' }, r.name), r.fund ? h('span', { class: 'small muted' }, ' · includes a big-expense payment') : null),
            h('td', null, r.catId ? UI.catName(r.catId) : '–'), h('td', { class: 'r' }, String(r.count)), h('td', { class: 'r' }, cents(r.avg)), h('td', { class: 'r strong' }, cents(r.total)),
            h('td', null, h('div', { class: 'share-cell' }, h('div', { class: 'bar', 'aria-hidden': 'true' }, h('div', { class: 'fill save', style: { width: Math.max(2, Math.round(r.total / max * 100)) + '%' } })), h('span', { class: 'small' }, (r.share * 100 >= 1 ? Math.round(r.share * 100) : '<1') + '%'))));
        })))),
      m.rows.length > topN ? h('button', { type: 'button', class: 'btn', style: { alignSelf: 'flex-start' }, onclick: function () { topN += 15; App.render(); } }, 'Show 15 more (' + Math.min(topN, m.rows.length) + ' of ' + m.rows.length + ' shown)') : null,
      topN > 15 ? h('button', { type: 'button', class: 'btn link', style: { alignSelf: 'flex-start' }, onclick: function () { topN = 15; App.render(); } }, 'Show fewer') : null));
    main.appendChild(h('section', { class: 'card pad stack', 'aria-labelledby': 'tp-b' }, h('h2', { id: 'tp-b' }, 'Biggest single expenses'),
      h('div', { class: 'scroll-x', role: 'region', 'aria-label': 'Biggest single expenses', tabindex: '0' }, h('table', { class: 't yg', style: { minWidth: '560px' } }, h('caption', { class: 'sr-only' }, 'Biggest single expenses in ' + year),
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Date'), h('th', { scope: 'col' }, 'Where'), h('th', { scope: 'col' }, 'Category'), h('th', { scope: 'col', class: 'r' }, 'Amount'))),
        h('tbody', null, big.map(function (x) {
          var t = x.t;
          return h('tr', null, h('td', { class: 'muted' }, U.shortDate(t.date)),
            h('th', { scope: 'row' }, h('button', { type: 'button', class: 'btn link ins-name', 'aria-label': 'Open ' + (t.desc || 'transaction') + ' ' + cents(x.counted) + ' on ' + U.shortDate(t.date), onclick: function () { UI.expensePanel(t, App.render); } }, t.desc || 'No name'),
              t.fundId ? h('span', { class: 'small muted' }, ' · from a big expense') : null),
            h('td', null, t.categoryId ? UI.catName(t.categoryId) : '–'), h('td', { class: 'r strong' }, cents(x.counted), x.counted !== t.amount ? h('div', { class: 'small muted' }, 'your share of ' + cents(t.amount)) : null));
        }))))));
    main.appendChild(note('Counts what each line counts for in your spending: your share of a group bill, net of refunds. Payments from big-expense funds are included (and marked) so this shows where the money went. Transfers, income and saving are not spending.'));
  }

  /* ---------- Home: bills still due this month ---------- */
  function billsDue(ym) {
    var sf = Costs.safe(App.cfg, App.txs, ym, U.today()); if (!sf) return;
    var up = Recurring.upcoming(App.cfg, App.txs, U.today(), 31).filter(function (x) { return x.item.kind === 'expense' && (x.state === 'due' || x.state === 'late') && x.date.slice(0, 7) === ym; });
    UI.openPanel(function (p) {
      p.appendChild(UI.panelHead('Bills still due', U.MONTHS[+ym.slice(5) - 1] + ' · ' + cents(sf.bills)));
      p.appendChild(h('p', { class: 'muted', style: { margin: 0 } }, 'Fixed and recurring bills not paid yet this month. "Safe to spend" is your left-to-spend minus this.'));
      p.appendChild(h('div', { class: 'notice stack-sm' }, h('div', { class: 'row between' }, h('span', null, 'Left to spend'), h('strong', null, cents(sf.left))), h('div', { class: 'row between' }, h('span', null, 'Bills still due'), h('strong', null, '− ' + cents(sf.bills))),
        h('div', { class: 'row between', role: 'status' }, h('span', null, 'Safe to spend'), h('strong', { class: sf.safe < 0 ? 'red' : 'ok' }, (sf.safe < 0 ? '−' : '') + cents(Math.abs(sf.safe))))));
      if (sf.parts.length) p.appendChild(h('div', { class: 'stack-sm' }, h('h3', null, 'By category'), h('ul', { class: 'hist-list' }, sf.parts.map(function (x) {
        var names = up.filter(function (u) { return u.item.categoryId === x.cat.id; });
        return h('li', null, h('div', { class: 'row between' }, h('strong', null, x.cat.name), h('span', null, cents(x.add))), h('div', { class: 'small muted' }, names.length ? names.map(function (u) { return u.item.name + ' ' + U.shortDate(u.date) + (u.state === 'late' ? ' (late)' : ''); }).join(' · ') : 'Your usual amount for this fixed bill'));
      }))));
      else p.appendChild(h('p', { class: 'muted' }, 'Nothing still due: every fixed and recurring bill is paid.'));
      p.appendChild(h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: function () { UI.closePanel(); RecurringUI.open(); } }, 'Open Bills & subscriptions'), h('button', { type: 'button', class: 'btn', onclick: UI.closePanel }, 'Close')));
    }, { label: 'Bills still due' });
  }
  return { render: render, billsDue: billsDue };
})();
