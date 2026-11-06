/* Version 14 in the browser: Insights "Month grid" (categories × months) and "Income, spent, saved" (by month).
   Run from the work (or our-budget) folder: node tests/v14.test.js (needs Playwright) */
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
  const info = await page.evaluate(async () => {
    const year = U.today().slice(0, 4), n = +U.today().slice(5, 7), lim = App.cfg.categories.find(c => c.id === 'groceries').limit;
    const l = [], mk = (o) => Object.assign({ id: U.uid(), source: 'csv', direction: 'out', type: 'expense', categoryId: 'groceries', accountId: 'a1', flags: [], createdAt: year + '-01-01T00:00:00Z', batchId: 'b' }, o);
    for (let m = 1; m <= n; m++) {
      const mm = String(m).padStart(2, '0');
      l.push(mk({ date: year + '-' + mm + '-05', amount: m === 1 ? Math.round(lim * 1.1) : m === 2 ? Math.round(lim * 1.5) : Math.round(lim * 0.6), desc: 'SAFEWAY ' + m }));
      l.push(mk({ date: year + '-' + mm + '-01', amount: 2300, categoryId: 'rent', desc: 'RENT ' + m }));
      l.push(mk({ date: year + '-' + mm + '-15', amount: 3000, categoryId: '_income', type: 'income', direction: 'in', desc: 'PAYROLL ' + m }));
      l.push(mk({ date: year + '-' + mm + '-20', amount: 200, categoryId: 'savings', type: 'saving', desc: 'TFSA ' + m }));
    }
    const fund = App.cfg.bigExpenses[0];
    l.push(mk({ date: year + '-02-10', amount: 250, categoryId: 'fees-admin', desc: 'AMEX MEMBERSHIP FEE', fundId: fund.id }));
    await DB.putTx(l); await UI.reload();
    return { year, n, lim, ytd: M.ytd(App.cfg, App.txs, year, U.today()).spent };
  });
  await page.evaluate(() => { location.hash = '#/insights'; }); await wait(page, 500);

  // view chips
  ok(await page.locator('[role=group][aria-label=View] button').count() === 5, 'Insights has five views: By category, Month grid, Income spent saved, Recurring & fixed, Top spending');
  ok(await page.locator('button[aria-pressed=true]:text-is("By category")').count() === 1, 'By category is the default and still works');
  await page.click('button:text-is("Month grid")'); await wait(page, 400);
  ok(/month by month/.test(await page.locator('main h1').innerText()), 'heading follows the view');
  const heads = (await page.locator('table.yg thead th').allInnerTexts()).map(x => x.replace(/^(.)(.*)$/, (m, a, b) => a.toUpperCase() + b.toLowerCase()));   // headings are shown in capitals; compare the words
  ok(heads[0] === 'Category' && heads[1] === 'Jan' && heads.includes('Total') && heads.includes('Avg a month') && heads.filter(x => /^[A-Z][a-z]{2}\*?$/.test(x)).length === info.n, 'grid: Category, Jan … this month, Total, Avg a month (' + info.n + ' month columns)');
  ok(heads.some(x => /\*$/.test(x)), 'the current month is marked * (so far)');
  const gro = page.locator('table.yg tbody tr:has(th button:text-is("Groceries"))').first();
  const cells = gro.locator('td');
  ok(/▲/.test(await cells.nth(0).innerText()) && !/▲▲/.test(await cells.nth(0).innerText()) && /yg-over(\s|$)/.test(await cells.nth(0).getAttribute('class')), 'Groceries January (10% over): shaded and marked ▲');
  ok(/▲▲/.test(await cells.nth(1).innerText()) && /yg-over2/.test(await cells.nth(1).getAttribute('class')), 'Groceries February (50% over): marked ▲▲');
  ok(!/▲/.test(await cells.nth(2).innerText()) || info.n < 3, 'Groceries March (under the limit): no mark');
  const lab = await cells.nth(0).locator('a').getAttribute('aria-label');
  ok(/Groceries in January/.test(lab) && /limit \$/.test(lab) && /over by \$/.test(lab), 'a cell\'s accessible name carries the amount, limit and "over by": "' + lab.slice(0, 90) + '…"');
  const rentRow = page.locator('table.yg tbody tr:has(th button:text-is("Rent"))').first();
  ok(/\$2,300/.test(await rentRow.locator('td').nth(0).innerText()) && !/yg-over/.test(await rentRow.locator('td').nth(0).getAttribute('class') || ''), 'Rent $2,300 each month with no mark when it is within its limit');
  const total = await page.locator('tr.yg-total td').allInnerTexts();
  ok(total[total.length - 2].replace(/[^0-9]/g, '') === String(Math.round(info.ytd)), 'grid grand total equals Insights year-to-date spent ($' + Math.round(info.ytd) + ')');
  ok(await page.evaluate(() => !document.body.innerText.includes('AMEX')) && await page.evaluate(() => { const g = Year.grid(M.ytd(App.cfg, App.txs, U.today().slice(0, 4), U.today())); return !g.groups.flatMap(x => x.rows).some(r => r.cat.id === 'fees-admin' && r.total >= 250); }), 'the $250 paid from a big-expense fund is not in Fees & Admin');
  // a cell opens its transactions
  await cells.nth(0).locator('a').click(); await wait(page, 500);
  ok(await page.evaluate(() => /#\/transactions/.test(location.hash) && /cat=groceries/.test(location.hash) && /m=\d{4}-01/.test(location.hash)), 'clicking a cell opens that category and month in Transactions');
  ok(/SAFEWAY 1/.test(await page.locator('main').innerText()), '…and the list shows the line behind the number');

  // income / spent / saved
  await page.evaluate(() => { location.hash = '#/insights'; }); await wait(page, 400);
  await page.click('button:text-is("Income, spent, saved")'); await wait(page, 400);
  const tiles = await page.locator('.grid-tiles .tile').allInnerTexts();
  ok(/Income/i.test(tiles[0]) && tiles[0].replace(/[^0-9]/g, '').startsWith(String(3000 * info.n)), 'Income tile: $' + 3000 * info.n + ' (3,000 × ' + info.n + ' months)');
  ok(/Saved/i.test(tiles[2]) && /\$2,000/.test(tiles[2]) && /7%/.test(tiles[2]), 'Saved tile shows the savings rate (200 ÷ 3,000 = 7%)');
  const rows = await page.locator('table.yg tbody tr').count();
  ok(rows === info.n + 2, 'one row per month plus "Year so far" and "Average full month" (' + rows + ')');
  const feb = await page.locator('table.yg tbody tr:has(th button:text-is("February"))').innerText();
  ok(/\$250/.test(feb) || /Paid from big expenses/i.test(await page.locator('table.yg thead').innerText()), 'big-expense payments get their own column');
  ok(/Paid from big expenses/i.test(await page.locator('table.yg thead').innerText()), 'the column is shown only when a fund was used');
  const left = await page.evaluate(() => { const r = Year.months(App.cfg, App.txs, U.today().slice(0, 4), U.today()).rows[1]; return r.left; });
  ok(left === 3000 - (await page.evaluate(() => Year.months(App.cfg, App.txs, U.today().slice(0, 4), U.today()).rows[1].spent)) - 200 - 250, 'February left over = income − spent − big expenses − saved');
  const yt = await page.locator('tr.yg-total').first().innerText();
  ok(/Year so far/.test(yt), 'a totals row closes the table');
  await page.locator('table.yg tbody tr:has(th button:text-is("January")) td a').first().click(); await wait(page, 400);
  ok(await page.evaluate(() => /#\/transactions\?f=in/.test(location.hash) && /m=\d{4}-01/.test(location.hash)), 'an income amount opens that month\'s money-in lines');

  // years
  await page.evaluate(() => { location.hash = '#/insights'; }); await wait(page, 400);
  await page.click('button[aria-label="Previous year"]'); await wait(page, 400);
  ok(/Nothing recorded for/.test(await page.locator('main').innerText()), 'a year with no data says so plainly (no empty table)');
  await page.click('button:text-is("Month grid")'); await wait(page, 300);
  ok(/No spending recorded for/.test(await page.locator('main').innerText()), 'same for the grid');
  await page.click('button[aria-label="Next year"]'); await wait(page, 300);

  // command palette
  await page.keyboard.press('Control+k'); await page.keyboard.type('income spent'); await wait(page, 300);
  await page.keyboard.press('Enter'); await wait(page, 500);
  ok(await page.locator('button[aria-pressed=true]:text-is("Income, spent, saved")').count() === 1, 'Ctrl+K "income spent" opens the income view');

  // phone width: the table scrolls inside its box, the page does not
  await page.setViewportSize({ width: 375, height: 800 }); await wait(page, 300);
  await page.click('button:text-is("Month grid")'); await wait(page, 400);
  const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, box: document.querySelector('.scroll-x[role=region]').scrollWidth > document.querySelector('.scroll-x[role=region]').clientWidth }));
  ok(w.sw <= w.cw && w.box, 'at 375px the page does not scroll sideways; the grid scrolls inside its own box');
  ok(await page.evaluate(() => { const th = document.querySelector('table.yg th:first-child'); return getComputedStyle(th).position === 'sticky'; }), 'the category column stays in view while scrolling');

  ok(net.length === 0, 'no network requests (' + net.length + ')');
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
