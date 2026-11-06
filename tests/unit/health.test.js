/* Data health: running-balance check, balance-vs-transactions check, duplicates, review, odd lines. Run: node tests/unit/health.test.js */
'use strict';
const T = require('./t'), A = require('./harness')(['accounts.js', 'health.js']);
const clone = o => JSON.parse(JSON.stringify(o));
const H = A.Health, TODAY = '2026-10-23';
let n = 0;
const tx = (o) => Object.assign({ id: 'x' + (n++), type: 'expense', direction: 'out', categoryId: 'groceries', source: 'csv', batchId: 'b1', accountId: 'a1', flags: [] }, o);
const cfg = (extra) => Object.assign({ categories: [{ id: 'groceries', name: 'Groceries', limit: 100, group: 'g' }], groups: [{ id: 'g', name: 'G', kind: 'spending' }], accounts: [{ id: 'a1', name: 'Chequing', type: 'chequing', balances: [] }, { id: 'a2', name: 'Visa', type: 'credit', balances: [] }] }, extra || {});
const kinds = r => r.issues.map(i => i.kind).sort();

// ---- A. running balance inside a file ----
const rows = (list) => list.map((r, i) => ({ date: r[0], amount: r[1], balance: r[2], line: i + 1 }));
const td = rows([['2026-10-01', -45.10, 1200], ['2026-10-03', -20.99, 1179.01], ['2026-10-06', -812.40, 366.61], ['2026-10-10', -61.25, 305.36], ['2026-10-12', 425, 730.36], ['2026-10-12', -61.25, 669.11]]);
let r = H.fileCheck(td);
T.eq([r.ok, r.checked, r.opening, r.closing, r.conv], [true, 5, 1245.1, 669.11, 1], 'TD sample adds up: 5 days checked, opens at $1,245.10, closes at $669.11');
r = H.fileCheck(td.slice().reverse().map((x, i) => Object.assign({}, x, { line: i + 1 })));
T.eq([r.ok, r.closing], [true, 669.11], 'the same file listed newest-first also adds up');
const sameDayOtherOrder = rows([['2026-10-01', -45.10, 1200], ['2026-10-12', -61.25, 669.11], ['2026-10-12', 425, 730.36]]);
T.eq(H.fileCheck(sameDayOtherOrder).ok, false, 'a missing line is caught (Oct 1 → Oct 12 skips $812.40 etc.)');
const gone = td.filter((x, i) => i !== 2);
r = H.fileCheck(gone);
T.eq([r.ok, r.breaks.length, r.breaks[0].date, r.breaks[0].unexplained], [false, 1, '2026-10-10', -812.4], 'one line removed: break on Oct 10, −$812.40 unexplained (money left that the file does not list), later days still check out');
const twice = td.slice(); twice.splice(3, 0, Object.assign({}, td[3], { line: 99 }));
r = H.fileCheck(twice.map((x, i) => Object.assign({}, x, { line: i + 1 })));
T.eq([r.ok, r.breaks[0].unexplained], [false, 61.25], 'a line counted twice: balance moved $61.25 less than the lines say → +$61.25 unexplained');
const visa = rows([['2026-10-02', -30, 130], ['2026-10-05', -20, 150], ['2026-10-09', 100, 50]]);
r = H.fileCheck(visa);
T.eq([r.ok, r.conv], [true, -1], 'a card that lists what is owed (rises with purchases, falls with payments) is understood');
T.eq(H.fileCheck(rows([['2026-10-01', -5, 100]])).checked, 0, 'one line: nothing to check');
T.eq(H.fileCheck([{ date: '2026-10-01', amount: -5, balance: null }, { date: '2026-10-02', amount: -5, balance: null }]).checked, 0, 'no balance column: nothing to check');

// opening balance against the account's last recorded balance
const acct = { id: 'a1', name: 'Chequing', type: 'chequing', balances: [{ date: '2026-09-30', amount: 1245.1, source: 'import' }] };
T.eq(H.openingGap(acct, H.fileCheck(td)), null, 'file starts exactly where the last import ended → no gap');
acct.balances[0].amount = 1300;
const g = H.openingGap(acct, H.fileCheck(td));
T.eq([g.diff, g.prev.amount], [-54.9, 1300], 'file starts $54.90 away from the last recorded balance → lines between are missing');
T.eq(H.openingGap({ id: 'z', type: 'chequing', balances: [{ date: '2026-10-05', amount: 1, source: 'manual' }] }, H.fileCheck(td)), null, 'a recorded balance from inside the file period is not compared');

// ---- B. stored balances against transactions ----
const c1 = cfg();
c1.accounts[0].balances = [{ date: '2026-10-01', amount: 1000, source: 'import' }, { date: '2026-10-20', amount: 700, source: 'import' }];
let txs = [tx({ date: '2026-10-05', amount: 200, desc: 'RENT' }), tx({ date: '2026-10-10', amount: 100, desc: 'SAFEWAY #1' }), tx({ date: '2026-10-01', amount: 5, desc: 'SAME DAY AS BALANCE' })];
T.eq(H.balanceCheck(c1, txs).length, 0, '$1,000 − $200 − $100 = $700: balances agree with lines (a line on the first balance day is already in that balance)');
txs.pop(); txs.push(tx({ date: '2026-10-12', amount: 50, desc: 'CAFE X' }));
let bc = H.balanceCheck(c1, txs);
T.eq([bc.length, bc[0].diff, bc[0].lines], [1, 50, 3], 'an extra $50 line: unexplained difference of $50 (balance did not fall that much)');
c1.accounts[1].balances = [{ date: '2026-10-01', amount: 400, source: 'manual' }, { date: '2026-10-31', amount: 520, source: 'manual' }];
const cardTx = [tx({ accountId: 'a2', date: '2026-10-10', amount: 150 }), tx({ accountId: 'a2', date: '2026-10-15', amount: 30, direction: 'in', type: 'transfer', categoryId: '_transfer' })];
T.eq(H.balanceCheck(c1, txs.concat(cardTx)).filter(b => b.acct.id === 'a2').length, 0, 'card: owed $400 + $150 purchase − $30 payment = $520 → agrees');

// ---- C. duplicates ----
const base = (o) => tx(Object.assign({ date: '2026-10-05', amount: 84.2, desc: 'SAFEWAY #4545' }, o));
let d = H.duplicates([base({ batchId: 'b1' }), base({ batchId: 'b2' })]);
T.eq([d.length, d[0].level], [1, 'high'], 'same day, amount and merchant in two different imports → likely duplicate (high)');
d = H.duplicates([base({ batchId: 'b1', line: 3 }), base({ batchId: 'b1', line: 9 })]);
T.eq([d.length, d[0].level], [1, 'low'], 'twice in the same file → "repeated" only (could be two real purchases)');
d = H.duplicates([base({ source: 'manual', batchId: undefined, desc: 'safeway' }), base({ date: '2026-10-07', batchId: 'b2' })]);
T.eq([d.length, d[0].level], [1, 'medium'], 'typed by hand, bank line two days later → medium');
T.eq(H.duplicates([base({ batchId: 'b1' }), base({ batchId: 'b2', date: '2026-10-20' })]).length, 0, 'same amount two weeks apart: not flagged');
T.eq(H.duplicates([base({ batchId: 'b1' }), base({ batchId: 'b2', amount: 84.21 })]).length, 0, 'a cent different: not flagged');
T.eq(H.duplicates([base({ batchId: 'b1' }), base({ batchId: 'b2', desc: 'NETFLIX' })]).length, 0, 'different merchant: not flagged');
T.eq(H.duplicates([base({ batchId: 'b1' }), base({ batchId: 'b2', direction: 'in' })]).length, 0, 'money out vs money in: not flagged');
T.eq(H.duplicates([base({ batchId: 'b1', linkId: 'L', type: 'transfer', accountId: 'a1' }), base({ batchId: 'b2', linkId: 'L', type: 'transfer', accountId: 'a2' })]).length, 0, 'the two sides of a linked transfer are not duplicates');
d = H.duplicates([base({ batchId: 'b1' }), base({ batchId: 'b2' }), base({ batchId: 'b3' })]);
T.eq([d.length, d[0].ids.length], [1, 3], 'three copies → one group of three');

// ---- D. the whole check ----
const c2 = cfg({ healthIgnore: [] });
const many = [base({ batchId: 'b1' }), base({ batchId: 'b2' }),
  tx({ date: '2026-10-08', amount: 60, desc: 'E-TRANSFER SENT JOHN', needsTag: true, categoryId: null }),
  tx({ date: '2026-10-09', amount: 425, desc: 'CRA REFUND', direction: 'in', type: 'pending', needsTag: true, categoryId: null }),
  tx({ date: '2026-10-10', amount: 30, desc: 'OLD CAT', categoryId: 'deleted-cat' }),
  tx({ date: '2026-12-30', amount: 12, desc: 'LATER' }), tx({ date: '2026-10-11', amount: 0, desc: 'ZERO' })];
for (let i = 0; i < 6; i++) many.push(tx({ date: '2026-0' + (i + 1) + '-15', amount: 20 + i, desc: 'CAFE MOCHA' }));
many.push(tx({ date: '2026-10-12', amount: 400, desc: 'CAFE MOCHA' }));
r = H.check(c2, many, TODAY);
T.eq(kinds(r).filter((k, i, a) => a.indexOf(k) === i), ['category', 'duplicate', 'gap', 'odd', 'review'], 'issue kinds found: category, duplicate, gap (Jul–Sep empty), odd, review');
const rv = r.issues.find(i => i.kind === 'review');
T.eq([rv.level, rv.amount, rv.txIds.length], ['high', 60, 2], 'review: the $60 e-Transfer counts as spending until confirmed (high); the $425 pending refund is not counted');
T.ok(/not counted anywhere yet/.test(rv.detail) && /counted as spending/.test(rv.detail), 'review text says which are counted and which are not');
T.eq(r.issues.filter(i => i.kind === 'odd').map(i => i.key.split('|')[1]).sort(), ['future', 'large', 'zero'], 'odd: future date, $400 vs usual ~$22 coffee, $0 amount');
T.eq(r.issues.find(i => i.kind === 'category').txIds.length, 1, 'a line in a deleted category is found');
T.ok(r.high >= 3, 'high count drives the banner (' + r.high + ')');
// ignore
const dupKey = r.issues.find(i => i.kind === 'duplicate').key;
const r2 = H.check(Object.assign({}, c2, { healthIgnore: [dupKey] }), many, TODAY);
T.eq([r2.ignored, r2.open.length, r2.issues.length], [1, r.open.length - 1, r.issues.length], 'ignored items stay listed (ignored) but leave the open count');
T.ok(r2.issues.filter(i => i.ignored).length === 1 && r2.issues[r2.issues.length - 1].ignored, 'ignored sort last');
// transfers need >1 account; gaps need 3+ months
const tr = [tx({ date: '2026-09-01', amount: 100, type: 'transfer', categoryId: '_transfer', desc: 'PAYMENT THANK YOU', direction: 'in', accountId: 'a2' })];
T.eq(kinds(H.check(c2, tr, TODAY)), ['transfer'], 'a transfer with no other side is flagged when there are two accounts');
T.eq(kinds(H.check(cfg({ accounts: [c2.accounts[0]] }), tr, TODAY)), [], '…but not when there is only one account');
const gaps = ['2026-05-10', '2026-08-10', '2026-09-10'].map(d => tx({ date: d, amount: 10 + n, desc: 'X' + n }));
T.ok(H.check(c2, gaps, TODAY).issues.some(i => i.kind === 'gap' && /Jun/.test(i.title) && /Jul/.test(i.title)), 'gap: June and July missing between May and August');
// group bills
const gb = tx({ id: 'g1', date: '2026-08-10', amount: 120, desc: 'THE KEG', share: 30, categoryId: 'groceries' });
r = H.check(c2, [gb], TODAY);
const old = r.issues.find(i => i.kind === 'group');
T.ok(old && old.level === 'low' && old.amount === 90 && /\$90\.00 still owed to you/.test(old.title), 'an old group bill with $90 still owed is listed (for information)');
T.eq(H.check(c2, [Object.assign(clone(gb), { settled: 90 })], TODAY).issues.filter(i => i.kind === 'group').length, 0, 'paid back in cash: nothing to flag');
T.eq(H.check(c2, [Object.assign(clone(gb), { date: '2026-10-15' })], TODAY).issues.filter(i => i.kind === 'group').length, 0, 'a recent bill is not nagged about');
const badShare = H.check(c2, [Object.assign(clone(gb), { share: 150 })], TODAY).issues.find(i => i.kind === 'group');
T.ok(badShare && badShare.level === 'high' && /does not fit the bill/.test(badShare.title), 'a share bigger than the bill is flagged (high): the whole bill is counted');
const dang = tx({ id: 'd1', date: '2026-10-12', amount: 40, direction: 'in', type: 'exclude', categoryId: '_exclude', repaysId: 'gone', desc: 'E-TRANSFER FROM A' });
T.ok(H.check(c2, [dang], TODAY).issues.some(i => i.kind === 'group' && /no longer exists/.test(i.title)), 'a repayment whose bill was deleted is flagged');
// clean data → nothing
const clean = [tx({ date: '2026-10-02', amount: 20, desc: 'A SHOP' }), tx({ date: '2026-10-03', amount: 31, desc: 'B SHOP' })];
r = H.check(c2, clean, TODAY);
T.eq([r.issues.length, r.high, r.checks.every(c => c.count === 0)], [0, 0, true], 'clean data: no issues, every check shows 0');
T.done();
