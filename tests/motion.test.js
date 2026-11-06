/* Motion: entrances play once (not on every redraw), panels slide in/out without blocking Escape or focus,
   changed rows highlight, and "reduce motion" swaps movement for short fades.
   Run: NODE_PATH=$(npm root -g) node tests/motion.test.js */
require('./_clock'); const { chromium } = require('playwright');
const path = require('path');
const APP = 'file://' + path.resolve(__dirname, '../index.html');
const SEED = [path.resolve(__dirname, '../private/budget-seed.json'), process.env.BUDGET_SEED || ''].find(f => require('fs').existsSync(f));
let fails = 0;
function ok(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; }
const anim = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return e ? getComputedStyle(e).animationName : null; }, sel);
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(APP);
  await page.setInputFiles('#seed', SEED);
  await page.waitForSelector('text=Tagging rules');
  await page.evaluate(async () => {
    const l = []; for (let i = 0; i < 30; i++) l.push({ id: 't' + i, source: 'manual', createdAt: new Date().toISOString(), flags: [], date: '2026-10-' + String(1 + i % 20).padStart(2, '0'), amount: 5 + i, categoryId: 'groceries', type: 'expense', desc: 'SHOP ' + i, note: '' });
    await DB.putTx(l); await UI.reload();
  });

  // screen change
  await page.evaluate(() => { location.hash = '#/home'; });
  await page.waitForTimeout(30);
  ok(await page.evaluate(() => document.getElementById('main').classList.contains('enter')), 'new screen: content fades up');
  ok(await anim(page, '.main.enter .bar > .fill') === 'bar-grow', 'new screen: bars grow in');
  await page.waitForTimeout(400);
  ok(!(await page.evaluate(() => document.getElementById('main').classList.contains('enter'))), 'entrance class removed afterwards');
  await page.evaluate(() => App.render());
  ok(!(await page.evaluate(() => document.getElementById('main').classList.contains('enter'))), 'a redraw on the same screen does not replay it');

  // panel in / out
  await page.click('button:text-is("+ Add expense")');
  ok(await anim(page, '#layer .panel') === 'panel-in', 'Add expense slides in from the right');
  await page.keyboard.press('Escape');
  ok(await page.evaluate(() => !document.getElementById('layer').firstChild), 'Escape closes at once (nothing waits for the animation)');
  ok(await anim(page, 'body > .overlay.leaving .panel') === 'panel-out', 'a copy slides out');
  ok(await page.evaluate(() => !document.querySelector('.overlay.leaving [id]')), 'the leaving copy has no ids that could clash');
  ok(await page.evaluate(() => document.activeElement && document.activeElement.textContent === '+ Add expense'), 'focus returns to the button');
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => !document.querySelector('.overlay.leaving')), 'leaving copy removed after 150ms');

  // group opens in place
  await page.locator('.group-head').first().click();
  ok(await page.evaluate(() => !!document.querySelector('.group-body.enter')), 'opened group fades in');
  await page.waitForTimeout(300); await page.evaluate(() => App.render());
  ok(await page.evaluate(() => !document.querySelector('.group-body.enter') && !!document.querySelector('.group-body')), 'stays open without replaying on redraw');

  // transactions: editor, toast, row highlight
  await page.evaluate(() => { location.hash = '#/transactions'; }); await page.waitForSelector('.tx');
  await page.locator('.tx button.tag').first().click();
  ok(await page.evaluate(() => !!document.querySelector('.editor.enter')), 'category editor fades in under the row');
  await page.selectOption('.editor select', 'dine-out');
  await page.click('.editor button:text-is("Save")');
  await page.waitForSelector('#toast');
  ok(await page.evaluate(() => document.getElementById('toast').classList.contains('enter')), 'confirmation bar drops in');
  ok(await page.evaluate(() => document.querySelectorAll('.tx.flash').length === 1), 'the changed row glows briefly');
  await page.waitForTimeout(700); await page.evaluate(() => App.render());
  ok(await page.evaluate(() => !document.querySelector('.tx.flash') && !document.getElementById('toast').classList.contains('enter')), 'no replay after a later redraw (Undo bar stays, still)');

  // menu
  await page.click('.nav-toggle');
  ok(await page.evaluate(() => document.getElementById('nav-links').classList.contains('enter')), 'menu links fade in when ☰ opens');
  await page.click('.nav-toggle');

  // reduced motion
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.click('button:text-is("+ Add")');
  ok(await anim(page, '#layer .panel') === 'fade-in', 'reduce motion: panel only fades');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForTimeout(30);
  ok(await anim(page, '.main.enter > h1, .main.enter > header') === 'fade-in' && await anim(page, '.main.enter .bar > .fill') === 'none', 'reduce motion: screens fade, bars do not grow');
  const moves = await page.evaluate(() => { const t = document.querySelector('.btn'); return getComputedStyle(t).transform; });
  ok(moves === 'none', 'reduce motion: nothing moves');

  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
