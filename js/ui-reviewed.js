/* "Reviewed" months on screen: a bar on Home, a list of what changed, and gentle notes wherever a reviewed month is touched.
   Everything here only informs. Nothing is ever blocked. */
var ReviewedUI = (function () {
  'use strict';
  var h = U.h, asking = null;   // month waiting for "mark it anyway?"
  function name(ym) { return U.MONTHS[+ym.slice(5) - 1] + (ym.slice(0, 4) !== U.today().slice(0, 4) ? ' ' + ym.slice(0, 4) : ''); }
  function save(msg, undo) { return UI.saveCfg().then(function () { App.render(); UI.toast(msg, undo); }); }
  function snapshot() { return JSON.parse(JSON.stringify(App.cfg.monthsReviewed || {})); }

  function mark(ym, again) {
    var before = snapshot(); asking = null;
    Reviewed.mark(App.cfg, App.txs, ym, U.today(), new Date().toISOString());
    save((again ? 'Reviewed again: ' : 'Marked as reviewed: ') + name(ym) + '.', function () { App.cfg.monthsReviewed = before; UI.saveCfg().then(function () { App.render(); UI.toast('Undone.'); }); });
  }
  function reopen(ym) {
    var before = snapshot(); Reviewed.unmark(App.cfg, ym);
    save(name(ym) + ' is open again.', function () { App.cfg.monthsReviewed = before; UI.saveCfg().then(function () { App.render(); UI.toast('Undone.'); }); });
  }
  function money(v) { return U.money(v, { cents: true }); }
  function diffText(d) { return d.label + ' ' + (d.key === 'count' ? d.was + ' → ' + d.now : money(d.was) + ' → ' + money(d.now)); }

  /* The bar under the month heading on Home. */
  function bar(ym, todayStr) {
    if (App.readOnly) return null;
    var mn = name(ym), st = Reviewed.status(App.cfg, App.txs, ym, todayStr), now = ym === todayStr.slice(0, 7);
    if (!st) {
      if (asking === ym) {
        var rd = Reviewed.readiness(App.txs, ym, HealthUI.summary());
        return h('div', { class: 'toast warn rv-ask', role: 'alert' },
          h('span', null, (rd.waiting ? rd.waiting + ' line' + (rd.waiting === 1 ? ' is' : 's are') + ' still waiting for review in ' + mn + '. ' : '') + (rd.issues ? rd.issues + ' Data health item' + (rd.issues === 1 ? '' : 's') + ' touch ' + mn + '. ' : '') + (now ? mn + ' is not over yet. ' : '') + 'You can still mark it; this is only a note, and nothing is blocked.'),
          h('div', { class: 'row' }, rd.waiting ? h('a', { class: 'btn', href: '#/review' }, 'Open Review') : null, rd.issues ? h('a', { class: 'btn', href: '#/health' }, 'Open Data health') : null,
            h('button', { type: 'button', class: 'btn primary', onclick: function () { mark(ym); } }, 'Mark reviewed anyway'), h('button', { type: 'button', class: 'btn', onclick: function () { asking = null; App.render(); } }, 'Not yet')));
      }
      return h('div', { class: 'row rv-bar' }, h('button', { type: 'button', class: 'btn', onclick: function () {
        var rd = Reviewed.readiness(App.txs, ym, HealthUI.summary());
        if (rd.clean && !now) mark(ym); else { asking = ym; App.render(); } } }, 'Mark ' + mn + ' as reviewed'),
        h('span', { class: 'small muted' }, 'A note that you checked this month. It never blocks changes.'));
    }
    var when = U.shortDate(st.at.slice(0, 10));
    if (!st.changed) return h('div', { class: 'row rv-bar' }, h('span', { class: 'ok strong' }, '✓ Reviewed ' + when), h('button', { type: 'button', class: 'btn link', onclick: function () { reopen(ym); } }, 'Reopen ' + mn));
    var bits = st.diffs.filter(function (d) { return d.key !== 'count'; }).map(function (d) { var x = d.now - d.was; return d.label.toLowerCase() + ' ' + (x > 0 ? '+' : '−') + money(Math.abs(x)); });
    if (st.edited.length) bits.push(st.edited.length + ' line' + (st.edited.length === 1 ? '' : 's') + ' edited');
    if (st.added.length) bits.push(st.added.length + ' added');
    return h('div', { class: 'row rv-bar rv-changed', role: 'status' }, h('span', { class: 'amber strong' }, '⚠ Changed since you reviewed ' + mn + ' on ' + when + (bits.length ? ': ' + bits.join(', ') : '')),
      h('button', { type: 'button', class: 'btn', onclick: function () { changes(ym); } }, 'See what changed'),
      h('button', { type: 'button', class: 'btn', onclick: function () { mark(ym, true); } }, 'Review again'), h('button', { type: 'button', class: 'btn link', onclick: function () { reopen(ym); } }, 'Reopen'));
  }

  /* Panel: what is different from when you marked the month. */
  function changes(ym) {
    var st = Reviewed.status(App.cfg, App.txs, ym, U.today()); if (!st) return;
    UI.openPanel(function (p) {
      p.appendChild(UI.panelHead('What changed in ' + name(ym), 'Reviewed ' + UI.histStamp(st.at)));
      p.appendChild(h('div', { class: 'stack-sm' }, h('h3', null, 'Numbers'), st.diffs.length ? h('ul', { class: 'hist-list' }, st.diffs.map(function (d) { return h('li', null, diffText(d)); })) : h('p', { class: 'muted', style: { margin: 0 } }, 'The totals are the same as when you reviewed. Individual lines were changed (below).')));
      function lines(title, list) {
        if (!list.length) return;
        p.appendChild(h('div', { class: 'stack-sm' }, h('h3', null, title + ' (' + list.length + ')'), h('ul', { class: 'hist-list' }, list.slice(0, 30).map(function (t) {
          var ev = (t.history || []).filter(function (e) { return e.at > st.at; });
          return h('li', null, h('div', { class: 'row between' }, h('span', null, h('strong', null, t.desc || 'No name'), h('span', { class: 'muted small' }, ' · ' + U.shortDate(t.date) + ' · ' + money(Math.abs(t.amount)))),
            h('button', { type: 'button', class: 'btn link', 'aria-label': 'Open ' + (t.desc || 'line') + ' ' + money(Math.abs(t.amount)), onclick: function () { UI.expensePanel(t, App.render); } }, 'Open')),
            ev.map(function (e) { return e.c.map(function (c) { return h('div', { class: 'small' }, UI.histSay(c)); }); }));
        }))));
      }
      lines('Edited since', st.edited); lines('Added since', st.added);
      if (st.diffs.some(function (d) { return d.key === 'count' && d.now < d.was; })) p.appendChild(h('p', { class: 'small muted', style: { margin: 0 } }, 'There are fewer lines than when you reviewed, so one or more were deleted.'));
      p.appendChild(h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onclick: function () { UI.closePanel(); mark(ym, true); } }, 'Review again (accept these changes)'), h('button', { type: 'button', class: 'btn', onclick: UI.closePanel }, 'Close')));
    }, { label: 'What changed in ' + name(ym) });
  }

  /* A one-line note for panels and previews. dates: the dates about to be touched. Returns an element or null. */
  function note(dates, verb) {
    if (App.readOnly) return null;
    var t = Reviewed.touched(App.cfg, dates), ms = Object.keys(t).sort();
    if (!ms.length) return null;
    return h('div', { class: 'notice rv-note', role: 'status' }, ms.map(name).join(' and ') + (ms.length === 1 ? ' is' : ' are') + ' marked as reviewed. ' + (verb || 'This change') + ' will show up as "changed since reviewed". Nothing is blocked.');
  }
  function noteText(dates) { var ms = Object.keys(Reviewed.touched(App.cfg, dates)).sort(); return ms.length ? ms.map(name).join(' and ') + (ms.length === 1 ? ' is' : ' are') + ' marked as reviewed; this will show as changed.' : ''; }
  return { bar: bar, changes: changes, note: note, noteText: noteText, mark: mark, name: name };
})();
