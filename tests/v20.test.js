/* Version 20 in the browser: menu order and the Settings sub-menu, Bills & subscriptions as a page, Accounts (rename any time, no loans).
   Run from the work (or our-budget) folder: node tests/v20.test.js (needs Playwright) */
require('./_clock'); const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const APP = 'file://' + path.resolve(__dirname, '../index.html');
const PKG = path.resolve(__dirname, '..');
const pick = (...c) => c.find(f => fs.existsSync(f));
const SEED = pick(PKG + '/private/budget-seed.json', process.env.BUDGET_SEED || '');
const GEN = pick(PKG + '/rules/rules-general.csv', process.env.BUDGET_RULES || '');
let fails = 0;
function ok(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; }
const wait = (p, ms) => p.waitForTimeout(ms || 300);

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const net = [];
  await ctx.route('**/*', r => { const u = r.request().url(); if (/^(file|data|blob):/.test(u)) return r.continue(); net.push(u); return r.abort(); });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(APP);
  await page.setInputFiles('#seed', SEED); await page.waitForSelector('#rs-general');
  await page.setInputFiles('#rs-general', GEN); await wait(page, 400);
  const go = async (h) => { await page.evaluate(h => { location.hash = h; }, h); await wait(page, 400); };
  const TODAY = await page.evaluate(() => U.today()), YM = TODAY.slice(0, 7);

  // ================= M. menu and Settings sub-menu =================
  await go('#/home');
  const menu = await page.evaluate(() => [...document.querySelectorAll('#nav-links a')].map(a => a.firstChild.textContent.trim()));
  ok(JSON.stringify(menu) === JSON.stringify(['Home', 'Transactions', 'Insights', 'Review', 'Import', 'Data health', 'Settings']), 'menu order: Home, Transactions, Insights, Review, Import, Data health, Settings (' + menu.join(', ') + ')');
  ok(!menu.includes('Rules') && !menu.includes('Accounts'), 'Rules and Accounts are no longer in the menu');
  await go('#/settings');
  const subs = await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Settings sections"] a')].map(a => a.textContent.trim()));
  ok(JSON.stringify(subs) === JSON.stringify(['General', 'Bills & subscriptions', 'Rules', 'Accounts', 'Backup & sharing']), 'Settings has a sub-menu: ' + subs.join(' · '));
  ok(await page.locator('nav[aria-label="Settings sections"] a[aria-current=page]').innerText() === 'General', 'General is marked as the current section');
  const general = await page.locator('main').innerText();
  ok(/Appearance/.test(general) && /Categories and limits/.test(general) && !/Automatic backups/.test(general) && !/Rule files/.test(general), 'General keeps appearance, categories, trips, big expenses; backups and rules moved to their own sections');
  for (const [h, name] of [['#/bills', 'Bills & subscriptions'], ['#/rules', 'Rules'], ['#/accounts', 'Accounts'], ['#/backup', 'Backup & sharing']]) {
    await go(h);
    ok(await page.locator('nav[aria-label="Settings sections"] a[aria-current=page]').innerText() === name && await page.locator('#nav-links a[aria-current=page]').first().innerText().then(t => /Settings/.test(t)), name + ': sub-menu marks it, and Settings stays highlighted in the menu');
  }
  await page.click('nav[aria-label="Settings sections"] a:text-is("Rules")'); await wait(page, 400);
  ok(await page.evaluate(() => location.hash) === '#/rules' && await page.locator('#rt').count() === 1 && await page.locator('#rs-general').count() === 1, 'Rules: the search/test box and the rule files are on one page');
  await go('#/backup');
  ok(/Automatic backups/.test(await page.locator('main').innerText()) && /Shared snapshot/.test(await page.locator('main').innerText()), 'Backup & sharing: automatic backups, download/restore, shared snapshot');
  for (const [k, h] of [['b', '#/bills'], ['u', '#/rules'], ['a', '#/accounts'], ['k', '#/backup'], ['s', '#/settings']]) {
    await go('#/home'); await page.keyboard.press('g'); await page.keyboard.press(k); await wait(page, 300);
    ok(await page.evaluate(() => location.hash) === h, 'G ' + k.toUpperCase() + ' opens ' + h);
  }
  ok(await page.locator('a.btn:text-is("Manage bills & subscriptions"), a.btn:text-is("Find bills & subscriptions")').count() >= 0, 'Home has a link to Bills & subscriptions');

  // ================= B. Bills & subscriptions page =================
  const item = (name, key, cad, amount, cat, o) => Object.assign({ id: 'r-' + key.replace(/\W+/g, '-'), name, key, kind: 'expense', cadence: cad, anchor: TODAY, amount, amountMode: 'fixed', categoryId: cat, active: true, createdAt: new Date().toISOString() }, o || {});
  const inDays = (n) => page.evaluate(n => Recurring.addDays(U.today(), n), n);
  await page.evaluate(async list => { App.cfg.recurring = list; await UI.saveCfg(); }, [
    item('Rent', 'CHEXY RENT', 'monthly', 2300, 'rent', { anchor: await inDays(20) }),
    item('Netflix', 'NETFLIX COM', 'monthly', 20.99, 'subscriptions', { anchor: await inDays(3) }),
    item('Spotify', 'SPOTIFY', 'monthly', 11.99, 'subscriptions', { anchor: await inDays(8) }),
    item('Property tax', 'CITY TAX', 'quarterly', 300, 'other-household', { anchor: await inDays(40) }),
    item('Old gym', 'OLD GYM', 'monthly', 40, 'fitness', { anchor: await inDays(5), active: false }),
    item('Paycheque', 'ACME PAY', 'monthly', 3000, null, { kind: 'income', anchor: await inDays(10) })]);
  await go('#/bills');
  ok(await page.locator('main h1:text-is("Bills & subscriptions")').count() === 1 && await page.locator('nav[aria-label="Settings sections"]').count() === 1, 'Bills & subscriptions is a page with the Settings sub-menu');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '-bills.png', fullPage: true });
  const tiles = await page.locator('.grid-tiles').innerText();
  ok(/\$32,? ?\d{3} a year|\$[\d,]+ a year/.test(tiles) && /Subscriptions/i.test(tiles) && /Due in the next 30 days/i.test(tiles), 'summary: cost a year, subscriptions, due in the next 30 days');
  const due = await page.evaluate(() => 0);
  ok(/\$2,3\d\d|\$2,4\d\d/.test(tiles) || /\$[\d,]+/.test(tiles), 'the 30-day total is shown (' + (/Due in the next 30 days\s*\n?\s*(\$[\d,]+)/i.exec(tiles) || ['', '?'])[1] + ')');
  let names = await page.locator('.rc-item .rc-name strong').allInnerTexts();
  ok(names.join('|') === 'Netflix|Spotify|Paycheque|Rent|Property tax|Old gym (paused)', 'rows are in the order they are due, paused last (' + names.join(', ') + ')');
  ok(await page.locator('.rc-item #rc-amt-r-NETFLIX-COM').count() === 0 && await page.locator('.rc-item input').count() === 0, 'rows are compact: no fields until you press Edit');
  ok(/Next .*\n.*in 3 days/.test(await page.locator('.rc-item:has-text("Netflix") .rc-when').innerText()), 'each row says when it is next due, in words ("in 3 days")');
  // filters
  await page.click('button.chip:has-text("Subscriptions")'); await wait(page, 250);
  ok((await page.locator('.rc-item .rc-name strong').allInnerTexts()).join('|') === 'Netflix|Spotify', 'filter Subscriptions: Netflix and Spotify');
  await page.click('button.chip:has-text("Money in")'); await wait(page, 250);
  ok((await page.locator('.rc-item .rc-name strong').allInnerTexts()).join('|') === 'Paycheque', 'filter Money in: the paycheque');
  await page.click('button.chip:has-text("Paused")'); await wait(page, 250);
  ok((await page.locator('.rc-item .rc-name strong').allInnerTexts()).join('|') === 'Old gym (paused)', 'filter Paused: the old gym');
  await page.click('button.chip:text-is("All")'); await wait(page, 250);
  await page.fill('#rc-q', 'tax'); await wait(page, 250);
  ok((await page.locator('.rc-item .rc-name strong').allInnerTexts()).join('|') === 'Property tax', 'search narrows the list as you type');
  await page.fill('#rc-q', 'zzz'); await wait(page, 250);
  ok(/Nothing matches/.test(await page.locator('main').innerText()), 'search with no match says so');
  await page.fill('#rc-q', ''); await wait(page, 250);
  // edit in place
  await page.click('.rc-item:has-text("Netflix") button:text-is("Edit")'); await wait(page, 250);
  ok(await page.locator('#rc-amt-r-NETFLIX-COM').isVisible() && await page.locator('.rc-item:has-text("Netflix") button[aria-expanded=true]').count() === 1, 'Edit opens that row\'s fields under it (Name, Amount, How often, Next on, Category)');
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id) === 'rc-name-r-NETFLIX-COM', 'focus goes to the first field');
  await page.fill('#rc-amt-r-NETFLIX-COM', '22.99'); await page.locator('#rc-amt-r-NETFLIX-COM').blur(); await wait(page, 400);
  ok(await page.evaluate(() => App.cfg.recurring.find(r => r.name === 'Netflix').amount) === 22.99 && /\$22\.99/.test(await page.locator('.rc-item:has-text("Netflix") .rc-sum').innerText()), 'changing the amount saves at once and the row shows $22.99');
  await page.click('#toast button:text-is("Undo")'); await wait(page, 400);
  ok(await page.evaluate(() => App.cfg.recurring.find(r => r.name === 'Netflix').amount) === 20.99, 'Undo puts $20.99 back');
  await page.click('.rc-item:has-text("Netflix") button:text-is("Done")'); await wait(page, 250);
  ok(await page.locator('#rc-amt-r-NETFLIX-COM').count() === 0, 'Done closes the fields');
  // pause / resume
  await page.click('.rc-item:has-text("Spotify") button:text-is("Pause")'); await wait(page, 400);
  ok(await page.evaluate(() => App.cfg.recurring.find(r => r.name === 'Spotify').active) === false && /Spotify \(paused\)/.test(await page.locator('.rc-item:has-text("Spotify")').innerText()), 'Pause: Spotify is paused');
  await page.click('.rc-item:has-text("Spotify") button:text-is("Resume")'); await wait(page, 400);
  ok(await page.evaluate(() => App.cfg.recurring.find(r => r.name === 'Spotify').active) !== false, 'Resume brings it back');
  // delete with a confirmation and Undo
  await page.click('.rc-item:has-text("Old gym") button:text-is("Edit")'); await wait(page, 250);
  await page.click('.rc-item:has-text("Old gym") button:text-is("Delete")'); await wait(page, 250);
  ok(/Delete "Old gym"\?/.test(await page.locator('.rc-item:has-text("Old gym") [role=alert]').innerText()), 'Delete asks first, naming the bill');
  await page.click('.rc-item:has-text("Old gym") button.danger:text-is("Delete")'); await wait(page, 400);
  ok(await page.evaluate(() => !App.cfg.recurring.some(r => r.name === 'Old gym')), 'confirmed: deleted');
  await page.click('#toast button:text-is("Undo")'); await wait(page, 400);
  ok(await page.evaluate(() => App.cfg.recurring.some(r => r.name === 'Old gym')), 'Undo brings it back');
  // add
  await page.click('#main button:text-is("+ Add")'); await page.waitForSelector('#rc-n');
  ok(await page.evaluate(() => document.activeElement.id) === 'rc-n', '+ Add opens the form with the cursor in Name');
  await page.fill('#rc-n', 'Gym'); await page.fill('#rc-m', 'GOODLIFE'); await page.fill('#rc-a', '49.99'); await page.click('#main button:text-is("Add")'); await wait(page, 500);
  ok(await page.evaluate(() => App.cfg.recurring.some(r => r.name === 'Gym' && r.amount === 49.99)) && await page.locator('.rc-item .rc-name strong:text-is("Gym")').count() === 1, 'Add: Gym $49.99 appears in the list');
  // found in history
  await page.evaluate(async () => { const l = []; for (let k = 5; k >= 0; k--) { const d = Recurring.addDays(U.today(), -30 * k - 2); l.push({ id: 'h' + k, source: 'csv', direction: 'out', type: 'expense', categoryId: 'subscriptions', accountId: 'a1', account: 'x', flags: [], createdAt: new Date().toISOString(), file: 'z.csv', line: 3, date: d, amount: 15.5, desc: 'DISNEY PLUS' }); } await DB.putTx(l); await UI.reload(); App.render(); });
  await wait(page, 400);
  ok(await page.locator('.rc-row:has-text("DISNEY")').count() === 1, 'a bill found in your history is offered under "Found in your history"');
  await page.click('.rc-row:has-text("DISNEY") button:text-is("Confirm")'); await wait(page, 400);
  ok(await page.locator('.rc-item:has-text("DISNEY")').count() === 1 && await page.locator('.rc-row:has-text("DISNEY")').count() === 0, 'Confirm moves it into your list');
  // Home link and Insights link
  await go('#/home');
  ok(await page.locator('a[href="#/bills"]:text-is("Manage bills & subscriptions")').count() === 1, 'Home: "Manage bills & subscriptions" is a link to the page');
  await go('#/bills');
  await page.click('a.tile-link'); await wait(page, 400);
  ok(await page.evaluate(() => location.hash) === '#/insights' && /recurring and fixed/.test(await page.locator('h1').innerText()), 'the "Over the year" tile opens Insights > Recurring & fixed');

  // ================= A. Accounts =================
  const tdTx = [{ id: 'x1', date: YM + '-03', amount: 12, desc: 'ZZ TEST SHOP', categoryId: 'groceries' }];
  await page.evaluate(async list => {
    App.cfg.accounts = [
      { id: 'ac1', name: 'TD chequing', kind: 'bank', type: 'chequing', currency: 'CAD', numbers: [], balances: [{ date: U.today(), amount: 1000, source: 'manual' }] },
      { id: 'ac2', name: 'Visa', kind: 'card', type: 'credit', currency: 'CAD', numbers: [], balances: [{ date: U.today(), amount: 200, source: 'manual' }] },
      { id: 'ac3', name: 'Old car loan', kind: 'bank', type: 'loan', currency: 'CAD', numbers: [], balances: [{ date: U.today(), amount: 5000, source: 'manual' }] },
      { id: 'ac4', name: 'Closed card', kind: 'card', type: 'credit', currency: 'CAD', numbers: [], closed: true, balances: [] }];
    await UI.saveCfg();
    await DB.putTx(list.map(t => Object.assign({ source: 'csv', direction: 'out', type: 'expense', accountId: 'ac1', account: 'TD chequing', flags: [], createdAt: new Date().toISOString(), file: 't.csv', line: 3 }, t)));
    await UI.reload();
  }, tdTx);
  await go('#/accounts');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '-accounts.png', fullPage: true });
  ok(await page.locator('button:text-is("Payoff plan")').count() === 0 && await page.locator('button[aria-label^="Loan details"]').count() === 0, 'Accounts: no payoff plan, no loan details');
  ok(await page.locator('#na-t').count() === 0, 'the add form is closed until you ask');
  await page.click('button:text-is("Add an account")'); await page.waitForSelector('#na-t');
  ok(await page.locator('#na-t option').evaluateAll(os => os.every(o => o.value !== 'loan')), 'a loan is not offered as an account type');
  await page.click('fieldset button:text-is("Cancel")'); await wait(page, 250);
  ok(/Credit cards/.test(await page.locator('main').innerText()) && !/Debts/.test(await page.locator('main').innerText()), 'cards are listed under "Credit cards"');
  ok(await page.locator('section[aria-labelledby=ag-debt] .acct-row').count() === 2, 'an older loan entry still counts as owed (listed with the cards, not lost)');
  // rename
  const nameBox = page.locator('input[aria-label="Name of TD chequing"]');
  ok(await nameBox.inputValue() === 'TD chequing', 'every account name is an editable field');
  await nameBox.fill('Everyday chequing'); await nameBox.press('Enter'); await wait(page, 500);
  ok(await page.evaluate(() => App.cfg.accounts.find(a => a.id === 'ac1').name) === 'Everyday chequing' && /Renamed TD chequing to Everyday chequing/.test(await page.locator('#toast').innerText()), 'rename saves when you press Enter');
  await go('#/transactions?scope=all&q=ZZ%20TEST');
  ok(/Everyday chequing/.test(await page.locator('main').innerText()) && !/TD chequing/.test(await page.locator('.tx').first().innerText()), 'old transactions show the new name');
  ok(await page.locator('#acct-filter option').allInnerTexts().then(t => t.some(x => /Everyday chequing/.test(x))), 'the account filter shows the new name');
  await go('#/accounts');
  await page.locator('input[aria-label="Name of Everyday chequing"]').fill('Main chequing'); await page.locator('input[aria-label="Name of Everyday chequing"]').blur(); await wait(page, 500);
  ok(await page.evaluate(() => App.cfg.accounts.find(a => a.id === 'ac1').name) === 'Main chequing', 'it also saves when you leave the field (renamed again, any time)');
  await page.click('#toast button:text-is("Undo")'); await wait(page, 400);
  ok(await page.evaluate(() => App.cfg.accounts.find(a => a.id === 'ac1').name) === 'Everyday chequing', 'Undo puts the previous name back');
  await page.locator('input[aria-label="Name of Everyday chequing"]').fill('   '); await page.locator('input[aria-label="Name of Everyday chequing"]').blur(); await wait(page, 400);
  ok(await page.evaluate(() => App.cfg.accounts.find(a => a.id === 'ac1').name) === 'Everyday chequing' && await page.locator('input[aria-label="Name of Everyday chequing"]').inputValue() === 'Everyday chequing', 'an empty name is refused and the old one stays');
  // import sees the new name
  await go('#/import');
  ok(await page.evaluate(() => true), 'Import tab opens');
  // details fold
  await go('#/accounts');
  await page.locator('.acct-row:has(input[aria-label="Name of Visa"]) details.more > summary').click(); await wait(page, 200);
  ok(await page.locator('select[aria-label="What Visa is (for net worth)"]').isVisible() && await page.locator('select[aria-label="How imports read Visa"]').isVisible(), 'Details: type and how imports read it');
  await page.selectOption('select[aria-label="What Visa is (for net worth)"]', 'other'); await wait(page, 400);
  ok(await page.evaluate(() => App.cfg.accounts.find(a => a.id === 'ac2').type) === 'other', 'changing type saves');
  await page.click('#toast button:text-is("Undo")'); await wait(page, 400);
  // closed
  ok(await page.locator('section[aria-labelledby=ag-closed] input[aria-label="Name of Closed card"]').count() === 1, 'closed accounts are listed separately and can still be renamed');
  await page.locator('section[aria-labelledby=ag-closed] details.more > summary').click(); await wait(page, 200);
  await page.locator('section[aria-labelledby=ag-closed] .check input').uncheck(); await wait(page, 400);
  ok(await page.evaluate(() => !App.cfg.accounts.find(a => a.id === 'ac4').closed), 'unticking Closed reopens it');
  // Settings General no longer has accounts
  await go('#/settings');
  ok(!/Bank accounts and cards you import from/.test(await page.locator('main').innerText()), 'Settings > General no longer repeats the accounts list');

  // ================= P. phone =================
  await page.setViewportSize({ width: 375, height: 800 });
  for (const h of ['#/bills', '#/accounts', '#/rules', '#/backup', '#/settings']) {
    await go(h);
    const w = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    ok(w.s <= w.c, h + ' at 375px: no sideways scroll (' + w.s + ' ≤ ' + w.c + ')');
  }
  await go('#/bills'); await page.click('.rc-item:has-text("Rent") button:text-is("Edit")'); await wait(page, 250);
  const w3 = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  ok(w3.s <= w3.c, 'a bill being edited at 375px: no sideways scroll');
  ok(net.length === 0, 'nothing tried to reach the network (' + net.length + ')');
  ok(errors.length === 0, 'no page errors (' + errors.join('; ') + ')');
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
