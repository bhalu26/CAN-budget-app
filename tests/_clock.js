/* Date-proofs the browser tests: many seed lines are dated October 2026 and expect "today" to be late October 2026.
   require('./_clock') before require('playwright'): every browser context then starts with the page clock set to
   TEST_TODAY (default 2026-10-24 12:00), and time keeps flowing. Use TEST_TODAY=real to run on the real date. */
'use strict';
const fs = require('fs'), path = require('path');
if (!(process.env.BUDGET_SEED || fs.existsSync(path.resolve(__dirname, '../private/budget-seed.json')))) {
  console.log('SKIP: the browser tests need your private budget-seed.json (put it in private/ or set BUDGET_SEED=...). It is not in the repository.'); process.exit(0);
}
const pw = require('playwright');
const when = process.env.TEST_TODAY || '2026-10-24T12:00:00';
if (when !== 'real' && !pw.chromium.__clocked) {
  const launch = pw.chromium.launch.bind(pw.chromium);
  pw.chromium.launch = async function (opts) {
    const b = await launch(opts), newContext = b.newContext.bind(b);
    b.newContext = async function (o) { const c = await newContext(o); await c.clock.setSystemTime(new Date(when)); return c; };
    b.newPage = async function (o) { const c = await b.newContext(o); return c.newPage(); };
    return b;
  };
  pw.chromium.__clocked = true;
}
