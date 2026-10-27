/* Settings: categories and limits, trips, big expenses, Excel history, backups. */
var Settings = (function () {
  'use strict';
  var h = U.h, pendingFile = null, pendingRestore = null, excel = null, confirmErase = false, confirmRemoveExcel = false, askExtras = false, lastBuf = null, lastName = '';
  function analyseExcel() {
    return ExcelImport.analyse(lastBuf, App.cfg, { askExtras: askExtras }).then(function (r) { excel = r; excel.fileName = lastName; App.render(); })
      .catch(function (err) { excel = { error: err.message }; App.render(); });
  }

  /* Settings has a sub-menu: General, Bills & subscriptions, Rules, Accounts, Backup & sharing. Each is its own address, so links and shortcuts still land on the right one. */
  var SUB = [['settings', 'General', '#/settings'], ['bills', 'Bills & subscriptions', '#/bills'], ['rules', 'Rules', '#/rules'], ['accounts', 'Accounts', '#/accounts'], ['backup', 'Backup & sharing', '#/backup']];
  function subnav(cur) {
    return h('nav', { class: 'subnav', 'aria-label': 'Settings sections' }, h('span', { class: 'subnav-title small muted' }, 'Settings'),
      SUB.map(function (x) { return h('a', { class: 'subnav-link', href: x[2], 'aria-current': x[0] === cur ? 'page' : null }, x[1]); }));
  }

  function render(main) {
    base = snap();
    main.appendChild(h('h1', null, 'Settings'));
    main.appendChild(subnav('settings'));
    main.appendChild(appearance());
    main.appendChild(categories());
    main.appendChild(trips());
    main.appendChild(bigExpenses());
    main.appendChild(history());
    main.appendChild(health());
  }
  function renderBackup(main) {
    base = snap();
    main.appendChild(h('h1', null, WorkFile.on() ? 'Budget file' : 'Backup & sharing'));
    main.appendChild(subnav('backup'));
    if (WorkFile.on()) { WorkFile.settings(main); return; }   // working from a file: no folders, no browser copy
    main.appendChild(backups());
    main.appendChild(Share.settingsSection());
  }
  /* The rule files and "rules you made", shown under the rules list on the Rules page. */
  function rulesSection() { base = snap(); return rules(); }

  /* Light / dark: kept in this browser only (each computer can choose its own). */
  function appearance() {
    var s = section('Appearance');
    var cur = Theme.get();
    var group = h('div', { class: 'row', role: 'radiogroup', 'aria-label': 'Colour theme' });
    [['system', 'Match my computer'], ['light', 'Light'], ['dark', 'Dark']].forEach(function (o) {
      group.appendChild(h('label', { class: 'chip radio-chip' + (cur === o[0] ? ' on' : '') },
        h('input', { type: 'radio', name: 'theme', value: o[0], checked: cur === o[0], onchange: function () { Theme.set(o[0]); } }), h('span', null, o[1])));
    });
    s.appendChild(group);
    s.appendChild(h('div', { class: 'small muted' }, 'Now showing ' + Theme.resolved() + '. Saved in this browser only.'));
    return s;
  }

  function section(title, intro) {
    var s = h('section', { class: 'card pad stack', 'aria-label': title }, h('h2', null, title));
    if (intro) s.appendChild(h('p', { class: 'muted', style: { margin: 0 } }, intro));
    return s;
  }
  /* Every Settings change can be undone from its confirmation bar. "before" is the Settings-owned part of the config as it was
     just before this change (refreshed after every save), so Undo puts back exactly one change and nothing outside Settings. */
  var OWNED = ['groups', 'categories', 'trips', 'bigExpenses', 'rules', 'accounts', 'cutOver', 'ruleSets', 'ruleOff'];
  function snap() { var o = {}; OWNED.forEach(function (k) { if (App.cfg[k] !== undefined) o[k] = JSON.parse(JSON.stringify(App.cfg[k])); }); return o; }
  var base = null;
  function persist(msg) {
    var before = base || snap();
    base = snap();
    return UI.saveCfg().then(function () {
      UI.nav();
      UI.toast(msg || 'Saved.', function () {
        OWNED.forEach(function (k) { if (before[k] === undefined) delete App.cfg[k]; else App.cfg[k] = before[k]; });
        base = snap();
        UI.saveCfg().then(function () { App.render(); UI.toast('Undone.'); });
      });
    });
  }


  /* Tagging rules: the two CSV rule files, plus rules made with "Always tag ... like this". */
  function rules() {
    var s = section('Rule files', 'Used when importing bank files. Load rules-general.csv and rules-personal.csv; load a newer file any time to replace it.'); s.id = 'rule-files';
    var sets = App.cfg.ruleSets || {};
    [['general', 'rules-general.csv'], ['personal', 'rules-personal.csv (private)']].forEach(function (k) {
      var cur = sets[k[0]];
      var inp = h('input', { id: 'rs-' + k[0], type: 'file', accept: '.csv', class: 'input', style: { paddingTop: '8px' }, onchange: function (e) {
        var f = e.target.files[0]; if (!f) return;
        U.readFile(f).then(function (text) {
          var rows = Engine.parseCSV(text.replace(/^﻿/, '')).rows;
          var hdr = (rows[0] || []).map(function (x) { return x.trim().toLowerCase(); });
          if (hdr.indexOf('pattern') < 0 || hdr.indexOf('kind') < 0) throw new Error('This file has no rule columns (pattern, kind, value...).');
          var n = Engine.loadRules(rows).length;
          App.cfg.ruleSets = Object.assign({}, App.cfg.ruleSets); App.cfg.ruleSets[k[0]] = { file: f.name, rows: rows, count: n, loadedAt: new Date().toISOString() };
          return persist('Loaded ' + n + ' rules from ' + f.name + '.').then(App.render);
        }).catch(function (err) { UI.toast('Could not load rules: ' + err.message); });
      } });
      s.appendChild(h('div', { class: 'row', style: { alignItems: 'flex-end' } },
        h('div', { class: 'field', style: { flex: '1 1 300px' } }, h('label', { for: 'rs-' + k[0] }, k[1]), inp),
        h('span', { class: cur ? 'ok' : 'muted' }, cur ? cur.count + ' rules loaded ' + cur.loadedAt.slice(0, 10) : 'Not loaded'),
        cur ? h('button', { type: 'button', class: 'btn', onclick: function () { downloadSet(k[0]); } }, 'Download') : null));
    });
    var mine = App.cfg.rules || [];
    s.appendChild(h('div', { class: 'row between' }, h('h3', null, 'Rules you made (' + mine.length + ')'),
      mine.length ? h('button', { type: 'button', class: 'btn', onclick: downloadMine }, 'Download as CSV') : null));
    if (!mine.length) s.appendChild(h('div', { class: 'small muted' }, 'Tick "Always tag … like this" when changing a category in Transactions to add one.'));
    mine.forEach(function (r) {
      s.appendChild(h('div', { class: 'list-row' }, h('span', null, r.merchant + ' → ' + UI.catName(r.categoryId)),
        h('button', { type: 'button', class: 'btn link', onclick: function () { App.cfg.rules = mine.filter(function (x) { return x !== r; }); persist('Rule removed.').then(App.render); } }, 'Remove rule')));
    });
    return s;
  }

  /* A loaded rule file, row for row as it was read (it is kept in the app exactly as loaded). */
  function downloadSet(which) {
    var set = (App.cfg.ruleSets || {})[which]; if (!set) return;
    var name = /\.csv$/i.test(set.file || '') ? set.file : 'rules-' + which + '.csv';
    U.download(name, U.csv(set.rows), 'text/csv');
    UI.toast('Downloaded ' + name + ' (' + set.count + ' rules)' + (which === 'personal' ? '. It is private: keep it out of general AI chats.' : '.'));
  }
  /* "Always tag" rules in the same columns as the rule files, so the file can be loaded back as a personal rules file.
     Priority 500 keeps them ahead of every file rule (those go up to 300), as they are in the app. */
  function downloadMine() {
    var mine = App.cfg.rules || [], types = { _income: 'income', _transfer: 'transfer', _exclude: 'exclude' };
    var rows = [['rule_id', 'kind', 'pattern', 'match_type', 'value', 'priority', 'apply', 'notes']];
    mine.forEach(function (r, i) {
      var t = types[r.categoryId];
      rows.push(['A' + String(i + 1).padStart(3, '0'), t ? 'type' : 'category', r.merchant, 'contains', t || UI.catName(r.categoryId), 500, 'auto', 'Made in the app with "Always tag"' + (r.createdAt ? ' on ' + String(r.createdAt).slice(0, 10) : '')]);
    });
    U.download('rules-made-in-app-' + U.today() + '.csv', U.csv(rows), 'text/csv');
    UI.toast('Downloaded ' + mine.length + ' rule' + (mine.length === 1 ? '' : 's') + '. Private: they name your merchants.');
  }

  /* Categories and limits: edits save when you leave the field. */
  var ordering = null;   // group id whose categories are being reordered
  function categories() {
    var s = section('Categories and limits', 'Changes save as soon as you leave a field. Fixed bills show as Paid / Not yet on Home. The order here is the order everywhere.');
    M.groupsWithCats(App.cfg, true).forEach(function (gc) {
      var saving = gc.group.kind === 'saving';
      var head = h('div', { class: 'row between', style: { marginTop: '8px' } }, h('h3', null, gc.group.name + (saving ? ' (saving, never counted as spending)' : '')),
        gc.cats.length > 1 ? h('button', { type: 'button', class: 'btn' + (ordering === gc.group.id ? ' primary' : ''), 'aria-pressed': ordering === gc.group.id ? 'true' : 'false',
          onclick: function () { ordering = ordering === gc.group.id ? null : gc.group.id; App.render(); } }, ordering === gc.group.id ? 'Done' : 'Change order') : null);
      if (ordering === gc.group.id) {
        s.appendChild(head);
        s.appendChild(Reorder.list({ label: 'Order of ' + gc.group.name + ' categories', items: gc.cats.map(function (c) { return { id: c.id, label: c.name + (c.archived ? ' (removed)' : '') }; }),
          onMove: function (ids, moved, pos) {
            ids.forEach(function (id, i) { var c = App.cfg.categories.filter(function (x) { return x.id === id; })[0]; if (c) c.order = i; });
            persist(moved.label + ' moved to position ' + (pos + 1) + ' of ' + ids.length + '.').then(function () { App.render(); UI.announce(moved.label + ' moved to position ' + (pos + 1) + ' of ' + ids.length + '.'); });
          } }));
        return;
      }
      var tb = h('tbody');
      gc.cats.forEach(function (c) {
        var nameIn = h('input', { class: 'input', value: c.name, 'aria-label': 'Name of ' + c.name, onchange: function (e) {
          var v = e.target.value.trim(); if (!v) { e.target.value = c.name; return; } c.name = v; persist('Renamed to ' + v + '.'); } });
        var limIn = h('input', { class: 'input num', inputmode: 'decimal', value: String(c.period === 'year' ? (c.yearlyLimit || c.limit * 12) : (saving ? c.target : c.limit)),
          'aria-label': (saving ? 'Monthly target for ' : c.period === 'year' ? 'Yearly budget for ' : 'Monthly limit for ') + c.name,
          onchange: function (e) {
            var v = U.calc(e.target.value); if (v === null || v < 0) { e.target.value = String(saving ? c.target : c.limit); UI.toast('Enter a number, like 250.'); return; }
            if (saving) c.target = v; else if (c.period === 'year') { c.yearlyLimit = v; c.limit = U.round2(v / 12); } else c.limit = v;
            persist(c.name + ': ' + U.money(v, { whole: true }) + (saving ? ' a month target' : c.period === 'year' ? ' a year' : ' a month') + '.');
          } });
        tb.appendChild(h('tr', null,
          h('td', null, nameIn, c.archived ? h('span', { class: 'small muted' }, ' removed, kept for history') : null),
          h('td', { class: 'r' }, limIn, h('div', { class: 'small muted' }, saving ? 'target / month' : c.period === 'year' ? 'per year' : 'per month')),
          h('td', null, !saving && c.period !== 'year' ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: c.fixed, onchange: function (e) { c.fixed = e.target.checked; persist(c.name + (c.fixed ? ' is a fixed bill.' : ' is everyday spending.')); } }), 'Fixed bill') : null),
          h('td', { class: 'r' }, h('button', { type: 'button', class: 'btn link', onclick: function () { c.archived = !c.archived; persist(c.name + (c.archived ? ' removed. Its history stays.' : ' is back.')).then(App.render); } }, c.archived ? 'Bring back' : 'Remove'))));
      });
      var newName = h('input', { class: 'input', placeholder: 'New category in ' + gc.group.name, 'aria-label': 'New category in ' + gc.group.name });
      tb.appendChild(h('tr', null, h('td', null, newName), h('td'), h('td'), h('td', { class: 'r' }, h('button', { type: 'button', class: 'btn', onclick: function () {
        var v = newName.value.trim(); if (!v) return;
        var id = U.slug(v); while (App.cfg.categories.some(function (x) { return x.id === id; })) id += '-2';
        App.cfg.categories.push({ id: id, groupId: gc.group.id, name: v, kind: gc.group.kind, limit: 0, target: 0, fixed: false, period: 'month', yearlyLimit: 0, excelName: '', note: '', archived: false, order: gc.cats.length });
        persist('Added ' + v + '. Set its limit.').then(App.render);
      } }, 'Add'))));
      s.appendChild(head);
      s.appendChild(h('div', { class: 'scroll-x' }, h('table', { class: 't', style: { minWidth: '560px' } }, tb)));
    });
    return s;
  }

  function trips() {
    var s = section('Trips', 'Spending on a trip goes to Travel with the trip\'s name. Flights, hotels and deposits paid before the trip can go on it too: open the line (More options > Trip), or select lines in Transactions and use Set trip.');
    var list = (App.cfg.trips || []).slice().sort(function (a, b) { return a.start < b.start ? 1 : -1; });
    list.forEach(function (t) {
      var c = Trips.cost(App.cfg, App.txs, t);
      s.appendChild(h('div', { class: 'list-row' }, h('span', null, h('strong', null, t.name), h('span', { class: 'muted' }, ' · ' + U.shortDate(t.start) + ' – ' + U.shortDate(t.end) + ' ' + t.end.slice(0, 4) + ' · '),
          h('a', { href: '#/transactions?trip=' + encodeURIComponent(t.id) + '&scope=all', class: 'quiet-link', 'aria-label': t.name + ': ' + c.count + ' transactions' }, U.money(c.total, { whole: true }) + ' (' + c.count + ' line' + (c.count === 1 ? '' : 's') + (c.before ? ', ' + U.money(c.before, { whole: true }) + ' booked before' : '') + ')')),
        h('button', { type: 'button', class: 'btn link', onclick: function () {
          var used = App.txs.filter(function (x) { return x.tripId === t.id; }).length;
          App.cfg.trips = App.cfg.trips.filter(function (x) { return x.id !== t.id; });
          persist('Removed ' + t.name + (used ? '. Its ' + used + ' purchases stay in Travel.' : '.')).then(App.render);
        } }, 'Remove')));
    });
    var name = h('input', { id: 'tn', class: 'input', placeholder: 'e.g. Japan' }), start = h('input', { id: 'ts', type: 'date', class: 'input' }), end = h('input', { id: 'te', type: 'date', class: 'input' });
    s.appendChild(h('div', { class: 'row', style: { alignItems: 'flex-end' } },
      h('div', { class: 'field', style: { flex: '1 1 180px' } }, h('label', { for: 'tn' }, 'Trip name'), name),
      h('div', { class: 'field' }, h('label', { for: 'ts' }, 'First day'), start), h('div', { class: 'field' }, h('label', { for: 'te' }, 'Last day'), end),
      h('button', { type: 'button', class: 'btn', onclick: function () {
        if (!name.value.trim() || !U.validDate(start.value) || !U.validDate(end.value)) { UI.toast('Give the trip a name, a first day and a last day.'); return; }
        if (end.value < start.value) { UI.toast('The last day is before the first day.'); return; }
        App.cfg.trips = (App.cfg.trips || []).concat([{ id: U.uid(), name: name.value.trim(), start: start.value, end: end.value }]);
        persist('Added trip ' + name.value.trim() + '.').then(App.render);
      } }, 'Add trip')));
    return s;
  }

  /* Big expenses are sinking funds: money is set aside each month (on paper; nothing moves) until the due month,
     and payments marked "Pay from" the fund stay out of monthly limits. */
  var fundEdit = null, fundDel = null;   // id being edited ('new' for a new one), id awaiting delete confirmation
  function bigExpenses() {
    var s = section('Big expenses', 'Yearly or one-off costs, saved for a little each month. A payment made from one of these does not count against monthly limits.');
    var ym = U.today().slice(0, 7);
    (App.cfg.bigExpenses || []).forEach(function (b) {
      if (fundEdit === b.id) { s.appendChild(fundForm(b)); return; }
      var st = Funds.status(b, App.txs, ym), n = App.txs.filter(function (t) { return t.fundId === b.id; }).length;
      s.appendChild(h('div', { class: 'list-row' },
        h('span', null, h('strong', null, b.name), h('span', { class: 'muted' }, ' · ' + U.money(b.amount, { whole: true }) + (b.repeats === 'yearly' ? ' every year' : ' once') + ' · due ' + U.monthLabel(st.cycle.due) + (b.dueGuessed ? ' (a guess: check it)' : ''))),
        h('span', { class: 'row' },
          h('button', { type: 'button', class: 'btn link', 'aria-label': 'Edit ' + b.name, onclick: function () { fundEdit = b.id; fundDel = null; App.render(); } }, 'Edit'),
          h('button', { type: 'button', class: 'btn link', 'aria-label': 'Remove ' + b.name, onclick: function () { fundDel = b.id; App.render(); } }, 'Remove'))));
      if (fundDel === b.id) s.appendChild(h('div', { class: 'toast warn', role: 'alert' },
        h('span', null, 'Remove "' + b.name + '"?' + (n ? ' Its ' + n + ' payment' + (n === 1 ? '' : 's') + ' will count as ordinary spending again.' : '')),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn danger', onclick: function () { fundDel = null; App.cfg.bigExpenses = App.cfg.bigExpenses.filter(function (x) { return x.id !== b.id; }); persist('Removed ' + b.name + '.').then(App.render); } }, 'Remove'),
          h('button', { type: 'button', class: 'btn', onclick: function () { fundDel = null; App.render(); } }, 'Keep it'))));
    });
    if (fundEdit === 'new') s.appendChild(fundForm(null));
    else s.appendChild(h('button', { type: 'button', class: 'btn', style: { alignSelf: 'flex-start' }, onclick: function () { fundEdit = 'new'; fundDel = null; App.render(); } }, 'Add a big expense'));
    return s;
  }
  function fundForm(b) {
    var ym = U.today().slice(0, 7), isNew = !b;
    var f = b ? JSON.parse(JSON.stringify(b)) : { name: '', amount: '', repeats: 'yearly', due: Funds.addYm(ym, 11), start: ym, categoryId: '', match: '', note: '' };
    var err = h('div', { class: 'small red', role: 'alert' });
    var name = h('input', { id: 'bn', class: 'input', value: f.name }), amt = h('input', { id: 'ba', class: 'input', inputmode: 'decimal', value: String(f.amount) });
    var rep = h('select', { id: 'br', class: 'input' }, h('option', { value: 'yearly' }, 'Every year'), h('option', { value: 'once' }, 'Once')); rep.value = f.repeats;
    var due = h('input', { id: 'bd', type: 'month', class: 'input', value: f.due }), start = h('input', { id: 'bs', type: 'month', class: 'input', value: f.start });
    var cat = UI.categorySelect('bc', f.categoryId || '', function () {}, { placeholder: 'Choose…' });
    var match = h('input', { id: 'bm', class: 'input', value: f.match || '', 'aria-describedby': 'bm-hint' });
    function save() {
      var v = U.calc(amt.value), re = /^\d{4}-\d{2}$/;
      if (!name.value.trim()) { err.textContent = 'Give it a name.'; name.focus(); return; }
      if (v === null || v <= 0) { err.textContent = 'Enter the amount, like 250.'; amt.focus(); return; }
      if (!re.test(due.value)) { err.textContent = 'Pick the month it is due.'; due.focus(); return; }
      if (!re.test(start.value)) { err.textContent = 'Pick the month to start saving.'; start.focus(); return; }
      if (start.value > due.value) { err.textContent = 'Saving has to start on or before the due month.'; start.focus(); return; }
      var out = Object.assign(f, { name: name.value.trim(), amount: v, repeats: rep.value, due: due.value, start: start.value, categoryId: cat.value || null, match: match.value.trim(), year: rep.value === 'once' ? +due.value.slice(0, 4) : null });
      delete out.dueGuessed;
      if (isNew) { out.id = U.uid(); App.cfg.bigExpenses = (App.cfg.bigExpenses || []).concat([out]); }
      else App.cfg.bigExpenses = App.cfg.bigExpenses.map(function (x) { return x.id === out.id ? out : x; });
      fundEdit = null;
      persist((isNew ? 'Added ' : 'Saved ') + out.name + '.').then(App.render);
    }
    var fl = function (id, label, el, basis) { return h('div', { class: 'field', style: { flex: basis } }, h('label', { for: id }, label), el); };
    return h('fieldset', { class: 'card pad stack-sm', style: { margin: 0 } }, h('legend', { class: 'strong' }, isNew ? 'New big expense' : 'Edit ' + b.name),
      h('div', { class: 'row', style: { alignItems: 'flex-end' } },
        fl('bn', 'Name', name, '1 1 180px'), fl('ba', 'Amount', amt, '0 1 120px'), fl('br', 'Repeats', rep, '0 1 140px')),
      h('div', { class: 'row', style: { alignItems: 'flex-end' } },
        fl('bd', 'Due month', due, '0 1 170px'), fl('bs', 'Start saving in', start, '0 1 170px'), fl('bc', 'Category it belongs to', cat, '1 1 200px')),
      h('div', { class: 'field' }, h('label', { for: 'bm' }, 'Bank text to look for (optional)'), match,
        h('div', { id: 'bm-hint', class: 'small muted' }, 'When an imported charge contains this text near the due month, you are asked whether to pay it from this fund. Example: MEMBERSHIP FEE')),
      err,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onclick: save }, isNew ? 'Add big expense' : 'Save changes'),
        h('button', { type: 'button', class: 'btn', onclick: function () { fundEdit = null; App.render(); } }, 'Cancel')));
  }

  /* Excel history: analyse first, show every row's fate, then import. */
  function history() {
    var s = section('Excel history', 'Bring in months before your cut-over from the 2026 budget template. The file is read on this computer only.');
    var co = h('input', { id: 'co', type: 'date', class: 'input', value: App.cfg.cutOver || '', onchange: function (e) { App.cfg.cutOver = e.target.value; excel = null; persist('Cut-over set to ' + e.target.value + '.').then(App.render); } });
    s.appendChild(h('div', { class: 'field', style: { maxWidth: '240px' } }, h('label', { for: 'co' }, 'Cut-over date (bank files from this day on)'), co));
    var already = App.txs.filter(function (t) { return t.source === 'excel'; });
    if (already.length) {
      s.appendChild(h('div', { class: 'notice' }, 'Excel history is in: ' + already.length + ' rows. Importing again would count them twice, so remove them first if you need to re-import.'));
      if (!confirmRemoveExcel) s.appendChild(h('button', { type: 'button', class: 'btn danger', style: { alignSelf: 'flex-start' }, onclick: function () { confirmRemoveExcel = true; App.render(); } }, 'Remove Excel history'));
      else s.appendChild(h('div', { class: 'toast warn', role: 'alert' }, h('span', null, 'Remove all ' + already.length + ' rows that came from Excel? Things you added by hand stay.'),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn danger', onclick: function () { Safety.snapshot('remove-excel').then(function () { return DB.deleteTx(already.map(function (t) { return t.id; })); }).then(UI.reload).then(function () { confirmRemoveExcel = false; App.render(); UI.toast('Excel history removed.'); }); } }, 'Remove'),
          h('button', { type: 'button', class: 'btn', onclick: function () { confirmRemoveExcel = false; App.render(); } }, 'Keep it'))));
      return s;
    }
    var file = h('input', { id: 'xf', type: 'file', accept: '.xlsx', class: 'input', style: { paddingTop: '8px' }, onchange: function (e) {
      var f = e.target.files[0]; if (!f) return;
      if (!App.cfg.cutOver) { UI.toast('Set the cut-over date first.'); return; }
      U.readFile(f, true).then(function (buf) { lastBuf = buf; lastName = f.name; return analyseExcel(); });
    } });
    s.appendChild(h('div', { class: 'field', style: { maxWidth: '420px' } }, h('label', { for: 'xf' }, 'Choose your 2026_Budget_Template.xlsx'), file));
    s.appendChild(h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: askExtras, onchange: function (e) { askExtras = e.target.checked; if (lastBuf) analyseExcel(); } }),
      h('span', null, 'Let me choose a category for each old Extra 1 and Extra 2 row (instead of putting them all in Entertainment and Fees & Admin)')));
    if (excel && excel.error) s.appendChild(h('div', { class: 'toast warn', role: 'alert' }, excel.error));
    if (excel && !excel.error) {
      var r = excel;
      s.appendChild(h('div', { role: 'status', style: { fontSize: '16px' } }, h('strong', null, r.rowsSeen + ' rows: '), r.ready.length + ' ready, ' + r.tag.length + ' need a category, ' + r.notImported.length + ' not imported (reasons below), 0 skipped.'));
      if (!r.reconciled) s.appendChild(h('div', { class: 'toast warn', role: 'alert' }, 'The row counts do not add up, so nothing will be imported. Please send me this message.'));
      var months = {};
      r.ready.concat(r.tag).forEach(function (x) { var m = x.date.slice(0, 7); months[m] = (months[m] || 0) + 1; });
      s.appendChild(h('div', { class: 'small muted' }, Object.keys(months).sort().map(function (m) { return U.MON[+m.slice(5) - 1] + ' ' + months[m]; }).join(' · ') + ' · total ' + U.money(r.sum, { cents: true })));
      if (r.tag.length) {
        s.appendChild(h('h3', null, 'Will import, then wait for a category (' + r.tag.length + ')'));
        s.appendChild(rowsTable(r.tag));
      }
      if (r.notImported.length) {
        s.appendChild(h('h3', null, 'Not imported (' + r.notImported.length + ')'));
        s.appendChild(rowsTable(r.notImported));
      }
      var flagged = r.ready.filter(function (x) { return x.flag; });
      if (flagged.length) { s.appendChild(h('h3', null, 'Imported with a note (' + flagged.length + ')')); s.appendChild(rowsTable(flagged, true)); }
      s.appendChild(h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn primary', disabled: !r.reconciled, onclick: function () {
          var list = ExcelImport.toTransactions(r, App.cfg);
          DB.putTx(list).then(UI.reload).then(function () { excel = null; App.render(); UI.toast('Imported ' + list.length + ' rows from Excel.'); });
        } }, 'Import ' + (r.ready.length + r.tag.length) + ' rows'),
        h('button', { type: 'button', class: 'btn', onclick: function () { excel = null; App.render(); } }, 'Cancel')));
    }
    return s;
  }
  function rowsTable(rows, flag) {
    return h('div', { class: 'scroll-x' }, h('table', { class: 't', style: { minWidth: '620px' } },
      h('thead', null, h('tr', null, h('th', null, 'Row'), h('th', null, 'Date'), h('th', null, 'Category'), h('th', null, 'Description'), h('th', { class: 'r' }, 'Amount'), h('th', null, flag ? 'Note' : 'Reason'))),
      h('tbody', null, rows.map(function (x) {
        return h('tr', null, h('td', null, String(x.line)), h('td', null, x.date || '—'), h('td', null, x.category || '—'), h('td', null, x.desc || ''), h('td', { class: 'r' }, x.amount === null ? '—' : U.money(x.amount, { cents: true })), h('td', { class: 'small muted' }, flag ? x.flag : x.reason));
      }))));
  }

  /* Check my data: totals by month and source, possible double counting, and loose ends. */
  var healthOpen = false;
  function health() {
    var s = section('Check my data', 'Use this after importing to make sure nothing is missing or counted twice.');
    if (!healthOpen) { s.appendChild(h('button', { type: 'button', class: 'btn primary', style: { alignSelf: 'flex-start' }, onclick: function () { healthOpen = true; App.render(); } }, 'Run checks')); return s; }
    var txs = App.txs, cut = App.cfg.cutOver || '', year = U.today().slice(0, 4), srcs = Tx.sources();
    // 1. Spending by month and source
    var used = srcs.filter(function (x) { return txs.some(function (t) { return Tx.srcOf(t) === x.id; }); });
    var grid = {}, cnt = {};
    txs.forEach(function (t) { if (t.date.slice(0, 4) !== year || t.type !== 'expense') return; var k = t.date.slice(5, 7) + '|' + Tx.srcOf(t); grid[k] = (grid[k] || 0) + t.amount; cnt[k] = (cnt[k] || 0) + 1; });
    var months = []; for (var m = 1; m <= +U.today().slice(5, 7); m++) months.push(U.pad(m));
    s.appendChild(h('h3', null, 'Spending by month and source, ' + year));
    s.appendChild(h('div', { class: 'scroll-x' }, h('table', { class: 't health', style: { minWidth: (180 + used.length * 130) + 'px' } },
      h('thead', null, h('tr', null, h('th', null, 'Month'), used.map(function (x) { return h('th', { class: 'r' }, x.name); }), h('th', { class: 'r' }, 'Total'))),
      h('tbody', null, months.map(function (mm) {
        var tot = 0;
        var cells = used.map(function (x) { var v = grid[mm + '|' + x.id] || 0, n = cnt[mm + '|' + x.id] || 0; tot += v; return h('td', { class: 'r' + (n ? '' : ' muted') }, n ? U.money(v, { whole: true }) + ' (' + n + ')' : '—'); });
        var mixed = used.filter(function (x) { return x.id === '_excel' && cnt[mm + '|_excel']; }).length && used.some(function (x) { return x.id !== '_excel' && x.id !== '_manual' && cnt[mm + '|' + x.id]; });
        return h('tr', null, h('td', null, U.MON[+mm - 1], mixed ? h('span', { class: 'small amber' }, ' Excel and bank files both') : null), cells, h('td', { class: 'r strong' }, U.money(tot, { whole: true })));
      })))));
    // 2. Possible double counting across sources
    var seen = {}, dups = [];
    txs.forEach(function (t) { if (t.type !== 'expense') return; var k = t.date + '|' + Math.abs(t.amount).toFixed(2); (seen[k] = seen[k] || []).push(t); });
    Object.keys(seen).forEach(function (k) { var g = seen[k]; if (g.length > 1 && g.some(function (a) { return g.some(function (b) { return Tx.srcOf(a) !== Tx.srcOf(b); }); })) dups.push(g); });
    var issues = [];
    if (dups.length) issues.push([dups.length + ' same-day, same-amount purchases in different accounts or sources (possible double counting)', dups.slice(0, 8).map(function (g) { return g[0].date + ' ' + U.money(Math.abs(g[0].amount), { cents: true }) + ': ' + g.map(function (t) { return (t.desc || '?') + ' (' + (t.source === 'excel' ? 'Excel' : t.account || 'by hand') + ')'; }).join(' / '); })]);
    var excelAfter = txs.filter(function (t) { return t.source === 'excel' && cut && t.date >= cut; }).length;
    var csvBefore = txs.filter(function (t) { return t.source === 'csv' && cut && t.date < cut; }).length;
    if (excelAfter) issues.push([excelAfter + ' Excel rows dated on or after your cut-over (' + cut + ')', []]);
    if (csvBefore) issues.push([csvBefore + ' bank-file rows dated before your cut-over; Excel already covers those months unless you meant to add them', []]);
    var review = txs.filter(function (t) { return t.needsTag; }).length, nocat = txs.filter(function (t) { return !t.categoryId; }).length;
    if (review) issues.push([review + ' waiting for review (' + nocat + ' with no category)', []]);
    var lone = txs.filter(function (t) { return t.type === 'transfer' && !t.linkId; }).length;
    if (lone) issues.push([lone + ' transfers with no matching line in another account yet (fine if that account is not imported)', []]);
    var future = txs.filter(function (t) { return t.date > U.today(); }).length;
    if (future) issues.push([future + ' transactions dated in the future', []]);
    s.appendChild(h('h3', null, 'Things to look at'));
    if (!issues.length) s.appendChild(h('div', { class: 'ok' }, 'Nothing to look at. Every month has one source and nothing is waiting.'));
    issues.forEach(function (i) { s.appendChild(h('div', { class: 'stack-sm' }, h('div', { class: 'strong' }, '• ' + i[0]), i[1].map(function (x) { return h('div', { class: 'small muted', style: { paddingLeft: '14px' } }, x); }))); });
    if (review) s.appendChild(h('a', { class: 'btn', href: '#/transactions?f=review', style: { alignSelf: 'flex-start' } }, 'Open Review'));
    // 3. Imports
    var b = App.cfg.batches || [];
    if (b.length) {
      s.appendChild(h('h3', null, 'Imports'));
      b.slice().reverse().forEach(function (x) {
        var left = txs.filter(function (t) { return t.batchId === x.id; }).length;
        s.appendChild(h('div', { class: 'small' }, x.at.slice(0, 10) + ' · ' + x.file + ': read ' + (x.readRows || '?') + ' rows, imported ' + x.rows + ', left out ' + (x.notImported || 0) + ' · ' + left + ' transactions now in the app'));
      });
    }
    s.appendChild(h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn', onclick: function () { var l = M.linkTransfers(App.cfg, App.txs); (l.length ? DB.putTx(l).then(UI.reload) : Promise.resolve()).then(function () { App.render(); UI.toast(l.length ? 'Matched ' + l.length / 2 + ' transfer pairs.' : 'No new transfer pairs found.'); }); } }, 'Match transfers again'),
      h('button', { type: 'button', class: 'btn', onclick: function () { healthOpen = false; App.render(); } }, 'Hide checks')));
    return s;
  }

  function backups() {
    var s = section('Automatic backups', 'The strongest protection: the app writes a backup file to a folder on this computer a few seconds after every change (one file per day, last 30 days kept, plus a safety copy before anything risky). Clearing browser data, a crash or a closed tab cannot touch those files. Once a snapshot passphrase is set (Shared snapshot, below), every backup file is locked with it, so this folder can also sit inside Google Drive or iCloud as an off-site copy. Keep it separate from the shared snapshot folder.');
    var ss = Safety.status();
    s.appendChild(ss.locked ? h('div', { class: ss.needKey ? 'amber strong' : 'ok strong' }, ss.needKey ? 'Locked with your passphrase, but paused: this browser needs the passphrase once.' : 'Backup files are locked with your snapshot passphrase.')
      : h('div', { class: 'amber strong' }, 'Paused until you set a passphrase under Shared snapshot below: every backup file is locked with it, and nothing unlocked is written.'));
    if (ss.needKey) s.appendChild(h('button', { type: 'button', class: 'btn primary', style: { alignSelf: 'flex-start' }, onclick: function () { Share.withKey('Resume locked backups', 'Unlock and resume', function () { Safety.writeNow('manual').then(Safety.lockFolder).then(function () { App.render(); UI.toast('Locked backups resumed.'); }); }); } }, 'Type passphrase and resume'));
    if (!ss.supported) s.appendChild(h('div', { class: 'toast warn' }, 'This browser cannot write to a folder. Use Chrome or Edge, or download backups below.'));
    else if (!ss.connected) s.appendChild(h('button', { type: 'button', class: 'btn primary', style: { alignSelf: 'flex-start' }, onclick: function () { Safety.connect().then(function () { App.render(); UI.toast(Safety.status().needSetup ? 'Backup folder chosen. Backups start as soon as you set a passphrase (Shared snapshot below).' : 'Automatic backups are on. A first backup was written.'); }).catch(function (e) { if (e && e.name !== 'AbortError') UI.toast('Could not use that folder: ' + e.message); }); } }, 'Choose a backup folder'));
    else {
      s.appendChild(h('div', { class: ss.perm === 'granted' ? 'ok strong' : 'amber strong' }, ss.perm === 'granted' ? 'On: folder "' + ss.name + '"' + (ss.lastWrite ? ' · last written ' + ss.lastWrite.toLocaleTimeString() : '') : 'Paused: the browser needs your permission again for folder "' + ss.name + '" (it asks after a restart).'));
      if (ss.lastError) s.appendChild(h('div', { class: 'small red' }, 'Last attempt failed: ' + ss.lastError));
      s.appendChild(h('div', { class: 'row' },
        ss.perm !== 'granted' ? h('button', { type: 'button', class: 'btn primary', onclick: function () { Safety.reconnect().then(function () { App.render(); }); } }, 'Allow and resume') :
          h('button', { type: 'button', class: 'btn', onclick: function () { Safety.writeNow('manual').then(function (ok) { App.render(); UI.toast(ok ? 'Backup written.' : 'Could not write the backup.'); }); } }, 'Write a backup now'),
        h('button', { type: 'button', class: 'btn', onclick: function () { Safety.connect().then(function () { App.render(); UI.toast('Backups now go to the new folder.'); }).catch(function (e) { if (e && e.name !== 'AbortError') UI.toast(e.message); }); } }, 'Use a different folder'),
        h('button', { type: 'button', class: 'btn', onclick: function () { Safety.pickAndFindNewest().then(function (d) { pendingRestore = d; App.render(); }).catch(function (e) { if (e && e.name !== 'AbortError') UI.toast('Could not read backups: ' + e.message); }); } }, 'Restore from backup folder…')));
    }
    if (pendingRestore) s.appendChild(h('div', { class: 'toast warn', role: 'alert' }, h('span', null, 'Restore ' + pendingRestore.transactions.length + ' transactions from ' + pendingRestore._name + ' (saved ' + pendingRestore.savedAt.slice(0, 16).replace('T', ' ') + ')? This replaces the ' + App.txs.length + ' here; a safety copy of them is written first.'),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn danger', onclick: function () { var d = pendingRestore; pendingRestore = null; Safety.restore(d).then(function (n) { App.render(); UI.toast('Restored ' + n + ' transactions.'); }); } }, 'Restore'),
        h('button', { type: 'button', class: 'btn', onclick: function () { pendingRestore = null; App.render(); } }, 'Cancel'))));
    var s2 = section('Backup', 'Your budget lives only in this browser. Clearing browsing data for files, or using another browser, starts empty. Download a backup regularly and keep it somewhere private. For an off-site copy, use Shared snapshot below: it is locked with a passphrase.');
    s2.appendChild(h('p', { class: 'small', style: { margin: 0 } }, 'The copy inside this browser is not encrypted by the app. It is protected by your computer\'s sign-in and disk encryption, so keep FileVault (Mac) or BitLocker (Windows) turned on. Downloaded backups and snapshots are encrypted when you set a passphrase.'));
    var status = h('div', { class: 'small muted' }, 'Checking storage…');
    if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then(function (p) { status.textContent = p ? 'This browser has agreed to keep the data (persistent storage is on).' : 'Persistent storage is not confirmed, so backups matter.'; });
    else status.textContent = 'Persistent storage is not available here, so backups matter.';
    s2.appendChild(status);
    s2.appendChild(h('div', { class: 'small muted' }, App.txs.length + ' transactions, ' + App.cfg.categories.filter(function (c) { return !c.archived; }).length + ' categories.'));
    var restore = h('input', { id: 'rf', type: 'file', accept: Vault.ACCEPT, class: 'input', style: { paddingTop: '8px' }, onchange: function (e) {
      var f = e.target.files[0]; if (!f) return;
      U.readFile(f).then(function (text) {
        return Share.withPass(function (pass) { return Share.openText(text, pass); }, { title: 'Open a locked backup', verb: 'Open backup' }).then(function (data) {
        if (!data || data.app !== 'household-budget' || !data.config || !Array.isArray(data.transactions)) throw new Error('This is not a backup from this app.');
        // an older or separately changed file: say so first, and offer to merge it in instead
        return LineageUI.check(data).then(function (c) { if (LineageUI.warningText(c)) { pendingFile = { data: data, name: f.name, c: c }; App.render(); return; } return restoreFile(data); });
        });
      }).catch(function (err) { UI.toast('Could not restore: ' + err.message); });
    } });
    function restoreFile(data) {
        pendingFile = null;
        return Safety.snapshot('restore').then(function () { return DB.replaceAll(data.config, data.transactions); }).then(UI.reload).then(Share.adoptKey).then(function () { App.render(); UI.toast('Restored ' + data.transactions.length + ' transactions from ' + (data.savedAt || 'the backup').slice(0, 10) + '.'); });
    }
    s2.appendChild(h('div', { class: 'row', style: { alignItems: 'flex-end' } },
      h('button', { type: 'button', class: 'btn primary', onclick: function () { exportBackup(); } }, 'Download budget file'),
      h('div', { class: 'field', style: { flex: '1 1 260px' } }, h('label', { for: 'rf' }, 'Restore from a budget file or backup (replaces everything here)'), restore)));
    s2.appendChild(h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: LineageUI.mergeFlow }, 'Merge a budget file into this budget…'),
      h('span', { class: 'small muted' }, App.cfg.lineage ? 'This budget: revision ' + App.cfg.lineage.rev + '.' : 'Revisions start with the first budget file you download.')));
    if (pendingFile) s2.appendChild(h('div', { class: 'toast warn stack-sm', role: 'alert' }, h('strong', null, pendingFile.c.state === 'older' ? 'That file is older than this budget' : 'That file and this budget were changed separately'),
      h('span', null, LineageUI.warningText(pendingFile.c)),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn primary', onclick: function () { var pf = pendingFile; pendingFile = null; App.render(); Promise.all([DB.getConfig(), DB.allTx()]).then(function (r) { LineageUI.mergePanel({ config: r[0], transactions: r[1] }, pf.data, pf.name); }); } }, 'Merge it in instead'),
        h('button', { type: 'button', class: 'btn danger', onclick: function () { var pf = pendingFile; restoreFile(pf.data).then(App.render).catch(function (err) { UI.toast('Could not restore: ' + err.message); }); } }, 'Replace this budget with it anyway'),
        h('button', { type: 'button', class: 'btn', onclick: function () { pendingFile = null; App.render(); } }, 'Cancel'))));
    if (!Share.backupLockOn()) s2.appendChild(h('div', { class: 'toast warn', role: 'status' }, 'Every budget file is locked with a passphrase, and none is set yet: set one under Shared snapshot below before downloading. Until then nothing is written to your backup folder either.'));
    if (!confirmErase) s2.appendChild(h('button', { type: 'button', class: 'btn danger', style: { alignSelf: 'flex-start' }, onclick: function () { confirmErase = true; App.render(); } }, 'Erase everything in this browser'));
    else s2.appendChild(h('div', { class: 'toast warn', role: 'alert' }, h('span', null, 'Erase all ' + App.txs.length + ' transactions and your categories? Download a backup first if unsure.'),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn danger', onclick: function () { Safety.snapshot('erase').then(function () { return DB.clearAll(); }).then(UI.reload).then(function () { confirmErase = false; location.hash = '#/home'; App.render(); }); } }, 'Erase everything'),
        h('button', { type: 'button', class: 'btn', onclick: function () { confirmErase = false; App.render(); } }, 'Keep it'))));
    return h('div', { class: 'stack', style: { gap: '24px' } }, s, s2);
  }
  function exportBackup() {
    var data, lin;
    return Share.ensureKey('Budget files are locked with your snapshot passphrase. Type it once to continue.').then(LineageUI.stamp).then(function (l) {
      lin = l; data = { app: 'household-budget', version: 1, savedAt: new Date().toISOString(), config: App.cfg, transactions: App.txs };
      return Share.encodeBackup(data);
    }).then(function (text) {
      U.download(Vault.fileName(data.savedAt), text, 'application/octet-stream');
      LineageUI.saved(lin, Vault.fileName(data.savedAt));
      App.cfg.lastBackup = new Date().toISOString();
      return UI.saveCfg().then(function () { App.render(); UI.toast('Budget file downloaded (revision ' + lin.rev + ', ' + App.txs.length + ' transactions), checked: it opens with your passphrase. Keep it somewhere private.'); });
    }).catch(function (e) { UI.toast('Could not make the backup: ' + e.message); });
  }
  return { render: render, renderBackup: renderBackup, rulesSection: rulesSection, subnav: subnav, exportBackup: exportBackup };
})();
