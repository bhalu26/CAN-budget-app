/* Version 11 features: dark mode, keyboard shortcuts, command palette + quick add, Review card stack, undo everywhere,
   charts, what-if slider, click-through from Home, rules manager + test box, reordering, phone width.
   Run from the work (or our-budget) folder: node tests/features.test.js (needs Playwright) */
require('./_clock'); const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const APP = 'file://' + path.resolve(__dirname, '../index.html');
const PKG = path.resolve(__dirname, '..');
const pick = (...c) => c.find(f => fs.existsSync(f));
const SEED = pick(PKG + '/private/budget-seed.json', process.env.BUDGET_SEED || '');
const GEN = pick(PKG + '/rules/rules-general.csv', process.env.BUDGET_RULES || '');
const PERS = pick(PKG + '/private/rules-personal.csv', process.env.BUDGET_RULES_PERSONAL || '');
const SHOTS = process.argv[2];
let fails = 0;
function ok(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; }
const wait = (p, ms) => p.waitForTimeout(ms || 250);

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const shot = async n => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  const hash = () => page.evaluate(() => location.hash);
  const toast = () => page.locator('#toast').innerText().catch(() => '');
  await page.goto(APP);
  await page.setInputFiles('#seed', SEED); await page.waitForSelector('#rs-general');
  await page.setInputFiles('#rs-general', GEN); await wait(page, 400);
  await page.setInputFiles('#rs-personal', PERS); await wait(page, 400);
  await page.evaluate(async () => {
    const descs = ['SAFEWAY #4545', 'JJ BEAN COFFEE', 'MYSTERY SHOP 77', 'UBER TRIP', 'NOVUS ENTERTAINMENT'], cats = ['groceries', 'dine-out', null, 'taxi', 'utilities'];
    const l = [];
    for (let m = 1; m <= 10; m++) for (let i = 0; i < 10; i++) {
      const k = i % 5;
      l.push({ id: 'm' + m + 'i' + i, source: 'csv', direction: 'out', account: 'Visa', createdAt: '2026-' + String(m).padStart(2, '0') + '-01T00:00:00Z', flags: [], date: '2026-' + String(m).padStart(2, '0') + '-' + String(1 + i * 2).padStart(2, '0'),
        amount: 20 + i * 9 + m * 3, categoryId: cats[k], type: 'expense', desc: descs[k], note: '', needsTag: m === 10 && (k === 2 || i === 1), reviewReason: k === 2 ? 'No rule matched' : 'Suggested category' });
    }
    await DB.putTx(l); await UI.reload(); location.hash = '#/home';
  });
  await wait(page, 400);

  // ---------- dark mode ----------
  await page.evaluate(() => Theme.set('dark'));
  ok(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'dark theme applies');
  await page.reload(); await page.waitForSelector('.nav-toggle');
  ok(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'dark theme remembered after reload');
  await shot('v11-dark-home');
  await page.evaluate(() => Theme.set('light'));

  // ---------- keyboard ----------
  await page.keyboard.press('?'); await page.waitForSelector('.panel >> text=Keyboard shortcuts');
  ok(await page.locator('.panel kbd').count() > 20, '? shows the shortcut sheet');
  await page.keyboard.press('Escape');
  await page.keyboard.press('g'); await page.keyboard.press('t'); await wait(page);
  ok((await hash()) === '#/transactions', 'G then T goes to Transactions');
  await page.keyboard.press('/');
  ok(await page.evaluate(() => document.activeElement.id === 'q'), '/ focuses the search field');
  await page.keyboard.type('n'); await wait(page, 100);
  ok(!(await page.locator('.panel').count()), 'typing N in a field does not open Add expense');
  await page.keyboard.press('Escape'); await page.evaluate(() => { document.activeElement.blur(); document.getElementById('q').value = ''; document.getElementById('q').dispatchEvent(new Event('input')); });
  await page.keyboard.press('['); await wait(page);
  ok(await page.evaluate(() => App.month) === '2026-09', '[ goes to the previous month');
  await page.keyboard.press(']'); await wait(page);
  await page.keyboard.press('j'); await page.keyboard.press('j');
  const focusedRow = await page.evaluate(() => { const r = document.activeElement.closest('.tx'); return r ? [...document.querySelectorAll('.tx')].indexOf(r) : -1; });
  ok(focusedRow === 1, 'J moves to the next transaction (row ' + focusedRow + ')');
  await page.keyboard.press('k');
  ok(await page.evaluate(() => [...document.querySelectorAll('.tx')].indexOf(document.activeElement.closest('.tx'))) === 0, 'K moves back');
  await page.keyboard.press('e'); await wait(page);
  ok(await page.locator('.editor').count() === 1, 'E opens the category editor on that row');
  await page.click('.editor button:text-is("Cancel")');
  await page.keyboard.press('n'); await page.waitForSelector('.panel #amt');
  ok(await page.evaluate(() => document.activeElement.id) === 'amt', 'N opens Add expense with the amount focused');
  await page.keyboard.press('Escape');

  // ---------- palette ----------
  await page.keyboard.press('Control+k'); await page.waitForSelector('.pal');
  ok(await page.evaluate(() => document.activeElement.id) === 'pal-q', 'Ctrl+K opens the palette with focus in its search');
  await page.keyboard.type('insig'); await wait(page, 100);
  ok((await page.locator('.pal-item[aria-selected="true"]').innerText()).startsWith('Insights'), 'typing finds Insights first');
  await page.keyboard.press('Enter'); await wait(page);
  ok((await hash()) === '#/insights' && !(await page.locator('.pal').count()), 'Enter goes there and closes the palette');
  await page.keyboard.press('Control+k'); await page.keyboard.type('dine out'); await wait(page, 100);
  const firstDine = await page.locator('.pal-item').first().innerText();
  ok(/Dine out: October 2026/.test(firstDine), 'category search offers this month\'s transactions: ' + firstDine.split('\n')[0]);
  await page.keyboard.press('Escape'); await wait(page, 200);
  ok(!(await page.locator('.pal').count()), 'Esc closes the palette');
  const before = await page.evaluate(() => App.txs.length);
  await page.keyboard.press('Control+k'); await page.keyboard.type('4.75+3.50 dine out latte'); await wait(page, 100);
  ok((await page.locator('.pal-item').first().innerText()).startsWith('Add $8.25 to Dine out · latte'), 'quick add reads "4.75+3.50 dine out latte"');
  await page.keyboard.press('Enter'); await wait(page, 400);
  const added = await page.evaluate(() => App.txs.filter(t => t.desc === 'latte')[0]);
  ok(added && added.amount === 8.25 && added.categoryId === 'dine-out' && added.expr === '4.75+3.50', 'quick add saved $8.25 to Dine out with the sum kept');
  await page.click('#toast button:text-is("Undo")'); await wait(page, 300);
  ok(await page.evaluate(() => App.txs.length) === before, 'Undo removes the quick-added expense');
  await page.keyboard.press('Control+k'); await page.keyboard.type('12 zzz'); await wait(page, 100);
  ok((await page.locator('.pal-item').first().innerText()).startsWith('Add $12.00 and choose a category'), 'unknown category: offers the form instead');
  await page.keyboard.press('Enter'); await page.waitForSelector('.panel #amt');
  ok(await page.inputValue('#amt') === '12' && await page.inputValue('#desc') === 'zzz', 'the form opens pre-filled');
  await page.keyboard.press('Escape');

  // ---------- click-through from Home ----------
  await page.evaluate(() => { location.hash = '#/home'; }); await wait(page);
  await page.click('.group-head:has-text("Household")'); await wait(page);
  ok(await page.locator('.group-body .spark-svg').count() === await page.locator('.group-body a.quiet-link').count() && await page.locator('.group-body .spark-svg').count() >= 2, 'Home category rows each show a 6-month trend');
  await page.click('.group-body a:text-is("Groceries")'); await wait(page);
  ok((await hash()).includes('cat=groceries'), 'clicking a category opens its transactions');
  const cats = await page.evaluate(() => [...document.querySelectorAll('.tx button.tag')].map(b => b.textContent));
  ok(cats.length > 0 && cats.every(c => c.startsWith('Groceries')) && await page.locator('.filter-chip').count() === 1, 'Transactions shows only Groceries, with a removable filter chip');
  await page.click('.filter-chip button'); await wait(page);
  ok(await page.locator('.filter-chip').count() === 0, 'removing the chip shows all categories');

  // ---------- Review stack ----------
  await page.evaluate(() => { location.hash = '#/review'; }); await page.waitForSelector('.review-card');
  const waiting0 = await page.evaluate(() => App.txs.filter(t => t.needsTag).length);
  const first = await page.locator('.review-card').innerText();
  ok(await page.locator('.choice').count() >= 5, 'card offers numbered choices (' + await page.locator('.choice').count() + ')');
  await shot('v11-review');
  await page.keyboard.press('s'); await wait(page);
  ok((await page.locator('.review-card').innerText()) !== first || waiting0 === 1, 'S skips to the next card');
  await page.keyboard.press('3'); await wait(page, 400);
  ok(await page.evaluate(() => App.txs.filter(t => t.needsTag).length) === waiting0 - 1, '3 saves the third choice and moves on');
  ok(/→/.test(await toast()), 'confirmation shown: ' + (await toast()).split('\n')[0]);
  await page.keyboard.press('z'); await wait(page, 400);
  ok(await page.evaluate(() => App.txs.filter(t => t.needsTag).length) === waiting0, 'Z undoes it');
  const mystery = await page.evaluate(() => App.txs.filter(t => t.desc === 'MYSTERY SHOP 77').length);
  await page.evaluate(() => { const q = App.txs.filter(t => t.needsTag && t.desc === 'MYSTERY SHOP 77'); });
  // bring a MYSTERY card to the front by skipping others
  for (let i = 0; i < 6 && (await page.locator('.review-merchant').innerText()) !== 'MYSTERY SHOP 77'; i++) { await page.keyboard.press('s'); await wait(page, 150); }
  if ((await page.locator('.review-merchant').innerText()) === 'MYSTERY SHOP 77') {
    await page.keyboard.press('a'); await wait(page, 100);
    const optIdx = await page.evaluate(() => [...document.querySelectorAll('.choice')].findIndex(b => b.textContent.includes('Other household')));
    await page.keyboard.press(String(optIdx + 1)); await wait(page, 500);
    const tagged = await page.evaluate(() => App.txs.filter(t => t.desc === 'MYSTERY SHOP 77' && t.categoryId === 'other-household' && !t.needsTag).length);
    ok(tagged === mystery && await page.evaluate(() => App.cfg.rules.some(r => r.merchant === 'MYSTERY SHOP 77')), 'A + number: Always rule saved and all ' + mystery + ' MYSTERY SHOP lines updated');
  } else ok(false, 'could not reach a MYSTERY SHOP card');

  // ---------- charts + what-if ----------
  await page.evaluate(() => { location.hash = '#/insights'; }); await page.waitForSelector('.chart-col');
  ok(await page.locator('.chart-col').count() === 10, 'Insights chart: one column per month so far (10)');
  await page.locator('.chart-col').nth(2).focus(); await wait(page, 100);
  ok(/March 2026/.test(await page.locator('.chart-tip').innerText()), 'focusing a month shows its tooltip (keyboard)');
  await shot('v11-insights');
  await page.keyboard.press('Enter'); await wait(page);
  ok((await hash()).includes('m=2026-03') && await page.evaluate(() => App.month) === '2026-03', 'Enter on a month opens its transactions');
  await page.evaluate(() => { location.hash = '#/insights'; }); await page.waitForSelector('.chart-col');
  await page.click('button:text-is("Show as table")');
  ok(await page.locator('.chart-table tbody tr').count() === 10, 'the same numbers are available as a table');
  await page.click('button:text-is("Show chart")');
  await page.evaluate(() => Insights.openCategory('dine-out')); await page.waitForSelector('#wf');
  ok(await page.locator('.panel .chart-col').count() === 10, 'category panel has its own monthly chart');
  const limBefore = await page.evaluate(() => App.cfg.categories.find(c => c.id === 'dine-out').limit);
  const txt0 = await page.locator('.whatif').innerText();
  await page.locator('#wf').fill('200'); await wait(page, 100);
  const txt1 = await page.locator('.whatif').innerText();
  ok(txt0 !== txt1 && /\$200 a month/.test(txt1) && /Budget so far would be/.test(txt1), 'moving the slider updates the projection live');
  ok(await page.evaluate(() => App.cfg.categories.find(c => c.id === 'dine-out').limit) === limBefore, 'nothing saved while trying values');
  await shot('v11-whatif');
  await page.click('.whatif button:has-text("Save $200")'); await wait(page, 400);
  ok(await page.evaluate(() => App.cfg.categories.find(c => c.id === 'dine-out').limit) === 200, 'Save sets the new limit');
  await page.click('#toast button:text-is("Undo")'); await wait(page, 400);
  ok(await page.evaluate(() => App.cfg.categories.find(c => c.id === 'dine-out').limit) === limBefore, 'Undo restores the old limit (' + limBefore + ')');
  await page.keyboard.press('Escape');

  // ---------- rules manager ----------
  await page.evaluate(() => { location.hash = '#/rules?test=' + encodeURIComponent('TELUS HEALTH VIRTUAL'); }); await page.waitForSelector('.test-verdict');
  ok(/Dentist\/Massage\/Physio/.test(await page.locator('.test-verdict').innerText()), 'test box: TELUS HEALTH → Dentist/Massage/Physio');
  ok(/loses: same priority|loses: lower priority/.test(await page.locator('.test-list').first().innerText()) || await page.locator('.test-list li').count() >= 2, 'test box explains why the other rule loses');
  await shot('v11-rules');
  await page.fill('#rq', 'NOVUS'); await wait(page, 150);
  const novRows = await page.locator('.rule-row').count();
  ok(novRows >= 1, 'search finds NOVUS rules (' + novRows + ')');
  const before22 = await page.evaluate(() => M.ruleRows(App.cfg).length);
  await page.locator('.rule-row:has-text("C222") button:text-is("Turn off")').click(); await wait(page, 300);
  ok(await page.evaluate(() => M.ruleRows(App.cfg).length) === before22 - 1 && await page.evaluate(() => !M.ruleRows(App.cfg).some(r => r[0] === 'C222')), 'turning a rule off removes it from what imports use');
  await page.click('#toast button:text-is("Undo")'); await wait(page, 300);
  ok(await page.evaluate(() => M.ruleRows(App.cfg).length) === before22, 'Undo turns it back on');
  await page.locator('.rule-row:has-text("C222") button.name').click(); await page.waitForSelector('#re-pri');
  await page.fill('#re-pri', '120'); await page.click('.panel button:text-is("Save changes")'); await wait(page, 300);
  ok(await page.evaluate(() => { const s = App.cfg.ruleSets.personal; return s.rows.find(r => r[0] === 'C222')[5]; }) === '120', 'editing a rule saves into the loaded file');
  await page.click('#toast button:text-is("Undo")'); await wait(page, 300);
  ok(await page.evaluate(() => App.cfg.ruleSets.personal.rows.find(r => r[0] === 'C222')[5]) === '100', 'Undo restores the edit');
  await page.fill('#rq', ''); await wait(page, 100);
  await page.click('button:text-is("Add a rule")'); await page.waitForSelector('#re-pat');
  await page.fill('#re-pat', 'mystery shop'); await page.selectOption('#re-val', 'Other household expenses');
  ok(/Matches \d+ of your transactions/.test(await page.locator('.panel').innerText()), 'the editor shows how many transactions the rule would match');
  await page.click('.panel button:text-is("Add rule")'); await wait(page, 300);
  const added1 = await page.evaluate(() => App.cfg.ruleSets.personal.rows.find(r => r[0] === 'M001'));
  ok(added1 && added1[2] === 'MYSTERY SHOP' && added1[4] === 'Other household expenses', 'Add a rule: saved as M001 in your personal rules (cleaned pattern)');
  await page.click('button:text-is("Add a rule")'); await page.waitForSelector('#re-pat');
  await page.click('.panel button:text-is("Add rule")'); await wait(page, 150);
  ok(/Type the words to look for/.test(await page.locator('#err-pattern').innerText()), 'empty pattern: the error says what to do');
  await page.keyboard.press('Escape');

  // ---------- reorder ----------
  await page.evaluate(() => { location.hash = '#/settings'; }); await wait(page, 300);
  await page.locator('button:text-is("Change order")').first().click(); await wait(page);
  const orderBefore = await page.evaluate(() => M.groupsWithCats(App.cfg)[0].cats.map(c => c.id));
  await page.click('#ro-down-' + orderBefore[0]); await wait(page, 400);
  const orderAfter = await page.evaluate(() => M.groupsWithCats(App.cfg)[0].cats.map(c => c.id));
  ok(orderAfter[1] === orderBefore[0] && orderAfter[0] === orderBefore[1], 'Move down swaps a category with the next one');
  ok(await page.evaluate(id => document.activeElement && document.activeElement.id === 'ro-down-' + id, orderBefore[0]), 'focus stays on the moved item\'s button');
  await shot('v11-reorder');
  await page.click('#toast button:text-is("Undo")'); await wait(page, 400);
  ok(JSON.stringify(await page.evaluate(() => M.groupsWithCats(App.cfg)[0].cats.map(c => c.id))) === JSON.stringify(orderBefore), 'Undo puts the order back');
  // drag with the mouse
  if (!(await page.locator('.reorder-item').count())) { await page.locator('button:text-is("Change order")').first().click(); await wait(page); }
  const items = page.locator('.reorder-item');
  ok(await items.count() >= 3, 'Household is still being reordered (' + await items.count() + ' items)');
  await items.nth(0).dragTo(items.nth(2), { targetPosition: { x: 50, y: 40 } }); await wait(page, 400);
  const dragged = await page.evaluate(() => M.groupsWithCats(App.cfg)[0].cats.map(c => c.id));
  ok(dragged.indexOf(orderBefore[0]) === 2, 'dragging moves a category (now at position ' + (dragged.indexOf(orderBefore[0]) + 1) + ')');
  await page.evaluate(() => { location.hash = '#/home'; }); await wait(page);
  await page.click('button:text-is("Customize Home")'); await page.waitForSelector('.panel .reorder');
  const savedAt = await page.evaluate(() => [...document.querySelectorAll('.panel .reorder-item')].findIndex(li => li.dataset.id === 'saved'));
  await page.click('#ro-up-saved'); await wait(page, 400);
  ok(await page.evaluate(() => App.cfg.home.order.indexOf('saved')) === savedAt - 1, 'Customize Home: a section moves up one place');
  await page.locator('.panel .reorder-item:has-text("Accounts this month") input[type=checkbox]').uncheck(); await wait(page, 300);
  ok(await page.evaluate(() => !!App.cfg.home.hidden.accounts), 'a section can be hidden');
  await page.click('.panel button:text-is("Reset to the standard order")'); await wait(page, 300);
  ok(await page.evaluate(() => !App.cfg.home), 'Reset restores the standard Home');
  await page.keyboard.press('Escape');

  // ---------- undo: delete a transaction ----------
  await page.evaluate(() => { location.hash = '#/transactions'; }); await page.waitForSelector('.tx .name');
  const n0 = await page.evaluate(() => App.txs.length);
  await page.locator('.tx .name').first().click(); await page.waitForSelector('text=Delete this transaction');
  await page.click('text=Delete this transaction'); await page.click('.panel .toast button:text-is("Delete")'); await wait(page, 300);
  ok(await page.evaluate(() => App.txs.length) === n0 - 1, 'delete removes the transaction');
  await page.click('#toast button:text-is("Undo")'); await wait(page, 300);
  ok(await page.evaluate(() => App.txs.length) === n0, 'Undo brings it back');

  // ---------- phone width ----------
  await page.setViewportSize({ width: 375, height: 800 });
  for (const r of ['home', 'review', 'insights', 'rules', 'transactions']) {
    await page.evaluate(r => { location.hash = '#/' + r; }, r); await wait(page, 350);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(over <= 0, 'phone: no sideways scroll on ' + r + (over > 0 ? ' (' + over + 'px)' : ''));
  }
  await page.keyboard.press('Control+k'); await page.waitForSelector('.pal');
  ok(await page.evaluate(() => document.querySelector('.pal').getBoundingClientRect().right <= window.innerWidth), 'phone: the palette fits the screen');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'v11-phone-palette.png') });
  await page.keyboard.press('Escape');

  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
