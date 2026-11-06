/* Feature 2: amount/direction conditions on rules, learning from your choices, confidence. Run: node tests/unit/categorize.test.js */
'use strict';
const T = require('./t'), A = require('./harness')(['learn.js']);
const E = A.Engine, L = A.Learn;
const H = ['rule_id', 'kind', 'pattern', 'match_type', 'value', 'priority', 'apply', 'notes', 'min_amount', 'max_amount', 'direction'];
const rules = E.loadRules([H,
  ['C1', 'category', 'COSTCO', 'contains', 'Groceries', '100', 'auto', '', '', '', ''],
  ['C2', 'category', 'COSTCO', 'contains', 'Big Purchases', '100', 'suggest', '', '300', '', 'out'],
  ['C3', 'category', 'AMAZON', 'contains', 'Other household expenses', '100', 'auto', '', '', '', ''],
  ['C4', 'category', 'AMAZON', 'contains', 'Subscriptions', '110', 'auto', '', '9', '10', 'out'],
  ['T1', 'type', 'REFUND', 'contains', 'refund', '300', 'auto', '', '', '', ''],
  ['T2', 'type', 'CRA TAX REFUND', 'contains', 'income', '310', 'suggest', '', '', '', 'in']]);
const c = (d, amt) => E.classify(d, rules, amt === undefined ? undefined : { amount: amt, direction: amt < 0 ? 'out' : 'in' });
T.eq(c('COSTCO WHOLESALE W123', -45).category, 'Groceries', 'COSTCO $45 → Groceries');
T.eq(c('COSTCO WHOLESALE W123', -650).category, 'Big Purchases', 'COSTCO $650 → Big Purchases (min $300 wins the tie as more specific)');
T.eq(c('COSTCO WHOLESALE W123', -650).catApply, 'suggest', '... and is flagged (suggest)');
T.eq(c('COSTCO WHOLESALE W123', 650).category, 'Groceries', 'COSTCO money in $650 (refund) does not use the money-out rule');
T.eq(c('COSTCO WHOLESALE W123').category, 'Groceries', 'no amount given → conditional rule skipped (old callers unchanged)');
T.eq(c('AMAZON PRIME', -9.99).category, 'Subscriptions', 'AMAZON $9.99 → Subscriptions (between $9 and $10)');
T.eq(c('AMAZON MKTP', -42).category, 'Other household expenses', 'AMAZON $42 → Other household');
T.eq(c('CRA TAX REFUND', 425).type, 'income', 'CRA TAX REFUND money in → income');
T.eq(c('CRA TAX REFUND', -425).type, 'refund', 'CRA TAX REFUND money out → generic refund rule');
T.eq(c('CRA TAX REFUND').type, 'refund', 'no amount → direction rule skipped');
const old = E.loadRules([H.slice(0, 8), ['C9', 'category', 'NOVUS', 'contains', 'Utilities', '100', 'auto', '']]);
T.ok(old[0].min === null && old[0].max === null && old[0].dir === null && E.classify('NOVUS ENT', old, { amount: -56, direction: 'out' }).category === 'Utilities', 'an 8-column rule file loads and matches as before');
T.eq(E.loadRules([H, ['C5', 'category', 'X', 'contains', 'Gifts', '100', 'auto', '', '$1,200', '', 'OUT']])[0], { id: 'C5', kind: 'category', pattern: 'X', match: 'contains', value: 'Gifts', priority: 100, apply: 'auto', min: 1200, max: null, dir: 'out' }, 'amounts like "$1,200" and "OUT" are read');
const sp = E.loadRules([H, ['S1', 'split', 'CHEXY', 'contains', 'exclude=1.75%;Rent=rest', '100', 'auto', '', '', '', '']]);
T.eq(E.splitFor('CHEXY RENT', -2340.25, sp).parts.map(p => p.amount), [-40.25, -2300], 'split rules still work (Chexy 2340.25 = 2300 + 40.25)');

// learning
const tx = (id, desc, cat, date, extra) => Object.assign({ id, desc, categoryId: cat, date, direction: 'out', needsTag: false }, extra || {});
const hist = [1, 2, 3, 4, 5].map(i => tx('j' + i, 'JJ BEAN COFFEE #' + (100 + i), 'dine-out', '2026-0' + i + '-01'))
  .concat([tx('w1', 'WINNERS 245', 'clothing', '2026-01-02'), tx('w2', 'WINNERS 245', 'clothing', '2026-02-02')])
  .concat([1, 2, 3, 4].map(i => tx('c' + i, 'COSTCO W123', i === 4 ? 'other-household' : 'groceries', '2026-0' + i + '-03')))
  .concat([tx('old', 'SHOP Q', 'gifts', '2023-01-01'), tx('wait', 'SHOP Q', 'gifts', '2026-01-01', { needsTag: true })])
  .concat([1, 2, 3].map(i => tx('r' + i, 'JJ BEAN COFFEE', 'dine-out', '2026-0' + i + '-09', { direction: 'in', categoryId: 'gifts' })));
const idx = L.index(hist, '2026-10-22');
const jj = L.history(idx, 'JJ BEAN COFFEE #555', 'out');
T.ok(jj && jj.categoryId === 'dine-out' && jj.total === 5 && L.sure(jj), 'JJ BEAN 5 of 5 → Sure (store numbers ignored)');
T.ok(!L.likely(L.history(idx, 'WINNERS 245', 'out')), 'WINNERS 2 of 2 → not used (needs 3)');
const co = L.history(idx, 'COSTCO W123', 'out');
T.ok(co.categoryId === 'groceries' && co.share === 0.75 && !L.likely(co), 'COSTCO 3 of 4 (75%) → not used (needs 80%)');
T.ok(L.history(idx, 'SHOP Q', 'out') === null, 'older than 24 months and lines still waiting for review are ignored');
T.ok(L.history(idx, 'JJ BEAN COFFEE', 'in').categoryId === 'gifts', 'money in is learned separately from money out');
T.eq(['sure', 'likely', 'guess', 'guess', 'guess'], [
  L.ruleConfidence({ match: 'word', priority: 100, apply: 'auto' }), L.ruleConfidence({ match: 'contains', priority: 100, apply: 'auto' }),
  L.ruleConfidence({ match: 'exact', priority: 100, apply: 'suggest' }), L.ruleConfidence({ match: 'word', priority: 50, apply: 'auto' }), L.ruleConfidence(null)], 'rule confidence: word/exact sure, contains likely, suggest/fallback/none guess');
T.done();
