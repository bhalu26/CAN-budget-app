/* A bank or credit-card statement, from the positioned text of its PDF (PdfRead.pages) to transactions. Pure: no screen, no pdf.js.
   How it reads a statement:
   - Text pieces are grouped into lines by height on the page, and lines into cells by the gaps between pieces.
   - A transaction line starts with a date (or, on statements that print the date once per day, follows one) and has an amount
     on the right. Lines below it with only words continue its description. Totals, balances and page furniture are left out.
   - The columns' headings say what each amount is (withdrawals / deposits / balance / amount). Without headings, a running
     balance settles the sign: the balance went down, so it was money out.
   - The statement period gives dates their year (a December–January statement puts December in the earlier year).
   - Opening and closing balances (previous and new balance on a card) check the whole list: the rows must add up.
   Statement.parse(pages, today) -> { kind: 'bank'|'card', bank, numbers, period, opening, closing, rows, check, notes }
     rows: [{ date: 'YYYY-MM-DD', desc, amount (money in +, money out −), balance, page }] */
var Statement = (function () {
  'use strict';
  var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  function month(w) { w = String(w || '').toLowerCase().replace(/\.$/, ''); return MON[w] || MON[w.slice(0, 3)] && /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*$/.test(w) && MON[w.slice(0, 3)] || 0; }
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var MONTH_RE = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
  /* a date at the very start of the text -> { m, d, y?, len } */
  var DATE_RES = [
    [new RegExp('^(\\d{4})-(\\d{2})-(\\d{2})\\b'), function (x) { return { y: +x[1], m: +x[2], d: +x[3] }; }],
    [new RegExp('^(' + MONTH_RE + ')\\s*(\\d{1,2})(?:,?\\s+(\\d{4}))?\\b', 'i'), function (x) { return { m: month(x[1]), d: +x[2], y: x[3] ? +x[3] : 0 }; }],
    [new RegExp('^(\\d{1,2})\\s*(' + MONTH_RE + ')(?:,?\\s*(\\d{4}))?\\b', 'i'), function (x) { return { m: month(x[2]), d: +x[1], y: x[3] ? +x[3] : 0 }; }],
    [/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, function (x) { var y = x[3] ? +x[3] : 0; if (y && y < 100) y += 2000; return { m: +x[1], d: +x[2], y: y, alt: { m: +x[2], d: +x[1] } }; }]];
  function dateAt(s) {
    s = String(s || '').trim();
    for (var i = 0; i < DATE_RES.length; i++) {
      var x = DATE_RES[i][0].exec(s);
      if (x) { var r = DATE_RES[i][1](x); if (r.m >= 1 && r.m <= 12 && r.d >= 1 && r.d <= 31) { r.len = x[0].length; return r; } }
    }
    return null;
  }
  /* an amount, the whole cell: 1,234.56 · -1,234.56 · (1,234.56) · 1,234.56 CR · $1,234.56- -> { v (positive), neg, cr } */
  var AMT = /^(-|\()?\s*(-)?\s*\$?\s*(-)?\s*(\d{1,3}(?:[,\s]\d{3})+|\d+)\.(\d{2})\s*(\))?\s*(CR|DR|-)?$/i;
  function amountOf(s) {
    var x = AMT.exec(String(s || '').trim()); if (!x) return null;
    var v = +(x[4].replace(/[,\s]/g, '') + '.' + x[5]);
    var cr = !!x[7] && x[7].toUpperCase() === 'CR', neg = !!(x[1] === '-' || x[1] === '(' || x[2] || x[3] || (x[7] === '-'));
    return { v: v, neg: neg, cr: cr };
  }
  /* the first amount written anywhere in a line ("Opening balance on Sep 15, 2026 $6,230.15") */
  function amountIn(s) { var x = /(-|\()?\$?\s?(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})\)?(\s?CR)?/i.exec(s); if (!x) return null; var v = +(x[2].replace(/,/g, '') + '.' + x[3]); return (x[1] || x[4]) ? -v : v; }

  /* ---------- lines and cells ---------- */
  function lines(page) {
    var its = page.items.slice().sort(function (a, b) { return b.y - a.y || a.x - b.x; }), out = [];
    its.forEach(function (it) {
      var ln = out.length ? out[out.length - 1] : null;
      if (ln && Math.abs(ln.y - it.y) <= Math.max(2, Math.min(ln.h, it.h) * 0.4)) ln.items.push(it);
      else out.push({ y: it.y, h: it.h, items: [it] });
    });
    out.forEach(function (ln) {
      ln.items.sort(function (a, b) { return a.x - b.x; });
      var cells = [];
      ln.items.forEach(function (it) {
        var c = cells[cells.length - 1], gap = c ? it.x - c.x1 : 1e9, em = Math.max(it.h, 4);
        if (c && gap < em * 0.9) { c.text += (gap > em * 0.12 && !/\s$/.test(c.text) && !/^\s/.test(it.str) ? ' ' : '') + it.str; c.x1 = Math.max(c.x1, it.x + it.w); }
        else cells.push({ text: it.str, x0: it.x, x1: it.x + it.w });
      });
      cells.forEach(function (c) { c.text = c.text.replace(/\s+/g, ' ').trim(); });
      ln.cells = cells.filter(function (c) { return c.text; });
      ln.text = ln.cells.map(function (c) { return c.text; }).join('  ');
    });
    return out;
  }

  /* ---------- the statement's own facts ---------- */
  var SKIP = /\b(opening|closing|previous|new|ending|beginning|starting|statement) (account )?balance\b|\bbalance (forward|brought forward|carried forward)\b|\btotal\b|\bsub-?total\b|minimum (payment|amount)|payment due|credit limit|available credit|interest rate|annual interest|\bpage \d+ (of|\/) \d+|\bcontinued\b|\bcont'd\b/i;
  function periodOf(text) {
    var D = MONTH_RE + '\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+' + MONTH_RE + ',?\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2}';
    var x = new RegExp('(' + D + ')\\s*(?:to|-|–|—|through|thru)\\s*(' + D + ')', 'i').exec(text);
    var iso = function (s) { var d = dateAt(s); return d && d.y ? d.y + '-' + pad(d.m) + '-' + pad(d.d) : null; };
    if (x) { var a = iso(x[1]), b = iso(x[2]); if (a && b) return { from: a < b ? a : b, to: a < b ? b : a }; }
    var sd = new RegExp('statement date:?\\s*(' + D + ')', 'i').exec(text);
    if (sd && iso(sd[1])) { var to = iso(sd[1]), t = new Date(to + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - 31); return { from: t.toISOString().slice(0, 10), to: to, guessed: true }; }
    return null;
  }
  function balanceOn(lns, re) {
    for (var i = 0; i < lns.length; i++) {
      var t = lns[i].text, m = re.exec(t);
      if (m) { var v = amountIn(t.slice(m.index + m[0].length)); if (v !== null) return v; }
    }
    return null;
  }
  function numbersOf(lns) {
    var out = [];
    lns.forEach(function (ln) {
      if (!/\b(account|card|ending in|acct)\b/i.test(ln.text) || /period|statement date/i.test(ln.text)) return;
      var groups = ln.text.match(/\d[\d-]*\d/g) || [], last = groups.length ? groups[groups.length - 1].replace(/-/g, '') : '';
      if (last.length >= 4 && !/^(19|20)\d\d$/.test(last)) { var l4 = last.slice(-4); if (out.indexOf(l4) < 0) out.push(l4); }
    });
    return out;
  }

  /* ---------- columns from the heading line ---------- */
  function headingOf(ln) {
    var cols = [], kinds = 0;
    ln.cells.forEach(function (c) {
      var t = c.text.toLowerCase(), k = null;
      if (/balance/.test(t)) k = 'balance';
      else if (/withdraw|debit|charges?|purchases?|paid out|money out/.test(t)) k = 'out';
      else if (/deposit|credit|payments?|paid in|money in/.test(t)) k = 'in';
      else if (/amount/.test(t)) k = 'amount';
      else if (/post/.test(t) && /date/.test(t)) k = 'post';
      else if (/date/.test(t)) k = 'date';
      else if (/descr|details|transaction|particulars|activity|merchant/.test(t)) k = 'desc';
      if (k) { cols.push({ kind: k, x0: c.x0, x1: c.x1 }); kinds++; }
    });
    var has = function (k) { return cols.some(function (c) { return c.kind === k; }); };
    return kinds >= 3 && (has('date') || has('post')) && (has('amount') || has('out') || has('in')) ? cols : null;
  }
  function columnFor(cols, cell) {
    var best = null;
    cols.forEach(function (c) {
      if (c.kind === 'date' || c.kind === 'post' || c.kind === 'desc') return;
      var d = Math.min(Math.abs(c.x1 - cell.x1), Math.abs((c.x0 + c.x1) / 2 - (cell.x0 + cell.x1) / 2));
      if (!best || d < best.d) best = { kind: c.kind, d: d };
    });
    return best && best.d < 60 ? best.kind : null;
  }

  /* ---------- the year of a date without one ---------- */
  function withYear(dt, period, today) {
    var y = dt.y, m = dt.m, d = dt.d;
    var iso = function (yy, mm, dd) { return yy + '-' + pad(mm) + '-' + pad(dd); };
    var day = function (s) { return Date.parse(s + 'T00:00:00Z') / 864e5; };
    if (!y) {
      var ref = period ? +period.to.slice(0, 4) : +today.slice(0, 4), best = null;
      [ref, ref - 1, ref + 1].forEach(function (yy) {
        [{ m: m, d: d }].concat(dt.alt && dt.alt.m <= 12 ? [dt.alt] : []).forEach(function (o) {
          var s = iso(yy, o.m, o.d), dist = period ? Math.max(0, day(period.from) - day(s), day(s) - day(period.to)) : Math.max(0, day(s) - day(today)) * 3 + Math.abs(day(today) - day(s)) / 400;
          if (!best || dist < best.dist) best = { s: s, dist: dist };
        });
      });
      return best.s;
    }
    if (dt.alt && period) {   // 03/10/2026: month first, unless only day-first fits the period
      var a = iso(y, m, d), b = iso(y, dt.alt.m, dt.alt.d);
      var inP = function (s) { return s >= period.from && s <= period.to; };
      if (!inP(a) && inP(b)) return b;
    }
    return iso(y, m, d);
  }

  /* ---------- reading the transactions ---------- */
  function parse(pages, today) {
    var all = [], notes = [];
    pages.forEach(function (pg) { lines(pg).forEach(function (ln) { ln.page = pg.n; ln.pageW = pg.width; all.push(ln); }); });
    var text = all.map(function (l) { return l.text; }).join('\n');
    var card = /credit card|\bvisa\b|mastercard|american express|\bamex\b|card number|minimum payment|credit limit|new balance/i.test(text) && !/chequing|checking|savings account|member savings/i.test(text);
    var period = periodOf(text);
    var opening = balanceOn(all, /\b(opening balance|previous (statement )?balance|balance forward|balance brought forward|beginning balance|starting balance)\b/i);
    var closing = balanceOn(all, /\b(closing balance|new balance|ending balance|balance at end|balance carried forward)\b/i);
    var big = (pages[0] ? pages[0].items : []).slice().sort(function (x, y) { return y.h - x.h || y.y - x.y; })[0], bank = big ? big.str.trim() : '';   // the largest text on page 1: usually the bank's name
    var rows = [], cols = null, last = null, inTable = false, lastLine = null;
    all.forEach(function (ln) {
      if (lastLine && ln.page !== lastLine.page) { inTable = false; last = null; }
      var hd = headingOf(ln);
      if (hd) { cols = hd; inTable = true; lastLine = ln; return; }
      var first = ln.cells[0]; if (!first) return;
      var dt = first.x0 < ln.pageW * 0.35 ? dateAt(first.text) : null, rest = dt ? first.text.slice(dt.len).trim() : first.text, post = null;
      var cells = ln.cells.slice(1);
      if (dt) {   // a second date right after the first: the posting date
        var d2 = dateAt(rest) || (!rest && cells[0] ? dateAt(cells[0].text) : null);
        if (d2) { post = d2; if (rest) rest = rest.slice(d2.len).trim(); else { var c0 = cells.shift(); rest = c0.text.slice(d2.len).trim(); } }
      }
      var amts = [], words = rest ? [rest] : [];
      (dt ? cells : ln.cells).forEach(function (c, i) {
        var a = amountOf(c.text);
        if (a && c.x0 > ln.pageW * 0.4) amts.push({ a: a, cell: c });
        else if (!dt && i === 0) return;   // without a date the first cell is the description, handled below
        else if (!a) words.push(c.text);
      });
      if (!dt) words = ln.cells.filter(function (c) { return !(amountOf(c.text) && c.x0 > ln.pageW * 0.4); }).map(function (c) { return c.text; });
      var desc = words.join(' ').replace(/\s+/g, ' ').trim();
      if (SKIP.test(ln.text)) { if (/total|balance/i.test(ln.text)) last = null; lastLine = ln; return; }
      var gapOk = lastLine && lastLine.page === ln.page && (lastLine.y - ln.y) <= Math.max(ln.h, 8) * 2.2;
      if (!amts.length) {   // words only: the description goes on, right under a transaction
        if (last && !dt && gapOk && desc && first.x0 > (last.descX || 0) - 6) last.desc += ' ' + desc;
        else last = null;
        lastLine = ln; return;
      }
      if (!dt && !(inTable && last && desc)) { lastLine = ln; return; }   // an amount with no date: a row of a day already printed, inside the table only
      var row = { date: dt ? withYear(dt, period, today) : last.date, post: post ? withYear(post, period, today) : null, desc: desc, page: ln.page, balance: null, descX: dt ? (rest ? first.x0 : (cells[0] || first).x0) : first.x0 };
      var amount = null;
      amts.forEach(function (o, i) {
        var kind = cols ? columnFor(cols, o.cell) : (amts.length > 1 && i === amts.length - 1 ? 'balance' : 'amount');
        var v = o.a.v, neg = o.a.neg || o.a.cr;
        if (kind === 'balance') { row.balance = neg ? -v : v; return; }
        if (amount !== null) return;
        if (kind === 'out') amount = o.a.cr ? v : -v;
        else if (kind === 'in') amount = neg && !o.a.cr ? -v : v;
        else amount = card ? (neg ? v : -v) : (neg ? -v : v);   // a card's purchases are owed (money out); a bank's minus is money out
      });
      if (amount === null) { lastLine = ln; return; }
      row.amount = Math.round(amount * 100) / 100;
      rows.push(row); last = row; lastLine = ln;
    });
    // a running balance settles the sign where the columns did not
    var prev = card ? null : opening;
    rows.forEach(function (r) {
      if (r.balance !== null && prev !== null) {
        var delta = Math.round((r.balance - prev) * 100) / 100;
        if (Math.abs(Math.abs(delta) - Math.abs(r.amount)) < 0.011 && delta && Math.sign(delta) !== Math.sign(r.amount)) { r.amount = -r.amount; r.signFromBalance = true; }
      }
      if (r.balance !== null) prev = r.balance;
    });
    // the whole statement must add up: opening ± every row = closing
    var check = null;
    if (opening !== null && closing !== null) {
      var flow = rows.reduce(function (s, r) { return s + r.amount; }, 0);
      var expect = Math.round((card ? opening - flow : opening + flow) * 100) / 100;
      var diff = Math.round((closing - expect) * 100) / 100;
      check = { ok: Math.abs(diff) < 0.011, opening: opening, closing: closing, expected: expect, diff: diff, card: card };
    } else notes.push('The statement\'s opening and closing balances were not found, so the list could not be checked against them.');
    if (!period) notes.push('No statement period was found; years were worked out from today\'s date.');
    rows.forEach(function (r) { delete r.descX; });
    return { kind: card ? 'card' : 'bank', bank: bank, numbers: numbersOf(all), period: period, opening: opening, closing: closing, rows: rows, check: check, notes: notes };
  }
  /* as rows of a CSV-like table for the import screen: amounts as a bank shows them (money out negative) */
  function toTable(st) {
    var t = [['Date', 'Description', 'Amount', 'Balance']];
    st.rows.forEach(function (r) { t.push([r.date, r.desc, r.amount.toFixed(2), r.balance === null ? '' : r.balance.toFixed(2)]); });
    return t;
  }
  return { parse: parse, toTable: toTable, lines: lines, dateAt: dateAt, amountOf: amountOf, periodOf: periodOf };
})();
