/* PDF statements in the Import tab, with the stronger proof (running balance, totals, summary box) and the confirm box.
   Uses the made-up statements in tools/pdf-layout-dump/dev-tools/fixtures. Needs your private seed (see tests/README.md).
   Run: node tests/pdf-import.test.js */
require('./_clock'); const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const APP = 'file://' + path.resolve(__dirname, '../index.html');
const PKG = path.resolve(__dirname, '..');
const pick = (...c) => c.find(f => f && fs.existsSync(f));
const SEED = pick(process.env.BUDGET_SEED, PKG + '/private/budget-seed.json');
const GEN = pick(process.env.BUDGET_RULES, PKG + '/rules/rules-general.csv');
const FIX = path.resolve(__dirname, '../tools/pdf-layout-dump/dev-tools/fixtures');
let fails = 0;
function ok(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; }
const wait = (p, ms) => p.waitForTimeout(ms || 300);

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const net = [];
  await ctx.route('**/*', r => { const u = r.request().url(); if (/^(file|data|blob):/.test(u)) return r.continue(); net.push(u); return r.abort(); });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(APP);
  await page.setInputFiles('#seed', SEED); await page.waitForSelector('#rs-general');
  if (GEN) { await page.setInputFiles('#rs-general', GEN); await wait(page, 400); }
  const go = async () => { await page.evaluate(() => { location.hash = '#/import'; }); await page.waitForSelector('#csvf'); await wait(page, 200); };
  const load = async (name) => { await page.setInputFiles('#csvf', path.join(FIX, name)); await page.waitForSelector('.pdf-note', { timeout: 30000 }); await wait(page, 300); };
  const account = async () => {
    if (await page.locator('section .toast.warn button.primary').count()) await page.locator('section .toast.warn button.primary').first().click();
    else if (await page.locator('#acct').inputValue() === '') { await page.selectOption('#acct', '__new'); await page.fill('#an', 'Test chequing'); await page.selectOption('#ak', 'bank'); await page.click('button:text-is("Add account")'); }
    await wait(page, 400);
  };
  const clear = () => page.evaluate(() => { const f = Importer._files(); f.splice(0, f.length); App.render(); });
  const importAll = () => page.getByRole('button', { name: /^Import all \(\d+\)$/ });

  await go();
  // ---- a statement where one printed balance is wrong: the reader's own check passes, the running balance does not ----
  await load('chq-wrong.pdf'); await account();
  let txt = await page.locator('main').innerText();
  ok(/Running balance: 1 line \(page 1, line 30\)/.test(txt), 'chq-wrong: the check names the page and line where the running balance does not follow');
  ok(await page.locator('#pdf-ack').count() === 1 && await importAll().isDisabled(), 'chq-wrong: Import all is off until you confirm you checked the lines');
  ok(await page.locator('tr:has-text("printed balance does not follow")').count() === 1, 'chq-wrong: the one suspect line says why it is flagged (Review)');
  await page.check('#pdf-ack'); await wait(page, 300);
  ok(await importAll().isEnabled(), 'chq-wrong: ticking the confirmation turns Import all on');
  const b0 = await page.evaluate(() => App.txs.length);
  await importAll().click(); await wait(page, 800);
  ok(await page.evaluate(() => App.txs.length) === b0 + 40, 'chq-wrong: all 40 lines imported');
  ok(await page.evaluate(() => App.txs.some(t => t.needsTag && /does not follow/.test(t.reviewReason || ''))), 'chq-wrong: the suspect line waits in Review with the reason');
  await page.locator('.prompt button:text-is("Undo this import")').click(); await wait(page, 800);
  ok(await page.evaluate(() => App.txs.length) === b0, 'Undo this import takes them out again');
  await clear();

  // ---- a good statement: proven, nothing to confirm ----
  await go(); await load('chq.pdf'); await account();
  txt = await page.locator('main').innerText();
  ok(/Running balance: all 40 printed balances follow from the lines above, and the closing balance matches/.test(txt), 'chq: the running balance proves all 40 lines');
  ok(await page.locator('#pdf-ack').count() === 0 && await importAll().isEnabled(), 'chq: nothing to confirm, Import all is ready');
  await importAll().click(); await wait(page, 800);
  ok(await page.evaluate(() => App.txs.filter(t => t.file === 'chq.pdf').length) === 40, 'chq: 40 lines imported');
  await clear();

  // ---- a statement with no running balance, proven by its summary box and totals ----
  for (const name of ['cardsum.pdf', 'cardsec.pdf', 'sumchq.pdf']) {
    await go(); await load(name);
    ok(await page.locator('#pdf-ack').count() === 0 && /summary box adds up/.test(await page.locator('.pdf-note').innerText()), name + ': the summary box adds up, nothing to confirm');
    await clear();
  }
  // ---- statements that fail ----
  for (const [name, re] of [['sumchq-bad.pdf', /summary box does not add up|do not add up to the movement/], ['cardsec-bad.pdf', /do not add up|does not add up/], ['card.pdf', /do not add up/]]) {
    await go(); await load(name);
    ok(await page.locator('#pdf-ack').count() === 1 && re.test(await page.locator('.pdf-note').innerText()), name + ': reported, and you must confirm before importing');
    await clear();
  }
  // ---- a locked PDF still asks for its password ----
  await go(); await page.setInputFiles('#csvf', path.join(FIX, 'locked.pdf')); await page.waitForSelector('input[type=password]', { timeout: 30000 });
  ok(true, 'locked.pdf: asks for its password');
  await page.keyboard.press('Escape'); await wait(page, 300);
  // ---- offline ----
  ok(net.length === 0, 'nothing tried to reach the network (' + net.length + ')');
  ok(errors.length === 0, 'no page errors (' + errors.join('; ') + ')');
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
