/* Accounts: your accounts shown with their balances and net worth. Names (and everything else) can be changed at any time; nothing is fetched.
   Balances come from a bank file's balance column or from what you type. */
var AccountsUI = (function () {
  'use strict';
  var h = U.h, adding = false, err = '';

  function snapshot() { return JSON.parse(JSON.stringify(App.cfg.accounts || [])); }
  function save(msg, before) {
    return UI.saveCfg().then(function () {
      App.render();
      UI.toast(msg, before ? function () { App.cfg.accounts = before; UI.saveCfg().then(function () { App.render(); UI.toast('Undone.'); }); } : null);
    });
  }
  function source(b) { return b.source === 'import' ? 'from your import' : 'you entered'; }
  function money(a, v) { return U.money(v, { cents: true }) + (a.currency && a.currency !== 'CAD' ? ' ' + a.currency : ''); }
  function txCount(a) { return App.txs.filter(function (t) { return t.accountId === a.id; }).length; }

  function render(main) {
    var today = U.today(), w = Accounts.netWorth(App.cfg, App.txs, today);
    var prevEnd = U.shiftMonth(today.slice(0, 7), -1), pp = prevEnd.split('-');
    var last = Accounts.netWorth(App.cfg, App.txs, prevEnd + '-' + U.pad(U.daysInMonth(+pp[0], +pp[1])));
    var accts = App.cfg.accounts || [];
    main.appendChild(h('header', { class: 'stack-sm' },
      h('h1', null, w.rows.length ? 'Accounts · net worth ' + U.money(w.value, { whole: true }) : 'Accounts'),
      w.rows.length ? h('div', { class: 'muted' }, U.money(w.assets, { whole: true }) + ' in cash and investments − ' + U.money(w.debts, { whole: true }) + ' owed on cards',
        last.rows.length ? ' · ' + (w.value >= last.value ? 'up ' : 'down ') + U.money(Math.abs(w.value - last.value), { whole: true }) + ' since the end of ' + U.MONTHS[+pp[1] - 1] : null)
        : h('p', { class: 'muted', style: { margin: 0 } }, 'Your accounts are listed here. Add each one\'s balance once (or import a bank file that has a balance column) and net worth appears. Balances stay on this computer.'),
      w.missing.length && w.rows.length ? h('div', { class: 'small muted' }, 'Not counted yet (no balance): ' + w.missing.map(function (a) { return a.name; }).join(', ') + '.') : null));

    var ser = Accounts.series(App.cfg, App.txs, 12, today);
    if (ser.length >= 2) {
      main.appendChild(h('section', { class: 'card pad stack-sm', 'aria-labelledby': 'nw-h' }, h('h2', { id: 'nw-h' }, 'Net worth at each month end'),
        Chart.columns({ plain: true, noun: 'net worth', height: 180, title: 'Net worth at the end of each month' + (ser.some(function (x) { return x.value < 0; }) ? '. Months below zero show no column.' : ''),
          data: ser.map(function (x) { return { label: U.MON[+x.ym.slice(5) - 1], full: U.monthLabel(x.ym) + (x.partial ? ' (so far)' : ''), value: x.value, budget: 0, partial: x.partial }; }) }),
        h('div', { class: 'small muted' }, 'Worked out from the balances you recorded plus the transactions after them.')));
    }

    if (!accts.length) main.appendChild(h('div', { class: 'card pad muted' }, 'No accounts yet. They are added when you import a bank file, or you can add one below.'));
    Accounts.GROUPS.forEach(function (g) {
      var list = accts.filter(function (a) { return !a.closed && Accounts.groupOf(a) === g[0]; });
      if (!list.length) return;
      var sec = h('section', { class: 'card pad stack', 'aria-labelledby': 'ag-' + g[0] }, h('h2', { id: 'ag-' + g[0] }, g[1]));
      list.forEach(function (a) { sec.appendChild(row(a, today)); });
      main.appendChild(sec);
    });
    main.appendChild(adding ? addForm() : h('button', { type: 'button', class: 'btn', style: { alignSelf: 'flex-start' }, onclick: function () { adding = true; err = ''; App.render(); } }, 'Add an account'));
    var closed = accts.filter(function (a) { return a.closed; });
    if (closed.length) main.appendChild(h('section', { class: 'card pad stack', 'aria-labelledby': 'ag-closed' }, h('h2', { id: 'ag-closed' }, 'Closed (not counted)'), closed.map(function (a) { return row(a, today); })));
  }

  /* Rename: saved when you leave the field; an empty name puts the old one back. Old transactions show the new name too. */
  function nameField(a) {
    return h('input', { class: 'input acct-name', value: a.name, 'aria-label': 'Name of ' + a.name, autocomplete: 'off', onchange: function (e) {
      var v = e.target.value.trim();
      if (!v) { e.target.value = a.name; UI.toast('An account needs a name.'); return; }
      if (v === a.name) return;
      var before = snapshot(), old = a.name; a.name = v;
      save('Renamed ' + old + ' to ' + v + '.', before);
    }, onkeydown: function (e) { if (e.key === 'Enter') e.target.blur(); } });
  }

  function row(a, today) {
    var e = Accounts.estimate(a, App.txs, today), id = 'bal-' + a.id, debt = Accounts.isDebt(a);
    var input = h('input', { id: id, class: 'input', inputmode: 'decimal', autocomplete: 'off', placeholder: e ? String(e.amount) : 'e.g. 1250.00', onkeydown: function (ev) { if (ev.key === 'Enter') update(); } });
    function update() {
      var v = U.calc(input.value);
      if (v === null) { UI.toast('Enter the balance as a number, like 1250.00' + (debt ? ' (what you owe)' : '') + '.'); input.focus(); return; }
      var before = snapshot();
      a.balances = Accounts.setBalance(a, today, debt ? Math.abs(v) : v, 'manual');
      save(a.name + ' balance set to ' + money(a, v) + '.', before).then(function () { var n = document.getElementById(id); if (n) n.focus(); });
    }
    var hs = HealthUI.summary(), bad = hs && hs.open.some(function (i) { return i.kind === 'balance' && i.accountId === a.id; });
    var n = txCount(a);
    var typeSel = h('select', { class: 'input', 'aria-label': 'What ' + a.name + ' is (for net worth)', onchange: function (ev) { var b = snapshot(); a.type = ev.target.value; save('Saved.', b); } },
      Accounts.TYPES.concat(a.type === 'loan' ? [Accounts.BY_ID.loan] : []).map(function (t) { return h('option', { value: t.id }, t.label); }));
    typeSel.value = a.type || (a.kind === 'card' ? 'credit' : 'chequing');
    var kindSel = h('select', { class: 'input', 'aria-label': 'How imports read ' + a.name, onchange: function (ev) { var b = snapshot(); a.kind = ev.target.value; save('Saved. Affects future imports only.', b); } },
      h('option', { value: 'bank' }, 'Bank account (money out is negative)'), h('option', { value: 'card' }, 'Credit card (purchases are positive)'));
    kindSel.value = a.kind || 'bank';
    var curSel = h('select', { class: 'input', 'aria-label': 'Currency of ' + a.name, onchange: function (ev) { var b = snapshot(); a.currency = ev.target.value; save('Saved.', b); } }, h('option', { value: 'CAD' }, 'CAD'), h('option', { value: 'USD' }, 'USD'));
    curSel.value = a.currency || 'CAD';
    var rate = a.currency === 'USD' ? h('input', { class: 'input', inputmode: 'decimal', value: a.rate ? String(a.rate) : '', 'aria-label': 'USD to CAD rate for ' + a.name, placeholder: 'rate, e.g. 1.37',
      onchange: function (ev) { var v = U.calc(ev.target.value); if (!(v > 0)) { UI.toast('Enter a rate like 1.37.'); return; } var b = snapshot(); a.rate = v; a.rateDate = U.today(); save('Rate saved: 1 USD = ' + v + ' CAD.', b); } }) : null;
    var closedBox = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!a.closed, onchange: function (ev) { var b = snapshot(); a.closed = ev.target.checked; save(ev.target.checked ? a.name + ' closed: kept, not counted in net worth.' : a.name + ' reopened.', b); } }), h('span', null, 'Closed (keep it, but do not count it)'));
    var fl = function (label, el, basis) { return h('div', { class: 'field', style: { flex: basis } }, h('label', null, label, el)); };
    return h('div', { class: 'acct-row' },
      h('div', { class: 'stack-sm', style: { minWidth: 0, flex: '1 1 320px' } },
        h('div', { class: 'row between' }, h('div', { style: { flex: '1 1 220px', maxWidth: '360px' } }, nameField(a)), a.closed ? h('span', { class: 'muted small' }, n + ' transactions') :
          h('strong', null, e ? money(a, e.amount) + (debt ? ' owed' : '') : h('span', { class: 'muted' }, 'No balance yet'))),
        e && !a.closed ? h('div', { class: 'small muted' }, 'Balance ' + money(a, e.from.amount) + ' on ' + U.shortDate(e.from.date) + ' (' + source(e.from) + ')' +
          (e.count ? ' + ' + e.count + ' transaction' + (e.count === 1 ? '' : 's') + ' since, so about ' + money(a, e.amount) + ' today' : '') +
          (a.currency && a.currency !== 'CAD' ? ' · ' + (a.rate ? U.money(Accounts.inCad(a, e.amount), { cents: true }) + ' CAD at your rate of ' + a.rate + (a.rateDate ? ' (' + U.shortDate(a.rateDate) + ')' : '') : 'type a rate under Details to count it in CAD') : '')) : null,
        bad ? h('div', { class: 'small amber strong' }, '⚠ Balances and transactions do not add up. ', h('a', { href: '#/health' }, 'See Data health')) : null,
        h('details', { class: 'more' }, h('summary', { class: 'strong' }, 'Details', h('span', { class: 'muted small', style: { fontWeight: '400' } }, ' · ' + n + ' transactions · type, currency, closed')),
          h('div', { class: 'stack more-body' },
            h('div', { class: 'row' }, fl('Type', typeSel, '1 1 240px'), fl('Imports read it as', kindSel, '1 1 280px')),
            h('div', { class: 'row', style: { alignItems: 'flex-end' } }, fl('Currency', curSel, '0 1 110px'), rate ? fl('USD to CAD rate', rate, '0 1 150px') : null),
            closedBox))),
      a.closed ? null : h('div', { class: 'row', style: { alignItems: 'flex-end' } },
        h('div', { class: 'field' }, h('label', { for: id }, 'Update balance' + (debt ? ' (owed)' : '')), input),
        h('button', { type: 'button', class: 'btn', 'aria-label': 'Save balance for ' + a.name, onclick: update }, 'Save')));
  }

  function addForm() {
    var name = h('input', { id: 'na-n', class: 'input' }), bal = h('input', { id: 'na-b', class: 'input', inputmode: 'decimal' });
    var type = h('select', { id: 'na-t', class: 'input' }, Accounts.TYPES.map(function (t) { return h('option', { value: t.id }, t.label); }));
    var date = h('input', { id: 'na-d', type: 'date', class: 'input', value: U.today() });
    var cur = h('select', { id: 'na-c', class: 'input' }, h('option', { value: 'CAD' }, 'CAD'), h('option', { value: 'USD' }, 'USD'));
    var rate = h('input', { id: 'na-r', class: 'input', inputmode: 'decimal', 'aria-describedby': 'na-r-hint' });
    var msg = h('div', { class: 'small red', role: 'alert' }, err);
    function add() {
      var v = U.calc(bal.value), r = cur.value === 'USD' ? U.calc(rate.value) : null;
      if (!name.value.trim()) { msg.textContent = 'Give the account a name.'; name.focus(); return; }
      if (v === null) { msg.textContent = 'Enter its balance, like 1250.00.'; bal.focus(); return; }
      if (!U.validDate(date.value)) { msg.textContent = 'Pick the date of that balance.'; date.focus(); return; }
      if (cur.value === 'USD' && !(r > 0)) { msg.textContent = 'Enter your USD to CAD rate, like 1.37.'; rate.focus(); return; }
      var before = snapshot(), debt = Accounts.BY_ID[type.value].group === 'debt';
      var a = { id: U.uid(), name: name.value.trim(), kind: type.value === 'credit' ? 'card' : 'bank', type: type.value, currency: cur.value, numbers: [], balances: [] };
      if (r) { a.rate = r; a.rateDate = U.today(); }
      a.balances = Accounts.setBalance(a, date.value, debt ? Math.abs(v) : v, 'manual');
      App.cfg.accounts = (App.cfg.accounts || []).concat([a]); adding = false; err = '';
      save('Added ' + a.name + '.', before);
    }
    var fl = function (id, label, el, basis) { return h('div', { class: 'field', style: { flex: basis } }, h('label', { for: id }, label), el); };
    return h('fieldset', { class: 'card pad stack-sm', style: { margin: 0 } }, h('legend', { class: 'strong' }, 'Add an account'),
      h('p', { class: 'small muted', style: { margin: 0 } }, 'For accounts you do not import, like a TFSA or RRSP. For a credit card, enter what you owe.'),
      h('div', { class: 'row', style: { alignItems: 'flex-end' } }, fl('na-n', 'Name', name, '1 1 200px'), fl('na-t', 'Type', type, '1 1 220px')),
      h('div', { class: 'row', style: { alignItems: 'flex-end' } }, fl('na-b', 'Balance', bal, '0 1 150px'), fl('na-d', 'On', date, '0 1 170px'), fl('na-c', 'Currency', cur, '0 1 110px'),
        fl('na-r', 'USD rate (if USD)', rate, '0 1 150px')),
      h('div', { id: 'na-r-hint', class: 'small muted' }, 'No live exchange rates: type the rate you want to use, and update it when you like.'),
      msg,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onclick: add }, 'Add account'),
        h('button', { type: 'button', class: 'btn', onclick: function () { adding = false; err = ''; App.render(); } }, 'Cancel')));
  }
  return { render: render };
})();
