/* The budget file: one encrypted file format for backups, shared copies and "work from a file".
   Only standard Web Crypto: PBKDF2-SHA-256 (600,000 rounds) makes an AES-256-GCM key from the passphrase.
   Format 2 (written from version 22) is JSON text:
     { app: "household-budget-file", v: 2, createdAt, kdf: { name, hash, iterations, salt }, check: { iv, ct },
       cipher: { name: "AES-GCM", iv }, zip, bytes, sha256, hsum, data, end: "household-budget-file" }
   - check: a fixed text locked with the same key, so a wrong passphrase is told apart from a damaged file.
   - bytes + sha256 + hsum: length and SHA-256 of the locked data and a checksum of the header, so damage anywhere is
     found before any passphrase is asked for, and "wrong passphrase" is only ever said about an intact file.
   - Every header field is bound to the data (AES-GCM additional data): changing the date or any field breaks it.
   - end: the last field; a file that stops early (an unfinished download, a cloud placeholder) is "incomplete".
   Still opened: format 1 (".budgetsnap" snapshots and locked backup .json files) and old unlocked backup .json files.
   Every file written is opened again in memory and compared before it is handed over (seal). Nothing here is stored. */
var Vault = (function () {
  'use strict';
  var APP = 'household-budget-file', APP1 = 'household-budget-snapshot', ITER = 600000, EXT = '.budget';
  var CHECK = 'household-budget-file-check';
  var enc = new TextEncoder(), dec = new TextDecoder();

  /* ---------- errors people can act on ---------- */
  var SAY = {
    EMPTY: 'This file is empty. It may not have finished downloading or syncing (Google Drive and iCloud sometimes keep only a placeholder). Open the file from its folder first, or use another copy.',
    INCOMPLETE: 'This file is cut off: only part of it arrived (an unfinished download or sync). Download or sync it again, or use another copy.',
    NOT_BUDGET: 'This is not a budget file from this app. Budget files end in .budget (older ones in .budgetsnap or .json).',
    DAMAGED: 'This file is damaged: its contents changed after it was saved (a copying or syncing problem, or it was edited). The passphrase is not the problem. Use another copy.',
    WRONG_PASS: 'That passphrase does not open this file. Capital letters and spaces count. If you have changed your passphrase, this file may use the one before.',
    WRONG_PASS_OLD: 'That passphrase does not open this file. Capital letters and spaces count; if you changed your passphrase, try the one before. (Older files cannot tell a wrong passphrase from a damaged file: if you are sure of it, try another copy.)',
    NEWER: 'This file was saved by a newer version of the app. Use the newest budget-app.',
    NO_CRYPTO: 'This browser cannot open locked files (it has no Web Crypto). Use a current Chrome, Edge, Safari or Firefox, on a page opened from https or from this computer.',
    NO_ZIP: 'This browser cannot unpack this file. Use a current Chrome, Edge, Safari or Firefox.',
    NEED_PASS: 'Type the passphrase to open this file.',
    VERIFY: 'The file could not be checked after locking it, so it was not saved. Nothing was lost: try again.'
  };
  function fail(code, extra) { var e = new Error(SAY[code] + (extra ? ' ' + extra : '')); e.code = code; return e; }

  /* ---------- bytes ---------- */
  function b64(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(s) {
    var bin; try { bin = atob(String(s)); } catch (e) { return null; }
    var b = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b;
  }
  function rand(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return a; }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join(''); }
  function sha256(bytes) { return crypto.subtle.digest('SHA-256', bytes).then(hex); }
  var canZip = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
  /* bytes through a (de)compression stream, written directly (no Blob: Safari refuses a Blob read while a page unloads);
     a failure surfaces only through the returned promise, never as an uncaught error */
  function pipe(bytes, Stream, how) {
    var s = new Stream(how), w = s.writable.getWriter();
    w.write(bytes).catch(function () {}); w.close().catch(function () {});
    return new Response(s.readable).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function hasCrypto() { return typeof crypto !== 'undefined' && !!crypto.subtle; }

  /* ---------- keys ---------- */
  function newSalt() { return b64(rand(16)); }
  function derive(pass, saltB64, iter) {
    if (!hasCrypto()) return Promise.reject(fail('NO_CRYPTO'));
    var salt = unb64(saltB64); if (!salt) return Promise.reject(fail('DAMAGED'));
    return crypto.subtle.importKey('raw', enc.encode(String(pass).normalize('NFC')), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: iter || ITER }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }

  /* ---------- reading the outside (no passphrase needed) ---------- */
  function clean(text) { return String(text == null ? '' : text).replace(/^﻿/, '').trim(); }
  /* What kind of file this is, and whether it is visibly broken: { format: 2|1|'plain', createdAt, hd, data } or throws. */
  function inspect(text) {
    var t = clean(text);
    if (!t) throw fail('EMPTY');
    var head = t.slice(0, 120), j = null;
    var v2 = /^\{\s*"app"\s*:\s*"household-budget-file"/.test(head), v1 = /^\{\s*"app"\s*:\s*"household-budget-snapshot"/.test(head), plain = /^\{/.test(head) && /"household-budget"/.test(t.slice(0, 4000));
    // a copy cut off within its first characters still starts like one of ours
    var start = t.replace(/\s+/g, '').slice(0, 30), ours = ['{"app":"household-budget-file"', '{"app":"household-budget-snapshot"', '{"app":"household-budget"'].some(function (p) { return p.indexOf(start) === 0 || start.indexOf(p.slice(0, 30)) === 0; });
    try { j = JSON.parse(t); } catch (e) { if (v2 || v1 || plain || ours) throw fail('INCOMPLETE'); throw fail('NOT_BUDGET'); }
    if (!j || typeof j !== 'object') throw fail('NOT_BUDGET');
    // the number of key rounds comes from the file: only a sane range, so a crafted file cannot freeze the browser
    if ((j.app === APP || j.app === APP1) && j.kdf && !(j.kdf.iterations >= 100000 && j.kdf.iterations <= 5000000)) throw fail('DAMAGED');
    if (j.app === APP) {
      if (typeof j.v !== 'number' || j.v > 2) throw fail('NEWER');
      if (j.end !== APP) throw fail('INCOMPLETE');
      if (!j.kdf || !j.cipher || !j.check || typeof j.data !== 'string' || !j.sha256 || !j.hsum || typeof j.bytes !== 'number') throw fail('DAMAGED');
      return { format: 2, createdAt: j.createdAt, hd: j };
    }
    if (j.app === APP1) {
      if (j.v !== 1) throw fail('NEWER');
      if (!j.kdf || !j.cipher || typeof j.data !== 'string') throw fail('DAMAGED');
      return { format: 1, createdAt: j.createdAt, hd: j };
    }
    if (j.app === 'household-budget') return { format: 'plain', createdAt: j.savedAt || null, data: j };
    throw fail('NOT_BUDGET');
  }
  function isLocked(text) { try { var f = inspect(text); return f.format !== 'plain'; } catch (e) { return /^\{\s*"app"\s*:\s*"household-budget-(file|snapshot)"/.test(clean(text).slice(0, 120)); } }

  /* ---------- format 2 ---------- */
  function aad2(h) {
    return enc.encode(JSON.stringify({ app: APP, v: 2, createdAt: h.createdAt, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: h.kdf.iterations, salt: h.kdf.salt },
      check: { iv: h.check.iv, ct: h.check.ct }, cipher: { name: 'AES-GCM', iv: h.cipher.iv }, zip: h.zip, bytes: h.bytes }));
  }
  /* checksum of the whole header, including the hash of the locked data */
  function headSum(h) { var a = aad2(h), s = enc.encode('|' + h.sha256), all = new Uint8Array(a.length + s.length); all.set(a); all.set(s, a.length); return sha256(all); }
  function aad1(h) {
    return enc.encode(JSON.stringify({ app: APP1, v: 1, createdAt: h.createdAt, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: h.kdf.iterations, salt: h.kdf.salt }, cipher: { name: 'AES-GCM', iv: h.cipher.iv }, zip: h.zip }));
  }
  function goodBudget(d) { return d && d.app === 'household-budget' && d.config && typeof d.config === 'object' && Array.isArray(d.transactions); }

  /* payload ({ app: 'household-budget', savedAt, config, transactions }) -> file text, locked with key (made from salt).
     The text is opened again with the same key and compared before it is returned. */
  function seal(payload, key, salt, iter) {
    if (!hasCrypto()) return Promise.reject(fail('NO_CRYPTO'));
    if (!goodBudget(payload) || !payload.savedAt) return Promise.reject(new Error('Nothing to save: the budget is not loaded.'));
    var plain = enc.encode(JSON.stringify(payload)), iv = rand(12), civ = rand(12), hd;
    return sha256(plain).then(function (plainHash) {
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: civ }, key, enc.encode(CHECK)).then(function (cct) {
        return (canZip ? pipe(plain, CompressionStream, 'gzip') : Promise.resolve(plain)).then(function (body) {
          hd = { app: APP, v: 2, createdAt: payload.savedAt, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: iter || ITER, salt: salt }, check: { iv: b64(civ), ct: b64(cct) },
            cipher: { name: 'AES-GCM', iv: b64(iv) }, zip: canZip ? 'gzip' : 'none', bytes: 0, sha256: '' };
          hd.bytes = body.length + 16;   // AES-GCM output: the contents plus a 16-byte tag
          return encryptBody(hd, key, iv, body);
        });
      }).then(function (text) {
        // read it back exactly as a stranger would, and compare
        return open(text, { key: key }).then(function (r) {
          return sha256(enc.encode(JSON.stringify(r.data))).then(function (h2) {
            if (h2 !== plainHash || r.data.transactions.length !== payload.transactions.length) throw fail('VERIFY');
            return text;
          });
        }, function () { throw fail('VERIFY'); });
      });
    });
  }
  /* The header is bound to the data by AES-GCM (additional data). sha256 (of all the locked bytes, tag included) and hsum
     (of the header plus that hash) are outside it: they are there to catch accidental damage before a passphrase is
     asked for, so "wrong passphrase" is only ever said about an intact file. Tampering is caught by AES-GCM itself. */
  function encryptBody(hd, key, iv, body) {
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: aad2(hd) }, key, body).then(function (ct) {
      return sha256(ct).then(function (h) { hd.sha256 = h; return headSum(hd); }).then(function (hsum) {
        return JSON.stringify({ app: hd.app, v: hd.v, createdAt: hd.createdAt, kdf: hd.kdf, check: hd.check, cipher: hd.cipher, zip: hd.zip, bytes: hd.bytes, sha256: hd.sha256, hsum: hsum, data: b64(ct), end: APP });
      });
    });
  }

  /* text -> { data, format, key, salt, iter, createdAt }.  o: { pass } or { key } (a key made for this file's salt).
     Errors carry .code: EMPTY, INCOMPLETE, NOT_BUDGET, DAMAGED, WRONG_PASS, NEWER, NO_CRYPTO, NO_ZIP, NEED_PASS. */
  function open(text, o) {
    o = o || {};
    var f;
    try { f = inspect(text); } catch (e) { return Promise.reject(e); }
    if (f.format === 'plain') {
      if (!goodBudget(f.data)) return Promise.reject(fail('NOT_BUDGET'));
      return Promise.resolve({ data: f.data, format: 'plain', createdAt: f.createdAt });
    }
    if (!hasCrypto()) return Promise.reject(fail('NO_CRYPTO'));
    var hd = f.hd, ct = unb64(hd.data), iv = unb64(hd.cipher.iv);
    if (!ct || !iv) return Promise.reject(fail('DAMAGED'));
    var pre = Promise.resolve();
    if (f.format === 2) {
      if (ct.length !== hd.bytes || !unb64(hd.check.iv) || !unb64(hd.check.ct) || !unb64(hd.kdf.salt)) return Promise.reject(fail('DAMAGED'));
      pre = headSum(hd).then(function (h) { if (h !== hd.hsum) throw fail('DAMAGED'); return sha256(ct); })
        .then(function (h) { if (h !== hd.sha256) throw fail('DAMAGED'); });
    }
    return pre.then(function () {
      if (o.key) return attempt(o.key, null);
      if (!o.pass) throw fail('NEED_PASS');
      var p = String(o.pass);
      return attempt(null, p).catch(function (e) {
        // a space pasted before or after the passphrase is the commonest typo: try without it
        if (e.code === 'WRONG_PASS' || e.code === 'WRONG_PASS_OLD') { var t = p.trim(); if (t && t !== p) return attempt(null, t); }
        throw e;
      });
    });
    function attempt(key, pass) {
      var keyP = key ? Promise.resolve(key) : derive(pass, hd.kdf.salt, hd.kdf.iterations);
      return keyP.then(function (k) {
        var checkP = f.format === 2 ? crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(hd.check.iv) || new Uint8Array(12) }, k, unb64(hd.check.ct) || new Uint8Array(0))
          .then(function (pt) { if (dec.decode(pt) !== CHECK) throw fail('WRONG_PASS'); }, function () { throw fail('WRONG_PASS'); }) : Promise.resolve();
        return checkP.then(function () {
          return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv, additionalData: f.format === 2 ? aad2(hd) : aad1(hd) }, k, ct)
            .then(null, function () { throw fail(f.format === 2 ? 'DAMAGED' : 'WRONG_PASS_OLD'); });
        }).then(function (pt) {
          if (hd.zip === 'gzip') { if (!canZip) throw fail('NO_ZIP'); return pipe(new Uint8Array(pt), DecompressionStream, 'gzip').catch(function () { throw fail('DAMAGED'); }); }
          return new Uint8Array(pt);
        }).then(function (bytes) {
          var d; try { d = JSON.parse(dec.decode(bytes)); } catch (e) { throw fail('DAMAGED'); }
          if (!goodBudget(d)) throw fail('NOT_BUDGET');
          if (d.savedAt !== hd.createdAt) throw fail('DAMAGED');
          return { data: d, format: f.format, key: k, salt: hd.kdf.salt, iter: hd.kdf.iterations, createdAt: hd.createdAt };
        });
      });
    }
  }

  /* ---------- names ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fileName(iso, prefix) { var d = new Date(iso); return (prefix || 'budget') + '-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + EXT; }
  var ACCEPT = '.budget,.budgetsnap,.json,application/octet-stream,application/json';

  return { seal: seal, open: open, inspect: inspect, isLocked: isLocked, derive: derive, newSalt: newSalt, fileName: fileName, ITER: ITER, EXT: EXT, ACCEPT: ACCEPT, SAY: SAY, canZip: canZip };
})();
