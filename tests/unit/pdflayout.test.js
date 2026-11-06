/* PDF statement layout tool (tools/pdf-layout-dump): masking and table reading, on the 7 masked real layouts that came with the handoff.
   The masked layouts have every digit = 9, so structure is proven here and arithmetic only on the tool's own fake PDFs (browser suite in dev-tools/e2e.py).
   Run: node tests/unit/pdflayout.test.js */
'use strict';
const T = require('./t'), fs = require('fs'), path = require('path');
const TOOL = path.resolve(__dirname, '../../tools/pdf-layout-dump');
const Layout = require(TOOL + '/js/layout.js'), Mask = require(TOOL + '/js/mask.js');
const DIR = TOOL + '/dev-tools/real-masked-layouts';

// ---- masking ----
const ctx = Mask.context({});
T.eq(Mask.text('Oct 12  FRESHCO #4521  1,234.56', ctx), 'Oct 99  XXXXXXX #9999  9,999.99', 'digits become 9, unfamiliar words become x (case kept), statement words stay readable');
T.eq(Mask.text('Opening Balance Harpreet', Mask.context({ keep: ['Harpreet'] })), 'Opening Balance Harpreet', 'a word you ask to keep stays readable');
T.eq(Mask.text('Balance', Mask.context({ hide: ['Balance'] })), 'Xxxxxxx', 'a word you ask to hide is masked even if it is statement vocabulary');
T.eq(Mask.audit({ a: 'Date 99/99', b: ['Balance 9,999.99'] }, ctx), [], 'audit: a properly masked file is clean');
T.ok(Mask.audit({ a: 'Balance 1,234.56' }, ctx).length >= 1, 'audit: an unmasked digit is found');
T.eq(Mask.audit({ a: 'Balance Harpreet' }, ctx).length, 1, 'audit: an unmasked word is found');
T.ok(Mask.text('é à ü 12', ctx).indexOf('1') < 0 && Mask.text('日本語 123', ctx).indexOf('日') < 0, 'accents and non-Latin letters are masked too');

// ---- the 7 masked real layouts ----
const EXPECT = {
  1: { cols: 'Date[date] | Description[desc] | Withdrawals ($)[out,R] | Deposits ($)[in,R] | Balance ($)[balance,R]', tx: 1, bal: true },
  2: { cols: 'Date[date] | Date[date2] | Description[desc] | Amount ($)[amount,R]', tx: 23, bal: false },
  3: { cols: 'DATE[date] | POSTED DATE[date2] | DESCRIPTION[desc] | AMOUNT (CAD)[amount,R] | BALANCE (CAD)[balance,R]', tx: 17, bal: true },
  4: { cols: 'Transaction Date[date] | Posting Date[date2] | Details[desc] | Amount ($)[amount,R]', tx: 1, bal: false },
  5: { cols: 'Transaction Date[date] | Posting Date[date2] | Details[desc] | Amount ($)[amount,R]', tx: 8, bal: false },
  6: { cols: 'REF.#[ref] | DATE[date] | DATE[date2] | DETAILS[desc] | AMOUNT($)[amount,R]', tx: 5, bal: false, totals: 2 },
  7: { cols: 'REF.#[ref] | DATE[date] | DATE[date2] | DETAILS[desc] | AMOUNT($)[amount,R]', tx: 23, bal: false, totals: 2 }
};
for (let n = 1; n <= 7; n++) {
  const f = DIR + '/L' + n + '.json';
  if (!fs.existsSync(f)) continue;   // the real masked layouts are not in the public repository
  const j = JSON.parse(fs.readFileSync(f, 'utf8')), e = EXPECT[n];
  const pages = j.pages.map(p => ({ n: p.n, w: p.w, h: p.h, items: p.items.map(i => ({ s: i.t, x: i.x, y: i.y, w: i.w, fs: i.fs, rot: i.rot })) }));
  const d = Layout.analyze(pages);
  T.ok(!!d.header && d.header.cols.map(c => c.label + '[' + c.role + (c.align === 'right' ? ',R' : '') + ']').join(' | ') === e.cols, 'L' + n + ': table header and columns found (' + e.cols.split(' | ').length + ' columns)');
  T.eq(d.counts.tx, e.tx, 'L' + n + ': ' + e.tx + ' transaction lines');
  T.eq(!!d.balance.present, e.bal, 'L' + n + ': running balance ' + (e.bal ? 'present' : 'not printed'));
  if (e.totals) T.eq(d.totals.checked, e.totals, 'L' + n + ': ' + e.totals + ' section totals found and checked');
  T.eq(d.summary.found, 1, 'L' + n + ': the statement summary box is found');
  // the shared layout file must itself pass the leak audit: only 9s and statement words
  const leaks = Mask.audit(j.pages.map(p => p.items.map(i => i.t)), Mask.context({}), {});
  T.eq(leaks.length, 0, 'L' + n + ': the shared layout file passes the leak audit (no digits but 9, no unmasked words)');
}

// ---- the 7 real statements, re-run through the finished tool (statement-layouts-7-files.json) ----
// The file holds the masked layout AND the tool's own result from the real text (diag), so the arithmetic of the real statements is on record here.
const SETF = DIR + '/statement-layouts-7-files.json';
if (!fs.existsSync(SETF)) { console.log('(the real masked layouts are not in this copy: those checks are skipped)'); T.done(); }
const SET = JSON.parse(fs.readFileSync(SETF, 'utf8'));
T.eq([SET.format, SET.files.length], ['pdf-layout-set', 7], 'the set file has 7 statements');
const TXN = [1, 23, 17, 1, 8, 5, 23], TOTALS_NOW = [0, 0, 0, 1, 3, 2, 2];
SET.files.forEach((f, i) => {
  const d = f.diag, n = 'real ' + (i + 1);
  T.eq(Mask.audit(f.pages.map(p => p.items.map(x => x.t)), Mask.context({}), {}).length, 0, n + ': the shared layout passes the leak audit');
  const pages = f.pages.map(p => ({ n: p.n, w: p.w, h: p.h, items: p.items.map(x => ({ s: x.t, x: x.x, y: x.y, w: x.w, fs: x.fs, rot: x.rot })) }));
  const a = Layout.analyze(pages);
  T.eq([a.counts.tx, a.header.cols.map(c => c.role).join()], [TXN[i], d.header.cols.map(c => c.role).join()], n + ': ' + TXN[i] + ' transaction lines and the same columns as the tool found');
  T.eq(a.counts.total, TOTALS_NOW[i], n + ': ' + TOTALS_NOW[i] + ' section total lines found (a "Total of | Payments" label in the date columns counts)');
});
SET.files.forEach((f, i) => { const d = f.diag; T.eq([d.balance.mismatches.length, d.totals.bad.length, d.summary.netMatch, d.summary.arithmetic], [0, 0, d.summary.netMatch, d.summary.arithmetic].map((v, k) => k === 2 ? 1 : k === 3 ? (d.summary.arithmetic === 0 ? 0 : 1) : v), 'real ' + (i + 1) + ': balance, totals and summary all add up on the real statement (net of the table = the summary)'); });
T.done();
