/* Version 19 in the browser: simpler Import tab (recent imports checkbox, close-or-keep prompt after an import),
   account drop-down on Transactions (only accounts that have transactions), simpler Add expense window.
   Run from the work (or our-budget) folder: node tests/v19.test.js (needs Playwright) */
require('./_clock'); const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const APP = 'file://' + path.resolve(__dirname, '../index.html');
const PKG = path.resolve(__dirname, '..');
const pick = (...c) => c.find(f => fs.existsSync(f));
const SEED = pick(PKG + '/private/budget-seed.json', process.env.BUDGET_SEED || '');
const GEN = pick(PKG + '/rules/rules-general.csv', process.env.BUDGET_RULES || '');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'v19-'));
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
  const files = () => page.evaluate(() => Importer._files().map(f => ({ n: f.name, done: !!f.done })));
  const txCount = () => page.evaluate(() => App.txs.length);

  // ================= I. Import tab =================
  const f1 = path.join(TMP, 'td-oct-7788.csv'), f2 = path.join(TMP, 'td-nov-7788.csv'), f3 = path.join(TMP, 'td-dec-7788.csv'), f4 = path.join(TMP, 'td-jan-7788.csv');
  fs.writeFileSync(f1, ['10/01/2026,SAFEWAY #4545,45.10', '10/03/2026,NETFLIX.COM,20.99', '10/10/2026,SAVE ON FOODS,61.25'].join('\n'));
  fs.writeFileSync(f2, ['11/02/2026,SAFEWAY #4545,31.10', '11/03/2026,JJ BEAN COFFEE,5.25'].join('\n'));
  fs.writeFileSync(f3, ['12/02/2026,SAFEWAY #4545,28.10', '12/03/2026,JJ BEAN COFFEE,4.75'].join('\n'));
  fs.writeFileSync(f4, ['01/04/2027,SAFEWAY #4545,33.30', '01/05/2027,JJ BEAN COFFEE,6.25'].join('\n'));
  await page.evaluate(() => { location.hash = '#/import'; }); await page.waitForSelector('#csvf');
  let txt = await page.locator('main').innerText();
  ok(/No file chosen yet/.test(txt) && await page.locator('#show-recent').count() === 0, 'empty Import tab: one file chooser and a hint; no "recent imports" box before anything was imported');
  await page.setInputFiles('#csvf', f1); await wait(page, 500);
  if (await page.locator('section .toast.warn button.primary').count()) await page.locator('section .toast.warn button.primary').first().click();
  else { await page.selectOption('#acct', '__new'); await page.fill('#an', 'TD chequing'); await page.selectOption('#ak', 'bank'); await page.click('button:text-is("Add account")'); }
  await wait(page, 400);
  txt = await page.locator('main').innerText();
  ok(/1\. Choose one or more (CSV )?files/.test(txt) && /2\. Which account is this file from\?/.test(txt) && /3\. Check the rows/.test(txt), 'the tab reads as steps: 1 choose files, 2 account, 3 check the rows');
  ok(/Read 3 transactions: 3 ready · 0 flagged for review|Read 3 transactions: \d+ ready · \d+ flagged for review/.test(txt), 'one summary line says what was read (3 transactions, how many ready / flagged)');
  ok(await page.locator('details.more:has-text("How this file was read")').count() === 1, 'details of how the file was read (bank, format, columns) are folded into one section');
  ok(await page.locator('#show-recent').count() === 0, 'still no recent-imports box: nothing has been imported yet');
  const before = await txCount();
  await page.getByRole('button', { name: /^Import all \(\d+\)$/ }).click(); await wait(page, 700);
  ok(await txCount() === before + 3, 'Import all adds the 3 lines');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '-import-after.png', fullPage: true });
  const prompt = page.locator('.prompt');
  ok(await prompt.count() === 1 && /Imported 3 rows/.test(await prompt.innerText()) && /Close this file, or keep it open\?/.test(await prompt.innerText()), 'after the import a prompt asks: close this file, or keep it open?');
  ok(await prompt.locator('button:text-is("Close this file")').count() === 1 && await prompt.locator('button:text-is("Keep it open")').count() === 1 && await prompt.locator('button:text-is("Undo this import")').count() === 1, 'the prompt offers Close this file, Keep it open and Undo this import');
  await prompt.locator('button:text-is("Keep it open")').click(); await wait(page, 300);
  ok(await page.locator('.prompt').count() === 0 && (await files()).length === 1 && /Imported 3 rows from this file/.test(await page.locator('main').innerText()), 'Keep it open: the prompt goes away, the file stays on screen with a short "Imported 3 rows" note');
  ok(await page.locator('#show-recent').count() === 1 && !(await page.isChecked('#show-recent')), 'now there is a "Show recent imports" box, and it starts unticked');
  ok(await page.locator('section[aria-label="Recent imports"]').count() === 0, 'recent imports are hidden while the box is unticked');
  await page.check('#show-recent'); await wait(page, 300);
  ok(await page.locator('section[aria-label="Recent imports"]').count() === 1 && /td-oct-7788\.csv/.test(await page.locator('section[aria-label="Recent imports"]').innerText()), 'ticking it lists the recent imports (td-oct-7788.csv)');
  await page.evaluate(() => { location.hash = '#/home'; }); await wait(page, 200); await page.evaluate(() => { location.hash = '#/import'; }); await wait(page, 400);
  ok(await page.isChecked('#show-recent') && await page.locator('section[aria-label="Recent imports"]').count() === 1, 'the choice is remembered when you come back');
  await page.uncheck('#show-recent'); await wait(page, 300);
  ok(await page.locator('section[aria-label="Recent imports"]').count() === 0, 'unticking hides them again');
  // close path
  await page.setInputFiles('#csvf', f2); await wait(page, 600);
  await page.locator('[role=tablist][aria-label=Files] button:has-text("td-nov")').click().catch(() => {}); await wait(page, 300);
  await page.getByRole('button', { name: /^Import all \(\d+\)$/ }).click(); await wait(page, 700);
  ok(await page.locator('.prompt').count() === 1, 'a second import shows the prompt again');
  const n2 = (await files()).length;
  await page.locator('.prompt button:text-is("Close this file")').click(); await wait(page, 300);
  ok((await files()).length === n2 - 1 && !(await files()).some(f => /td-nov/.test(f.n)), 'Close this file removes that file from the screen');
  // undo from the prompt
  await page.setInputFiles('#csvf', f3); await wait(page, 600);
  await page.locator('[role=tablist][aria-label=Files] button:has-text("td-dec")').click().catch(() => {}); await wait(page, 300);
  const b3 = await txCount();
  await page.getByRole('button', { name: /^Import all \(\d+\)$/ }).click(); await wait(page, 700);
  ok(await txCount() === b3 + 2, 'third file imported (2 lines)');
  await page.locator('.prompt button:text-is("Undo this import")').click(); await wait(page, 800);
  ok(await txCount() === b3 && await page.locator('.prompt').count() === 0, 'Undo this import in the prompt takes the lines back out');
  // two files at once
  await page.evaluate(() => { const fs = Importer._files(); fs.splice(0, fs.length); App.render(); }); await wait(page, 300);
  await page.setInputFiles('#csvf', [f3, f4]); await wait(page, 800);
  const b4 = await txCount();
  await page.click('button:has-text("Import all files")'); await wait(page, 1200);
  ok(await txCount() === b4 + 4, 'Import all files imports both (4 lines)');
  const ap = page.locator('section.prompt[aria-label="Import finished"]');
  ok(await ap.count() === 1 && /Imported 4 rows from 2 files/.test(await ap.innerText()), 'a prompt says "Imported 4 rows from 2 files"');
  await ap.locator('button:text-is("Keep them open")').click(); await wait(page, 300);
  ok(await page.locator('section.prompt').count() === 0 && (await files()).length === 2, 'Keep them open: prompt gone, both files still there');
  await page.evaluate(() => { location.hash = '#/home'; }); await wait(page, 200);

  // ================= T. Transactions account drop-down =================
  await page.evaluate(() => { location.hash = '#/transactions?scope=all'; }); await wait(page, 500);
  ok(await page.locator('.acct-tab').count() === 0 && await page.locator('select#acct-filter').count() === 1, 'Transactions: the account tabs are gone, there is an Account drop-down');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '-transactions.png' });
  const opts = await page.locator('#acct-filter option').evaluateAll(os => os.map(o => ({ v: o.value, t: o.textContent })));
  await page.evaluate(async () => { App.cfg.accounts.push({ id: 'ax-empty', name: 'Empty card', kind: 'card', numbers: [], bank: 'Other bank' }); await UI.saveCfg(); App.render(); }); await wait(page, 300);
  const info = await page.evaluate(() => ({ all: App.cfg.accounts.map(a => a.id), used: App.cfg.accounts.filter(a => App.txs.some(t => t.accountId === a.id)).map(a => a.id) }));
  ok(info.used.length >= 1 && info.all.length > info.used.length, 'the data has accounts with no transactions (' + info.all.length + ' accounts, ' + info.used.length + ' with transactions)');
  const listed = opts.map(o => o.v).filter(v => v !== 'all');
  ok(listed.every(v => info.used.includes(v) || v.charAt(0) === '_') && info.used.every(v => listed.includes(v)), 'the drop-down lists exactly the accounts that have transactions (' + listed.length + ')');
  ok(opts[0].v === 'all' && /^All accounts \(\d+/.test(opts[0].t), 'the first choice is "All accounts" with the count');
  const empty = info.all.find(id => !info.used.includes(id));
  ok(!listed.includes(empty), 'an account with no transactions is not listed');
  const pick1 = info.used[0];
  await page.selectOption('#acct-filter', pick1); await wait(page, 400);
  const shown = await page.evaluate(id => App.txs.filter(t => (t.source === 'excel' ? '_excel' : (t.accountId || '_manual')) === id).length, pick1);
  ok(new RegExp('\\b' + shown + ' of ' + shown + ' transactions').test(await page.locator('main').innerText()), 'choosing an account shows only its lines (' + shown + ')');
  await page.evaluate(id => { location.hash = '#/transactions?scope=all&acct=' + id; }, info.used[info.used.length - 1]); await wait(page, 400);
  ok(await page.inputValue('#acct-filter') === info.used[info.used.length - 1], 'a link with ?acct= opens with that account chosen');
  await page.evaluate(() => { location.hash = '#/insights'; }); await wait(page, 400);
  const iopts = await page.locator('#ins-acct option').evaluateAll(os => os.map(o => o.value));
  ok(!iopts.includes(empty), 'Insights\' account list also leaves out accounts with no transactions');

  // ================= A. Add expense =================
  const seed = (list) => page.evaluate(async list => { await DB.putTx(list.map(t => Object.assign({ source: 'csv', direction: 'out', type: 'expense', categoryId: 'groceries', accountId: 'a1', account: 'TD chequing', flags: [], createdAt: new Date().toISOString(), file: 'z.csv', line: 3 }, t))); await UI.reload(); }, list);
  const TODAY = await page.evaluate(() => U.today()), YM = TODAY.slice(0, 7);
  const day = (d) => YM + '-' + String(d).padStart(2, '0');
  await seed([{ id: 'zb1', date: day(1), amount: 6, desc: 'ZZ BAKERY #123' }, { id: 'zb2', date: day(2), amount: 7, desc: 'ZZ BAKERY #123' }, { id: 'zb3', date: day(3), amount: 8, desc: 'ZZ BAKERY #123' },
    { id: 'zc', date: day(4), amount: 4, desc: 'ZZ CAFE', categoryId: 'dine-out', createdAt: new Date(Date.now() + 60000).toISOString() }, { id: 'zn', date: day(5), amount: 9, desc: 'ZZ NOTED', categoryId: 'groceries', note: 'for the party' }]);
  await page.evaluate(() => { location.hash = '#/home'; }); await wait(page, 300);
  await page.evaluate(() => UI.expensePanel(null, App.render)); await page.waitForSelector('#amt');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '-add.png' });
  const ys = await page.evaluate(() => ['amt', 'desc', 'allcat', 'dt'].map(id => document.getElementById(id).getBoundingClientRect().top));
  ok(ys.every((y, i) => !i || y > ys[i - 1]), 'Add expense reads top to bottom: Amount, Where, Category, Date');
  ok(await page.locator('#note').isVisible() === false && await page.locator('#trip').isVisible() === false && await page.locator('#grp').isVisible() === false, 'note, trip and "paid for others" are folded under More options');
  ok(/More options/.test(await page.locator('details.more > summary').innerText()), 'the fold says what is inside it ("More options · note, trip, big expense, paid for others")');
  await page.click('details.more > summary'); await wait(page, 150);
  ok(await page.locator('#note').isVisible() && await page.locator('#grp').isVisible(), 'More options opens to the note, trip and group-bill box');
  await page.click('details.more > summary');
  ok(await page.locator('.panel .chip[data-cat]').count() <= 5, 'at most 5 quick-pick categories');
  ok(await page.inputValue('#allcat') === 'dine-out', 'the category starts as the one you used last (Dine out)');
  // yesterday / today
  const yd = await page.evaluate(() => Recurring.addDays(U.today(), -1));
  await page.click('button.chip:text-is("Yesterday")'); await wait(page, 150);
  ok(await page.inputValue('#dt') === yd && await page.locator('button.chip:text-is("Yesterday")').getAttribute('aria-pressed') === 'true', 'Yesterday sets the date');
  await page.click('button.chip:text-is("Today")'); await wait(page, 150);
  ok(await page.inputValue('#dt') === TODAY, 'Today sets it back');
  // category follows the shop
  await page.fill('#amt', '12.40'); await page.fill('#desc', 'ZZ BAKERY #129');
  await page.click('button:text-is("Save expense")'); await wait(page, 500);
  const saved = await page.evaluate(() => App.txs.filter(t => /ZZ BAKERY #129/.test(t.desc)).map(t => ({ c: t.categoryId, a: t.amount })));
  ok(saved.length === 1 && saved[0].c === 'groceries' && saved[0].a === 12.4, 'typing a shop you have used before fills in its usual category, and a click straight on Save still saves (Groceries, $12.40)');
  ok(/Saved \$12\.40 to Groceries/.test(await page.locator('.panel').innerText()), 'the panel confirms and stays open for the next one');
  // the hint is shown, and a category you picked yourself is left alone
  await page.fill('#amt', '5'); await page.selectOption('#allcat', 'clothing'); await page.fill('#desc', 'ZZ BAKERY #123'); await page.press('#desc', 'Tab'); await wait(page, 200);
  ok(await page.inputValue('#allcat') === 'clothing', 'a category you chose yourself is not overridden');
  await page.keyboard.press('Escape'); await wait(page, 300);
  await page.evaluate(() => UI.expensePanel(null, App.render)); await page.waitForSelector('#amt');
  await page.fill('#desc', 'ZZ BAKERY #123'); await page.press('#desc', 'Tab'); await wait(page, 200);
  ok(/Usual choice here: Groceries \((\d+) of \1 times at zz bakery\)/.test(await page.locator("#cat-why").innerText()) && await page.inputValue('#allcat') === 'groceries', 'the reason is shown under Category ("3 of 3 times at zz bakery")');
  await page.keyboard.press('Escape'); await wait(page, 300);
  // editing a line that uses the extras opens them
  await page.evaluate(() => UI.expensePanel(App.txs.find(t => t.id === 'zn'), App.render)); await page.waitForSelector('#amt');
  ok(await page.locator('#note').isVisible() && await page.inputValue('#note') === 'for the party', 'editing a line with a note opens More options');
  await page.keyboard.press('Escape'); await wait(page, 300);
  await page.evaluate(() => UI.expensePanel(App.txs.find(t => t.id === 'zb1'), App.render)); await page.waitForSelector('#amt');
  ok(await page.locator('#note').isVisible() === false && await page.locator('#grp').isVisible() === false, 'editing a plain line keeps them folded');
  ok(await page.inputValue('#allcat') === 'groceries', 'editing never changes the category by itself');
  await page.keyboard.press('Escape'); await wait(page, 300);

  // ================= P. phone width =================
  await page.setViewportSize({ width: 375, height: 800 });
  for (const h of ['#/import', '#/transactions?scope=all']) {
    await page.evaluate(h => { location.hash = h; }, h); await wait(page, 400);
    const w = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    ok(w.s <= w.c, h + ' at 375px: no sideways scroll (' + w.s + ' ≤ ' + w.c + ')');
  }
  await page.evaluate(() => UI.expensePanel(null, App.render)); await page.waitForSelector('#amt'); await page.click('details.more > summary'); await wait(page, 200);
  const pw = await page.evaluate(() => { const p = document.querySelector('.panel'); return { s: p.scrollWidth, c: p.clientWidth }; });
  ok(pw.s <= pw.c + 1, 'Add expense at 375px with More options open: no sideways scroll (' + pw.s + ' ≤ ' + pw.c + ')');
  await page.keyboard.press('Escape');
  ok(net.length === 0, 'nothing tried to reach the network (' + net.length + ')');
  ok(errors.length === 0, 'no page errors (' + errors.join('; ') + ')');
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
