/* Encrypted snapshots and the read-only viewer.
   - A snapshot is the whole budget (same content as a backup) in a budget file (js/vault.js): PBKDF2-SHA-256
     (600,000 rounds) turns the passphrase into an AES-256-GCM key; the header is bound to the data; a damaged or cut-off
     file is told apart from a wrong passphrase; every file is opened again and compared before it is saved.
   - Every file the app writes is locked: with no passphrase set, nothing is written (old unlocked files still open).
   - Snapshots go to a shared folder you choose (Google Drive / iCloud on this computer); the newest 3 are kept.
   - The passphrase is never stored. A small locked "check" in Settings tells you if you mistype it.
   - Automatic backup files are locked with the same passphrase. So backups keep running after a restart, the key made
     from it is kept in this browser's own database as a non-extractable Web Crypto key: it can be used here but never
     read out, and that database already holds the budget itself in the clear.
   - Viewer mode opens a snapshot in memory only: nothing is written to this browser, every screen is read-only,
     and it locks itself after 15 minutes without use. */
var Share = (function () {
  'use strict';
  var h = U.h;
  var ITER = Vault.ITER, EXT = Vault.EXT, KEEP = 3, IDLE_MS = 15 * 60 * 1000;
  // snapshot files in the shared folder: budget-2026-10-26-1430.budget (and older budget-snapshot-….budgetsnap)
  var NAME_RE = /^(budget-snapshot-\d{4}-\d{2}-\d{2}-\d{4}(-\d+)?\.budgetsnap|budget-\d{4}-\d{2}-\d{2}-\d{4}(-\d+)?\.budget)$/;
  function stampOf(name) { var m = name.match(/(\d{4}-\d{2}-\d{2}-\d{4})(?:-(\d+))?/); return m ? m[1] + '-' + U.pad(+(m[2] || 0)) + (/\.budget$/.test(name) ? 'b' : 'a') : ''; }
  var dir = null, dirPerm = 'none', viewDir = null, mode = null, session = null, stored = null, viewKeys = {}, view = null, idleTimer = null;
  var supported = typeof window.showDirectoryPicker === 'function';

  /* ---------- bytes ---------- */
  var enc = new TextEncoder(), dec = new TextDecoder();
  function b64(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(s) { var bin = atob(s), b = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; }
  function rand(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return a; }

  /* ---------- keys ---------- */
  function derive(pass, saltB64, iter) { return Vault.derive(pass, saltB64, iter || ITER); }
  var CHECK = 'household-budget-passphrase-check';
  function makeCheck(key) {
    var iv = rand(12);
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(CHECK)).then(function (ct) { return { iv: b64(iv), ct: b64(ct) }; });
  }
  /* Resolves with the key if the passphrase matches the one set in Settings; rejects otherwise. */
  function unlockEditor(pass) {
    var s = cfgShare(); if (!s) return Promise.reject(new Error('Set a passphrase first.'));
    function attempt(p) {
      return derive(p, s.salt, s.iter).then(function (key) {
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(s.check.iv) }, key, unb64(s.check.ct)).then(function (pt) {
          if (dec.decode(pt) !== CHECK) throw new Error('x');
          session = { salt: s.salt, key: key }; remember(s.salt, s.iter, key); return key;
        });
      }).catch(function (e) { if (e && e.message && e.message !== 'x' && e.name !== 'OperationError') throw e; throw new Error('That is not the passphrase set for snapshots. Capital letters and spaces count.'); });
    }
    // exactly as typed first (an older passphrase may end in a space), then without spaces pasted at the ends
    var p = String(pass);
    return attempt(p).catch(function (e) { if (p.trim() && p.trim() !== p) return attempt(p.trim()); throw e; });
  }
  function keyFor(salt) {
    if (session && session.salt === salt) return session.key;
    if (stored && stored.salt === salt) return stored.key;
    return null;
  }
  function sessionKey() { var s = cfgShare(); return s ? keyFor(s.salt) : null; }
  function remember(salt, iter, key) {
    if (DB.inMemory()) { session = { salt: salt, key: key }; return Promise.resolve(); }   // working from a file: the key never leaves this tab
    stored = { salt: salt, iter: iter || ITER, key: key }; return DB.setMeta('lockKey', stored).catch(function () {});
  }
  function cfgShare() { return App.cfg && App.cfg.share && App.cfg.share.salt ? App.cfg.share : null; }
  /* "Work from a file": the key opened the file and stays in this tab only (never stored in the browser). If the budget's
     passphrase record is for another salt (the file was locked with a newer passphrase), it is brought in line. */
  function useKey(saltB64, iter, key) {
    session = { salt: saltB64, key: key }; stored = null;
    var s = cfgShare(); if (s && s.salt === saltB64) return Promise.resolve(false);
    return record(key, saltB64, iter).then(function (r) { App.cfg.share = r; return true; });
  }
  function forgetKeys() { session = null; stored = null; viewKeys = {}; }
  /* The passphrase record kept in the budget: salt + a locked check value (never the passphrase). */
  function record(key, saltB64, iter) {
    var old = (App.cfg && App.cfg.share) || {};
    return makeCheck(key).then(function (check) {
      return { salt: saltB64, iter: iter || ITER, check: check, setAt: old.salt === saltB64 && old.setAt ? old.setAt : new Date().toISOString(), lastSnapshot: old.lastSnapshot || null, lastTest: old.lastTest || null, printedAt: old.salt === saltB64 ? old.printedAt || null : null, history: old.history || [] };
    });
  }

  function setPassphrase(pass) {
    var salt = Vault.newSalt(), prev = cfgShare(), prevKey = prev ? keyFor(prev.salt) : null;
    // keep the old key in reach so backup files locked with it can be re-locked with the new one
    if (prevKey) viewKeys[prev.salt + ':' + prev.iter] = prevKey;
    return derive(pass, salt).then(function (key) {
      return makeCheck(key).then(function (check) {
        var old = App.cfg.share || {};
        if (DB.inMemory()) session = { salt: salt, key: key }; else remember(salt, ITER, key);   // working from a file: this tab only
        App.cfg.share = { salt: salt, iter: ITER, check: check, setAt: new Date().toISOString(), lastSnapshot: old.lastSnapshot || null, lastTest: null, printedAt: null, history: old.history || [] };
        session = { salt: App.cfg.share.salt, key: key };
        return UI.saveCfg();
      });
    }).then(function () { return DB.inMemory() ? 0 : Safety.lockFolder(); });
  }

  /* ---------- file format (js/vault.js) ---------- */
  function lock(payload, key, saltB64, iter) { return Vault.seal(payload, key, saltB64, iter); }
  function parse(text) { return Vault.inspect(text); }
  /* Opens any budget file: with pass, or with a key this tab or browser already has for the file's salt. */
  function openFile(text, pass) {
    var f; try { f = Vault.inspect(text); } catch (e) { return Promise.reject(e); }
    if (f.format === 'plain') return Vault.open(text).then(function (r) { return r.data; });
    var id = f.hd.kdf.salt + ':' + f.hd.kdf.iterations, k = viewKeys[id] || (f.hd.kdf.iterations === ITER ? keyFor(f.hd.kdf.salt) : null);
    // no key yet: still check for damage first, so a broken file is never answered with a passphrase prompt
    if (!pass && !k) return Vault.open(text, {}).then(null, function (e) { throw e.code === 'NEED_PASS' ? needPass() : e; });
    return Vault.open(text, pass ? { pass: pass } : { key: k }).then(function (r) { viewKeys[id] = r.key; return r.data; });
  }

  /* ---------- folders ---------- */
  function load() {
    return Promise.all([DB.getMeta('shareDir'), DB.getMeta('viewDir'), DB.getMeta('mode'), DB.getMeta('lockKey')]).then(function (r) {
      dir = r[0] || null; viewDir = r[1] || null; mode = r[2] || null; stored = r[3] && r[3].key ? r[3] : null;
      return dir && dir.queryPermission ? dir.queryPermission({ mode: 'readwrite' }).then(function (p) { dirPerm = p; }) : (dirPerm = dir ? 'granted' : 'none');
    }).catch(function () { dir = null; dirPerm = 'none'; });
  }
  function allow(hd, rw) {
    if (!hd.queryPermission) return Promise.resolve();
    var o = { mode: rw ? 'readwrite' : 'read' };
    return hd.queryPermission(o).then(function (p) { return p === 'granted' ? p : hd.requestPermission(o); }).then(function (p) {
      if (p !== 'granted') throw new Error('The browser was not allowed to use folder "' + hd.name + '".');
    });
  }
  function chooseFolder() {
    if (!supported) return Promise.reject(new Error('This browser cannot save to a folder. Snapshots are downloaded instead; move them to your shared folder.'));
    return window.showDirectoryPicker({ id: 'budget-shared', mode: 'readwrite', startIn: 'documents' }).then(function (hd) {
      var bk = Safety.folder();
      return (bk && bk.isSameEntry ? bk.isSameEntry(hd) : Promise.resolve(false)).then(function (same) {
        if (same) throw new Error('That is your private backup folder. Choose the shared Google Drive or iCloud folder instead.');
        return hd;
      });
    }).then(function (hd) { dir = hd; dirPerm = 'granted'; return DB.setMeta('shareDir', hd); });
  }
  function forgetFolder() { dir = null; dirPerm = 'none'; return DB.setMeta('shareDir', null); }
  function listIn(d) {
    var out = [], it = d.values();
    function next() { return it.next().then(function (r) { if (r.done) return; if (r.value.kind === 'file' && NAME_RE.test(r.value.name)) out.push(r.value); return next(); }); }
    return next().then(function () { return out.sort(function (a, b) { return stampOf(a.name) < stampOf(b.name) ? 1 : -1; }); });
  }
  function readText(fh) { return fh.getFile().then(function (f) { return f.text(); }); }

  /* ---------- making a snapshot ---------- */
  function localDate(d) { return d.getFullYear() + '-' + U.pad(d.getMonth() + 1) + '-' + U.pad(d.getDate()); }
  function fileName(iso) { return Vault.fileName(iso); }
  function payload() {
    return { app: 'household-budget', version: 1, savedAt: new Date().toISOString(), counts: { transactions: App.txs.length, categories: (App.cfg.categories || []).length }, config: App.cfg, transactions: App.txs };
  }
  /* Writes a new snapshot; keeps the newest 3 in the shared folder. Without a folder, the file is downloaded. */
  function save() {
    var key = sessionKey(), s = cfgShare();
    if (!key) return Promise.reject(new Error('Unlock with the passphrase first.'));
    var p, name, lin;
    return LineageUI.stamp().then(function (l) { lin = l; p = payload(); name = fileName(p.savedAt); return lock(p, key, s.salt, s.iter); }).then(function (text) {
      var where;
      if (dir) {
        where = allow(dir, true).then(function () {
          return dir.getFileHandle(name, { create: true }).then(function (fh) { return fh.createWritable(); }).then(function (w) { return w.write(text).then(function () { return w.close(); }); });
        }).then(function () { return prune(); }).then(function () { dirPerm = 'granted'; return 'folder "' + dir.name + '"'; });
      } else { U.download(name, text, 'application/octet-stream'); where = Promise.resolve('your Downloads'); }
      return where.then(function (w) {
        s.lastSnapshot = { at: p.savedAt, name: name, tx: App.txs.length, where: dir ? 'folder' : 'download', bytes: text.length };
        s.history = [s.lastSnapshot].concat((s.history || []).filter(function (x) { return x.name !== name; })).slice(0, KEEP);
        return UI.saveCfg().then(function () { return LineageUI.saved(lin, name); }).then(function () { return { name: name, where: w, tx: App.txs.length }; });
      });
    });
  }
  function prune() {
    return listIn(dir).then(function (files) { return Promise.all(files.slice(KEEP).map(function (f) { return dir.removeEntry(f.name).catch(function () {}); })); });
  }

  /* ---------- the passphrase panel (shared by every locked action) ---------- */
  function askPass(o) {
    UI.openPanel(function (p) {
      var st = { pass: '', show: false, busy: false, msg: o.msg || '' };
      function draw() {
        U.clear(p);
        p.appendChild(UI.panelHead(o.title, o.sub || null));
        if (o.intro) p.appendChild(h('p', { class: 'muted', style: { margin: 0 } }, o.intro));
        if (o.extra) p.appendChild(o.extra());
        var inp = h('input', { id: 'pp', class: 'input', type: st.show ? 'text' : 'password', autocomplete: 'off', spellcheck: 'false', value: st.pass, autofocus: true,
          oninput: function (e) { st.pass = e.target.value; if (st.msg) { st.msg = ''; msg.textContent = ''; } }, onkeydown: function (e) { if (e.key === 'Enter') go(); } });
        var msg = h('div', { class: 'small red', role: 'alert' }, st.msg);
        p.appendChild(h('div', { class: 'field' }, h('label', { for: 'pp' }, 'Passphrase'), inp, msg,
          h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: st.show, onchange: function (e) { st.show = e.target.checked; draw(); } }), h('span', null, 'Show what I type'))));
        p.appendChild(h('button', { type: 'button', class: 'btn primary', disabled: st.busy, onclick: go }, st.busy ? 'Unlocking…' : o.verb));
        var f = p.querySelector('#pp'); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
      }
      function go() {
        if (st.busy) return;
        if (!st.pass) { st.msg = 'Type the passphrase.'; return draw(); }
        st.busy = true; draw();
        Promise.resolve(o.run(st.pass)).then(function (r) { UI.closePanel(); if (o.done) o.done(r); })
          .catch(function (e) { st.busy = false; st.msg = e.message || String(e); draw(); });
      }
      draw();
    }, { label: o.title });
  }
  /* Runs fn with the session key, asking for the passphrase first when needed. */
  function withKey(title, verb, fn) {
    if (sessionKey()) return fn();
    askPass({ title: title, verb: verb, intro: 'Type the snapshot passphrase. This browser then remembers a key made from it (never the passphrase itself), so locked backups and snapshots keep working.', run: unlockEditor, done: fn });
  }
  function saveFlow() {
    withKey('Save a snapshot', 'Unlock and save', function () {
      save().then(function (r) { App.render(); UI.toast('Snapshot saved to ' + r.where + ' (' + r.tx + ' transactions).' + (r.where === 'your Downloads' ? ' Move it to your shared folder.' : '')); })
        .catch(function (e) { App.render(); UI.toast('Could not save the snapshot: ' + e.message); });
    });
  }

  /* ---------- printable passphrase sheet ---------- */
  function printSheet(pass) {
    var old = document.getElementById('print-sheet'); if (old) old.remove();
    var words = pass.split(/(\s+)/);
    var sheet = h('div', { id: 'print-sheet' },
      h('h1', null, 'Our Budget: snapshot passphrase'),
      h('p', null, 'Printed ' + U.dayLabel(U.today()) + ', ' + U.today().slice(0, 4) + '. Passphrase set ' + (App.cfg.share.setAt || '').slice(0, 10) + '.'),
      h('div', { class: 'pass' }, words.map(function (w) { return /\s/.test(w) ? h('span', { class: 'gap' }, '␣') : h('span', null, w); })),
      h('p', { class: 'small' }, 'Type it exactly: capital letters count, and each ␣ is one space.'),
      h('h2', null, 'To open the budget (read-only)'),
      h('ol', null,
        h('li', null, 'On the computer with the budget-app folder, open index.html in Chrome or Edge.'),
        h('li', null, 'Choose "Open a shared snapshot".'),
        h('li', null, 'Choose the shared folder (or the newest budget-snapshot file in it).'),
        h('li', null, 'Type the passphrase above and press Open.')),
      h('h2', null, 'If the budget computer is lost'),
      h('p', null, 'The snapshot holds the whole budget. On a new computer: open the app, choose "Open a shared snapshot", then in the read-only view choose "Make this the main copy".'),
      h('p', { class: 'warn' }, 'Keep this sheet somewhere safe at home. Never put it, or a photo of it, in the shared folder. Anyone with this sheet and a snapshot file can read the budget.'));
    document.body.appendChild(sheet);
    var done = function () { sheet.remove(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(function () { window.print(); }, 50);
  }

  /* ---------- monthly restore test ---------- */
  function pickFile() {
    return new Promise(function (ok, no) {
      var inp = h('input', { type: 'file', accept: Vault.ACCEPT, style: { display: 'none' } });
      inp.addEventListener('change', function () { var f = inp.files[0]; inp.remove(); if (!f) return no(Object.assign(new Error('cancelled'), { name: 'AbortError' })); f.text().then(function (t) { ok({ text: t, name: f.name }); }, no); });
      document.body.appendChild(inp); inp.click();
    });
  }
  function newestFrom(d, rw) {
    return allow(d, rw).then(function () { return listIn(d); }).then(function (files) {
      if (!files.length) throw new Error('No budget files in folder "' + d.name + '". They are named budget-2026-…' + EXT + ' (older ones budget-snapshot-….budgetsnap).');
      return readText(files[0]).then(function (t) { return { text: t, name: files[0].name, count: files.length }; });
    });
  }
  /* Opens the newest snapshot with the typed passphrase (never the one remembered in this tab) and compares it with this budget. */
  function testFlow() {
    var src = null;
    function choose() {
      var p = dir ? newestFrom(dir, false) : pickFile();
      return p.then(function (f) { src = f; return f; });
    }
    choose().then(function () {
      askPass({ title: 'Test opening a snapshot', verb: 'Open and check', sub: src.name,
        intro: 'Type the passphrase from memory or from the printed sheet. This proves your copy can be opened; nothing here changes.',
        run: function (pass) {
          return openFile(src.text, pass).then(function (d) {
            var mine = {}; App.txs.forEach(function (t) { mine[t.id] = 1; });
            var missing = d.transactions.filter(function (t) { return !mine[t.id]; }).length;
            App.cfg.share.lastTest = { at: new Date().toISOString(), name: src.name, tx: d.transactions.length, savedAt: d.savedAt };
            return UI.saveCfg().then(function () { return { d: d, missing: missing }; });
          });
        },
        done: function (r) {
          App.render();
          var newer = App.txs.length - r.d.transactions.length;
          UI.toast('It opened: ' + r.d.transactions.length + ' transactions from ' + r.d.savedAt.slice(0, 10) + '. Your passphrase works.' +
            (newer > 0 ? ' ' + newer + ' transactions here are newer than that snapshot; save a new one.' : '') + (r.missing ? ' (' + r.missing + ' in the snapshot were later deleted here.)' : ''));
        } });
    }).catch(function (e) { if (e && e.name === 'AbortError') return; UI.toast('Could not test: ' + e.message); });
  }

  /* ---------- locked backup files ---------- */
  function needPass(msg) { var e = new Error(msg || 'These backups are locked. Type your snapshot passphrase to open them.'); e.code = 'NEED_PASS'; return e; }
  function backupLockOn() { return !!cfgShare(); }
  function backupKey() { return sessionKey(); }
  function isLocked(text) { return Vault.isLocked(text); }
  function saltOf(text) { try { var f = Vault.inspect(text); return f.hd ? f.hd.kdf.salt : null; } catch (e) { return null; } }
  function needSetup() { var e = new Error('Set a passphrase first: every budget file is locked with one (Settings > Backup & sharing > Shared snapshot).'); e.code = 'NEED_SETUP'; return e; }
  /* Backup object -> file text, always locked; with no passphrase set, nothing is written. */
  function encodeBackup(obj) {
    if (!backupLockOn()) return Promise.reject(needSetup());
    var k = backupKey(), s = cfgShare();
    if (!k) return Promise.reject(needPass('Backups are locked with your passphrase, and this browser does not know it yet. Type it once to resume.'));
    return lock(obj, k, s.salt, s.iter);
  }
  /* File text -> backup object. Locked files open with a known key, or with pass when given. */
  function openText(text, pass) { return openFile(text, pass || null); }
  /* After a restore: if the passphrase that opened the files belongs to the restored budget, remember its key. */
  function adoptKey() {
    var s = cfgShare(); if (!s || keyFor(s.salt)) return Promise.resolve();
    var k = viewKeys[s.salt + ':' + s.iter];
    return k ? remember(s.salt, s.iter, k) : Promise.resolve();
  }
  /* Runs fn(null); if it needs the passphrase, asks for it and runs fn(pass). Resolves with fn's result. */
  function withPass(fn, o) {
    o = o || {};
    return Promise.resolve().then(function () { return fn(null); }).catch(function (e) {
      if (!e || e.code !== 'NEED_PASS') throw e;
      return new Promise(function (ok) {
        askPass({ title: o.title || 'Type your passphrase', verb: o.verb || 'Open', intro: e.message + ' It is the snapshot passphrase on your printed sheet.', run: fn, done: ok });
      });
    });
  }
  /* User-started actions that must write a locked file: make sure the key is known first. */
  function ensureKey(why) {
    if (!backupLockOn()) return Promise.reject(needSetup());
    if (backupKey()) return Promise.resolve();
    return new Promise(function (ok) {
      askPass({ title: 'Type your passphrase', verb: 'Unlock and continue', intro: why || 'Backup files are locked with your snapshot passphrase. Type it once so a locked safety copy can be kept first.', run: unlockEditor, done: function () { ok(); } });
    });
  }

  /* ---------- viewer mode ---------- */
  function isViewer() { return !!view; }
  function enter(d, src, preview) {
    view = { savedAt: d.savedAt, name: src, preview: !!preview, data: d };
    App.readOnly = true; DB.setReadOnly(true);
    App.cfg = M.migrate(d.config); App.txs = d.transactions; App.month = null;
    document.body.classList.add('readonly');
    if (!preview) { mode = 'viewer'; DB.setMeta('mode', 'viewer').catch(function () {}); }
    armIdle();
    location.hash = '#/home'; App.render();
  }
  function lockView() {
    if (!view) return;
    if (view.preview) { location.hash = '#/backup'; location.reload(); return; }
    view = null; viewKeys = {}; App.cfg = null; App.txs = []; App.readOnly = false;
    document.body.classList.remove('readonly'); clearTimeout(idleTimer);
    UI.closePanel(); App.render();
  }
  function armIdle() { clearTimeout(idleTimer); if (view && !view.preview) idleTimer = setTimeout(function () { lockView(); }, IDLE_MS); }
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (ev) { window.addEventListener(ev, function () { if (view) armIdle(); }, { passive: true }); });

  function banner() {
    if (!view) return null;
    var d = new Date(view.savedAt);
    var when = U.dayLabel(localDate(d)) + ', ' + d.getFullYear() + ' at ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    var age = Math.floor((Date.now() - d) / 864e5);
    return h('div', { class: 'ro-banner', role: 'status' },
      h('span', null, h('strong', null, view.preview ? 'Preview: ' : ''), 'Read-only snapshot from ' + when + (age >= 7 ? ' (' + age + ' days old)' : '')),
      h('span', { class: 'row' },
        !view.preview ? h('button', { type: 'button', class: 'btn', onclick: function () { openNewest(true); } }, 'Open newer snapshot') : null,
        h('button', { type: 'button', class: 'btn', onclick: lockView }, view.preview ? 'Leave preview' : 'Lock')));
  }
  /* Read-only details of one transaction (where the editor would open the edit panel). */
  function detail(t) {
    UI.openPanel(function (p) {
      var c = M.catMap(App.cfg)[t.categoryId], trip = t.tripId ? (App.cfg.trips || []).filter(function (x) { return x.id === t.tripId; })[0] : null;
      p.appendChild(UI.panelHead(t.desc || (c ? c.name : 'Transaction'), 'Read-only'));
      var rows = [['Amount', U.money(t.amount, { cents: true })], ['Date', U.dayLabel(t.date) + ', ' + t.date.slice(0, 4)], ['Category', c ? c.name : 'Needs a category'],
        ['Account', t.source === 'excel' ? 'Excel history' : (UI.acctName(t) || 'Added by hand')], trip ? ['Trip', trip.name] : null, t.note ? ['Note', t.note] : null,
        t.expr ? ['Typed as', t.expr] : null, t.needsTag ? ['Waiting for review', t.reviewReason || 'Yes'] : null].filter(Boolean);
      var box = h('div', { class: 'card' });
      rows.forEach(function (r) { box.appendChild(h('div', { class: 'list-row', style: { padding: '10px 16px' } }, h('span', { class: 'muted' }, r[0]), h('span', { class: 'strong', style: { textAlign: 'right' } }, r[1]))); });
      p.appendChild(box);
      p.appendChild(h('p', { class: 'small muted', style: { margin: 0 } }, 'This is a read-only copy. Changes are made on the main budget computer.'));
    }, { label: 'Transaction details' });
  }

  /* Opening screen for viewing (no budget in this browser, or chosen from the welcome screen). */
  var openState = { file: null, msg: '', busy: false, pass: '', show: false };
  function openNewest(fromBanner) {
    var src = viewDir ? newestFrom(viewDir, false) : pickFile();
    return src.then(function (f) {
      if (fromBanner) {
        return openFile(f.text, null).then(function (d) { enter(d, f.name); UI.toast('Opened ' + f.name + '.'); }, function () { lockView(); openState.file = f; App.render(); });
      }
      openState.file = f; openState.msg = ''; App.render();
    }).catch(function (e) { if (e && e.name === 'AbortError') return; openState.msg = e.message; if (!view) App.render(); else UI.toast(e.message); });
  }
  function openScreen(main) {
    var st = openState;
    main.appendChild(h('div', { class: 'stack', style: { maxWidth: '620px' } },
      h('h1', null, 'Open the shared budget'),
      h('p', null, 'This opens a locked snapshot of the budget to look at. Nothing can be changed, nothing is kept in this browser, and it locks itself after 15 minutes without use.'),
      h('div', { class: 'card pad stack' },
        h('h2', null, '1. Choose the snapshot'),
        viewDir ? h('div', null, 'Shared folder: ', h('strong', null, viewDir.name), '. The newest snapshot in it is used.') : null,
        h('div', { class: 'row' },
          supported ? h('button', { type: 'button', class: viewDir ? 'btn' : 'btn primary', onclick: function () {
            window.showDirectoryPicker({ id: 'budget-shared-view', mode: 'read' }).then(function (d) { viewDir = d; return DB.setMeta('viewDir', d); }).then(function () { return openNewest(); })
              .catch(function (e) { if (e && e.name === 'AbortError') return; st.msg = e.message; App.render(); });
          } }, viewDir ? 'Choose a different folder' : 'Choose the shared folder') : null,
          viewDir ? h('button', { type: 'button', class: 'btn primary', onclick: function () { openNewest(); } }, 'Use the newest snapshot') : null,
          h('button', { type: 'button', class: 'btn', onclick: function () { pickFile().then(function (f) { st.file = f; st.msg = ''; App.render(); }).catch(function (e) { if (e.name !== 'AbortError') { st.msg = e.message; App.render(); } }); } }, 'Choose one file')),
        st.file ? h('div', { class: 'ok strong' }, 'Chosen: ' + st.file.name + (st.file.count > 1 ? ' (newest of ' + st.file.count + ')' : '')) : null),
      st.file ? passCard() : null,
      st.msg && !st.file ? h('div', { class: 'small red', role: 'alert' }, st.msg) : null,
      h('button', { type: 'button', class: 'btn link', style: { alignSelf: 'flex-start' }, onclick: function () { mode = null; openState = { file: null, msg: '', busy: false, pass: '', show: false }; DB.setMeta('mode', null).catch(function () {}); App.render(); } },
        mode === 'viewer' ? 'Set up this browser as the main budget instead' : 'Back')));
    function passCard() {
      var msg = h('div', { class: 'small red', role: 'alert' }, st.msg);
      var c = h('div', { class: 'card pad stack' }, h('h2', null, '2. Type the passphrase'),
        h('div', { class: 'field' }, h('label', { for: 'vp' }, 'Passphrase (on the printed sheet)'),
          h('input', { id: 'vp', class: 'input', type: st.show ? 'text' : 'password', autocomplete: 'off', spellcheck: 'false', value: st.pass, oninput: function (e) { st.pass = e.target.value; msg.textContent = ''; }, onkeydown: function (e) { if (e.key === 'Enter') go(); } }),
          msg, h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: st.show, onchange: function (e) { st.show = e.target.checked; App.render(); } }), h('span', null, 'Show what I type'))),
        h('button', { type: 'button', class: 'btn primary', style: { alignSelf: 'flex-start' }, disabled: st.busy, onclick: go }, st.busy ? 'Opening…' : 'Open'));
      setTimeout(function () { var f = document.getElementById('vp'); if (f && document.activeElement !== f) f.focus(); });
      return c;
    }
    function go() {
      if (!st.pass) { st.msg = 'Type the passphrase.'; return App.render(); }
      try { parse(st.file.text); } catch (e) { st.msg = e.message; return App.render(); }
      st.busy = true; App.render();
      openFile(st.file.text, st.pass).then(function (d) { var name = st.file.name; openState = { file: null, msg: '', busy: false, pass: '', show: false }; enter(d, name); })
        .catch(function (e) { st.busy = false; st.msg = e.message; App.render(); });
    }
  }
  function wantsOpenScreen() { return !view && (openState.screen || (!App.cfg && mode === 'viewer')); }
  function showOpen() { openState.screen = true; App.render(); }

  /* Preview from Settings: the newest snapshot as the viewer would see it. */
  function previewFlow() {
    var src = dir ? newestFrom(dir, true) : pickFile();
    src.then(function (f) {
      parse(f.text);
      function go(d) { enter(d, f.name, true); }
      openFile(f.text, null).then(go, function (e) {
        if (e.code !== 'NEED_PASS' && e.code !== 'WRONG_PASS') throw e;
        askPass({ title: 'Preview the read-only view', verb: 'Open preview', sub: f.name, run: function (pass) { return openFile(f.text, pass); }, done: go });
      }).catch(function (e) { UI.toast('Could not open a snapshot: ' + e.message); });
    }).catch(function (e) { if (e && e.name === 'AbortError') return; UI.toast('Could not open a snapshot: ' + e.message); });
  }

  /* Disaster recovery: turn the open snapshot into this browser's budget. */
  function makeMain() {
    if (!view || view.preview) return;
    var d = view.data;
    App.readOnly = false; DB.setReadOnly(false);
    // load whatever this browser already holds, so a safety copy of it is kept before it is replaced
    UI.reload().then(function () { return App.cfg ? Safety.snapshot('restore') : null; })
      .then(function () { return DB.replaceAll(d.config, d.transactions); })
      .then(function () { return DB.setMeta('mode', null); })
      .then(function () {
        view = null; mode = null; viewKeys = {}; clearTimeout(idleTimer); document.body.classList.remove('readonly');
        return UI.reload();
      }).then(adoptKey).then(function () { App.hasLocalBudget = true; DB.persist(); location.hash = '#/settings'; App.render(); UI.toast('This browser now holds the budget (' + d.transactions.length + ' transactions). Turn on automatic backups below.'); })
      .catch(function (e) { App.readOnly = true; DB.setReadOnly(true); App.cfg = d.config; App.txs = d.transactions; App.render(); UI.toast('Could not copy the snapshot: ' + e.message); });
  }
  /* Bottom of Home in the viewer: for when the main computer is lost. Named confirmation, nothing happens by accident. */
  var confirmMain = false;
  function viewerFooter() {
    if (!view || view.preview) return null;
    var s = h('section', { class: 'card pad stack', 'aria-label': 'Main computer lost' }, h('h2', null, 'Main budget computer lost or broken?'),
      h('p', { class: 'muted', style: { margin: 0 } }, 'This snapshot holds the whole budget. You can make it the main, editable copy in this browser.'));
    if (!confirmMain) s.appendChild(h('button', { type: 'button', class: 'btn', style: { alignSelf: 'flex-start' }, onclick: function () { confirmMain = true; App.render(); } }, 'Make this the main copy…'));
    else s.appendChild(h('div', { class: 'toast warn', role: 'alert' }, h('span', null, 'Make this browser the main budget with the ' + d0() + ' snapshot (' + view.data.transactions.length + ' transactions)? Only do this if the main computer is gone, or two copies will drift apart.'),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn danger', onclick: function () { confirmMain = false; makeMain(); } }, 'Make this the main copy'), h('button', { type: 'button', class: 'btn', onclick: function () { confirmMain = false; App.render(); } }, 'Keep it read-only'))));
    return s;
    function d0() { return view.savedAt.slice(0, 10); }
  }

  /* ---------- passphrase ideas ---------- */
  var WORDS = ('acorn actor adobe agent alarm album alley amber anchor angle ankle apple apron arena arrow aspen atlas attic autumn avocado badge bagel baker bamboo banjo barley barn basin basket beach beacon beaver berry bicycle birch biscuit blanket blossom border bottle boulder branch breeze brick bridge brook broom bucket buffalo bundle butter button cabin cactus camel candle canoe canyon carpet carrot castle cedar cello chalk cherry chimney cider cinema circle citrus clover cobalt coconut comet compass copper coral cotton cougar cradle crane crayon cricket crystal cupcake curtain daisy dancer delta desert diamond dinner dolphin donkey dragon drawer dream drum eagle easel echo elbow ember engine falcon feather fern ferry fiddle field fig finch fjord flute forest fossil fountain fox galaxy garden garlic gate gecko geyser ginger glacier globe goose granite grape gravel guitar hammock harbor harvest hazel helmet heron hickory hollow honey horizon hummus igloo island ivory jacket jaguar jasmine jelly jigsaw journal juniper kayak kettle kiwi koala ladder lagoon lantern laptop lemon lilac lily linen lobster locket lotus lumber magnet mango maple marble meadow melon meteor mint mitten monsoon mosaic moss muffin mural napkin nectar needle nest nickel noodle nutmeg oasis oatmeal ocean olive onion orbit orchard otter owl paddle palace panda paper parrot pasta peach pebble pelican pencil pepper piano pickle pillow pine pirate planet plum pocket pony poppy prairie pretzel pumpkin puzzle quartz quill quilt rabbit radar radish raft rain raven reef ribbon river robin rocket rose ruby saddle saffron salmon sandal satin scarf shadow shell signal silver sketch sled snail sparrow spice spider spoon spruce squash stable statue stone storm sugar summit sunset swan tablet teapot temple thistle thunder tiger timber toast tomato topaz torch tortoise trail tulip tunnel turnip umbrella valley vanilla velvet violin volcano wagon walnut walrus waffle whale willow window winter wizard yogurt zebra zephyr').split(' ');
  function idea() {
    var out = [], a = new Uint32Array(6); crypto.getRandomValues(a);
    for (var i = 0; i < 6; i++) out.push(WORDS[a[i] % WORDS.length]);
    return out.join(' ');
  }
  function strength(p) {
    var words = p.trim().split(/\s+/).filter(Boolean).length;
    if (p !== p.trim()) return { ok: false, text: 'Take out the space at the start or end: it is too easy to miss when typing it later.' };
    if (p.length < 12) return { ok: false, text: 'Use at least 12 characters; 5 or 6 everyday words is easiest to type and remember.' };
    if (words < 4 && p.length < 16) return { ok: false, text: 'A little short: use 16 or more characters, or at least 4 words.' };
    return { ok: true, text: 'Strong enough.' };
  }

  /* ---------- Settings section ---------- */
  var setup = { open: false, pass: '', pass2: '', show: false, msg: '' };
  function settingsSection() {
    var s = h('section', { class: 'card pad stack', 'aria-label': 'Shared snapshot' }, h('h2', null, 'Shared snapshot (read-only copy)'),
      h('p', { class: 'muted', style: { margin: 0 } }, 'A locked copy of the whole budget for your shared Google Drive or iCloud folder. It opens only with the passphrase, read-only, in this app on any computer. It is also an off-site backup: if this computer is lost, a snapshot can become the main copy again. The newest 3 are kept.'));
    var sh = cfgShare();
    if (!sh || setup.open) { s.appendChild(passForm(!!sh)); return s; }

    var last = sh.lastSnapshot, test = sh.lastTest, unlocked = !!sessionKey();
    var lines = h('div', { class: 'stack-sm' },
      h('div', null, h('span', { class: 'muted' }, 'Passphrase: '), 'set ' + sh.setAt.slice(0, 10) + (unlocked ? ' · remembered in this browser' : ' · ') ,
        unlocked ? ' · ' : h('span', { class: 'amber strong' }, 'type it once to resume locked backups · '),
        sh.printedAt ? 'sheet printed ' + sh.printedAt.slice(0, 10) : h('span', { class: 'amber strong' }, 'recovery sheet not printed yet')),
      h('div', null, h('span', { class: 'muted' }, 'Shared folder: '), dir ? '"' + dir.name + '"' + (dirPerm !== 'granted' ? ' (the browser asks again when you save)' : '') : 'none: snapshots are downloaded and you move them to the shared folder'),
      h('div', null, h('span', { class: 'muted' }, 'Latest snapshot: '), last ? last.at.slice(0, 16).replace('T', ' ') + ' · ' + last.tx + ' transactions' + (App.txs.length !== last.tx ? ' (' + App.txs.length + ' here now)' : '') : 'none yet'),
      h('div', null, h('span', { class: 'muted' }, 'Last restore test: '), test ? test.at.slice(0, 10) + ' · opened ' + test.tx + ' transactions' : h('span', { class: 'amber strong' }, 'never')));
    s.appendChild(lines);
    s.appendChild(h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn primary', onclick: saveFlow }, 'Save a snapshot now'),
      supported ? h('button', { type: 'button', class: 'btn', onclick: function () { chooseFolder().then(function () { App.render(); UI.toast('Snapshots now go to "' + dir.name + '".'); }).catch(function (e) { if (e && e.name !== 'AbortError') UI.toast(e.message); }); } }, dir ? 'Use a different shared folder' : 'Choose the shared folder') : null,
      dir ? h('button', { type: 'button', class: 'btn link', onclick: function () { forgetFolder().then(App.render); } }, 'Stop using this folder') : null));
    s.appendChild(h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn', onclick: testFlow }, 'Test opening a snapshot'),
      h('button', { type: 'button', class: 'btn', onclick: previewFlow }, 'Preview the read-only view'),
      h('button', { type: 'button', class: 'btn', onclick: function () {
        askPass({ title: 'Print the passphrase sheet', verb: 'Print', intro: 'Type the passphrase so the sheet shows exactly what works. Keep the printout at home, never in the shared folder.',
          run: function (pass) { return unlockEditor(pass).then(function () { return pass; }); },
          done: function (pass) { App.cfg.share.printedAt = new Date().toISOString(); UI.saveCfg().then(App.render); printSheet(pass); } });
      } }, 'Print passphrase sheet'),
      h('button', { type: 'button', class: 'btn link', onclick: function () { withKey('Change passphrase', 'Unlock', function () { setup = { open: true, pass: '', pass2: '', show: false, msg: '' }; App.render(); }); } }, 'Change passphrase')));
    if (dir && dirPerm === 'granted' && dir.values) {
      var files = h('div', { class: 'small muted' }, 'Reading the shared folder…');
      listIn(dir).then(function (list) { files.textContent = list.length ? 'In the shared folder: ' + list.map(function (f) { return f.name; }).join(', ') : 'No snapshots in the shared folder yet.'; }).catch(function () { files.textContent = ''; });
      s.appendChild(files);
    }
    return s;
  }
  function passForm(changing) {
    var st = setup;
    var box = h('div', { class: 'stack' });
    if (changing) box.appendChild(h('div', { class: 'toast warn' }, DB.inMemory() ? 'After changing it, print a new sheet. Files you saved before still open only with the old passphrase; the next file you save uses the new one.'
      : 'After changing it, print a new sheet. Backup files in your backup folder are re-locked with the new passphrase; snapshots already in the shared folder still open only with the old one until newer ones replace them.'));
    var verdict = strength(st.pass);
    var p1 = h('input', { id: 'np1', class: 'input', type: st.show ? 'text' : 'password', autocomplete: 'new-password', spellcheck: 'false', value: st.pass,
      oninput: function (e) { st.pass = e.target.value; st.msg = ''; var v = strength(st.pass); hint.textContent = st.pass ? v.text : ''; hint.className = 'small ' + (v.ok ? 'ok' : 'muted'); } });
    var hint = h('div', { class: 'small ' + (verdict.ok ? 'ok' : 'muted'), 'aria-live': 'polite' }, st.pass ? verdict.text : 'Five or six everyday words with spaces work well, for example "maple kettle orbit…". Avoid names, dates and anything about the budget.');
    var p2 = h('input', { id: 'np2', class: 'input', type: st.show ? 'text' : 'password', autocomplete: 'new-password', spellcheck: 'false', value: st.pass2, oninput: function (e) { st.pass2 = e.target.value; st.msg = ''; }, onkeydown: function (e) { if (e.key === 'Enter') go(); } });
    box.appendChild(h('div', { class: 'field' }, h('label', { for: 'np1' }, changing ? 'New passphrase' : 'Choose a passphrase'), p1, hint));
    box.appendChild(h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn', onclick: function () { st.pass = st.pass2 = idea(); st.show = true; st.msg = ''; App.render(); } }, 'Suggest one'),
      h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: st.show, onchange: function (e) { st.show = e.target.checked; App.render(); } }), h('span', null, 'Show what I type'))));
    box.appendChild(h('div', { class: 'field' }, h('label', { for: 'np2' }, 'Type it again'), p2));
    if (st.msg) box.appendChild(h('div', { class: 'small red', role: 'alert' }, st.msg));
    box.appendChild(h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn primary', onclick: go }, changing ? 'Change passphrase' : 'Set passphrase'),
      changing ? h('button', { type: 'button', class: 'btn', onclick: function () { setup.open = false; App.render(); } }, 'Keep the current one') : null));
    function go() {
      var v = strength(st.pass);
      if (!v.ok) { st.msg = v.text; return App.render(); }
      if (st.pass !== st.pass2) { st.msg = 'The two passphrases are different. Type the same one twice.'; return App.render(); }
      var pass = st.pass;
      setPassphrase(pass).then(function (n) {
        setup = { open: false, pass: '', pass2: '', show: false, msg: '' };
        App.render(); UI.toast((changing ? 'Passphrase changed.' : 'Passphrase set.') + (n ? ' ' + n + ' backup file' + (n === 1 ? ' was' : 's were') + ' locked with it.' : '') + ' Next: print the sheet' + (changing ? '.' : ', choose the shared folder, then save a snapshot.'));
      }).catch(function (e) { st.msg = 'Could not set it: ' + e.message; App.render(); });
    }
    return box;
  }

  /* ---------- Home reminders (main copy only) ---------- */
  function homeNotes() {
    var sh = cfgShare(), out = [];
    if (!sh || view || DB.inMemory()) return out;   // working from a file: the file itself is the copy
    var last = sh.lastSnapshot, now = Date.now();
    var changed = App.txs.reduce(function (m, t) { var x = t.updatedAt || t.createdAt || ''; return x > m ? x : m; }, '');
    if (!last) out.push(note('No shared snapshot yet. Save one so the read-only copy is ready.', 'Save a snapshot', saveFlow));
    else if ((now - new Date(last.at)) / 864e5 >= 7 && (changed > last.at || App.txs.length !== last.tx)) out.push(note('The shared snapshot is from ' + U.shortDate(last.at.slice(0, 10)) + ' and the budget has changed since.', 'Update it', saveFlow));
    if (last && (!sh.lastTest || (now - new Date(sh.lastTest.at)) / 864e5 >= 30)) out.push(note('Monthly check: make sure the latest snapshot opens with your passphrase.', 'Test a restore', testFlow));
    return out;
    function note(text, verb, fn) { return h('div', { class: 'notice row between' }, h('span', null, text), h('button', { type: 'button', class: 'btn', onclick: fn }, verb)); }
  }

  return { load: load, isViewer: isViewer, banner: banner, detail: detail, viewerFooter: viewerFooter, openScreen: openScreen, wantsOpenScreen: wantsOpenScreen, showOpen: showOpen, lock: lockView, makeMain: makeMain,
    settingsSection: settingsSection, homeNotes: homeNotes, backupLockOn: backupLockOn, backupKey: backupKey, isLocked: isLocked, saltOf: saltOf, encodeBackup: encodeBackup, openText: openText, adoptKey: adoptKey, withPass: withPass, ensureKey: ensureKey, withKey: withKey, unlockEditor: unlockEditor, saveFlow: saveFlow, testFlow: testFlow,
    openFile: openFile, needSetup: needSetup, useKey: useKey, forgetKeys: forgetKeys, record: record, askPass: askPass, strength: strength, idea: idea, sessionKey: sessionKey, settingsPassForm: passForm, _lock: lock, _parse: parse, _derive: derive, _idea: idea, _setPassphrase: setPassphrase, _save: save, _unlockEditor: unlockEditor, _strength: strength };
})();
