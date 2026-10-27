/* The Split panel: divide one line (usually an imported bank line) across categories. Line 1 takes whatever is left until you type in it.
   Nothing is saved until "Save split"; saving can be undone, and a saved split can be changed or joined back. */
var SplitUI = (function () {
  'use strict';
  var h = U.h;
  function money(c) { return U.money(c / 100, { cents: true }); }
  function expenseCats() { return App.cfg.categories.filter(function (c) { return !c.archived && M.typeFor(App.cfg, c.id) === 'expense'; }); }
  function catName(id) { return UI.catName(id); }

  function open(tx, onDone) {
    if (App.readOnly) return;
    var group = Split.groupOf(App.txs, tx), first = group[0], can = Split.canSplit(first);
    if (!can.ok) { UI.toast(can.why); return; }
    var total = Split.totalOf(group), tc = Split.cents(total), isSplit = group.length > 1 || !!first.splitGroup;
    var valid = {}; expenseCats().forEach(function (c) { valid[c.id] = 1; });
    var st = { lines: [], err: '', joining: false, joinCat: '' };
    if (group.length > 1) st.lines = group.map(function (p) { return { amount: String(Math.abs(p.amount)), cat: p.categoryId, auto: false }; });
    else st.lines = [{ amount: '', cat: valid[first.categoryId] ? first.categoryId : '', auto: true }, { amount: '', cat: '', auto: false }];
    var sug = Split.suggest(App.txs, first);

    UI.openPanel(function (p) {
      var rowsEl, status, saveBtn;
      function parsed() { return st.lines.map(function (l) { var v = U.calc(l.amount); return v === null ? null : Math.max(0, v); }); }
      function placedOthers() { var v = parsed(), s = 0; for (var i = 1; i < v.length; i++) s += Split.cents(v[i] || 0); return s; }
      /* line 1 follows the remainder until it is typed in */
      function sync() {
        if (st.lines[0].auto) { var rest = Math.max(0, tc - placedOthers()); st.lines[0].amount = rest ? String(rest / 100) : ''; var inp = document.getElementById('sp-a0'); if (inp) inp.value = st.lines[0].amount; }
        var v = parsed(), sum = v.reduce(function (a, x) { return a + Split.cents(x || 0); }, 0), left = tc - sum;
        status.className = 'sp-status ' + (left === 0 ? 'ok' : 'amber') + ' strong';
        status.textContent = left === 0 ? '✓ All ' + money(tc) + ' is placed.' : left > 0 ? money(left) + ' still to place of ' + money(tc) + '.' : money(-left) + ' over the ' + money(tc) + ' total.';
      }
      function draw() {
        U.clear(p);
        p.appendChild(UI.panelHead(isSplit ? 'Change the split' : 'Split this line', first.desc || 'No name'));
        p.appendChild(h('div', { class: 'notice' }, h('div', { class: 'row between' }, h('strong', null, money(tc) + (first.amount < 0 ? ' refund' : '')), h('span', { class: 'muted' }, U.shortDate(first.date) + ' ' + first.date.slice(0, 4) + ' · ' + (UI.acctName(first) || (first.source === 'manual' ? 'Added by hand' : '')))),
          h('div', { class: 'small' }, 'The bank amount stays as it is; this only divides it between categories. The lines must add up to it.')));
        var rvs = ReviewedUI.note([first.date], 'Splitting this line'); if (rvs) p.appendChild(rvs);
        if (sug && !isSplit) p.appendChild(h('button', { type: 'button', class: 'btn', style: { alignSelf: 'flex-start' }, onclick: function () {
          st.lines = Split.applyShares(total, sug.shares).map(function (x) { return { amount: String(x.amount), cat: valid[x.cat] ? x.cat : '', auto: false }; }); draw(); } },
          'Same split as ' + U.shortDate(sug.date) + ': ' + sug.shares.map(function (s) { return catName(s.cat) + ' ' + Math.round(s.share * 100) + '%'; }).join(', ')));
        rowsEl = h('div', { class: 'stack' });
        st.lines.forEach(function (l, i) {
          var amt = h('input', { id: 'sp-a' + i, class: 'input', inputmode: 'decimal', autocomplete: 'off', value: l.amount, 'aria-describedby': i === 0 && l.auto ? 'sp-auto' : null,
            oninput: function (e) { l.amount = e.target.value; if (i === 0) l.auto = false; st.err = ''; err.textContent = ''; sync(); } });
          var cat = UI.categorySelect('sp-c' + i, l.cat, function (e) { l.cat = e.target.value; st.err = ''; err.textContent = ''; }, { placeholder: 'Choose…' });
          // only spending categories are offered
          [].slice.call(cat.querySelectorAll('optgroup')).forEach(function (g) { if (g.label === 'Not spending') g.remove(); });
          [].slice.call(cat.querySelectorAll('option')).forEach(function (o) { if (o.value && !valid[o.value]) o.remove(); });
          cat.value = l.cat || '';
          rowsEl.appendChild(h('div', { class: 'sp-row' },
            h('div', { class: 'field' }, h('label', { for: 'sp-a' + i }, 'Amount ' + (i + 1)), amt, i === 0 && l.auto ? h('div', { id: 'sp-auto', class: 'small muted' }, 'Fills in what is left. Type here to set it yourself.') : null),
            h('div', { class: 'field' }, h('label', { for: 'sp-c' + i }, 'Category ' + (i + 1)), cat),
            h('div', { class: 'row sp-act' },
              i > 0 ? h('button', { type: 'button', class: 'btn link', 'aria-label': 'Put the rest in line ' + (i + 1), onclick: function () {
                var others = 0, v = parsed(); v.forEach(function (x, k) { if (k !== i) others += Split.cents(x || 0); }); var rest = Math.max(0, tc - others);
                l.amount = rest ? String(rest / 100) : ''; amt.value = l.amount; sync(); } }, 'Put the rest here') : null,
              st.lines.length > 2 && i > 0 ? h('button', { type: 'button', class: 'btn link', 'aria-label': 'Remove line ' + (i + 1), onclick: function () { st.lines.splice(i, 1); draw(); } }, 'Remove') : null)));
        });
        p.appendChild(rowsEl);
        if (st.lines.length < 8) p.appendChild(h('button', { type: 'button', class: 'btn link', style: { alignSelf: 'flex-start' }, onclick: function () { st.lines.push({ amount: '', cat: '', auto: false }); draw(); var n = document.getElementById('sp-a' + (st.lines.length - 1)); if (n) n.focus(); } }, 'Add another line'));
        status = h('div', { class: 'sp-status', role: 'status', 'aria-live': 'polite' });
        var err = h('div', { class: 'small red', role: 'alert' }, st.err);
        saveBtn = h('button', { type: 'button', class: 'btn primary', style: { minHeight: '48px' }, onclick: save }, 'Save split');
        p.appendChild(status); p.appendChild(err);
        p.appendChild(h('div', { class: 'row' }, saveBtn, h('button', { type: 'button', class: 'btn', onclick: UI.closePanel }, 'Cancel')));
        if (isSplit) p.appendChild(joinBox());
        sync();
        function save() {
          var v = parsed(), lines = st.lines.map(function (l, i) { return { amount: v[i] === null ? 0 : v[i], cat: l.cat }; });
          var r = Split.build(App.cfg, group, lines, new Date().toISOString());
          if (!r.ok) { st.err = r.error; err.textContent = r.error; return; }
          var before = JSON.parse(JSON.stringify(group)), newIds = r.parts.map(function (x) { return x.id; });
          Hist.why('Split');
          DB.putTx(r.parts).then(function () { return r.removeIds.length ? DB.deleteTx(r.removeIds) : null; }).then(UI.reload).then(function () {
            UI.closePanel(); if (onDone) onDone();
            UI.toast('Split into ' + r.parts.length + ' lines: ' + r.parts.map(function (x) { return catName(x.categoryId) + ' ' + U.money(Math.abs(x.amount), { cents: true }); }).join(', ') + '.', function () {
              var back = before.map(function (x) { return x.id; });
              Hist.why('Undo'); DB.putTx(before).then(function () { var gone = newIds.filter(function (id) { return back.indexOf(id) < 0; }); return gone.length ? DB.deleteTx(gone) : null; }).then(UI.reload).then(function () { if (onDone) onDone(); UI.toast('Undone.'); });
            });
          }).catch(function (e) { st.err = 'Could not save: ' + e.message; err.textContent = st.err; });
        }
      }
      function joinBox() {
        if (!st.joining) return h('div', { class: 'stack-sm sp-join' }, h('button', { type: 'button', class: 'btn link', style: { alignSelf: 'flex-start' }, onclick: function () {
          var best = group.slice().sort(function (a, b) { return Math.abs(b.amount) - Math.abs(a.amount); })[0]; st.joining = true; st.joinCat = best.categoryId; draw(); } }, 'Join back into one line'));
        var sel = UI.categorySelect('sp-join', st.joinCat, function (e) { st.joinCat = e.target.value; }, { placeholder: 'Choose…' });
        [].slice.call(sel.querySelectorAll('optgroup')).forEach(function (g) { if (g.label === 'Not spending') g.remove(); });
        return h('div', { class: 'toast warn', role: 'alert' }, h('span', null, 'Join these ' + group.length + ' lines back into one ' + money(tc) + ' line? It goes to the category below and waits for you in Review.'),
          h('div', { class: 'field' }, h('label', { for: 'sp-join' }, 'Category for the joined line'), sel),
          h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn danger', onclick: function () {
            if (!st.joinCat) return;
            var r = Split.join(App.cfg, group, st.joinCat, new Date().toISOString()), before = JSON.parse(JSON.stringify(group));
            Hist.why('Join back'); DB.putTx([r.tx]).then(function () { return r.removeIds.length ? DB.deleteTx(r.removeIds) : null; }).then(UI.reload).then(function () {
              UI.closePanel(); if (onDone) onDone();
              UI.toast('Joined back into one ' + money(tc) + ' line.', function () { DB.putTx(before).then(UI.reload).then(function () { if (onDone) onDone(); UI.toast('Split restored.'); }); });
            });
          } }, 'Join'), h('button', { type: 'button', class: 'btn', onclick: function () { st.joining = false; draw(); } }, 'Keep the split')));
      }
      draw();
      var f = p.querySelector(st.lines[0].auto ? '#sp-c0' : '#sp-a0'); if (f) f.focus();
    }, { label: isSplit ? 'Change the split' : 'Split this line' });
  }
  return { open: open };
})();
