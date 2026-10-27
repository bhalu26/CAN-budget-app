/* One-time import of the 2026 Excel template's "Monthly Expense Tracker" (months before the cut-over).
   Every row is accounted for: imported, needs a tag, or listed with the reason it was not imported. */
var ExcelImport = (function () {
  'use strict';
  var SHEET = 'Monthly Expense Tracker';
  var ALIAS = { 'extra 1': 'entertainment', 'extra 2': 'fees & admin', 'dentist/massage/physip': 'dentist/massage/physio' };
  var TO_REVIEW = { 'extra 3': 1, 'extra 4': 1 };

  /* opts.askExtras: send old Extra 1 / Extra 2 rows to "Needs a category" instead of Entertainment / Fees & Admin. */
  function analyse(buf, cfg, opts) {
    opts = opts || {};
    return XLSX.open(buf).then(function (wb) {
      if (wb.sheetNames.indexOf(SHEET) < 0) throw new Error('This workbook has no "' + SHEET + '" sheet. Choose your 2026 budget template.');
      return wb.sheet(SHEET);
    }).then(function (sh) {
      var cutOver = cfg.cutOver || '9999-12-31';
      var byName = {};
      cfg.categories.forEach(function (c) { byName[c.name.toLowerCase()] = c; if (c.excelName) byName[c.excelName.toLowerCase()] = c; });
      var out = { ready: [], tag: [], notImported: [], blocks: 0, rowsSeen: 0 };
      var blockMonth = null;
      sh.rows.forEach(function (row, ri) {
        if (!row) return;
        var B = row[1], C = row[2], D = row[3], E = row[4];
        var bv = B && B.v, cv = C && C.v != null ? String(C.v).trim() : '', dv = D && D.v != null ? String(D.v).trim() : '', ev = E ? E.v : null;
        if (bv === 'Date' && cv === 'Expense') { out.blocks++; return; }
        // the month title row above each block holds a formula date
        if (B && B.f && /datevalue|eomonth/i.test(B.f) && typeof bv === 'number') { blockMonth = XLSX.serialToDate(bv).slice(0, 7); return; }
        if (!out.blocks) return;               // above the first table
        if (ri < 3) return;
        if (!cv && !dv && (ev === null || ev === '') && (bv === null || bv === undefined)) return; // empty template row
        out.rowsSeen++;
        var line = ri + 1;
        var date = typeof bv === 'number' ? XLSX.serialToDate(bv) : null;
        var amount = typeof ev === 'number' ? U.round2(ev) : (typeof ev === 'string' ? U.calc(ev) : null);
        var base = { line: line, date: date, category: cv, desc: dv, amount: amount, expr: E && E.f ? E.f : (typeof ev === 'string' ? ev : null) };
        if (blockMonth && blockMonth >= cutOver.slice(0, 7)) { base.reason = U.MONTHS[+blockMonth.slice(5) - 1] + ' block, from the cut-over on; bank files cover it'; out.notImported.push(base); return; }
        if (!date) { base.reason = 'no date'; out.notImported.push(base); return; }
        if (date >= cutOver) { base.reason = 'on or after the cut-over (' + cutOver + '); comes from bank files'; out.notImported.push(base); return; }
        if (amount === null) { base.reason = typeof ev === 'string' ? 'amount typed as text that is not a sum' : 'no amount'; out.notImported.push(base); return; }
        if (amount === 0) { base.reason = 'amount is zero'; out.notImported.push(base); return; }
        if (blockMonth && date.slice(0, 7) !== blockMonth) base.flag = 'dated ' + date + ' but sits in the ' + blockMonth + ' block';
        var key = cv.toLowerCase(), cat = byName[ALIAS[key] || key];
        var askExtra = opts.askExtras && (key === 'extra 1' || key === 'extra 2');
        if (!cv || TO_REVIEW[key] || askExtra || !cat) { base.reason = !cv ? 'no category' : (TO_REVIEW[key] || askExtra ? cv + ' was a catch-all; you choose' : 'category "' + cv + '" not in the app'); out.tag.push(base); return; }
        base.cat = cat; out.ready.push(base);
      });
      out.total = out.ready.length + out.tag.length + out.notImported.length;
      out.reconciled = out.total === out.rowsSeen;
      out.sum = U.round2(out.ready.concat(out.tag).reduce(function (a, r) { return a + r.amount; }, 0));
      return out;
    });
  }

  function toTransactions(result, cfg) {
    var stamp = new Date().toISOString();
    return result.ready.concat(result.tag).map(function (r) {
      var type = r.cat ? (r.cat.kind === 'saving' ? 'saving' : 'expense') : 'expense';
      return {
        id: 'x' + r.line + '-' + U.uid().slice(-6), date: r.date, amount: r.amount, expr: r.expr, type: type,
        categoryId: r.cat ? r.cat.id : null, desc: r.desc || (r.cat ? r.cat.name : r.category), note: r.category && !r.cat ? 'Excel: ' + r.category : '',
        needsTag: !r.cat, source: 'excel', excelRow: r.line, flags: r.flag ? [r.flag] : [], createdAt: stamp
      };
    });
  }
  return { analyse: analyse, toTransactions: toTransactions, SHEET: SHEET };
})();
