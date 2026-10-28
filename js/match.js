/* Is it the same merchant, the same amount, the same payment? Shared by Data health (duplicates), Recurring (which lines pay a bill)
   and Import (is a row already in the app). Pure functions.
   Names: bank text varies for one merchant ("NETFLIX.COM VANCOUVER", "Netflix", "APPLE.COM/BILL TORONTO", "AMZN Mktp CA*5101Q3HI0"),
   so names are compared by their words, not as whole strings:
     'same'  the same merchant text
     'close' every word of the shorter name is in the longer one ("NETFLIX" / "NETFLIX COM VANCOUVER", "LANDLORD" / "LANDLORD RENT")
     'weak'  they start with the same word of 4+ letters ("PRE AUTHORIZED PAYMENT" / "PRE AUTHORIZED DEBIT")
   Two different people are not the same merchant: "INVESTMENT ACCOUNT ALEX" / "INVESTMENT ACCOUNT SAM" share words but neither
   name holds all of the other's. */
var Match = (function () {
  'use strict';
  /* words that say nothing about who was paid: card networks, web bits, payment words, provinces */
  var NOISE = {}; ['THE', 'AND', 'OF', 'INC', 'LTD', 'LLC', 'CO', 'CORP', 'COM', 'WWW', 'CA', 'NET', 'ORG', 'HTTPS', 'HTTP', 'POS', 'PURCHASE', 'SQ', 'SP', 'TST', 'PAYPAL',
    'BC', 'AB', 'ON', 'QC', 'MB', 'SK', 'NS', 'NB', 'NL', 'PE', 'YT', 'NT', 'NU', 'CAN', 'CANADA', 'USA', 'US'].forEach(function (w) { NOISE[w] = 1; });
  function key(desc) { return M.merchantKey(desc || ''); }
  function words(desc) { return key(desc).split(' ').filter(function (w) { return w.length >= 2 && !NOISE[w] && !/^\d+$/.test(w); }); }
  /* 'same' | 'close' | 'weak' | null */
  function name(a, b) {
    var ka = key(a), kb = key(b);
    if (!ka || !kb) return null;
    if (ka === kb) return 'same';
    var wa = words(a), wb = words(b);
    if (!wa.length || !wb.length) return null;
    var s = wa.length <= wb.length ? wa : wb, l = s === wa ? wb : wa, has = {};
    l.forEach(function (w) { has[w] = 1; });
    var all = s.every(function (w) { return has[w]; });
    if (all && (s.some(function (w) { return w.length >= 4; }) || s.join(' ') === l.slice(0, s.length).join(' '))) return 'close';   // or a short name at the start
    if (wa[0] === wb[0] && (wa[0].length >= 4 || (wa.length > 1 && wb.length > 1 && wa[1] === wb[1]))) return 'weak';
    return null;
  }
  /* does this bank text belong to a merchant key saved on a recurring bill? The same text always; words in common ('close') only
     when the amount is in the bill's range too ("PHONECO ARENA PARKING $6.50" is not the $55.00 PhoneCo bill). amount: optional. */
  function fits(savedKey, desc, amt, billAmount) {
    var n = name(savedKey, desc);
    if (n === 'same') return true;
    if (n !== 'close') return false;
    if (amt === undefined || !(billAmount > 0)) return true;
    return Math.abs(Math.abs(amt) - billAmount) <= Math.max(5, billAmount * 0.6);
  }
  function cents(v) { return Math.round(Math.abs(v) * 100); }
  /* 'exact' (to the cent) | 'near' (within 50¢ or 2%: a typo, a rounding, a currency conversion) | null */
  function amount(a, b) {
    var x = cents(a), y = cents(b); if (!x || !y) return null;
    if (x === y) return 'exact';
    return Math.abs(x - y) <= Math.max(50, Math.round(Math.max(x, y) * 0.02)) ? 'near' : null;
  }
  function day(d) { var p = d.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5; }
  function out(t) { return t.direction ? t.direction === 'out' : t.amount > 0; }
  /* where a line came from: 'bank' (an imported file) or 'hand' (typed, logged for you, or from the Excel history: free-form text) */
  function origin(t) { return t.source === 'csv' && !t.auto ? 'bank' : 'hand'; }
  var money = function (v) { return U.money(Math.abs(v), { cents: true }); };

  /* Could these two lines be one payment counted twice? -> null, or { level: 'high'|'medium'|'low', why, gap }.
     Never: money in against money out (a purchase and its refund), two parts of one split, the two sides of a transfer,
     a repayment and its bill, two lines from one bank file on different days (the bank listed two charges). */
  function dup(x, y) {
    if (!x.date || !y.date || x.id === y.id) return null;
    if (out(x) !== out(y)) return null;
    if (x.type === 'exclude' || y.type === 'exclude') return null;
    if (x.linkId && x.linkId === y.linkId) return null;
    if (x.splitGroup && (x.splitGroup === y.splitGroup || x.splitGroup === y.id) || y.splitGroup && y.splitGroup === x.id) return null;
    if (x.repaysId === y.id || y.repaysId === x.id) return null;
    var gap = Math.abs(day(x.date) - day(y.date)); if (gap > 7) return null;
    var am = amount(x.amount, y.amount); if (!am) return null;
    var nm = name(x.desc, y.desc), cat = !!x.categoryId && x.categoryId === y.categoryId && x.categoryId.charAt(0) !== '_';
    var ox = origin(x), oy = origin(y), when = gap === 0 ? 'the same day' : gap === 1 ? 'a day apart' : gap + ' days apart';
    var amt = am === 'exact' ? '' : ' (' + money(x.amount) + ' and ' + money(y.amount) + ')';
    if (ox === 'bank' && oy === 'bank') {
      if (am !== 'exact' || !(nm === 'same' || nm === 'close')) return null;
      if (x.batchId && x.batchId === y.batchId) return gap === 0 && nm === 'same' ? { level: 'low', why: 'Repeated in the same file', gap: gap } : null;
      if (x.accountId && x.accountId !== y.accountId) return gap <= 1 && nm === 'same' ? { level: 'low', why: 'The same charge in two accounts ' + when + ' (a card payment, or one counted twice?)', gap: gap } : null;
      if (gap === 0) return { level: 'high', why: 'In two different imports', gap: gap };
      if (gap <= 2) return { level: 'medium', why: 'Same amount and merchant ' + when + ' in two imports', gap: gap };
      return null;
    }
    if (ox !== oy) {   // typed (or Excel) and imported: the bank's date and amount can differ a little
      if (gap > 3) return null;   // a typed line and the bank's posting: at most a few days apart (small repeat buys are common)
      var named = nm === 'same' || nm === 'close', likely = named || (nm === 'weak' && cat) || (cat && am === 'exact' && gap <= 3);
      if (!likely && !(am === 'exact' && gap <= 1 && !nm && (!x.desc || !y.desc))) return null;
      var level = am === 'exact' && gap <= 1 && (named || cat) ? 'high' : 'medium';
      return { level: level, why: 'Typed by hand and also imported, ' + when + amt, gap: gap };
    }
    // both typed or from the Excel history
    if (am !== 'exact' || gap > 1) return null;
    if (nm === 'same' || nm === 'close') return { level: 'low', why: 'Entered twice? Same amount and merchant ' + when + ' (or two real ones, like two tickets)', gap: gap };
    return null;
  }
  return { key: key, words: words, name: name, fits: fits, amount: amount, dup: dup, origin: origin, NOISE: NOISE };
})();
