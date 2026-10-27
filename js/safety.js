/* Fail-safes against losing data:
   1. Automatic backup files in a folder you choose on this computer, rewritten a few seconds after every change
      (latest + one per day, last 30 days kept). Clearing browser data cannot touch them.
   2. A safety copy written just before anything risky (erase, restore, removing Excel history, undoing an import).
   3. On start-up, a check that the data here is not smaller than your latest backup; if it is, you are offered a restore.
   4. A warning before closing the tab while something is being saved or typed but not saved.
   5. Other open tabs of the app refresh when this one changes, so two tabs never overwrite each other.
   6. Every backup file is a locked budget file (js/vault.js), so the folder can sit inside Google Drive or iCloud; with no
      passphrase set, nothing is written until one is. Plain files from older versions are locked when found.
   Names: budget-latest.budget, budget-backup-YYYY-MM-DD.budget, budget-before-….budget (older .json ones still read).
   Only standard browser features are used; nothing leaves the computer. */
var Safety = (function () {
  'use strict';
  var KEY = 'backupDir', handle = null, perm = 'none', timer = null, writing = false, lastWrite = null, lastError = '', pending = 0, guards = {};
  var bc = typeof BroadcastChannel === 'function' ? new BroadcastChannel('household-budget') : null;
  var supported = typeof window.showDirectoryPicker === 'function';
  var KEEP_DAYS = 30;

  /* ---------- folder handle (kept in IndexedDB; the folder itself is outside the browser) ---------- */
  function loadHandle() {
    return DB.getMeta(KEY).then(function (hd) { handle = hd || null; return checkPerm(false); }).catch(function () { handle = null; perm = 'none'; });
  }
  function checkPerm(ask) {
    if (!handle) { perm = 'none'; return Promise.resolve(perm); }
    if (!handle.queryPermission) { perm = 'granted'; return Promise.resolve(perm); }
    var opts = { mode: 'readwrite' };
    return handle.queryPermission(opts).then(function (p) {
      if (p === 'granted' || !ask) { perm = p; return p; }
      return handle.requestPermission(opts).then(function (p2) { perm = p2; return p2; });
    }).catch(function () { perm = 'denied'; return perm; });
  }
  function connect() {
    if (!supported) return Promise.reject(new Error('This browser cannot save to a folder automatically. Use Chrome or Edge.'));
    return window.showDirectoryPicker({ id: 'budget-backups', mode: 'readwrite', startIn: 'documents' }).then(function (hd) {
      handle = hd; perm = 'granted';
      return DB.setMeta(KEY, hd);
    }).then(function () { return writeNow('connected'); }).then(lockFolder);
  }
  function reconnect() { return checkPerm(true).then(function (p) { if (p === 'granted') return writeNow('reconnected').then(function () { return integrity(); }); return null; }); }
  function disconnect() { handle = null; perm = 'none'; return DB.setMeta(KEY, null); }

  /* ---------- writing ---------- */
  function snapshotData() {
    return { app: 'household-budget', version: 1, savedAt: new Date().toISOString(), counts: { transactions: App.txs.length, categories: (App.cfg && App.cfg.categories || []).length }, config: App.cfg, transactions: App.txs };
  }
  function writeFile(dir, name, text) {
    return dir.getFileHandle(name, { create: true }).then(function (fh) { return fh.createWritable(); }).then(function (w) { return w.write(text).then(function () { return w.close(); }); });
  }
  function needKey() { return Share.backupLockOn() && !Share.backupKey(); }
  function needSetup() { return !Share.backupLockOn(); }
  var NAMES = /^budget-.*\.(budget|json)$/;
  /* latest first: budget-latest (.budget, then an older .json), then dated copies newest first, then safety copies */
  function dateOf(n) { var m = n.match(/(\d{4}-\d{2}-\d{2}(?:T[\d-]+)?)/); return m ? m[1] : ''; }
  function newestFirst(a, b) { var da = dateOf(a), db = dateOf(b); return da !== db ? (da < db ? 1 : -1) : (/\.budget$/.test(a) ? -1 : 1); }
  function readLatest(dir) { return readJson(dir, 'budget-latest.budget').catch(function () { return readJson(dir, 'budget-latest.json'); }); }
  function writeNow(reason) {
    if (!handle || perm !== 'granted' || !App.cfg) return Promise.resolve(false);
    if (needSetup()) { lastError = 'Paused until a passphrase is set: every backup is locked with it.'; notify(); return Promise.resolve(false); }
    if (writing) { schedule(); return Promise.resolve(false); }
    if (warning && reason !== 'manual') return Promise.resolve(false);   // possible data loss: never overwrite good backups until you decide
    writing = true;
    var day = U.today(), now = App.txs.length;
    return Share.encodeBackup(snapshotData()).then(function (text) {
      // if the data shrank a lot since the last backup, keep that older backup (exactly as it was) under its own name first
      var keepOld = readLatest(handle).then(function (old) {
        var was = old.transactions.length;
        if (was - now >= Math.max(5, was * 0.05)) return writeFile(handle, 'budget-before-shrink-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + (Share.isLocked(old._raw) ? '.budget' : '.json'), old._raw);
      }).catch(function () {});
      // then the dated copy, then "latest", so a crash mid-write never leaves you with no good file
      return keepOld.then(function () { return writeFile(handle, 'budget-backup-' + day + '.budget', text); })
        .then(function () { return writeFile(handle, 'budget-latest.budget', text); })
        .then(prune);
    }).then(function () { writing = false; lastWrite = new Date(); lastError = ''; notify(); if (!lockedOnce) { lockedOnce = true; lockFolder(); } return true; })
      .catch(function (e) { writing = false; lastError = e.message || String(e); if (/permission|not allowed|denied/i.test(lastError)) perm = 'prompt'; notify(); return false; });
  }
  /* Locks every plain backup file in the folder, and re-locks files made with an older passphrase. Returns how many. */
  var lockedOnce = false;
  function lockFolder() {
    if (!handle || perm !== 'granted' || !handle.values || !App.cfg || !Share.backupLockOn() || !Share.backupKey()) return Promise.resolve(0);
    var cur = App.cfg.share.salt, n = 0;
    return listNames(handle, NAMES).then(function (names) {
      return names.reduce(function (chain, name) {
        return chain.then(function () {
          return readRaw(handle, name).then(function (raw) {
            if (Share.isLocked(raw) && Share.saltOf(raw) === cur) return;
            return Share.openText(raw).then(function (d) {
              if (!d || d.app !== 'household-budget' || !d.config || !Array.isArray(d.transactions)) return;
              if (!d.savedAt) d.savedAt = new Date(0).toISOString();
              return Share.encodeBackup(d).then(function (t) { return writeFile(handle, name, t); }).then(function () { n++; });
            });
          }).catch(function () {});   // a file that cannot be opened (another passphrase) is left as it is
        });
      }, Promise.resolve());
    }).then(function () { return n; });
  }
  function listNames(dir, re) {
    var names = [], it = dir.values();
    function next() { return it.next().then(function (r) { if (r.done) return; if (r.value.kind === 'file' && re.test(r.value.name)) names.push(r.value.name); return next(); }); }
    return next().then(function () { return names; });
  }
  function prune() {
    if (!handle.values) return Promise.resolve();
    var names = [];
    var it = handle.values();
    function next() {
      return it.next().then(function (r) { if (r.done) return; if (r.value.kind === 'file' && /^budget-backup-\d{4}-\d{2}-\d{2}\.(budget|json)$/.test(r.value.name)) names.push(r.value.name); return next(); });
    }
    return next().then(function () {
      names.sort(newestFirst);
      var old = names.slice(KEEP_DAYS);   // the newest 30 dated copies stay, whatever their extension
      return Promise.all(old.map(function (n) { return handle.removeEntry(n).catch(function () {}); }));
    });
  }
  /* Called after every saved change: waits for a quiet moment, then writes. */
  function schedule() {
    if (bc) try { bc.postMessage({ type: 'changed', at: Date.now() }); } catch (e) {}
    if (!handle || perm !== 'granted' || needKey() || needSetup()) return;
    clearTimeout(timer);
    timer = setTimeout(function () { writeNow('change'); }, 3000);
  }
  /* A copy just before something risky. Written to the folder; if there is no folder, downloaded instead. */
  function snapshot(reason) {
    if (!App.cfg || needSetup() || DB.inMemory()) return Promise.resolve(null);   // working from a file: your saved files are the copies   // nothing unlocked is ever written; the action itself still asks first
    var stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19), name = 'budget-before-' + reason + '-' + stamp + '.budget';
    return Share.ensureKey().then(function () { return Share.encodeBackup(snapshotData()); }).then(function (text) {
      if (handle && perm === 'granted') return writeFile(handle, name, text).then(function () { return name; }).catch(function () { U.download(name, text, 'application/octet-stream'); return name; });
      if (App.txs.length) U.download(name, text, 'application/octet-stream');
      return name;
    });
  }

  /* ---------- reading back ---------- */
  function readRaw(dir, name) { return dir.getFileHandle(name).then(function (fh) { return fh.getFile(); }).then(function (f) { return f.text(); }); }
  /* Plain or locked; pass is only needed for a locked file this browser has no key for. */
  function readJson(dir, name, pass) {
    return readRaw(dir, name).then(function (raw) {
      return Share.openText(raw, pass).then(function (d) {
        if (!d || d.app !== 'household-budget' || !d.config || !Array.isArray(d.transactions)) throw new Error('not a backup');
        d._name = name; d._raw = raw; return d;
      });
    });
  }
  /* Newest good backup in a folder (latest, then dated copies newest first). */
  function newestIn(dir, pass) {
    var names = [];
    var it = dir.values();
    function next() { return it.next().then(function (r) { if (r.done) return; if (r.value.kind === 'file' && NAMES.test(r.value.name)) names.push(r.value.name); return next(); }); }
    return next().then(function () {
      var order = ['budget-latest.budget', 'budget-latest.json'].concat(names.filter(function (n) { return /^budget-backup-/.test(n); }).sort(newestFirst)).concat(names.filter(function (n) { return /^budget-before-/.test(n); }).sort(newestFirst));
      order = order.filter(function (n, i) { return names.indexOf(n) >= 0 && order.indexOf(n) === i; });
      var chain = Promise.reject(new Error('No backup files found in this folder.')), locked = null, wrong = null;
      function note(e) { if (e && e.code === 'NEED_PASS') locked = e; else if (e && /WRONG_PASS/.test(e.code || '')) wrong = e; }
      order.forEach(function (n) { chain = chain.catch(function (e) { note(e); return readJson(dir, n, pass); }); });
      // nothing opened: say why (locked, wrong passphrase) rather than "no backups"
      return chain.catch(function (e) { note(e); throw wrong || locked || e; });
    });
  }
  function pickAndFindNewest() {
    if (!supported) return Promise.reject(new Error('Choose the backup file with "Restore from a backup file" instead.'));
    return window.showDirectoryPicker({ id: 'budget-backups', mode: 'readwrite', startIn: 'documents' }).then(function (dir) {
      return Share.withPass(function (pass) { return newestIn(dir, pass); }, { title: 'Open your locked backups', verb: 'Open backups' }).then(function (d) { d._dir = dir; return d; });
    });
  }
  function restore(d) {
    return snapshot('restore').then(function () { return DB.replaceAll(d.config, d.transactions); }).then(function () {
      if (d._dir) { handle = d._dir; perm = 'granted'; return DB.setMeta(KEY, d._dir); }
    }).then(UI.reload).then(Share.adoptKey).then(function () { schedule(); return d.transactions.length; });
  }

  /* ---------- start-up check ---------- */
  var warning = null;
  function integrity() {
    warning = null;
    if (!handle || perm !== 'granted') return Promise.resolve(null);
    return readLatest(handle).then(function (d) {
      var here = App.txs.length, there = d.transactions.length;
      if (there > here + 0 && (here === 0 || there - here >= Math.max(5, there * 0.05))) {
        warning = { here: here, there: there, savedAt: d.savedAt, data: d };
      }
      return warning;
    }).catch(function () { return null; });
  }

  /* ---------- tabs and closing ---------- */
  if (bc) bc.onmessage = function (e) {
    if (!e.data || e.data.type !== 'changed') return;
    UI.reload().then(function () { if (!document.getElementById('layer').firstChild) App.render(); else App.staleNote = true; });
  };
  function guard(key, on) { if (on) guards[key] = true; else delete guards[key]; }
  function busy(delta) { pending = Math.max(0, pending + delta); }
  window.addEventListener('beforeunload', function (e) {
    if (pending > 0 || writing || timer && perm === 'granted' && !needKey() || Object.keys(guards).length) {
      if (timer && perm === 'granted') { clearTimeout(timer); timer = null; writeNow('closing'); }
      e.preventDefault(); e.returnValue = ''; return '';
    }
  });
  window.addEventListener('pagehide', function () { if (timer && perm === 'granted') { clearTimeout(timer); timer = null; writeNow('closing'); } });

  DB.onWrite(function () { busy(1); }, function (ok) { busy(-1); if (ok) schedule(); });

  function status() { return { locked: Share.backupLockOn(), needKey: needKey(), needSetup: needSetup(), supported: supported, connected: !!handle, perm: perm, name: handle ? handle.name : '', lastWrite: lastWrite, lastError: lastError, warning: warning }; }
  var listeners = [];
  function notify() { listeners.forEach(function (f) { try { f(status()); } catch (e) {} }); }
  function onStatus(f) { listeners.push(f); }

  /* Keep what is here: the larger backup is saved under its own name, then normal backups resume. */
  function dismissWarning() {
    var w = warning; warning = null;
    if (w && handle) return writeFile(handle, 'budget-before-shrink-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + (Share.isLocked(w.data._raw) ? '.budget' : '.json'), w.data._raw).then(function () { return writeNow('kept'); }).catch(function () {});
    return Promise.resolve();
  }

  return { lockFolder: lockFolder, folder: function () { return handle; }, dismissWarning: dismissWarning, loadHandle: loadHandle, connect: connect, reconnect: reconnect, disconnect: disconnect, writeNow: writeNow, schedule: schedule, snapshot: snapshot,
    pickAndFindNewest: pickAndFindNewest, restore: restore, integrity: integrity, status: status, onStatus: onStatus, guard: guard, busy: busy,
    _setHandle: function (hd) { handle = hd; perm = 'granted'; return DB.setMeta(KEY, hd).catch(function () {}); }, _newestIn: newestIn };
})();
