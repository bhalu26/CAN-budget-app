/* Group bills on screen: track what others owe you, link the e-Transfers that paid you back, note cash. Nothing is decided silently,
   and every change can be undone. A linked repayment is "not counted": it is neither income nor spending. */
var GroupUI = (function () {
  'use strict';
  var h = U.h;
  function money(v) { return U.money(v, { cents: true }); }
  function find(id) { return App.txs.filter(function (t) { return t.id === id; })[0]; }
  function stamp() { return new Date().toISOString(); }

  /* write changed lines, then offer Undo (puts the earlier copies back) */
  function write(changed, msg, onDone) {
    var before = changed.map(function (t) { return JSON.parse(JSON.stringify(find(t.id) || t)); });
    Hist.why('Repayment');
    return DB.putTx(changed).then(UI.reload).then(function () {
      UI.closePanel(); App.render(); if (onDone) onDone();
      UI.toast(msg, function () { Hist.why('Undo'); DB.putTx(before).then(UI.reload).then(function () { App.render(); if (onDone) onDone(); UI.toast('Undone.'); }); });
    });
  }

  /* Panel for one group bill: totals, linked repayments, candidates, cash. */
  function open(bill, onDone) {
    if (App.readOnly) return;
    bill = find(bill.id) || bill;
    if (!Group.isGroup(bill)) { UI.toast('This line is not marked as a group bill. Edit details > "I paid for others too".'); return; }
    var picked = {};
    UI.openPanel(function (p) {
      function draw() {
        bill = find(bill.id) || bill;
        U.clear(p);
        var b = Group.balance(bill, App.txs), reps = Group.repayments(bill, App.txs), cands = Group.candidates(App.txs, bill);
        p.appendChild(UI.panelHead('Group bill', bill.desc || 'No name'));
        p.appendChild(h('div', { class: 'notice stack-sm' },
          h('div', { class: 'row between' }, h('span', null, 'Bill (bank amount)'), h('strong', null, money(bill.amount))),
          h('div', { class: 'row between' }, h('span', null, 'Your share (counts in your spending)'), h('strong', null, money(bill.share))),
          h('div', { class: 'row between' }, h('span', null, 'Others owe you'), h('strong', null, money(b.owed))),
          h('div', { class: 'row between' }, h('span', null, 'Paid back so far'), h('strong', null, money(b.repaid))),
          h('div', { class: 'row between', role: 'status' }, h('span', null, b.extra ? 'Paid back more than owed' : 'Still owed to you'), h('strong', { class: b.left ? 'amber' : 'ok' }, b.extra ? money(b.extra) + ' extra' : b.left ? money(b.left) : '✓ all paid back'))));
        if (reps.length) p.appendChild(h('div', { class: 'stack-sm' }, h('h3', null, 'Repayments you linked'), h('ul', { class: 'hist-list' }, reps.map(function (r) {
          return h('li', null, h('div', { class: 'row between' }, h('span', null, h('strong', null, r.desc || 'No name'), h('span', { class: 'muted small' }, ' · ' + U.shortDate(r.date) + ' · ' + money(Math.abs(r.amount)))),
            h('button', { type: 'button', class: 'btn link', 'aria-label': 'Unlink ' + (r.desc || 'repayment') + ' ' + money(Math.abs(r.amount)), onclick: function () { write([Group.unlink(r, stamp())], 'Unlinked. It is back in Review as money in.', onDone); } }, 'Unlink')));
        }))));
        if (b.left > 0 || cands.length) {
          var n = Object.keys(picked).filter(function (k) { return picked[k]; }).length;
          p.appendChild(h('div', { class: 'stack-sm' }, h('h3', null, 'Link money you received'),
            cands.length ? h('p', { class: 'small muted', style: { margin: 0 } }, 'Tick the e-Transfers or deposits that were people paying you back. They stay in your history but are not counted as income.') : h('p', { class: 'small muted', style: { margin: 0 } }, 'No money-in lines after this bill yet. Import your next statement, or note cash below.'),
            h('ul', { class: 'hist-list' }, cands.map(function (c) {
              return h('li', null, h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!picked[c.id], onchange: function (e) { picked[c.id] = e.target.checked; draw(); var x = p.querySelector('input[type=checkbox][data-id="' + c.id + '"]'); if (x) x.focus(); }, 'data-id': c.id }),
                h('span', null, h('strong', null, c.desc || 'No name'), h('span', { class: 'muted small' }, ' · ' + U.shortDate(c.date) + ' · ' + money(Math.abs(c.amount))))));
            })),
            cands.length ? h('button', { type: 'button', class: 'btn primary', style: { alignSelf: 'flex-start' }, onclick: function () {
              var chosen = cands.filter(function (c) { return picked[c.id]; });
              if (!chosen.length) { UI.toast('Tick at least one line first.'); return; }
              write(chosen.map(function (c) { return Group.link(c, bill, stamp()); }), 'Linked ' + chosen.length + ' repayment' + (chosen.length === 1 ? '' : 's') + ' to ' + (bill.desc || 'the bill') + '.', onDone); } }, 'Link ' + (n ? n + ' selected' : 'selected')) : null));
        }
        var cash = h('input', { id: 'gp-cash', class: 'input', inputmode: 'decimal', value: bill.settled ? String(bill.settled) : '', 'aria-describedby': 'gp-cash-h' });
        p.appendChild(h('div', { class: 'stack-sm' }, h('h3', null, 'Paid back in cash'), h('div', { class: 'row', style: { alignItems: 'flex-end' } },
          h('div', { class: 'field', style: { flex: '0 1 170px' } }, h('label', { for: 'gp-cash' }, 'Cash received in total'), cash),
          h('button', { type: 'button', class: 'btn', onclick: function () {
            var v = cash.value.trim() === '' ? 0 : U.calc(cash.value); if (v === null || v < 0) { UI.toast('Enter the cash received as a number, like 40.'); cash.focus(); return; }
            var u = JSON.parse(JSON.stringify(bill)); if (v) u.settled = v; else delete u.settled; u.updatedAt = stamp();
            write([u], v ? 'Noted ' + money(v) + ' received in cash.' : 'Cash note removed.', onDone); } }, 'Save cash')),
          h('div', { id: 'gp-cash-h', class: 'small muted' }, 'Counts toward what is owed. Not a transaction, so it does not touch your balances.')));
        p.appendChild(h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: function () { UI.closePanel(); UI.expensePanel(bill, App.render); } }, 'Change the share'), h('button', { type: 'button', class: 'btn', onclick: UI.closePanel }, 'Close')));
      }
      draw();
    }, { label: 'Group bill', wide: true });
  }

  /* An incoming line: which group bill did it repay? */
  function repayFrom(incoming, onDone) {
    if (App.readOnly) return;
    var bills = Group.open(App.txs);
    UI.openPanel(function (p) {
      p.appendChild(UI.panelHead('Which bill did this repay?', (incoming.desc || 'Money in') + ' · ' + money(Math.abs(incoming.amount))));
      if (!bills.length) { p.appendChild(h('p', { class: 'muted' }, 'No group bills are waiting for repayment. On the dinner, choose Edit details and tick "I paid for others too: count only my share".')); p.appendChild(h('button', { type: 'button', class: 'btn', onclick: UI.closePanel }, 'Close')); return; }
      p.appendChild(h('p', { class: 'small muted', style: { margin: 0 } }, 'It will be linked to that bill and left out of income and spending.'));
      p.appendChild(h('ul', { class: 'hist-list' }, bills.map(function (x) {
        return h('li', null, h('div', { class: 'row between' }, h('span', null, h('strong', null, x.t.desc || 'No name'), h('span', { class: 'muted small' }, ' · ' + U.shortDate(x.t.date) + ' · ' + money(x.b.left) + ' still owed of ' + money(x.b.owed))),
          h('button', { type: 'button', class: 'btn', 'aria-label': 'This repays ' + (x.t.desc || 'the bill') + ' from ' + U.shortDate(x.t.date), onclick: function () { write([Group.link(incoming, x.t, stamp())], 'Linked to ' + (x.t.desc || 'the bill') + '. ' + money(Math.max(0, x.b.left - Math.abs(incoming.amount))) + ' still owed.', onDone); } }, 'This one')));
      })));
      p.appendChild(h('button', { type: 'button', class: 'btn', onclick: UI.closePanel }, 'Cancel'));
    }, { label: 'Which bill did this repay?' });
  }
  function unlink(incoming, onDone) { write([Group.unlink(incoming, stamp())], 'Unlinked. It is back in Review as money in.', onDone); }

  /* Everything still owed to you. */
  function list() {
    UI.openPanel(function (p) {
      var bills = Group.open(App.txs);
      p.appendChild(UI.panelHead('Owed to you', bills.length ? money(Group.totalOpen(App.txs)) + ' across ' + bills.length + ' group bill' + (bills.length === 1 ? '' : 's') : 'Nothing owed'));
      if (!bills.length) { p.appendChild(h('p', { class: 'muted' }, 'All group bills are paid back.')); return; }
      p.appendChild(h('ul', { class: 'hist-list' }, bills.map(function (x) {
        return h('li', null, h('div', { class: 'row between' }, h('span', null, h('strong', null, x.t.desc || 'No name'), h('span', { class: 'muted small' }, ' · ' + U.shortDate(x.t.date) + ' · bill ' + money(x.t.amount) + ', your share ' + money(x.t.share))),
          h('span', { class: 'row' }, h('strong', { class: 'amber' }, money(x.b.left)), h('button', { type: 'button', class: 'btn', 'aria-label': 'Track repayments for ' + (x.t.desc || 'bill') + ' on ' + U.shortDate(x.t.date), onclick: function () { UI.closePanel(); open(x.t, App.render); } }, 'Track'))));
      })));
      p.appendChild(h('a', { class: 'btn', href: '#/transactions?f=owed&scope=all', onclick: UI.closePanel }, 'See these in Transactions'));
    }, { label: 'Owed to you' });
  }
  return { open: open, repayFrom: repayFrom, unlink: unlink, list: list };
})();
