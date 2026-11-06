/* Version 12 features in the browser (grows one feature at a time).
   F2: amount conditions, learning from your choices, confidence labels, tax refunds as income.
   F1: bills & subscriptions found in history, Coming up on Home, month-end estimate.
   F3: big expenses as sinking funds (set aside monthly, pay from a fund, kept out of monthly limits).
   F4: account balances (from imports or typed in), estimate for today, net worth and its month-end chart.
   F5: loan details and the payoff plan (avalanche / snowball, extra slider, nothing saved until "Use this plan").
   Run from the work (or our-budget) folder: node tests/v12.test.js (needs Playwright) */
require('./_clock'); const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const APP = 'file://' + path.resolve(__dirname, '../index.html');
const PKG = path.resolve(__dirname, '..');
const pick = (...c) => c.find(f => fs.existsSync(f));
const SEED = pick(PKG + '/private/budget-seed.json', process.env.BUDGET_SEED || '');
const GEN = pick(PKG + '/rules/rules-general.csv', process.env.BUDGET_RULES || '');
const PERS = pick(PKG + '/private/rules-personal.csv', process.env.BUDGET_RULES_PERSONAL || '');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'v12-'));
let fails = 0;
function ok(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; }
const wait = (p, ms) => p.waitForTimeout(ms || 250);

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const net = [];
  await ctx.route('**/*', r => { const u = r.request().url(); if (/^(file|data|blob):/.test(u)) return r.continue(); net.push(u); return r.abort(); });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(APP);
  await page.setInputFiles('#seed', SEED); await page.waitForSelector('#rs-general');
  await page.setInputFiles('#rs-general', GEN); await wait(page, 400);
  await page.setInputFiles('#rs-personal', PERS); await wait(page, 400);
  // history: 5 reviewed MYSTERY SHOP lines tagged Gifts; 3 of 3 PIXEL PRINT tagged Entertainment
  await page.evaluate(async () => {
    const l = [];
    for (let i = 1; i <= 5; i++) l.push({ id: 'h' + i, source: 'csv', direction: 'out', desc: 'MYSTERY SHOP 77', date: '2026-0' + i + '-10', amount: 30 + i, categoryId: 'gifts', type: 'expense', flags: [], createdAt: '2026-01-01T00:00:00Z' });
    for (let i = 1; i <= 3; i++) l.push({ id: 'p' + i, source: 'csv', direction: 'out', desc: 'PIXEL PRINT SHOP', date: '2026-0' + i + '-12', amount: 12, categoryId: 'entertainment', type: 'expense', flags: [], createdAt: '2026-01-01T00:00:00Z' });
    await DB.putTx(l); await UI.reload();
  });

  // ---------- F2: Costco amount rule through the editor ----------
  await page.evaluate(() => { location.hash = '#/rules'; }); await page.waitForSelector('#rt');
  await page.click('button:text-is("Add a rule")'); await page.waitForSelector('#re-pat');
  await page.fill('#re-pat', 'costco'); await page.selectOption('#re-val', 'Big Purchases');
  await page.fill('#re-min', '500'); await page.fill('#re-max', '100'); await page.locator('#re-max').blur();
  ok(/bigger than the largest/.test(await page.locator('#err-amount').innerText()), 'min above max: the editor says how to fix it');
  await page.fill('#re-max', ''); await page.fill('#re-min', '300'); await page.selectOption('#re-dir', 'out'); await page.fill('#re-pri', '120');
  await page.click('.panel button:text-is("Add rule")'); await wait(page, 300);
  const row = await page.evaluate(() => { const s = App.cfg.ruleSets.personal, hd = s.rows[0]; const r = s.rows.find(x => x[0] === 'M001'); return hd.reduce((o, k, i) => (o[k] = r[i], o), {}); });
  ok(row.pattern === 'COSTCO' && row.min_amount === '300' && row.max_amount === '' && row.direction === 'out', 'rule saved with "only $300 and up, money out"');
  await page.fill('#rq', 'COSTCO'); await wait(page, 150);
  ok(/only \$300 and up, money out/.test(await page.locator('.rule-row').first().innerText()), 'the rules list shows the condition');
  await page.fill('#rt', 'COSTCO WHOLESALE W123'); await page.fill('#rt-amt', '650'); await wait(page, 300);
  ok(/Big Purchases/.test(await page.locator('.test-verdict').innerText()), 'test box: COSTCO $650 money out → Big Purchases');
  await page.fill('#rt-amt', '45'); await wait(page, 300);
  ok(/Groceries/.test(await page.locator('.test-verdict').innerText()), 'test box: COSTCO $45 → Groceries');
  ok(/Confidence:/.test(await page.locator('#rt').evaluate(e => e.closest('section').innerText)), 'test box shows a confidence');

  // ---------- F2: import ----------
  const csv = path.join(TMP, 'bank-9911.csv');
  fs.writeFileSync(csv, ['Date,Description,Amount', '2026-10-02,COSTCO WHOLESALE W123,-650.00', '2026-10-03,COSTCO WHOLESALE W123,-45.00', '2026-10-04,MYSTERY SHOP 77,-25.00',
    '2026-10-05,PIXEL PRINT SHOP,-14.00', '2026-10-06,CRA TAX REFUND,425.00', '2026-10-07,SAFEWAY #4545,-30.00', '2026-10-08,UNHEARD OF PLACE,-9.00'].join('\n'));
  await page.evaluate(() => { location.hash = '#/import'; }); await page.waitForSelector('#csvf');
  await page.setInputFiles('#csvf', csv); await wait(page, 500);
  if (await page.locator('section .toast.warn button.primary').count()) await page.locator('section .toast.warn button.primary').first().click();
  else { await page.selectOption('#acct', '__new'); await page.fill('#an', 'Test chequing'); await page.selectOption('#ak', 'bank'); await page.click('button:text-is("Add account")'); }
  await wait(page, 400);
  const items = await page.evaluate(() => Importer._files()[0].items.map(it => ({ d: it.desc, a: it.amountRaw, cat: it.catId, conf: it.conf, why: it.why, review: it.review })));
  const get = (d, a) => items.find(i => i.d === d && (a === undefined || i.a === a));
  ok(get('COSTCO WHOLESALE W123', -650).cat === 'big-purchases', 'import: COSTCO $650 → Big Purchases');
  ok(get('COSTCO WHOLESALE W123', -45).cat === 'groceries', 'import: COSTCO $45 → Groceries');
  const ms = get('MYSTERY SHOP 77');
  ok(ms.cat === 'gifts' && ms.conf === 'sure' && !ms.review && /5 of 5/.test(ms.why), 'no rule, 5 of 5 past choices → Gifts, Sure: "' + ms.why + '"');
  const pp = get('PIXEL PRINT SHOP');
  ok(pp.cat === 'entertainment' && pp.conf === 'likely' && pp.review, '3 of 3 past choices → suggested (Likely, flagged)');
  const cra = get('CRA TAX REFUND');
  ok(cra.cat === '_income' && cra.review, 'CRA TAX REFUND money in → Income, suggested (was "pending")');
  ok(get('SAFEWAY #4545').conf === 'likely' || get('SAFEWAY #4545').conf === 'sure', 'a normal rule match gets Sure or Likely (' + get('SAFEWAY #4545').conf + ')');
  ok(get('UNHEARD OF PLACE').conf === 'guess', 'no rule and no history → Guess');
  ok(await page.locator('table .conf').count() >= 5, 'the import preview shows confidence labels');
  await page.click('button:has-text("Import all")').catch(async () => { await page.locator('button.primary:has-text("Import")').first().click(); });
  await wait(page, 500);
  const stored = await page.evaluate(() => App.txs.filter(t => t.file === 'bank-9911.csv').map(t => ({ d: t.desc, conf: t.conf, why: t.tagWhy })));
  ok(stored.length === 7 && stored.every(t => t.conf), 'imported lines keep their confidence and reason (' + stored.length + ')');
  await page.evaluate(() => { location.hash = '#/transactions?m=2026-10'; }); await wait(page, 300);
  ok(await page.locator('.tx .conf').count() >= 5, 'Transactions rows show the confidence word');
  // choosing a category yourself makes it Sure
  await page.locator('.tx', { hasText: 'UNHEARD OF PLACE' }).locator('button.tag').click();
  await page.selectOption('.editor select', 'dine-out'); await page.click('.editor button:text-is("Save")'); await wait(page, 300);
  ok(await page.evaluate(() => { const t = App.txs.find(x => x.desc === 'UNHEARD OF PLACE'); return t.conf === 'sure' && t.tagWhy === 'You chose this'; }), 'changing a category yourself marks it Sure, "You chose this"');

  // ---------- F1: recurring ----------
  await page.evaluate(async () => {
    const t = U.today(), l = [];
    for (let k = 1; k <= 6; k++) { const d = U.shiftMonth(t.slice(0, 7), -k) + '-03'; l.push({ id: 'nf' + k, source: 'csv', direction: 'out', desc: 'NETFLIX.COM', date: d, amount: 20.99, categoryId: 'subscriptions', type: 'expense', flags: [], createdAt: d + 'T00:00:00Z' }); }
    for (let k = 1; k <= 4; k++) { const d = Recurring.addMonths(t, -2 * k + 1).slice(0, 8) + '18'; l.push({ id: 'hy' + k, source: 'csv', direction: 'out', desc: 'BC HYDRO', date: d, amount: 40 + k * 3, categoryId: 'utilities', type: 'expense', flags: [], createdAt: d + 'T00:00:00Z' }); }
    await DB.putTx(l); await UI.reload(); location.hash = '#/home';
  });
  await wait(page, 400);
  ok(/were found in your history/.test(await page.locator('section[aria-labelledby=upc]').innerText()), 'Home "Coming up" says bills were found in your history');
  ok(/At this pace .* ends about \$[\d,]+ (under|over) budget/.test(await page.locator('.est').innerText()), 'Home shows the month-end estimate: ' + (await page.locator('.est').innerText()).split('\n')[0]);
  await page.click('.est button'); await wait(page);
  ok(/Bills still to come/.test(await page.locator('#est-how').innerText()) && await page.locator('.est button').getAttribute('aria-expanded') === 'true', '"How?" shows the breakdown');
  await page.keyboard.press('g'); await page.keyboard.press('b'); await page.waitForSelector('#rc-found');
  const sugg = await page.locator('.rc-row').allInnerTexts();
  ok(sugg.some(x => /NETFLIX\.COM/.test(x) && /Every month/.test(x) && /\$20\.99/.test(x)), 'G B opens Bills & subscriptions; Netflix found: every month, $20.99');
  ok(sugg.some(x => /BC HYDRO/.test(x) && /Every 2 months/.test(x)), 'BC Hydro found: every 2 months');
  await page.click('.rc-row:has-text("NETFLIX.COM") button:text-is("Confirm")'); await wait(page, 300);
  ok(await page.evaluate(() => App.cfg.recurring.length === 1 && App.cfg.recurring[0].key === 'NETFLIX COM'), 'Confirm adds Netflix to your recurring items');
  await page.click('.rc-row:has-text("BC HYDRO") button:text-is("Not recurring")'); await wait(page, 300);
  ok(await page.evaluate(() => App.cfg.recurringIgnore.includes('BC HYDRO|expense')) && !(await page.locator('.rc-row:has-text("BC HYDRO")').count()), 'Not recurring: Hydro is no longer suggested');
  await page.click('#toast button:text-is("Undo")'); await wait(page, 300);
  ok(await page.locator('.rc-row:has-text("BC HYDRO")').count() === 1, 'Undo brings the suggestion back');
  const nid = await page.evaluate(() => App.cfg.recurring[0].id);
  await page.click('.rc-item:has-text("NETFLIX") button:text-is("Edit")');
  await page.fill('#rc-amt-' + nid, '22.99'); await page.locator('#rc-amt-' + nid).blur(); await wait(page, 300);
  ok(await page.evaluate(() => App.cfg.recurring[0].amount === 22.99), 'editing the amount saves at once');
  await page.click('#main button:text-is("+ Add")'); await page.waitForSelector('#rc-n');
  await page.fill('#rc-n', 'Spotify'); await page.fill('#rc-m', 'SPOTIFY'); await page.fill('#rc-a', '11.99');
  await page.evaluate(() => { const d = document.getElementById('rc-d'); d.value = Recurring.addDays(U.today(), 5); d.dispatchEvent(new Event('change')); });
  await page.click('#main button:text-is("Add")'); await wait(page, 300);
  ok(await page.evaluate(() => App.cfg.recurring.some(r => r.name === 'Spotify' && r.key === 'SPOTIFY' && r.amount === 11.99)), 'Add one: Spotify $11.99');
  await page.evaluate(() => { location.hash = '#/home'; }); await wait(page, 500);
  const upc = await page.locator('section[aria-labelledby=upc] .upc-row').allInnerTexts();
  ok(upc.some(x => /Spotify/.test(x) && /Due/.test(x) && /in 5 days/.test(x)), 'Coming up: Spotify, Due, in 5 days');
  ok(upc.some(x => /NETFLIX/.test(x) && /(Paid ✓|Different amount|Due|Late)/.test(x)), 'Coming up: Netflix with a status word');
  ok(await page.evaluate(() => Home && document.querySelector('.st-chip') && getComputedStyle(document.querySelector('.st-chip')).fontWeight >= 600), 'status chips carry words, not just colour');

  // ---------- F3: big expenses as sinking funds ----------
  await page.evaluate(() => { location.hash = '#/home'; }); await wait(page, 300);
  ok(await page.evaluate(() => App.cfg.bigExpenses.length === 3 && App.cfg.bigExpenses.every(f => /^\d{4}-\d{2}$/.test(f.due) && /^\d{4}-\d{2}$/.test(f.start))), 'existing big expenses get a due month and a start month on load');
  const now = await page.evaluate(() => U.today().slice(0, 7)), due2 = await page.evaluate(n => Funds.addYm(n, 2), now);
  await page.evaluate(() => { location.hash = '#/settings'; }); await wait(page, 300);
  await page.click('button[aria-label="Edit IRCC fees"]').catch(async () => { await page.locator('button[aria-label^="Edit IRCC"]').click(); });
  await page.waitForSelector('#bd');
  await page.fill('#bd', due2); await page.fill('#bs', now); await page.click('button:text-is("Save changes")'); await wait(page, 400);
  ok(await page.evaluate(d => App.cfg.bigExpenses.some(f => /IRCC/.test(f.name) && f.due === d), due2), 'Settings: IRCC due month edited (' + due2 + ')');
  await page.click('button:text-is("Add a big expense")'); await page.waitForSelector('#bn');
  await page.click('button:text-is("Add big expense")'); await wait(page, 200);
  ok(/Give it a name/.test(await page.locator('fieldset [role=alert]').innerText()), 'Settings: a new big expense without a name says what is missing');
  await page.click('fieldset button:text-is("Cancel")'); await wait(page, 200);
  await page.evaluate(() => { location.hash = '#/home'; }); await wait(page, 300);
  const irccCard = await page.locator('.fund:has-text("IRCC")').innerText();
  ok(/Set aside \$433\.33 this month/.test(irccCard) && /3 months left/.test(irccCard), 'Home: IRCC $1,300 over 3 months → "Set aside $433.33 this month", 3 months left');
  ok(/Set aside for big expenses this month/.test(await page.locator('section[aria-labelledby=saved]').innerText()), 'Home: total set aside this month shown');
  const leftBefore = await page.evaluate(() => M.month(App.cfg, App.txs, U.today().slice(0, 7), U.today()).left);
  await page.evaluate(() => UI.expensePanel(null, App.render)); await page.click('details.more > summary'); await page.waitForSelector('#fund');
  await page.fill('#amt', '250'); await page.fill('#desc', 'AMEX MEMBERSHIP FEE');
  const amexId = await page.evaluate(() => App.cfg.bigExpenses.find(f => /amex/i.test(f.name)).id);
  await page.selectOption('#fund', amexId); await wait(page, 150);
  ok(await page.evaluate(() => document.getElementById('allcat').value === 'fees-admin'), 'Pay from Amex fee: the category fills in (Fees & Admin)');
  await page.click('button:text-is("Save expense")'); await wait(page, 400); await page.keyboard.press('Escape'); await wait(page, 300);
  const sNow = await page.evaluate(() => M.month(App.cfg, App.txs, U.today().slice(0, 7), U.today()));
  ok(sNow.left === leftBefore && sNow.fromFunds === 250, 'Amex $250 paid from its fund: left to spend unchanged, $250 paid from big expenses');
  ok(/\$250 paid from big expenses/.test(await page.locator('main header').innerText()), 'Home header says "$250 paid from big expenses"');
  ok(/Paid \$250 ✓/.test(await page.locator('.fund:has-text("Amex")').innerText()), 'Home: the Amex card shows Paid $250 ✓');
  // import: an IRCC charge near its due month is suggested for the fund
  const csv2 = path.join(TMP, 'bank-9911-b.csv');
  fs.writeFileSync(csv2, ['Date,Description,Amount', (await page.evaluate(() => U.today())) + ',IMMIGRATION CANADA ONLINE 5521,-1300.00'].join('\n'));
  await page.evaluate(() => { location.hash = '#/import'; }); await page.waitForSelector('#csvf');
  await page.setInputFiles('#csvf', csv2); await wait(page, 500);
  if (await page.locator('section .toast.warn button.primary').count()) await page.locator('section .toast.warn button.primary').first().click();
  else if (await page.locator('#acct').count()) { await page.selectOption('#acct', { label: 'Test chequing' }).catch(() => {}); }
  await wait(page, 400);
  const fit = await page.evaluate(() => { const it = Importer._files().slice(-1)[0].items[0]; return { fund: it.fundId, review: it.review, why: it.reasons.join('; '), cat: it.catId }; });
  const irccId = await page.evaluate(() => App.cfg.bigExpenses.find(f => /IRCC/.test(f.name)).id);
  ok(fit.fund === irccId && fit.review && /IRCC/.test(fit.why), 'import: IRCC charge suggested for the IRCC fund, flagged for review ("' + fit.why + '")');
  await page.click('button:has-text("Import all")').catch(async () => { await page.locator('button.primary:has-text("Import")').first().click(); });
  await wait(page, 500);
  ok(await page.evaluate(id => App.txs.some(t => /IMMIGRATION/.test(t.desc) && t.fundId === id && t.needsTag), irccId), 'the imported line keeps the fund and waits in Review');
  await page.evaluate(() => { location.hash = '#/review'; }); await wait(page, 300);
  for (let i = 0; i < 12 && !(await page.locator('#rv-fund').count()); i++) { await page.keyboard.press('s'); await wait(page, 200); }
  ok(await page.locator('#rv-fund').isChecked(), 'Review: "Pay from big expense IRCC" is ticked');
  await page.locator('#rv-fund').uncheck(); await wait(page, 400);
  ok(await page.evaluate(() => App.txs.some(t => /IMMIGRATION/.test(t.desc) && !t.fundId)), 'unticking makes it ordinary spending');
  await page.locator('#rv-fund').check(); await wait(page, 400);
  ok(await page.evaluate(id => App.txs.some(t => /IMMIGRATION/.test(t.desc) && t.fundId === id), irccId), '…and ticking again puts it back on the fund');
  // removing a fund: named confirmation, payments become ordinary spending, Undo restores
  await page.evaluate(() => { location.hash = '#/settings'; }); await wait(page, 300);
  await page.locator('button[aria-label^="Remove Amex"]').click(); await wait(page, 200);
  ok(/Its 1 payment will count as ordinary spending again/.test(await page.locator('.toast.warn[role=alert]').innerText()), 'remove asks first and says what happens to its payment');
  await page.locator('.toast.warn[role=alert] button:text-is("Remove")').click(); await wait(page, 400);
  const sGone = await page.evaluate(() => M.month(App.cfg, App.txs, U.today().slice(0, 7), U.today()));
  ok(sGone.left === Math.round((leftBefore - 250) * 100) / 100 && sGone.fromFunds === 1300, 'fund removed: the $250 counts against this month again (IRCC stays on its fund)');
  await page.click('#toast button:text-is("Undo")'); await wait(page, 400);
  ok(await page.evaluate(id => App.cfg.bigExpenses.some(f => f.id === id), amexId) && (await page.evaluate(() => M.month(App.cfg, App.txs, U.today().slice(0, 7), U.today()).left)) === leftBefore, 'Undo restores the fund and the budget');

  // ---------- F4: accounts & net worth ----------
  const td = path.join(TMP, 'td-chequing-7788.csv');
  fs.writeFileSync(td, ['10/01/2026,SAFEWAY #4545,45.10,,1200.00', '10/03/2026,NETFLIX.COM,20.99,,1179.01', '10/06/2026,TFR-TO C/C,812.40,,366.61',
    '10/10/2026,SAVE ON FOODS,61.25,,305.36', '10/12/2026,CRA REFUND,,425.00,730.36', '10/12/2026,SAVE ON FOODS,61.25,,669.11'].join('\n'));
  await page.evaluate(() => { location.hash = '#/import'; }); await page.waitForSelector('#csvf');
  await page.setInputFiles('#csvf', td); await wait(page, 500);
  await page.locator('[role=tablist][aria-label=Files] button:has-text("td-chequing")').click().catch(() => {}); await wait(page, 200);
  if (await page.locator('section .toast.warn button.primary').count()) await page.locator('section .toast.warn button.primary').first().click();
  else { await page.selectOption('#acct', '__new'); await page.fill('#an', 'TD chequing'); await page.selectOption('#ak', 'bank'); await page.click('button:text-is("Add account")'); }
  await wait(page, 400);
  const tdf = await page.evaluate(() => { const f = Importer._files().find(x => x.name === 'td-chequing-7788.csv'); return { bal: f.balance, explain: f.explain.join(' '), acct: f.accountId }; });
  ok(tdf.bal && tdf.bal.amount === 669.11 && tdf.bal.date === '2026-10-12', 'TD file (no header): closing balance $669.11 on 2026-10-12 found');
  ok(/Running balance/.test(tdf.explain) && /Closing balance \$669\.11/.test(await page.locator('main').innerText()), 'the import screen says the balance will be saved');
  await page.click('button:has-text("Import all")').catch(async () => { await page.locator('button.primary:has-text("Import")').first().click(); });
  await wait(page, 500);
  ok(await page.evaluate(id => { const a = App.cfg.accounts.find(x => x.id === id); return a && a.balances.some(b => b.date === '2026-10-12' && b.amount === 669.11 && b.source === 'import'); }, tdf.acct), 'importing records it on the account (source: import)');
  await page.keyboard.press('Escape'); await page.keyboard.press('g'); await page.keyboard.press('a'); await wait(page, 400);
  ok(await page.evaluate(() => location.hash === '#/accounts'), 'G A opens Accounts');
  const head = await page.locator('main header').innerText();
  ok(/net worth \$/.test(head), 'Accounts: net worth headline (' + head.split('\n')[0] + ')');
  ok(/from your import/.test(await page.locator('.acct-row:has-text("from your import")').first().innerText()), 'the TD row says where its balance came from');
  const nw0 = await page.evaluate(() => Accounts.netWorth(App.cfg, App.txs, U.today()).value);
  await page.click('button:text-is("Add an account")'); await page.waitForSelector('#na-n');
  await page.fill('#na-n', 'TFSA'); await page.selectOption('#na-t', 'investment'); await page.fill('#na-b', '15000'); await page.click('button:text-is("Add account")'); await wait(page, 400);
  const nw1 = await page.evaluate(() => Accounts.netWorth(App.cfg, App.txs, U.today()).value);
  ok(Math.abs(nw1 - nw0 - 15000) < 0.01, 'adding a TFSA with $15,000 raises net worth by $15,000');
  await page.click('button:text-is("Add an account")'); await page.waitForSelector('#na-n');
  await page.fill('#na-n', 'Travel Visa'); await page.selectOption('#na-t', 'credit'); await page.fill('#na-b', '8000'); await page.click('button:text-is("Add account")'); await wait(page, 400);
  const nw2 = await page.evaluate(() => Accounts.netWorth(App.cfg, App.txs, U.today()).value);
  ok(Math.abs(nw1 - nw2 - 8000) < 0.01 && /Credit cards/.test(await page.locator('main').innerText()), 'a credit card with $8,000 owed lowers it, shown under Credit cards');
  const tfsaId = await page.evaluate(() => App.cfg.accounts.find(a => a.name === 'TFSA').id);
  await page.fill('#bal-' + tfsaId, '16000'); await page.press('#bal-' + tfsaId, 'Enter'); await wait(page, 400);
  ok(Math.abs(await page.evaluate(() => Accounts.netWorth(App.cfg, App.txs, U.today()).value) - nw2 - 1000) < 0.01, 'Update balance (Enter): net worth follows');
  ok(await page.evaluate(id => document.activeElement && document.activeElement.id === 'bal-' + id, tfsaId), 'focus stays in the balance field after saving');
  await page.click('#toast button:text-is("Undo")'); await wait(page, 400);
  ok(Math.abs(await page.evaluate(() => Accounts.netWorth(App.cfg, App.txs, U.today()).value) - nw2) < 0.01, 'Undo puts the old balance back');
  await page.evaluate(async id => { const a = App.cfg.accounts.find(x => x.id === id); a.balances = Accounts.setBalance(a, U.shiftMonth(U.today().slice(0, 7), -1) + '-15', 14000, 'manual'); await UI.saveCfg(); App.render(); }, tfsaId);
  await wait(page, 400);
  ok(await page.locator('section[aria-labelledby=nw-h] .chart-col').count() >= 2, 'month-end net worth chart: one column per month with data');
  ok(/net worth/.test(await page.locator('section[aria-labelledby=nw-h] .chart-col').first().getAttribute('aria-label')), 'chart columns are named as net worth, not spending');

  // ---------- no loan features ----------
  ok(await page.locator('button:text-is("Payoff plan")').count() === 0 && await page.locator('button[aria-label^="Loan details"]').count() === 0, 'Accounts has no payoff plan and no loan details');
  ok(await page.locator('#na-t option').evaluateAll(os => os.every(o => o.value !== 'loan')).catch(() => true), 'a loan is not offered as an account type');

  ok(net.length === 0, 'no network requests (' + net.length + ')');
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close(); fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
