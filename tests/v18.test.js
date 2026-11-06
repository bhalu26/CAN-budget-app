/* Version 18 in the browser: what recurring bills cost over a year, fixed-every-month strip, top merchants and biggest expenses,
   "bills still due" and "safe to spend" on Home. Starts from the empty seed, so every number below is known.
   Run from the work (or our-budget) folder: node tests/v18.test.js (needs Playwright) */
require('./_clock'); const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const APP = 'file://' + path.resolve(__dirname, '../index.html');
const PKG = path.resolve(__dirname, '..');
const pick = (...c) => c.find(f => fs.existsSync(f));
const SEED = pick(PKG + '/private/budget-seed.json', process.env.BUDGET_SEED || '');
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
  const TODAY = await page.evaluate(() => U.today()), YEAR = TODAY.slice(0, 4), YM = TODAY.slice(0, 7);
  const MON = +TODAY.slice(5, 7), DAYN = +TODAY.slice(8, 10);
  if (MON < 4) { console.log('SKIP: this test needs a date after March (rent history needs months to look back on)'); await browser.close(); process.exit(0); }
  const pad = n => String(n).padStart(2, '0');

  // ---------- data ----------
  // monthly lines Jan.. this month, only those already past; "skip" months are left out on purpose
  const lines = [];
  let n = 0;
  const addMonthly = (desc, day, amountFor, cat, skip) => { for (let m = 1; m <= MON; m++) { const d = YEAR + '-' + pad(m) + '-' + pad(day); if (d > TODAY || (skip || []).includes(m)) continue; lines.push({ id: 'z' + (n++), date: d, amount: amountFor(m), desc, categoryId: cat }); } };
  addMonthly('CHEXY RENT', 1, m => (m < 7 ? 2200 : 2300), 'rent');
  addMonthly('FIDO MOBILE', 5, () => 85, 'phone', [MON > 4 ? MON - 1 : 99]);       // one month missing (last month)
  addMonthly('NETFLIX COM', 10, () => 20.99, 'subscriptions');
  addMonthly('SPOTIFY', 12, () => 11.99, 'subscriptions');
  addMonthly('ICLOUD STORAGE', 14, () => 40, 'subscriptions');
  addMonthly('BC HYDRO', 20, m => 55 + m * 3, 'utilities', [MON]);                 // varies; this month's bill not here yet
  addMonthly('SAFE INSURANCE', 27, () => 120, 'other-household', [MON]);            // due on the 27th, not paid yet
  // not in the recurring list: should be offered under "Looks fixed"
  addMonthly('GYM CLUB 0042', 8, () => 49.99, 'fitness');
  [1, 4, 7, 10].forEach(m => { const d = YEAR + '-' + pad(m) + '-15'; if (d <= TODAY) lines.push({ id: 'z' + (n++), date: d, amount: 300, desc: 'CITY PROPERTY TAX', categoryId: 'other-household' }); });
  // one big merchant with several visits, one big single purchase, one refund
  [3, 5, 8].forEach(m => lines.push({ id: 'z' + (n++), date: YEAR + '-' + pad(m) + '-02', amount: 900, desc: 'ZZ MEGA STORE #12', categoryId: 'groceries' }));
  lines.push({ id: 'zbig', date: YEAR + '-02-02', amount: 2400, desc: 'ZZ LAPTOP SHOP', categoryId: 'big-purchases' });
  lines.push({ id: 'zref', date: YEAR + '-09-03', amount: -150, desc: 'ZZ MEGA STORE #77', categoryId: 'groceries', direction: 'in', type: 'expense' });
  await page.evaluate(async list => {
    await DB.putTx(list.map(t => Object.assign({ source: 'csv', direction: 'out', type: 'expense', accountId: 'a1', account: 'TD chequing', flags: [], createdAt: new Date().toISOString(), file: 't.csv', line: 3 }, t)));
    await UI.reload();
  }, lines);
  const iso = new Date().toISOString();
  const item = (name, key, cadence, amount, cat, o) => Object.assign({ id: 'r-' + key.replace(/\W+/g, '-'), name, key, kind: 'expense', cadence, anchor: YEAR + '-01-01', amount, amountMode: 'fixed', categoryId: cat, active: true, createdAt: YEAR + '-01-01T00:00:00Z' }, o || {});
  await page.evaluate(async list => { App.cfg.recurring = list; await UI.saveCfg(); App.render(); }, [
    item('Rent', 'CHEXY RENT', 'monthly', 2300, 'rent', { anchor: YEAR + '-01-01' }),
    item('Phone', 'FIDO MOBILE', 'monthly', 85, 'phone', { anchor: YEAR + '-01-05' }),
    item('Netflix', 'NETFLIX COM', 'monthly', 20.99, 'subscriptions', { anchor: YEAR + '-01-10' }),
    item('Spotify', 'SPOTIFY', 'monthly', 11.99, 'subscriptions', { anchor: YEAR + '-01-12' }),
    item('iCloud', 'ICLOUD STORAGE', 'monthly', 40, 'subscriptions', { anchor: YEAR + '-01-14' }),
    item('Hydro', 'BC HYDRO', 'monthly', 70, 'utilities', { amountMode: 'varies', anchor: YEAR + '-01-20' }),
    item('Insurance', 'SAFE INSURANCE', 'monthly', 120, 'other-household', { anchor: YEAR + '-01-27' }),
    item('Property tax', 'CITY PROPERTY TAX', 'quarterly', 300, 'other-household', { anchor: YEAR + '-01-15' })]);

  const open = async (view) => { await page.evaluate(() => { location.hash = '#/insights'; }); await wait(page, 400); await page.click('[role=group][aria-label=View] button:text-is("' + view + '")'); await wait(page, 400); };
  const rowOf = (name) => page.locator('tr:has(th[scope=row] button:text-is("' + name + '"))').first();

  // ================= R. recurring & fixed =================
  await open('Recurring & fixed');
  ok(/recurring and fixed costs/.test(await page.locator('h1').innerText()), 'Insights has a "Recurring & fixed" view with its own title');
  const tiles = await page.locator('.grid-tiles').first().innerText();
  const yearly = 2300 * 12 + 85 * 12 + 20.99 * 12 + 11.99 * 12 + 480 + 70 * 12 + 120 * 12 + 1200;
  ok(tiles.replace(/,/g, '').includes(String(Math.round(yearly)) + ' a year'), 'tile: what recurring bills cost in a year (' + Math.round(yearly) + ')');
  ok(/about \$[\d,]+ a month · 8 bills/.test(tiles), 'tile: the monthly equivalent and the number of bills (8)');
  ok(/Fixed every month/i.test(tiles) && /% of your average monthly income/.test(tiles) === false, 'no income recorded: the fixed tile does not invent a % of income');
  for (const h2 of ['Fixed every month', 'Changes every month', 'Quarterly and yearly']) ok(await page.locator('h2:text-is("' + h2 + '")').count() === 1, 'section "' + h2 + '"');
  ok(await rowOf('Hydro').count() === 1 && await page.locator('section:has(h2:text-is("Changes every month")) tr:has(th button:text-is("Hydro"))').count() === 1, 'Hydro (amount moves) is under "Changes every month"');
  ok(await page.locator('section:has(h2:text-is("Quarterly and yearly")) tr:has(th button:text-is("Property tax"))').count() === 1, 'Property tax is under "Quarterly and yearly"');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '-recurring.png', fullPage: true });
  const rent = rowOf('Rent');
  ok(await rent.locator('td.sc-td').count() === 12, 'a fixed bill has twelve month cells, January to December');
  ok(await rent.locator('.sc-changed').count() === 6 && await rent.locator('.sc-paid').count() === MON - 6, 'Rent: Jan–Jun were paid at a different amount (≠), the rest match (✓)');
  ok(await rent.locator('.sc-future').count() === 12 - MON, 'Rent: months still to come are marked as coming up');
  ok(/↑ \$2,200\.00 → \$2,300\.00/.test(await rent.innerText()) && /\+\$1,200 a year/.test(await rent.innerText()), 'Rent shows the price rise: $2,200 → $2,300, +$1,200 a year');
  ok(/Price rises/i.test(tiles) && /\+\$1,200 a year/.test(tiles), 'tile: price rises total +$1,200 a year');
  ok(await rent.locator('.sc[aria-hidden=true]').count() >= 1 && (await rent.locator('.sr-only').allInnerTexts()).some(t => /January: paid a different amount, \$2,200\.00/.test(t)), 'each cell has the state in words for screen readers, with the amount');
  const phone = rowOf('Phone'), missingM = MON - 1;
  ok(await phone.locator('.sc-late').count() === 1 && (await phone.locator('td.sc-td').nth(missingM - 1).innerText()).includes('not seen yet'), 'Phone: the month with no payment shows ✗ "not seen yet"');
  // a cell is a link to that month's payment
  const href = await rent.locator('td.sc-td a.sc-link').first().getAttribute('href');
  ok(/#\/transactions\?f=spend&scope=month&m=\d{4}-01&q=CHEXY%20RENT/.test(href), 'a month cell links to that payment in Transactions');
  await rent.locator('td.sc-td a.sc-link').first().click(); await wait(page, 500);
  ok(/CHEXY RENT/.test(await page.locator('main').innerText()) && !/FIDO/.test(await page.locator('main').innerText()), 'the link shows only that bill\'s payment');
  const box = await (async () => { await open('Recurring & fixed'); return rent.locator('td.sc-td a.sc-link').first().boundingBox(); })();
  ok(box && box.width >= 24 && box.height >= 24, 'month cells are at least 24 × 24 px to click');
  // by category and limits
  ok(await page.locator('h2:text-is("By category")').count() === 1, 'costs by category are listed');
  const lim = page.locator('section:has(h2:text-is("Limits lower than your fixed bills"))');
  ok(await lim.count() === 1 && /Subscriptions/.test(await lim.innerText()) && /\$72\.98/.test(await lim.innerText()), 'Subscriptions fixed bills ($72.98) are higher than its $60 limit: flagged');
  ok(/\$12\.98 short/.test(await lim.innerText()), '…by how much ($12.98 short)') || 0;
  await lim.locator('button:has-text("Raise limit to $73")').click(); await wait(page, 500);
  ok(await page.evaluate(() => App.cfg.categories.find(c => c.id === 'subscriptions').limit) === 73, 'Raise limit to $73 changes the limit');
  ok(await page.locator('section:has(h2:text-is("Limits lower than your fixed bills"))').count() === 0, '…and the warning goes away');
  await page.click('#toast button:text-is("Undo")'); await wait(page, 500);
  ok(await page.evaluate(() => App.cfg.categories.find(c => c.id === 'subscriptions').limit) === 60, 'Undo puts the old limit back');
  // looks fixed
  const lf = page.locator('section:has(h2:has-text("Looks fixed, not in your list yet"))');
  ok(await lf.count() === 1 && /GYM CLUB/i.test(await lf.innerText()), 'the monthly gym charge (same amount, every month) is offered as "Looks fixed"');
  await lf.locator('button[aria-label^="Add "]').first().click(); await wait(page, 500);
  ok(await page.evaluate(() => App.cfg.recurring.length) === 9 && await page.locator('tr:has(th button:has-text("GYM"))').count() === 1, 'Add puts it in the recurring list and the Fixed table');
  await page.click('#toast button:text-is("Undo")'); await wait(page, 500);
  ok(await page.evaluate(() => App.cfg.recurring.length) === 8 && await page.locator('section:has(h2:has-text("Looks fixed"))').count() === 1, 'Undo takes it out again');
  await page.locator('section:has(h2:has-text("Looks fixed")) button:text-is("Not recurring")').first().click(); await wait(page, 500);
  ok(await page.locator('section:has(h2:has-text("Looks fixed"))').count() === 0 && (await page.evaluate(() => App.cfg.recurringIgnore.length)) >= 1, '"Not recurring" removes it and it is not suggested again');
  await page.click('#toast button:text-is("Undo")'); await wait(page, 500);
  // previous year: nothing recorded
  await page.click('button[aria-label="Previous year"]'); await wait(page, 400);
  ok(await page.locator('h1').count() >= 1 && errors.length === 0, 'last year\'s view opens without errors (' + errors.join('; ') + ')');
  await page.click('button[aria-label="Next year"]'); await wait(page, 300);

  // ================= T. top spending =================
  await open('Top spending');
  ok(/top merchants and biggest expenses/.test(await page.locator('h1').innerText()), 'Insights has a "Top spending" view');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '-top.png', fullPage: true });
  const ttl = await page.locator('.grid-tiles').first().innerText();
  ok(/Biggest merchant/i.test(ttl) && /CHEXY RENT/i.test(ttl), 'Biggest merchant: Rent (' + /\$[\d,]+/.exec(ttl) + ')');
  const mega = page.locator('section:has(h2:text-is("Top merchants")) tbody tr:has(a:has-text("ZZ MEGA STORE"))');
  ok(await mega.count() === 1, 'store numbers are ignored: "ZZ MEGA STORE #12" and "#77" are one merchant');
  const mt = await mega.innerText();
  ok(/\$2,550\.00/.test(mt) && /\b4\b/.test(mt), 'its total is net of the refund ($2,700 − $150 = $2,550) and counts 4 lines');
  const big = page.locator('section:has(h2:text-is("Biggest single expenses")) tbody tr').first();
  ok(/ZZ LAPTOP SHOP/.test(await big.innerText()) && /\$2,400\.00/.test(await big.innerText()), 'Biggest single expense: the $2,400 laptop');
  await big.locator('button').click(); await wait(page, 400);
  ok(await page.locator('.panel #amt').count() === 1, 'clicking a big expense opens it to edit');
  await page.keyboard.press('Escape'); await wait(page, 300);
  await page.locator('section:has(h2:text-is("Top merchants")) tbody tr a').first().click(); await wait(page, 500);
  ok(/#\/transactions/.test(await page.evaluate(() => location.hash)), 'a merchant opens its transactions');
  // show more
  await open('Top spending');
  const nm = await page.locator('section:has(h2:text-is("Top merchants")) tbody tr').count();
  ok(nm <= 15, 'at most 15 merchants at first (' + nm + ')');

  // ================= H. Home =================
  await page.evaluate(() => { App.month = null; location.hash = '#/'; }); await wait(page, 500);
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '-home.png' });
  const hero = await page.locator('header.hero').innerText();
  ok(/Bills still due/i.test(hero) && /Safe to spend/i.test(hero), 'Home shows "Bills still due" and "Safe to spend" for this month');
  const sf = await page.evaluate(() => { const s = Costs.safe(App.cfg, App.txs, U.today().slice(0, 7), U.today()); return { bills: s.bills, safe: s.safe, left: s.left, n: s.parts.length }; });
  ok(sf.bills >= 120 - 0.01 && Math.abs(sf.left - sf.bills - sf.safe) < 0.01, 'unpaid insurance (due the 27th) is in bills still due: ' + sf.bills + '; safe = left ' + sf.left + ' − bills');
  await page.click('button.stat:has-text("Bills still due")'); await wait(page, 400);
  const panel = await page.locator('.panel').innerText();
  ok(/Bills still due/.test(panel) && /Left to spend/.test(panel) && /Safe to spend/.test(panel), 'the panel shows left to spend − bills = safe to spend');
  ok(/Other household/i.test(panel) || /Insurance/.test(panel), 'it names where the bills are (' + (/Insurance/.test(panel) ? 'Insurance' : 'category') + ')');
  await page.keyboard.press('Escape'); await wait(page, 300);
  ok(await page.locator('header.hero h1').innerText().then(t => /left to spend|over budget/.test(t)), 'the Home headline is unchanged');
  // a past month has no "safe to spend"
  await page.click('button[aria-label="Previous month"]'); await wait(page, 400);
  ok(!/Safe to spend/i.test(await page.locator('header.hero').innerText()), 'a past month does not show "Safe to spend"');
  await page.click('button:text-is("Back to this month")'); await wait(page, 300);

  // ================= P. phone width =================
  await page.setViewportSize({ width: 375, height: 800 });
  for (const v of ['Recurring & fixed', 'Top spending']) {
    await open(v);
    const w = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    ok(w.s <= w.c, v + ' at 375px: the page does not scroll sideways (' + w.s + ' ≤ ' + w.c + ')');
  }
  await page.evaluate(() => { location.hash = '#/'; }); await wait(page, 400);
  const w2 = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  ok(w2.s <= w2.c, 'Home at 375px with the two new stats: no sideways scroll');
  await page.setViewportSize({ width: 1280, height: 900 });

  // ================= N. no nested controls, offline =================
  await open('Recurring & fixed');
  const nested = await page.evaluate(() => document.querySelectorAll('a a, a button, button a, button button').length);
  ok(nested === 0, 'no link inside a button or a button inside a link');
  ok(net.length === 0, 'nothing tried to reach the network (' + net.length + ')');
  ok(errors.length === 0, 'no page errors (' + errors.join('; ') + ')');
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
