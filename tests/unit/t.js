/* Tiny test helper for the unit suites. */
'use strict';
let fails = 0, passes = 0;
module.exports = {
  ok(c, m) { if (c) passes++; else fails++; console.log((c ? 'PASS ' : 'FAIL ') + m); },
  eq(a, b, m) { const s = JSON.stringify(a) === JSON.stringify(b); if (s) passes++; else fails++; console.log((s ? 'PASS ' : 'FAIL ') + m + (s ? '' : ' → got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b))); },
  done() { console.log(fails ? fails + ' FAILED' : 'ALL PASSED (' + passes + ')'); process.exit(fails ? 1 : 0); }
};
