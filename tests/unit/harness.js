/* Loads the app's pure modules (util, model, engine, and the new feature modules) into a Node VM, without a browser.
   Usage: const A = require('./harness')(); A.M.month(...). Each call gives a fresh, isolated copy. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const JS = path.resolve(__dirname, '../../js');
module.exports = function load(extra) {
  const ctx = { console, crypto: globalThis.crypto, Date, Math, JSON, Promise, setTimeout, clearTimeout,
    document: { createElement: () => ({}), createTextNode: () => ({}) }, Node: function () {}, navigator: {}, window: {} };
  vm.createContext(ctx);
  const files = ['util.js', 'model.js', 'engine.js', 'match.js'].concat(extra || []);
  files.forEach(f => { const p = path.join(JS, f); if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f }); });
  vm.runInContext('this.U = U; this.M = M; this.Engine = Engine;' + (extra || []).map(f => { const n = { 'recurring.js': 'Recurring', 'learn.js': 'Learn', 'funds.js': 'Funds', 'accounts.js': 'Accounts', 'health.js': 'Health', 'year.js': 'Year', 'split.js': 'Split', 'history.js': 'Hist', 'reviewed.js': 'Reviewed', 'group.js': 'Group', 'costs.js': 'Costs', 'spending.js': 'Spending', 'layout.js': 'Layout', 'pdf-proof.js': 'PdfProof', 'pdf-statement.js': 'Statement' }[f]; return n ? 'this.' + n + ' = typeof ' + n + ' !== "undefined" ? ' + n + ' : null;' : ''; }).join(''), ctx);
  return ctx;
};
