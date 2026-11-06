/* Version 13 in the browser: balance check on import, Data health screen (duplicates, review, balances, odd lines), fixes with Undo, ignore.
   Run from the work (or our-budget) folder: node tests/v13.test.js (needs Playwright) */
require('./_clock'); const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const APP = 'file://' + path.resolve(__dirname, '../index.html');
const PKG = path.resolve(__dirname, '..');
const pick = (...c) => c.find(f => fs.existsSync(f));
const SEED = pick(PKG + '/private/budget-seed.json', process.env.BUDGET_SEED || '');
const GEN = pick(PKG + '/rules/rules-general.csv', process.env.BUDGET_RULES || '');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'v13-'));
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

  // ---------- H3: balance check in the import preview ----------
  const good = path.join(TMP, 'td-good-7788.csv'), bad = path.join(TMP, 'td-bad-7788.csv');
  const rows = ['10/01/2026,SAFEWAY #4545,45.10,,1200.00', '10/03/2026,NETFLIX.COM,20.99,,1179.01', '10/06/2026,TFR-TO C/C,812.40,,366.61', '10/10/2026,SAVE ON FOODS,61.25,,305.36', '10/12/2026,CRA REFUND,,425.00,730.36', '10/12/2026,SAVE ON FOODS,61.25,,669.11'];
  fs.writeFileSync(good, rows.join('\n')); fs.writeFileSync(bad, rows.filter((r, i) => i !== 2).join('\n'));
  await page.evaluate(() => { location.hash = '#/import'; }); await page.waitForSelector('#csvf');
  await page.setInputFiles('#csvf', bad); await wait(page, 500);
  if (await page.locator('section .toast.warn button.primary').count()) await page.locator('section .toast.warn button.primary').first().click();
  else { await page.selectOption('#acct', '__new'); await page.fill('#an', 'TD chequing'); await page.selectOption('#ak', 'bank'); await page.click('button:text-is("Add account")'); }
  await wait(page, 400);
  let txt = await page.locator('main').innerText();
  ok(/Balance check: the lines do not add up on 1 day/.test(txt) && /Oct 10/.test(txt) && /\$812\.40 unexplained/.test(txt), 'a file with a missing line says where: Oct 10, $812.40 unexplained');
  ok(await page.locator('[role=alert]:has-text("Balance check")').count() === 1, 'the warning is announced to screen readers (role=alert)');
  await page.click('button:text-is("Close file")'); await wait(page, 300);
  await page.setInputFiles('#csvf', good); await wait(page, 500);
  await page.locator('[role=tablist][aria-label=Files] button:has-text("td-good")').click().catch(() => {}); await wait(page, 300);
  txt = await page.locator('main').innerText();
  ok(/Balance check passed: 6 lines over 5 days/.test(txt), 'the complete file passes: "Balance check passed: 6 lines over 5 days"');
  await page.click('button:has-text("Import all")').catch(async () => { await page.locator('button.primary:has-text("Import")').first().click(); });
  await wait(page, 600);
  ok(await page.evaluate(() => App.cfg.batches.some(b => b.recon && b.recon.days === 5 && b.recon.breaks === 0)), 'the import records its balance check on the batch');
  // the next statement starts $50 away from where this one ended
  const next = path.join(TMP, 'td-next-7788.csv');
  fs.writeFileSync(next, ['10/20/2026,SAFEWAY #4545,40.00,,579.11', '10/21/2026,NETFLIX.COM,20.99,,558.12', '10/22/2026,JJ BEAN COFFEE,5.00,,553.12', '10/23/2026,SAVE ON FOODS,10.00,,543.12', '10/24/2026,SAFEWAY #4545,8.00,,535.12'].join('\n'));
  await page.setInputFiles('#csvf', next); await wait(page, 600);
  await page.locator('[role=tablist][aria-label=Files] button:has-text("td-next")').click().catch(() => {}); await wait(page, 300);
  txt = await page.locator('main').innerText();
  ok(/This file starts at \$619\.11, but your last recorded balance was \$669\.11/.test(txt), 'next file starting $50 away from the last balance: "Lines between ... may be missing"');
  // the same statement loaded twice in one go (under two names) is imported once
  await page.click('button:text-is("Close file")'); await wait(page, 300);
  const ov1 = path.join(TMP, 'td-nov-a-7788.csv'), ov2 = path.join(TMP, 'td-nov-b-7788.csv');
  const nov = ['11/02/2026,SAFEWAY #4545,31.10', '11/03/2026,JJ BEAN COFFEE,5.25', '11/04/2026,SAVE ON FOODS,52.00'];
  fs.writeFileSync(ov1, nov.join('\n')); fs.writeFileSync(ov2, nov.concat(['11/05/2026,NETFLIX.COM,20.99']).join('\n'));
  await page.setInputFiles('#csvf', [ov1, ov2]); await wait(page, 700);
  const ov = await page.evaluate(() => Importer._files().filter(f => /td-nov/.test(f.name)).map(f => ({ n: f.name, acct: !!f.accountId, st: f.items.map(i => i.state) })));
  ok(ov.length === 2 && ov[0].acct && ov[1].acct, 'two files for the same account are loaded together (' + JSON.stringify(ov) + ')');
  ok(ov[0].st.every(x => x !== 'dup') && ov[1].st.filter(x => x === 'dup').length === 3 && ov[1].st.filter(x => x !== 'dup').length === 1, 'the second file\'s three repeated lines are marked as duplicates; only its new line is importable');
  await page.evaluate(() => { const fs = Importer._files(); for (let i = fs.length - 1; i >= 0; i--) if (/td-nov/.test(fs[i].name)) fs.splice(i, 1); });
  await page.evaluate(() => { location.hash = '#/home'; }); await wait(page, 300);

  // ---------- H4: Data health ----------
  await page.evaluate(async () => {
    const mk = (o) => Object.assign({ id: U.uid(), source: 'csv', direction: 'out', type: 'expense', categoryId: 'groceries', flags: [], createdAt: '2026-10-01T00:00:00Z' }, o);
    await DB.putTx([
      mk({ date: '2026-10-05', amount: 84.2, desc: 'COSTCO WHOLESALE 123', batchId: 'bA', file: 'a.csv' }), mk({ date: '2026-10-05', amount: 84.2, desc: 'COSTCO WHOLESALE 123', batchId: 'bB', file: 'b.csv' }),
      mk({ date: '2026-10-08', amount: 60, desc: 'E-TRANSFER SENT JOHN', categoryId: null, needsTag: true, batchId: 'bA' }),
      mk({ date: '2026-10-09', amount: 0, desc: 'ZERO LINE', batchId: 'bA' })]);
    await UI.reload();
  });
  const sum = await page.evaluate(() => { const r = HealthUI.summary(); return { high: r.high, kinds: r.open.map(i => i.kind).sort() }; });
  ok(sum.kinds.includes('duplicate') && sum.kinds.includes('review') && sum.kinds.includes('odd'), 'summary finds the duplicate, the unconfirmed e-Transfer and the $0 line (' + sum.kinds.join(', ') + ')');
  await page.evaluate(() => { location.hash = '#/home'; App.render(); }); await wait(page, 300);
  ok(/to check in Data health/.test(await page.locator('main header').innerText()), 'Home shows "N to check in Data health"');
  ok(await page.locator('#nav-links a:has-text("Data health") .badge').count() === 1, 'the menu item carries a count badge');
  await page.keyboard.press('g'); await page.keyboard.press('d'); await wait(page, 400);
  ok(await page.evaluate(() => location.hash === '#/health'), 'G D opens Data health');
  ok(/things? to check/.test(await page.locator('main h1').innerText()), 'heading counts the open items');
  const checked = await page.locator('#hl-checked').locator('xpath=..').innerText();
  ok(/Possible duplicates/.test(checked) && /Balances against transactions/.test(checked), 'the "What is checked" list names every check');
  const dupCard = page.locator('article:has-text("COSTCO")').first();
  ok(/In two different imports/.test(await dupCard.innerText()) && /possibly counted twice/.test(await dupCard.innerText()), 'duplicate card: why it was flagged and the amount at stake');
  ok(await dupCard.locator('li.hl-tx').count() === 2, 'duplicate card lists both lines');
  ok(/affects your numbers/i.test(await dupCard.innerText()), 'severity is a word, not just a colour');
  const revCard = page.locator('article:has-text("waiting for review")').first();
  ok(/counted as spending until you confirm/.test(await revCard.innerText()), 'review card says the e-Transfer is counted as spending until confirmed');
  // delete one copy with confirmation and Undo
  const before = await page.evaluate(() => App.txs.length);
  await dupCard.locator('button:has-text("Delete this one")').first().click(); await wait(page, 200);
  ok(/The other copy stays/.test(await page.locator('.hl-confirm').innerText()), 'delete asks first and names what happens');
  await page.locator('.hl-confirm button:text-is("Keep it")').click(); await wait(page, 200);
  ok(await page.evaluate(() => App.txs.length) === before, 'Keep it: nothing deleted');
  await dupCard.locator('button:has-text("Delete this one")').first().click(); await wait(page, 200);
  await page.locator('.hl-confirm button:text-is("Delete")').click(); await wait(page, 500);
  ok(await page.evaluate(() => App.txs.length) === before - 1 && await page.locator('article:has-text("COSTCO")').count() === 0, 'deleting one copy clears the duplicate card');
  await page.click('#toast button:text-is("Undo")'); await wait(page, 500);
  ok(await page.evaluate(() => App.txs.length) === before && await page.locator('article:has-text("COSTCO")').count() === 1, 'Undo brings the line and the flag back');
  // ignore and restore
  await page.locator('article:has-text("COSTCO") button:text-is("Not a duplicate: keep all")').click(); await wait(page, 500);
  ok(await page.locator('article:has-text("COSTCO")').count() === 0 && await page.evaluate(() => App.cfg.healthIgnore.length === 1), 'Not a duplicate: it leaves the list and is remembered');
  await page.click('button:has-text("Show ignored (1)")'); await wait(page, 300);
  ok(await page.locator('article.hl-off:has-text("COSTCO")').count() === 1, 'it is still visible under Ignored');
  await page.locator('article.hl-off button:text-is("Stop ignoring")').click(); await wait(page, 500);
  ok(await page.evaluate(() => App.cfg.healthIgnore.length === 0), 'Stop ignoring puts it back');
  // edit a flagged line from the card
  await page.locator('article:has-text("Zero amount") button:has-text("Edit")').first().click(); await page.waitForSelector('#amt');
  await page.fill('#amt', '9.99'); await page.click('button:text-is("Save changes")'); await wait(page, 500);
  ok(await page.locator('article:has-text("Zero amount")').count() === 0, 'fixing the $0 line from its card clears the flag');

  // balances that do not add up
  await page.evaluate(async () => {
    const a = App.cfg.accounts.find(x => /TD/.test(x.name)); a.balances = Accounts.setBalance(a, '2026-10-31', 400, 'manual'); await UI.saveCfg(); App.render();
  }); await wait(page, 400);
  const bal = page.locator('article:has-text("balances and transactions do not add up")');
  ok(await bal.count() === 1 && /unexplained/.test(await bal.innerText()), 'a typed balance that the lines cannot explain is flagged as unexplained');
  await page.evaluate(() => { location.hash = '#/accounts'; }); await wait(page, 400);
  ok(await page.locator('.acct-row :text("do not add up")').count() >= 1, 'the Accounts row warns too');
  await page.evaluate(async () => { const a = App.cfg.accounts.find(x => /TD/.test(x.name)); a.balances = a.balances.filter(b => b.date !== '2026-10-31'); await UI.saveCfg(); App.render(); }); await wait(page, 300);
  ok(await page.evaluate(() => !HealthUI.summary().open.some(i => i.kind === 'balance')), 'removing that balance clears it');

  ok(net.length === 0, 'no network requests (' + net.length + ')');
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close(); fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
