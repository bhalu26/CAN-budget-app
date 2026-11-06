/* Writes the text layer (positions of every word) of each fixture PDF to fixtures/pages-<name>.json, so unit tests can run the layout
   code in Node without a browser. The fixtures are made-up statements. Run: node dump-pages.js   (needs node playwright) */
const { chromium } = require('playwright'); const path = require('path'), fs = require('fs');
const FIX = path.join(__dirname, 'fixtures'), URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  for (const name of fs.readdirSync(FIX).filter(f => f.endsWith('.pdf') && f !== 'locked.pdf' && f !== 'scan.pdf')) {
    const page = await b.newPage(); await page.goto(URL);
    await page.setInputFiles('#file', path.join(FIX, name));
    await page.waitForFunction(() => LayoutDump._state.files.length && LayoutDump._state.files.every(f => !['queued', 'reading'].includes(f.status)), null, { timeout: 60000 });
    const pages = await page.evaluate(() => LayoutDump._state.files[0].raw.pages.map(p => ({ n: p.n, w: p.w, h: p.h, items: p.items.map(i => ({ s: i.s, x: i.x, y: i.y, w: i.w, fs: i.fs, rot: i.rot })) })));
    fs.writeFileSync(path.join(FIX, 'pages-' + name.replace(/\.pdf$/, '') + '.json'), JSON.stringify(pages));
    console.log(name, pages.length, 'pages', pages.reduce((a, p) => a + p.items.length, 0), 'items'); await page.close();
  }
  await b.close();
})();
