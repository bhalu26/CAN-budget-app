/* Local storage in this browser only (IndexedDB). Nothing is sent anywhere.
   Stores: "config" (one record: groups, categories, trips, income, rules, settings) and "tx" (transactions).
   "Work from a file" (js/workfile.js): useMemory() keeps config and transactions in this tab only, behind the same
   functions (and the same write hooks); IndexedDB then holds only housekeeping and the locked recovery copy ("meta"). */
var DB = (function () {
  'use strict';
  var NAME = 'household-budget', VERSION = 2, db = null, hooks = { start: [], end: [] }, readOnly = false;
  var RO = 'This is a read-only snapshot; nothing can be changed here.';
  function setReadOnly(on) { readOnly = !!on; }
  var mem = null;
  function clone(x) { return typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x)); }
  function useMemory(cfg, txs) { mem = cfg ? { cfg: clone(cfg), tx: new Map((txs || []).map(function (t) { return [t.id, clone(t)]; })) } : null; }
  function inMemory() { return !!mem; }
  /* a write in memory: same rules and hooks as a database write, done completely or not at all */
  function memWrite(fn) {
    if (readOnly) return Promise.reject(new Error(RO));
    fire('start');
    return Promise.resolve().then(function () {
      var next = { cfg: mem.cfg, tx: new Map(mem.tx) };
      fn(next); mem = next; fire('end', true);
    }).catch(function (e) { fire('end', false); throw e; });
  }
  function fire(k, ok) { hooks[k].forEach(function (f) { try { f(ok); } catch (e) {} }); }
  function onWrite(start, end) { hooks.start.push(start); hooks.end.push(end); }

  function open() {
    if (db) return Promise.resolve(db);
    return new Promise(function (ok, no) {
      var req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains('config')) d.createObjectStore('config');
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');   // housekeeping (backup folder link); kept by Erase
        if (!d.objectStoreNames.contains('tx')) {
          var s = d.createObjectStore('tx', { keyPath: 'id' });
          s.createIndex('date', 'date');
        }
      };
      req.onsuccess = function () { db = req.result; db.onversionchange = function () { db.close(); db = null; }; ok(db); };
      req.onblocked = function () { no(new Error('Another tab is updating the app. Close other tabs of the budget and reload.')); };
      req.onerror = function () { no(req.error); };
    });
  }
  /* Every write is one IndexedDB transaction: it is saved completely or not at all, even if the tab closes. */
  function run(store, mode, fn) {
    var w = mode === 'readwrite' && store !== 'meta';
    if (w && readOnly) return Promise.reject(new Error(RO));
    if (w) fire('start');
    return open().then(function (d) {
      return new Promise(function (ok, no) {
        var t = d.transaction(store, mode), s = t.objectStore(store), out;
        var r = fn(s);
        if (r && 'onsuccess' in r) r.onsuccess = function () { out = r.result; };
        t.oncomplete = function () { if (w) fire('end', true); ok(out); };
        t.onerror = function () { if (w) fire('end', false); no(t.error); };
        t.onabort = function () { if (w) fire('end', false); no(t.error || new Error('Saving was cancelled')); };
      });
    });
  }
  function multi(fn) {
    if (readOnly) return Promise.reject(new Error(RO));
    fire('start');
    return open().then(function (d) {
      return new Promise(function (ok, no) {
        var t = d.transaction(['config', 'tx'], 'readwrite');
        fn(t.objectStore('config'), t.objectStore('tx'));
        t.oncomplete = function () { fire('end', true); ok(); };
        t.onerror = function () { fire('end', false); no(t.error); };
        t.onabort = function () { fire('end', false); no(t.error || new Error('Saving was cancelled')); };
      });
    });
  }
  function getMeta(k) { return run('meta', 'readonly', function (s) { return s.get(k); }); }
  function metaKeys() { return run('meta', 'readonly', function (s) { return s.getAllKeys(); }).then(function (r) { return r || []; }); }
  function setMeta(k, v) { return run('meta', 'readwrite', function (s) { return v === null || v === undefined ? s.delete(k) : s.put(v, k); }); }
  /* Config and transactions together in one transaction (imports), so a crash cannot leave half an import. */
  var txHook = null;   // called with every list of lines about to be written (edit history); set by the app
  function setTxHook(f) { txHook = f; }
  function putAll(cfg, list) { if (txHook) txHook(list); if (mem) return memWrite(function (m) { m.cfg = clone(cfg); list.forEach(function (r) { m.tx.set(r.id, clone(r)); }); }); return multi(function (c, x) { c.put(cfg, 'main'); list.forEach(function (r) { x.put(r); }); }); }

  function getConfig() { if (mem) return Promise.resolve(clone(mem.cfg)); return run('config', 'readonly', function (s) { return s.get('main'); }); }
  function saveConfig(cfg) { if (mem) return memWrite(function (m) { m.cfg = clone(cfg); }); return run('config', 'readwrite', function (s) { return s.put(cfg, 'main'); }); }

  function allTx() { if (mem) return Promise.resolve(Array.from(mem.tx.values()).map(clone)); return run('tx', 'readonly', function (s) { return s.getAll(); }).then(function (r) { return r || []; }); }
  function putTx(list) {
    list = Array.isArray(list) ? list : [list];
    if (txHook) txHook(list);
    if (mem) return memWrite(function (m) { list.forEach(function (t) { m.tx.set(t.id, clone(t)); }); });
    return run('tx', 'readwrite', function (s) { list.forEach(function (t) { s.put(t); }); });
  }
  function deleteTx(ids) {
    ids = Array.isArray(ids) ? ids : [ids];
    if (mem) return memWrite(function (m) { ids.forEach(function (id) { m.tx.delete(id); }); });
    return run('tx', 'readwrite', function (s) { ids.forEach(function (id) { s.delete(id); }); });
  }
  function clearAll() { if (mem) return memWrite(function (m) { m.cfg = null; m.tx = new Map(); }); return multi(function (c, x) { c.clear(); x.clear(); }); }
  /* Replace everything in one transaction, so a restore is all-or-nothing. */
  function replaceAll(cfg, txList) { if (mem) return memWrite(function (m) { m.cfg = clone(cfg); m.tx = new Map(txList.map(function (r) { return [r.id, clone(r)]; })); }); return multi(function (c, x) { c.clear(); x.clear(); c.put(cfg, 'main'); txList.forEach(function (r) { x.put(r); }); }); }

  function persist() {
    if (!navigator.storage || !navigator.storage.persist) return Promise.resolve(false);
    return navigator.storage.persisted().then(function (p) { return p || navigator.storage.persist(); }).catch(function () { return false; });
  }

  return { useMemory: useMemory, inMemory: inMemory, metaKeys: metaKeys, setTxHook: setTxHook, setReadOnly: setReadOnly, onWrite: onWrite, getMeta: getMeta, setMeta: setMeta, putAll: putAll, open: open, getConfig: getConfig, saveConfig: saveConfig, allTx: allTx, putTx: putTx, deleteTx: deleteTx, clearAll: clearAll, replaceAll: replaceAll, persist: persist };
})();
