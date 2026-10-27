/* Insights, year views: "Month grid" (categories × months) and "Income, spent, saved" (by month). Numbers come from year.js. */
var YearUI = (function () {
  'use strict';
  var h = U.h;
  /* ✓ reviewed, ⚠ changed since reviewed (with words for screen readers) */
  function rvMark(ym, todayStr) {
    var st = App.readOnly ? null : Reviewed.status(App.cfg, App.txs, ym, todayStr); if (!st) return null;
    return h('span', { class: st.changed ? 'amber' : 'ok', title: st.changed ? 'Changed since you reviewed it' : 'Reviewed' }, h('span', { 'aria-hidden': 'true' }, st.changed ? ' ⚠' : ' ✓'), h('span', { class: 'sr-only' }, st.changed ? ' changed since reviewed' : ' reviewed'));
  }
  function whole(v) { return U.money(v, { whole: true }); }
  function pct(r) { return r === null ? '–' : Math.round(r * 100) + '%'; }
  function link(params, label, text) { return h('a', { href: '#/transactions?' + params, class: 'yg-cell', 'aria-label': label }, text); }
  function note(text) { return h('p', { class: 'small muted', style: { margin: 0, maxWidth: '78ch' } }, text); }
  /* A summary tile; with go ({ href } or { fn }, plus label) the whole tile is a link or button. */
  function tile(label, value, sub, cls, go) {
    var inner = [h('div', { class: 'small muted' }, label), h('div', { class: 'big ' + (cls || '') }, value), sub ? h('div', { class: 'small muted' }, sub) : null];
    if (!go) return h('div', { class: 'card tile' }, inner);
    inner.push(h('span', { class: 'tile-go', 'aria-hidden': 'true' }, '›'));
    var attrs = { class: 'card tile tile-link', 'aria-label': label + ': ' + value + (sub ? ', ' + sub : '') + '. ' + go.label };
    return go.href ? h('a', Object.assign({ href: go.href }, attrs), inner) : h('button', Object.assign({ type: 'button', onclick: go.fn }, attrs), inner);
  }

  function render(main, d, view) {
    if (view === 'grid') grid(main, d); else if (view === 'flow') flow(main, d); else CostsUI.render(main, d, view);
  }

  /* ---------- categories × months ---------- */
  function grid(main, d) {
    var y = d.y, year = d.year;
    if (!y.cats.length || y.spent === 0) { main.appendChild(h('div', { class: 'card pad muted' }, 'No spending recorded for ' + year + ' yet.')); return; }
    var g = Year.grid(y), part = d.isNow ? g.n : 0;
    var head = h('tr', null, h('th', { scope: 'col' }, 'Category'));
    for (var i = 0; i < g.n; i++) head.appendChild(h('th', { scope: 'col', class: 'r', title: i + 1 === part ? 'This month so far' : null }, h('a', { class: 'yg-head', href: '#/transactions?f=spend&m=' + year + '-' + U.pad(i + 1), 'aria-label': 'All spending in ' + U.MONTHS[i] + '. Open these transactions.' }, U.MON[i] + (i + 1 === part ? '*' : '')), rvMark(year + '-' + U.pad(i + 1), d.todayStr)));
    head.appendChild(h('th', { scope: 'col', class: 'r' }, 'Total')); head.appendChild(h('th', { scope: 'col', class: 'r' }, 'Avg a month'));
    var body = h('tbody');
    function cell(r, i) {
      var v = r.months[i], st = Year.cellState(v, r.limit), ym = year + '-' + U.pad(i + 1);
      if (!v) return h('td', { class: 'r muted' }, h('span', { 'aria-hidden': 'true' }, '·'), h('span', { class: 'sr-only' }, 'nothing'));
      var over = st === 'over' || st === 'over2';
      var label = r.cat.name + ' in ' + U.MONTHS[i] + ': ' + U.money(v, { cents: true }) + (r.limit ? ', limit ' + whole(r.limit) + (over ? ', over by ' + whole(v - r.limit) : '') : '') + '. Open these transactions.';
      var inner = r.cat.id === '__none' ? h('span', null, whole(v)) : link('f=spend&cat=' + encodeURIComponent(r.cat.id) + '&m=' + ym, label, whole(v) + (st === 'over2' ? ' ▲▲' : over ? ' ▲' : ''));
      return h('td', { class: 'r yg-' + st }, inner);
    }
    g.groups.forEach(function (gr) {
      var shut = Insights.isCollapsed(gr.group);
      var tr = h('tr', { class: 'grp' }, h('th', { scope: 'row' }, h('button', { type: 'button', class: 'btn link grp-toggle', 'aria-expanded': shut ? 'false' : 'true', 'aria-label': (shut ? 'Show ' : 'Hide ') + gr.group.name + ' categories', onclick: function () { Insights.toggleGroup(gr.group); } }, (shut ? '▸ ' : '▾ ') + gr.group.name)));
      gr.months.forEach(function (v) { tr.appendChild(h('td', { class: 'r' }, v ? whole(v) : '')); });
      tr.appendChild(h('td', { class: 'r' }, whole(gr.total))); tr.appendChild(h('td'));
      body.appendChild(tr);
      if (!shut) gr.rows.forEach(function (r) {
        var row = h('tr', null, h('th', { scope: 'row', class: 'yg-name' }, r.cat.id === '__none' ? r.cat.name : h('button', { type: 'button', class: 'btn link ins-name', 'aria-label': 'Open ' + r.cat.name + ' with its months and transactions', onclick: function () { Insights.openCategory(r.cat.id); } }, r.cat.name), r.yearly ? h('span', { class: 'small muted' }, ' yearly budget') : null, r.cat.archived ? h('span', { class: 'small muted' }, ' (removed)') : null));
        for (var i = 0; i < g.n; i++) row.appendChild(cell(r, i));
        row.appendChild(h('td', { class: 'r strong' }, r.cat.id === '__none' || !r.total ? whole(r.total) : link('f=spend&cat=' + encodeURIComponent(r.cat.id) + '&scope=year&m=' + year + '-01', r.cat.name + ' transactions this year: ' + U.money(r.total, { cents: true }) + '. Open these transactions.', whole(r.total)))); row.appendChild(h('td', { class: 'r muted' }, whole(r.avg)));
        body.appendChild(row);
      });
    });
    var foot = h('tr', { class: 'yg-total' }, h('th', { scope: 'row' }, 'All spending'));
    g.months.forEach(function (v, i) { foot.appendChild(h('td', { class: 'r' }, link('f=spend&m=' + year + '-' + U.pad(i + 1), 'All spending in ' + U.MONTHS[i] + ': ' + U.money(v, { cents: true }) + '. Open these transactions.', whole(v)))); });
    foot.appendChild(h('td', { class: 'r strong' }, whole(g.total))); foot.appendChild(h('td'));
    body.appendChild(foot);
    main.appendChild(h('div', { class: 'card scroll-x', role: 'region', 'aria-label': 'Spending by category and month', tabindex: '0' }, h('table', { class: 't yg', style: { minWidth: (260 + g.n * 74) + 'px' } },
      h('caption', { class: 'sr-only' }, 'Spending by category and month, ' + year + '. Each amount opens its transactions.'), h('thead', null, head), body)));
    main.appendChild(note('▲ more than that month\'s limit (shaded); ▲▲ more than 25% over. Yearly budgets such as Travel have no monthly limit, so they are not shaded. ' + (part ? '* This month so far. ' : '') +
      'Payments from big-expense funds, saving, transfers and card payments are not in these amounts. Click any amount to see its transactions.'));
  }

  /* ---------- income, spent, saved by month ---------- */
  function flow(main, d) {
    var year = d.year, f = Year.months(App.cfg, d.txs, year, d.todayStr);
    if (!f.rows.length || (!f.total.income && !f.total.spent && !f.total.saved)) { main.appendChild(h('div', { class: 'card pad muted' }, 'Nothing recorded for ' + year + ' yet.')); return; }
    var t = f.total, anyFund = t.fromFunds > 0, maxLeft = Math.max.apply(null, f.rows.map(function (r) { return Math.abs(r.left); }).concat([1]));
    main.appendChild(h('div', { class: 'grid-tiles' },
      tile('Income', whole(t.income), f.avg.n ? 'about ' + whole(f.avg.income) + ' a full month' : null, '', { href: '#/transactions?f=in&scope=year&m=' + year + '-01', label: 'See the money-in lines this year.' }),
      tile('Spent', whole(t.spent), f.avg.n ? 'about ' + whole(f.avg.spent) + ' a full month' : null, '', { href: '#/transactions?f=spend&scope=year&m=' + year + '-01', label: 'See every spending line this year.' }),
      tile('Saved', whole(t.saved), t.rate === null ? 'no income recorded' : pct(t.rate) + ' of income', '', { href: '#/transactions?f=in&scope=year&m=' + year + '-01', label: 'See income and saving lines this year.' }),
      tile('Left over', (t.left < 0 ? '−' : '') + whole(Math.abs(t.left)), 'income − spent' + (anyFund ? ' − big expenses' : '') + ' − saved', t.left < 0 ? 'red' : 'ok')));
    var cols = ['Month', 'Income', 'Spent'].concat(anyFund ? ['Paid from big expenses'] : []).concat(['Saved', 'Left over', 'Savings rate', 'Moved between accounts']);
    var thead = h('tr', null, cols.map(function (c, i) { return h('th', { scope: 'col', class: i ? 'r' : null }, c); }));
    var tbody = h('tbody');
    f.rows.forEach(function (r) {
      var ml = U.MONTHS[r.m - 1];
      tbody.appendChild(h('tr', null,
        h('th', { scope: 'row' }, h('button', { type: 'button', class: 'btn link ins-name', 'aria-label': 'Open ' + ml + ' on Home', onclick: function () { App.month = r.ym; location.hash = '#/home'; App.render(); } }, ml + (r.partial ? ' (so far)' : '')), rvMark(r.ym, d.todayStr)),
        h('td', { class: 'r' }, r.income ? link('f=in&m=' + r.ym, 'Income in ' + ml + ': ' + U.money(r.income, { cents: true }) + '. Open these transactions.', whole(r.income)) : h('span', { class: 'muted' }, '–')),
        h('td', { class: 'r' }, r.spent ? link('f=spend&m=' + r.ym, 'Spent in ' + ml + ': ' + U.money(r.spent, { cents: true }) + '. Open these transactions.', whole(r.spent)) : h('span', { class: 'muted' }, '–')),
        anyFund ? h('td', { class: 'r muted' }, r.fromFunds ? whole(r.fromFunds) : '–') : null,
        h('td', { class: 'r' }, r.saved ? link('f=in&m=' + r.ym, 'Saved in ' + ml + ': ' + U.money(r.saved, { cents: true }) + '. Open these transactions.', whole(r.saved)) : h('span', { class: 'muted' }, '–')),
        h('td', { class: 'r' }, h('div', { class: 'yl-cell' }, h('span', { class: 'strong ' + (r.left < 0 ? 'red' : '') }, (r.left < 0 ? '−' : '') + whole(Math.abs(r.left))),
          h('span', { class: 'yl-bar', 'aria-hidden': 'true' }, h('span', { class: 'yl-fill' + (r.left < 0 ? ' neg' : ''), style: { width: Math.round(Math.abs(r.left) / maxLeft * 100) + '%' } })))),
        h('td', { class: 'r' }, pct(r.rate)),
        h('td', { class: 'r muted' }, r.other ? whole(r.other) : '–')));
    });
    tbody.appendChild(h('tr', { class: 'yg-total' }, h('th', { scope: 'row' }, 'Year so far'), h('td', { class: 'r' }, t.income ? link('f=in&scope=year&m=' + year + '-01', 'Income this year: ' + U.money(t.income, { cents: true }) + '. Open these transactions.', whole(t.income)) : whole(0)), h('td', { class: 'r' }, t.spent ? link('f=spend&scope=year&m=' + year + '-01', 'Spending this year: ' + U.money(t.spent, { cents: true }) + '. Open these transactions.', whole(t.spent)) : whole(0)), anyFund ? h('td', { class: 'r' }, whole(t.fromFunds)) : null,
      h('td', { class: 'r' }, whole(t.saved)), h('td', { class: 'r' }, (t.left < 0 ? '−' : '') + whole(Math.abs(t.left))), h('td', { class: 'r' }, pct(t.rate)), h('td', { class: 'r muted' }, whole(t.other))));
    if (f.avg.n) tbody.appendChild(h('tr', { class: 'muted' }, h('th', { scope: 'row' }, 'Average full month'), h('td', { class: 'r' }, whole(f.avg.income)), h('td', { class: 'r' }, whole(f.avg.spent)), anyFund ? h('td', { class: 'r' }, whole(f.avg.fromFunds)) : null,
      h('td', { class: 'r' }, whole(f.avg.saved)), h('td', { class: 'r' }, (f.avg.left < 0 ? '−' : '') + whole(Math.abs(f.avg.left))), h('td'), h('td')));
    main.appendChild(h('div', { class: 'card scroll-x', role: 'region', 'aria-label': 'Income, spent and saved by month', tabindex: '0' }, h('table', { class: 't yg', style: { minWidth: '720px' } },
      h('caption', { class: 'sr-only' }, 'Income, spent, saved and left over by month, ' + year), h('thead', null, thead), tbody)));
    main.appendChild(note('Spent is everyday and bill spending' + (anyFund ? '; payments made from a big-expense fund are shown separately' : '') + '. Left over = income − spent' + (anyFund ? ' − big expenses' : '') + ' − saved. Moved between accounts (transfers, card payments, anything marked not counted) is never in income or spending. Money in with no category yet is not counted until you tag it.'));
  }
  return { render: render, tile: tile };
})();
