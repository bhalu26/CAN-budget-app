/* Keyboard shortcuts. One list drives both the keys and the "?" help sheet.
   Single keys never fire while you are typing in a field, while a panel is open, or with Ctrl/Alt/⌘ held
   (so browser and system shortcuts keep working). Ctrl+K / ⌘+K opens the command palette from anywhere. */
var Keys = (function () {
  'use strict';
  var h = U.h, pending = null, pendingAt = 0;
  var GO = { h: '#/home', t: '#/transactions', r: '#/review', i: '#/insights', m: '#/import', u: '#/rules', s: '#/settings', a: '#/accounts', d: '#/health', b: '#/bills', k: '#/backup' };
  var MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  var MOD = MAC ? '⌘' : 'Ctrl';

  /* [keys, what it does, where]. Keys separated by " " are pressed one after the other; "/" means either. */
  function list() {
    var ro = App.readOnly;
    return [
      [MOD + '+K', 'Search screens, categories and months, or quick-add an expense', 'Anywhere'],
      ro ? null : ['N', 'Add an expense', 'Anywhere'],
      ['/', 'Search transactions', 'Anywhere'],
      ['?', 'Show these shortcuts', 'Anywhere'],
      ['G H', 'Go to Home', 'Go to'], ['G T', 'Go to Transactions', 'Go to'], ro ? null : ['G R', 'Go to Review', 'Go to'], ['G I', 'Go to Insights', 'Go to'],
      ro ? null : ['G M', 'Go to Import', 'Go to'], ro ? null : ['G D', 'Go to Data health (duplicates, balances, errors)', 'Go to'], ro ? null : ['G S', 'Go to Settings', 'Go to'], ro ? null : ['G B', 'Settings: Bills & subscriptions', 'Go to'], ro ? null : ['G U', 'Settings: Rules', 'Go to'], ro ? null : ['G A', 'Settings: Accounts', 'Go to'], ro ? null : ['G K', 'Settings: Backup & sharing', 'Go to'],
      ['[ / ]', 'Previous / next month', 'Home and Transactions'],
      ['J / K', 'Next / previous transaction', 'Transactions'],
      ['Enter', 'Open the transaction', 'Transactions'],
      ro ? null : ['E', 'Change its category', 'Transactions'],
      ro ? null : ['X', 'Select it (for changing several at once)', 'Transactions'],
      ro ? null : ['Enter / Y', 'Looks right', 'Review'],
      ro ? null : ['1 – 9', 'Choose that category', 'Review'],
      ro ? null : ['A', 'Always tag this merchant like this (toggle)', 'Review'],
      ro ? null : ['S / →', 'Skip for now', 'Review'],
      ro ? null : ['Z / ←', 'Undo the last decision (its card comes back)', 'Review'],
      ['Esc', 'Close a panel or the palette', 'Anywhere']
    ].filter(Boolean);
  }

  function typing(el) {
    if (!el || !el.closest) return false;
    if (el.closest('textarea, select, [contenteditable="true"]')) return true;
    var inp = el.closest('input');
    return !!inp && !/^(checkbox|radio|button|submit|reset|range|color|file)$/i.test(inp.type || '');
  }
  function panelOpen() { return !!document.getElementById('layer').firstChild; }

  function help() {
    UI.openPanel(function (p) {
      p.appendChild(UI.panelHead('Keyboard shortcuts'));
      var groups = {};
      list().forEach(function (k) { (groups[k[2]] = groups[k[2]] || []).push(k); });
      Object.keys(groups).forEach(function (g) {
        var box = h('div', { class: 'card' });
        groups[g].forEach(function (k) {
          box.appendChild(h('div', { class: 'list-row keys-row' }, h('span', null, k[1]),
            h('span', { class: 'keys' }, k[0].split(' ').map(function (part, i) {
              return [i ? h('span', { class: 'small muted' }, ' then ') : null, part.split('/').map(function (alt, j) {
                return [j ? h('span', { class: 'small muted' }, ' or ') : null, h('kbd', null, alt.trim())];
              })];
            }))));
        });
        p.appendChild(h('section', { class: 'stack-sm' }, h('h3', null, g), box));
      });
      p.appendChild(h('p', { class: 'small muted', style: { margin: 0 } }, 'Shortcuts wait while you type in a field.'));
    }, { label: 'Keyboard shortcuts' });
  }

  function focusSearch() {
    var q = document.getElementById(App.route === 'rules' ? 'rq' : 'q');
    if (q) { q.focus(); q.select(); return; }
    location.hash = '#/transactions';
    setTimeout(function () { var f = document.getElementById('q'); if (f) f.focus(); }, 50);
  }

  /* J/K/E/X/Enter on the Transactions list: move between rows by focusing each row's name. */
  function rowKeys(key) {
    var names = Array.prototype.slice.call(document.querySelectorAll('.tx .name'));
    if (!names.length) return false;
    var cur = document.activeElement && document.activeElement.closest ? document.activeElement.closest('.tx') : null;
    var i = cur ? names.indexOf(cur.querySelector('.name')) : -1;
    if (key === 'j' || key === 'k') {
      var n = key === 'j' ? Math.min(names.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
      names[n].focus(); names[n].closest('.tx').scrollIntoView({ block: 'nearest' });
      return true;
    }
    if (!cur) return false;
    if (key === 'x' && !App.readOnly) { var c = cur.querySelector('.pick'); if (c) c.click(); return true; }
    if (key === 'e' && !App.readOnly) { var t = cur.querySelector('button.tag'); if (t) t.click(); return true; }
    return false;
  }

  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || !App.cfg) return;
    var k = e.key;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (k === 'k' || k === 'K')) { e.preventDefault(); Palette.toggle(); return; }
    if (Palette.isOpen() || panelOpen() || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    var key = k.length === 1 ? k.toLowerCase() : k;
    if (pending === 'g' && Date.now() - pendingAt < 1500) {
      pending = null;
      var to = GO[key];
      if (to && !(App.readOnly && /review|import|rules|settings|bills|backup|accounts/.test(to))) { e.preventDefault(); location.hash = to; }
      return;
    }
    pending = null;
    if (App.route === 'review' && window.ReviewStack && ReviewStack.key(e, key)) { e.preventDefault(); return; }
    if (key === 'g') { pending = 'g'; pendingAt = Date.now(); return; }
    if (key === 'n' && !App.readOnly) { e.preventDefault(); UI.expensePanel(null, App.render); return; }
    if (k === '/') { e.preventDefault(); focusSearch(); return; }
    if (k === '?') { e.preventDefault(); help(); return; }
    if ((k === '[' || k === ']') && (App.route === 'home' || App.route === 'transactions')) {
      e.preventDefault(); App.month = U.shiftMonth(App.month || U.ym(U.today()), k === '[' ? -1 : 1); App.render(); return;
    }
    if (App.route === 'transactions' && rowKeys(key)) { e.preventDefault(); return; }
  });

  return { help: help, list: list, MOD: MOD };
})();
