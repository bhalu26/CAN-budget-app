/* Splitting a line across categories. Run: node tests/unit/split.test.js */
'use strict';
const T = require('./t'), A = require('./harness')(['funds.js', 'learn.js', 'accounts.js', 'health.js', 'split.js']);
const S = A.Split, M = A.M, U = A.U, H = A.Health, fx = require('./fixture')(A), TODAY = '2026-10-22';
const cfg = fx.cfg, clone = o => JSON.parse(JSON.stringify(o)), STAMP = '2026-10-23T00:00:00Z';
const costco = () => ({ id: 'c1', date: '2026-10-05', amount: 203.1, desc: 'COSTCO WHOLESALE W123', categoryId: 'groceries', type: 'expense', direction: 'out', source: 'csv', batchId: 'b1', file: 'td.csv', line: 7,
  fp: 'a1|2026-10-05|-203.1|COSTCO WHOLESALE W', account: 'TD chequing', accountId: 'a1', needsTag: true, reviewReason: 'Check this one', flags: [], note: '', createdAt: '2026-10-05T00:00:00Z' });

// can it be split?
T.ok(S.canSplit(costco()).ok, 'a spending line can be split');
T.ok(!S.canSplit({ type: 'transfer', amount: 5 }).ok && /Only spending/.test(S.canSplit({ type: 'income', amount: 5 }).why), 'transfers, income and saving cannot (and it says why)');
T.ok(!S.canSplit(Object.assign(costco(), { fundId: 'f1' })).ok && /big expense/.test(S.canSplit(Object.assign(costco(), { fundId: 'f1' })).why), 'a line paid from a big-expense fund cannot, with the reason');
T.ok(!S.canSplit(Object.assign(costco(), { amount: 0 })).ok, 'a $0 line cannot');

// building parts
let r = S.build(cfg, [costco()], [{ amount: 150.1, cat: 'groceries' }, { amount: 53, cat: 'other-household' }], STAMP);
T.ok(r.ok && r.parts.length === 2, 'two lines that add up to $203.10 → a split of 2');
T.eq(r.parts.map(p => p.amount), [150.1, 53], 'amounts are exact to the cent');
T.eq([r.parts[0].id, r.parts[1].id !== 'c1', r.parts[1].splitGroup], ['c1', true, 'c1'], 'the first part keeps the original id; the other has a new id and joins its group');
const p0 = r.parts[0], p1 = r.parts[1];
T.eq([p1.date, p1.accountId, p1.file, p1.line, p1.fp, p1.batchId, p1.direction, p1.source], ['2026-10-05', 'a1', 'td.csv', 7, 'a1|2026-10-05|-203.1|COSTCO WHOLESALE W', 'b1', 'out', 'csv'], 'every part keeps what the bank said (date, account, file, line, fingerprint, batch)');
T.eq([p0.needsTag, p0.conf, p0.tagWhy, p1.type, p0.splitTotal], [false, 'sure', 'You split this line', 'expense', 203.1], 'parts are reviewed ("You split this line") and remember the bank total');
T.ok(/split 2 of 2 \(bank amount \$203\.10\)/.test(p1.flags.join()), 'a visible flag says "split 2 of 2 (bank amount $203.10)"');
T.eq(r.removeIds, [], 'a new split removes nothing');
T.eq(clone(costco()), JSON.parse(JSON.stringify(costco())), 'the input is not modified');

// refunds keep their sign
const refund = Object.assign(costco(), { id: 'r1', amount: -40, direction: 'in' });
r = S.build(cfg, [refund], [{ amount: 25, cat: 'groceries' }, { amount: 15, cat: 'other-household' }], STAMP);
T.eq(r.parts.map(p => p.amount), [-25, -15], 'a refund (negative) splits into negative parts');

// validation
const bad = (lines) => S.build(cfg, [costco()], lines, STAMP);
let b = bad([{ amount: 100, cat: 'groceries' }, { amount: 53, cat: 'other-household' }]);
T.eq([b.ok, b.remaining, /\$50\.10 is still not placed/.test(b.error)], [false, 5010, true], 'short by $50.10: refused, and says how much is not placed');
b = bad([{ amount: 200, cat: 'groceries' }, { amount: 53, cat: 'other-household' }]);
T.ok(!b.ok && /\$49\.90 over the \$203\.10 total/.test(b.error), 'over by $49.90: refused');
T.ok(!bad([{ amount: 203.1, cat: 'groceries' }]).ok, 'one line is not a split');
T.ok(/Line 2 needs an amount/.test(bad([{ amount: 203.1, cat: 'groceries' }, { amount: 0, cat: 'groceries' }]).error), 'a $0 line is refused');
T.ok(/Line 2 needs a spending category/.test(bad([{ amount: 100, cat: 'groceries' }, { amount: 103.1, cat: '' }]).error), 'a missing category is refused');
T.ok(/Line 2 needs a spending category/.test(bad([{ amount: 100, cat: 'groceries' }, { amount: 103.1, cat: '_transfer' }]).error), 'a transfer or income "category" is refused');
r = S.build(cfg, [costco()], [{ amount: 67.7, cat: 'groceries' }, { amount: 67.7, cat: 'other-household' }, { amount: 67.7, cat: 'clothing' }], STAMP);
T.ok(r.ok && r.parts.reduce((a, p) => a + Math.round(p.amount * 100), 0) === 20310, 'three lines of $67.70 add up exactly');

// shares: rounding goes to the last line so the sum is exact
const sh = S.applyShares(100, [{ cat: 'a', share: 1 / 3 }, { cat: 'b', share: 1 / 3 }, { cat: 'c', share: 1 / 3 }]);
T.eq([sh.map(x => x.amount), Math.round(sh.reduce((a, x) => a + x.amount, 0) * 100)], [[33.33, 33.33, 33.34], 10000], 'thirds of $100 → 33.33, 33.33, 33.34 (the last line takes the odd cent)');

// the same split as last time
const prev = S.build(cfg, [Object.assign(costco(), { id: 'old', date: '2026-09-05', amount: 100 })], [{ amount: 70, cat: 'groceries' }, { amount: 30, cat: 'other-household' }], STAMP).parts;
const sg = S.suggest(prev.concat([costco()]), costco());
T.eq([sg.date, sg.shares.map(x => [x.cat, Math.round(x.share * 100)])], ['2026-09-05', [['groceries', 70], ['other-household', 30]]], 'last time Costco was split 70 / 30 → suggested as shares');
T.eq(S.applyShares(203.1, sg.shares).map(x => x.amount), [142.17, 60.93], 'applied to $203.10 → $142.17 + $60.93 (sums to the cent)');
const skewed = clone(prev); skewed[0].amount = 100;   // parts edited after the split: 100 + 30 against a recorded total of 100
T.eq(S.suggest(skewed.concat([costco()]), costco()).shares.map(x => Math.round(x.share * 100)), [77, 23], 'shares come from the parts, so they still add to 100% even if the split was edited later');
T.eq(S.suggest([costco()], costco()), null, 'no earlier split of this merchant → no suggestion');

// change the split: replaces the group, keeps the id
const first = S.build(cfg, [costco()], [{ amount: 150.1, cat: 'groceries' }, { amount: 53, cat: 'other-household' }], STAMP).parts;
const group = S.groupOf(first, first[1]);
T.eq(group.map(p => p.id), first.map(p => p.id), 'groupOf finds every part from any part');
T.eq(S.totalOf(group), 203.1, 'the total being divided is the bank amount');
r = S.build(cfg, group, [{ amount: 100, cat: 'groceries' }, { amount: 53.1, cat: 'other-household' }, { amount: 50, cat: 'clothing' }], STAMP);
T.ok(r.ok && r.parts[0].id === 'c1' && r.parts.length === 3, 'change to three lines: the original id is kept');
T.eq(r.removeIds, [first[1].id], 'the old second part is removed (its row is replaced)');
// join back
const j = S.join(cfg, first, 'groceries', STAMP);
T.eq([j.tx.id, j.tx.amount, j.tx.categoryId, j.tx.splitGroup, j.tx.needsTag, j.removeIds], ['c1', 203.1, 'groceries', undefined, true, [first[1].id]], 'join back: one $203.10 line, original id, flagged for a category check');

// budget effect: category totals move, total spent and left-to-spend arithmetic stay put
const txs = clone(fx.txs), sh1 = txs.find(t => t.desc === 'SAFEWAY #4545' && t.date === '2026-05-05');
const before = M.month(cfg, txs, '2026-05', TODAY);
const parts = S.build(cfg, [Object.assign(sh1, { fp: 'x' })], [{ amount: Math.round(sh1.amount * 0.7 * 100) / 100, cat: 'groceries' }, { amount: Math.round((sh1.amount - Math.round(sh1.amount * 0.7 * 100) / 100) * 100) / 100, cat: 'other-household' }], STAMP);
T.ok(parts.ok, 'split a fixture Safeway line');
const txs2 = txs.filter(t => t.id !== sh1.id).concat(parts.parts), after = M.month(cfg, txs2, '2026-05', TODAY);
T.eq(after.spent, before.spent, 'month total spent is unchanged by the split');
T.eq(after.left, before.left, '…and so is left to spend');
const spentIn = (m, id) => (m.groups.flatMap(g => g.rows).concat(m.bills.map(b => ({ cat: b.cat, spent: b.spent }))).find(r => r.cat.id === id) || { spent: 0 }).spent;
T.eq(U.round2(spentIn(before, 'groceries') - spentIn(after, 'groceries')), parts.parts[1].amount, 'Groceries went down by exactly the second part');
T.eq(U.round2(spentIn(after, 'other-household') - spentIn(before, 'other-household')), parts.parts[1].amount, 'Other household went up by the same amount');

// Data health and learning understand splits
const hc = Object.assign({}, cfg, { healthIgnore: [], accounts: [{ id: 'a1', name: 'TD chequing', type: 'chequing', balances: [] }] });
const even = S.build(cfg, [costco()], [{ amount: 101.55, cat: 'groceries' }, { amount: 101.55, cat: 'other-household' }], STAMP).parts;
T.eq(H.check(hc, even, TODAY).issues.filter(i => i.kind === 'duplicate').length, 0, 'two equal parts of one split are not flagged as duplicates');
T.eq(H.check(hc, first, TODAY).issues.filter(i => i.kind === 'split').length, 0, 'a split that adds up raises nothing');
const edited = clone(first); edited[1].amount = 60;
const iss = H.check(hc, edited, TODAY).issues.find(i => i.kind === 'split');
T.ok(iss && iss.level === 'high' && iss.amount === 7 && /\$203\.10/.test(iss.detail) && /extra/.test(iss.detail), 'a part edited to $60: "bank line was $203.10, parts total $210.10 ($7.00 extra)" (high)');
const lostPart = [first[0]];
T.ok(/missing/.test((H.check(hc, lostPart, TODAY).issues.find(i => i.kind === 'split') || {}).detail || ''), 'a deleted part: flagged as missing');
const idx = A.Learn.index(first.concat(first.map(p => Object.assign({}, p, { id: p.id + 'z', date: '2026-09-05' }))), TODAY);
T.eq(Object.keys(idx), [], 'learning ignores the parts of a split (they say nothing about where the whole merchant belongs)');
T.done();
