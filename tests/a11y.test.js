/* Accessibility checks on the live app (the screens are built at runtime, so a static scan cannot see them).
   For every screen and overlay, in light and dark: accessible names, labels, duplicate ids, positive tabindex,
   focusable things hidden from screen readers, heading levels, 24px targets (WCAG 2.5.8), visible keyboard focus.
   Run from the work (or our-budget) folder: node tests/a11y.test.js (needs Playwright) */
require('./_clock'); const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const APP = 'file://' + path.resolve(__dirname, '../index.html');
const PKG = path.resolve(__dirname, '..');
const pick = (...c) => c.find(f => fs.existsSync(f));
const SEED = pick(PKG + '/private/budget-seed.json', process.env.BUDGET_SEED || '');
const GEN = pick(PKG + '/rules/rules-general.csv', process.env.BUDGET_RULES || '');
let fails = 0, warns = 0;
function ok(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; }
function warn(m) { console.log('WARN ' + m); warns++; }

/* Runs in the page: returns problems found in the visible UI. */
function audit() {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[hidden], .leaving, .sr-only'); };
  const txt = el => (el.textContent || '').replace(/\s+/g, ' ').trim();
  const name = el => {
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();
    if (el.getAttribute('aria-labelledby')) return el.getAttribute('aria-labelledby').split(' ').map(id => { const e = document.getElementById(id); return e ? txt(e) : ''; }).join(' ').trim();
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
      if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && txt(l)) return txt(l); }
      const wrap = el.closest('label'); if (wrap && txt(wrap)) return txt(wrap);
      return el.getAttribute('title') || '';
    }
    return txt(el) || el.getAttribute('title') || '';
  };
  const out = { noName: [], dupIds: [], posTab: [], hiddenFocus: [], headings: [], small: [] };
  const focusables = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"]), [role=button], [role=option]')].filter(vis);
  focusables.forEach(el => {
    if (el.getAttribute('role') === 'option' && !txt(el)) out.noName.push('option ' + el.outerHTML.slice(0, 80));
    else if (el.getAttribute('role') !== 'option' && !name(el)) out.noName.push(el.tagName.toLowerCase() + (el.className ? '.' + String(el.className.baseVal !== undefined ? el.className.baseVal : el.className).split(' ')[0] : '') + ' ' + el.outerHTML.slice(0, 90));
    const t = el.getAttribute('tabindex'); if (t && +t > 0) out.posTab.push(el.outerHTML.slice(0, 80));
    if (el.closest('[aria-hidden="true"]')) out.hiddenFocus.push(el.outerHTML.slice(0, 80));
    const r = el.getBoundingClientRect();
    const inlineLink = el.tagName === 'A' && getComputedStyle(el).display === 'inline';
    const isCheck = el.tagName === 'INPUT' && /checkbox|radio/.test(el.type) && el.closest('label') && el.closest('label').getBoundingClientRect().height >= 24;
    if (!inlineLink && !isCheck && el.getAttribute('role') !== 'option' && (r.width < 24 || r.height < 24)) out.small.push(Math.round(r.width) + 'x' + Math.round(r.height) + ' ' + (name(el) || el.outerHTML.slice(0, 60)));
  });
  const ids = {}; document.querySelectorAll('[id]').forEach(e => { ids[e.id] = (ids[e.id] || 0) + 1; });
  out.dupIds = Object.keys(ids).filter(k => ids[k] > 1);
  // headings, per landmark (main, and an open dialog separately)
  const scopes = [document.getElementById('main')].concat([...document.querySelectorAll('[role=dialog]')].filter(vis));
  scopes.forEach(sc => {
    let last = 0;
    [...sc.querySelectorAll('h1,h2,h3,h4')].filter(vis).forEach(hd => { const l = +hd.tagName[1]; if (last && l > last + 1) out.headings.push(sc.id || sc.getAttribute('aria-label') || 'dialog' + ': ' + hd.tagName + ' "' + txt(hd).slice(0, 30) + '" after H' + last); last = l; });
  });
  return out;
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(APP);
  await page.setInputFiles('#seed', SEED); await page.waitForSelector('#rs-general');
  await page.setInputFiles('#rs-general', GEN); await page.waitForTimeout(400);
  await page.evaluate(async () => {
    const l = []; for (let m = 1; m <= 10; m++) for (let i = 0; i < 6; i++) l.push({ id: 'a' + m + i, source: 'csv', direction: 'out', account: 'Visa', createdAt: '2026-01-01T00:00:00Z', flags: [], date: '2026-' + String(m).padStart(2, '0') + '-' + String(1 + i * 3).padStart(2, '0'), amount: 30 + i * 11, categoryId: ['groceries', 'dine-out', null][i % 3], type: 'expense', desc: ['SAFEWAY #1', 'CAFE', 'UNKNOWN'][i % 3], note: '', needsTag: m === 10 && i % 3 === 2 });
    await DB.putTx(l); await UI.reload();
  });
  await page.evaluate(async () => {   // a few recurring bills so the v18 views have content
    const l = []; for (let m = 1; m <= 10; m++) { l.push({ id: 'n' + m, source: 'csv', direction: 'out', type: 'expense', categoryId: 'subscriptions', account: 'Visa', createdAt: '2026-01-01T00:00:00Z', flags: [], date: '2026-' + String(m).padStart(2, '0') + '-10', amount: m < 6 ? 19.99 : 20.99, desc: 'NETFLIX COM' }); if (m !== 9) l.push({ id: 'h' + m, source: 'csv', direction: 'out', type: 'expense', categoryId: 'utilities', account: 'Visa', createdAt: '2026-01-01T00:00:00Z', flags: [], date: '2026-' + String(m).padStart(2, '0') + '-20', amount: 50 + m, desc: 'BC HYDRO' }); }
    await DB.putTx(l); await UI.reload();
    App.cfg.recurring = [{ id: 'r1', name: 'Netflix', key: 'NETFLIX COM', kind: 'expense', cadence: 'monthly', anchor: '2026-01-10', amount: 20.99, amountMode: 'fixed', categoryId: 'subscriptions', active: true, createdAt: '2026-01-01T00:00:00Z' },
      { id: 'r2', name: 'Hydro', key: 'BC HYDRO', kind: 'expense', cadence: 'monthly', anchor: '2026-01-20', amount: 60, amountMode: 'varies', categoryId: 'utilities', active: true, createdAt: '2026-01-01T00:00:00Z' },
      { id: 'r3', name: 'Property tax', key: 'CITY TAX', kind: 'expense', cadence: 'quarterly', anchor: '2026-01-15', amount: 300, amountMode: 'fixed', categoryId: 'other-household', active: true, createdAt: '2026-01-01T00:00:00Z' }];
    await UI.saveCfg();
  });
  let csvN = 0;
  async function pdfFile(name, wantBlock) {   // Import with a made-up PDF statement loaded
    await page.keyboard.press('Escape');
    await page.evaluate(() => { const f = Importer._files(); f.splice(0, f.length); location.hash = '#/import'; App.render(); });
    await page.waitForSelector('#csvf'); await page.setInputFiles('#csvf', require('path').resolve(__dirname, '../tools/pdf-layout-dump/dev-tools/fixtures/' + name));
    await page.waitForSelector(wantBlock ? '.pdf-note' : 'input[type=password]', { timeout: 30000 }); await page.waitForTimeout(300);
    if (wantBlock) {
      const id = await page.evaluate(async () => { App.cfg.accounts = App.cfg.accounts || []; let a = App.cfg.accounts.find(x => x.name === 'A11y chequing'); if (!a) { a = { id: 'a11y-acct', name: 'A11y chequing', kind: 'bank', type: 'chequing', currency: 'CAD', numbers: [], balances: [] }; App.cfg.accounts.push(a); await UI.saveCfg(); } return a.id; });
      await page.evaluate(() => App.render()); await page.waitForTimeout(200); await page.selectOption('#acct', id); await page.waitForTimeout(300);
    }
  }
  async function importFile(doImport) {   // open Import with a file loaded (and import it), the same way every time
    await page.keyboard.press('Escape');
    await page.evaluate(() => { const f = Importer._files(); f.splice(0, f.length); location.hash = '#/import'; App.render(); });
    const TMPCSV = require('path').join(require('os').tmpdir(), 'a11y-td-7788-' + (++csvN) + '.csv');   // a new file each time (an imported one would be all duplicates)
    require('fs').writeFileSync(TMPCSV, ['10/01/2026,SAFEWAY #4545,' + (45 + csvN) + '.10', '10/03/2026,NETFLIX.COM,20.99', '10/10/2026,SAVE ON FOODS,' + (61 + csvN) + '.25'].join('\n'));
    await page.waitForSelector('#csvf'); await page.setInputFiles('#csvf', TMPCSV); await page.waitForTimeout(400);
    const id = await page.evaluate(async () => { App.cfg.accounts = App.cfg.accounts || []; let a = App.cfg.accounts.find(x => x.name === 'A11y chequing'); if (!a) { a = { id: 'a11y-acct', name: 'A11y chequing', kind: 'bank', numbers: [], bank: 'TD' }; App.cfg.accounts.push(a); await UI.saveCfg(); } return a.id; });
    await page.evaluate(() => App.render()); await page.waitForTimeout(200);
    await page.selectOption('#acct', id); await page.waitForTimeout(300);
    if (doImport) { await page.getByRole('button', { name: /^Import all \(\d+\)$/ }).click(); await page.waitForTimeout(500); }
  }
  const views = [
    ['Home', async () => { await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForTimeout(300); await page.click('.group-head'); }],
    ['Transactions + editor', async () => { await page.evaluate(() => { location.hash = '#/transactions'; }); await page.waitForTimeout(300); await page.locator('.tx button.tag').first().click(); }],
    ['Review', async () => { await page.evaluate(() => { location.hash = '#/review'; }); }],
    ['Insights', async () => { await page.evaluate(() => { Insights.setView('category'); location.hash = '#/insights'; }); }],
    ['Insights month grid', async () => { await page.evaluate(() => { Insights.setView('grid'); location.hash = '#/insights'; App.render(); }); }],
    ['Import: a file loaded', async () => { await importFile(false); }],
    ['Import: prompt after importing', async () => { await importFile(true); }],
    ['Import: PDF that needs confirming', async () => { await pdfFile('card.pdf', true); }],
    ['Import: PDF locked (password)', async () => { await pdfFile('locked.pdf', false); }],
    ['Import: recent imports shown', async () => { await importFile(true); await page.click('.prompt button:text-is("Keep it open")'); await page.check('#show-recent'); await page.waitForTimeout(200); }],
    ['Transactions with account drop-down', async () => { await page.evaluate(() => { location.hash = '#/transactions?scope=all'; }); }],
    ['Add expense (new)', async () => { await page.evaluate(() => { location.hash = '#/'; UI.expensePanel(null, App.render); }); }],
    ['Add expense (more options open)', async () => { await page.evaluate(() => { location.hash = '#/'; UI.expensePanel(null, App.render); }); await page.click('details.more > summary'); }],
    ['Insights recurring and fixed', async () => { await page.evaluate(() => { Insights.setView('recurring'); location.hash = '#/insights'; App.render(); }); }],
    ['Insights top spending', async () => { await page.evaluate(() => { Insights.setView('top'); location.hash = '#/insights'; App.render(); }); }],
    ['Bills still due panel', async () => { await page.evaluate(() => { Insights.setView('category'); App.month = null; location.hash = '#/'; App.render(); CostsUI.billsDue(U.today().slice(0, 7)); }); }],
    ['Insights income, spent, saved', async () => { await page.evaluate(() => { Insights.setView('flow'); location.hash = '#/insights'; App.render(); }); }],
    ['Insights category panel', async () => { await page.evaluate(() => { Insights.setView('category'); App.render(); Insights.openCategory('dine-out'); }); }],
    ['Rules + test', async () => { await page.keyboard.press('Escape'); await page.evaluate(() => { location.hash = '#/rules?test=SAFEWAY%20%231'; }); }],
    ['Rule editor', async () => { await page.click('button:text-is("Add a rule")'); }],
    ['Settings', async () => { await page.keyboard.press('Escape'); await page.evaluate(() => { location.hash = '#/settings'; }); }],
    ['Big expense editor', async () => { const b = page.locator('button:text-is("Add a big expense")'); if (await b.count()) await b.click(); }],
    ['Settings reorder', async () => { await page.locator('button:text-is("Change order")').first().click(); }],
    ['Import', async () => { await page.evaluate(() => { location.hash = '#/import'; }); }],
    ['Add expense', async () => { await page.evaluate(() => UI.expensePanel(null, App.render)); }],
    ['Split panel', async () => { await page.keyboard.press('Escape'); await page.evaluate(() => { const t = App.txs.find(x => x.type === 'expense' && x.desc === 'SAFEWAY #1' && !x.splitGroup); SplitUI.open(t, App.render); }); await page.waitForSelector('#sp-a0'); await page.locator('button:text-is("Add another line")').click(); await page.fill('#sp-a1', '10'); }],
    ['Group bill panel', async () => { await page.keyboard.press('Escape'); await page.evaluate(async () => {
        if (!window.__v16) { window.__v16 = 1;
          const t0 = App.txs.find(x => x.type === 'expense' && x.desc === 'CAFE' && x.date.startsWith(U.today().slice(0, 7))), u = JSON.parse(JSON.stringify(t0)); u.share = Math.round(u.amount * 50) / 100;
          await DB.putTx([u, { id: 'a11y-in', source: 'csv', direction: 'in', type: 'pending', categoryId: null, needsTag: true, desc: 'E-TRANSFER FROM A', date: u.date, amount: 5, flags: [], createdAt: new Date().toISOString() }]); await UI.reload();
          const pm = U.shiftMonth(U.today().slice(0, 7), -1); Reviewed.mark(App.cfg, App.txs, pm, U.today(), new Date(Date.now() - 60000).toISOString()); await UI.saveCfg();
          const t1 = JSON.parse(JSON.stringify(App.txs.find(x => x.type === 'expense' && x.date.startsWith(pm)))); t1.amount += 1; await DB.putTx([t1]); await UI.reload(); }
        GroupUI.open(App.txs.find(x => x.share)); }); await page.waitForSelector('#gp-cash'); }],
    ['Edit transaction: group, recurring, history', async () => { await page.keyboard.press('Escape'); await page.evaluate(() => UI.expensePanel(App.txs.find(x => x.share), App.render)); await page.waitForSelector('#grp'); await page.locator('.panel .hist button').click(); }],
    ['Repays a group bill', async () => { await page.keyboard.press('Escape'); await page.evaluate(() => GroupUI.repayFrom(App.txs.find(x => x.id === 'a11y-in'), App.render)); await page.waitForSelector('.panel button:text-is("This one")'); }],
    ['Home: reviewed month changed', async () => { await page.keyboard.press('Escape'); await page.evaluate(() => { App.month = U.shiftMonth(U.today().slice(0, 7), -1); location.hash = '#/home'; App.render(); }); await page.waitForSelector('.rv-changed'); }],
    ['What changed panel', async () => { await page.evaluate(() => ReviewedUI.changes(U.shiftMonth(U.today().slice(0, 7), -1))); await page.waitForSelector('.panel'); }],
    ['Data health: recent changes', async () => { await page.keyboard.press('Escape'); await page.evaluate(() => { App.month = null; location.hash = '#/health'; }); await page.waitForTimeout(300); const b = page.locator('button:has-text("Show recent changes")'); if (await b.count()) await b.click(); }],
    ['Bills: twice a month form', async () => { await page.keyboard.press('Escape'); await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForTimeout(300); await page.evaluate(() => { RecurringUI.open({ add: { name: 'Pay', key: 'PAY', amount: '1500', cadence: 'semimonthly', date: U.today(), cat: '', kind: 'income', day2: '15' } }); }); await page.waitForSelector('#rc-d2'); }],
    ['Shortcuts sheet', async () => { await page.keyboard.press('Escape'); await page.evaluate(() => Keys.help()); }],
    ['Bills & subscriptions', async () => { await page.keyboard.press('Escape'); await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForTimeout(200); await page.evaluate(() => { location.hash = '#/bills'; }); await page.waitForSelector('#rc-q, #rc-found'); await page.click('#main button:text-is("+ Add")'); }],
    ['Bills: editing a row', async () => { await page.keyboard.press('Escape'); await page.evaluate(() => { location.hash = '#/bills'; }); await page.waitForSelector('#rc-q'); const b = page.locator('.rc-item button:text-is("Edit")').first(); if (await b.count()) await b.click(); }],
    ['Rules page with files', async () => { await page.keyboard.press('Escape'); await page.evaluate(() => { location.hash = '#/rules'; }); }],
    ['Backup & sharing', async () => { await page.keyboard.press('Escape'); await page.evaluate(() => { location.hash = '#/backup'; }); }],
    ['Accounts + add form', async () => { await page.keyboard.press('Escape'); await page.evaluate(async () => { App.cfg.accounts = App.cfg.accounts || []; if (!App.cfg.accounts.some(a => a.name === 'A11y TFSA')) { App.cfg.accounts.push({ id: 'a11y1', name: 'A11y TFSA', kind: 'bank', type: 'investment', currency: 'CAD', numbers: [], balances: [{ date: '2026-01-31', amount: 900, source: 'manual' }, { date: U.today(), amount: 1000, source: 'manual' }] }, { id: 'a11y2', name: 'A11y Visa', kind: 'card', type: 'credit', currency: 'CAD', numbers: [], balances: [{ date: U.today(), amount: 400, source: 'manual' }] }); await UI.saveCfg(); } location.hash = '#/accounts'; }); await page.waitForTimeout(300); const b = page.locator('button:text-is("Add an account")'); if (await b.count()) await b.click(); }],
    ['Data health', async () => { await page.keyboard.press('Escape'); await page.evaluate(async () => { if (!App.txs.some(t => t.id === 'hd1')) { const m = (id, b) => ({ id, source: 'csv', direction: 'out', type: 'expense', categoryId: 'groceries', desc: 'DUP SHOP', date: '2026-10-05', amount: 33.3, batchId: b, flags: [], createdAt: '2026-10-05T00:00:00Z' }); await DB.putTx([m('hd1', 'p'), m('hd2', 'q')]); await UI.reload(); } location.hash = '#/health'; }); await page.waitForTimeout(300); const d = page.locator('article button:text-is("Delete this one")'); if (await d.count()) await d.first().click(); }],
    ['Accounts: details open', async () => { const b = page.locator('.acct-row details.more > summary').first(); if (await b.count()) await b.click(); }],
    ['Customize Home', async () => { await page.keyboard.press('Escape'); await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForTimeout(200); await page.evaluate(() => Home.customize()); }],
    ['Command palette', async () => { await page.keyboard.press('Escape'); await page.keyboard.press('Control+k'); await page.keyboard.type('gro'); }]
  ];
  for (const theme of ['light', 'dark']) {
    await page.evaluate(t => Theme.set(t), theme);
    for (const [label, go] of views) {
      await go(); await page.waitForTimeout(350);
      const r = await page.evaluate(audit);
      const tag = label + ' (' + theme + ')';
      ok(!r.noName.length, tag + ': every control has a name' + (r.noName.length ? ' → ' + r.noName.slice(0, 3).join(' | ') : ''));
      ok(!r.dupIds.length, tag + ': no duplicate ids' + (r.dupIds.length ? ' → ' + r.dupIds.join(', ') : ''));
      ok(!r.posTab.length && !r.hiddenFocus.length, tag + ': no positive tabindex, nothing focusable inside aria-hidden' + (r.hiddenFocus.length ? ' → ' + r.hiddenFocus[0] : ''));
      ok(!r.headings.length, tag + ': heading levels in order' + (r.headings.length ? ' → ' + r.headings.join(' | ') : ''));
      ok(!r.small.length, tag + ': targets at least 24×24' + (r.small.length ? ' → ' + r.small.slice(0, 4).join(' | ') : ''));
    }
    await page.keyboard.press('Escape');
  }

  // visible focus: tab through each main screen and check every stop shows a ring
  await page.evaluate(() => Theme.set('light'));
  for (const r of ['home', 'review', 'insights', 'rules']) {
    await page.evaluate(r => { location.hash = '#/' + r; }, r); await page.waitForTimeout(300);
    await page.evaluate(() => document.getElementById('main').focus());
    const bad = [];
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      const f = await page.evaluate(() => {
        const el = document.activeElement; if (!el || el === document.body) return null;
        const s = getComputedStyle(el), hit = el.querySelector && el.querySelector('.hit');
        const ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2) || (s.boxShadow && s.boxShadow !== 'none') || (hit && getComputedStyle(hit).stroke !== 'none') || el.closest('.radio-chip');
        return { ring: !!ring, what: el.tagName + ' ' + (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30) };
      });
      if (f && !f.ring) bad.push(f.what);
    }
    ok(!bad.length, r + ': every Tab stop shows a focus ring' + (bad.length ? ' → ' + bad.slice(0, 4).join(' | ') : ''));
  }
  // focus returns to the trigger when an overlay closes
  await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForTimeout(300);
  await page.locator('button:text-is("+ Add expense")').focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  ok(await page.evaluate(() => document.activeElement.textContent === '+ Add expense'), 'closing a panel returns focus to its button');
  await page.locator('button:text-is("+ Add expense")').focus(); await page.keyboard.press('Control+k'); await page.waitForTimeout(200); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  ok(await page.evaluate(() => document.activeElement.textContent === '+ Add expense'), 'closing the palette returns focus to where it was');
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
