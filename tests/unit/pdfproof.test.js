/* PDF proof: the statement's own arithmetic (running balance, "Total of" lines, summary box) on top of the PDF reader (pdf-statement.js).
   Uses the made-up fixture statements in tools/pdf-layout-dump/dev-tools/fixtures. Run: node tests/unit/pdfproof.test.js */
'use strict';
const T = require('./t'), A = require('./harness')(['layout.js', 'pdf-proof.js', 'pdf-statement.js']), fs = require('fs'), path = require('path');
const FIX = path.resolve(__dirname, '../../tools/pdf-layout-dump/dev-tools/fixtures');
const truth = JSON.parse(fs.readFileSync(FIX + '/truth.json', 'utf8'));
// the fixtures hold pieces as the layout tool saw them (y down); the app's reader gives pdf.js's own (y up)
const pagesOf = n => JSON.parse(fs.readFileSync(FIX + '/pages-' + n + '.json', 'utf8')).map(p => ({ n: p.n, width: p.w, height: p.h, items: p.items.map(i => ({ str: i.s, x: i.x, y: p.h - i.y, w: i.w, h: i.fs })) }));
const read = n => { const pages = pagesOf(n), st = A.Statement.parse(pages, '2026-11-06'); st.proof = A.PdfProof.run(pages); return st; };

let st = read('chq'), s = A.PdfProof.status(st);
T.eq(st.rows.length, 40, 'chq: the reader finds 40 lines');
T.ok(st.proof && st.proof.proven && !st.proof.failed && !s.mustAck, 'chq: proven by the running balance, nothing to confirm');
T.ok(st.proof.checks.some(c => c.ok && /Running balance: all 40 printed balances follow/.test(c.text)), 'chq: says so in words');

st = read('chq-wrong'); s = A.PdfProof.status(st);
T.ok(st.check.ok, 'chq-wrong: the reader\'s own opening-to-closing check passes (the lines are right, one printed balance is wrong)');
T.ok(st.proof.failed && s.failed && s.mustAck, 'chq-wrong: the running balance check fails, so the screen asks you to confirm');
const flagged = st.rows.map((r, i) => A.PdfProof.flagFor(st, i)).map((x, i) => x ? i : -1).filter(i => i >= 0);
T.eq(flagged.length, 1, 'chq-wrong: exactly one line is flagged for Review');
T.ok(st.rows[flagged[0]].page === 1 && /does not follow/.test(A.PdfProof.flagFor(st, flagged[0])), 'chq-wrong: the flag says why');

st = read('card'); s = A.PdfProof.status(st);
T.ok(st.check && !st.check.ok && s.failed && s.mustAck, 'card: both the reader and the summary box say the lines do not add up');

st = read('oneline'); s = A.PdfProof.status(st);
T.ok(st.check === null && st.proof.proven && !s.mustAck, 'oneline: the reader alone could not check it (no opening or closing balance); the running balance proves it');
st = read('sumchq-bad'); s = A.PdfProof.status(st);
T.ok(st.check && st.check.ok && s.failed && st.proof.checks.some(c => c.ok === false && /summary box/.test(c.text)), 'sumchq-bad: the reader passes it, the summary box check catches the wrong amount');
st = read('sumchq'); T.ok(!A.PdfProof.status(st).mustAck, 'sumchq: all checks pass');
st = read('cardsum'); s = A.PdfProof.status(st); T.ok(st.check === null && st.proof.proven && !s.mustAck, 'cardsum: no opening/closing for the reader, proven by the summary box and totals');
st = read('cardsum-bad'); T.ok(A.PdfProof.status(st).failed, 'cardsum-bad: wrong totals fail');
st = read('cardsec'); T.ok(!A.PdfProof.status(st).mustAck, 'cardsec: "Total of" lines and the Plus/Less summary add up');
st = read('cardsec-bad'); T.ok(A.PdfProof.status(st).failed, 'cardsec-bad: fails');

// nothing provable: a statement the proof cannot read at all
const none = [{ n: 1, width: 612, height: 792, items: [{ str: 'Hello world', x: 40, y: 700, w: 60, h: 9 }] }];
T.eq(A.PdfProof.run(none), null, 'no table found: no proof is made up');
T.ok(A.PdfProof.status({ check: null, proof: null }).mustAck, 'with no check at all, confirmation is required');
T.ok(!A.PdfProof.status({ check: { ok: true }, proof: null }).mustAck, 'the reader\'s own passing check is enough');
T.ok(A.PdfProof.status({ check: { ok: false }, proof: { proven: true, failed: false } }).failed, 'any failing check counts as failed');

// the app carries its own copy of the layout reader: it must match the tool's
const same = (a, b) => fs.readFileSync(path.resolve(__dirname, '../../' + a)).equals(fs.readFileSync(path.resolve(__dirname, '../../' + b)));
T.ok(same('js/layout.js', 'tools/pdf-layout-dump/js/layout.js'), 'js/layout.js is identical to tools/pdf-layout-dump/js/layout.js');
T.done();
