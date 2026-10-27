/* Reads a CSV the way a person would: which bank, which account (last 4 digits only),
   and, for a format it has never seen, which column is the date, the description and the amount. */
var Detect = (function () {
  'use strict';

  var BANKS = [
    [/american express|amex/i, 'American Express'], [/wealthsimple/i, 'Wealthsimple'], [/scotia/i, 'Scotiabank'],
    [/\bcibc\b/i, 'CIBC'], [/\brbc\b|royal bank/i, 'RBC'], [/\btd\b|td canada trust/i, 'TD'], [/\bbmo\b|bank of montreal/i, 'BMO'],
    [/tangerine/i, 'Tangerine'], [/eq ?bank/i, 'EQ Bank'], [/simplii/i, 'Simplii'], [/desjardins/i, 'Desjardins'], [/national bank|banque nationale/i, 'National Bank'],
    [/pc financial|president'?s choice/i, 'PC Financial'], [/rogers bank/i, 'Rogers Bank'], [/koho/i, 'KOHO'], [/neo financial/i, 'Neo Financial']
  ];
  /* Known export formats, recognised by their column names. */
  var FORMATS = [
    { name: 'American Express card export', bank: 'American Express', kind: 'card', test: function (h) { return has(h, 'card member') && has(h, 'account #'); } },
    { name: 'American Express card export (short)', bank: 'American Express', kind: 'card', test: function (h) { return h.length === 4 && h[0] === 'date' && h[1] === 'date processed' && h[2] === 'description' && h[3] === 'amount'; } },
    { name: 'Scotiabank export', bank: 'Scotiabank', kind: function (h) { return has(h, 'associated card number') ? 'card' : 'bank'; }, test: function (h) { return has(h, 'filter') && has(h, 'sub-description'); } },
    { name: 'Wealthsimple monthly statement', bank: 'Wealthsimple', kind: 'bank', test: function (h) { return h.join('|') === 'date|transaction|description|amount|balance|currency'; } },
    { name: 'Wealthsimple activity export', bank: 'Wealthsimple', kind: 'bank', test: function (h) { return has(h, 'net_cash_amount') && has(h, 'activity_sub_type'); } },
    { name: 'Credit card export with merchant categories (15 columns)', bank: null, kind: 'card', test: function (h) { return has(h, 'merchant category description') && has(h, 'merchant name') && has(h, 'name on card'); } }
  ];
  function has(h, n) { return h.indexOf(n) >= 0; }

  var ACCT_COL = /card.?(number|no)|account.?(#|number|no)|associated card|account_id|acct|iban|account$/i;

  function dataRows(rows, L) { return rows.slice(L.dataStart).filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); }); }

  /* Last 4 digits from a value like "4520 **** **** 1095" or "XXXX-XXXX-1095". Masked values give nothing. */
  function last4(v) { var d = String(v || '').replace(/[^0-9]/g, ''); return d.length >= 4 ? d.slice(-4) : null; }

  function identify(rows, L, fileName) {
    var out = { bank: null, bankFrom: '', format: null, kind: null, numbers: [], numbersFrom: '', notes: [] };
    var hdr = L.headerIdx >= 0 ? rows[L.headerIdx].map(function (x) { return String(x).trim().toLowerCase(); }) : [];
    FORMATS.some(function (f) { if (hdr.length && f.test(hdr)) { out.format = f.name; out.bank = f.bank; out.kind = typeof f.kind === 'function' ? f.kind(hdr) : f.kind; out.bankFrom = 'column names'; return true; } return false; });
    // Bank name in the lines above the header, or in the file name
    if (!out.bank) {
      var pre = rows.slice(0, Math.max(L.headerIdx, L.dataStart, 0)).map(function (r) { return r.join(' '); }).join(' ');
      [[pre, 'the lines above the table'], [String(fileName || '').replace(/[_\-.]+/g, ' '), 'the file name']].some(function (src) {
        return BANKS.some(function (b) { if (b[0].test(src[0])) { out.bank = b[1]; out.bankFrom = src[1]; return true; } return false; });
      });
    }
    // Account / card number: a dedicated column first, then lines above the table, then the file name
    var counts = {};
    hdr.forEach(function (name, i) {
      if (!ACCT_COL.test(name) || /name on|member|type|status/.test(name)) return;
      dataRows(rows, L).forEach(function (r) { var l = last4(r[i]); if (l) counts[l] = (counts[l] || 0) + 1; });
      if (Object.keys(counts).length && !out.numbersFrom) out.numbersFrom = 'the "' + rows[L.headerIdx][i].trim() + '" column';
    });
    if (!Object.keys(counts).length) {
      var dr = dataRows(rows, L), w = dr.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
      for (var ci = 0; ci < w && !Object.keys(counts).length; ci++) {
        var vals = dr.map(function (r) { return String(r[ci] || '').trim(); }).filter(Boolean);
        var masked = vals.filter(function (v) { return /^[0-9Xx*•\- ]{8,}[0-9]{4}$/.test(v) && /[Xx*•]/.test(v); });
        if (vals.length && masked.length / vals.length > 0.8) { masked.forEach(function (v) { var l = last4(v); counts[l] = (counts[l] || 0) + 1; }); out.numbersFrom = 'column ' + (ci + 1) + ' (masked card numbers)'; }
      }
    }
    if (!Object.keys(counts).length) {
      rows.slice(0, Math.max(L.headerIdx, L.dataStart, 0)).forEach(function (r) {
        var line = r.join(' ');
        var m = /(account|card|acct|compte)[^0-9]{0,20}([0-9][0-9 *xX\-]{3,})/i.exec(line);
        if (m) { var l = last4(m[2]); if (l) { counts[l] = (counts[l] || 0) + 1; out.numbersFrom = 'the lines above the table'; } }
      });
    }
    if (!Object.keys(counts).length && fileName) {
      var fm = /(\d{4,})/.exec(fileName.replace(/20\d\d[-_]?\d\d[-_]?\d\d/g, ''));
      if (fm) { counts[fm[1].slice(-4)] = 1; out.numbersFrom = 'the file name'; }
    }
    out.numbers = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).map(function (k) { return { last4: k, rows: counts[k] }; });
    if (out.numbers.length > 1) out.notes.push(out.numbers.length + ' different card or account numbers in this file (for example two cardholders, or a replacement card).');
    return out;
  }

  /* ---------- working out the columns of an unknown format ---------- */
  function colStats(rows, L) {
    var data = dataRows(rows, L).slice(0, 400), width = L.width || 0;
    data.forEach(function (r) { if (r.length > width) width = r.length; });
    var order = Engine.guessDateOrder(data.map(function (r) { return r[0]; }).concat(data.map(function (r) { return r[1]; })));
    var st = [];
    for (var c = 0; c < width; c++) {
      var vals = data.map(function (r) { return String(r[c] == null ? '' : r[c]).trim(); });
      var filled = vals.filter(function (v) { return v !== ''; }), n = filled.length || 1;
      var nums = filled.map(Engine.parseAmountStr).filter(function (v) { return v !== null; });
      var lower = filled.map(function (v) { return v.toLowerCase(); });
      var distinct = {}; lower.forEach(function (v) { distinct[v] = 1; });
      st.push({
        col: c, filledShare: filled.length / (data.length || 1), filled: filled.length,
        date: filled.filter(function (v) { return Engine.parseDateStr(v, order); }).length / n,
        num: nums.length / n, dec: filled.filter(function (v) { return /[.,]\d{2}\)?(\s*(cr|dr))?$/i.test(v); }).length / n,
        pos: nums.filter(function (v) { return v > 0; }).length / (nums.length || 1), neg: nums.filter(function (v) { return v < 0; }).length / (nums.length || 1),
        dir: lower.filter(function (v) { return Engine.DIR_OUT.test(v) || Engine.DIR_IN.test(v); }).length / n,
        distinct: Object.keys(distinct).length, len: filled.reduce(function (a, v) { return a + v.length; }, 0) / n,
        letters: filled.filter(function (v) { return /[a-z]{3,}/i.test(v); }).length / n,
        name: L.headerIdx >= 0 ? String(rows[L.headerIdx][c] || '').trim() : ''
      });
    }
    return { st: st, rows: data, order: order };
  }
  function label(s) { return s.name ? '"' + s.name + '"' : 'column ' + (s.col + 1); }
  function pct(x) { return Math.round(x * 100) + '%'; }

  /* Start from the header-based guess, then check every choice against the data and fill gaps. */
  function infer(rows) {
    var L = Engine.detectLayout(rows);
    if (L.headerIdx < 0) {
      var plain = function (r) { return r.filter(function (x) { return String(x).trim() !== ''; }).length >= 3 && !r.some(function (x) { return Engine.isDate(x) || Engine.parseAmountStr(x) !== null; }); };
      var hi = -1;
      if (L.dataStart > 0 && plain(rows[L.dataStart - 1] || [])) hi = L.dataStart - 1;
      else if (plain(rows[L.dataStart] || []) && (rows[L.dataStart + 1] || []).some(function (x) { return Engine.isDate(x); })) hi = L.dataStart;
      var first = rows[hi] || [];
      if (hi >= 0) { L.headerIdx = hi; L.dataStart = hi + 1; L.cols = { date: -1, desc: -1, amount: -1, debit: -1, credit: -1 };
        first.forEach(function (x, i) { var t = String(x).toLowerCase(); if (L.cols.desc < 0 && /desc|detail|narrat|memo|payee|merchant|particular/.test(t)) L.cols.desc = i; }); }
    }
    var cs = colStats(rows, L), st = cs.st, explain = [], c = L.cols, changed = false;
    var balanceCols = st.filter(function (s) { return /balance|solde/i.test(s.name); }).map(function (s) { return s.col; });
    var balCol = balanceCols.length ? balanceCols[0] : -1;

    // Date: the header pick must really hold dates
    if (c.date < 0 || !st[c.date] || st[c.date].date < 0.8) {
      var d = st.filter(function (s) { return s.date >= 0.8 && s.filledShare > 0.5; }).sort(function (a, b) { return b.date - a.date || b.filledShare - a.filledShare; })[0];
      if (d) { c.date = d.col; changed = true; }
    }
    if (c.date >= 0) explain.push('Date: ' + label(st[c.date]) + ' (' + pct(st[c.date].date) + ' of rows are dates' + (cs.order === 'DMY' ? ', read as day/month' : '') + ').');

    // Direction flag (Debit / Credit, DR / CR, Inflow / Outflow)
    var dirS = st.filter(function (s) { return s.col !== c.date && s.dir >= 0.9 && s.distinct <= 4 && s.filledShare > 0.5; })[0];
    var dirCol = dirS ? dirS.col : -1;

    // Amounts
    var numeric = st.filter(function (s) { return s.col !== c.date && s.col !== dirCol && balanceCols.indexOf(s.col) < 0 && s.num >= 0.9 && s.filled > 0 && s.letters < 0.1 && (s.dec >= 0.3 || s.distinct > 3); });
    var amountOk = c.amount >= 0 && st[c.amount] && st[c.amount].num >= 0.9 && (st[c.amount].filledShare >= 0.9 || L.headerIdx >= 0);
    if (!amountOk && c.amount >= 0 && L.headerIdx < 0) c.amount = -1;
    var dcOk = (c.debit >= 0 && st[c.debit] && st[c.debit].num >= 0.9) || (c.credit >= 0 && st[c.credit] && st[c.credit].num >= 0.9);
    if (!amountOk && !dcOk) {
      // two numeric columns that are rarely filled on the same row = separate money-out / money-in columns
      var pair = null;
      for (var i = 0; i < numeric.length && !pair; i++) for (var j = i + 1; j < numeric.length && !pair; j++) {
        var a = numeric[i], b = numeric[j], both = 0, either = 0;
        cs.rows.forEach(function (r) { var x = String(r[a.col] || '').trim() !== '', y = String(r[b.col] || '').trim() !== ''; if (x && y) both++; if (x || y) either++; });
        if (either && both / either < 0.1 && a.filledShare < 0.95 && b.filledShare < 0.95) pair = [a, b];
      }
      if (pair) {
        // the column used on most rows is usually money out; a header word wins if there is one
        var out = /credit|deposit|in\b|paid in/i.test(pair[0].name) ? pair[1] : /credit|deposit|in\b|paid in/i.test(pair[1].name) ? pair[0] : (pair[0].filled >= pair[1].filled ? pair[0] : pair[1]);
        var inn = out === pair[0] ? pair[1] : pair[0];
        c.debit = out.col; c.credit = inn.col; c.amount = -1; changed = true;
        explain.push('Money out: ' + label(out) + ', money in: ' + label(inn) + ' (never both on the same row). Check these two are not swapped.');
      } else if (numeric.length) {
        // one amount column; if two fully filled columns, the running balance is the one whose steps match the other
        var pick = numeric[0];
        if (numeric.length > 1) {
          var bal = null;
          numeric.forEach(function (x) { numeric.forEach(function (y) {
            if (bal || x === y) return; var hits = 0, tries = 0;
            for (var k = 1; k < Math.min(cs.rows.length, 60); k++) {
              var b0 = Engine.parseAmountStr(cs.rows[k - 1][x.col]), b1 = Engine.parseAmountStr(cs.rows[k][x.col]), am0 = Engine.parseAmountStr(cs.rows[k - 1][y.col]), am1 = Engine.parseAmountStr(cs.rows[k][y.col]);
              if (b0 === null || b1 === null) continue; tries++;
              if ((am1 !== null && Math.abs(Math.abs(b1 - b0) - Math.abs(am1)) < 0.011) || (am0 !== null && Math.abs(Math.abs(b1 - b0) - Math.abs(am0)) < 0.011)) hits++;
            }
            if (tries > 3 && hits / tries > 0.7) { bal = x; pick = y; }
          }); });
          if (bal) { explain.push('Running balance: ' + label(bal) + ' (the latest one is kept as the account balance).'); balCol = bal.col; }
        }
        c.amount = pick.col; c.debit = -1; c.credit = -1; changed = true;
      }
    }
    if (c.amount >= 0 && st[c.amount]) {
      var s = st[c.amount];
      if (dirCol >= 0 && s.neg < 0.05) explain.push('Amount: ' + label(s) + ', with no sign; money in or out comes from ' + label(st[dirCol]) + '.');
      else { if (dirCol >= 0) dirCol = -1; explain.push('Amount: ' + label(s) + ' (' + pct(s.pos) + ' positive, ' + pct(s.neg) + ' negative).'); }
    } else dirCol = -1;

    // Description: the header pick must be text
    if (c.desc < 0 || !st[c.desc] || st[c.desc].letters < 0.5) {
      var t = st.filter(function (s) { return [c.date, c.amount, c.debit, c.credit, dirCol].indexOf(s.col) < 0 && s.letters >= 0.5 && !ACCT_COL.test(s.name); }).sort(function (a, b) { return (b.distinct * b.len) - (a.distinct * a.len); })[0];
      if (t) { c.desc = t.col; changed = true; }
    }
    if (c.desc >= 0 && st[c.desc]) explain.push('Description: ' + label(st[c.desc]) + '.');

    // Card or bank account? Card exports list purchases as positive.
    var kindGuess = null;
    if (c.amount >= 0 && dirCol < 0 && st[c.amount]) kindGuess = st[c.amount].pos > 0.6 ? 'card' : st[c.amount].neg > 0.5 ? 'bank' : null;
    if (L.headerIdx < 0) explain.unshift('No header row, so columns were worked out from the data.');
    var complete = c.date >= 0 && c.desc >= 0 && (c.amount >= 0 || c.debit >= 0 || c.credit >= 0);
    if (balCol >= 0 && [c.date, c.desc, c.amount, c.debit, c.credit].indexOf(balCol) >= 0) balCol = -1;
    if (balCol < 0) {
      // no header word: a fully filled number column that moves by each line's amount is a running balance
      var amtOf = function (r) {
        if (c.amount >= 0) return Engine.parseAmountStr(r[c.amount]);
        var d = c.debit >= 0 ? Engine.parseAmountStr(r[c.debit]) : null, cr = c.credit >= 0 ? Engine.parseAmountStr(r[c.credit]) : null;
        return d !== null ? d : cr;
      };
      st.forEach(function (x) {
        if (balCol >= 0 || [c.date, c.desc, c.amount, c.debit, c.credit, dirCol].indexOf(x.col) >= 0 || x.num < 0.9 || x.filledShare < 0.95) return;
        var hits = 0, tries = 0;
        for (var k = 1; k < Math.min(cs.rows.length, 60); k++) {
          var b0 = Engine.parseAmountStr(cs.rows[k - 1][x.col]), b1 = Engine.parseAmountStr(cs.rows[k][x.col]), a0 = amtOf(cs.rows[k - 1]), a1 = amtOf(cs.rows[k]);
          if (b0 === null || b1 === null) continue; tries++;
          if ((a1 !== null && Math.abs(Math.abs(b1 - b0) - Math.abs(a1)) < 0.011) || (a0 !== null && Math.abs(Math.abs(b1 - b0) - Math.abs(a0)) < 0.011)) hits++;
        }
        if (tries >= 3 && hits / tries > 0.7) { balCol = x.col; explain.push('Running balance: ' + label(x) + ' (the latest one is kept as the account balance).'); }
      });
    }
    return { L: L, dirCol: dirCol, balCol: balCol, explain: explain, changed: changed, complete: complete, kindGuess: kindGuess, dateOrder: cs.order };
  }

  /* Pick the account: by card/account number first, then by the saved format, else suggest a new one. */
  function matchAccount(cfg, ident, sig) {
    var accts = cfg.accounts || [];
    var nums = ident.numbers.map(function (n) { return n.last4; });
    var byNum = accts.filter(function (a) { return (a.numbers || []).some(function (x) { return nums.indexOf(x) >= 0; }); })[0];
    if (byNum) return { accountId: byNum.id, why: 'number ending ' + nums.filter(function (x) { return (byNum.numbers || []).indexOf(x) >= 0; })[0] };
    var prof = (cfg.profiles || {})[sig];
    var profAcct = prof && accts.filter(function (a) { return a.id === prof.accountId; })[0];
    if (profAcct && (!nums.length || !(profAcct.numbers || []).length)) return { accountId: profAcct.id, why: 'same file format as before' };
    var name = (ident.bank || 'Account') + (ident.kind === 'card' ? ' card' : ident.kind === 'bank' ? ' account' : '') + (nums[0] ? ' ••' + nums[0] : '');
    return { accountId: null, suggestNew: { name: name, kind: ident.kind, numbers: nums, bank: ident.bank }, maybeSame: profAcct || null };
  }

  return { identify: identify, infer: infer, matchAccount: matchAccount, last4: last4 };
})();
