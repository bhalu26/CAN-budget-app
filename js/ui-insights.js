/* Insights: the year so far by category, a month-by-month chart, and every transaction in a category,
   with a "what if" limit slider that shows the effect before anything is saved. */
var Insights = (function () {
  'use strict';
  var h = U.h, st = { sort: 'budget', year: null, acct: 'all', table: false, view: 'category', collapsed: {} };
  var VIEWS = [['category', 'By category', ', by category'], ['grid', 'Month grid', ', month by month'], ['flow', 'Income, spent, saved', ', income and saving'], ['recurring', 'Recurring & fixed', ', recurring and fixed costs'], ['top', 'Top spending', ', top merchants and biggest expenses']];
  var last = null;   // { y, year, txs } from the latest render, for openCategory()

  function data() {
    var todayStr = U.today(), year = st.year || todayStr.slice(0, 4);
    var txs = st.acct === 'all' ? App.txs : App.txs.filter(function (t) { return Tx.srcOf(t) === st.acct; });
    return { todayStr: todayStr, year: year, txs: txs, y: M.ytd(App.cfg, txs, year, todayStr), isNow: year === todayStr.slice(0, 4) };
  }
  function monthBudget() {
    return App.cfg.categories.filter(function (c) { return !c.archived && c.kind !== 'saving' && groupKind(c) !== 'saving'; })
      .reduce(function (a, c) { return a + (c.period === 'year' ? (c.yearlyLimit || c.limit * 12) / 12 : (c.limit || 0)); }, 0);
  }
  function groupKind(c) { var g = (App.cfg.groups || []).filter(function (x) { return x.id === c.groupId; })[0]; return g ? g.kind : 'expense'; }

  function render(main) {
    var d = data(), y = d.y, year = d.year, isNow = d.isNow, txs = d.txs;
    last = { y: y, year: year, txs: txs };
    main.appendChild(h('header', { class: 'stack-sm' },
      h('div', { class: 'row between' }, h('h1', null, year + (isNow ? ' so far' : '') + VIEWS.filter(function (v) { return v[0] === st.view; })[0][2]),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn icon', 'aria-label': 'Previous year', onclick: function () { st.year = String(+year - 1); App.render(); } }, '‹'),
          h('span', { class: 'strong', style: { minWidth: '60px', textAlign: 'center' } }, year),
          h('button', { type: 'button', class: 'btn icon', 'aria-label': 'Next year', onclick: function () { st.year = String(+year + 1); App.render(); } }, '›'))),
      h('div', { class: 'muted' }, (isNow ? 'Jan 1 – ' + U.shortDate(d.todayStr) + ' · ' : '') + (st.view === 'grid' ? 'Each amount is what was spent in that category that month. Shading compares it with the category\'s monthly limit.'
        : st.view === 'flow' ? 'Income, spending and saving for each month, and what was left over.'
        : st.view === 'recurring' ? 'What your recurring bills cost over a year, which ones never change, and what to set aside for quarterly and yearly ones.'
        : st.view === 'top' ? 'Where the money went: the merchants you spent most with, and the biggest single expenses.'
        : '"Budget so far" is each monthly limit times the months gone by; yearly budgets use the share of the year.')),
      h('div', { class: 'field', style: { maxWidth: '320px' } }, h('label', { for: 'ins-acct' }, 'Account'), (function () {
        var s = h('select', { id: 'ins-acct', class: 'input', onchange: function (e) { st.acct = e.target.value; App.render(); } }, h('option', { value: 'all' }, 'All accounts'),
          Tx.usedSources(st.acct).map(function (x) { return h('option', { value: x.id }, x.name + (x.bank && x.bank !== 'Other' ? ' (' + x.bank + ')' : '')); }));
        s.value = st.acct; return s; })()),
      h('div', { class: 'row', role: 'group', 'aria-label': 'View' }, h('span', { class: 'muted' }, 'View:'),
        VIEWS.map(function (v) { return h('button', { type: 'button', class: 'chip', 'aria-pressed': st.view === v[0] ? 'true' : 'false', onclick: function () { st.view = v[0]; App.render(); } }, v[1]); }))));
    if (st.view !== 'category') { YearUI.render(main, d, st.view); return; }

    if (!y.cats.length || y.spent === 0) {
      main.appendChild(h('div', { class: 'card pad muted' }, 'No spending recorded for ' + year + ' yet.'));
      return;
    }
    var byOver = y.cats.filter(function (r) { return r.budget > 0 || r.spent > 0; }).slice().sort(function (a, b) { return b.st.over - a.st.over; });
    var worst = byOver[0], best = byOver[byOver.length - 1];
    var acctQ = st.acct !== 'all' ? '&acct=' + encodeURIComponent(st.acct) : '';
    function openCat(r) { return r && r.cat.id !== '__none' ? { fn: function () { panel(r); }, label: 'Open ' + r.cat.name + ' with its months and transactions.' } : null; }
    main.appendChild(h('div', { class: 'grid-tiles' },
      tile('Spent so far', U.money(y.spent, { whole: true }), 'of ' + U.money(y.budget, { whole: true }) + ' budget so far' + (y.fromFunds ? ' · plus ' + U.money(y.fromFunds, { whole: true }) + ' paid from big expenses' : ''), '', { href: '#/transactions?f=spend&scope=year&m=' + year + '-01' + acctQ, label: 'See every spending line this year.' }),
      tile('Average a month', U.money(y.avg, { whole: true }), y.fullMonths === 12 ? 'whole year' : 'full months Jan – ' + U.MON[y.fullMonths - 1], '', { fn: function () { st.view = 'flow'; App.render(); }, label: 'Open income, spent and saved by month.' }),
      worst && worst.st.over > 0 ? tile('Most over budget', worst.cat.name, U.money(worst.st.over, { whole: true }) + ' over so far', 'red', openCat(worst)) : tile('Most over budget', 'None', 'everything within budget', 'ok'),
      best && best.st.over < 0 ? tile('Most under budget', best.cat.name, U.money(-best.st.over, { whole: true }) + ' under so far', 'ok', openCat(best)) : null));

    // month by month
    var n = Math.max(1, y.lastMonth), budget = st.acct === 'all' ? U.round2(monthBudget()) : 0;
    var series = [];
    for (var i = 0; i < n; i++) {
      var v = U.round2(y.cats.reduce(function (a, r) { return a + (r.months[i] || 0); }, 0));
      series.push({ label: U.MON[i], full: U.MONTHS[i] + ' ' + year, value: v, budget: budget, partial: isNow && i === n - 1 });
    }
    var chartBox = h('section', { class: 'card pad stack', 'aria-labelledby': 'ins-chart-h' },
      h('div', { class: 'row between' }, h('div', { class: 'stack-sm' }, h('h2', { id: 'ins-chart-h' }, 'Spending by month'),
        h('div', { class: 'row small muted', style: { gap: '4px 14px' } },
          h('span', { class: 'legend-key' }, h('span', { class: 'sw c1' }), 'Spent'), h('span', { class: 'legend-key' }, h('span', { class: 'sw over' }), 'Over budget (also labelled "over")'),
          budget ? h('span', { class: 'legend-key' }, h('span', { class: 'line' }), 'Monthly budget ' + U.money(budget, { whole: true })) : h('span', null, 'Budget line hidden for a single account'))),
        h('button', { type: 'button', class: 'btn', 'aria-pressed': st.table ? 'true' : 'false', onclick: function () { st.table = !st.table; App.render(); } }, st.table ? 'Show chart' : 'Show as table')),
      st.table ? h('div', { class: 'scroll-x' }, Chart.table(series, 'Spending by month, ' + year))
        : Chart.columns({ data: series, title: 'Spending by month in ' + year + '. Each month is a button that opens its transactions.', height: 220,
          onPick: function (i) { location.hash = '#/transactions?f=spend&m=' + year + '-' + U.pad(i + 1) + (st.acct !== 'all' ? '&acct=' + encodeURIComponent(st.acct) : ''); } }),
      st.table ? null : h('div', { class: 'small muted' }, 'Hover or tab to a month for details; click it (or press Enter) to see its transactions.'));
    main.appendChild(chartBox);

    var sorts = [['budget', 'Budget order'], ['spent', 'Most spent'], ['over', 'Most over budget']];
    main.appendChild(h('div', { class: 'row', role: 'group', 'aria-label': 'Sort' }, h('span', { class: 'muted' }, 'Sort:'),
      sorts.map(function (s) { return h('button', { type: 'button', class: 'chip', 'aria-pressed': st.sort === s[0] ? 'true' : 'false', onclick: function () { st.sort = s[0]; App.render(); } }, s[1]); }),
      st.sort === 'budget' && y.groups.length > 1 ? (function () {
        var anyOpen = y.groups.some(function (g) { return !st.collapsed[gk(g.group)]; });
        return h('button', { type: 'button', class: 'btn link', style: { marginLeft: 'auto' }, onclick: function () { y.groups.forEach(function (g) { st.collapsed[gk(g.group)] = anyOpen; }); App.render(); } }, anyOpen ? 'Collapse all groups' : 'Expand all groups'); })() : null));

    var tbody = h('tbody');
    function catRow(r) {
      var lim = r.cat.period === 'year' ? 0 : r.cat.limit;
      var diffText = r.st.over > 0 ? U.money(r.st.over, { whole: true }) + ' over' : U.money(-r.st.over, { whole: true }) + ' under';
      return h('tr', { class: 'click', onclick: function (e) { if (e.target.closest && e.target.closest('a, button')) return; panel(r); } },   // the whole row is clickable with a mouse; the name button is the keyboard way in
        h('td', null, h('button', { type: 'button', class: 'btn link ins-name', 'aria-label': 'Show ' + r.cat.name + ': ' + U.money(r.spent, { whole: true }) + ' spent, ' + diffText + '. Opens its months and transactions.', onclick: function () { panel(r); } }, r.cat.name),
          r.cat.period === 'year' ? h('span', { class: 'small muted' }, ' yearly budget') : null, r.cat.archived ? h('span', { class: 'small muted' }, ' (removed)') : null),
        h('td', { class: 'r' }, r.cat.id === '__none' || !r.spent ? U.money(r.spent, { whole: true }) : h('a', { class: 'ins-link', href: '#/transactions?f=spend&cat=' + encodeURIComponent(r.cat.id) + '&scope=year&m=' + year + '-01' + acctQ, 'aria-label': r.cat.name + ' transactions this year: ' + U.money(r.spent, { whole: true }) }, U.money(r.spent, { whole: true }))), h('td', { class: 'r muted' }, U.money(r.budget, { whole: true })),
        h('td', { class: 'r strong ' + UI.statusClass(r.st.level) }, r.st.over > 0 ? U.money(r.st.over, { whole: true }) + ' over' : U.money(-r.st.over, { whole: true }) + ' under'),
        h('td', { class: 'r' }, U.money(r.avg, { whole: true })), h('td', null, Chart.spark(r.months, lim, isNow)));
    }
    if (st.sort === 'budget') {
      y.groups.forEach(function (g) {
        var shut = !!st.collapsed[gk(g.group)];
        tbody.appendChild(h('tr', { class: 'grp' }, h('td', null, h('button', { type: 'button', class: 'btn link grp-toggle', 'aria-expanded': shut ? 'false' : 'true', 'aria-label': (shut ? 'Show ' : 'Hide ') + g.group.name + ' categories', onclick: function () { st.collapsed[gk(g.group)] = !shut; App.render(); } }, (shut ? '▸ ' : '▾ ') + g.group.name)), h('td', { class: 'r' }, U.money(g.spent, { whole: true })), h('td', { class: 'r' }, U.money(g.budget, { whole: true })),
          h('td', { class: 'r ' + UI.statusClass(g.st.level) }, g.st.over > 0 ? U.money(g.st.over, { whole: true }) + ' over' : U.money(-g.st.over, { whole: true }) + ' under'), h('td'), h('td')));
        if (!shut) g.rows.forEach(function (r) { tbody.appendChild(catRow(r)); });
      });
    } else {
      y.cats.slice().sort(function (a, b) { return st.sort === 'spent' ? b.spent - a.spent : b.st.over - a.st.over; }).forEach(function (r) { tbody.appendChild(catRow(r)); });
    }
    main.appendChild(h('div', { class: 'card scroll-x' }, h('table', { class: 't', style: { minWidth: '760px' } },
      h('thead', null, h('tr', null, h('th', null, sortBtn('Category', 'budget')), h('th', { class: 'r' }, sortBtn('Spent so far', 'spent')), h('th', { class: 'r' }, 'Budget so far'), h('th', { class: 'r' }, sortBtn('Difference', 'over')), h('th', { class: 'r' }, 'Avg a month'), h('th', null, 'Jan → ' + U.MON[Math.max(0, y.lastMonth - 1)]))),
      tbody)));
    main.appendChild(h('div', { class: 'small muted' }, 'Click a category name (or anywhere on its row) for its months, transactions and a "what if" limit; click an amount to see its transactions. Column headings sort. Orange bars are months over that month\'s limit. Orange bars are months over that month\'s limit. Saving, transfers and not-counted lines are left out.'));
  }

  function tile() { return YearUI.tile.apply(null, arguments); }
  function gk(g) { return g.id || g.name; }
  function sortBtn(label, key) { return h('button', { type: 'button', class: 'th-sort', 'aria-pressed': st.sort === key ? 'true' : 'false', 'aria-label': 'Sort by ' + label, onclick: function () { st.sort = key; App.render(); } }, label); }

  /* Open a category's panel by id (from the command palette). */
  function openCategory(id) {
    if (!last) { var d = data(); last = { y: d.y, year: d.year, txs: d.txs }; }
    var r = last.y.cats.filter(function (x) { return x.cat.id === id; })[0];
    if (r) panel(r); else UI.toast('No spending in that category in ' + last.year + '.');
  }

  function panel(r) {
    var month = 'all', wf = null, y = last.y, year = last.year, txs = last.txs;
    var isNow = year === U.today().slice(0, 4);
    UI.openPanel(function (p) {
      var chart = null;
      function yearly() { return r.cat.period === 'year'; }
      function curLimit() { return yearly() ? (r.cat.yearlyLimit || r.cat.limit * 12) : (r.cat.limit || 0); }
      function series(lim) {
        var per = yearly() ? lim / 12 : lim;
        return r.months.map(function (v, i) { return { label: U.MON[i].charAt(0), full: U.MONTHS[i] + ' ' + year, value: v, budget: r.cat.archived ? 0 : U.round2(per), partial: isNow && i === r.months.length - 1 }; });
      }
      function draw() {
        U.clear(p);
        p.appendChild(UI.panelHead(r.cat.name, r.group.name));
        var pick = UI.categorySelect('pick', r.cat.id, function (e) { var n = y.cats.filter(function (x) { return x.cat.id === e.target.value; })[0]; if (n) { r = n; month = 'all'; wf = null; draw(); } });
        p.appendChild(h('div', { class: 'field' }, h('label', { for: 'pick' }, 'Category'), pick));
        p.appendChild(h('div', { class: 'row', style: { gap: '4px 16px' } }, h('span', null, h('strong', null, U.money(r.spent, { cents: true })), ' spent'),
          h('span', { class: 'muted' }, 'budget so far ' + U.money(r.budget, { whole: true })), h('span', { class: 'strong ' + UI.statusClass(r.st.level) }, r.st.over > 0 ? U.money(r.st.over, { whole: true }) + ' over' : U.money(-r.st.over, { whole: true }) + ' under')));
        chart = Chart.columns({ data: series(wf === null ? curLimit() : wf), title: r.cat.name + ' by month in ' + year + '. Each month is a button that shows its transactions below.', height: 170, selected: month === 'all' ? null : month,
          onPick: function (i) { month = month === i ? 'all' : i; draw(); var b = p.querySelectorAll('.chart-col')[i]; if (b) b.focus(); } });
        p.appendChild(chart);
        if (!r.cat.archived && r.cat.id !== '__none' && r.budget >= 0 && App.cfg.categories.some(function (c) { return c.id === r.cat.id; }) && !App.readOnly) p.appendChild(whatIf());
        else if (!r.cat.archived && App.readOnly) p.appendChild(whatIf(true));
        var mb = h('div', { class: 'months', role: 'group', 'aria-label': 'Month' });
        mb.appendChild(h('button', { type: 'button', 'aria-pressed': month === 'all' ? 'true' : 'false', onclick: function () { month = 'all'; draw(); } }, h('span', null, 'All'), h('strong', null, U.money(r.spent, { whole: true }))));
        r.months.forEach(function (v, i) {
          var over = r.cat.period !== 'year' && ((r.cat.limit && v > r.cat.limit + 10) || (!r.cat.limit && v > 0));
          mb.appendChild(h('button', { type: 'button', 'aria-pressed': month === i ? 'true' : 'false', onclick: function () { month = i; draw(); } }, h('span', null, U.MON[i]), h('strong', { class: month === i ? '' : (over ? 'red' : '') }, U.money(v, { whole: true }))));
        });
        p.appendChild(mb);
        var list = txs.filter(function (t) {
          var cid = t.needsTag || !t.categoryId ? '__none' : t.categoryId;
          return t.type === 'expense' && cid === r.cat.id && t.date.slice(0, 4) === year && (month === 'all' || +t.date.slice(5, 7) - 1 === month);
        }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
        p.appendChild(h('div', { class: 'row between' }, h('span', { class: 'muted', role: 'status' }, list.length + ' transactions' + (month === 'all' ? ' in ' + year + ', newest first' : ' in ' + U.MONTHS[month])),
          r.cat.id !== '__none' ? h('a', { href: '#/transactions?cat=' + encodeURIComponent(r.cat.id) + (month === 'all' ? '&scope=year&m=' + year + '-01' : '&m=' + year + '-' + U.pad(month + 1)) }, 'Open in Transactions') : null));
        var box = h('div', { class: 'card' });
        list.forEach(function (t) {
          var trip = t.tripId ? (App.cfg.trips || []).filter(function (x) { return x.id === t.tripId; })[0] : null;
          box.appendChild(h('div', { class: 'tx' },
            h('span', { class: 'small muted', style: { width: '56px' } }, U.shortDate(t.date)),
            h('div', { class: 'who' }, h('button', { type: 'button', class: 'btn link', style: { padding: 0, minHeight: '24px', justifyContent: 'flex-start', color: 'var(--text)', textDecoration: 'none', fontWeight: '600', textAlign: 'left' }, onclick: function () { UI.closePanel(); UI.expensePanel(t, App.render); } }, t.desc || r.cat.name),
              h('span', { class: 'small muted' }, [t.source === 'excel' ? 'Excel' : (UI.acctName(t) || 'Added by hand'), trip ? trip.name : null, t.note].filter(Boolean).join(' · '))),
            h('span', { class: 'amt' }, U.money(M.counted(t), { cents: true }) + (M.counted(t) !== t.amount ? ' of ' + U.money(t.amount, { cents: true }) : ''))));
        });
        if (!list.length) box.appendChild(h('div', { class: 'pad muted' }, 'Nothing in this month.'));
        p.appendChild(box);
      }

      /* "What if": drag a limit and see the year play out; nothing changes until Save. */
      function whatIf(viewOnly) {
        var cur = curLimit(), yr = yearly(), maxM = Math.max.apply(null, r.months.concat([0]));
        var top = Math.max(cur * 2, (yr ? maxM * 12 : maxM) * 1.5, yr ? 1200 : 100);
        var step = top > 4000 ? 50 : top > 1000 ? 25 : top > 300 ? 10 : 5;
        top = Math.ceil(top / step) * step;
        var val = wf === null ? cur : wf;
        var out = h('div', { class: 'stack-sm', 'aria-live': 'polite' });
        function numbers() {
          U.clear(out);
          var soFar = yr ? val * y.yearShare : val * y.monthsGone, diff = r.spent - soFar;
          var monthsLeft = isNow ? Math.max(0, 12 - y.monthsGone) : 0, perMonth = r.avg || (r.spent / Math.max(1, y.monthsGone));
          var projected = r.spent + perMonth * monthsLeft, yearBudget = yr ? val : val * 12, yDiff = projected - yearBudget;
          var overMonths = yr ? null : r.months.filter(function (v, i) { return !(isNow && i === r.months.length - 1) && v > val + 10; }).length;
          var full = isNow ? Math.max(0, r.months.length - 1) : r.months.length;
          out.appendChild(h('div', null, 'Budget so far would be ', h('strong', null, U.money(soFar, { whole: true })), ': you are ',
            h('strong', { class: diff > 10 ? 'red' : 'ok' }, diff > 0 ? U.money(diff, { whole: true }) + ' over' : U.money(-diff, { whole: true }) + ' under'), '.'));
          if (isNow) out.appendChild(h('div', null, 'By December, at your usual ' + U.money(perMonth, { whole: true }) + ' a month, about ', h('strong', null, U.money(projected, { whole: true })),
            ' against ' + U.money(yearBudget, { whole: true }) + ': ', h('strong', { class: yDiff > 10 ? 'red' : 'ok' }, yDiff > 0 ? U.money(yDiff, { whole: true }) + ' over' : U.money(-yDiff, { whole: true }) + ' under'), '.'));
          if (overMonths !== null && full) out.appendChild(h('div', { class: 'small muted' }, overMonths + ' of ' + full + ' full month' + (full === 1 ? '' : 's') + ' would be over this limit.'));
          if (!yr) {
            var total = App.cfg.categories.filter(function (c) { return !c.archived && c.period !== 'year' && groupKind(c) !== 'saving'; }).reduce(function (a, c) { return a + (c.limit || 0); }, 0);
            out.appendChild(h('div', { class: 'small muted' }, 'Your monthly spending budget would be ' + U.money(total - cur + val, { whole: true }) + ' (now ' + U.money(total, { whole: true }) + ').'));
          }
        }
        var label = h('output', { id: 'wf-out', class: 'strong', for: 'wf' }, U.money(val, { whole: true }) + (yr ? ' a year' : ' a month'));
        var slider = h('input', { id: 'wf', type: 'range', class: 'wf-range', min: 0, max: top, step: step, value: val, 'aria-valuetext': U.money(val, { whole: true }) + (yr ? ' a year' : ' a month'),
          oninput: function (e) {
            val = +e.target.value; wf = val === cur ? null : val;
            label.textContent = U.money(val, { whole: true }) + (yr ? ' a year' : ' a month');
            e.target.setAttribute('aria-valuetext', label.textContent);
            chart.redraw(series(val)); numbers(); actions();
          } });
        var act = h('div', { class: 'row' });
        function actions() {
          U.clear(act);
          if (viewOnly) return;
          if (wf !== null) {
            act.appendChild(h('button', { type: 'button', class: 'btn primary', onclick: saveLimit }, 'Save ' + U.money(val, { whole: true }) + ' as the ' + (yr ? 'yearly budget' : 'monthly limit')));
            act.appendChild(h('button', { type: 'button', class: 'btn', onclick: function () { wf = null; draw(); var s2 = p.querySelector('#wf'); if (s2) s2.focus(); } }, 'Back to ' + U.money(cur, { whole: true })));
          } else act.appendChild(h('span', { class: 'small muted' }, 'Drag to try another ' + (yr ? 'yearly budget' : 'limit') + '. Nothing changes until you save.'));
        }
        function saveLimit() {
          var c = App.cfg.categories.filter(function (x) { return x.id === r.cat.id; })[0]; if (!c) return;
          var before = { limit: c.limit, yearlyLimit: c.yearlyLimit };
          if (yr) { c.yearlyLimit = val; c.limit = U.round2(val / 12); } else c.limit = val;
          UI.saveCfg().then(function () {
            refresh(); wf = null; draw();
            UI.toast(c.name + ': ' + (yr ? 'yearly budget ' : 'monthly limit ') + U.money(val, { whole: true }) + ' (was ' + U.money(yr ? (before.yearlyLimit || before.limit * 12) : before.limit, { whole: true }) + ').', function () {
              c.limit = before.limit; if (before.yearlyLimit === undefined) delete c.yearlyLimit; else c.yearlyLimit = before.yearlyLimit;
              UI.saveCfg().then(function () { refresh(); App.render(); UI.toast('Undone.'); });
            });
            App.render();
          });
        }
        numbers(); actions();
        return h('section', { class: 'whatif stack-sm', 'aria-labelledby': 'wf-h' },
          h('div', { class: 'row between' }, h('h3', { id: 'wf-h' }, viewOnly ? 'What if the limit were…' : 'What if the limit were…'), label),
          h('label', { class: 'sr-only', for: 'wf' }, 'Try a ' + (yr ? 'yearly budget' : 'monthly limit') + ' for ' + r.cat.name),
          slider, h('div', { class: 'row between small muted' }, h('span', null, '$0'), h('span', null, 'now ' + U.money(cur, { whole: true })), h('span', null, U.money(top, { whole: true }))),
          out, act);
      }
      function refresh() {
        var d = data(); y = d.y; last = { y: y, year: year, txs: d.txs };
        var n = y.cats.filter(function (x) { return x.cat.id === r.cat.id; })[0]; if (n) r = n;
      }
      draw();
    }, { wide: true, label: r.cat.name + ' transactions' });
  }
  function isCollapsed(g) { return !!st.collapsed[gk(g)]; }
  function toggleGroup(g) { st.collapsed[gk(g)] = !st.collapsed[gk(g)]; App.render(); }
  function setView(v) { if (VIEWS.some(function (x) { return x[0] === v; })) st.view = v; }
  return { isCollapsed: isCollapsed, toggleGroup: toggleGroup, setView: setView, render: render, openCategory: openCategory };
})();
