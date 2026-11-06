/* Recurring and fixed costs, price changes, limit check, safe to spend; top merchants and biggest expenses. Run: node tests/unit/costs.test.js */
'use strict';
const T = require('./t'), A = require('./harness')(['funds.js', 'year.js', 'recurring.js', 'costs.js', 'spending.js']);
const C = A.Costs, S = A.Spending, R = A.Recurring, M = A.M, U = A.U, fx = require('./fixture')(A), TODAY = '2026-10-22', clone = o => JSON.parse(JSON.stringify(o));
let n = 0;
const tx = (date, amount, desc, cat, extra) => Object.assign({ id: 'c' + (n++), date, amount, desc, categoryId: cat, type: 'expense', direction: 'out', flags: [] }, extra || {});
const item = (o) => Object.assign({ id: 'i' + (n++), name: 'X', key: 'X', kind: 'expense', cadence: 'monthly', anchor: '2026-10-03', amount: 100, amountMode: 'fixed', categoryId: 'other-household', active: true, createdAt: '2026-01-01T00:00:00Z' }, o);
const cfg0 = clone(fx.cfg);
const items = [item({ name: 'Rent', key: 'CHEXY RENT', amount: 2300, categoryId: 'rent' }), item({ name: 'Netflix', key: 'NETFLIX COM', amount: 20.99, categoryId: 'subscriptions' }),
  item({ name: 'Hydro', key: 'BC HYDRO', amount: 50, amountMode: 'varies', categoryId: 'utilities' }), item({ name: 'Property tax', key: 'CITY PROPERTY TAX', cadence: 'quarterly', amount: 300, categoryId: 'other-household' }),
  item({ name: 'Amex fee', key: 'AMEX FEE', cadence: 'yearly', amount: 250, categoryId: 'fees-admin' }), item({ name: 'Old gym', key: 'OLD GYM', amount: 40, active: false, categoryId: 'fitness' }),
  item({ name: 'Pay', key: 'PAYROLL', kind: 'income', amount: 3000, categoryId: '_income' })];
const cfg = Object.assign(clone(cfg0), { recurring: items });

// classes and costs
T.eq(items.map(i => C.classOf(i)), ['fixed', 'fixed', 'varies', 'nonmonthly', 'nonmonthly', 'fixed', 'fixed'], 'monthly + fixed amount = fixed; monthly + varies = changes; quarterly/yearly = non-monthly');
const sm = C.summary(cfg);
T.eq(sm.yearly, U.round2(2300 * 12 + 20.99 * 12 + 50 * 12 + 1200 + 250), 'yearly cost adds every active expense item at its own cadence (paused and money-in items left out)');
T.eq(sm.monthly, U.round2(sm.yearly / 12), 'monthly equivalent = yearly ÷ 12');
T.eq([sm.by.fixed.n, sm.by.varies.n, sm.by.nonmonthly.n], [2, 1, 2], 'counts: 2 fixed, 1 changing, 2 quarterly/yearly');
T.eq(sm.fixedMonthly, U.round2(2300 + 20.99), 'fixed every month: $2,320.99 a month');
T.eq(sm.setAsideMonthly, U.round2((1200 + 250) / 12), 'quarterly and yearly bills: about $120.83 a month to set aside');
T.eq(sm.paused.length, 1, 'a paused bill is listed but not counted');
T.eq(sm.items[0].it.name, 'Rent', 'items are sorted by yearly cost, biggest first');
T.eq(sm.byCategory[0], { id: 'rent', name: sm.byCategory[0].name, perYear: 27600 }, 'by category: Rent is the biggest at $27,600 a year');
T.ok(!sm.items.some(x => x.it.kind === 'income'), 'paycheques are not costs');
T.eq(C.summary(Object.assign(clone(cfg0), { recurring: [] })).yearly, 0, 'no recurring items: $0, no errors');

// income share
T.eq(C.avgIncome(cfg0, fx.txs, '2026', TODAY), 3250, 'average full-month income $3,250');

// the 12-month strip
const rentTx = []; for (let m = 1; m <= 10; m++) rentTx.push(tx('2026-' + String(m).padStart(2, '0') + '-01', m < 7 ? 2200 : 2300, 'CHEXY RENT', 'rent'));
const rentItem = Object.assign({}, items[0], { anchor: '2026-10-01' });
let st = C.strip(rentItem, rentTx, '2026', TODAY);
T.eq(st.map(x => x.state), ['changed', 'changed', 'changed', 'changed', 'changed', 'changed', 'paid', 'paid', 'paid', 'paid', 'future', 'future'], 'rent strip (item on file at $2,300): Jan–Jun were paid at $2,200 so they show "changed"; Jul–Oct match; Nov and Dec are future');
T.eq([st[0].amount, st[6].amount], [2200, 2300], 'a month shows what was actually paid');
const miss = rentTx.filter(t => t.date !== '2026-04-01');
T.eq(C.strip(rentItem, miss, '2026', TODAY)[3].state, 'late', 'a missing month shows as late');
const young = Object.assign({}, rentItem, { createdAt: '2026-08-15T00:00:00Z' });
T.eq(C.strip(young, rentTx.filter(t => t.date >= '2026-08-01'), '2026', TODAY).slice(0, 7).map(x => x.state), ['none', 'none', 'none', 'none', 'none', 'none', 'none'], 'months before the item had any payment are blank, not "late"');
const qt = ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15'].map(d => tx(d, 300, 'CITY PROPERTY TAX', 'other-household'));
const qs = C.strip(Object.assign({}, items[3], { anchor: '2026-10-15' }), qt, '2026', TODAY);
T.eq(qs.map(x => x.state).join(), 'paid,none,none,paid,none,none,paid,none,none,paid,none,none', 'quarterly strip: only the due months are filled (Jan, Apr, Jul, Oct)');
const twice = C.strip(item({ cadence: 'semimonthly', anchor: '2026-10-01', day2: 15, key: 'T2', amount: 50 }), ['2026-10-01', '2026-10-15'].map(d => tx(d, 50, 'T2', 'x')), '2026', TODAY);
T.eq([twice[9].state, twice[9].amount, twice[9].expected], ['paid', 100, 100], 'twice a month: both payments add up in the month');

// price changes
const nfx = ['2026-04-03', '2026-05-03', '2026-06-03', '2026-07-03', '2026-08-03', '2026-09-03', '2026-10-03'].map((d, i) => tx(d, i < 4 ? 18.99 : 20.99, 'NETFLIX.COM', 'subscriptions'));
const pc = C.priceChange(items[1], nfx);
T.eq([pc.from, pc.to, pc.since, pc.perYear], [18.99, 20.99, '2026-08-03', 24], 'Netflix went from $18.99 to $20.99 in August: +$24 a year');
T.eq(C.priceChange(items[1], nfx.map(t => Object.assign({}, t, { amount: 18.99 }))), null, 'always the same amount: no change');
T.eq(C.priceChange(items[1], nfx.slice(0, 1)), null, 'one payment: nothing to compare');
const rc = C.priceChange(items[0], rentTx);
T.eq([rc.from, rc.to, rc.since, rc.perYear], [2200, 2300, '2026-07-01', 1200], 'rent up $100 from July: +$1,200 a year');

// limit check
const cfgL = Object.assign(clone(cfg0), { recurring: [item({ name: 'Rent', categoryId: 'rent', amount: 2300 }), item({ name: 'Phone', key: 'PHONE', categoryId: 'phone', amount: 60 })] });
cfgL.categories.find(c => c.id === 'rent').limit = 2000; cfgL.categories.find(c => c.id === 'phone').limit = 100;
const lc = C.limitCheck(cfgL);
T.eq(lc.map(r => [r.cat.id, r.fixed, r.limit, r.short]), [['rent', 2300, 2000, 300]], 'Rent: $2,300 of fixed bills against a $2,000 limit → $300 short (Phone is fine)');
T.eq(C.limitCheck(Object.assign(clone(cfgL), { recurring: [item({ cadence: 'quarterly', categoryId: 'rent', amount: 9000 })] })).length, 0, 'quarterly bills are not compared with a monthly limit');

// looks fixed but not in the list
const spot = ['2026-05-03', '2026-06-03', '2026-07-03', '2026-08-03', '2026-09-03', '2026-10-03'].map(d => tx(d, 11.99, 'SPOTIFY PREMIUM', 'subscriptions'));
const lf = C.looksFixed(Object.assign(clone(cfg0), { recurring: [] }), spot, TODAY);
T.eq(lf.map(f => [f.key, f.cadence, f.amount]), [['SPOTIFY PREMIUM', 'monthly', 11.99]], 'Spotify: same amount six months running → "looks fixed"');
T.eq(C.looksFixed(Object.assign(clone(cfg0), { recurring: [item({ key: 'SPOTIFY PREMIUM' })] }), spot, TODAY).length, 0, 'once it is in your list it is not suggested again');
T.eq(C.looksFixed(Object.assign(clone(cfg0), { recurring: [], recurringIgnore: ['SPOTIFY PREMIUM|expense'] }), spot, TODAY).length, 0, '…and "not recurring" is remembered');

// safe to spend
const cfgS = Object.assign(clone(cfg0), { recurring: [item({ name: 'Phone', key: 'PHONE CO', categoryId: 'phone', anchor: '2026-10-28', amount: 95 })] });
const sf = C.safe(cfgS, fx.txs, '2026-10', TODAY), mo = M.month(cfgS, fx.txs, '2026-10', TODAY), est = R.monthEstimate(cfgS, fx.txs, '2026-10', TODAY);
T.eq([sf.left, sf.bills, sf.safe], [mo.left, est.bills, U.round2(mo.left - est.bills)], 'safe to spend = left to spend − bills still to come');
T.ok(sf.bills >= 95 && sf.parts.some(p => p.cat.id === 'phone' && p.add === 95), 'the unpaid $95 phone bill is one of the bills still due');
const paidPhone = fx.txs.concat([tx('2026-10-27', 95, 'PHONE CO', 'phone')]);
T.ok(C.safe(cfgS, paidPhone, '2026-10', TODAY).bills < sf.bills, 'once it is paid it is no longer "still due"');
T.eq(C.safe(cfgS, fx.txs, '2026-09', TODAY), null, 'past months have no safe-to-spend');

// ---- top merchants and biggest expenses ----
const yr = [tx('2026-02-03', 100, 'SAFEWAY #4545', 'groceries'), tx('2026-03-03', 120, 'SAFEWAY #8899', 'groceries'), tx('2026-04-03', 60, 'SAFEWAY #4545', 'groceries'),
  tx('2026-05-01', 2300, 'CHEXY RENT', 'rent'), tx('2026-06-01', 2300, 'CHEXY RENT', 'rent'), tx('2026-06-10', 9, 'CAFE', 'dine-out'), tx('2026-06-11', -20, 'SAFEWAY #4545', 'groceries'),
  tx('2025-12-01', 999, 'CHEXY RENT', 'rent'), tx('2026-07-01', 500, 'MOVER', 'other-household', { type: 'transfer' }), tx('2026-08-04', 120, 'THE KEG', 'dine-out', { share: 30 }),
  tx('2026-09-09', 1300, 'IMMIGRATION CANADA', 'fees-admin', { fundId: 'f1' })];
const mr = S.merchants(yr, '2026');
T.eq(mr.rows.map(r => r.key + ':' + r.total), ['CHEXY RENT:4600', 'IMMIGRATION CANADA:1300', 'SAFEWAY:260', 'THE KEG:30', 'CAFE:9'].map(x => x === 'SAFEWAY:260' ? 'SAFEWAY:260' : x), 'merchants ranked by total: rent $4,600; IRCC $1,300 (from its fund, still listed); the Keg at your $30 share');
T.eq(mr.rows.find(r => r.key === 'SAFEWAY').count, 4, 'store numbers are ignored: #4545 and #8899 are one merchant (4 lines)');
T.eq(mr.rows.find(r => r.key === 'SAFEWAY').total, 260, 'the $20 refund is netted off: 100 + 120 + 60 − 20 = $260');
T.eq(mr.rows[0].share, 4600 / mr.total, 'share of all spending');
T.eq(mr.total, 4600 + 1300 + 260 + 30 + 9, 'total spending in the list (the 2025 line and the transfer are out)');
T.eq([mr.rows[0].name, mr.rows[0].avg, mr.rows[0].catId, mr.rows[0].last], ['CHEXY RENT', 2300, 'rent', '2026-06-01'], 'name, average, category and last date');
T.eq(mr.rows.find(r => r.key === 'IMMIGRATION CANADA').fund, 1, 'a payment from a big-expense fund is counted and marked');
const bg = S.biggest(yr, '2026', 3);
T.eq(bg.map(x => x.t.desc + ':' + x.counted), ['CHEXY RENT:2300', 'CHEXY RENT:2300', 'IMMIGRATION CANADA:1300'].map(x => x), 'biggest single lines (rent twice, then the IRCC fee); refunds and other years are out');
T.eq(S.biggest(yr, '2026', 20).find(x => x.t.desc === 'THE KEG').counted, 30, 'a group bill counts at your share');
T.eq(S.merchants([tx('2026-03-02', 900, 'BIG STORE #12', 'groceries'), tx('2026-09-03', -150, 'BIG STORE #77', 'groceries')], '2026').rows.map(r => [r.count, r.total]), [[2, 750]], 'short store numbers (#12, #77) are ignored too, and the refund is netted');
const hyd = item({ name: 'Hydro', key: 'BC HYDRO', amountMode: 'varies', amount: 70 });
T.eq(C.priceChange(hyd, [tx('2026-01-20', 58, 'BC HYDRO', 'x'), tx('2026-02-20', 61, 'BC HYDRO', 'x'), tx('2026-03-20', 90, 'BC HYDRO', 'x')]), null, 'a bill that moves every month is never reported as a price rise');
T.eq(S.merchants([], '2026').rows.length, 0, 'no data: empty, no errors');
T.done();
