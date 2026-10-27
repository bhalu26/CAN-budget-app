/* Newest-copy protection on screen (js/lineage.js does the deciding):
   - stamp(): the save record for a file about to be written (Save file, Download budget file, a shared snapshot);
     written quietly (not a change, no backup), and remembered on this device once the file is out (saved()).
   - check(): before a file is opened for work, is it the newest this device knows? warning() says what to do.
   - mergeFlow()/mergePanel(): choose another copy, see exactly what would change, merge (with Undo). */
var LineageUI = (function () {
  'use strict';
  var h = U.h, KEY = 'known:';

  function known(id) { return id ? DB.getMeta(KEY + id).catch(function () { return null; }) : Promise.resolve(null); }
  function note(lin, name) {
    if (!lin || !lin.id) return Promise.resolve();
    return known(lin.id).then(function (k) { var n = Lineage.remember(k, lin, name); return n === k ? null : DB.setMeta(KEY + lin.id, n); }).catch(function () {});
  }
  function stamp() {
    var lin = Lineage.stamp(App.cfg.lineage, new Date().toISOString());
    App.cfg.lineage = lin;
    return DB.saveConfig(App.cfg, true).then(function () { return lin; });
  }
  function saved(lin, name) { return note(lin, name); }
  /* what this device knows about the budget a file belongs to: its remembered record, or the budget kept in this browser */
  function check(data) {
    var lin = data && data.config && data.config.lineage;
    return known(lin && lin.id).then(function (k) {
      var mine = App.cfg && !DB.inMemory() && App.cfg.lineage;
      if (mine && lin && mine.id === lin.id) k = Lineage.remember(k, mine, null) || mine;
      return Lineage.compare(lin, k);
    });
  }
  function when(iso) { return iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; }
  /* a plain sentence for an older or forked file, or null when it is fine to open */
  function warningText(c) {
    if (c.state === 'older') return 'This is an older copy: revision ' + c.file.rev + ' from ' + when(c.file.at) + '. You already saved revision ' + c.known.rev + ' on ' + when(c.known.at) + (c.known.name ? ' (' + c.known.name + ')' : '') + '. Working on this one would leave those changes behind.';
    if (c.state === 'diverged') return 'This copy and your latest copy were both changed after revision ' + (c.fork ? c.fork.r + ' (' + when(c.fork.at) + ')' : 'they parted') + ': this one is revision ' + c.file.rev + ' from ' + when(c.file.at) + ', yours is revision ' + c.known.rev + ' from ' + when(c.known.at) + '. Opening just one of them would leave the other\'s changes behind: merge them.';
    return null;
  }

  /* ---------- compare and merge ---------- */
  function current() { return Promise.all([DB.getConfig(), DB.allTx()]).then(function (r) { return { config: r[0], transactions: r[1] }; }); }
  function pickFile() {
    return new Promise(function (ok, no) {
      var inp = h('input', { type: 'file', accept: Vault.ACCEPT, style: { display: 'none' } });
      inp.addEventListener('change', function () { var f = inp.files[0]; inp.remove(); if (!f) return no(Object.assign(new Error('cancelled'), { name: 'AbortError' })); U.readFile(f).then(function (t) { ok({ name: f.name, text: t }); }, no); });
      document.body.appendChild(inp); inp.click();
    });
  }
  /* open another copy: with the key this tab already has (same passphrase), else ask */
  function openOther(f) {
    return Share.openFile(f.text, null).catch(function (e) {
      if (e.code !== 'NEED_PASS' && e.code !== 'WRONG_PASS') throw e;
      return new Promise(function (ok, no) {
        Share.askPass({ title: 'Open the other copy', verb: 'Open', sub: f.name, intro: 'It is locked with a different passphrase from this budget (an earlier one?). Type the passphrase it was saved with.',
          run: function (pass) { return Share.openFile(f.text, pass); }, done: ok });
      });
    });
  }
  function mergeFlow() {
    pickFile().then(function (f) { return openOther(f).then(function (d) { return current().then(function (mine) { mergePanel(mine, d, f.name); }); }); })
      .catch(function (e) { if (e && e.name === 'AbortError') return; UI.toast('Could not open that copy: ' + e.message); });
  }
  function line(t) { return (t.desc || 'No description') + ' · ' + U.money(t.amount, { cents: true }) + ' · ' + U.shortDate(t.date) + ' ' + t.date.slice(0, 4); }
  function mergePanel(mine, theirs, name) {
    var la = mine.config && mine.config.lineage, lb = theirs.config && theirs.config.lineage;
    if (la && lb && la.id !== lb.id) { UI.toast('That file is a different budget (not a copy of this one), so it cannot be merged.'); return; }
    var fork = la && lb ? Lineage.common(la, lb) : null, since = fork ? fork.at : null, st = { settings: 'mine', busy: false };
    var d = Lineage.diff(mine, theirs, since);
    UI.openPanel(function (p) {
      function draw() {
        U.clear(p);
        p.appendChild(UI.panelHead('Compare and merge', name));
        p.appendChild(h('p', { style: { margin: 0 } }, 'This copy' + (la ? ' (revision ' + la.rev + ', ' + when(la.at) + ')' : '') + ' and ' + name + (lb ? ' (revision ' + lb.rev + ', ' + when(lb.at) + ')' : '') +
          (fork ? '. They parted after revision ' + fork.r + ' on ' + when(fork.at) + '.' : '. It is not known when they parted, so nothing is treated as deleted.')));
        var groups = [
          ['Added in ' + name, d.addedTheirs, 'added'], ['Added in this copy', d.addedMine, 'kept'],
          ['Changed in ' + name + ' (newer: that version is kept)', d.changedTheirs.map(function (c) { return c.theirs; }), 'updated'],
          ['Changed in this copy (newer: kept as it is)', d.changedMine.map(function (c) { return c.mine; }), 'kept'],
          ['Deleted in ' + name + ' after they parted', d.deletedTheirs, 'removed'], ['Deleted in this copy after they parted', d.deletedMine, 'stay deleted']];
        var box = h('div', { class: 'stack-sm', role: 'list', 'aria-label': 'What the merge does' });
        groups.forEach(function (g) {
          if (!g[1].length) return;
          var det = h('details', { class: 'more', role: 'listitem' }, h('summary', { class: 'strong' }, g[0] + ': ' + g[1].length + ' (' + g[2] + ')'));
          det.appendChild(h('ul', { class: 'small', style: { margin: '4px 0 0', paddingLeft: '18px' } }, g[1].slice(0, 30).map(function (t) { return h('li', null, line(t)); }), g[1].length > 30 ? h('li', null, '… and ' + (g[1].length - 30) + ' more') : null));
          box.appendChild(det);
        });
        if (!box.childNodes.length) box.appendChild(h('div', { class: 'ok strong' }, 'The transactions are the same in both copies.'));
        p.appendChild(box);
        p.appendChild(h('div', { class: 'small muted' }, d.same + ' line' + (d.same === 1 ? ' is' : 's are') + ' the same in both.'));
        p.appendChild(h('fieldset', { class: 'stack-sm', style: { border: 0, padding: 0, margin: 0 } }, h('legend', { class: 'strong' }, 'Categories, limits, rules and bills'),
          [['mine', 'Keep this copy\'s'], ['theirs', 'Use the ones in ' + name]].map(function (o) {
            return h('label', { class: 'check' }, h('input', { type: 'radio', name: 'mset', value: o[0], checked: st.settings === o[0], onchange: function () { st.settings = o[0]; } }), h('span', null, o[1]));
          })));
        p.appendChild(h('button', { type: 'button', class: 'btn primary', disabled: st.busy, onclick: go }, st.busy ? 'Merging…' : 'Merge'));
        p.appendChild(h('p', { class: 'small muted', style: { margin: 0 } }, DB.inMemory() ? 'The merge happens in this tab; save a file afterwards to keep it. Undo is offered right after.' : 'A safety copy is kept first, and Undo is offered right after.'));
      }
      function go() {
        st.busy = true; draw();
        var res = Lineage.merge(mine, theirs, since, { settings: st.settings });
        (DB.inMemory() ? Promise.resolve() : Safety.snapshot('merge')).then(function () { return DB.replaceAll(res.config, res.transactions); }).then(UI.reload).then(function () {
          return note(res.config.lineage, null);
        }).then(function () {
          UI.closePanel(); App.render();
          var dd = res.diff, n = dd.addedTheirs.length + dd.changedTheirs.length + dd.deletedTheirs.length;
          UI.toast('Merged: ' + dd.addedTheirs.length + ' added, ' + dd.changedTheirs.length + ' updated and ' + dd.deletedTheirs.length + ' removed from ' + name + (n ? '' : ' (nothing new)') + '.' + (DB.inMemory() ? ' Save file to keep it.' : ''), function () {
            DB.replaceAll(mine.config, mine.transactions).then(UI.reload).then(function () { App.render(); UI.toast('Merge undone.'); });
          });
        }).catch(function (e) { st.busy = false; draw(); UI.toast('Could not merge: ' + e.message); });
      }
      draw();
    }, { label: 'Compare and merge', wide: true });
  }

  return { stamp: stamp, saved: saved, note: note, check: check, warningText: warningText, mergeFlow: mergeFlow, mergePanel: mergePanel, known: known };
})();
