/* Feature 4: account balances and net worth. Run: node tests/unit/accounts.test.js */
'use strict';
const T = require('./t'), A = require('./harness')(['accounts.js']);
const Acc = A.Accounts, TODAY = '2026-10-22';
let n = 0;
const tx = (acct, date, amount, direction) => ({ id: 'x' + (n++), accountId: acct, date, amount, direction, type: 'expense', desc: 'X' });

// migration
const old = [{ id: 'b1', name: 'Chequing', kind: 'bank' }, { id: 'c1', name: 'Visa', kind: 'card' }];
old.forEach(Acc.migrateOne);
T.eq(old.map(a => [a.type, a.currency, a.balances.length]), [['chequing', 'CAD', 0], ['credit', 'CAD', 0]], 'existing accounts: bank → chequing, card → credit card, CAD, no balances yet');
const kept = { id: 'k', kind: 'bank', type: 'savings', balances: [{ date: '2026-01-01', amount: 5, source: 'manual' }], currency: 'USD' };
Acc.migrateOne(kept);
T.eq([kept.type, kept.balances.length, kept.currency], ['savings', 1, 'USD'], 'migration never overwrites');
const cfgM = A.M.migrate({ accounts: [{ id: 'z', name: 'Z', kind: 'card' }] });
T.eq(cfgM.accounts[0].type, 'credit', 'M.migrate fills account types');

// closing balance from a file (TD sample: running balance, oldest first; ties → last row)
T.eq(Acc.fromFile([{ date: '2026-10-01', balance: 900 }, { date: '2026-10-12', balance: 700 }, { date: '2026-10-12', balance: 669.11 }]), { date: '2026-10-12', amount: 669.11 }, 'oldest-first file: latest date, last row → $669.11 on 2026-10-12');
T.eq(Acc.fromFile([{ date: '2026-10-12', balance: 669.11 }, { date: '2026-10-12', balance: 700 }, { date: '2026-10-01', balance: 900 }]), { date: '2026-10-12', amount: 669.11 }, 'newest-first file: latest date, first row');
T.eq(Acc.fromFile([{ date: '2026-10-01', balance: null }]), null, 'no balance column → nothing recorded');

// balances and estimates
const bank = { id: 'b', name: 'Chequing', type: 'chequing', balances: [] }, card = { id: 'c', name: 'Visa', type: 'credit', balances: [] };
bank.balances = Acc.setBalance(bank, '2026-10-12', 669.11, 'import');
bank.balances = Acc.setBalance(bank, '2026-09-30', 1200, 'manual');
bank.balances = Acc.setBalance(bank, '2026-10-12', 670, 'manual');
T.eq(bank.balances.map(b => b.date + ' ' + b.amount), ['2026-09-30 1200', '2026-10-12 670'], 'balances kept in date order, one per date (latest entry wins)');
card.balances = Acc.setBalance(card, '2026-10-01', 400, 'manual');
const txs = [tx('b', '2026-10-14', 50, 'out'), tx('b', '2026-10-15', 2000, 'in'), tx('b', '2026-10-12', 99, 'out'), tx('b', '2026-10-30', 10, 'out'),
  tx('c', '2026-10-05', 120.5, 'out'), tx('c', '2026-10-09', 300, 'in'), tx('other', '2026-10-15', 5, 'out')];
const eb = Acc.estimate(bank, txs, TODAY);
T.eq([eb.amount, eb.count], [2620, 2], 'bank: $670 on Oct 12 − $50 + $2,000 after it = $2,620 (same-day and future lines not added)');
const ec = Acc.estimate(card, txs, TODAY);
T.eq(ec.amount, 220.5, 'card: owe $400 + $120.50 purchase − $300 payment = $220.50 owed');
T.eq(Acc.estimate({ id: 'n', type: 'savings', balances: [] }, txs, TODAY), null, 'no balance yet → no estimate (not a guess of $0)');
T.eq(Acc.balanceOn(bank, '2026-10-01').amount, 1200, 'balance as of a date = latest on or before it');

// net worth
const tfsa = { id: 't', name: 'TFSA', type: 'investment', balances: [{ date: '2026-10-01', amount: 15000, source: 'manual' }] };
const usd = { id: 'u', name: 'US account', type: 'savings', currency: 'USD', rate: 1.37, balances: [{ date: '2026-10-01', amount: 1000, source: 'manual' }] };
const loan = { id: 'l', name: 'Car loan', type: 'loan', balances: [{ date: '2026-10-01', amount: 8000, source: 'manual' }] };
const none = { id: 'e', name: 'New savings', type: 'savings', balances: [] };
const closed = { id: 'z', name: 'Old card', type: 'credit', closed: true, balances: [{ date: '2026-01-01', amount: 999, source: 'manual' }] };
const cfg = { accounts: [bank, card, tfsa, usd, loan, none, closed] };
const w = Acc.netWorth(cfg, txs, TODAY);
T.eq([w.assets, w.debts, w.value], [2620 + 15000 + 1370, 220.5 + 8000, A.U.round2(2620 + 15000 + 1370 - 8220.5)], 'net worth = assets − debts (USD at your rate of 1.37; closed accounts left out)');
T.eq(w.missing.map(a => a.name), ['New savings'], 'accounts with no balance are listed as "no balance yet"');
const overdraft = { accounts: [{ id: 'o', type: 'chequing', balances: [{ date: '2026-10-01', amount: -45, source: 'import' }] }] };
T.eq(Acc.netWorth(overdraft, [], TODAY).value, -45, 'overdraft: a negative asset lowers net worth');
tfsa.balances = Acc.setBalance(tfsa, '2026-10-20', 16000, 'manual');
T.eq(Acc.netWorth(cfg, txs, TODAY).value, A.U.round2(w.value + 1000), 'updating a balance changes net worth');

// month-end series
const s = Acc.series(cfg, txs, 12, TODAY);
T.eq(s.map(x => x.ym), ['2026-09', '2026-10'], 'one point per month that has a balance (Sep: bank $1,200 only; Oct so far)');
T.eq([s[0].value, s[1].partial], [1200, true], 'Sep 30 = $1,200; October is marked as so far');
T.done();
