/* Makes examples/demo-budget-2026.json: a made-up household's 2026, from Jan 1 to today, to try every screen and to test with.
   Everything is invented (no real people, shops or accounts). The same date gives the same file.
   Run: node examples/make-demo.js [--today=2026-10-27] [--out=examples/demo-budget-2026.json]
   It uses the app's own code (js/*.js) for categories, rules, splits, group bills, transfers, history and reviewed months.
   What is planted on purpose (late bill, duplicate, balance gap...) is listed in examples/DEMO.md. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const pad = (n) => String(n).padStart(2, '0'), iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const TODAY = arg('today', iso(new Date()));
const OUT = path.resolve(arg('out', path.join(__dirname, 'demo-budget-2026.json')));
if (!/^2026-\d\d-\d\d$/.test(TODAY) && !(TODAY > '2026-12-31')) throw new Error('--today must be a date in 2026 or later (YYYY-MM-DD)');
const END = TODAY > '2026-12-31' ? '2026-12-31' : TODAY;   // the demo covers 2026 up to today

/* ---------- the app's own modules, without a browser ---------- */
const ctx = { console, Date, Math, JSON, crypto: globalThis.crypto, TextEncoder, TextDecoder,
  document: { createElement: () => ({}), createTextNode: () => ({}) }, Node: function () {}, navigator: {}, window: {} };
vm.createContext(ctx);
['util.js', 'model.js', 'engine.js', 'recurring.js', 'funds.js', 'accounts.js', 'split.js', 'group.js', 'trips.js', 'history.js', 'reviewed.js', 'learn.js']
  .forEach(f => vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', f), 'utf8'), ctx, { filename: f }));
const { U, M, Engine, Funds, Accounts, Split, Group, Hist, Reviewed, Learn } = vm.runInContext('({ U, M, Engine, Funds, Accounts, Split, Group, Hist, Reviewed, Learn })', ctx);
let idn = 0; U.uid = () => 'demo' + (++idn).toString(36).padStart(5, '0');   // the same ids every run
U.today = () => TODAY;

/* a small seeded random generator: the same numbers every run */
let seed = 20260101;
const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const between = (a, b) => U.round2(a + rnd() * (b - a));
const chance = (p) => rnd() < p;
const day = (ym, d) => ym + '-' + pad(Math.min(d, U.daysInMonth(+ym.slice(0, 4), +ym.slice(5, 7))));
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const months = []; for (let m = 1; m <= +END.slice(5, 7); m++) months.push('2026-' + pad(m));
const CUR = END.slice(0, 7);

/* ---------- budget: groups, categories, limits ---------- */
const cfg = M.fromSeed({ currency: 'CAD', cutOver: '', groups: [
  { name: 'Home', categories: [{ name: 'Rent', limit: 2100, fixed: true }, { name: 'Utilities', limit: 130, fixed: true }, { name: 'Phone & internet', limit: 160, fixed: true }, { name: 'Home insurance', limit: 45, fixed: true }] },
  { name: 'Everyday', categories: [{ name: 'Groceries', limit: 1100 }, { name: 'Dine out', limit: 250 }, { name: 'Coffee', limit: 60 }, { name: 'Transport', limit: 240 }, { name: 'Subscriptions', limit: 40 }, { name: 'Health & fitness', limit: 120 }] },
  { name: 'Lifestyle', categories: [{ name: 'Personal care', limit: 70 }, { name: 'Household', limit: 120 }, { name: 'Clothing', limit: 100 }, { name: 'Entertainment', limit: 80 }, { name: 'Pets', limit: 90 }, { name: 'Gifts & donations', limit: 80 }, { name: 'Fees & interest', limit: 15 }] },
  { name: 'Yearly', categories: [{ name: 'Travel', period: 'year', yearlyLimit: 4000 }, { name: 'Car insurance', limit: 0, note: 'Paid once a year from its big-expense fund' }, { name: 'Dental', limit: 0, note: 'Paid from its big-expense fund' }, { name: 'Electronics', limit: 0 }] },
  { name: 'Saving', kind: 'saving', categories: [{ name: 'Emergency fund', target: 800 }, { name: 'Retirement', target: 500 }, { name: 'Vacation fund', target: 300 }] }
], bigExpenses: [] });
M.migrate(cfg);
const CAT = {}; cfg.categories.forEach(c => { CAT[c.name] = c.id; });
const catId = (name) => { if (name === 'transfer') return '_transfer'; if (name === 'income') return '_income'; if (name === 'exclude') return '_exclude'; if (!CAT[name]) throw new Error('no category ' + name); return CAT[name]; };
const STAMP = '2026-01-02T09:00:00.000Z';
cfg.createdAt = STAMP;

/* ---------- accounts ---------- */
cfg.accounts = [
  { id: 'acct-chq', name: 'Everyday Chequing', kind: 'bank', type: 'chequing', bank: 'Maple Leaf Bank', numbers: ['4821'], currency: 'CAD', balances: [] },
  { id: 'acct-visa', name: 'Rewards Visa', kind: 'card', type: 'credit', bank: 'Maple Leaf Bank', numbers: ['9034'], currency: 'CAD', balances: [] },
  { id: 'acct-sav', name: 'High-interest Savings', kind: 'bank', type: 'savings', bank: 'Maple Leaf Bank', numbers: ['7710'], currency: 'CAD', balances: [] },
  { id: 'acct-tfsa', name: 'TFSA (investments)', kind: 'bank', type: 'investment', bank: 'Northstar Invest', numbers: [], currency: 'CAD', balances: [] },
  { id: 'acct-usd', name: 'US Dollar Account', kind: 'bank', type: 'savings', bank: 'Maple Leaf Bank', numbers: ['5502'], currency: 'USD', rate: 1.37, rateDate: '2026-10-01', balances: [] }
];
cfg.accounts.forEach(Accounts.migrateOne);
const ACCT = {}; cfg.accounts.forEach(a => { ACCT[a.id] = a; });

/* ---------- tagging rules (a rule file, as loaded under Settings > Rules) ---------- */
const RULES = [['rule_id', 'kind', 'pattern', 'match_type', 'value', 'priority', 'apply', 'notes', 'min_amount', 'max_amount', 'direction'],
  ['D001', 'category', 'FRESHMART', 'contains', 'Groceries', '100', 'auto', ''], ['D002', 'category', 'GREENLEAF MARKET', 'contains', 'Groceries', '100', 'auto', ''],
  ['D003', 'category', 'BULKBARN WAREHOUSE', 'contains', 'Groceries', '100', 'auto', 'Under $250: mostly food', '', '250', 'out'],
  ['D004', 'category', 'BULKBARN WAREHOUSE', 'contains', 'Household', '110', 'auto', 'Over $250: usually a household haul', '250', '', 'out'],
  ['D005', 'category', 'LUNA BISTRO', 'contains', 'Dine out', '100', 'auto', ''], ['D006', 'category', 'PHO SAIGON HOUSE', 'contains', 'Dine out', '100', 'auto', ''],
  ['D007', 'category', 'PIZZA PALACE', 'contains', 'Dine out', '100', 'auto', ''], ['D008', 'category', 'BEANERY COFFEE', 'contains', 'Coffee', '100', 'auto', ''],
  ['D009', 'category', 'CITY TRANSIT', 'contains', 'Transport', '100', 'auto', ''], ['D010', 'category', 'PETRO NORTH', 'contains', 'Transport', '100', 'auto', ''],
  ['D011', 'category', 'STREAMFLIX', 'contains', 'Subscriptions', '100', 'auto', ''], ['D012', 'category', 'TUNEBOX MUSIC', 'contains', 'Subscriptions', '100', 'auto', ''],
  ['D013', 'category', 'CLOUDDRIVE', 'contains', 'Subscriptions', '100', 'auto', ''], ['D014', 'category', 'IRONWORKS GYM', 'contains', 'Health & fitness', '100', 'auto', ''],
  ['D015', 'category', 'TELCOM MOBILITY', 'contains', 'Phone & internet', '100', 'auto', ''], ['D016', 'category', 'FASTNET INTERNET', 'contains', 'Phone & internet', '100', 'auto', ''],
  ['D017', 'category', 'CITYVIEW PROPERTIES', 'contains', 'Rent', '100', 'auto', ''], ['D018', 'category', 'CITY HYDRO', 'contains', 'Utilities', '100', 'auto', ''],
  ['D019', 'category', 'SAFEHAVEN INSURANCE', 'contains', 'Home insurance', '100', 'auto', ''], ['D020', 'category', 'HOMEWORKS HARDWARE', 'contains', 'Household', '100', 'auto', ''],
  ['D021', 'category', 'THREADS & CO', 'contains', 'Clothing', '100', 'auto', ''], ['D022', 'category', 'STARLIGHT CINEMA', 'contains', 'Entertainment', '100', 'auto', ''],
  ['D023', 'category', 'PAWS PET SUPPLY', 'contains', 'Pets', '100', 'auto', ''], ['D024', 'category', 'COMMUNITY FOOD BANK', 'contains', 'Gifts & donations', '100', 'auto', ''],
  ['D025', 'category', 'ANNUAL FEE', 'contains', 'Fees & interest', '100', 'auto', ''], ['D026', 'category', 'SKYWAY AIRLINES', 'contains', 'Travel', '100', 'auto', ''],
  ['D027', 'category', 'CASA ALFAMA', 'contains', 'Travel', '100', 'auto', ''], ['D028', 'category', 'LAKESIDE CABINS', 'contains', 'Travel', '100', 'auto', ''],
  ['D029', 'category', 'AUTOGUARD INSURANCE', 'contains', 'Car insurance', '100', 'auto', ''], ['D030', 'category', 'BRIGHTSMILE DENTAL', 'contains', 'Dental', '100', 'auto', ''],
  ['D031', 'category', 'MKTPLACE ONLINE', 'contains', 'Household', '50', 'suggest', 'An online store that sells everything: check each one'],
  ['D032', 'category', 'TASCA LISBOA', 'contains', 'Travel', '100', 'auto', ''], ['D033', 'category', 'TRAM 28 LISBOA', 'contains', 'Travel', '100', 'auto', ''],
  ['D034', 'category', 'TFR TO SAVINGS', 'contains', 'Emergency fund', '100', 'auto', ''], ['D035', 'category', 'TFR TO BROKERAGE', 'contains', 'Retirement', '100', 'auto', 'RRSP contribution'],
  ['T001', 'type', 'PAYROLL', 'contains', 'income', '100', 'auto', ''], ['T002', 'type', 'NORTHWIND LTD PAY', 'contains', 'income', '100', 'auto', ''],
  ['T003', 'type', 'INTEREST PAID', 'contains', 'income', '100', 'auto', ''], ['T004', 'type', 'PAYMENT VISA', 'contains', 'transfer', '100', 'auto', ''],
  ['T005', 'type', 'PAYMENT THANK YOU', 'contains', 'transfer', '100', 'auto', ''], ['T006', 'type', 'TFR FROM CHEQUING', 'contains', 'transfer', '100', 'auto', ''],
  ['T007', 'type', 'INTERAC E-TFR FROM', 'contains', 'income', '50', 'suggest', 'Money from people: income, or someone paying you back?'],
  ['T008', 'type', 'ATM WITHDRAWAL', 'contains', 'review', '100', 'auto', 'Cash: could be anything']];
cfg.ruleSets = { general: { file: 'demo-rules.csv', rows: RULES, count: RULES.length - 1, loadedAt: STAMP } };
cfg.rules = [{ merchant: 'GLOW PHARMACY', categoryId: catId('Personal care'), createdAt: '2026-02-03T10:00:00.000Z' }];   // an "Always tag" rule you made
const rules = Engine.loadRules(RULES), ruleById = {}; rules.forEach(r => { ruleById[r.id] = r; });

/* ---------- transactions ---------- */
const txs = [], lineNo = {};
const importAt = (date) => { const ym = date.slice(0, 7); return ym === CUR ? TODAY + 'T08:30:00.000Z' : addDays(day(ym, 31), 2) + 'T08:30:00.000Z'; };   // statements imported early the next month
/* one bank line, decided the way Import decides it (rules, your Always rules, transfers flagged for review) */
function bank(acctId, date, desc, amountRaw, o) {
  o = o || {};
  if (date > END) return null;
  const a = ACCT[acctId], ym = date.slice(0, 7), file = a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + ym + '.csv';
  lineNo[file] = (lineNo[file] || 1) + 1;
  const k = Engine.classify(desc, rules, { amount: Math.abs(amountRaw), direction: amountRaw < 0 ? 'out' : 'in' });
  const mine = cfg.rules.find(r => r.merchant === M.merchantKey(desc));
  let cat = null, conf = 'guess', why = '', review = false, reasons = [];
  const rw = (id) => { const r = ruleById[id]; return r ? 'Rule ' + r.id + ' (' + r.pattern + ')' : ''; };
  if (o.cat) { cat = catId(o.cat); conf = 'sure'; why = 'You chose this'; }
  else if (mine) { cat = mine.categoryId; conf = 'sure'; why = 'Your Always rule for ' + mine.merchant; }
  else if (k.type === 'transfer' || k.type === 'income' || k.type === 'exclude') {
    cat = catId(k.type); conf = Learn.ruleConfidence(ruleById[k.typeRule]); why = rw(k.typeRule);
    if (k.typeApply === 'suggest') { review = true; reasons.push('Suggested as income'); }
  } else if (k.type === 'review') { review = true; reasons.push('Check this one: the bank text could mean several things'); why = rw(k.typeRule); }
  else if (k.category) { cat = catId(k.category); conf = Learn.ruleConfidence(ruleById[k.catRule]); why = rw(k.catRule); if (k.catApply === 'suggest') { review = true; reasons.push('Suggested category'); } }
  else { review = true; reasons.push('No rule matched'); why = 'No rule matched'; }
  if (cat === '_transfer') { review = true; reasons.push('Transfer: check it is between your own accounts'); }
  let type = cat ? M.typeFor(cfg, cat) : (amountRaw > 0 ? 'pending' : 'expense');
  if (type === 'expense' && amountRaw > 0) { review = true; reasons.push('Money in on a spending category (refund?)'); }
  const amount = type === 'income' ? amountRaw : (type === 'transfer' || type === 'exclude' || type === 'pending') ? Math.abs(amountRaw) : -amountRaw;
  const needsTag = o.review !== undefined ? o.review : review;
  const at = importAt(date);
  const t = { id: U.uid(), date, amount: U.round2(amount), type, categoryId: cat, desc, note: o.note || '', account: a.name, accountId: acctId,
    direction: amountRaw < 0 ? 'out' : 'in', source: 'csv', batchId: 'batch-' + acctId.slice(5) + '-' + ym, file, line: lineNo[file],
    fp: [acctId, date, amountRaw, M.merchantKey(desc)].join('|'), needsTag, reviewReason: needsTag ? reasons.join('; ') : '', conf, tagWhy: why,
    flags: [], createdAt: at };
  if (!needsTag) t.reviewedAt = at;
  if (o.fundId) t.fundId = o.fundId;
  if (o.tripId) t.tripId = o.tripId;
  if (o.skip) return t;   // made, but never imported (the planted balance gap)
  txs.push(t); return t;
}
const out = (acct, date, desc, amt, o) => bank(acct, date, desc, -Math.abs(amt), o);
const inn = (acct, date, desc, amt, o) => bank(acct, date, desc, Math.abs(amt), o);

/* big expenses (funds) and trips */
cfg.bigExpenses = [
  { id: 'fund-car', name: 'Car insurance', amount: 1380, repeats: 'yearly', due: '2026-03', start: '2025-04', categoryId: catId('Car insurance'), match: 'AUTOGUARD INSURANCE', note: 'Renews every March' },
  { id: 'fund-dental', name: 'Dental work', amount: 900, repeats: 'once', due: '2026-09', start: '2026-05', categoryId: catId('Dental'), match: 'BRIGHTSMILE DENTAL', note: 'Crown, not covered' },
  { id: 'fund-laptop', name: 'New laptop', amount: 1600, repeats: 'once', due: '2026-12', start: '2026-07', categoryId: catId('Electronics'), match: '', note: 'Setting aside; not bought yet' }];
cfg.bigExpenses.forEach(f => Funds.migrateOne(f, CUR));
cfg.trips = [{ id: 'trip-lisbon', name: 'Lisbon in spring', start: '2026-05-08', end: '2026-05-17' }, { id: 'trip-cottage', name: 'Cottage long weekend', start: '2026-08-14', end: '2026-08-17' }];

const CHQ = 'acct-chq', VISA = 'acct-visa', SAV = 'acct-sav';
let payday = '2026-01-09';
const skipped = [];
months.forEach((ym, mi) => {
  const m = +ym.slice(5);
  // ----- chequing: pay, rent, bills, saving -----
  while (payday.slice(0, 7) === ym) { inn(CHQ, payday, 'ACME CORP PAYROLL', 2650); payday = addDays(payday, 14); }
  inn(CHQ, day(ym, 25), 'NORTHWIND LTD PAY', m >= 7 ? 4050 : 3900);   // a raise in July
  out(CHQ, day(ym, 1), 'CITYVIEW PROPERTIES PAD', 2100);
  out(CHQ, day(ym, 15), 'SAFEHAVEN INSURANCE', 42);
  out(CHQ, day(ym, 20), 'FASTNET INTERNET', 70);
  if (m % 2 === 0) out(CHQ, day(ym, 18), 'CITY HYDRO', between(88, 142));
  out(CHQ, day(ym, 6), 'COMMUNITY FOOD BANK', 25);
  // saving: to the savings account (the other side is matched there), and to a brokerage
  const s1 = out(CHQ, day(ym, 26), 'TFR TO SAVINGS 7710', 800), s2 = inn(SAV, day(ym, 26), 'TFR FROM CHEQUING 4821', 800);
  if (s1 && s2) { s1.linkId = s2.linkId = 'link-sav-' + ym; s2.reviewedAt = s2.createdAt; s2.needsTag = false; s2.reviewReason = ''; }
  const v1 = out(CHQ, day(ym, 27), 'TFR TO SAVINGS 7710 VACATION', 300, { cat: 'Vacation fund' }), v2 = inn(SAV, day(ym, 27), 'TFR FROM CHEQUING 4821', 300);
  if (v1 && v2) { v1.linkId = v2.linkId = 'link-vac-' + ym; v2.needsTag = false; v2.reviewReason = ''; v2.reviewedAt = v2.createdAt; }
  out(CHQ, day(ym, 28), 'TFR TO BROKERAGE RRSP', 500);
  inn(SAV, day(ym, 28), 'INTEREST PAID', U.round2(18 + mi * 4.1));
  // ----- the Visa card: everyday spending -----
  out(VISA, day(ym, 1), 'CITY TRANSIT MONTHLY PASS', 105);
  out(VISA, day(ym, 3), 'IRONWORKS GYM', m >= 7 ? 54.99 : 49.99);   // the gym raised its price in July
  out(VISA, day(ym, 5), 'STREAMFLIX', 18.99);
  out(VISA, day(ym, 8), 'TELCOM MOBILITY', 85);
  out(VISA, day(ym, 12), 'TUNEBOX MUSIC', 11.99);
  if (ym !== '2026-09') out(VISA, day(ym, 22), 'CLOUDDRIVE STORAGE', 3.99);   // September is missing: logged for you when the demo opens
  out(VISA, day(ym, 9), 'GLOW PHARMACY', between(18, 64));
  out(VISA, day(ym, 14), 'PAWS PET SUPPLY', between(45, 85));
  for (let d = 2; d <= 31; d += 3 + Math.floor(rnd() * 2)) out(VISA, day(ym, d), 'FRESHMART #212', between(38, 128));
  for (let d = 4; d <= 31; d += 7) out(VISA, day(ym, d), 'GREENLEAF MARKET', between(22, 68));
  for (let d = 1; d <= 31; d += 2 + Math.floor(rnd() * 3)) if (chance(0.7)) out(VISA, day(ym, d), 'BEANERY COFFEE', between(4.25, 7.4));
  ['LUNA BISTRO', 'PHO SAIGON HOUSE', 'PIZZA PALACE', 'PHO SAIGON HOUSE', 'LUNA BISTRO'].forEach((n, i) => { if (chance(0.85)) out(VISA, day(ym, 4 + i * 6), n, between(24, 78)); });
  out(VISA, day(ym, 11), 'PETRO NORTH', between(52, 74)); out(VISA, day(ym, 25), 'PETRO NORTH', between(48, 72));
  if (chance(0.6)) out(VISA, day(ym, 16), 'HOMEWORKS HARDWARE', between(14, 96));
  if (chance(0.45)) out(VISA, day(ym, 19), 'THREADS & CO', between(30, 140));
  if (chance(0.5)) out(VISA, day(ym, 21), 'STARLIGHT CINEMA', between(26, 44));
  out(VISA, day(ym, 17), 'BULKBARN WAREHOUSE', m % 3 === 0 ? between(262, 340) : between(140, 230));
});

/* ----- one-off events across the year ----- */
out(VISA, '2026-01-04', 'ANNUAL FEE', 120);
out(CHQ, '2026-03-03', 'AUTOGUARD INSURANCE', 1380, { fundId: 'fund-car' });   // paid from its big-expense fund
// Lisbon: flights and the hotel deposit booked months before, then spending there
out(VISA, '2026-02-12', 'SKYWAY AIRLINES YVR-LIS', 1240, { tripId: 'trip-lisbon' });
out(VISA, '2026-03-20', 'CASA ALFAMA HOTEL DEPOSIT', 380, { tripId: 'trip-lisbon' });
[['2026-05-08', 'TRAM 28 LISBOA', 22.4], ['2026-05-09', 'TASCA LISBOA DO CHIADO', 86.2], ['2026-05-11', 'CASA ALFAMA HOTEL', 1120], ['2026-05-12', 'TASCA LISBOA BELEM', 64.75], ['2026-05-14', 'TRAM 28 LISBOA', 18.6], ['2026-05-16', 'TASCA LISBOA ALFAMA', 92.3]]
  .forEach(x => out(VISA, x[0], x[1], x[2], { tripId: 'trip-lisbon' }));
out(VISA, '2026-06-02', 'LAKESIDE CABINS', 420, { tripId: 'trip-cottage' });
out(VISA, '2026-08-15', 'PETRO NORTH', 68.4, { cat: 'Travel', tripId: 'trip-cottage', note: 'Gas for the cottage drive' });
out(VISA, '2026-08-16', 'LUNA BISTRO', 58.1, { cat: 'Travel', tripId: 'trip-cottage' });
out(CHQ, '2026-09-10', 'BRIGHTSMILE DENTAL', 900, { fundId: 'fund-dental' });
out(VISA, '2026-04-22', 'FRESHMART #212', 486.3, { note: 'Party for the neighbours' });   // unusually large for this shop
out(VISA, '2026-07-07', 'MKTPLACE ONLINE', 64.2);   // a "suggest" rule: waits in Review

/* group bills: you paid for the table, only your share counts; others pay you back */
const g1 = out(VISA, '2026-06-06', 'LUNA BISTRO', 184, { note: 'Dinner with Sam, Priya and Jordan' });
const g2 = out(VISA, '2026-09-19', 'PIZZA PALACE', 96, { note: 'Pizza night, 3 of us' });
[[g1, 46, 4], [g2, 32, 3]].forEach(([b, share, people]) => { if (b) { b.share = share; b.people = people; b.conf = 'sure'; b.tagWhy = 'You chose this'; } });
if (g2) g2.settled = 32;   // one person paid in cash
[['2026-06-07', 'INTERAC E-TFR FROM S CHEN', 46, g1], ['2026-06-09', 'INTERAC E-TFR FROM P SHAH', 46, g1], ['2026-09-21', 'INTERAC E-TFR FROM J LEE', 32, g2]].forEach(([d, desc, amt, bill]) => {
  const r = inn(CHQ, d, desc, amt); if (r && bill) { const i = txs.indexOf(r); txs[i] = Group.link(r, bill, r.createdAt); }
});   // Jordan still owes $46 for June: listed as owed to you, and in Data health after 30 days

/* paying the card: each month, last month's purchases in full, from chequing (the two sides are matched as a transfer) */
months.slice(1).forEach((ym, i) => {
  const prev = months[i];
  const owed = U.round2(txs.filter(t => t.accountId === VISA && t.date.slice(0, 7) === prev && !/PAYMENT THANK YOU/.test(t.desc)).reduce((s, t) => s + (t.direction === 'out' ? Math.abs(t.amount) : -Math.abs(t.amount)), 0));
  out(CHQ, day(ym, 10), 'PAYMENT VISA 9034', owed); inn(VISA, day(ym, 11), 'PAYMENT THANK YOU', owed);
});

/* splits: the warehouse store, part groceries part household */
['2026-03', '2026-06', '2026-09'].filter(ym => ym <= CUR).forEach(ym => {
  const t = txs.find(x => x.desc === 'BULKBARN WAREHOUSE' && x.date.slice(0, 7) === ym); if (!t) return;
  const g = Math.round(t.amount * 70) / 100;
  const r = Split.build(cfg, [t], [{ amount: g, cat: catId('Groceries') }, { amount: U.round2(t.amount - g), cat: catId('Household') }], t.createdAt);
  if (!r.ok) throw new Error('split: ' + r.error);
  txs.splice(txs.indexOf(t), 1, ...r.parts);
});

/* transfers between your accounts (card payments): matched by the app's own rule; they stay to review, as after an import */
M.linkTransfers(cfg, txs).forEach(u => { const i = txs.findIndex(x => x.id === u.id); txs[i] = u; });
txs.forEach(t => { if (t.linkId && /PAYMENT VISA|PAYMENT THANK YOU/.test(t.desc) && t.date.slice(0, 7) < CUR) { t.needsTag = false; t.reviewReason = ''; t.reviewedAt = t.createdAt; } });   // older months already reviewed

/* this month: a few lines still waiting for review (and one thing to sort out) */
const recent = (n) => (addDays(END, -n) < CUR + '-01' ? CUR + '-01' : addDays(END, -n));
out(VISA, recent(3), 'SQ *CORNER KIOSK', 12.5);                            // no rule matched
inn(VISA, recent(2), 'THREADS & CO', 35);                                  // a refund
inn(CHQ, recent(4), 'INTERAC E-TFR FROM M PATEL', 60);                     // income, or someone paying you back?
out(CHQ, recent(5), 'ATM WITHDRAWAL', 100);                                // cash: could be anything
out(CHQ, '2026-07-14', 'E-TFR TO 3381', 300, { cat: 'transfer', review: false });   // marked a transfer, but no other side in your accounts
out(VISA, recent(1), 'BEANERY COFFEE', 5.25);
txs.push({ id: U.uid(), source: 'manual', createdAt: recent(1) + 'T15:10:00.000Z', updatedAt: recent(1) + 'T15:10:00.000Z', flags: [], amount: 5.25, expr: null,
  categoryId: catId('Coffee'), type: 'expense', date: recent(1), note: '', desc: 'Beanery coffee', tripId: null, needsTag: false });   // typed by hand AND imported: a possible duplicate
// a line marked as not part of a recurring bill (a one-off extra month of music for a gift)
const gift = out(VISA, '2026-04-26', 'TUNEBOX MUSIC GIFT', 11.99, { cat: 'Gifts & donations' }); if (gift) gift.notRecurring = true;

/* the balance gap: one September chequing line is missing from the import, but the bank's balance includes it */
const gap = out(CHQ, '2026-09-23', 'HOMEWORKS HARDWARE', 64.1, { skip: true });
if (gap) skipped.push(gap);

/* ---------- balances (what the bank files said at each month end) ---------- */
const OPEN = { 'acct-chq': 6200, 'acct-visa': 0, 'acct-sav': 12500 };
Object.keys(OPEN).forEach(id => {
  const a = ACCT[id], debt = Accounts.isDebt(a), all = txs.concat(skipped).filter(t => t.accountId === id);
  a.balances = Accounts.setBalance(a, '2025-12-31', OPEN[id], 'manual');
  months.forEach(ym => {
    const upto = ym === CUR ? END : day(ym, 31);
    const flow = all.filter(t => t.date <= upto).reduce((s, t) => s + (t.direction === 'in' ? Math.abs(t.amount) : -Math.abs(t.amount)), 0);
    a.balances = Accounts.setBalance(a, upto, debt ? -flow + OPEN[id] : OPEN[id] + flow, 'import', 'batch-' + id.slice(5) + '-' + ym);
  });
});
// accounts you never import: balances typed in now and then ("Update balance")
ACCT['acct-tfsa'].balances = [['2026-01-02', 21400], ['2026-03-31', 22150], ['2026-06-30', 23920], ['2026-09-30', 24610]].filter(b => b[0] <= END).map(b => ({ date: b[0], amount: b[1], source: 'manual' }));
ACCT['acct-usd'].balances = [['2026-01-02', 1850], ['2026-06-30', 2040]].filter(b => b[0] <= END).map(b => ({ date: b[0], amount: b[1], source: 'manual' }));

/* ---------- imports, as Settings > Backup lists them ---------- */
const byBatch = {}; txs.forEach(t => { if (t.batchId) (byBatch[t.batchId] = byBatch[t.batchId] || []).push(t); });
cfg.batches = Object.keys(byBatch).sort().map(b => { const l = byBatch[b]; return { id: b, file: l[0].file, accountId: l[0].accountId, at: l[0].createdAt, rows: l.length, tx: l.length, readRows: l.length + 1, notImported: 0, recon: null }; });

/* ---------- recurring bills and paycheques, confirmed in January ---------- */
const ITEM = (name, key, kind, cadence, anchor, amount, cat, mode) => ({ id: 'rec-' + U.slug(name), name, key: M.merchantKey(key), kind, cadence, anchor, amount, amountMode: mode || 'fixed', categoryId: cat ? catId(cat) : null, active: true, createdAt: '2026-01-05T10:00:00.000Z' });
cfg.recurring = [
  ITEM('Rent', 'CITYVIEW PROPERTIES PAD', 'expense', 'monthly', '2026-01-01', 2100, 'Rent'),
  ITEM('Home insurance', 'SAFEHAVEN INSURANCE', 'expense', 'monthly', '2026-01-15', 42, 'Home insurance'),
  ITEM('Internet', 'FASTNET INTERNET', 'expense', 'monthly', '2026-01-20', 70, 'Phone & internet'),
  ITEM('Mobile phone', 'TELCOM MOBILITY', 'expense', 'monthly', '2026-01-08', 85, 'Phone & internet'),
  ITEM('Hydro', 'CITY HYDRO', 'expense', 'bimonthly', '2026-02-18', 115, 'Utilities', 'varies'),
  ITEM('Streamflix', 'STREAMFLIX', 'expense', 'monthly', '2026-01-05', 18.99, 'Subscriptions'),
  ITEM('Tunebox Music', 'TUNEBOX MUSIC', 'expense', 'monthly', '2026-01-12', 11.99, 'Subscriptions'),
  ITEM('CloudDrive', 'CLOUDDRIVE STORAGE', 'expense', 'monthly', '2026-01-22', 3.99, 'Subscriptions'),
  ITEM('Gym', 'IRONWORKS GYM', 'expense', 'monthly', '2026-01-03', 49.99, 'Health & fitness'),
  ITEM('Transit pass', 'CITY TRANSIT MONTHLY PASS', 'expense', 'monthly', '2026-01-01', 105, 'Transport'),
  ITEM('Food bank', 'COMMUNITY FOOD BANK', 'expense', 'monthly', '2026-01-06', 25, 'Gifts & donations'),
  ITEM('Paycheque (Acme)', 'ACME CORP PAYROLL', 'income', 'biweekly', '2026-01-09', 2650, null),
  ITEM('Paycheque (Northwind)', 'NORTHWIND LTD PAY', 'income', 'monthly', '2026-01-25', 3900, null, 'varies')];
cfg.recurring.push(Object.assign(ITEM('Card annual fee', 'ANNUAL FEE', 'expense', 'yearly', '2026-01-04', 120, 'Fees & interest'), { active: false }));   // paused
cfg.autoLogFrom = '2026-01';   // so the missed September CloudDrive payment is logged for you on first open

/* ---------- edits with history, reviewed months ---------- */
const later = (t, at, why, change) => { const before = JSON.parse(JSON.stringify(t)); Object.assign(t, change, { updatedAt: at }); Hist.why(why); Hist.applyAll([before], [t], at); };
const gas = txs.find(t => t.desc === 'PETRO NORTH' && t.date.slice(0, 7) === '2026-02');
if (gas) later(gas, '2026-03-02T19:20:00.000Z', 'Edited', { note: 'Rental car on the ski weekend' });
const coffee = txs.find(t => t.desc === 'BEANERY COFFEE' && t.date.slice(0, 7) === '2026-04');
if (coffee) later(coffee, '2026-05-01T09:00:00.000Z', 'Edited', { categoryId: catId('Dine out'), conf: 'sure', tagWhy: 'You chose this' });
const reviewMonths = months.filter(ym => ym <= '2026-08' && ym < CUR);
reviewMonths.forEach(ym => Reviewed.mark(cfg, txs, ym, TODAY, addDays(day(ym, 31), 6) + 'T20:00:00.000Z'));
const march = txs.find(t => t.desc === 'GREENLEAF MARKET' && t.date.slice(0, 7) === '2026-03');
if (march && reviewMonths.includes('2026-03')) later(march, '2026-09-04T18:00:00.000Z', 'Edited', { categoryId: catId('Household'), conf: 'sure', tagWhy: 'You chose this' });   // changed after March was reviewed

/* ---------- write the backup ---------- */
txs.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id < b.id ? -1 : 1));
const file = { app: 'household-budget', version: 1, savedAt: END + 'T20:00:00.000Z', counts: { transactions: txs.length, categories: cfg.categories.length },
  demo: { about: 'Made-up demo data (no real people, shops or accounts). See examples/DEMO.md.', today: TODAY }, config: cfg, transactions: txs };
fs.writeFileSync(OUT, JSON.stringify(file, null, 1) + '\n');
console.log('Wrote ' + path.relative(process.cwd(), OUT) + ': ' + txs.length + ' transactions, Jan 1 to ' + END + ', ' + (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB');
