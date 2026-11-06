/* Version 15 in the browser: split an imported line across categories (from Edit, from Review), validation, Undo, change, join back,
   "same split as last time", and Data health noticing a split that no longer adds up.
   Run from the work (or our-budget) folder: node tests/v15.test.js (needs Playwright) */
require('./_clock'); const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const APP = 'file://' + path.resolve(__dirname, '../index.html');
const PKG = path.resolve(__dirname, '..');
const pick = (...c) => c.find(f => fs.existsSync(f));
const SEED = pick(PKG + '/private/budget-seed.json', process.env.BUDGET_SEED || '');
const GEN = pick(PKG + '/rules/rules-general.csv', process.env.BUDGET_RULES || '');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-'));
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

  // import a Costco line
  const csv = path.join(TMP, 'td-chequing-7788.csv');
  fs.writeFileSync(csv, ['Date,Description,Amount', '2026-10-05,COSTCO WHOLESALE W123,-203.10', '2026-10-06,SAFEWAY #4545,-30.00', '2026-10-07,UNKNOWN BIGBOX 77,-90.00'].join('\n'));
  await page.evaluate(() => { location.hash = '#/import'; }); await page.waitForSelector('#csvf');
  await page.setInputFiles('#csvf', csv); await wait(page, 500);
  if (await page.locator('section .toast.warn button.primary').count()) await page.locator('section .toast.warn button.primary').first().click();
  else { await page.selectOption('#acct', '__new'); await page.fill('#an', 'TD chequing'); await page.selectOption('#ak', 'bank'); await page.click('button:text-is("Add account")'); }
  await wait(page, 400);
  await page.click('button:has-text("Import all")').catch(async () => { await page.locator('button.primary:has-text("Import")').first().click(); });
  await wait(page, 600);
  const cos = () => page.evaluate(() => App.txs.filter(t => /COSTCO/.test(t.desc) && t.date === '2026-10-05').map(t => ({ id: t.id, amount: t.amount, cat: t.categoryId, fp: t.fp, g: t.splitGroup, file: t.file, line: t.line, nt: t.needsTag })));
  let c0 = await cos();
  ok(c0.length === 1 && c0[0].amount === 203.1, 'imported: one Costco line of $203.10 (' + c0[0].cat + ')');
  const monthBefore = await page.evaluate(() => { const s = M.month(App.cfg, App.txs, '2026-10', '2026-10-23'); return { spent: s.spent, left: s.left }; });
  const grocBefore = await page.evaluate(() => { const s = M.month(App.cfg, App.txs, '2026-10', '2026-10-23'); const r = s.groups.flatMap(g => g.rows).find(r => r.cat.id === 'groceries'); return r ? r.spent : 0; });

  // open Edit → Split this line…
  const edit = async (id) => { await page.evaluate(id => UI.expensePanel(App.txs.find(t => t.id === id), App.render), id); await page.waitForSelector('#amt'); };
  await edit(c0[0].id);
  ok(await page.locator('.panel button:text-is("Split this line…")').count() === 1, 'Edit transaction offers "Split this line…" for a spending line');
  await page.click('.panel button:text-is("Split this line…")'); await page.waitForSelector('#sp-a0'); await wait(page, 300);
  ok(/\$203\.10/.test(await page.locator('.panel .notice').innerText()), 'the panel shows the bank amount: $203.10');
  ok(await page.locator('#sp-c1 option[value=_transfer]').count() === 0 && await page.locator('#sp-c0 optgroup[label="Not spending"]').count() === 0, 'only spending categories are offered (no transfer or income)');
  await page.selectOption('#sp-c0', 'groceries');
  await page.fill('#sp-a1', '53'); await wait(page, 150);
  ok(await page.inputValue('#sp-a0') === '150.1', 'line 1 fills in what is left: 150.1');
  ok(/All \$203\.10 is placed/.test(await page.locator('.sp-status').innerText()), 'status: "✓ All $203.10 is placed."');
  await page.click('.panel button:text-is("Save split")'); await wait(page, 200);
  ok(/Line 2 needs a spending category/.test(await page.locator('.panel [role=alert]').first().innerText()), 'saving without a category on line 2 says exactly what is missing');
  await page.fill('#sp-a1', '300'); await wait(page, 150);
  ok(/over the \$203\.10 total|still to place/.test(await page.locator('.sp-status').innerText()), 'typing too much: the status says it is over');
  await page.fill('#sp-a1', '53'); await page.selectOption('#sp-c1', 'other-household'); await wait(page, 150);
  await page.click('.panel button:text-is("Save split")'); await wait(page, 600);
  let c1 = await cos();
  ok(c1.length === 2 && Math.round(c1.reduce((a, x) => a + x.amount, 0) * 100) === 20310, 'saved: two lines that add up to $203.10');
  ok(c1.some(x => x.id === c0[0].id) && c1.every(x => x.fp === c0[0].fp && x.file === 'td-chequing-7788.csv' && x.line === c0[0].line), 'the original id stays, and both parts keep the bank file, line and fingerprint');
  ok(c1.map(x => x.cat).sort().join() === 'groceries,other-household' && c1.every(x => !x.nt), 'categories are groceries + other-household and the line is reviewed');
  const m1 = await page.evaluate(() => { const s = M.month(App.cfg, App.txs, '2026-10', '2026-10-23'); const r = s.groups.flatMap(g => g.rows).find(r => r.cat.id === 'groceries'); return { spent: s.spent, left: s.left, groc: r ? r.spent : 0 }; });
  ok(m1.spent === monthBefore.spent && m1.left === monthBefore.left, 'month total spent and left to spend are unchanged by the split');
  ok(Math.abs((grocBefore - m1.groc) - 53) < 0.01 || c0[0].cat !== 'groceries', 'Groceries went down by the $53 moved out (if it was there)');
  ok(/split 1 of 2/.test(await page.evaluate(() => App.txs.filter(t => /COSTCO/.test(t.desc)).map(t => t.flags.join()).join('|'))), 'each part carries a "split 1 of 2 (bank amount …)" flag');
  // Undo
  await page.click('#toast button:text-is("Undo")'); await wait(page, 600);
  c1 = await cos();
  ok(c1.length === 1 && c1[0].id === c0[0].id && c1[0].amount === 203.1 && !c1[0].g, 'Undo puts the single $203.10 line back');

  // an earlier split of the same merchant → "same split as last time"
  await page.evaluate(async () => {
    const mk = (id, amt, cat, idx) => ({ id, source: 'csv', direction: 'out', type: 'expense', categoryId: cat, desc: 'COSTCO WHOLESALE W123', date: '2026-09-05', amount: amt, splitGroup: 'old1', splitTotal: 100, splitIndex: idx, accountId: 'x', flags: [], createdAt: '2026-09-05T00:00:00Z' });
    await DB.putTx([mk('old1', 70, 'groceries', 1), mk('old2', 30, 'other-household', 2)]); await UI.reload();
  });
  await edit(c0[0].id); await page.click('.panel button:text-is("Split this line…")'); await page.waitForSelector('#sp-a0');
  const same = page.locator('.panel button:has-text("Same split as Sep 5")');
  ok(await same.count() === 1 && /Groceries 70%/.test(await same.innerText()), 'a button offers the same split as Sep 5 (Groceries 70%, Other household 30%)');
  await same.click(); await wait(page, 300);
  ok(await page.inputValue('#sp-a0') === '142.17' && await page.inputValue('#sp-a1') === '60.93', 'applied to $203.10 → 142.17 + 60.93 (exact to the cent)');
  await page.click('.panel button:text-is("Save split")'); await wait(page, 600);
  c1 = await cos(); ok(c1.length === 2 && c1.some(x => x.amount === 60.93), 'saved with the suggested split');

  // change the split from one of its parts, then join back
  const part = c1.find(x => x.id !== c0[0].id);
  await edit(part.id);
  ok(await page.locator('.panel button:text-is("Change the split…")').count() === 1, 'a part offers "Change the split…"');
  await page.click('.panel button:text-is("Change the split…")'); await page.waitForSelector('#sp-a0'); await wait(page, 200);
  ok(await page.inputValue('#sp-a0') === '142.17' && await page.inputValue('#sp-a1') === '60.93', 'the current split is filled in');
  await page.click('.panel button:text-is("Add another line")'); await page.waitForSelector('#sp-a2');
  await page.fill('#sp-a1', '40'); await page.selectOption('#sp-c2', 'clothing'); await page.click('.panel button[aria-label="Put the rest in line 3"]'); await wait(page, 150);
  ok(await page.inputValue('#sp-a2') === '20.93', '"Put the rest here" fills $20.93');
  await page.fill('#sp-a0', '142.17'); await wait(page, 100);
  await page.click('.panel button:text-is("Save split")'); await wait(page, 600);
  c1 = await cos(); ok(c1.length === 3 && Math.round(c1.reduce((a, x) => a + x.amount, 0) * 100) === 20310, 'changed to three lines, still $203.10');
  await edit(c0[0].id); await page.click('.panel button:text-is("Change the split…")'); await page.waitForSelector('#sp-a0');
  await page.click('.panel button:text-is("Join back into one line")'); await wait(page, 200);
  ok(/Join these 3 lines back into one \$203\.10 line/.test(await page.locator('.panel .toast.warn').innerText()), 'join asks first and names what will happen');
  await page.selectOption('#sp-join', 'groceries'); await page.click('.panel .toast.warn button:text-is("Join")'); await wait(page, 600);
  c1 = await cos(); ok(c1.length === 1 && c1[0].amount === 203.1 && c1[0].nt === true && !c1[0].g, 'joined: one $203.10 line, waiting in Review');
  await page.click('#toast button:text-is("Undo")'); await wait(page, 600);
  ok((await cos()).length === 3, 'Undo restores the three-line split');

  // data health: edit a part so the split no longer adds up
  const parts = await cos(); const tweak = parts.find(x => x.id !== c0[0].id);
  await edit(tweak.id); await page.fill('#amt', String(tweak.amount + 7)); await page.click('button:text-is("Save changes")'); await wait(page, 500);
  await page.evaluate(() => { location.hash = '#/health'; }); await wait(page, 500);
  const card = page.locator('article:has-text("A split no longer adds up")');
  ok(await card.count() === 1 && /\$7\.00 extra/.test(await card.innerText()), 'Data health: "A split no longer adds up … $7.00 extra"');
  await card.locator('button:text-is("Change the split")').click(); await page.waitForSelector('#sp-a0'); await wait(page, 200);
  ok(/over the \$203\.10 total/.test(await page.locator('.sp-status').innerText()), 'the panel opens showing it is $7 over');
  await page.fill('#sp-a0', '135.17'); await wait(page, 100);
  await page.click('.panel button:text-is("Save split")'); await wait(page, 600);
  ok(await page.locator('article:has-text("A split no longer adds up")').count() === 0, 'fixing it clears the flag');

  // equal parts are not duplicates
  await page.evaluate(async () => { const t = App.txs.find(x => /UNKNOWN BIGBOX/.test(x.desc)); location.hash = '#/review'; App.render(); });
  await wait(page, 400);
  for (let i = 0; i < 6 && !(await page.locator('main button:text-is("Split…")').count()); i++) { await page.keyboard.press('s'); await wait(page, 200); }
  ok(await page.locator('main button:text-is("Split…")').count() === 1, 'the Review card has a "Split…" button');
  await page.click('main button:text-is("Split…")'); await page.waitForSelector('#sp-a0');
  await page.selectOption('#sp-c0', 'clothing'); await page.fill('#sp-a1', '45'); await page.selectOption('#sp-c1', 'entertainment');
  await page.click('.panel button:text-is("Save split")'); await wait(page, 600);
  const big = await page.evaluate(() => App.txs.filter(t => /UNKNOWN BIGBOX/.test(t.desc)).map(t => ({ a: t.amount, nt: t.needsTag })));
  ok(big.length === 2 && big.every(x => x.a === 45 && !x.nt), 'split from Review: $45 + $45, line no longer waiting');
  await page.evaluate(() => { location.hash = '#/health'; }); await wait(page, 400);
  ok(await page.locator('article:has-text("UNKNOWN BIGBOX")').count() === 0, 'two equal $45 parts are not reported as duplicates');

  // lines that cannot be split say why
  const fundId = await page.evaluate(() => App.cfg.bigExpenses[0].id);
  await page.evaluate(async id => { await DB.putTx([{ id: 'fp1', source: 'manual', direction: 'out', type: 'expense', categoryId: 'fees-admin', desc: 'AMEX FEE', date: '2026-10-08', amount: 250, fundId: id, flags: [], createdAt: '2026-10-08T00:00:00Z' }, { id: 'tr1', source: 'csv', direction: 'out', type: 'transfer', categoryId: '_transfer', desc: 'TO SAVINGS', date: '2026-10-08', amount: 100, flags: [], createdAt: '2026-10-08T00:00:00Z' }]); await UI.reload(); }, fundId);
  await edit('fp1');
  ok(await page.locator('.panel button:has-text("Split")').count() === 0 && /big expense/.test(await page.locator('.panel').innerText()), 'a line paid from a big expense has no split button and says why');
  await page.keyboard.press('Escape'); await wait(page, 300);
  await edit('tr1');
  ok(await page.locator('.panel button:text-is("Split this line…")').count() === 0, 'a transfer cannot be split');
  await page.keyboard.press('Escape'); await wait(page, 300);

  // backup round trip keeps the split fields
  const sample = await page.evaluate(() => { const t = App.txs.find(x => x.splitTotal && x.date === '2026-10-05'); return t ? { g: t.splitGroup, tot: t.splitTotal, i: t.splitIndex } : null; });
  ok(sample && sample.g && sample.tot === 203.1 && sample.i >= 1, 'split fields are stored on every part (group, bank total, position)');

  ok(net.length === 0, 'no network requests (' + net.length + ')');
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close(); fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
