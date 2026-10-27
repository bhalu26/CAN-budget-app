/* Learning from your own choices, and how sure the app is about a tag. Pure functions: no storage, no screen code.
   History = transactions from the same merchant (merchant key), same direction, already reviewed, last 24 months. */
var Learn = (function () {
  'use strict';
  var SURE_MIN = 5, LIKELY_MIN = 3, LIKELY_SHARE = 0.8;

  function cutoff(today) { var y = +today.slice(0, 4) - 2; return y + today.slice(4); }
  /* Index once per import: { key|direction: { categoryId: count } } */
  function index(txs, today) {
    var from = cutoff(today), idx = {};
    txs.forEach(function (t) {
      if (!t.desc || t.needsTag || !t.categoryId || t.date < from || t.date > today || t.splitGroup) return;   // parts of a split say nothing about where the whole merchant belongs
      var key = M.merchantKey(t.desc); if (!key) return;
      var k = key + '|' + (t.direction || 'out'), c = idx[k] || (idx[k] = {});
      c[t.categoryId] = (c[t.categoryId] || 0) + 1;
    });
    return idx;
  }
  /* -> { categoryId, count, total, share } or null */
  function history(idx, desc, direction) {
    var key = M.merchantKey(desc), c = key && idx[key + '|' + (direction || 'out')];
    if (!c) return null;
    var total = 0, best = null;
    Object.keys(c).forEach(function (id) { total += c[id]; if (!best || c[id] > c[best] || (c[id] === c[best] && id < best)) best = id; });
    return { categoryId: best, count: c[best], total: total, share: c[best] / total, key: key };
  }
  function sure(h) { return !!h && h.total >= SURE_MIN && h.share === 1; }
  function likely(h) { return !!h && h.total >= LIKELY_MIN && h.share >= LIKELY_SHARE; }

  /* How sure a rule match is: an exact/whole-word rule at normal priority or above is "sure"; a "contains" rule is "likely";
     generic fall-backs (priority under 60) and anything that only suggests are "guess". */
  function ruleConfidence(rule) {
    if (!rule) return 'guess';
    if (rule.apply === 'suggest' || rule.priority < 60) return 'guess';
    if ((rule.match === 'exact' || rule.match === 'word') && rule.priority >= 100) return 'sure';
    return 'likely';
  }
  var WORD = { sure: 'Sure', likely: 'Likely', guess: 'Guess' };
  return { index: index, history: history, sure: sure, likely: likely, ruleConfidence: ruleConfidence, WORD: WORD, SURE_MIN: SURE_MIN, LIKELY_MIN: LIKELY_MIN };
})();
