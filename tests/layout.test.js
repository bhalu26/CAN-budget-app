/* Menu (☰) and scroll position: clicking things never jumps the page to the top.
   Run: NODE_PATH=$(npm root -g) node tests/layout.test.js [screenshot folder] */
require('./_clock'); const { chromium } = require('playwright');
const path = require('path');
const APP = 'file://' + path.resolve(__dirname, '../index.html');
const SEED = [path.resolve(__dirname, '../private/budget-seed.json'), process.env.BUDGET_SEED || ''].find(f => require('fs').existsSync(f));
const SHOTS = process.argv[2];
let fails = 0;
function ok(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; }
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 2000, height: 940 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(APP);
  await page.setInputFiles('#seed', SEED);
  await page.waitForSelector('text=Tagging rules');
  await page.evaluate(() => { location.hash = '#/settings'; }); await page.waitForTimeout(300);
  await page.evaluate(async () => {
    const l = []; for (let i = 0; i < 120; i++) l.push({ id: U.uid(), source: 'manual', createdAt: new Date().toISOString(), flags: [], date: '2026-10-' + String(1 + i % 20).padStart(2, '0'), amount: 5 + i, categoryId: i % 3 ? 'groceries' : 'dine-out', type: 'expense', desc: 'SHOP ' + i, note: '', needsTag: i % 10 === 0 });
    await DB.putTx(l); await UI.reload(); App.render();
  });

  // folded rail by default
  const navW = await page.evaluate(() => document.getElementById('nav').getBoundingClientRect().width);
  ok(navW <= 64, 'menu folded to a ' + Math.round(navW) + 'px rail');
  ok(await page.locator('.nav-toggle .dot').count() === 1, 'dot on ☰ shows items waiting for review');
  if (SHOTS) await page.screenshot({ path: SHOTS + '/settings-folded-2000.png' });

  // scroll stays put when clicking in Settings
  await page.evaluate(() => window.scrollTo(0, 300));
  const y0 = await page.evaluate(() => window.scrollY);
  const box = page.locator('.check input[type=checkbox]').nth(2);
  const top0 = await box.evaluate(e => e.getBoundingClientRect().top);
  await box.click({ force: true }); await page.waitForTimeout(400);
  const top1 = await page.locator('.check input[type=checkbox]').nth(2).evaluate(e => e.getBoundingClientRect().top);
  ok(y0 > 0 && Math.abs(top1 - top0) < 3, 'Settings: ticking Fixed bill keeps what you are looking at in place (box moved ' + Math.abs(top1 - top0).toFixed(1) + 'px)');
  await page.locator('.check input[type=checkbox]').nth(2).click({ force: true }); await page.waitForTimeout(400);

  // Home: open a group further down
  await page.goto(APP + '#/home'); await page.waitForSelector('.group-head');
  await page.locator('.group-head').last().scrollIntoViewIfNeeded();
  const h0 = await page.evaluate(() => window.scrollY);
  await page.locator('.group-head').last().click(); await page.waitForTimeout(300);
  const h1 = await page.evaluate(() => window.scrollY);
  ok(Math.abs(h1 - h0) < 2, 'Home: opening a group keeps the scroll position (' + h0 + ' → ' + h1 + ')');

  // Transactions: open the category editor on a row far down
  await page.goto(APP + '#/transactions'); await page.waitForSelector('.tx');
  const tag = page.locator('.tx button.tag').nth(60); await tag.scrollIntoViewIfNeeded();
  const t0 = await page.evaluate(() => window.scrollY);
  await tag.click(); await page.waitForSelector('.editor');
  const t1 = await page.evaluate(() => window.scrollY);
  ok(t0 > 0 && Math.abs(t1 - t0) < 2, 'Transactions: opening a category editor keeps the scroll position (' + t0 + ' → ' + t1 + ')');
  // a plain mouse click, like a person: Playwright's own click re-scrolls the button into view while the editor is still fading in
  const cb = await page.locator('.editor button:text-is("Cancel")').boundingBox();
  await page.waitForTimeout(200); await page.mouse.click(cb.x + 10, cb.y + 10); await page.waitForTimeout(200);
  ok(await page.locator('.editor').count() === 0, 'Transactions: Cancel closed the editor');
  const t2 = await page.evaluate(() => window.scrollY); ok(Math.abs(t2 - t0) < 2, 'Transactions: Cancel keeps it too (' + t0 + ' → ' + t2 + ')');

  // going to another screen still starts at the top
  await page.evaluate(() => { location.hash = '#/insights'; }); await page.waitForTimeout(300);
  ok(await page.evaluate(() => window.scrollY) === 0, 'changing screens starts at the top');

  // open the menu: remembered after reload
  await page.click('.nav-toggle');
  ok(await page.evaluate(() => document.getElementById('nav').getBoundingClientRect().width) === 224, 'open menu is 224px');
  ok(await page.getAttribute('.nav-toggle', 'aria-expanded') === 'true', '☰ reports expanded');
  if (SHOTS) await page.screenshot({ path: SHOTS + '/insights-open-2000.png' });
  await page.reload(); await page.waitForSelector('.nav-toggle');
  ok(await page.evaluate(() => document.getElementById('nav').className) === 'nav open', 'open/folded choice remembered');
  await page.click('.nav-toggle');

  // phone
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(APP + '#/home'); await page.waitForSelector('.nav-toggle');
  ok(await page.locator('#nav-links').isHidden(), 'phone: menu folded into a top bar');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= 375), 'phone: no sideways scroll');
  if (SHOTS) await page.screenshot({ path: SHOTS + '/home-phone-folded.png' });
  await page.click('.nav-toggle');
  ok(await page.locator('#nav-links').isVisible(), 'phone: ☰ drops the menu down');
  if (SHOTS) await page.screenshot({ path: SHOTS + '/home-phone-open.png' });
  await page.click('#nav-links a:has-text("Insights")'); await page.waitForTimeout(300);
  ok(await page.locator('#nav-links').isHidden(), 'phone: menu folds away after picking a screen');

  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
