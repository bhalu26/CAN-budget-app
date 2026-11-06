/* Page logic: reads PDFs with PDF.js, builds the masked export, shows the preview, offers downloads. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') n.className = attrs[k]; else if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]); else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  var FORMAT = 'pdf-layout', SET_FORMAT = 'pdf-layout-set';
  /* Fixed words that appear in the export itself (not taken from the statement). */
  var ALLOW = {};
  ['pdf-layout', 'pdf-layout-set', 'sans-serif', 'serif', 'monospace', 'left', 'right', 'date', 'date2', 'desc', 'out', 'in', 'amount', 'balance', 'ref',
    'no-text-layer', 'rotated-text', 'no-table-header', 'analysis-failed'].forEach(function (s) { ALLOW[s] = 1; });

  var state = { files: [], sel: -1, tab: 'picture', page: 0, ctx: Mask.context({}), seq: 0, queue: Promise.resolve() };
  var libOk = typeof pdfjsLib !== 'undefined' && typeof pdfjsWorker !== 'undefined';
  if (libOk) { try { pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.js'; } catch (e) {} }

  function r1(n) { return Math.round(n * 10) / 10; }
  function say(t) { $('msg').textContent = t || ''; }

  /* ---------- reading a PDF ---------- */
  function familyOf(style) {
    var f = String(style && style.fontFamily || '').toLowerCase();
    return /mono|courier/.test(f) ? 'monospace' : /serif/.test(f) && !/sans/.test(f) ? 'serif' : 'sans-serif';
  }
  function yieldUi() { return new Promise(function (r) { setTimeout(r, 0); }); }

  function readPdf(rec, password) {
    var task = pdfjsLib.getDocument({ data: rec.buf.slice(), password: password || undefined, isEvalSupported: false, disableFontFace: true, enableXfa: false, verbosity: 0, useSystemFonts: false });
    return task.promise.then(function (pdf) {
      var pages = [], fontIds = {}, nf = 0, producer = '', creator = '';
      function pageLoop(i) {
        if (i > pdf.numPages) return Promise.resolve();
        return pdf.getPage(i).then(function (page) {
          var vp = page.getViewport({ scale: 1 }), sc = Math.hypot(vp.transform[0], vp.transform[1]) || 1;
          return page.getTextContent({ includeMarkedContent: false }).then(function (tc) {
            return page.getOperatorList().catch(function () {}).then(function () {
              var bold = {};
              var items = [];
              tc.items.forEach(function (it) {
                if (typeof it.str !== 'string' || !it.str.trim()) return;
                var t = pdfjsLib.Util.transform(vp.transform, it.transform), fn = it.fontName;
                if (!(fn in bold)) {
                  var b = 0;
                  try { if (page.commonObjs.has(fn)) { var fo = page.commonObjs.get(fn); b = (fo && (fo.bold || /bold|black|heavy|semibold|demi/i.test(String(fo.name || '')))) ? 1 : 0; } } catch (e) {}
                  bold[fn] = b;
                }
                if (!(fn in fontIds)) fontIds[fn] = nf++;
                items.push({ s: it.str, x: t[4], y: t[5], w: it.width * sc, fs: Math.hypot(t[2], t[3]), rot: Math.abs(Math.atan2(t[1], t[0])) > 0.1 ? 1 : 0, fid: fontIds[fn], b: bold[fn], ff: familyOf(tc.styles && tc.styles[fn]) });
              });
              pages.push({ n: i, w: vp.width, h: vp.height, items: items });
              page.cleanup();
            });
          });
        }).then(yieldUi).then(function () { return pageLoop(i + 1); });
      }
      return pageLoop(1).then(function () { return pdf.getMetadata().catch(function () { return {}; }); }).then(function (meta) {
        var info = (meta && meta.info) || {};
        producer = String(info.Producer || '').slice(0, 60); creator = String(info.Creator || '').slice(0, 60);
        try { task.destroy(); } catch (e) {}
        return { pages: pages, fonts: nf, producer: producer, creator: creator };
      });
    });
  }

  function processFile(rec, password) {
    rec.status = 'reading'; rec.msg = ''; render();
    return readPdf(rec, password).then(function (raw) {
      var any = raw.pages.some(function (p) { return p.items.length; });
      rec.raw = raw; rec.pageCount = raw.pages.length;
      if (!any) { rec.status = 'scan'; rec.msg = 'This PDF has no text in it (it is a scan or a picture). The layout cannot be read here.'; rec.buf = null; return; }
      try { rec.diag = Layout.analyze(raw.pages); } catch (e) { rec.diag = null; rec.analysisFailed = true; }
      rec.status = 'ok'; rec.buf = null;
      rebuild(rec);
      if (state.sel < 0) { state.sel = state.files.indexOf(rec); state.page = 0; }
    }).catch(function (e) {
      if (e && e.name === 'PasswordException') { rec.status = 'locked'; rec.msg = e.code === 2 ? 'That password did not work. Try again.' : 'This PDF is locked with a password.'; }
      else { rec.status = 'error'; rec.msg = 'Could not read this file' + (e && e.message ? ' (' + String(e.message).slice(0, 80) + ')' : '') + '.'; rec.buf = null; }
    }).then(function () { render(); });
  }

  /* ---------- building the export ---------- */
  function currentCtx(rec) {
    var keep = [$('keep').value];
    if ($('sw').checked && rec && rec.raw) keep.push(rec.raw.producer, rec.raw.creator);
    return Mask.context({ keep: keep, hide: [$('hide').value] });
  }
  function group(list, ctx) {
    var g = {};
    list.forEach(function (s) { var m = Mask.text(s, ctx); g[m] = (g[m] || 0) + 1; });
    return Object.keys(g).sort(function (a, b) { return g[b] - g[a]; }).slice(0, 12).map(function (k) { return { shape: k, n: g[k] }; });
  }
  function exportDiag(d, ctx) {
    if (!d) return { notes: [{ code: 'analysis-failed' }] };
    return {
      pages: d.pages, textPages: d.textPages, rows: d.rows, counts: d.counts, notes: d.notes,
      header: d.header && { page: d.header.page, y: d.header.y, cols: d.header.cols.map(function (c) { return { label: Mask.text(c.label, ctx), role: c.role, align: c.align, x0: c.x0, x1: c.x1 }; }) },
      dateShapes: group(d.samples.date, ctx), amountShapes: group(d.samples.amount, ctx), balanceShapes: group(d.samples.balance, ctx),
      balance: d.balance, totals: d.totals || null, summary: d.summary || null
    };
  }
  function buildExport(rec, ctx) {
    var raw = rec.raw, sw = $('sw').checked;
    return {
      format: FORMAT, schema: 1,
      doc: { pages: raw.pages.length, fonts: raw.fonts, software: sw ? { producer: Mask.text(raw.producer, ctx), creator: Mask.text(raw.creator, ctx) } : null },
      diag: exportDiag(rec.diag, ctx),
      pages: raw.pages.map(function (p) {
        return { n: p.n, w: r1(p.w), h: r1(p.h), items: p.items.map(function (i) {
          var o = { t: Mask.text(i.s, ctx), x: r1(i.x), y: r1(i.y), w: r1(i.w), fs: r1(i.fs), f: i.fid, ff: i.ff };
          if (i.b) o.b = 1; if (i.rot) o.rot = 1; return o;
        }) };
      })
    };
  }
  function summaryLines(exp) {
    var d = exp.diag, out = [];
    if (!d || !d.counts) return [{ cls: 'warn', t: 'The table could not be analysed, but the layout can still be shared.' }];
    var np = exp.doc.pages;
    out.push({ t: np + ' page' + (np === 1 ? '' : 's') + ', ' + d.rows + ' lines of text.' });
    if (d.header) {
      out.push({ t: 'Table found on page ' + d.header.page + ' with columns: ' + d.header.cols.map(function (c) { return c.label + (c.align === 'right' ? ' (right)' : ''); }).join(' | ') });
      out.push({ t: d.counts.tx + ' transaction lines, ' + d.counts.cont + ' wrapped lines, ' + d.counts.bal + ' balance lines, ' + d.counts.other + ' other lines' + (d.counts.datedNoAmount ? ', ' + d.counts.datedNoAmount + ' dated lines without an amount' : '') + '.' });
      if (d.dateShapes.length) out.push({ t: 'Dates look like: ' + d.dateShapes.slice(0, 3).map(function (s) { return s.shape; }).join('  ·  ') });
      if (d.amountShapes.length) out.push({ t: 'Amounts look like: ' + d.amountShapes.slice(0, 4).map(function (s) { return s.shape; }).join('  ·  ') });
      var b = d.balance;
      if (b && b.present) {
        if (b.checked && b.consistent === b.checked) out.push({ cls: 'good', t: 'Running balance: all ' + b.checked + ' checked lines add up.' });
        else if (b.checked) out.push({ cls: 'warn', t: 'Running balance: ' + b.consistent + ' of ' + b.checked + ' checked lines add up. First difference: ' + (b.mismatches[0] ? 'page ' + b.mismatches[0].page + ', transaction ' + b.mismatches[0].row : 'unknown') + '.' });
        else out.push({ t: 'Running balance column found, but there was nothing to check yet.' });
      } else out.push({ t: 'No running balance column.' });
      if (b && b.present && b.closing === 1) out.push({ cls: 'good', t: 'Closing balance equals the last running balance.' });
      else if (b && b.present && b.closing === -1) out.push({ cls: 'warn', t: 'Closing balance does not equal the last running balance.' });
      var t = d.totals;
      if (t && t.checked) {
        if (t.ok === t.checked) out.push({ cls: 'good', t: 'Section totals: all ' + t.checked + ' add up.' });
        else out.push({ cls: 'warn', t: 'Section totals: ' + t.ok + ' of ' + t.checked + ' add up (total ' + t.bad.map(function (x) { return x.n; }).join(', ') + ' differ).' });
      }
      var s = d.summary;
      if (s && s.found) {
        out.push({ t: 'Summary box found with ' + s.parts + ' amounts.' });
        if (s.arithmetic === 1) out.push({ cls: 'good', t: 'The summary box adds up by its own arithmetic.' });
        else if (s.arithmetic === -1) out.push({ cls: 'warn', t: 'The summary box does not add up by its own arithmetic.' });
        if (s.openingMatch === 1) out.push({ cls: 'good', t: 'Opening balance in the summary matches the table.' });
        else if (s.openingMatch === -1) out.push({ cls: 'warn', t: 'Opening balance in the summary does not match the table.' });
        if (s.closingMatch === 1) out.push({ cls: 'good', t: 'Closing balance in the summary matches the table.' });
        else if (s.closingMatch === -1) out.push({ cls: 'warn', t: 'Closing balance in the summary does not match the table.' });
        if (s.netMatch === 1) out.push({ cls: 'good', t: 'Net of the table lines matches the summary.' });
        else if (s.netMatch === -1) out.push({ cls: 'warn', t: 'Net of the table lines does not match the summary.' });
      }
      if (d.counts.datedNoAmount) out.push({ cls: 'warn', t: d.counts.datedNoAmount + ' dated lines have no readable amount; they may be missed transactions.' });
    } else out.push({ cls: 'warn', t: 'No transaction table header was recognised. The layout can still be shared; it will help teach the reader this format.' });
    (d.notes || []).forEach(function (n) {
      if (n.code === 'no-text-layer') out.push({ cls: 'warn', t: 'Page ' + n.page + ' has no text (a scanned page).' });
      if (n.code === 'rotated-text') out.push({ t: 'Page ' + n.page + ' has sideways text.' });
    });
    return out;
  }
  function toText(exp, idx) {
    var d = exp.diag, L = ['# Statement layout, masked (file ' + idx + '). Digits are 9, unfamiliar words are x.'];
    summaryLines(exp).forEach(function (s) { L.push('# ' + s.t); });
    if (exp.doc.software) L.push('# Made by: ' + exp.doc.software.producer + (exp.doc.software.creator ? ' / ' + exp.doc.software.creator : ''));
    exp.pages.forEach(function (p) {
      L.push('', '=== page ' + p.n + ' (' + Math.round(p.w) + ' x ' + Math.round(p.h) + ') ===');
      Layout.textPicture(p).forEach(function (l) { L.push(l); });
    });
    return L.join('\n') + '\n';
  }
  function rebuild(rec) {
    if (rec.status !== 'ok') return;
    var ctx = currentCtx(rec);
    rec.ctx = ctx;
    rec.exp = buildExport(rec, ctx);
    rec.problems = Mask.audit(rec.exp, ctx, ALLOW);
    rec.txt = toText(rec.exp, state.files.indexOf(rec) + 1);
  }
  function rebuildAll() { state.files.forEach(rebuild); render(); }

  /* ---------- screen ---------- */
  var TABS = [['picture', 'Page picture'], ['text', 'Text'], ['words', 'Words']];
  function cur() { return state.files[state.sel] || null; }

  function render() {
    var any = state.files.length > 0;
    $('results').hidden = !any;
    var ul = $('files'); clear(ul);
    state.files.forEach(function (rec, i) {
      var li = el('li', { class: i === state.sel ? 'sel' : '' });
      var nameBtn = el('button', { class: 'name', type: 'button', text: rec.name, 'aria-label': 'Show ' + rec.name });
      nameBtn.addEventListener('click', function () { if (rec.status === 'ok') { state.sel = i; state.page = 0; render(); } });
      li.appendChild(nameBtn);
      var chip = { queued: ['Waiting', ''], reading: ['Reading…', ''], ok: [rec.pageCount + ' page' + (rec.pageCount === 1 ? '' : 's') + ' read', 'ok'], locked: ['Password needed', 'warn'], scan: ['No text', 'warn'], error: ['Could not read', 'bad'] }[rec.status];
      li.appendChild(el('span', { class: 'chip ' + chip[1], text: chip[0] }));
      li.appendChild(el('button', { class: 'btn small', type: 'button', text: 'Remove', 'aria-label': 'Remove ' + rec.name, onclick: function () { remove(rec); } }));
      if (rec.msg) li.appendChild(el('span', { class: 'muted', text: rec.msg, role: 'status' }));
      if (rec.status === 'locked') {
        var pw = el('input', { type: 'password', 'aria-label': 'Password for ' + rec.name, autocomplete: 'off', placeholder: 'PDF password' });
        var go = function () { var v = pw.value; pw.value = ''; queue(function () { return processFile(rec, v); }); };
        pw.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
        li.appendChild(el('div', { class: 'pw' }, [pw, el('button', { class: 'btn small', type: 'button', text: 'Unlock', onclick: go })]));
      }
      ul.appendChild(li);
    });
    var rec = cur();
    var ok = rec && rec.status === 'ok';
    $('detail').hidden = !ok;
    if (!ok) return;

    var sm = $('summary'); clear(sm);
    summaryLines(rec.exp).forEach(function (s) { sm.appendChild(el('p', { class: s.cls || '', text: s.t })); });
    var leak = $('leak'), clean = rec.problems.length === 0;
    leak.className = 'leak ' + (clean ? 'ok' : 'bad');
    leak.textContent = clean ? 'Leak check passed: the file holds only 9s, x’s and ' + readableCount(rec) + ' readable statement words.' : 'Leak check FAILED (' + rec.problems.length + ' problem' + (rec.problems.length === 1 ? '' : 's') + '). Downloads are turned off.';
    $('dlJson').disabled = $('dlTxt').disabled = $('copy').disabled = !clean;
    var okFiles = state.files.filter(function (f) { return f.status === 'ok' && !f.problems.length; });
    $('dlAll').hidden = okFiles.length < 2; $('dlAll').textContent = 'Download all ' + okFiles.length + ' files (.json)';
    var names = [rec.raw.producer, rec.raw.creator].filter(Boolean);
    $('swname').textContent = names.length ? '(' + names.join(' / ') + ')' : '(no program name in this PDF)';

    var tabs = $('tabs'); clear(tabs);
    TABS.forEach(function (t) { tabs.appendChild(el('button', { type: 'button', text: t[1], 'aria-pressed': String(state.tab === t[0]), onclick: function () { state.tab = t[0]; render(); } })); });
    $('legend').textContent = state.tab === 'text' ? 'This is exactly what the .txt file contains.' :
      state.tab === 'picture' ? 'Yellow words stay readable. Click a yellow word to hide it, or any other word to keep it readable.' : 'Click a word to move it between readable and hidden.';
    var v = $('view'); clear(v);
    if (state.tab === 'text') v.appendChild(el('pre', { class: 'text', text: rec.txt, tabindex: '0', 'aria-label': 'Masked text of the statement' }));
    else if (state.tab === 'words') v.appendChild(wordsView(rec));
    else v.appendChild(pictureView(rec));
  }

  function readableCount(rec) {
    var seen = {};
    rec.raw.pages.forEach(function (p) { p.items.forEach(function (i) { Mask.mask(i.s, rec.ctx).tokens.forEach(function (t) { if (t.alpha && t.readable) seen[t.k] = 1; }); }); });
    rec._readable = Object.keys(seen);
    return rec._readable.length;
  }

  function addWord(inputId, word, removeFrom) {
    function words(id) { return $(id).value.split(/[,\s]+/).filter(Boolean); }
    var w = words(removeFrom).filter(function (x) { return Mask.key(x) !== word; });
    $(removeFrom).value = w.join(', ');
    var a = words(inputId); if (a.map(Mask.key).indexOf(word) < 0) a.push(word);
    $(inputId).value = a.join(', ');
    saveKeep(); rebuildAll();
  }
  function wordClick(e) {
    var k = e.target && e.target.getAttribute && e.target.getAttribute('data-k');
    if (!k) return;
    if (e.target.classList.contains('rd')) addWord('hide', k, 'keep'); else addWord('keep', k, 'hide');
  }

  function pictureView(rec) {
    var pages = rec.raw.pages, wrap = el('div');
    if (state.page >= pages.length) state.page = 0;
    if (pages.length > 1) {
      var pg = el('div', { class: 'pager', role: 'group', 'aria-label': 'Pages' });
      pages.forEach(function (p, i) { pg.appendChild(el('button', { class: 'btn small', type: 'button', text: 'Page ' + p.n, 'aria-pressed': String(i === state.page), onclick: function () { state.page = i; render(); } })); });
      wrap.appendChild(pg);
    }
    var p = pages[state.page], stage = el('div', { class: 'stage' }), box = el('div', { class: 'page' });
    var scale = Math.min(1.4, 940 / p.w);
    box.style.width = Math.round(p.w * scale) + 'px'; box.style.height = Math.round(p.h * scale) + 'px';
    p.items.forEach(function (it) {
      var m = Mask.mask(it.s, rec.ctx), sp = el('span', { class: 'it' }), cw = it.w / Math.max(1, it.s.length);
      var px = Math.max(3, Math.min(it.fs * 1.15, cw / 0.6)) * scale;
      sp.style.left = (it.x * scale) + 'px'; sp.style.top = ((it.y - it.fs * 0.85) * scale) + 'px'; sp.style.fontSize = px + 'px';
      if (it.b) sp.style.fontWeight = '700';
      if (it.rot) sp.style.transform = 'rotate(-90deg)';
      m.tokens.forEach(function (t) {
        if (t.alpha && t.k.length >= 2) sp.appendChild(el('span', { class: t.readable ? 'rd' : 'mk', 'data-k': t.k, text: t.out }));
        else sp.appendChild(document.createTextNode(t.out));
      });
      box.appendChild(sp);
    });
    box.addEventListener('click', wordClick);
    stage.appendChild(box); wrap.appendChild(stage);
    return wrap;
  }

  function wordsView(rec) {
    var wrap = el('div'), readable = {}, masked = {};
    rec.raw.pages.forEach(function (p) { p.items.forEach(function (i) {
      Mask.mask(i.s, rec.ctx).tokens.forEach(function (t) { if (!t.alpha || t.k.length < 2) return; (t.readable ? readable : masked)[t.k] = ((t.readable ? readable : masked)[t.k] || 0) + 1; });
    }); });
    wrap.appendChild(el('h3', { text: 'Readable in the shared file (click to hide)' }));
    var c1 = el('div', { class: 'chips' });
    Object.keys(readable).sort().forEach(function (k) { c1.appendChild(el('button', { class: 'rdchip', type: 'button', text: k, onclick: function () { addWord('hide', k, 'keep'); } })); });
    if (!c1.firstChild) c1.appendChild(el('span', { class: 'muted', text: 'None.' }));
    wrap.appendChild(c1);
    wrap.appendChild(el('h3', { text: 'Hidden words that appear often (click to keep readable)' }));
    wrap.appendChild(el('p', { class: 'hint', text: 'Only for words that are not personal, like your bank’s name. These are shown here on your screen only.' }));
    var c2 = el('div', { class: 'chips' });
    Object.keys(masked).filter(function (k) { return masked[k] >= 2 && k.length >= 3; }).sort(function (a, b) { return masked[b] - masked[a]; }).slice(0, 24).forEach(function (k) {
      c2.appendChild(el('button', { type: 'button', text: k + ' ×' + masked[k], onclick: function () { addWord('keep', k, 'hide'); } }));
    });
    if (!c2.firstChild) c2.appendChild(el('span', { class: 'muted', text: 'None.' }));
    wrap.appendChild(c2);
    return wrap;
  }

  /* ---------- files, downloads ---------- */
  function queue(fn) { state.queue = state.queue.then(fn).catch(function () {}); return state.queue; }
  function addFiles(list) {
    Array.prototype.forEach.call(list, function (f) {
      var rec = { id: ++state.seq, name: f.name, status: 'queued', msg: '', buf: null };
      state.files.push(rec);
      queue(function () {
        return f.arrayBuffer().then(function (ab) { rec.buf = new Uint8Array(ab); return processFile(rec); }).catch(function () { rec.status = 'error'; rec.msg = 'Could not open this file.'; render(); });
      });
    });
    render();
  }
  function remove(rec) {
    var i = state.files.indexOf(rec), was = cur();
    state.files.splice(i, 1);
    state.sel = was === rec ? state.files.findIndex(function (f) { return f.status === 'ok'; }) : state.files.indexOf(was);
    render();
  }
  function save(name, text, type) {
    var a = el('a', { href: URL.createObjectURL(new Blob([text], { type: type })), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  function idxOf(rec) { return state.files.indexOf(rec) + 1; }
  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t);
    return new Promise(function (ok, no) {
      var ta = el('textarea', { 'aria-hidden': 'true' }); ta.value = t; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? ok() : no(); } catch (e) { no(e); } ta.remove();
    });
  }
  $('dlJson').addEventListener('click', function () { var r = cur(); if (r && !r.problems.length) { save('statement-layout-' + idxOf(r) + '.json', JSON.stringify(r.exp), 'application/json'); say('Saved. Share this file.'); } });
  $('dlTxt').addEventListener('click', function () { var r = cur(); if (r && !r.problems.length) { save('statement-layout-' + idxOf(r) + '.txt', r.txt, 'text/plain'); say('Saved. Share this file.'); } });
  $('copy').addEventListener('click', function () { var r = cur(); if (r && !r.problems.length) copyText(r.txt).then(function () { say('Copied.'); }, function () { say('Could not copy. Use the download instead.'); }); });
  $('dlAll').addEventListener('click', function () {
    var ok = state.files.filter(function (f) { return f.status === 'ok' && !f.problems.length; });
    var set = { format: SET_FORMAT, schema: 1, files: ok.map(function (f) { return f.exp; }) };
    save('statement-layouts-' + ok.length + '-files.json', JSON.stringify(set), 'application/json'); say('Saved. Share this file.');
  });

  /* ---------- inputs ---------- */
  function saveKeep() { try { localStorage.setItem('layoutDump.keep', $('keep').value); } catch (e) {} }
  try { var kv = localStorage.getItem('layoutDump.keep'); if (kv) $('keep').value = kv; } catch (e) {}
  var t = null;
  ['hide', 'keep'].forEach(function (id) { $(id).addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { saveKeep(); rebuildAll(); }, 200); }); });
  $('sw').addEventListener('change', rebuildAll);
  $('file').addEventListener('change', function (e) { addFiles(e.target.files); e.target.value = ''; });
  var drop = $('drop');
  ['dragenter', 'dragover'].forEach(function (n) { drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (n) { drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files) addFiles(Array.prototype.filter.call(e.dataTransfer.files, function (f) { return /\.pdf$/i.test(f.name) || f.type === 'application/pdf'; })); });
  /* a PDF dropped anywhere else must not make the browser open it (and show it unmasked) */
  ['dragover', 'drop'].forEach(function (n) { window.addEventListener(n, function (e) { if (!drop.contains(e.target)) e.preventDefault(); }); });

  if (!libOk) {
    var m = el('p', { class: 'bad', role: 'alert', text: 'The PDF reader files (the vendor folder) did not load. Keep this page together with its vendor folder.' });
    document.querySelector('header').appendChild(m);
  }
  window.LayoutDump = { _state: state, _addFiles: addFiles };
})();
