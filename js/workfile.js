/* Work from a file: open a budget file, review and edit it, save a new budget file, close. Made for the app hosted as a web
   page (GitHub Pages and the like), where nothing readable should stay on the device:
   - the budget lives in this tab's memory only (DB.useMemory); the key made from the passphrase stays in this tab;
   - a locked recovery copy (a budget file, same passphrase) is kept in the browser a moment after every change, so a
     closed or crashed tab loses nothing: the welcome screen offers it back, and only the passphrase opens it;
   - Save file: the budget is locked, opened again and compared (Vault.seal), then downloaded as budget-<date>-<time>.budget;
   - leaving with unsaved changes asks first; 30 minutes without use locks it (the recovery copy stays, locked).
   Works in any current browser (Chrome, Edge, Safari, Firefox, phones): only a file chooser and a download are needed. */
var WorkFile = (function () {
  'use strict';
  var h = U.h, IDLE_MS = 30 * 60 * 1000, PREFIX = 'workDraft:';
  var st = null, draftTimer = null, idleTimer = null, saving = false, draftChain = Promise.resolve();
  var ws = { file: null, pass: '', msg: '', busy: false, show: false, seedCfg: null, seedName: '', np1: '', np2: '', nmsg: '', rec: {}, confirmDiscard: null, confirmClose: false, lockedNote: '' };

  function on() { return !!st; }
  /* the hosted page offers only this way of working (nothing readable is kept); opened from disk, it is an extra option */
  function hosted() { return location.protocol === 'https:' || /[?&]hosted=1(&|$)/.test(location.search); }

  /* ---------- start / save / close ---------- */
  function start(d, o) {
    DB.useMemory(d.config, d.transactions || []);
    st = { id: o.id || U.uid(), name: o.name, dirty: o.dirty || 0, savedName: o.savedName || null, savedAt: o.savedAt || null, plainOrigin: !!o.plainOrigin };
    ws = fresh();
    return LineageUI.note(d.config && d.config.lineage, o.name).then(UI.reload).then(function () { return Share.useKey(o.salt, o.iter, o.key); }).then(function (changed) { return changed ? UI.saveCfg() : null; })
      .then(function () { armIdle(); return writeDraft(); })
      .then(function () { App.hasLocalBudget = false; location.hash = o.route || '#/home'; App.render(); return RecurringUI.autoLog({ force: true }); });
  }
  function fresh() { return { file: null, pass: '', msg: '', busy: false, show: false, seedCfg: null, seedName: '', np1: '', np2: '', nmsg: '', rec: {}, confirmDiscard: null, confirmClose: false, lockedNote: '' }; }
  function payload() {
    return Promise.all([DB.getConfig(), DB.allTx()]).then(function (r) {
      return { app: 'household-budget', version: 1, savedAt: new Date().toISOString(), config: r[0], transactions: r[1] };
    });
  }
  function keyNow() { var s = App.cfg && App.cfg.share, k = Share.sessionKey(); if (!s || !k) throw new Error('The passphrase is not known in this tab. Close the file and open it again.'); return { key: k, salt: s.salt, iter: s.iter }; }
  /* the locked recovery copy: one per open file, written one at a time */
  function writeDraft() {
    if (!st) return Promise.resolve();
    var mine = st;
    draftChain = draftChain.then(function () {
      if (st !== mine) return;
      return payload().then(function (p) {
        var k = keyNow();
        return Vault.seal(p, k.key, k.salt, k.iter).then(function (text) {
          if (st !== mine) return;
          return DB.setMeta(PREFIX + mine.id, { text: text, at: p.savedAt, name: mine.name, dirty: mine.dirty, savedName: mine.savedName, savedAt: mine.savedAt, count: p.transactions.length });
        });
      });
    }).catch(function (e) { if (window.console) console.error('Recovery copy not written: ' + e.message); });
    return draftChain;
  }
  function changed(ok) {
    if (!st || !ok) return;
    st.dirty++;
    clearTimeout(draftTimer); draftTimer = setTimeout(writeDraft, 800);
  }
  DB.onWrite(function () {}, changed);

  function save() {
    if (!st) return Promise.reject(new Error('No budget file is open.'));
    if (saving) return Promise.reject(new Error('Already saving.'));
    saving = true;
    var mine = st, dirtyAtStart = st.dirty, lin;
    return LineageUI.stamp().then(function (l) { lin = l; return payload(); }).then(function (p) {
      var k = keyNow();
      return Vault.seal(p, k.key, k.salt, k.iter).then(function (text) {
        var name = Vault.fileName(p.savedAt);
        U.download(name, text, 'application/octet-stream');
        if (st === mine) { mine.dirty = Math.max(0, mine.dirty - dirtyAtStart); mine.savedName = name; mine.savedAt = p.savedAt; }
        return LineageUI.saved(lin, name).then(writeDraft).then(function () { return { name: name, count: p.transactions.length, rev: lin.rev }; });
      });
    }).then(function (r) { saving = false; return r; }, function (e) { saving = false; throw e; });
  }
  function saveFlow() {
    save().then(function (r) { App.render(); UI.toast('Saved ' + r.name + ' (revision ' + r.rev + ', ' + r.count + ' transactions) and checked: it opens with your passphrase. Keep it with your budget files; open the newest one next time.'); })
      .catch(function (e) { App.render(); UI.toast('Not saved: ' + e.message); });
  }
  /* back to the welcome screen; keepDraft = locked for being idle (the recovery copy stays) */
  function close(keepDraft) {
    clearTimeout(draftTimer); clearTimeout(idleTimer);
    var mine = st;
    var flush = keepDraft && mine ? writeDraft() : Promise.resolve();
    return flush.then(function () { return keepDraft || !mine ? null : DB.setMeta(PREFIX + mine.id, null); }).then(function () {
      st = null; DB.useMemory(null); Share.forgetKeys(); App.cfg = null; App.txs = []; App.month = null;
      UI.closePanel(); location.hash = '#/home'; App.render();
    });
  }

  /* ---------- leaving, idle ---------- */
  window.addEventListener('beforeunload', function (e) { if (st && st.dirty > 0) { writeDraft(); e.preventDefault(); e.returnValue = ''; return ''; } });
  document.addEventListener('visibilitychange', function () { if (st && document.visibilityState === 'hidden') { clearTimeout(draftTimer); writeDraft(); } });
  function lockIdle() { ws.lockedNote = 'Locked after 30 minutes without use. Your work is in the locked recovery copy below: type the passphrase to continue.'; return close(true); }
  function armIdle() { clearTimeout(idleTimer); if (st) idleTimer = setTimeout(lockIdle, IDLE_MS); }
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (ev) { window.addEventListener(ev, function () { if (st) armIdle(); }, { passive: true }); });

  /* ---------- recovery copies ---------- */
  function drafts() {
    return DB.metaKeys().then(function (keys) {
      keys = keys.filter(function (k) { return typeof k === 'string' && k.indexOf(PREFIX) === 0 && (!st || k !== PREFIX + st.id); });
      return Promise.all(keys.map(function (k) { return DB.getMeta(k).then(function (d) { return d ? Object.assign({ key: k }, d) : null; }); }));
    }).then(function (list) { return list.filter(Boolean).sort(function (a, b) { return a.at < b.at ? 1 : -1; }); }).catch(function () { return []; });
  }

  /* ---------- banner on every screen while a file is open ---------- */
  function banner() {
    if (!st) return null;
    var name = st.savedName || st.name, n = st.dirty;
    return h('div', { class: 'ro-banner wf-banner', role: 'status' },
      h('span', null, n ? h('strong', { class: 'amber' }, n + ' change' + (n === 1 ? '' : 's') + ' not saved yet') : h('strong', null, st.savedName ? 'Saved' : 'Opened'),
        h('span', { class: 'small' }, ' · ' + (st.savedName ? 'last saved as ' : 'from ') + name + (st.savedAt ? ' at ' + new Date(st.savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''))),
      h('span', { class: 'row' },
        h('button', { type: 'button', class: 'btn' + (n ? ' primary' : ''), onclick: saveFlow }, 'Save file'),
        h('a', { class: 'btn', href: '#/backup' }, 'File & passphrase')));
  }

  /* ---------- Settings > Backup & sharing while a file is open ---------- */
  function settings(main) {
    var s = h('section', { class: 'card pad stack', 'aria-label': 'Budget file' }, h('h2', null, 'Budget file'),
      h('p', { class: 'muted', style: { margin: 0 } }, 'You are working from a budget file. Changes stay in this tab (and in a locked recovery copy in this browser) until you save a new file. Save before you close, and next time open the newest file.'),
      h('div', null, h('span', { class: 'muted' }, 'Opened: '), st.name),
      h('div', null, h('span', { class: 'muted' }, 'Last saved: '), st.savedName ? st.savedName + ' at ' + new Date(st.savedAt).toLocaleString() : 'not yet in this session'),
      h('div', null, h('span', { class: 'muted' }, 'Not saved yet: '), st.dirty ? st.dirty + ' change' + (st.dirty === 1 ? '' : 's') : 'nothing'),
      h('div', null, h('span', { class: 'muted' }, 'Revision: '), App.cfg.lineage ? App.cfg.lineage.rev + ' (the next save is ' + (App.cfg.lineage.rev + 1) + ')' : 'none yet (the first save is 1)'),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onclick: saveFlow }, 'Save file'),
        h('button', { type: 'button', class: 'btn', onclick: LineageUI.mergeFlow }, 'Merge in another file…'),
        !ws.confirmClose ? h('button', { type: 'button', class: 'btn', onclick: function () { if (!st.dirty) return close(false); ws.confirmClose = true; App.render(); } }, 'Close file') : null));
    if (ws.confirmClose) s.appendChild(h('div', { class: 'toast warn', role: 'alert' }, h('span', null, 'Close without saving? ' + st.dirty + ' change' + (st.dirty === 1 ? '' : 's') + ' since you last saved will be lost, and the recovery copy is deleted.'),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onclick: function () { ws.confirmClose = false; save().then(function () { return close(false); }).catch(function (e) { UI.toast('Not saved: ' + e.message); }); } }, 'Save, then close'),
        h('button', { type: 'button', class: 'btn danger', onclick: function () { ws.confirmClose = false; close(false); } }, 'Close without saving'),
        h('button', { type: 'button', class: 'btn', onclick: function () { ws.confirmClose = false; App.render(); } }, 'Keep working'))));
    main.appendChild(s);
    var p = h('section', { class: 'card pad stack', 'aria-label': 'Passphrase' }, h('h2', null, 'Passphrase'),
      h('p', { class: 'muted', style: { margin: 0 } }, 'Every budget file is locked with it. Files you saved before keep the passphrase they were saved with.'));
    if (ws.changePass && App.cfg.share && App.cfg.share.setAt !== ws.passSetAt) ws.changePass = false;   // changed: the form is done
    if (ws.changePass) { p.appendChild(Share.settingsPassForm(true)); p.appendChild(h('button', { type: 'button', class: 'btn link', style: { alignSelf: 'flex-start' }, onclick: function () { ws.changePass = false; App.render(); } }, 'Keep the current one')); }
    else p.appendChild(h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: function () { ws.changePass = true; ws.passSetAt = App.cfg.share && App.cfg.share.setAt; App.render(); } }, 'Change passphrase')));
    main.appendChild(p);
    main.appendChild(h('section', { class: 'card pad stack', 'aria-label': 'What is kept on this device' }, h('h2', null, 'What is kept on this device'),
      h('p', { class: 'small', style: { margin: 0 } }, 'Only the locked recovery copy (it opens with your passphrase, like your files) and the app\'s settings for this browser. The budget itself is in this tab and in the files you save. Close file deletes the recovery copy.')));
  }

  /* ---------- welcome: open a file, recover, start new ---------- */
  function welcome(main, opts) {
    opts = opts || {};
    var box = h('div', { class: 'stack wf-welcome', style: { maxWidth: '620px' } });
    if (!opts.embedded) {
      box.appendChild(h('h1', null, 'Your budget'));
      box.appendChild(h('p', null, 'Open your budget file, work on it, and save a new file when you are done. Nothing readable is kept on this device, and nothing is sent anywhere.'));
    }
    if (ws.lockedNote) box.appendChild(h('div', { class: 'toast warn', role: 'status' }, ws.lockedNote));
    var recBox = h('div', { class: 'stack' }); box.appendChild(recBox);
    drafts().then(function (list) { list.forEach(function (d) { recBox.appendChild(recoverCard(d)); }); });
    box.appendChild(openCard());
    box.appendChild(newCard());
    main.appendChild(box);
  }
  function recoverCard(d) {
    var r = ws.rec[d.key] || (ws.rec[d.key] = { pass: '', msg: '', busy: false });
    var when = new Date(d.at), id = 'rp-' + d.key.slice(PREFIX.length);
    var c = h('section', { class: 'card pad stack', 'aria-label': 'Recovery copy' }, h('h2', null, d.dirty ? 'Unsaved work from ' + when.toLocaleString() : 'Continue where you left off'),
      h('p', { class: 'muted', style: { margin: 0 } }, (d.dirty ? d.dirty + ' change' + (d.dirty === 1 ? '' : 's') + ' not saved to a file yet' : 'Everything was saved' + (d.savedName ? ' as ' + d.savedName : '')) + ' · ' + d.count + ' transactions · from ' + (d.savedName || d.name) + '. It is locked: type the passphrase to continue.'));
    var msg = h('div', { class: 'small red', role: 'alert' }, r.msg);
    c.appendChild(h('div', { class: 'field' }, h('label', { for: id }, 'Passphrase'), h('input', { id: id, class: 'input', type: 'password', autocomplete: 'off', spellcheck: 'false', value: r.pass,
      oninput: function (e) { r.pass = e.target.value; msg.textContent = ''; }, onkeydown: function (e) { if (e.key === 'Enter') go(); } }), msg));
    c.appendChild(h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', disabled: r.busy, onclick: go }, r.busy ? 'Opening…' : 'Continue'),
      ws.confirmDiscard === d.key ? null : h('button', { type: 'button', class: 'btn', onclick: function () { ws.confirmDiscard = d.key; App.render(); } }, 'Delete this copy…')));
    if (ws.confirmDiscard === d.key) c.appendChild(h('div', { class: 'toast warn', role: 'alert' }, h('span', null, 'Delete the recovery copy from ' + when.toLocaleString() + '?' + (d.dirty ? ' Its ' + d.dirty + ' unsaved change' + (d.dirty === 1 ? '' : 's') + ' will be lost.' : ' Your saved files are not touched.')),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn danger', onclick: function () { ws.confirmDiscard = null; DB.setMeta(d.key, null).then(function () { App.render(); UI.toast('Recovery copy deleted.'); }); } }, 'Delete it'),
        h('button', { type: 'button', class: 'btn', onclick: function () { ws.confirmDiscard = null; App.render(); } }, 'Keep it'))));
    function go() {
      if (!r.pass) { r.msg = 'Type the passphrase.'; return App.render(); }
      r.busy = true; App.render();
      Vault.open(d.text, { pass: r.pass }).then(function (o) {
        ws.lockedNote = '';
        return start(o.data, { id: d.key.slice(PREFIX.length), name: d.name, key: o.key, salt: o.salt, iter: o.iter, dirty: d.dirty, savedName: d.savedName, savedAt: d.savedAt });
      }).catch(function (e) { r.busy = false; r.msg = e.message; App.render(); });
    }
    return c;
  }
  function openCard() {
    var c = h('section', { class: 'card pad stack', 'aria-label': 'Open your budget file' }, h('h2', null, 'Open your budget file'),
      h('p', { class: 'muted', style: { margin: 0 } }, 'Choose the newest file you saved (budget-….budget). Older backups (.json) and snapshots (.budgetsnap) open too.'));
    var msg = h('div', { class: 'small red', role: 'alert' }, ws.msg);
    c.appendChild(h('div', { class: 'field' }, h('label', { for: 'wf-file' }, 'Budget file'),
      h('input', { id: 'wf-file', type: 'file', accept: Vault.ACCEPT, class: 'input', style: { paddingTop: '8px' }, onchange: function (e) {
        var f = e.target.files[0]; if (!f) return;
        U.readFile(f).then(function (text) {
          ws.file = { name: f.name, text: text, size: f.size }; ws.msg = '';
          try { var i = Vault.inspect(text); ws.file.format = i.format; ws.file.createdAt = i.createdAt; } catch (err) { ws.file = null; ws.msg = err.message; }
          App.render();
        }, function (err) { ws.msg = 'Could not read the file: ' + err.message; App.render(); });
      } })));
    if (ws.pending) { c.appendChild(pendingCard()); return c; }
    if (ws.file) {
      c.appendChild(h('div', { class: 'ok strong' }, 'Chosen: ' + ws.file.name + (ws.file.createdAt ? ' (saved ' + new Date(ws.file.createdAt).toLocaleString() + ')' : '')));
      if (ws.file.format === 'plain') {
        c.appendChild(h('p', { class: 'small', style: { margin: 0 } }, 'This older backup is not locked. Choose a passphrase: every file saved from now on is locked with it.'));
        c.appendChild(passPair('wo'));
      } else {
        c.appendChild(h('div', { class: 'field' }, h('label', { for: 'wf-pass' }, 'Passphrase'),
          h('input', { id: 'wf-pass', class: 'input', type: ws.show ? 'text' : 'password', autocomplete: 'off', spellcheck: 'false', value: ws.pass,
            oninput: function (e) { ws.pass = e.target.value; msg.textContent = ''; }, onkeydown: function (e) { if (e.key === 'Enter') openIt(); } }),
          h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: ws.show, onchange: function (e) { ws.show = e.target.checked; App.render(); } }), h('span', null, 'Show what I type'))));
      }
      c.appendChild(msg);
      c.appendChild(h('button', { type: 'button', class: 'btn primary', style: { alignSelf: 'flex-start' }, disabled: ws.busy, onclick: openIt }, ws.busy ? 'Opening…' : 'Open'));
    } else c.appendChild(msg);
    return c;
  }
  function passPair(pre) {
    var v = Share.strength(ws.np1);
    return h('div', { class: 'stack-sm' },
      h('div', { class: 'field' }, h('label', { for: pre + '1' }, 'Choose a passphrase'), h('input', { id: pre + '1', class: 'input', type: 'password', autocomplete: 'new-password', spellcheck: 'false', value: ws.np1, oninput: function (e) { ws.np1 = e.target.value; ws.nmsg = ''; } }),
        h('div', { class: 'small muted' }, ws.np1 ? v.text : 'Five or six everyday words with spaces work well. Write it down: nobody can open your files without it.')),
      h('div', { class: 'field' }, h('label', { for: pre + '2' }, 'Type it again'), h('input', { id: pre + '2', class: 'input', type: 'password', autocomplete: 'new-password', spellcheck: 'false', value: ws.np2, oninput: function (e) { ws.np2 = e.target.value; ws.nmsg = ''; } })),
      h('button', { type: 'button', class: 'btn link', style: { alignSelf: 'flex-start' }, onclick: function () { ws.np1 = ws.np2 = Share.idea(); ws.nmsg = 'Suggested: "' + ws.np1 + '". Write it down now.'; App.render(); } }, 'Suggest one'),
      ws.nmsg ? h('div', { class: 'small', role: 'status' }, ws.nmsg) : null);
  }
  /* a passphrase for a budget that has none yet: salt + key */
  function newKey() {
    var v = Share.strength(ws.np1);
    if (!v.ok) return Promise.reject(new Error(v.text));
    if (ws.np1 !== ws.np2) return Promise.reject(new Error('The two passphrases are different. Type the same one twice.'));
    var salt = Vault.newSalt();
    return Vault.derive(ws.np1, salt, Vault.ITER).then(function (key) { return { key: key, salt: salt, iter: Vault.ITER }; });
  }
  function openIt() {
    if (!ws.file || ws.busy) return;
    var f = ws.file;
    if (f.format !== 'plain' && !ws.pass) { ws.msg = 'Type the passphrase.'; return App.render(); }
    ws.busy = true; ws.msg = ''; App.render();
    var p = f.format === 'plain'
      ? Vault.open(f.text, {}).then(function (r) { return newKey().then(function (k) { return { data: r.data, key: k.key, salt: k.salt, iter: k.iter, plain: true }; }); })
      : Vault.open(f.text, { pass: ws.pass });
    p.then(function (r) {
      return LineageUI.check(r.data).then(function (c) {
        if (LineageUI.warningText(c)) { ws.busy = false; ws.pending = { r: r, f: f, c: c }; App.render(); return; }   // older or forked: you decide
        return go(r, f, false);
      });
    }).catch(function (e) { ws.busy = false; ws.msg = e.message; App.render(); });
  }
  function go(r, f, thenMerge) {
    ws.pending = null;
    return start(r.data, { name: f.name, key: r.key, salt: r.salt, iter: r.iter, plainOrigin: !!r.plain }).then(function () {
      var rev = r.data.config && r.data.config.lineage ? ' (revision ' + r.data.config.lineage.rev + ')' : '';
      UI.toast('Opened ' + f.name + rev + ': ' + r.data.transactions.length + ' transactions. Save a new file when you are done.');
      if (thenMerge) LineageUI.mergeFlow();
    });
  }
  /* an older or forked copy: say so plainly, and let you choose */
  function pendingCard() {
    var pd = ws.pending, older = pd.c.state === 'older';
    return h('div', { class: 'toast warn stack-sm', role: 'alert' }, h('strong', null, older ? 'There is a newer copy' : 'Two copies were changed separately'), h('span', null, LineageUI.warningText(pd.c)),
      h('div', { class: 'row' },
        older ? h('button', { type: 'button', class: 'btn primary', onclick: function () { ws.pending = null; ws.file = null; ws.pass = ''; App.render(); var i = document.getElementById('wf-file'); if (i) i.focus(); } }, 'Choose the newer file')
          : h('button', { type: 'button', class: 'btn primary', onclick: function () { go(pd.r, pd.f, true).catch(function (e) { UI.toast(e.message); }); } }, 'Open, then merge in the other copy…'),
        h('button', { type: 'button', class: 'btn', onclick: function () { go(pd.r, pd.f, false).catch(function (e) { UI.toast(e.message); }); } }, 'Open this one anyway'),
        older ? null : h('button', { type: 'button', class: 'btn link', onclick: function () { ws.pending = null; ws.file = null; ws.pass = ''; App.render(); } }, 'Choose another file')));
  }
  function newCard() {
    var c = h('section', { class: 'card pad stack', 'aria-label': 'Start a new budget' }, h('h2', null, 'Start a new budget'),
      h('p', { class: 'muted', style: { margin: 0 } }, 'Choose your budget-seed.json (groups, categories, limits) and a passphrase for your budget files.'));
    c.appendChild(h('div', { class: 'field' }, h('label', { for: 'wf-seed' }, 'budget-seed.json'),
      h('input', { id: 'wf-seed', type: 'file', accept: '.json', class: 'input', style: { paddingTop: '8px' }, onchange: function (e) {
        var f = e.target.files[0]; if (!f) return;
        U.readFile(f).then(function (text) { try { ws.seedCfg = M.fromSeed(JSON.parse(text)); ws.seedName = f.name; ws.nmsg = ''; } catch (err) { ws.seedCfg = null; ws.nmsg = 'This is not a budget-seed.json: ' + err.message; } App.render(); });
      } })));
    if (ws.seedCfg) {
      c.appendChild(h('div', { class: 'ok strong' }, 'Chosen: ' + ws.seedName + ' (' + ws.seedCfg.categories.length + ' categories)'));
      c.appendChild(passPair('wn'));
      c.appendChild(h('button', { type: 'button', class: 'btn primary', style: { alignSelf: 'flex-start' }, onclick: function () {
        newKey().then(function (k) {
          var name = 'a new budget';
          return start({ config: ws.seedCfg, transactions: [] }, { name: name, key: k.key, salt: k.salt, iter: k.iter, dirty: 1, route: '#/rules' }).then(function () {
            UI.toast('Your categories are set up. Next: load your tagging rules below. Save a budget file before you close the page.');
          });
        }).catch(function (e) { ws.nmsg = e.message; App.render(); });
      } }, 'Create the budget'));
    } else if (ws.nmsg) c.appendChild(h('div', { class: 'small red', role: 'alert' }, ws.nmsg));
    return c;
  }

  return { on: on, hosted: hosted, start: start, save: save, saveFlow: saveFlow, close: close, banner: banner, settings: settings, welcome: welcome, drafts: drafts,
    state: function () { return st ? { name: st.name, dirty: st.dirty, savedName: st.savedName, savedAt: st.savedAt, id: st.id } : null; }, _writeDraft: writeDraft, _lockIdle: lockIdle };
})();
