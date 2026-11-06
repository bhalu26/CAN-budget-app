/* Layout reading: rebuilds rows and columns from positioned text, finds the table header (one or two lines),
   classifies every row, and proves the table with independent checks:
     - running balance (each printed balance = previous balance + movements)
     - section totals ("Total of ...", "TOTAL CREDITS") against the lines above them
     - the statement's own summary box (previous balance, + purchases, - payments, = new balance)
     - summary against the table (opening, closing, net movement)
   Works on the real text in memory only; the export step masks everything it reports. */
var Layout = (function () {
  'use strict';

  var MONTHS = ('january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec ' +
    'janvier fevrier mars avril mai juin juillet aout septembre octobre novembre decembre janv fevr avr juil dec').split(' ');
  var MON = {}; MONTHS.forEach(function (m) { MON[m] = 1; });
  function norm(s) { return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function isMonth(w) { return !!MON[norm(w)]; }

  function median(a) { if (!a.length) return 0; var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  function std(a) { if (a.length < 2) return 0; var m = a.reduce(function (s, x) { return s + x; }, 0) / a.length; return Math.sqrt(a.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / a.length); }

  /* ---------- what a cell looks like ---------- */
  var DASH = /^[-−–—]/;   // hyphen, minus sign, en dash, em dash all mean "minus"
  function isDateText(s) {
    s = String(s).trim().replace(/\s+/g, ' ');
    if (/^\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}$/.test(s)) return true;
    if (/^\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4}$/.test(s)) return true;
    if (/^\d{1,2}[-\/]\d{1,2}$/.test(s)) return true;
    var m = s.match(/^([A-Za-zÀ-ÿ]{3,9})\.?\s*(\d{1,2})(?:,?\s*(\d{2,4}))?$/);
    if (m && isMonth(m[1])) return true;
    m = s.match(/^(\d{1,2})\s*([A-Za-zÀ-ÿ]{3,9})\.?(?:,?\s*(\d{2,4}))?$/);
    return !!(m && isMonth(m[2]));
  }
  /* "1,234.56", "(12.00)", "12.00-", "$5.00 CR", "–$5.00", "1.234,56" -> { c: cents (signed), cr: had CR/DR/OD marker } or null */
  function parseMoney(s) {
    var t = String(s).trim(), neg = false, cr = false, m = t.match(/\s*(CR|DR|OD|-|−|–|\+)$/i);
    if (m) { var u = m[1].toUpperCase(); if (u === 'DR' || u === 'OD' || DASH.test(u)) neg = true; if (u === 'CR' || u === 'DR' || u === 'OD') cr = true; t = t.slice(0, m.index); }
    if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
    t = t.replace(/[$€£\s]/g, '');
    if (DASH.test(t)) { neg = true; t = t.slice(1); } else if (t.charAt(0) === '+') t = t.slice(1);
    if (/^\d{1,3}(\.\d{3})*,\d{2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(,\d{3})+\.\d{2}$/.test(t) || /^\d+\.\d{2}$/.test(t)) t = t.replace(/,/g, '');
    else return null;
    var c = Math.round(parseFloat(t) * 100);
    return { c: neg ? -c : c, cr: cr };
  }
  function isAmountText(s) { return parseMoney(s) !== null; }

  /* ---------- rows and words ---------- */
  function splitWords(it) {
    var out = [], len = Math.max(1, it.s.length), re = /\S+/g, m;
    while ((m = re.exec(it.s))) { var x1 = it.x + it.w * ((m.index + m[0].length) / len); out.push({ s: m[0], x0: it.x + it.w * (m.index / len), x1: x1, xe: x1, fs: it.fs }); }
    return out;
  }
  /* "250.00" followed by "CR" (or a hanging "-") becomes one word; xe stays the edge of the number itself */
  function mergeSuffixes(words) {
    var out = [];
    words.forEach(function (w) {
      var p = out[out.length - 1];
      if (p && /^(CR|DR|OD|-|−|–)$/i.test(w.s) && isAmountText(p.s) && !parseMoneySuffix(p.s) && w.x0 - p.x1 < Math.max(8, (w.fs || 8) * 1.2)) { p.s += (/^[-−–]$/.test(w.s) ? '' : ' ') + w.s; p.x1 = w.x1; }
      else out.push({ s: w.s, x0: w.x0, x1: w.x1, xe: w.xe, fs: w.fs });
    });
    return out;
  }
  function parseMoneySuffix(s) { return /(CR|DR|OD|-|−|–)$/i.test(s); }
  function rowsOf(page) {
    var items = page.items.filter(function (i) { return !i.rot && i.s.trim(); }).slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    var rows = [];
    items.forEach(function (it) {
      var tol = Math.max(2, (it.fs || 8) * 0.45), r = rows[rows.length - 1];
      if (r && Math.abs(it.y - r.y) <= tol) { r.y = (r.y * r.items.length + it.y) / (r.items.length + 1); r.items.push(it); }
      else rows.push({ y: it.y, items: [it] });
    });
    rows.forEach(function (r) {
      var ws = [];
      r.items.forEach(function (it) { ws = ws.concat(splitWords(it)); });
      ws.sort(function (a, b) { return a.x0 - b.x0; });
      r.words = mergeSuffixes(ws);
      r.fs = median(r.items.map(function (i) { return i.fs || 8; }));
      r.text = r.words.map(function (w) { return w.s; }).join(' ');
    });
    return rows;
  }

  /* ---------- header row (one line, or two lines such as "Trans / Post" over "Date / Date") ---------- */
  var WEAK = { transaction: 1, trans: 1, posting: 1, post: 1, money: 1, paid: 1, 'in': 1, out: 1 };
  function roleOf(label) {
    var s = norm(label);
    if (/\bdates?\b|\bjour\b/.test(s)) return 'date';
    if (/balance|solde/.test(s)) return 'balance';
    if (/withdraw|debit|retrait|paid out|money out|charges?\b|\bout\b/.test(s)) return 'out';
    if (/deposit|credit|depot|paid in|money in|\bin\b/.test(s)) return 'in';
    if (/amount|montant/.test(s)) return 'amount';
    if (/desc|detail|particular|narrat|transaction|libelle|memo/.test(s)) return 'desc';
    if (/\bref\b|\bref\.|reference|cheque|check\b/.test(s)) return 'ref';
    return null;
  }
  function strongRole(w) { return WEAK[norm(w)] ? null : roleOf(w); }
  function clusterHeader(words, fs) {
    var out = [], cur = null, gapMax = Math.max(6, fs * 1.1);
    words.forEach(function (w) {
      var r = strongRole(w.s);
      if (cur && w.x0 - cur.x1 <= gapMax && !(cur.strong && r && cur.strong !== r)) { cur.s += ' ' + w.s; cur.x1 = Math.max(cur.x1, w.x1); cur.strong = cur.strong || r; }
      else { cur = { s: w.s, x0: w.x0, x1: w.x1, strong: r }; out.push(cur); }
    });
    return out;
  }
  function headerOf(row) {
    if (row.words.length > 16) return null;                  // a header is a few short labels, not a paragraph
    var cl = clusterHeader(row.words, row.fs), cols = [], seen = {}, numeric = 0, longLabel = false;
    cl.forEach(function (c) {
      var r = roleOf(c.s);
      if (!r) return;
      if (c.s.split(/\s+/).length > 4) longLabel = true;
      if (r === 'date' && seen.date) r = 'date2';
      if (seen[r]) return;
      seen[r] = 1; cols.push({ label: c.s, role: r, x0: c.x0, x1: c.x1 });
      if (r === 'amount' || r === 'in' || r === 'out' || r === 'balance') numeric++;
    });
    if (longLabel || !seen.date || cols.length < 3 || !numeric) return null;
    return { cols: cols, score: cols.length };
  }
  function pseudoRow(a, b) {
    var ws = a.words.map(function (w) { return { s: w.s, x0: w.x0, x1: w.x1, xe: w.xe, fs: w.fs, o: 0 }; })
      .concat(b.words.map(function (w) { return { s: w.s, x0: w.x0, x1: w.x1, xe: w.xe, fs: w.fs, o: 1 }; }))
      .sort(function (x, y) { return Math.abs(x.x0 - y.x0) < 6 ? x.o - y.o : x.x0 - y.x0; });
    return { words: ws, fs: Math.max(a.fs, b.fs), y: b.y };
  }
  /* -> { h, span } where span is how many rows the header uses */
  function headerAt(rows, i) {
    var one = headerOf(rows[i]);
    if (one) return { h: one, span: 1 };
    var nx = rows[i + 1];
    if (nx && !headerOf(nx) && nx.y - rows[i].y <= 2.6 * Math.max(rows[i].fs, nx.fs)) {
      var two = headerOf(pseudoRow(rows[i], nx));
      if (two) return { h: two, span: 2 };
    }
    return null;
  }
  var NUM = { amount: 1, 'in': 1, out: 1, balance: 1 };
  function looksTx(r) {
    var w = r.words.slice(0, 5).map(function (x) { return x.s; });
    for (var i = 0; i < w.length; i++) if (isDateText(w[i]) || (i + 1 < w.length && isDateText(w[i] + ' ' + w[i + 1]))) return true;
    return false;
  }

  /* ---------- columns, using the table body to learn alignment ---------- */
  function edge(w, align) { return align === 'right' ? (w.xe !== undefined ? w.xe : w.x1) : w.x0; }
  function buildColumns(hdr, bodyRows) {
    var cols = hdr.cols.map(function (c) { return { label: c.label, role: c.role, x0: c.x0, x1: c.x1, num: !!NUM[c.role], align: 'left', anchor: c.x0 }; });
    var numCols = cols.filter(function (c) { return c.num; });
    numCols.forEach(function (c) { c.lefts = []; c.rights = []; });
    bodyRows.forEach(function (r) {
      r.words.forEach(function (w) {
        if (!isAmountText(w.s)) return;
        var best = null, bd = 1e9;
        numCols.forEach(function (c) { var d = w.x1 < c.x0 ? c.x0 - w.x1 : w.x0 > c.x1 ? w.x0 - c.x1 : 0; if (d < bd) { bd = d; best = c; } });
        if (best && bd <= 70) { best.lefts.push(w.x0); best.rights.push(edge(w, 'right')); }
      });
    });
    /* the edge where most amounts line up (within 1.5 points) wins; a few stray amounts cannot tip it */
    function dominant(a) {
      var best = null, n = 0;
      a.forEach(function (v) { var k = a.filter(function (x) { return Math.abs(x - v) <= 1.5; }).length; if (k > n) { n = k; best = v; } });
      return { n: n, at: best === null ? null : median(a.filter(function (x) { return Math.abs(x - best) <= 1.5; })) };
    }
    numCols.forEach(function (c) {
      var L = dominant(c.lefts), R = dominant(c.rights);
      if (c.rights.length >= 3 && L.n > R.n) { c.align = 'left'; c.anchor = L.at; }
      else { c.align = 'right'; c.anchor = R.at !== null ? R.at : c.x1; }
      c.samples = c.rights.length; delete c.lefts; delete c.rights;
    });
    var anchors = numCols.map(function (c) { return c.anchor; }).sort(function (a, b) { return a - b; }), pitch = 1e9;
    for (var i = 1; i < anchors.length; i++) pitch = Math.min(pitch, anchors[i] - anchors[i - 1]);
    if (anchors.length < 2) pitch = 180;
    var textCols = cols.filter(function (c) { return !c.num; }).sort(function (a, b) { return a.x0 - b.x0; });
    textCols.forEach(function (c, i) { c.bound = i < textCols.length - 1 ? (c.x1 + textCols[i + 1].x0) / 2 : 1e9; });
    return { cols: cols, numCols: numCols, textCols: textCols, tol: Math.max(14, pitch / 2) };
  }
  function cellsOf(row, m) {
    var cells = {};
    m.cols.forEach(function (c) { cells[c.role] = ''; });
    row.words.forEach(function (w) {
      var target = null;
      if (isAmountText(w.s)) {
        var best = null, bd = 1e9;
        m.numCols.forEach(function (c) { var d = Math.abs(edge(w, c.align) - c.anchor); if (d < bd) { bd = d; best = c; } });
        if (best && bd <= m.tol) target = best;
      }
      if (!target) {
        var cx = (w.x0 + w.x1) / 2;
        for (var i = 0; i < m.textCols.length; i++) { if (cx < m.textCols[i].bound) { target = m.textCols[i]; break; } }
        if (!target) target = m.textCols[m.textCols.length - 1];
      }
      if (target) cells[target.role] = cells[target.role] ? cells[target.role] + ' ' + w.s : w.s;
    });
    return cells;
  }

  /* ---------- the statement's own summary box ---------- */
  var RX_OPEN = /(previous|opening|beginning|prior)( statement)? balance|balance (forward|brought forward)|brought forward|solde (precedent|d'ouverture)/;
  var RX_CLOSE = /\b(new|closing|ending|account|statement) balance|solde (final|de fermeture|actuel)/;
  var RX_SKIP = /limit|available|minimum|due\b|rate\b|points|%|total (minimum|payment)/;
  function cleanLabel(ws) { return norm(ws.map(function (l) { return l.s; }).join(' ')).replace(/[,:]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function segmentsOf(row, pageN) {
    var segs = [], label = [], x0 = null, sign = null, prevEnd = null, gapMax = Math.max(24, (row.fs || 8) * 5);
    row.words.forEach(function (w) {
      var money = parseMoney(w.s), marker = /^[-+=−–]$/.test(w.s);
      if (!money && !marker && prevEnd !== null && w.x0 - prevEnd > gapMax) { label = []; x0 = null; sign = null; }   // a new column of text starts
      prevEnd = w.x1;
      if (marker) { sign = w.s === '+' ? '+' : w.s === '=' ? '=' : '-'; return; }
      if (/^[?*†‡]+$/.test(w.s)) return;
      if (money) { segs.push({ label: cleanLabel(label), ws: label.slice(), sign: sign, c: money.c, x0: x0 === null ? w.x0 : x0, xe: w.xe, y: row.y, page: pageN, fs: row.fs }); label = []; x0 = null; sign = null; return; }
      if (x0 === null) x0 = w.x0;
      label.push({ s: w.s, x0: w.x0 });
    });
    return segs;
  }
  function signFor(seg, conv) {
    if (seg.sign === '+') return 1;
    if (seg.sign === '-') return -1;
    var L = seg.label;
    if (/^less\b/.test(L)) return -1;
    if (/^plus\b/.test(L)) return 1;
    var isIn = /payment|credit|deposit|refund|rebate|reward/.test(L), isOut = /purchase|withdraw|debit|fee|interest|charge|advance|cash|transfer/.test(L);
    if (isIn && !isOut) return conv === 1 ? 1 : -1;
    if (isOut && !isIn) return conv === 1 ? -1 : 1;
    return 0;
  }
  /* opening + (signed parts) = closing, trying the chequing and the card sign conventions; parts with unknown sign try both */
  function arithmetic(block) {
    if (!block.parts.length) return { ok: 0, conv: 0 };
    var res = -1, convHit = 0;
    [1, 2].forEach(function (conv) {
      if (res === 1) return;
      var fixed = 0, unknown = [];
      block.parts.forEach(function (p) { var s = signFor(p, conv); if (s) fixed += s * Math.abs(p.c); else unknown.push(Math.abs(p.c)); });
      if (unknown.length > 10) return;
      for (var mask = 0; mask < (1 << unknown.length); mask++) {
        var sum = fixed;
        unknown.forEach(function (u, i) { sum += (mask >> i & 1) ? u : -u; });
        if (block.open.c + sum === block.close.c) { res = 1; convHit = conv; return; }
      }
    });
    return { ok: res, conv: convHit };
  }
  function findSummary(allRows) {
    var segs = [];
    allRows.forEach(function (pr) { pr.rows.forEach(function (r) { if (!r.kind || r.kind === 'before' || r.kind === 'after' || r.kind === 'other' || r.kind === 'furniture') segs = segs.concat(segmentsOf(r, pr.page)); }); });
    var blocks = [];
    /* a labels row ("OCT 9 BALANCE   OCT 99 BALANCE") with the amounts on the row below is handled as opening/closing */
    var groups = [];
    segs.forEach(function (s) {
      var g = groups.filter(function (g) { return g.page === s.page && Math.abs(g.xe - s.xe) <= 10; })[0];
      if (!g) { g = { page: s.page, xe: s.xe, segs: [] }; groups.push(g); }
      g.segs.push(s);
    });
    groups.forEach(function (g) {
      /* labels in one column start at the same x: drop text further left (the neighbouring column running up against this one) */
      if (g.segs.length >= 3) {
        var cands = [], need = Math.ceil(g.segs.length * 0.6), pick = null;
        g.segs.forEach(function (s) { s.ws.forEach(function (w) { cands.push(w.x0); }); });
        cands.sort(function (a, b) { return a - b; });
        for (var ci = 0; ci < cands.length && pick === null; ci++) {
          var cx = cands[ci];
          if (g.segs.filter(function (s) { return s.ws.some(function (w) { return Math.abs(w.x0 - cx) <= 6; }); }).length >= need) pick = cx;
        }
        if (pick !== null) g.segs.forEach(function (s) { var kept = s.ws.filter(function (w) { return w.x0 >= pick - 6; }); if (kept.length) s.label = cleanLabel(kept); });
      }
      g.segs.sort(function (a, b) { return a.y - b.y; });
      var open = null, parts = [];
      g.segs.forEach(function (s) {
        if (RX_OPEN.test(s.label) && !RX_CLOSE.test(s.label)) { open = s; parts = []; }
        else if (open && RX_CLOSE.test(s.label)) { blocks.push({ open: open, close: s, parts: parts, page: s.page, y: open.y }); open = null; parts = []; }
        else if (open && !RX_SKIP.test(s.label) && s.y - (parts.length ? parts[parts.length - 1].y : open.y) <= s.fs * 4) parts.push(s);
        else if (open && s.y - (parts.length ? parts[parts.length - 1].y : open.y) > s.fs * 4) { open = null; parts = []; }
      });
    });
    /* two balances side by side, dated: "Oct 1 balance"  "Oct 31 balance" */
    allRows.forEach(function (pr) {
      var byY = {};
      segs.filter(function (s) { return s.page === pr.page && /^[a-z]{3,9}\.? \d{1,2},?( \d{4})? balance$/.test(s.label); }).forEach(function (s) { var k = Math.round(s.y); (byY[k] = byY[k] || []).push(s); });
      Object.keys(byY).forEach(function (k) { var a = byY[k].sort(function (p, q) { return p.x0 - q.x0; }); if (a.length >= 2) blocks.push({ open: a[0], close: a[a.length - 1], parts: [], page: pr.page, y: a[0].y }); });
    });
    /* amounts printed on the row below the labels */
    allRows.forEach(function (pr) {
      pr.rows.forEach(function (r, i) {
        var nx = pr.rows[i + 1]; if (!nx || r.kind && r.kind !== 'before' && r.kind !== 'after' && r.kind !== 'other') return;
        var txt = norm(r.text);
        var m = txt.match(/([a-z]{3,9}\.? \d{1,2},?( \d{4})?) balance +([a-z]{3,9}\.? \d{1,2},?( \d{4})?) balance$/);
        if (!m) return;
        var am = nx.words.filter(function (w) { return parseMoney(w.s); });
        if (am.length >= 2) blocks.push({ open: { c: parseMoney(am[0].s).c }, close: { c: parseMoney(am[am.length - 1].s).c }, parts: [], page: pr.page, y: r.y });
      });
    });
    blocks.sort(function (a, b) { return a.page - b.page || a.y - b.y; });
    return blocks.map(function (b) { var a = arithmetic(b); b.ok = a.ok; b.conv = a.conv; return b; });
  }

  /* ---------- whole document ---------- */
  /* opts.collect: also keep the lines themselves (for importing). The shareable export never asks for this, so no statement text can reach it. */
  function analyze(pages, opts) {
    var sink = opts && opts.collect ? { lines: [], balRows: [], others: [], totals: [], preamble: [], years: {}, balSign: 0 } : null;
    var diag = { pages: pages.length, textPages: 0, rows: 0, header: null,
      counts: { tx: 0, cont: 0, bal: 0, total: 0, datedNoAmount: 0, furniture: 0, before: 0, after: 0, other: 0, repeatedHeader: 0 },
      samples: { date: [], amount: [], balance: [] },
      balance: { present: false, checked: 0, consistent: 0, mismatches: [], sign: 0, closing: 0 },
      totals: { checked: 0, ok: 0, bad: [] },
      summary: { found: 0, blocks: 0, parts: 0, arithmetic: 0, conv: 0, openingMatch: 0, closingMatch: 0, netMatch: 0 },
      notes: [] };
    var perPage = pages.map(function (p) { var r = rowsOf(p); if (p.items.some(function (i) { return i.s.trim(); })) diag.textPages++; return r; });
    pages.forEach(function (p) {
      if (!p.items.some(function (it) { return it.s.trim(); })) diag.notes.push({ code: 'no-text-layer', page: p.n });
      if (p.items.some(function (it) { return it.rot; })) diag.notes.push({ code: 'rotated-text', page: p.n });
    });
    perPage.forEach(function (r) { diag.rows += r.length; });

    var hdr = null, hdrPage = -1, hdrRow = -1;
    perPage.forEach(function (rows, pi) {
      rows.forEach(function (r, ri) { if (hdr) return; var ha = headerAt(rows, ri); if (ha) { hdr = ha.h; hdrPage = pi; hdrRow = ri + ha.span - 1; } });
    });
    if (!hdr) { diag.notes.push({ code: 'no-table-header' }); }
    if (sink) perPage.forEach(function (rows, pi) {
      rows.forEach(function (r, ri) {
        (r.text.match(/\b20\d\d\b/g) || []).forEach(function (y) { sink.years[y] = (sink.years[y] || 0) + 1; });
        var above = !hdr || pi < hdrPage || (pi === hdrPage && ri < hdrRow);
        if ((above && pi === 0) || /(account|card)\s*(number|no\b|#)/i.test(r.text) || /statement\s*(period|date)|period\b/i.test(r.text)) sink.preamble.push(r.text);
      });
    });

    /* lines that repeat on several pages (page headers, footers) */
    var seen = {};
    perPage.forEach(function (rows, pi) { rows.forEach(function (r) { var k = r.text.replace(/\d/g, '9') + '|' + Math.round(r.y / 4); (seen[k] = seen[k] || {})[pi] = 1; r.fkey = k; }); });
    function isFurniture(r) { return Object.keys(seen[r.fkey]).length >= 2; }

    var chain = [], txIndex = {}, hasBal = false, model = null, has = {};
    var tableOpen = null, tableClose = null, net = 0, hasNet = false, totalIdx = 0;
    var run = 0, allPos = 0, allNeg = 0;
    if (hdr) {
      var body = [];
      perPage.forEach(function (rows, pi) { rows.forEach(function (r, ri) { if (pi > hdrPage || (pi === hdrPage && ri > hdrRow)) body.push(r); }); });
      var sample = body.filter(looksTx);   // learn alignment from transaction-looking rows only (not rate tables or notes)
      model = buildColumns(hdr, sample.length >= 3 ? sample : body);
      diag.header = { page: pages[hdrPage].n, y: Math.round(perPage[hdrPage][hdrRow].y), cols: model.cols.map(function (c) { return { label: c.label, role: c.role, align: c.num ? c.align : 'left', x0: Math.round(c.x0), x1: Math.round(c.x1), samples: c.samples || 0 }; }) };
      model.cols.forEach(function (c) { has[c.role] = true; });
      hasBal = !!has.balance;

      var BAL = /(opening|previous|forward|brought|beginning|closing|ending|ouverture|fermeture|solde|balance)/i;
      var lastKind = null, lastY = -1e9, lastTableY = null, inTable = true, skip = 0;
      perPage.forEach(function (rows, pi) {
        /* on later pages, lines above a repeated header are page headers, not table */
        var topHdr = -1;
        if (pi > hdrPage) rows.some(function (r, ri) { var ha = headerAt(rows, ri); if (ha && ha.h.score >= hdr.score - 1) { topHdr = ri; return true; } return false; });
        lastTableY = null; lastKind = null; skip = 0;
        if (pi > hdrPage) inTable = topHdr >= 0;
        rows.forEach(function (r, ri) {
          if (pi < hdrPage || (pi === hdrPage && ri <= hdrRow)) { if (pi === hdrPage && ri === hdrRow) { lastTableY = r.y; inTable = true; } return; }
          if (skip > 0) { skip--; return; }
          var ha = headerAt(rows, ri);
          if (ha && ha.h.score >= hdr.score - 1) { diag.counts.repeatedHeader++; skip = ha.span - 1; inTable = true; lastKind = null; lastTableY = r.y; return; }
          if (ri < topHdr) { r.kind = 'before'; diag.counts.before++; return; }
          var cells = cellsOf(r, model), hasDate = isDateText(cells.date || ''), pa = parseMoney(cells.amount || ''), po = parseMoney(cells.out || ''), pin = parseMoney(cells['in'] || ''), pb = parseMoney(cells.balance || '');
          var money = pa || po || pin, descText = (cells.desc || '').trim(), kind;
          if (hasDate && money) kind = 'tx';
          else if (pb && !money && BAL.test(descText + ' ' + (cells.date || ''))) kind = 'bal';
          else if (!hasDate && money && (/total/i.test(descText + ' ' + (cells.ref || '')) || (inTable && lastTableY !== null && r.y - lastTableY <= r.fs * 3.2 && /total/i.test((cells.date || '') + ' ' + (cells.date2 || ''))))) kind = 'total';   // the label can sit in the date columns ("Total of | Payments"), but only right under table lines, so a summary box further down is never mistaken for a section total
          else if (hasDate) kind = 'datedNoAmount';
          else if (!money && !pb && descText && (lastKind === 'tx' || lastKind === 'cont') && r.y - lastY <= r.fs * 2.6) kind = 'cont';
          else kind = 'other';
          if (kind === 'other') {
            if (lastTableY !== null && r.y - lastTableY > r.fs * 3.2) inTable = false;
            kind = isFurniture(r) ? 'furniture' : inTable ? 'other' : 'after';
          } else inTable = true;
          r.kind = kind; diag.counts[kind]++;
          if (kind === 'tx') {
            txIndex[pi] = (txIndex[pi] || 0) + 1;
            diag.samples.date.push(cells.date);
            if (pa) diag.samples.amount.push(cells.amount);
            if (po) diag.samples.amount.push(cells.out);
            if (pin) diag.samples.amount.push(cells['in']);
            var signed = pa ? (pa.cr && !hasBal ? -Math.abs(pa.c) : pa.c) : (pin ? Math.abs(pin.c) : 0) - (po ? Math.abs(po.c) : 0);
            net += signed; hasNet = true; run += signed; if (signed > 0) allPos += signed; else allNeg -= signed;
            chain.push({ page: pages[pi].n, n: txIndex[pi], amt: pa ? pa.c : null, out: po ? Math.abs(po.c) : 0, inn: pin ? Math.abs(pin.c) : 0, bal: pb });
            if (sink) sink.lines.push({ page: pages[pi].n, n: txIndex[pi], date: cells.date || '', date2: cells.date2 || '', desc: descText, ref: cells.ref || '', c: signed, single: !!pa && !po && !pin, bal: pb ? pb.c : null, conts: [] });
          } else if (kind === 'datedNoAmount') {
            if (sink) sink.lines.push({ page: pages[pi].n, n: 0, date: cells.date || '', date2: cells.date2 || '', desc: descText, ref: cells.ref || '', c: null, single: false, bal: null, conts: [], noAmount: true });
          } else if (kind === 'cont') {
            if (sink && sink.lines.length) sink.lines[sink.lines.length - 1].conts.push(descText);
          } else if (kind === 'other') {
            if (sink) sink.others.push({ page: pages[pi].n, text: r.text });
          } else if (kind === 'bal') {
            var closing = /closing|ending|fermeture|new balance|final/i.test(descText);
            if (sink) sink.balRows.push({ page: pages[pi].n, closing: closing, c: pb.c, text: r.text });
            if (!closing && !chain.length && !tableOpen) tableOpen = pb;
            if (closing) tableClose = pb;
            chain.push({ ref: true, closing: closing, bal: pb });
          } else if (kind === 'total') {
            var tv = pa || po || pin, v = Math.abs(tv.c); diag.totals.checked++; totalIdx++;
            if (sink) sink.totals.push({ page: pages[pi].n, n: totalIdx, c: tv.c, text: r.text });
            if (v === Math.abs(run)) { diag.totals.ok++; run = 0; }
            else if (v === allPos || v === allNeg || v === Math.abs(net)) diag.totals.ok++;
            else diag.totals.bad.push({ n: totalIdx });
          }
          if (pb) diag.samples.balance.push(cells.balance);
          if (kind === 'tx' || kind === 'cont' || kind === 'bal' || kind === 'total') { lastTableY = r.y; }
          lastKind = kind === 'tx' || kind === 'cont' ? kind : null; lastY = r.y;
        });
      });
    }

    /* the statement's own summary box */
    var blocks = findSummary(perPage.map(function (rows, i) { return { rows: rows, page: pages[i].n }; }));
    var sm = diag.summary;
    if (blocks.length) {
      var main = blocks.filter(function (b) { return b.ok === 1; })[0] || blocks.slice().sort(function (a, b) { return b.parts.length - a.parts.length; })[0];
      sm.found = 1; sm.blocks = blocks.length; sm.parts = main.parts.length; sm.arithmetic = main.ok; sm.conv = main.conv;
      if (hdr) {
        var tOpen = tableOpen ? tableOpen.c : null, lastBal = null;
        chain.forEach(function (c) { if (c.bal) lastBal = c.bal.c; });
        var tClose = tableClose ? tableClose.c : lastBal;
        if (tOpen !== null) sm.openingMatch = tOpen === main.open.c ? 1 : -1;
        if (tClose !== null && hasBal) sm.closingMatch = tClose === main.close.c ? 1 : -1;
        if (hasNet) { var delta = main.close.c - main.open.c; sm.netMatch = (delta === net || delta === -net) ? 1 : -1; }
        if (!chain.some(function (c) { return c.ref; }) || (chain[0] && !chain[0].ref)) chain.unshift({ ref: true, closing: false, bal: { c: main.open.c }, fromSummary: true });
        if (hasBal && !tableClose && lastBal !== null) { /* closing check below uses the summary */ }
      }
    }

    /* running balance: does each printed balance equal the previous balance plus the movements in between? */
    var bd = diag.balance; bd.present = hasBal && chain.some(function (c) { return c.bal && !c.ref; });
    if (bd.present) {
      var best = null, single = has.amount && !has.out && !has['in'];
      (single ? [1, -1] : [1]).forEach(function (sg) {
        var res = runBalance(chain, sg);
        if (!best || res.ok > best.ok) { best = res; best.sign = sg; }
      });
      bd.checked = best.checked; bd.consistent = best.ok; bd.mismatches = best.bad; bd.sign = single ? best.sign : 0; bd.closing = best.closing;
    }
    if (sink) { sink.balSign = bd.sign; sink.hasBal = hasBal; sink.cols = model ? model.cols.map(function (c) { return c.role; }) : []; sink.opening = tableOpen ? tableOpen.c : null; diag.collected = sink; }
    return diag;
  }
  function runBalance(chain, sg) {
    var last = null, alt = null, acc = 0, checked = 0, ok = 0, bad = [], closing = 0;
    chain.forEach(function (c) {
      if (c.ref) {
        if (c.closing && last !== null) closing = (last + acc === c.bal.c) ? 1 : -1;
        last = c.bal.c; alt = null; acc = 0; return;
      }
      var ch = c.amt !== null ? sg * c.amt : c.inn - c.out;
      acc += ch;
      if (c.bal) {
        if (last !== null) {
          checked++;
          var expect = last + acc;
          if (expect === c.bal.c) { ok++; alt = null; }
          else if (alt !== null && alt + acc === c.bal.c) { ok++; alt = null; }   // the balance before this was a one-off misprint
          else { bad.push({ page: c.page, row: c.n }); alt = expect; }
        }
        last = c.bal.c; acc = 0;
      }
    });
    return { checked: checked, ok: ok, bad: bad, closing: closing };
  }

  /* ---------- text picture of an exported page: rows of text placed by position ---------- */
  function textPicture(page) {
    var rows = rowsOf({ items: page.items.map(function (i) { return { s: i.t, x: i.x, y: i.y, w: i.w, fs: i.fs, rot: i.rot }; }) });
    var cw = [];
    page.items.forEach(function (i) { if (i.t.length >= 4 && !i.rot) cw.push(i.w / i.t.length); });
    var charW = Math.max(2.5, median(cw) || 5), minX = 1e9;
    page.items.forEach(function (i) { if (i.x < minX) minX = i.x; });
    return rows.map(function (r) {
      var line = '';
      r.items.slice().sort(function (a, b) { return a.x - b.x; }).forEach(function (it) {
        var col = Math.max(Math.round((it.x - minX) / charW), line.length ? line.length + 1 : 0);
        while (line.length < col) line += ' ';
        line += it.s;
      });
      var y = String(Math.round(r.y)); while (y.length < 4) y = ' ' + y;
      return y + ' | ' + line;
    });
  }

  /* analyze + the lines themselves: { diag, lines, balRows, others, totals, preamble, years, balSign, hasBal, cols, opening } */
  function extract(pages) { var d = analyze(pages, { collect: true }), c = d.collected; delete d.collected; c.diag = d; return c; }
  return { analyze: analyze, extract: extract, rowsOf: rowsOf, isDateText: isDateText, parseMoney: parseMoney, isAmountText: isAmountText, textPicture: textPicture, median: median, _headerOf: headerOf, _findSummary: findSummary };
})();
if (typeof module !== 'undefined') module.exports = Layout;
