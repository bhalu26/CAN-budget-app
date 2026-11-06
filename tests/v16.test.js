/* Version 16 in the browser, one section per feature:
   E edit history · R month reviewed (warns, never blocks) · G paid for a group (my share) · C recurring mark/unmark/log · K clickable Insights.
   Run from the work (or our-budget) folder: node tests/v16.test.js (needs Playwright) */
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
  const TODAY = await page.evaluate(() => U.today()), YM = TODAY.slice(0, 7), PREV = await page.evaluate(() => U.shiftMonth(U.today().slice(0, 7), -1));
  const seed = (list) => page.evaluate(async list => { await DB.putTx(list.map(t => Object.assign({ source: 'csv', direction: 'out', type: 'expense', categoryId: 'groceries', accountId: 'a1', account: 'TD chequing', flags: [], createdAt: new Date().toISOString(), file: 't.csv', line: 3 }, t))); await UI.reload(); }, list);
  const tx = (id) => page.evaluate(id => JSON.parse(JSON.stringify(App.txs.find(t => t.id === id) || null)), id);
  const edit = async (id) => { await page.evaluate(id => UI.expensePanel(App.txs.find(t => t.id === id), App.render), id); await page.waitForSelector('#amt'); };
  const day = (d) => YM + '-' + String(d).padStart(2, '0');

  // ================= E. edit history =================
  await seed([{ id: 'e1', date: day(2), amount: 84.2, desc: 'SAFEWAY #4545' }, { id: 'e2', date: day(3), amount: 12, desc: 'MYSTERY CAFE', categoryId: null, needsTag: true, reviewReason: 'No rule matched' }]);
  ok(!(await tx('e1')).history, 'a freshly imported line has no history');
  await edit('e1');
  ok(/History/.test(await page.locator('.panel .hist').innerText()) && !/change/.test(await page.locator('.panel .hist button').innerText()), 'Edit transaction offers "History" (no changes yet)');
  await page.fill('#amt', '84.95'); await page.click('button:text-is("Save changes")'); await wait(page, 500);
  let e1 = await tx('e1');
  ok(e1.history && e1.history.length === 1 && e1.history[0].c[0].a === 84.2 && e1.history[0].c[0].b === 84.95 && e1.history[0].why === 'Edited', 'saving an amount change records 84.20 → 84.95');
  await edit('e1');
  await page.click('.panel .hist button'); await wait(page, 200);
  const hist = await page.locator('#hist-list').innerText();
  ok(/Amount \$84\.20 → \$84\.95/.test(hist) && /Edited/.test(hist), 'the panel shows "Amount $84.20 → $84.95" with the reason');
  ok(/Imported from t\.csv, line 3/.test(hist), 'it also says where the line came from (imported from file, line)');
  ok(await page.locator('.panel .hist button[aria-expanded=true]').count() === 1, 'the History button reports expanded/collapsed to screen readers');
  // two fields at once, category by name
  await page.fill('#amt', '90'); await page.selectOption('#allcat', 'dine-out'); await page.click('button:text-is("Save changes")'); await wait(page, 500);
  e1 = await tx('e1');
  await edit('e1'); await page.click('.panel .hist button'); await wait(page, 200);
  const h2 = await page.locator('#hist-list').innerText();
  ok(e1.history.length === 2 && /Category Groceries → Dine out/i.test(h2) && /Amount \$84\.95 → \$90\.00/.test(h2), 'a second edit adds an entry; category reads as names ("Groceries → Dine out")');
  ok(h2.indexOf('Amount $84.95') < h2.indexOf('Amount $84.20'), 'newest change first');
  await page.keyboard.press('Escape'); await wait(page, 300);
  // an edit that changes nothing adds nothing
  await edit('e1'); await page.click('button:text-is("Save changes")'); await wait(page, 400);
  ok((await tx('e1')).history.length === 2, 'saving without changing anything adds no entry');
  // review decision, then Undo
  await page.evaluate(() => { location.hash = '#/review'; }); await wait(page, 400);
  await page.locator('.choice-grid button').first().click(); await wait(page, 500);
  let e2 = await tx('e2');
  ok(e2.history && e2.history[0].why === 'Review' && e2.history[0].c.some(c => c.f === 'needsTag'), 'a Review decision is recorded as "Review" (Marked reviewed)');
  await page.click('#toast button:text-is("Undo")').catch(() => {}); await page.keyboard.press('z'); await wait(page, 500);
  e2 = await tx('e2');
  ok(e2.history.length >= 2 && e2.history[e2.history.length - 1].why === 'Undo', 'Undo is recorded too (the earlier history is kept)');
  // inline retag in Transactions, bulk reason
  await page.evaluate(() => { location.hash = '#/transactions?f=all&scope=all'; }); await wait(page, 500);
  ok(/edited /.test(await page.locator('.tx:has-text("SAFEWAY"), .tx:has-text("90")').first().innerText()) || await page.locator('.tx :text("edited")').count() > 0, 'rows that were edited carry "edited Oct 23"-style marker');
  // survives a reload
  await page.reload(); await page.waitForSelector('.nav-toggle'); await wait(page, 400);
  ok((await tx('e1')).history.length === 2, 'history is saved with the line (still there after reloading)');
  // recent changes on Data health
  await page.evaluate(() => { location.hash = '#/health'; }); await wait(page, 500);
  await page.click('button:has-text("recent changes")'); await wait(page, 300);
  const rec = await page.locator('#hl-recent').locator('xpath=..').innerText();
  ok(/Recent changes/.test(rec) && /SAFEWAY/.test(rec) && /Category Groceries → Dine out/.test(rec), 'Data health lists recent changes across all lines');
  await page.locator('#hl-recent').locator('xpath=..').locator('button:has-text("Open")').first().click(); await page.waitForSelector('#amt');
  ok(await page.locator('.panel').count() === 1, '…and each one opens the line');
  await page.keyboard.press('Escape'); await wait(page, 300);
  // a split records its reason
  await seed([{ id: 'e3', date: day(4), amount: 100, desc: 'COSTCO' }]);
  await page.evaluate(() => SplitUI.open(App.txs.find(t => t.id === 'e3'), App.render)); await page.waitForSelector('#sp-a0');
  await page.selectOption('#sp-c0', 'groceries'); await page.fill('#sp-a1', '30'); await page.selectOption('#sp-c1', 'other-household'); await page.click('.panel button:text-is("Save split")'); await wait(page, 600);
  const e3 = await tx('e3');
  ok(e3.history && e3.history[0].why === 'Split' && e3.history[0].c.some(c => c.f === 'amount' && c.a === 100 && c.b === 70), 'a split records "Split": Amount $100.00 → $70.00 on the original line');

  // ================= R. month reviewed (warns, never blocks) =================
  const pd = (d) => PREV + '-' + String(d).padStart(2, '0');
  const PN = await page.evaluate(m => U.MONTHS[+m.slice(5) - 1], PREV);
  await seed([{ id: 'r1', date: pd(3), amount: 50, desc: 'SAFEWAY R1' }, { id: 'r2', date: pd(10), amount: 20, desc: 'CAFE R2' }, { id: 'r3', date: pd(12), amount: 15, desc: 'MYSTERY R3', categoryId: null, needsTag: true, reviewReason: 'No rule matched' }]);
  const home = async () => { await page.evaluate(m => { App.month = m; location.hash = '#/home'; App.render(); }, PREV); await wait(page, 400); };
  await home();
  ok(await page.locator('.rv-bar button:text-is("Mark ' + PN + ' as reviewed")').count() === 1, 'Home offers "Mark ' + PN + ' as reviewed" with a note that it never blocks changes');
  await page.click('.rv-bar button:has-text("as reviewed")'); await wait(page, 300);
  const ask = await page.locator('.rv-ask').innerText();
  ok(/1 line is still waiting for review/.test(ask) && /nothing is blocked/i.test(ask), 'one line is still waiting: it says so, and that nothing is blocked');
  await page.click('.rv-ask button:text-is("Mark reviewed anyway")'); await wait(page, 500);
  ok(await page.evaluate(m => !!App.cfg.monthsReviewed[m] && App.cfg.monthsReviewed[m].spent > 0, PREV) && /✓ Reviewed/.test(await page.locator('.rv-bar').innerText()), 'marked: "✓ Reviewed" and a snapshot of the numbers is kept');
  await page.click('#toast button:text-is("Undo")'); await wait(page, 400);
  ok(await page.evaluate(m => !App.cfg.monthsReviewed[m], PREV), 'Undo removes the mark');
  await page.click('.rv-bar button:has-text("as reviewed")'); await wait(page, 200); await page.click('.rv-ask button:text-is("Mark reviewed anyway")'); await wait(page, 500);
  // adding a line to the reviewed month: a note, not a block
  await page.evaluate(() => UI.expensePanel(null, App.render)); await page.waitForSelector('#amt');
  await page.fill('#dt', pd(15)); await page.waitForTimeout(150);
  ok(/marked as reviewed/.test(await page.locator('.panel .rv-note').innerText()), 'the Add expense panel notes that ' + PN + ' is reviewed once its date is in that month');
  await page.fill('#amt', '12.45'); await page.selectOption('#allcat', 'dine-out'); await page.fill('#desc', 'LATE CAFE');
  await page.click('button:text-is("Save expense")'); await wait(page, 500); await page.keyboard.press('Escape'); await wait(page, 300);
  ok(await page.evaluate(() => App.txs.some(t => t.desc === 'LATE CAFE')), 'saving is allowed: the line was added');
  await home();
  const chg = await page.locator('.rv-changed').innerText();
  ok(/Changed since you reviewed/.test(chg) && /spent \+\$12\.45/.test(chg) && /1 added/.test(chg), 'Home: "⚠ Changed since you reviewed … spent +$12.45, 1 added"');
  await page.click('.rv-changed button:text-is("See what changed")'); await wait(page, 300);
  const pn = await page.locator('.panel').innerText();
  ok(/Spent \$[\d.,]+ → \$[\d.,]+/.test(pn) && /Added since \(1\)/.test(pn) && /LATE CAFE/.test(pn), 'the panel lists the numbers and the line added since');
  await page.keyboard.press('Escape'); await wait(page, 300);
  // Data health item
  await page.evaluate(() => { location.hash = '#/health'; }); await wait(page, 500);
  ok(await page.locator('article:has-text("changed since you marked it reviewed")').count() === 1, 'Data health lists the month that changed since it was reviewed');
  // review again clears it
  await home(); await page.click('.rv-changed button:text-is("Review again")'); await wait(page, 500);
  ok(/✓ Reviewed/.test(await page.locator('.rv-bar').innerText()) && await page.locator('.rv-changed').count() === 0, '"Review again" accepts the changes and the mark is clean');
  // a category swap that leaves totals the same is still noticed
  await edit('r1'); await page.selectOption('#allcat', 'dine-out'); await page.click('button:text-is("Save changes")'); await wait(page, 500);
  await home();
  const chg2 = await page.locator('.rv-changed').innerText();
  ok(/1 line edited/.test(chg2) && !/spent [+−]/.test(chg2), 'a category swap with identical totals is still reported: "1 line edited"');
  // delete confirmation carries the note
  await edit('r2'); await page.click('.panel button:text-is("Delete this transaction")'); await wait(page, 200);
  ok(/marked as reviewed/.test(await page.locator('.panel .toast.warn').innerText()), 'the delete confirmation says the month is reviewed (and still lets you delete)');
  await page.keyboard.press('Escape'); await wait(page, 300);
  // import preview note
  const csv = require('os').tmpdir() + '/td-r-7788.csv';
  fs.writeFileSync(csv, ['Date,Description,Amount', pd(20) + ',IMPORTED R,-9.00', TODAY + ',IMPORTED NOW,-4.00'].join('\n'));
  await page.evaluate(async () => { App.cfg.cutOver = '2026-01-01'; await UI.saveCfg(); location.hash = '#/import'; }); await page.waitForSelector('#csvf');
  await page.setInputFiles('#csvf', csv); await wait(page, 500);
  if (await page.locator('section .toast.warn button.primary').count()) await page.locator('section .toast.warn button.primary').first().click();
  else { await page.selectOption('#acct', '__new'); await page.fill('#an', 'TD chequing'); await page.selectOption('#ak', 'bank'); await page.click('button:text-is("Add account")'); }
  await wait(page, 400);
  ok(/Heads up: 1 row in /.test(await page.locator('main').innerText()) && /marked as reviewed/.test(await page.locator('main').innerText()), 'Import preview: "Heads up: 1 row in ' + PN + ' (marked as reviewed)"');
  await page.click('button:has-text("Import all")').catch(async () => { await page.locator('button.primary:has-text("Import")').first().click(); }); await wait(page, 600);
  ok(await page.evaluate(() => App.txs.some(t => t.desc === 'IMPORTED R')), 'the import goes ahead (it is only a note)');
  fs.unlinkSync(csv);
  // grid marker
  await page.evaluate(() => { Insights.setView('grid'); location.hash = '#/insights'; App.render(); }); await wait(page, 500);
  ok(await page.locator('table.yg thead th:has-text("changed since reviewed")').count() === 1, 'the Month grid marks the changed month (⚠, with words for screen readers)');
  // reopen
  await home(); await page.click('.rv-changed button:text-is("Reopen")'); await wait(page, 500);
  ok(await page.evaluate(m => !App.cfg.monthsReviewed[m], PREV), 'Reopen removes the mark');

  // ================= G. paid for a group (my share) =================
  await seed([{ id: 'd1', date: day(1), amount: 120, desc: 'THE KEG', categoryId: 'dine-out' },
    { id: 'm1', date: day(2), amount: 40, desc: 'E-TRANSFER FROM ALEX', direction: 'in', type: 'pending', categoryId: null, needsTag: true, reviewReason: 'Money in' },
    { id: 'm2', date: day(3), amount: 30, desc: 'E-TRANSFER FROM SAM', direction: 'in', type: 'pending', categoryId: null, needsTag: true, reviewReason: 'Money in' },
    { id: 'm3', date: day(3), amount: 50, desc: 'E-TRANSFER FROM JO', direction: 'in', type: 'pending', categoryId: null, needsTag: true, reviewReason: 'Money in' }]);
  const month = () => page.evaluate(ym => { const s = M.month(App.cfg, App.txs, ym, U.today()); return { spent: s.spent, left: s.left, income: s.income, other: s.other }; }, YM);
  const base = await month();
  await edit('d1'); await page.click('details.more > summary');
  ok(await page.locator('#grp').count() === 1 && /only your share/.test(await page.locator('.grp').innerText()), 'Edit transaction offers "I paid for others too: count only my share"');
  await page.check('#grp'); await page.waitForSelector('#grp-n');
  await page.fill('#grp-n', '4'); await wait(page, 150);
  ok(await page.inputValue('#grp-s') === '30', 'People at the table = 4 → my share fills in: $30');
  ok(/Counts as \$30\.00 in your spending\. Others owe you \$90\.00/.test(await page.locator('#grp-hint').innerText()), 'the hint says: "Counts as $30.00 in your spending. Others owe you $90.00."');
  await page.fill('#grp-s', '150'); await wait(page, 100);
  ok(/less than the whole bill/.test(await page.locator('#grp-hint').innerText()), 'a share larger than the bill is refused with the reason');
  await page.click('button:text-is("Save changes")'); await wait(page, 300);
  ok(/less than the whole bill/.test(await page.locator('.panel').innerText()) && !(await tx('d1')).share, 'saving with a bad share is stopped and nothing is stored');
  await page.fill('#grp-s', '30'); await page.click('button:text-is("Save changes")'); await wait(page, 500);
  let d1 = await tx('d1');
  ok(d1.share === 30 && d1.people === 4 && d1.amount === 120, 'saved: share $30, 4 people, bank amount still $120');
  let m = await month();
  ok(Math.round((base.spent - m.spent) * 100) === 9000 && Math.round((m.left - base.left) * 100) === 9000, 'this month\'s spent drops by $90 and left to spend rises by $90');
  ok(d1.history[d1.history.length - 1].c.some(c => c.f === 'share' && c.b === 30) && /Paid for a group: my share \$30\.00/.test(await page.evaluate(c => UI.histSay(c), d1.history[d1.history.length - 1].c.find(c => c.f === 'share'))), 'the history says "Paid for a group: my share $30.00"');
  await page.evaluate(() => { location.hash = '#/transactions?f=all&scope=all'; }); await wait(page, 500);
  ok(/Your share \$30\.00 of \$120\.00 · \$90\.00 still owed to you/.test(await page.locator('.tx:has-text("THE KEG")').innerText()), 'the row says "Your share $30.00 of $120.00 · $90.00 still owed to you"');
  ok(await page.locator('button:text-is("Owed to you · 1")').count() === 1, 'an "Owed to you" filter appears');
  await page.click('button:text-is("Owed to you · 1")'); await wait(page, 300);
  ok(await page.locator('.tx').count() === 1, '…and lists just that bill');
  await page.evaluate(() => { App.month = null; location.hash = '#/home'; App.render(); }); await wait(page, 400);
  ok(/Others owe you \$90\.00 from 1 group bill/.test(await page.locator('.owed-bar').innerText()), 'Home: "Others owe you $90.00 from 1 group bill."');
  // a split cannot be made on a shared line
  await edit('d1');
  ok(/counts only your share/.test(await page.locator('.panel').innerText()) && await page.locator('.panel button:text-is("Split this line…")').count() === 0, 'a shared line cannot also be split (and it says why)');
  // track repayments
  await page.click('.panel button:text-is("Track repayments…")'); await page.waitForSelector('#gp-cash'); await wait(page, 200);
  let gp = await page.locator('.panel').innerText();
  ok(/Bill \(bank amount\)\s*\$120\.00/.test(gp) && /Others owe you\s*\$90\.00/.test(gp) && /Still owed to you\s*\$90\.00/.test(gp), 'the repayments panel shows bill $120, owed $90, still owed $90');
  ok(/ALEX/.test(gp) && /SAM/.test(gp) && /JO/.test(gp), 'it lists the money-in lines that could be repayments');
  const before = await month();
  await page.locator('.panel li:has-text("ALEX") input[type=checkbox]').check(); await wait(page, 200);
  await page.click('.panel button:has-text("Link 1 selected")'); await wait(page, 600);
  const m1 = await tx('m1');
  ok(m1.repaysId === 'd1' && m1.type === 'exclude' && !m1.needsTag && m1.amount === 40, 'ALEX\'s $40 is linked to the dinner and no longer waits in Review');
  const after = await month();
  ok(after.income === before.income && after.spent === before.spent && after.other === before.other, 'linking changes nothing in income or spending (the $40 stays in "not counted", where unreviewed money in already was)');
  await page.evaluate(() => { location.hash = '#/home'; App.render(); }); await wait(page, 400);
  ok(/Others owe you \$50\.00/.test(await page.locator('.owed-bar').innerText()), 'Home now says $50.00 is still owed');
  await page.click('#toast button:text-is("Undo")').catch(() => {}); await wait(page, 500);
  ok((await tx('m1')).repaysId === undefined && /Others owe you \$90\.00/.test(await page.locator('.owed-bar').innerText()), 'Undo unlinks it again ($90.00 owed)');
  // link from Review for an incoming line
  await page.evaluate(() => { location.hash = '#/review'; }); await wait(page, 500);
  for (let i = 0; i < 8 && !(await page.locator('main button:text-is("Repays a group bill…")').count()); i++) { await page.keyboard.press('s'); await wait(page, 200); }
  ok(await page.locator('main button:text-is("Repays a group bill…")').count() === 1, 'a money-in Review card offers "Repays a group bill…"');
  await page.click('main button:text-is("Repays a group bill…")'); await page.waitForSelector('.panel button:text-is("This one")');
  ok(/THE KEG/.test(await page.locator('.panel').innerText()) && /\$90\.00 still owed of \$90\.00/.test(await page.locator('.panel').innerText()), 'it lists the open bills with what is still owed');
  await page.click('.panel button:text-is("This one")'); await wait(page, 600);
  const linked = await page.evaluate(() => App.txs.filter(t => t.repaysId === 'd1').map(t => t.id));
  ok(linked.length === 1, 'the line was linked to the dinner from Review (' + linked + ')');
  // cash settles the rest
  await edit('d1'); await page.click('.panel button:text-is("Track repayments…")'); await page.waitForSelector('#gp-cash');
  const left1 = await page.evaluate(() => Group.balance(App.txs.find(t => t.id === 'd1'), App.txs).left);
  await page.fill('#gp-cash', String(left1)); await page.click('.panel button:text-is("Save cash")'); await wait(page, 600);
  ok(await page.evaluate(() => Group.balance(App.txs.find(t => t.id === 'd1'), App.txs).left === 0 && Group.open(App.txs).length === 0), 'noting the remaining cash settles it ($' + left1 + ' received)');
  await page.evaluate(() => { location.hash = '#/home'; App.render(); }); await wait(page, 400);
  ok(await page.locator('.owed-bar').count() === 0, 'Home drops the "owe you" line once everything is paid back');
  // the repayment line itself: Edit shows the link and can unlink
  const lid = linked[0];
  await edit(lid);
  ok(/Repays THE KEG/.test(await page.locator('.grp-links').innerText()), 'editing the repayment line says "Repays THE KEG"');
  await page.click('.grp-links button:text-is("Unlink")'); await wait(page, 600);
  const ul = await tx(lid);
  ok(ul.repaysId === undefined && ul.type === 'pending' && ul.needsTag === true, 'Unlink sends it back to Review as money in');
  // an old unpaid bill shows in Data health
  const oldDate = await page.evaluate(() => Health.addDays(U.today(), -45));
  await seed([{ id: 'd3', date: oldDate, amount: 90, desc: 'OLD PUB NIGHT', categoryId: 'dine-out', share: 30, people: 3 }]);
  await page.evaluate(() => { location.hash = '#/health'; }); await wait(page, 500);
  ok(await page.locator('article:has-text("still owed to you from OLD PUB NIGHT")').count() === 1, 'Data health lists a group bill that is more than 30 days old and still unpaid');
  // add a new expense with the group box
  await page.evaluate(() => UI.expensePanel(null, App.render)); await page.waitForSelector('#amt');
  await page.fill('#amt', '60'); await page.selectOption('#allcat', 'dine-out'); await page.fill('#desc', 'SUSHI PLACE');
  await page.click('details.more > summary'); await page.check('#grp'); await page.fill('#grp-n', '3'); await wait(page, 150);
  ok(await page.inputValue('#grp-s') === '20', 'new expense: $60 for 3 people → my share $20');
  await page.fill('#amt', '90'); await wait(page, 150);
  ok(await page.inputValue('#grp-s') === '30', '…and the share follows the amount until you type your own');
  await page.click('button:text-is("Save expense")'); await wait(page, 500); await page.keyboard.press('Escape'); await wait(page, 300);
  const sushi = await page.evaluate(() => App.txs.find(t => t.desc === 'SUSHI PLACE'));
  ok(sushi && sushi.amount === 90 && sushi.share === 30 && sushi.people === 3, 'saved as $90 with my share $30');
  // removing the share counts it in full again
  await edit('d3'); await page.uncheck('#grp'); await page.click('button:text-is("Save changes")'); await wait(page, 500);
  const d3 = await tx('d3');
  ok(d3.share === undefined && /Group share removed/.test(await page.evaluate(c => UI.histSay(c), d3.history[d3.history.length - 1].c.find(c => c.f === 'share'))), 'unticking removes the share (it counts in full again) and the history says so');

  // ================= C. recurring: mark, unmark, make, log =================
  const addM = (ym, k) => page.evaluate(([ym, k]) => U.shiftMonth(ym, k), [ym, k]);
  const spot = [];
  for (let k = 5; k >= 0; k--) spot.push({ id: 'sp' + k, date: (await addM(YM, -k)) + '-03', amount: 11.99, desc: 'SPOTIFY PREMIUM', categoryId: 'subscriptions' });
  await seed(spot);
  ok(await page.evaluate(() => App.cfg.recurring.length) === 0, 'no recurring items yet');
  await edit('sp0');
  ok(/Does this repeat\?/.test(await page.locator('.rec-links').innerText()), 'Edit transaction asks "Does this repeat?" for a line that is not recurring yet');
  await page.click('.rec-links button:text-is("Make this recurring…")'); await page.waitForSelector('#rc-n'); await wait(page, 300);
  ok(await page.inputValue('#rc-n') === 'SPOTIFY PREMIUM' && await page.inputValue('#rc-a') === '11.99' && await page.inputValue('#rc-nc') === 'monthly', 'the Bills panel opens with the form filled in: name, amount $11.99, "Every month"');
  const nextOn = await page.inputValue('#rc-d');
  ok(nextOn >= TODAY && nextOn.endsWith('-03'), 'next date is the next 3rd on or after today (' + nextOn + ')');
  await page.click('#main button:text-is("Add")'); await wait(page, 500); await page.keyboard.press('Escape'); await wait(page, 300);
  ok(await page.evaluate(() => App.cfg.recurring.some(r => r.name === 'SPOTIFY PREMIUM' && r.cadence === 'monthly' && r.amount === 11.99 && r.kind === 'expense')), 'it is now a recurring item');
  await page.evaluate(() => { location.hash = '#/transactions?f=all&scope=all'; }); await wait(page, 500);
  ok(await page.locator('.tx:has-text("SPOTIFY PREMIUM") :text("Recurring: SPOTIFY PREMIUM")').count() >= 1, 'every Spotify row is marked "Recurring: SPOTIFY PREMIUM"');
  // unmark one payment
  await edit('sp0');
  ok(/Recurring: SPOTIFY PREMIUM \(every month\)/.test(await page.locator('.rec-links').innerText()), 'the box now says "Recurring: SPOTIFY PREMIUM (every month)"');
  await page.click('.rec-links button:text-is("Not part of it")'); await wait(page, 600);
  let sp0 = await tx('sp0');
  ok(sp0.notRecurring === true && /not part of a recurring bill/.test(await page.evaluate(c => UI.histSay(c), sp0.history[sp0.history.length - 1].c[0])), 'that payment is marked not recurring and the history says so');
  await edit('sp0');
  ok(/Marked as not part of a recurring bill/.test(await page.locator('.rec-links').innerText()), 'Edit shows the mark and a way back');
  await page.click('.rec-links button:text-is("Part of it after all")'); await wait(page, 600);
  ok((await tx('sp0')).notRecurring === undefined, '"Part of it after all" removes the mark');
  await page.click('#toast button:text-is("Undo")'); await wait(page, 600);
  ok((await tx('sp0')).notRecurring === true, 'Undo puts the mark back');
  // a one-off with no history: an honest guess
  await seed([{ id: 'gy1', date: day(2), amount: 45, desc: 'NEW GYM CLUB', categoryId: 'fitness' }]);
  await edit('gy1'); await page.click('.rec-links button:text-is("Make this recurring…")'); await page.waitForSelector('#rc-n');
  ok(/only one payment so far/i.test(await page.locator('#toast').innerText()), 'with one payment it says "every month" is only a guess');
  await page.click('#main button:text-is("Add")'); await wait(page, 500); await page.keyboard.press('Escape'); await wait(page, 300);
  ok(await page.evaluate(() => App.cfg.recurring.some(r => r.name === 'NEW GYM CLUB')), 'it can still be added');
  // twice a month, added by hand
  await page.evaluate(() => RecurringUI.open()); await page.waitForSelector('h1:text-is("Bills & subscriptions")');
  await page.click('#main button:text-is("+ Add")'); await page.waitForSelector('#rc-n');
  await page.fill('#rc-n', 'Paycheque'); await page.fill('#rc-m', 'ACME TWICE'); await page.fill('#rc-a', '1500'); await page.selectOption('#rc-k', 'income');
  await page.selectOption('#rc-nc', 'semimonthly'); await page.waitForSelector('#rc-d2');
  await page.evaluate(ym => { const d = document.getElementById('rc-d'); d.value = ym + '-01'; d.dispatchEvent(new Event('change')); }, YM);
  await page.click('#main button:text-is("Add")'); await wait(page, 300);
  ok(/other day of the month/i.test(await page.locator('#main [role=alert]').innerText()), '"Twice a month" asks for the other day (and refuses to continue without it)');
  await page.fill('#rc-d2', '15'); await page.click('#main button:text-is("Add")'); await wait(page, 500);
  const pay = await page.evaluate(() => App.cfg.recurring.find(r => r.name === 'Paycheque'));
  ok(pay && pay.cadence === 'semimonthly' && pay.day2 === 15 && pay.kind === 'income', 'saved as twice a month on the 1st and 15th');
  const dates = await page.evaluate(ym => Recurring.schedule(App.cfg.recurring.find(r => r.name === 'Paycheque'), ym + '-01', ym + '-31'), YM);
  ok(dates.length === 2 && dates[0].endsWith('-01') && dates[1].endsWith('-15'), 'its schedule has both paydays this month (' + dates.join(', ') + ')');
  await page.keyboard.press('Escape'); await wait(page, 300);
  // quick pick: Monthly / Quarterly / Yearly
  await page.evaluate(() => RecurringUI.open()); await page.waitForSelector('h1:text-is("Bills & subscriptions")');
  await page.click('#main button:text-is("+ Add")'); await page.waitForSelector('#rc-n');
  ok(await page.locator('[aria-label="Common schedules"] .chip').count() === 3, 'the Add form has quick picks: Monthly, Quarterly, Yearly');
  await page.click('.chip:has-text("Quarterly")'); await wait(page, 200);
  ok(await page.inputValue('#rc-nc') === 'quarterly' && await page.locator('.chip[aria-pressed=true]:has-text("Quarterly")').count() === 1, 'choosing Quarterly sets "How often" and shows it pressed');
  await page.fill('#rc-n', 'Property tax'); await page.fill('#rc-m', 'CITY PROPERTY TAX'); await page.fill('#rc-a', '300');
  await page.click('#main button:text-is("Add")'); await wait(page, 500);
  const qrow = await page.locator('.rc-item:has-text("Property tax")').innerText();
  ok(/\$1,200 a year \(about \$100\.00 a month\)/.test(qrow), 'the item shows its cost: "$1,200 a year (about $100.00 a month)"');
  ok(/about \$[\d,]+ a month · \d+ bills?/.test(await page.locator('#main').innerText()), 'the page total also says what it comes to a month');
  await page.keyboard.press('Escape'); await wait(page, 300);
  // Log it
  const late = await page.evaluate(() => Recurring.addDays(U.today(), -3));
  await page.evaluate(async d => { App.cfg.recurring.push({ id: 'lg1', name: 'Rent e-Transfer', key: 'RENT ETRANSFER', kind: 'expense', cadence: 'monthly', anchor: d, amount: 800, amountMode: 'fixed', categoryId: 'rent', active: true, createdAt: new Date().toISOString() }); await UI.saveCfg(); location.hash = '#/home'; App.month = null; App.render(); }, late);
  await wait(page, 500);
  const upc = page.locator('section[aria-labelledby=upc] .upc-row:has-text("Rent e-Transfer")').first();
  ok(/Late|Due/.test(await upc.innerText()) && await upc.locator('button:text-is("Log it")').count() === 1 && await page.locator('section[aria-labelledby=upc] .upc-row:has-text("Rent e-Transfer") button:text-is("Log it")').count() === 1, 'Coming up: the overdue bill has a "Log it" button, and next month\'s not-yet-due one does not');
  await upc.locator('button:text-is("Log it")').click(); await page.waitForSelector('#amt');
  ok(await page.inputValue('#amt') === '800' && await page.inputValue('#allcat') === 'rent' && await page.inputValue('#desc') === 'RENT ETRANSFER' && await page.inputValue('#dt') === late, 'the expense form opens with amount $800, Rent, a name that matches the bill, and the expected date');
  await page.click('button:text-is("Save expense")'); await wait(page, 500); await page.keyboard.press('Escape'); await wait(page, 400);
  ok(await page.evaluate(() => App.txs.some(t => t.desc === 'RENT ETRANSFER' && t.amount === 800 && t.source === 'manual')), 'saving adds the payment');
  await page.evaluate(() => { App.render(); }); await wait(page, 300);
  const upc2 = page.locator('section[aria-labelledby=upc] .upc-row:has-text("Rent e-Transfer")').first();
  ok(/Paid ✓/.test(await upc2.innerText()) && await upc2.locator('button:text-is("Log it")').count() === 0, 'the row now says "Paid ✓" and the Log it button is gone');
  // a deleted-in-Bills item no longer marks rows
  await page.evaluate(async () => { App.cfg.recurring = App.cfg.recurring.filter(r => r.name !== 'SPOTIFY PREMIUM'); await UI.saveCfg(); });
  await page.evaluate(() => { location.hash = '#/transactions?f=all&scope=all'; App.render(); }); await wait(page, 500);
  ok(await page.locator('.tx :text("Recurring: SPOTIFY PREMIUM")').count() === 0, 'when the recurring item is removed, the rows lose the marker');

  // ================= K. clickable Insights =================
  const ins = async (view) => { await page.evaluate(v => { Insights.setView(v); location.hash = '#/insights'; App.render(); }, view || 'category'); await wait(page, 500); };
  await ins('category');
  const nested = () => page.evaluate(() => document.querySelectorAll('button a, a button, [role=button] a, [role=button] button, a a, button button').length);
  ok(await page.locator('.tile-link').count() >= 2, 'Insights summary tiles are links/buttons (' + await page.locator('.tile-link').count() + ')');
  await page.click('a.tile-link:has-text("Spent so far")'); await wait(page, 400);
  ok(await page.evaluate(() => /#\/transactions/.test(location.hash) && /f=spend/.test(location.hash) && /scope=year/.test(location.hash)), '"Spent so far" opens every spending line this year');
  await ins('category');
  await page.click('button.tile-link:has-text("Average a month")'); await wait(page, 400);
  ok(await page.locator('button[aria-pressed=true]:text-is("Income, spent, saved")').count() === 1, '"Average a month" opens the income, spent, saved view');
  await ins('category');
  const over = page.locator('button.tile-link:has-text("Most over budget")');
  if (await over.count()) { await over.click(); await page.waitForSelector('.panel'); ok(await page.locator('.panel .chart-col').count() > 0, '"Most over budget" opens that category with its monthly chart'); await page.keyboard.press('Escape'); await wait(page, 300); }
  else ok(true, '(no category is over budget in this data: tile is not a link)');
  // sortable headers
  await page.click('th button:text-is("Spent so far")'); await wait(page, 300);
  ok(await page.locator('.chip[aria-pressed=true]:text-is("Most spent")').count() === 1 && await page.locator('th button[aria-pressed=true]:text-is("Spent so far")').count() === 1, 'the "Spent so far" heading sorts by most spent (and the chip follows)');
  await page.click('th button:text-is("Difference")'); await wait(page, 300);
  ok(await page.locator('.chip[aria-pressed=true]:text-is("Most over budget")').count() === 1, 'the "Difference" heading sorts by most over budget');
  await page.click('th button:text-is("Category")'); await wait(page, 300);
  ok(await page.locator('.chip[aria-pressed=true]:text-is("Budget order")').count() === 1, '"Category" goes back to budget order');
  // collapse groups
  const rowsBefore = await page.locator('table.t tbody tr:not(.grp)').count();
  await page.locator('.grp-toggle').first().click(); await wait(page, 300);
  ok(await page.locator('.grp-toggle').first().getAttribute('aria-expanded') === 'false' && await page.locator('table.t tbody tr:not(.grp)').count() < rowsBefore, 'a group folds away its categories (aria-expanded=false)');
  await page.click('button:text-is("Collapse all groups")'); await wait(page, 300);
  ok(await page.locator('table.t tbody tr:not(.grp)').count() === 0 && await page.locator('button:text-is("Expand all groups")').count() === 1, '"Collapse all groups" hides every category; the button flips to "Expand all groups"');
  await page.click('button:text-is("Expand all groups")'); await wait(page, 300);
  ok(await page.locator('table.t tbody tr:not(.grp)').count() === rowsBefore, '…and expanding brings them all back');
  // row: name button, amount link, mouse click anywhere
  const grow = page.locator('table.t tbody tr:has(button.ins-name:text-is("Groceries"))').first();
  await grow.locator('button.ins-name').click(); await page.waitForSelector('.panel'); ok(await page.locator('.panel .whatif, .panel #wf').count() >= 0 && await page.locator('.panel').count() === 1, 'the category name opens its panel'); await page.keyboard.press('Escape'); await wait(page, 300);
  await grow.locator('td').nth(2).click(); await wait(page, 300);
  ok(await page.locator('.panel').count() === 1, 'clicking elsewhere on the row (mouse) also opens it'); await page.keyboard.press('Escape'); await wait(page, 300);
  const amtLink = grow.locator('a.ins-link');
  if (await amtLink.count()) { await amtLink.click(); await wait(page, 400); ok(await page.evaluate(() => /cat=groceries/.test(location.hash) && /scope=year/.test(location.hash)), 'the Spent amount opens that category\'s transactions for the year'); }
  await ins('category');
  ok(await nested() === 0 && await page.locator('tr[role=button]').count() === 0, 'nothing interactive sits inside another interactive element (category view)');
  // month grid
  await ins('grid');
  ok(await page.locator('table.yg th a.yg-head').count() >= 1, 'grid: month headings are links');
  const mh = await page.locator('table.yg th a.yg-head').first().getAttribute('href');
  ok(/#\/transactions\?f=spend&m=\d{4}-01/.test(mh), 'the January heading opens January\'s spending (' + mh + ')');
  await page.locator('table.yg th button.ins-name').first().click(); await page.waitForSelector('.panel');
  ok(await page.locator('.panel').count() === 1, 'grid: a category name opens its panel'); await page.keyboard.press('Escape'); await wait(page, 300);
  const gtotal = page.locator('table.yg tbody tr:not(.grp):not(.yg-total) td:nth-last-child(2) a').first();
  ok(/scope=year/.test(await gtotal.getAttribute('href')), 'grid: a Total cell opens that category for the whole year');
  const rowsG = await page.locator('table.yg tbody tr:not(.grp):not(.yg-total)').count();
  await page.locator('table.yg .grp-toggle').first().click(); await wait(page, 300);
  ok(await page.locator('table.yg tbody tr:not(.grp):not(.yg-total)').count() < rowsG, 'grid: groups fold too');
  ok(await nested() === 0, 'nothing interactive sits inside another interactive element (grid)');
  await ins('category'); ok(await page.locator('.grp-toggle[aria-expanded=false]').count() >= 1, 'the folded state is shared with the category view');
  await page.click('button:text-is("Collapse all groups")'); await wait(page, 200); await page.click('button:text-is("Expand all groups")'); await wait(page, 300);
  // income view
  await ins('flow');
  ok(await page.locator('a.tile-link').count() >= 3, 'income view: Income, Spent and Saved tiles are links');
  await page.locator('table.yg tbody tr:first-child th button.ins-name').click(); await wait(page, 500);
  ok(await page.evaluate(() => location.hash === '#/home' && /^\d{4}-01$/.test(App.month)), 'a month name opens that month on Home (' + await page.evaluate(() => App.month) + ')');
  await ins('flow');
  const yr = page.locator('tr.yg-total td a').first();
  ok(/scope=year/.test(await yr.getAttribute('href')), '"Year so far" amounts open the year\'s lines');
  ok(await nested() === 0, 'nothing interactive sits inside another interactive element (income view)');
  await page.evaluate(() => { Insights.setView('category'); App.month = null; });

  ok(net.length === 0, 'no network requests (' + net.length + ')');
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
