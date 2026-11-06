/* Rule files download exactly as loaded; "Always tag" rules download in the same columns and load back as a rules file.
   Run: NODE_PATH=$(npm root -g) node tests/rules-download.test.js */
require('./_clock'); const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const APP = 'file://' + path.resolve(__dirname, '../index.html');
const F = n => [path.resolve(__dirname, '../private', n), path.resolve(__dirname, '../rules', n), path.join(process.env.BUDGET_PRIVATE_DIR || '/nonexistent', n), path.join(path.dirname(process.env.BUDGET_RULES || '/nonexistent/x'), n)].find(f => require('fs').existsSync(f));
let fails = 0;
function ok(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; }
const norm = t => t.replace(/^﻿/, '').replace(/\r\n/g, '\n').trim();
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(APP);
  await page.setInputFiles('#seed', F('budget-seed.json'));
  await page.waitForSelector('text=Tagging rules');
  ok(await page.locator('#rs-general ~ button, button:text-is("Download")').count() === 0, 'no Download button before a file is loaded');
  await page.setInputFiles('#rs-general', F('rules-general.csv')); await page.waitForSelector('text=Loaded');
  await page.setInputFiles('#rs-personal', F('rules-personal.csv')); await page.waitForTimeout(300);
  const btns = page.locator('button:text-is("Download")');
  ok(await btns.count() === 2, 'a Download button beside each loaded file');
  for (const [i, f] of [[0, 'rules-general.csv'], [1, 'rules-personal.csv']]) {
    const [dl] = await Promise.all([page.waitForEvent('download'), btns.nth(i).click()]);
    const got = fs.readFileSync(await dl.path(), 'utf8'), orig = fs.readFileSync(F(f), 'utf8');
    const same = await page.evaluate(([a, b]) => JSON.stringify(Engine.parseCSV(a).rows) === JSON.stringify(Engine.parseCSV(b.replace(/^﻿/, '')).rows), [got, orig]);
    ok(dl.suggestedFilename() === f && same, f + ': downloaded with the same name, every row and cell identical (' + got.split('\n').length + ' lines)');
    ok(norm(got) === norm(orig) || same, f + ': text ' + (norm(got) === norm(orig) ? 'byte-for-byte the same apart from line endings' : 'differs only in quoting'));
  }

  // an "Always tag" rule, made in Transactions
  await page.evaluate(async () => {
    await DB.putTx([{ id: 'x1', source: 'manual', createdAt: new Date().toISOString(), flags: [], date: '2026-10-05', amount: 9.5, categoryId: 'groceries', type: 'expense', desc: 'BLUE HERON BAKERY 1234', note: '' },
      { id: 'x2', source: 'manual', createdAt: new Date().toISOString(), flags: [], date: '2026-10-06', amount: 50, categoryId: 'groceries', type: 'expense', desc: 'PAYMENT THANK YOU', note: '' }]);
    await UI.reload(); location.hash = '#/transactions';
  });
  await page.waitForSelector('.tx');
  for (const [desc, cat] of [['BLUE HERON BAKERY 1234', 'dine-out'], ['PAYMENT THANK YOU', '_transfer']]) {
    await page.locator('.tx', { hasText: desc }).locator('button.tag').click();
    await page.selectOption('.editor select', cat);
    await page.check('.editor input[type=checkbox]');
    await page.click('.editor button:text-is("Save")'); await page.waitForTimeout(300);
  }
  await page.evaluate(() => { location.hash = '#/rules'; }); await page.waitForSelector('text=Rules you made (2)');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:text-is("Download as CSV")')]);
  const mine = fs.readFileSync(await dl.path(), 'utf8');
  console.log('     ' + mine.trim().split('\r\n').join('\n     '));
  ok(/^rules-made-in-app-\d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename()), 'file name: ' + dl.suggestedFilename());
  ok(mine.startsWith('rule_id,kind,pattern,match_type,value,priority,apply,notes'), 'same columns as the rule files');
  ok(/A001,category,BLUE HERON BAKERY,contains,Dine out,500,auto/.test(mine) && /A002,type,PAYMENT THANK YOU,contains,transfer,500,auto/.test(mine), 'category and type rules written correctly');

  // loads back as a rules file and wins over the general rules
  const res = await page.evaluate((t) => {
    const mineR = Engine.loadRules(Engine.parseCSV(t).rows), gen = Engine.loadRules(App.cfg.ruleSets.general.rows);
    const all = gen.concat(mineR);
    return [Engine.classify('BLUE HERON BAKERY #5678 VANCOUVER', all), Engine.classify('PAYMENT THANK YOU', all)];
  }, mine);
  ok(res[0].category === 'Dine out', 'loaded back: bakery → Dine out');
  ok(res[1].type === 'transfer' && res[1].typeApply === 'auto', 'loaded back: card payment → transfer, beating the general rule (suggest at 300)');

  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
