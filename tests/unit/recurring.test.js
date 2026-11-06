/* Feature 1: recurring detection, schedule, status, upcoming, month-end estimate. Run: node tests/unit/recurring.test.js */
'use strict';
const T = require('./t'), A = require('./harness')(['recurring.js']);
const R = A.Recurring, fx = require('./fixture')(A);
let n = 0;
const tx = (date, amount, desc, cat, extra) => Object.assign({ id: 'x' + (n++), date, amount, desc, categoryId: cat, type: cat === '_income' ? 'income' : 'expense', direction: 'out' }, extra || {});
const TODAY = '2026-10-22';
const data = [];
['2026-04-03', '2026-05-04', '2026-06-02', '2026-07-03', '2026-08-05', '2026-09-03', '2026-10-03'].forEach(d => data.push(tx(d, 20.99, 'NETFLIX.COM', 'subscriptions')));
[['2026-02-18', 51.2], ['2026-04-19', 44.1], ['2026-06-17', 58.4], ['2026-08-18', 47.9], ['2026-10-17', 49.0]].forEach(x => data.push(tx(x[0], x[1], 'BC HYDRO', 'utilities')));
data.push(tx('2026-09-02', 6.75, 'BLUE CUP CAFE', 'dine-out'), tx('2026-10-11', 5.5, 'BLUE CUP CAFE', 'dine-out'));
['2026-01-08', '2026-02-08', '2026-03-08', '2026-04-08'].forEach(d => data.push(tx(d, 12.99, 'OLD MUSIC APP', 'subscriptions')));   // stopped in April
['2026-08-01', '2026-08-15', '2026-08-29', '2026-09-12', '2026-09-26', '2026-10-10'].forEach(d => data.push(tx(d, 2150, 'PAYROLL ACME', '_income', { direction: 'in' })));
data.push(tx('2026-09-10', -20.99, 'NETFLIX.COM', 'subscriptions'));   // a refund: ignored
['2026-07-31', '2026-08-31', '2026-09-30'].forEach(d => data.push(tx(d, 30, 'GYM CLUB', 'fitness')));
['2025-03-10', '2026-03-10'].forEach(d => data.push(tx(d, 250, 'AMEX MEMBERSHIP FEE', 'fees-admin')));

const found = R.detect(data, TODAY, [], []);
const f = k => found.find(x => x.key === k);
const nf = f('NETFLIX COM');
T.ok(nf && nf.cadence === 'monthly' && nf.amountMode === 'fixed' && nf.amount === 20.99 && nf.anchor === '2026-10-03' && nf.count === 7, 'Netflix: monthly, fixed $20.99, last 2026-10-03, 7 times (refund ignored)');
const hy = f('BC HYDRO');
T.ok(hy && hy.cadence === 'bimonthly' && hy.amountMode === 'varies' && hy.amount === 49 && hy.low === 44.1 && hy.high === 58.4, 'BC Hydro: every 2 months, varies, typical $49 (median), $44.10–$58.40');
T.ok(!f('BLUE CUP CAFE'), 'two coffees: not recurring');
T.ok(!f('OLD MUSIC APP'), 'a subscription that stopped in April is not suggested');
const pay = found.find(x => x.key === 'PAYROLL ACME');
T.ok(pay && pay.kind === 'income' && pay.cadence === 'biweekly', 'paycheque every 2 weeks: income, biweekly');
T.ok(f('AMEX MEMBERSHIP FEE') && f('AMEX MEMBERSHIP FEE').cadence === 'yearly', 'yearly fee found from 2 years');
T.ok(f('GYM CLUB') && f('GYM CLUB').cadence === 'monthly', 'end-of-month payments (31st, 30th) are monthly');
T.ok(found[0].yearly >= found[found.length - 1].yearly, 'suggestions sorted by yearly cost');
T.ok(!R.detect(data, TODAY, ['NETFLIX COM|expense'], []).some(x => x.key === 'NETFLIX COM'), 'dismissed ("not recurring") is not suggested again');
T.ok(!R.detect(data, TODAY, [], [{ key: 'NETFLIX COM', kind: 'expense' }]).some(x => x.key === 'NETFLIX COM'), 'already confirmed is not suggested again');

// schedule
const net = { id: 'n', name: 'Netflix', key: 'NETFLIX COM', kind: 'expense', cadence: 'monthly', anchor: '2026-10-03', amount: 20.99, amountMode: 'fixed', categoryId: 'subscriptions', active: true };
T.eq(R.schedule(net, '2026-10-01', '2027-01-31'), ['2026-10-03', '2026-11-03', '2026-12-03', '2027-01-03'], 'monthly schedule keeps the day');
T.eq(R.schedule(Object.assign({}, net, { anchor: '2026-01-31' }), '2026-02-01', '2026-05-31'), ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31'], 'the 31st becomes the last day of shorter months');
T.eq(R.schedule(Object.assign({}, net, { cadence: 'biweekly', anchor: '2026-10-10' }), '2026-10-01', '2026-11-10'), ['2026-10-10', '2026-10-24', '2026-11-07'], 'every 2 weeks');
T.eq(R.schedule(Object.assign({}, net, { anchor: '2026-12-15' }), '2026-10-01', '2026-11-30'), ['2026-10-15', '2026-11-15'], 'an anchor in the future still schedules earlier dates');

// status
const st = R.status(net, data, '2026-08-01', '2026-11-30', TODAY);
T.eq(st.map(s => s.date + ':' + s.state), ['2026-08-03:paid', '2026-09-03:paid', '2026-10-03:paid', '2026-11-03:due'], 'status: paid within ±5 days, upcoming due');
const late = R.status(Object.assign({}, net, { anchor: '2026-10-12' }), data, '2026-10-01', '2026-10-31', '2026-10-22');
T.eq(late.map(s => s.state), ['late'], 'no payment 10 days after the date → late');
const up = tx('2026-11-03', 22.99, 'NETFLIX.COM', 'subscriptions');
T.eq(R.status(net, data.concat([up]), '2026-11-01', '2026-11-30', '2026-11-05')[0].state, 'changed', 'price went up → "different amount"');
T.eq(R.status(Object.assign({}, net, { amountMode: 'varies' }), data.concat([up]), '2026-11-01', '2026-11-30', '2026-11-05')[0].state, 'paid', '...but a "varies" item at a different amount is just paid');

// upcoming
const cfg = Object.assign({}, fx.cfg, { recurring: [net, Object.assign({}, net, { id: 'h', name: 'BC Hydro', key: 'BC HYDRO', cadence: 'bimonthly', anchor: '2026-10-17', amount: 49, amountMode: 'varies', categoryId: 'utilities' }), Object.assign({}, net, { id: 'p', active: false })] });
const u = R.upcoming(cfg, data, TODAY, 30);
T.eq(u.map(x => x.item.id + ':' + x.date + ':' + x.state), ['h:2026-10-17:paid', 'n:2026-11-03:due'], 'coming up: Hydro just paid (shown with ✓ for 10 days), Netflix due Nov 3; Hydro next in Dec is beyond 30 days; paused items left out');

// month-end estimate on the fixture (hand-checked)
const fcfg = Object.assign({}, fx.cfg, { recurring: [] });
const e = R.monthEstimate(fcfg, fx.txs, '2026-10', TODAY);
const s = A.M.month(fcfg, fx.txs, '2026-10', TODAY);
// fixture October: groceries 94.17+81.25=175.42, dine 6.75, rent 2300, subs 20.99, utilities 59 → monthly spent 2562.16 (the $60 e-Transfer has no category)
T.eq(e.spent, A.U.round2(s.limit - s.left), 'estimate starts from spent so far in monthly categories (' + e.spent + ')');
// bills: rent, utilities, subscriptions paid; phone has no history → 0
T.eq(e.bills, 0, 'all bills with a history are already paid in October → 0 to come');
// everyday: groceries usual = median of Jul/Aug/Sep = median(91.17+75.25, 92.17+77.25, 93.17+79.25) = 169.42; dine out usual 6.75; 9 days left of 31
const exp = A.U.round2(169.42 * 9 / 31 + 6.75 * 9 / 31);
T.eq(e.everyday, exp, 'everyday: usual pace for the 9 days left (groceries $169.42, dine out $6.75 a month) = ' + exp);
T.eq(e.estimate, A.U.round2(e.spent + e.bills + e.everyday), 'estimate = spent + bills + everyday');
T.eq(e.left, A.U.round2(e.limit - e.estimate), 'left at month end = limit − estimate');
T.ok(R.monthEstimate(fcfg, fx.txs, '2026-09', TODAY) === null, 'past months: no estimate (actuals only)');
const withBill = Object.assign({}, fcfg, { recurring: [Object.assign({}, net, { key: 'PHONE CO', name: 'Phone', categoryId: 'phone', anchor: '2026-10-28', amount: 95 })] });
T.eq(R.monthEstimate(withBill, fx.txs, '2026-10', TODAY).bills, 95, 'an unpaid recurring phone bill on Oct 28 is added as "bills to come"');

// ---- twice a month ----
const semi = [];
['2026-03-01', '2026-03-15', '2026-04-01', '2026-04-15', '2026-05-01', '2026-05-15', '2026-06-01', '2026-06-15', '2026-07-01', '2026-07-15', '2026-08-01', '2026-08-15', '2026-09-01', '2026-09-15', '2026-10-01', '2026-10-15'].forEach(d => semi.push(tx(d, 1500, 'ACME PAYROLL TWICE', '_income', { direction: 'in' })));
const fs2 = R.detect(semi, TODAY, [], []).find(x => x.key === 'ACME PAYROLL TWICE');
T.ok(fs2 && fs2.cadence === 'semimonthly' && fs2.day2 === 15 && fs2.kind === 'income' && fs2.yearly === 36000, 'pay on the 1st and 15th is found as "Twice a month" (not every 2 weeks): $1,500 × 24 = $36,000 a year');
const eom = [];
[['2026-03-15', '2026-03-31'], ['2026-04-15', '2026-04-30'], ['2026-05-15', '2026-05-29'], ['2026-06-15', '2026-06-30'], ['2026-07-15', '2026-07-31'], ['2026-08-14', '2026-08-31'], ['2026-09-15', '2026-09-30'], ['2026-10-15', '2026-10-30']].forEach(p => p.forEach(d => eom.push(tx(d, 900, 'EOM PAY', '_income', { direction: 'in' }))));
const fe = R.detect(eom, TODAY, [], []).find(x => x.key === 'EOM PAY');
T.ok(fe && fe.cadence === 'semimonthly' && fe.day2 === 31, 'the 15th and the last day of the month: second day recorded as "last day" (31)');
T.eq(R.schedule({ cadence: 'semimonthly', anchor: '2026-10-01', day2: 15 }, '2026-10-01', '2026-11-30'), ['2026-10-01', '2026-10-15', '2026-11-01', '2026-11-15'], 'schedule: the 1st and 15th of each month');
T.eq(R.schedule({ cadence: 'semimonthly', anchor: '2026-01-15', day2: 31 }, '2026-02-01', '2026-03-31'), ['2026-02-15', '2026-02-28', '2026-03-15', '2026-03-31'], 'schedule: "last day" follows short months (Feb 28)');
const semiItem = { id: 's1', name: 'Pay', key: 'ACME PAYROLL TWICE', kind: 'income', cadence: 'semimonthly', anchor: '2026-10-01', day2: 15, amount: 1500, amountMode: 'fixed', active: true };
const sst = R.status(semiItem, semi, '2026-10-01', '2026-10-31', '2026-10-22');
T.eq(sst.map(x => x.date + ':' + x.state), ['2026-10-01:paid', '2026-10-15:paid'], 'both October paycheques matched as paid');
T.eq(R.perYear('semimonthly', 100), 2400, 'twice a month = 24 a year');
T.ok(R.detect(data, TODAY, [], []).find(x => x.key === 'PAYROLL ACME').cadence === 'biweekly', 'every-14-days pay is still "every 2 weeks" (not mistaken for twice a month)');

// ---- unmarking single payments ----
const nfx = data.filter(t => t.desc === 'NETFLIX.COM' && t.amount > 0);
const marked = data.map(t => Object.assign({}, t, nfx.slice(0, 2).includes(t) ? { notRecurring: true } : {}));
T.eq(R.detect(marked, TODAY, [], []).find(x => x.key === 'NETFLIX COM').count, 5, 'two payments marked "not recurring" are left out of detection (5 of 7 counted)');
const mostly = data.map(t => Object.assign({}, t, nfx.slice(0, 5).includes(t) ? { notRecurring: true } : {}));
T.ok(!R.detect(mostly, TODAY, [], []).find(x => x.key === 'NETFLIX COM'), 'with only 2 left it is no longer suggested');
const nitem = { id: 'n1', name: 'Netflix', key: 'NETFLIX COM', kind: 'expense', cadence: 'monthly', anchor: '2026-10-03', amount: 20.99, amountMode: 'fixed', active: true };
T.eq(R.status(nitem, data, '2026-10-01', '2026-10-31', TODAY).map(x => x.state), ['paid'], 'October Netflix matches the item');
const octOut = data.map(t => t.desc === 'NETFLIX.COM' && t.date === '2026-10-03' ? Object.assign({}, t, { notRecurring: true }) : t);
T.eq(R.status(nitem, octOut, '2026-10-01', '2026-10-31', TODAY).map(x => x.state), ['late'], 'mark that payment "not recurring" and the bill shows late (it is no longer matched)');

// ---- guess from one transaction ----
const g1 = R.guess(data, data.find(t => t.desc === 'NETFLIX.COM' && t.date === '2026-10-03'), TODAY);
T.eq([g1.cadence, g1.certain, g1.anchor, g1.kind], ['monthly', true, '2026-11-03', 'expense'], 'a Netflix payment: monthly, next on 2026-11-03');
const g2 = R.guess(data, tx('2026-10-10', 15, 'BRAND NEW SHOP', 'dine-out'), TODAY);
T.eq([g2.cadence, g2.certain, g2.count], ['monthly', false, 1], 'a one-off with no history: monthly as a starting point, marked uncertain');
const g3 = R.guess(semi, semi[semi.length - 1], TODAY);
T.eq([g3.cadence, g3.day2], ['semimonthly', 15], 'a paycheque series is guessed as twice a month');
T.ok(R.guess(data, tx('2026-10-10', -5, 'REFUND', 'dine-out'), TODAY) === null, 'a refund cannot be made recurring');

// ---- monthly and quarterly, end to end ----
const q2 = ['2026-04-15', '2026-07-15'].map(d => tx(d, 300, 'CITY PROPERTY TAX', 'other-household'));
const fq2 = R.detect(q2, TODAY, [], []).find(x => x.key === 'CITY PROPERTY TAX');
T.ok(fq2 && fq2.cadence === 'quarterly' && fq2.count === 2 && fq2.yearly === 1200, 'quarterly is found after 2 payments when the amount is identical ($300 × 4 = $1,200 a year)');
const q2v = [tx('2026-04-15', 300, 'VARIED SHOP', 'other-household'), tx('2026-07-15', 410, 'VARIED SHOP', 'other-household')];
T.ok(!R.detect(q2v, TODAY, [], []).find(x => x.key === 'VARIED SHOP'), 'two payments 3 months apart with different amounts need a third before it is suggested');
const q3 = ['2026-01-15', '2026-04-15', '2026-07-15'].map(d => tx(d, 300, 'CITY PROPERTY TAX', 'other-household'));
T.eq(R.detect(q3, TODAY, [], []).find(x => x.key === 'CITY PROPERTY TAX').cadence, 'quarterly', 'three payments: quarterly');
const mo = ['2026-07-31', '2026-08-31', '2026-09-30'].map(d => tx(d, 30, 'MONTH END CO', 'fitness'));
T.eq(R.detect(mo, TODAY, [], []).find(x => x.key === 'MONTH END CO').cadence, 'monthly', 'monthly: the 31st / 30th still counts as every month');
const qItem = { id: 'qi', name: 'Property tax', key: 'CITY PROPERTY TAX', kind: 'expense', cadence: 'quarterly', anchor: '2026-10-15', amount: 300, amountMode: 'fixed', categoryId: 'other-household', active: true };
T.eq(R.schedule(qItem, '2026-10-01', '2027-08-31'), ['2026-10-15', '2027-01-15', '2027-04-15', '2027-07-15'], 'quarterly schedule runs across the year end');
T.eq(R.schedule({ cadence: 'monthly', anchor: '2026-01-31', amount: 1 }, '2026-01-01', '2026-04-30'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'], 'monthly on the 31st follows short months (Feb 28)');
T.eq(R.perYear('quarterly', 300), 1200, 'quarterly = 4 a year');
T.eq(R.perYear('monthly', 100), 1200, 'monthly = 12 a year');
// status with the quarterly tolerance (7 days)
const paidLate = R.status(qItem, q3.concat([tx('2026-10-19', 300, 'CITY PROPERTY TAX', 'other-household')]), '2026-10-01', '2026-10-31', '2026-10-22');
T.eq(paidLate.map(x => x.state), ['paid'], 'a quarterly payment 4 days after its date still counts as paid');
T.eq(R.status(qItem, q3, '2026-10-01', '2026-10-31', '2026-10-22').map(x => x.state), ['due'], 'unpaid and only 7 days past: still "due"');
T.eq(R.status(qItem, q3, '2026-10-01', '2026-11-30', '2026-11-05').map(x => x.state), ['late'], 'unpaid 21 days past: "late"');
// month-end estimate treats a quarterly bill as a bill to come, even in an everyday category
const ecfg = Object.assign({}, fx.cfg, { recurring: [Object.assign({}, qItem, { anchor: '2026-10-28' })] });
const est = R.monthEstimate(ecfg, fx.txs, '2026-10', TODAY), part = est.parts.find(p => p.cat.id === 'other-household');
T.ok(part && part.kind === 'bill' && part.add >= 300, 'month-end estimate: the $300 quarterly bill due Oct 28 is a bill to come (' + (part && part.kind) + ')');
const estLater = R.monthEstimate(Object.assign({}, fx.cfg, { recurring: [Object.assign({}, qItem, { anchor: '2026-12-15' })] }), fx.txs, '2026-10', TODAY);
T.ok(!estLater.parts.some(p => p.cat.id === 'other-household' && p.kind === 'bill' && p.add >= 300), 'a quarterly bill that falls in a later month is not added to this month');
// coming up: a quarterly bill due within 30 days shows; one 60 days away does not
const upSoon = R.upcoming(Object.assign({}, fx.cfg, { recurring: [Object.assign({}, qItem, { anchor: '2026-11-10' })] }), [], TODAY, 30);
T.eq(upSoon.map(x => x.item.name + ':' + x.date), ['Property tax:2026-11-10'], 'Coming up lists a quarterly bill due in 19 days');
T.eq(R.upcoming(Object.assign({}, fx.cfg, { recurring: [Object.assign({}, qItem, { anchor: '2026-12-31' })] }), [], TODAY, 30).length, 0, '…and not one that is 70 days away');
T.done();
