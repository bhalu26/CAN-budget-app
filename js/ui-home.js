/* Home: the month at a glance. */
var Home = (function () {
  'use strict';
  var h = U.h, open = {}, openedAt = {}, howOpen = false;
  var STATE = { paid: 'Paid ✓', changed: 'Different amount', late: 'Late', due: 'Due' };

  /* Home is a list of sections you can reorder or hide (Customize Home); the month header and warnings always lead. */
  var SECTIONS = [['attention', 'Needs attention'], ['upcoming', 'Coming up (bills and subscriptions)'], ['bills', 'Monthly bills'], ['groups', 'Everyday spending'], ['accounts', 'Accounts this month'], ['travel', 'Travel this year'], ['saved', 'Saved this month and big expenses']];
  function layout() {
    var hm = App.cfg.home || {}, order = (hm.order || []).filter(function (k) { return SECTIONS.some(function (x) { return x[0] === k; }); });
    SECTIONS.forEach(function (x) { if (order.indexOf(x[0]) < 0) order.push(x[0]); });
    return { order: order, hidden: hm.hidden || {} };
  }
  function txLink(params, label, text, cls) { return h('a', { href: '#/transactions?' + params, class: 'quiet-link' + (cls ? ' ' + cls : ''), 'aria-label': label }, text); }
  /* Last 6 months of spending in a category, ending with the month shown. */
  function lastSix(catId, ym) {
    var keys = []; for (var i = 5; i >= 0; i--) keys.push(U.shiftMonth(ym, -i));
    var sums = keys.map(function () { return 0; });
    App.txs.forEach(function (t) { if (t.type === 'expense' && t.categoryId === catId) { var k = keys.indexOf(t.date.slice(0, 7)); if (k >= 0) sums[k] += M.counted(t); } });
    return sums;
  }

  function render(main) {
    var ym = App.month || U.ym(U.today()), todayStr = U.today();
    var s = M.month(App.cfg, App.txs, ym, todayStr), isNow = ym === U.ym(todayStr), hh = App.readOnly ? null : HealthUI.summary();
    var p = ym.split('-'), dim = U.daysInMonth(+p[0], +p[1]), mName = U.MONTHS[+p[1] - 1];

    /* Summary band: the one number that matters, how the month is going, and the few facts behind it. */
    var monthlySpent = U.round2(s.limit - s.left), usedPct = s.limit > 0 ? Math.min(1, Math.max(0, monthlySpent / s.limit)) : (monthlySpent > 0 ? 1 : 0);
    var heroLevel = s.left < 0 ? 'red' : (isNow && s.limit > 0 && monthlySpent > s.limit * s.pace + 0.005 && s.pace < 1) ? 'amber' : 'ok';
    function stat(label, value, sub, params, aria) {
      var body = [h('span', { class: 'stat-label' }, label), h('span', { class: 'stat-value' }, value), sub ? h('span', { class: 'stat-sub' }, sub) : null];
      if (params && typeof params === 'function') return h('button', { type: 'button', class: 'stat stat-link', onclick: params, 'aria-label': aria }, body);
      return params ? h('a', { class: 'stat stat-link', href: '#/transactions?' + params, 'aria-label': aria }, body) : h('div', { class: 'stat' }, body);
    }
    var sf = isNow && !App.readOnly && (App.cfg.recurring || []).length ? Costs.safe(App.cfg, App.txs, ym, todayStr) : null;
    main.appendChild(h('header', { class: 'hero card' },
      h('div', { class: 'hero-top' },
        h('div', { class: 'row month-nav muted' },
          h('button', { type: 'button', class: 'btn icon', 'aria-label': 'Previous month', title: 'Previous month ([)', onclick: function () { App.month = U.shiftMonth(ym, -1); App.render(); } }, '‹'),
          h('span', { class: 'strong month-name' }, U.monthLabel(ym)),
          h('button', { type: 'button', class: 'btn icon', 'aria-label': 'Next month', title: 'Next month (])', onclick: function () { App.month = U.shiftMonth(ym, 1); App.render(); } }, '›'),
          isNow ? h('span', null, 'day ' + (+todayStr.slice(8, 10)) + ' of ' + dim) : h('button', { type: 'button', class: 'btn link', onclick: function () { App.month = null; App.render(); } }, 'Back to this month')),
        App.readOnly ? null : h('div', { class: 'row' },
          s.needsTag ? h('a', { class: 'btn', href: '#/review' }, s.needsTag + ' to review') : null,
          hh && hh.high ? h('a', { class: 'btn', href: '#/health' }, hh.high + ' to check in Data health') : null,
          h('button', { type: 'button', class: 'btn primary', title: 'Add an expense (N)', onclick: function () { UI.expensePanel(null, App.render); } }, '+ Add expense'))),
      h('h1', { class: 'hero-h1' }, h('span', { class: 'hero-num ' + (s.left < 0 ? 'red' : '') }, U.money(Math.abs(s.left), { whole: true })), s.left >= 0 ? ' left to spend' + (isNow ? ' this month' : '') : ' over budget' + (isNow ? ' this month' : '')),
      s.limit > 0 ? h('div', { class: 'hero-bar' }, h('div', { role: 'img', 'aria-label': U.money(monthlySpent, { whole: true }) + ' of ' + U.money(s.limit, { whole: true }) + ' monthly limits used' + (isNow ? ', ' + Math.round(s.pace * 100) + '% of the month gone' : '') }, UI.bar(usedPct, heroLevel, isNow ? s.pace : null)), h('div', { class: 'hero-cap small ' + (heroLevel === 'red' ? 'red' : heroLevel === 'amber' ? 'amber' : 'muted') }, heroLevel === 'red' ? 'Over the monthly limits' + (isNow ? ' · ' + Math.round(s.pace * 100) + '% of the month gone' : '') : (isNow ? Math.round(s.pace * 100) + '% of the month gone' + (heroLevel === 'amber' ? ' · spending is ahead of pace' : ' · on track') : U.money(monthlySpent, { whole: true }) + ' of ' + U.money(s.limit, { whole: true }) + ' used'))) : null,
      h('div', { class: 'hero-stats' },
        stat('Spent', U.money(s.spent, { whole: true }), 'of ' + U.money(s.limit, { whole: true }), 'f=spend&m=' + ym, 'Spent ' + U.money(s.spent, { whole: true }) + ' of ' + U.money(s.limit, { whole: true }) + ' in ' + mName + '. See these transactions.'),
        stat('Saved', U.money(s.saved, { whole: true }), 'of ' + U.money(s.savingTarget, { whole: true }), 'f=in&m=' + ym, 'Saved ' + U.money(s.saved, { whole: true }) + ' of ' + U.money(s.savingTarget, { whole: true }) + ' in ' + mName + '. See income and saving.'),
        stat('Income', U.money(s.income, { whole: true }), null, 'f=in&m=' + ym, 'Income ' + U.money(s.income, { whole: true }) + ' in ' + mName + '. See these transactions.')),
      sf ? h('div', { class: 'hero-stats hero-stats2' },
        stat('Bills still due', U.money(sf.bills, { whole: true }), sf.parts.length ? 'in ' + sf.parts.length + ' categor' + (sf.parts.length === 1 ? 'y' : 'ies') : 'all paid', function () { CostsUI.billsDue(ym); },
          'Bills still due this month: ' + U.money(sf.bills, { whole: true }) + '. See which ones.'),
        stat('Safe to spend', (sf.safe < 0 ? '−' : '') + U.money(Math.abs(sf.safe), { whole: true }), sf.safe < 0 ? 'short once bills are paid' : 'after bills still due')) : null,
      h('div', { class: 'hero-foot small muted' }, s.fromFunds ? h('span', null, U.money(s.fromFunds, { whole: true }) + ' paid from big expenses') : null, h('a', { href: '#/transactions?m=' + ym }, 'See all ' + mName + ' transactions'))));

    var status = [], rvBar = ReviewedUI.bar(ym, todayStr); if (rvBar) status.push(rvBar);   // reviewed / owed / month-end estimate share one card
    var owedOpen = App.readOnly ? [] : Group.open(App.txs);
    if (owedOpen.length) status.push(h('div', { class: 'row owed-bar' }, h('span', null, 'Others owe you ', h('strong', null, U.money(Group.totalOpen(App.txs), { cents: true })), ' from ' + owedOpen.length + ' group bill' + (owedOpen.length === 1 ? '' : 's') + '.'), h('button', { type: 'button', class: 'btn link', onclick: GroupUI.list }, 'See who owes what')));
    var est = isNow ? Recurring.monthEstimate(App.cfg, App.txs, ym, todayStr) : null;
    if (est && est.limit > 0) {
      var over = est.left < 0;
      var how = h('div', { id: 'est-how', class: 'est-how', hidden: !howOpen },
        h('div', { class: 'list-row' }, h('span', null, 'Spent so far'), h('span', null, U.money(est.spent, { whole: true }))),
        h('div', { class: 'list-row' }, h('span', null, 'Bills still to come'), h('span', null, U.money(est.bills, { whole: true }))),
        h('div', { class: 'list-row' }, h('span', null, 'Everyday spending for the ' + est.daysLeft + ' days left, at your usual pace'), h('span', null, U.money(est.everyday, { whole: true }))),
        h('div', { class: 'list-row strong' }, h('span', null, 'Estimate for ' + mName), h('span', null, U.money(est.estimate, { whole: true }) + ' of ' + U.money(est.limit, { whole: true }))),
        est.parts.length ? h('div', { class: 'small muted' }, 'Biggest parts still to come: ' + est.parts.slice(0, 4).map(function (x) { return x.cat.name + ' ' + U.money(x.add, { whole: true }); }).join(', ') + '. "Usual" is the middle of your last 3 months.') : null);
      status.push(h('div', { class: 'est' },
        h('span', null, 'At this pace ' + mName + ' ends about ', h('strong', { class: over ? 'red' : 'ok' }, U.money(Math.abs(est.left), { whole: true }) + (over ? ' over' : ' under')), ' budget. '),
        h('button', { type: 'button', class: 'btn link', 'aria-expanded': howOpen ? 'true' : 'false', 'aria-controls': 'est-how', onclick: function () { howOpen = !howOpen; App.render(); } }, howOpen ? 'Hide how' : 'How?'), how));
    }
    if (status.length) main.appendChild(h('section', { class: 'card status-card', 'aria-label': 'Month status' }, status));
    if (!App.readOnly) warnings(main);
    if (!s.count && !App.txs.length && !App.readOnly) {
      main.appendChild(h('div', { class: 'card pad stack' }, h('h2', null, 'No transactions yet'),
        h('p', { class: 'muted', style: { margin: 0 } }, 'Add an expense, or bring in your Jan–Sep history from your Excel sheet.'),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onclick: function () { UI.expensePanel(null, App.render); } }, '+ Add expense'), h('a', { class: 'btn', href: '#/settings' }, 'Import Excel history'))));
    }

    var build = {
      upcoming: function () {
        var items = App.cfg.recurring || [];
        var sec = h('section', { class: 'stack', 'aria-labelledby': 'upc' }, h('div', { class: 'row between' }, h('h2', { id: 'upc' }, 'Coming up'),
          App.readOnly ? null : h('a', { class: 'btn', href: '#/bills', title: 'Settings: Bills & subscriptions (G then B)' }, items.length ? 'Manage bills & subscriptions' : 'Find bills & subscriptions')));
        if (!items.length) {
          if (App.readOnly) return null;
          var n = Recurring.detect(App.txs, todayStr, App.cfg.recurringIgnore, []).length;
          sec.appendChild(h('div', { class: 'card pad muted' }, n ? n + ' bills, subscriptions or paycheques were found in your history. Confirm them to see what is coming up.' : 'Add your bills and subscriptions to see what is coming up.'));
          return sec;
        }
        var list = Recurring.upcoming(App.cfg, App.txs, todayStr, 30);
        if (!list.length) { sec.appendChild(h('div', { class: 'card pad muted' }, 'Nothing due in the next 30 days.')); return sec; }
        var monthEnd = todayStr.slice(0, 8) + U.pad(U.daysInMonth(+todayStr.slice(0, 4), +todayStr.slice(5, 7)));
        var due = list.filter(function (x) { return (x.state === 'due' || x.state === 'late') && x.date <= monthEnd && x.item.kind === 'expense'; }).reduce(function (a, x) { return a + x.amount; }, 0);
        var box = h('div', { class: 'card' });
        list.forEach(function (x) {
          var dd = Recurring.gap(todayStr, x.date), when = x.state === 'paid' || x.state === 'changed' ? 'paid ' + U.shortDate(x.tx.date) : dd === 0 ? 'today' : dd === 1 ? 'tomorrow' : dd > 0 ? 'in ' + dd + ' days' : Math.abs(dd) + ' days ago';
          box.appendChild(h('div', { class: 'tx upc-row' },
            h('span', { class: 'small muted', style: { width: '56px' } }, U.shortDate(x.date)),
            h('div', { class: 'who' }, x.item.categoryId ? txLink('cat=' + encodeURIComponent(x.item.categoryId) + '&m=' + x.date.slice(0, 7), x.item.name + ' transactions', x.item.name, 'strong') : h('strong', null, x.item.name),
              h('span', { class: 'small muted' }, (Recurring.BY_ID[x.item.cadence] || {}).label + ' · ' + when + (x.item.kind === 'income' ? ' · money in' : ''))),
            h('span', { class: 'st-chip st-' + x.state }, STATE[x.state]),
            (!App.readOnly && !x.tx && (x.state === 'due' || x.state === 'late') && x.date <= todayStr) ? h('button', { type: 'button', class: 'btn link', 'aria-label': 'Log ' + x.item.name + ' on ' + U.shortDate(x.date), onclick: function () {
              UI.expensePanel(null, App.render, { amount: String(x.amount), cat: x.item.categoryId || (x.item.kind === 'income' ? '_income' : ''), desc: M.merchantKey(x.item.name) === x.item.key ? x.item.name : x.item.key, date: x.date }); } }, 'Log it') : null,
            h('span', { class: 'amt' + (x.item.kind === 'income' ? ' ok' : '') }, (x.item.kind === 'income' ? '+' : '') + (x.item.amountMode === 'varies' && !x.tx ? '~' : '') + U.money(x.amount, { cents: true }))));
        });
        sec.appendChild(box);
        if (due > 0) sec.appendChild(h('div', { class: 'small muted' }, U.money(due, { cents: true }) + ' still to pay before the end of ' + mName + '.'));
        return sec;
      },
      attention: function () {
        var att = h('section', { class: 'stack', 'aria-labelledby': 'att' }, h('h2', { id: 'att' }, 'Needs attention'));
        if (!s.attention.length) att.appendChild(h('div', { class: 'card pad muted' }, 'Everything is on track' + (isNow ? ' so far this month.' : '.')));
        else {
          var grid = h('div', { class: 'grid-auto' });
          s.attention.forEach(function (r) {
            var lvl = r.st.level === 'ok' ? 'amber' : r.st.level;
            var badge = r.st.level === 'red' ? 'Over' : r.st.level === 'amber' ? 'Just over' : 'Ahead of pace';
            var line = r.st.level === 'ok' ? r.st.text + (isNow ? ' · ' + (dim - +todayStr.slice(8, 10)) + ' days to go' : '') : r.st.text + ' · $0 left this month';
            grid.appendChild(h('div', { class: 'card pad stack-sm' },
              h('div', { class: 'row between' }, txLink('cat=' + encodeURIComponent(r.cat.id) + '&m=' + ym, r.cat.name + ' transactions in ' + mName, r.cat.name, 'strong'), h('span', { class: 'small strong ' + UI.statusClass(lvl) }, badge)),
              h('div', { style: { fontSize: '16px' } }, line),
              UI.bar(r.pct, r.st.level === 'ok' ? 'amber' : r.st.level, s.pace),
              h('div', { class: 'small muted' }, U.money(r.spent, { whole: true }) + ' of ' + U.money(r.limit, { whole: true }) + (r.st.level === 'ok' ? ' · usually ' + U.money(r.limit * s.pace, { whole: true }) + ' by today' : ''))));
          });
          att.appendChild(grid);
        }
        return att;
      },
      bills: function () {
        if (!s.bills.length) return null;
        var bills = h('div', { class: 'card bills' });
        s.bills.forEach(function (b) {
          var st = M.status(b.spent, b.cat.limit);
          bills.appendChild(h('div', null,
            h('div', { class: 'stack-sm', style: { gap: '0' } }, txLink('cat=' + encodeURIComponent(b.cat.id) + '&m=' + ym, b.cat.name + ' transactions in ' + mName, b.cat.name, 'strong'),
              h('span', { class: 'small muted' }, b.paid ? U.money(b.spent, { cents: b.spent < 1000 }) + ' of ' + U.money(b.cat.limit, { whole: true }) + (st.level !== 'ok' ? ' · ' + st.text : '') : 'Budget ' + U.money(b.cat.limit, { whole: true }))),
            h('span', { class: 'strong ' + (b.paid ? (st.level === 'ok' ? 'ok' : UI.statusClass(st.level)) : 'muted') }, b.paid ? 'Paid ✓' : 'Not yet')));
        });
        return h('section', { class: 'stack', 'aria-labelledby': 'bills' }, h('h2', { id: 'bills' }, 'Monthly bills'), bills);
      },
      groups: function () {
        var gs = h('section', { class: 'stack', 'aria-labelledby': 'groups' }, h('h2', { id: 'groups' }, 'Everyday spending'));
        s.groups.forEach(function (g) {
          var isOpen = !!open[g.group.id];
          var card = h('div', { class: 'card' },
            h('button', { type: 'button', class: 'group-head', 'aria-expanded': isOpen ? 'true' : 'false', onclick: function () { open[g.group.id] = !isOpen; openedAt[g.group.id] = Date.now(); App.render(); } },
              h('span', { class: 'strong' }, g.group.name),
              h('span', { class: 'row' }, h('span', { class: 'strong ' + UI.statusClass(g.level) }, U.money(g.spent, { whole: true }) + ' of ' + U.money(g.limit, { whole: true })), h('span', { class: 'muted' }, isOpen ? 'Hide' : 'Show'))));
          if (isOpen) {
            var body = h('div', { class: 'group-body' + (U.fresh(openedAt[g.group.id]) ? ' enter' : '') });
            g.rows.forEach(function (r) {
              body.appendChild(h('div', { class: 'stack-sm' },
                h('div', { class: 'row between' },
                  h('span', { class: 'row', style: { gap: '10px' } }, txLink('cat=' + encodeURIComponent(r.cat.id) + '&m=' + ym, r.cat.name + ' transactions in ' + mName, r.cat.name),
                    h('span', { title: 'Last 6 months' }, Chart.spark(lastSix(r.cat.id, ym), r.limit, isNow))),
                  h('span', null, h('span', { class: 'strong ' + UI.statusClass(r.st.level) }, r.st.text), h('span', { class: 'muted' }, ' · ' + U.money(r.spent, { whole: true }) + ' of ' + U.money(r.limit, { whole: true })))),
                UI.bar(r.pct, r.st.level, s.pace)));
            });
            card.appendChild(body);
          }
          gs.appendChild(card);
        });
        gs.appendChild(h('div', { class: 'small muted' }, (isNow ? 'The line on each bar is where spending would be if spread evenly through the month. ' : '') + 'The small bars show the last 6 months (orange = over the limit). Click a category for its transactions.'));
        return gs;
      },
      accounts: function () {
        var accts = App.cfg.accounts || [];
        if (!accts.length) return null;
        var ac = h('section', { class: 'card pad stack', 'aria-labelledby': 'accts' }, h('h2', { id: 'accts' }, 'Accounts this month'));
        accts.forEach(function (a) {
          var mine = App.txs.filter(function (t) { return t.accountId === a.id; });
          var inMonth = mine.filter(function (t) { return t.date.slice(0, 7) === ym; });
          var sp = inMonth.filter(function (t) { return t.type === 'expense'; }).reduce(function (x, t) { return x + M.counted(t); }, 0);
          var rv = inMonth.filter(function (t) { return t.needsTag; }).length;
          var last = mine.reduce(function (m, t) { return t.date > m ? t.date : m; }, '');
          ac.appendChild(h('div', { class: 'list-row' },
            h('a', { href: '#/transactions?acct=' + a.id + '&m=' + ym, class: 'quiet-link' }, h('strong', null, a.name), h('span', { class: 'muted' }, a.bank ? ' · ' + a.bank : '')),
            h('span', { class: 'muted' }, U.money(sp, { whole: true }) + ' spent' + (rv ? ' · ' + rv + ' to review' : '') + (last ? ' · latest ' + U.shortDate(last) : ' · nothing imported'))));
        });
        return ac;
      },
      travel: function () {
        if (!s.yearly.length) return null;
        var wrap = h('div', { class: 'stack' });
        s.yearly.forEach(function (y) {
          var sec = h('section', { class: 'card pad stack', 'aria-label': y.cat.name },
            h('h2', null, y.cat.name + ' ' + ym.slice(0, 4)),
            h('div', { style: { fontSize: '16px' } }, txLink('cat=' + encodeURIComponent(y.cat.id) + '&scope=year&m=' + ym, y.cat.name + ' transactions this year', U.money(y.spent, { whole: true }) + ' of ' + U.money(y.limit, { whole: true })), ' · ',
              h('span', { class: 'strong ' + UI.statusClass(y.st.level) }, y.st.level === 'ok' ? U.money(y.limit - y.spent, { whole: true }) + ' left this year' : y.st.text)),
            UI.bar(y.limit ? y.spent / y.limit : 0, y.st.level, y.pace));
          // a trip's total includes bookings paid before (or after) its dates
          var tripRows = Trips.rows(App.cfg, App.txs, ym);
          if (tripRows.length) tripRows.forEach(function (t) {
            var extra = t.before ? U.money(t.before, { whole: true }) + ' booked before' : '';
            if (t.after) extra += (extra ? ', ' : '') + U.money(t.after, { whole: true }) + ' after';
            sec.appendChild(h('div', { class: 'list-row' }, h('span', null, txLink('trip=' + encodeURIComponent(t.trip.id) + '&scope=all', 'Transactions for ' + t.trip.name, t.trip.name),
              h('span', { class: 'muted' }, ' · ' + U.shortDate(t.trip.start) + (t.otherYear ? ' ' + t.trip.start.slice(0, 4) : '') + (extra ? ' · ' + extra : ''))), h('span', null, U.money(t.spent, { whole: true }))));
          });
          else if (!App.readOnly) sec.appendChild(h('div', { class: 'small muted' }, 'Add trips in Settings to see each trip\'s total here.'));
          wrap.appendChild(sec);
        });
        return wrap;
      },
      saved: function () {
        var sav = h('section', { class: 'card pad stack', 'aria-labelledby': 'saved' }, h('h2', { id: 'saved' }, 'Saved this month'));
        s.saving.filter(function (r) { return !r.cat.archived; }).forEach(function (r) {
          sav.appendChild(h('div', { class: 'stack-sm' }, h('div', { class: 'row between' }, txLink('cat=' + encodeURIComponent(r.cat.id) + '&m=' + ym, r.cat.name + ' in ' + mName, r.cat.name), h('span', { class: 'muted' }, U.money(r.saved, { whole: true }) + ' of ' + U.money(r.target, { whole: true }))),
            UI.bar(r.target ? r.saved / r.target : 0, 'save', null)));
        });
        var big = (App.cfg.bigExpenses || []);
        if (big.length) {
          var fs = big.map(function (f) { return { f: f, st: Funds.status(f, App.txs, ym) }; });
          var total = U.round2(fs.reduce(function (a, x) { return a + x.st.monthly; }, 0));
          sav.appendChild(h('h3', { style: { marginTop: '8px' } }, 'Big expenses'));
          sav.appendChild(h('div', { class: 'muted' }, 'Set aside for big expenses ' + (isNow ? 'this month' : 'in ' + mName) + ': ', h('strong', { style: { color: 'var(--text)' } }, U.money(total, { whole: true }))));
          fs.forEach(function (x) {
            var f = x.f, st = x.st, c = st.cycle, left = st.monthsLeft;
            var when = 'Due ' + U.monthLabel(c.due) + (st.state === 'saving' || st.state === 'partly paid' ? ' · ' + left + ' month' + (left === 1 ? '' : 's') + ' left' : '') + (f.repeats === 'yearly' ? ' · every year' : '');
            var line = st.state === 'paid' ? h('span', { class: 'ok strong' }, 'Paid ' + U.money(st.paid, { whole: true }) + ' ✓' + (st.over ? ' (' + U.money(st.over, { whole: true }) + ' more than planned)' : ''))
              : st.state === 'overdue' ? h('span', { class: 'amber strong' }, 'Due date passed: mark a payment from this fund, or move the date in Settings')
              : st.state === 'not started' ? h('span', { class: 'muted' }, 'Saving starts ' + U.monthLabel(c.start))
              : h('span', null, 'Set aside ', h('strong', null, U.money(st.monthly, { cents: true })), ' this month' + (st.paid ? ' · ' + U.money(st.paid, { whole: true }) + ' paid so far' : ''));
            sav.appendChild(h('div', { class: 'stack-sm fund' },
              h('div', { class: 'row between' }, h('span', { class: 'strong' }, f.name), h('span', { class: 'muted' }, U.money(Math.max(st.setAside, st.paid), { whole: true }) + ' of ' + U.money(st.amount, { whole: true }))),
              UI.bar(st.pct, st.state === 'overdue' ? 'amber' : 'save', null),
              h('div', { class: 'row between small' }, line, h('span', { class: 'muted' }, when))));
          });
        }
        return sav;
      }
    };
    var lay = layout();
    lay.order.forEach(function (k) { if (lay.hidden[k]) return; var el = build[k](); if (el) main.appendChild(el); });
    var hiddenN = Object.keys(lay.hidden).filter(function (k) { return lay.hidden[k]; }).length;
    if (!App.readOnly) main.appendChild(h('div', { class: 'row small muted' }, h('button', { type: 'button', class: 'btn link', onclick: customize }, 'Customize Home'), hiddenN ? h('span', null, hiddenN + ' section' + (hiddenN === 1 ? '' : 's') + ' hidden') : null));
    var vf = App.readOnly ? Share.viewerFooter() : null;
    if (vf) main.appendChild(vf);
  }

  /* Customize Home: drag sections (or use the arrow buttons), show or hide each one. Saved at once; Reset puts it back. */
  function customize() {
    UI.openPanel(function (p) {
      function save(msg) { UI.saveCfg().then(function () { App.render(); draw(); if (msg) UI.announce(msg); }); }
      function set(order, hidden, msg) { App.cfg.home = { order: order, hidden: hidden }; save(msg); }
      function draw() {
        U.clear(p);
        p.appendChild(UI.panelHead('Customize Home'));
        p.appendChild(h('p', { class: 'muted', style: { margin: 0 } }, 'Drag a section by its handle, or use the arrows. Untick to hide it. Changes show on Home straight away.'));
        var lay = layout();
        p.appendChild(Reorder.list({
          label: 'Home sections',
          items: lay.order.map(function (k) { return { id: k, label: SECTIONS.filter(function (x) { return x[0] === k; })[0][1] }; }),
          extra: function (it) {
            return h('label', { class: 'check small', style: { minHeight: '36px' } }, h('input', { type: 'checkbox', checked: !lay.hidden[it.id], onchange: function (e) {
              var hd = Object.assign({}, lay.hidden); if (e.target.checked) delete hd[it.id]; else hd[it.id] = true;
              set(lay.order, hd, it.label + (e.target.checked ? ' shown.' : ' hidden.'));
            } }), h('span', null, 'Show'));
          },
          onMove: function (ids, moved, pos) { set(ids, lay.hidden, moved.label + ' moved to position ' + (pos + 1) + ' of ' + ids.length + '.'); }
        }));
        p.appendChild(h('button', { type: 'button', class: 'btn', style: { alignSelf: 'flex-start' }, onclick: function () { delete App.cfg.home; save('Home is back to the standard order.'); } }, 'Reset to the standard order'));
      }
      draw();
    }, { label: 'Customize Home' });
  }
  /* Backup and snapshot warnings: main copy only. */
  function warnings(main) {
    var ss = Safety.status();
    if (ss.warning) main.appendChild(h('div', { class: 'toast warn', role: 'alert' }, h('span', null, h('strong', null, 'Possible data loss. '), 'This browser has ' + ss.warning.here + ' transactions but your latest backup (' + ss.warning.savedAt.slice(0, 16).replace('T', ' ') + ') has ' + ss.warning.there + '.'),
      h('button', { type: 'button', class: 'btn danger', onclick: function () { Safety.restore(ss.warning.data).then(function (n) { Safety.integrity().then(App.render); UI.toast('Restored ' + n + ' transactions from your backup folder.'); }); } }, 'Restore the backup'),
      h('button', { type: 'button', class: 'btn', onclick: function () { Safety.dismissWarning(); App.render(); UI.toast('Kept. The larger backup stays in the folder under its own name.'); } }, 'Keep what is here')));
    if (ss.connected && ss.needSetup) main.appendChild(h('div', { class: 'toast warn' }, h('span', null, 'Automatic backups are paused until you set a passphrase: every backup file is locked with it.'),
      h('a', { class: 'btn primary', href: '#/backup' }, 'Set a passphrase')));
    if (ss.connected && ss.perm === 'granted' && ss.needKey) main.appendChild(h('div', { class: 'toast warn' }, h('span', null, 'Automatic backups are paused: they are locked with your snapshot passphrase, and this browser needs it once.'),
      h('button', { type: 'button', class: 'btn primary', onclick: function () { Share.withKey('Resume locked backups', 'Unlock and resume', function () { Safety.writeNow('manual').then(Safety.lockFolder).then(App.render); }); } }, 'Type passphrase')));
    if (ss.connected && ss.perm !== 'granted') main.appendChild(h('div', { class: 'toast warn' }, h('span', null, 'Automatic backups are paused until you allow the folder again (browsers ask after a restart).'),
      h('button', { type: 'button', class: 'btn primary', onclick: function () { Safety.reconnect().then(App.render); } }, 'Allow and resume')));
    if (!ss.connected && ss.supported && App.txs.length) main.appendChild(h('div', { class: 'toast warn' }, h('span', null, 'Turn on automatic backups so a browser crash or cleared data can never lose your budget.'), h('a', { class: 'btn', href: '#/settings' }, 'Set up in Settings')));
    var lb = App.cfg.lastBackup, age = lb ? Math.floor((Date.now() - new Date(lb)) / 864e5) : null;
    if (!(ss.connected && ss.perm === 'granted') && App.txs.length && (age === null || age >= 7)) main.appendChild(h('div', { class: 'toast warn' }, h('span', null, age === null ? 'You have not downloaded a backup yet. Your budget lives only in this browser.' : 'Last backup was ' + age + ' days ago.'),
      h('button', { type: 'button', class: 'btn', onclick: function () { Settings.exportBackup(); } }, 'Download backup now')));
    Share.homeNotes().forEach(function (n) { main.appendChild(n); });
  }
  return { render: render, customize: customize };
})();
