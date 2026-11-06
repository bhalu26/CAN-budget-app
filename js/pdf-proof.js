/* Proof for a PDF statement, from the statement's own arithmetic. Uses layout.js, which reads the same text pieces a second way and checks:
   the running balance (each printed balance = the one before + the lines between), "Total of..." section totals, the statement's summary box
   (previous balance, purchases, payments, new balance) and the net of the table against that box. Pure: no screen, no pdf.js.
   PdfProof.run(pages) -> null | { checks: [{ ok: true|false|null, text }], failed, proven, flags: { 'page:n': text }, perPage: { page: lines } }
     pages: the text pieces from PdfRead.pages ({ n, width, height, items: [{ str, x, y (up from the bottom), w, h }] })
   PdfProof.status(statement) -> { failed, proven, mustAck }, combining this with the statement's own opening/closing check (Statement.parse().check).
   PdfProof.flagFor(statement, rowIndex) -> text or '' : a line where the printed running balance stops following (to go to Review). */
var PdfProof = (function () {
  'use strict';

  function toLayout(pages) {
    return pages.map(function (p) {
      return { n: p.n, w: p.width, h: p.height, items: p.items.map(function (i) { return { s: i.str, x: i.x, y: p.height - i.y, w: i.w, fs: i.h, rot: 0 }; }) };
    });
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function run(pages) {
    var ext;
    try { ext = Layout.extract(toLayout(pages)); } catch (e) { return null; }
    var d = ext.diag;
    if (!d.header || !ext.lines.length) return null;
    var checks = [], failed = false, proven = false, b = d.balance, t = d.totals, sm = d.summary, flags = {}, perPage = {};
    ext.lines.forEach(function (l) { if (!l.noAmount) perPage[l.page] = (perPage[l.page] || 0) + 1; });
    if (b.present && b.checked) {
      if (b.mismatches.length) {
        failed = true;
        b.mismatches.forEach(function (m) { flags[m.page + ':' + m.row] = 'The printed balance does not follow from the lines above: check this amount against your statement'; });
        checks.push({ ok: false, text: 'Running balance: ' + plural(b.mismatches.length, 'line', 'lines') + ' (page ' + b.mismatches[0].page + ', line ' + b.mismatches[0].row + (b.mismatches.length > 1 ? ' and ' + (b.mismatches.length - 1) + ' more' : '') + ') do not follow from the balance before.' });
      } else { proven = true; checks.push({ ok: true, text: 'Running balance: all ' + b.checked + ' printed balances follow from the lines above' + (b.closing === 1 ? ', and the closing balance matches.' : '.') }); }
      if (b.closing === -1) { failed = true; checks.push({ ok: false, text: 'The closing balance does not match the last balance plus the lines after it.' }); }
    }
    if (t.checked) {
      if (t.bad.length) { failed = true; checks.push({ ok: false, text: 'Section totals: ' + t.bad.length + ' of ' + t.checked + ' do not match the lines above them (total ' + t.bad.map(function (x) { return x.n; }).join(', ') + ').' }); }
      else { proven = true; checks.push({ ok: true, text: 'Section totals: all ' + t.checked + ' "Total of…" lines add up.' }); }
    }
    if (sm.found) {
      if (sm.arithmetic === -1) { failed = true; checks.push({ ok: false, text: 'The statement\'s own summary box does not add up by its own arithmetic.' }); }
      else if (sm.arithmetic === 1) checks.push({ ok: true, text: 'The statement\'s summary box adds up (previous balance, purchases and payments, new balance).' });
      if (sm.netMatch === 1) { proven = true; checks.push({ ok: true, text: 'The lines in the table add up to the movement shown in the summary box.' }); }
      else if (sm.netMatch === -1) { failed = true; checks.push({ ok: false, text: 'The lines in the table do not add up to the movement shown in the summary box: a line may be missing, repeated or misread.' }); }
      if (sm.openingMatch === -1 || sm.closingMatch === -1) { failed = true; checks.push({ ok: false, text: 'The opening or closing balance in the table differs from the summary box.' }); }
    }
    if (d.counts.datedNoAmount) { failed = true; checks.push({ ok: false, text: plural(d.counts.datedNoAmount, 'dated line has', 'dated lines have') + ' no readable amount: check them against your statement.' }); }
    if (!checks.length) checks.push({ ok: null, text: 'Nothing on this statement could prove the numbers (no running balance, section totals or summary box).' });
    return { checks: checks, failed: failed, proven: proven, flags: flags, perPage: perPage };
  }

  function status(st) {
    var p = st && st.proof, c = st && st.check;
    var failed = !!(p && p.failed) || !!(c && !c.ok), proven = !!(p && p.proven) || !!(c && c.ok);
    return { failed: failed, proven: proven, mustAck: failed || !proven };
  }

  /* The statement's rows are in page order; a flagged balance line is matched by page and position, only when both readings found the same number of lines on that page. */
  function flagFor(st, i) {
    var p = st && st.proof; if (!p || !st.rows[i]) return '';
    var page = st.rows[i].page, before = 0, onPage = 0;
    st.rows.forEach(function (r, k) { if (r.page === page) { onPage++; if (k < i) before++; } });
    if (p.perPage[page] !== onPage) return '';
    return p.flags[page + ':' + (before + 1)] || '';
  }

  return { run: run, status: status, flagFor: flagFor };
})();
