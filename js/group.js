/* Paying for a group (dining out): the bank amount stays on the line, spending counts only your share, and the rest is "owed to you"
   until others pay you back. Repayments are money-in lines linked to the bill (repaysId) so they never count as income, or you can
   note cash received (settled). Pure functions; the share itself is applied by M.counted().
   A bill: an expense line with  share (my share, 0 < share < amount), people (optional, for display), settled (optional cash received). */
var Group = (function () {
  'use strict';
  function cents(v) { return Math.round(Math.abs(v) * 100); }
  function isGroup(t) { return t.type === 'expense' && M.counted(t) !== t.amount; }
  function owedOf(t) { return isGroup(t) ? U.round2(t.amount - t.share) : 0; }
  /* Equal share of a bill for n people (including you), to the cent. */
  function equalShare(amount, people) { var n = Math.floor(+people); return n >= 2 && amount > 0 ? Math.round(amount * 100 / n) / 100 : null; }
  function validate(amount, share) {
    if (share === null || share === undefined || isNaN(share)) return { ok: false, error: 'Enter your share of the bill.' };
    if (!(share > 0)) return { ok: false, error: 'Your share must be more than $0.' };
    if (cents(share) >= cents(amount)) return { ok: false, error: 'Your share must be less than the whole bill (' + U.money(amount, { cents: true }) + '). Untick "paid for others" if it was all yours.' };
    return { ok: true, error: '' };
  }
  function repayments(t, txs) { return txs.filter(function (x) { return x.repaysId === t.id; }); }
  function repaid(t, txs) { return U.round2(repayments(t, txs).reduce(function (a, x) { return a + Math.abs(x.amount); }, 0) + (+t.settled || 0)); }
  /* { owed, repaid, left, extra } : left = still owed to you, extra = paid back more than owed */
  function balance(t, txs) {
    var owed = owedOf(t), got = repaid(t, txs);
    return { owed: owed, repaid: got, left: Math.max(0, U.round2(owed - got)), extra: Math.max(0, U.round2(got - owed)) };
  }
  /* Bills with something still owed, oldest first. */
  function open(txs) {
    return txs.filter(isGroup).map(function (t) { return { t: t, b: balance(t, txs) }; }).filter(function (x) { return x.b.left > 0.004; })
      .sort(function (a, b) { return a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : 0; });
  }
  function totalOpen(txs) { return U.round2(open(txs).reduce(function (a, x) { return a + x.b.left; }, 0)); }
  /* Money-in lines that could be a repayment: not income, not already linked, on or after the bill. */
  function candidates(txs, bill) {
    return txs.filter(function (x) { return x.id !== bill.id && !x.repaysId && x.type !== 'income' && x.type !== 'saving' && (x.direction === 'in' || x.type === 'pending') && x.date >= bill.date; })
      .sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 40);
  }
  /* The incoming line, marked as repaying a bill. It stays visible but is "not counted" (neither income nor spending). */
  function link(incoming, bill, stamp) {
    var p = JSON.parse(JSON.stringify(incoming));
    p.repaysId = bill.id; p.categoryId = '_exclude'; p.type = 'exclude'; p.needsTag = false; p.reviewReason = ''; p.conf = 'sure'; p.tagWhy = 'Repays ' + (bill.desc || 'a group bill'); p.updatedAt = stamp; p.reviewedAt = stamp;
    return p;
  }
  /* Take the link off: back to money in that needs a category. */
  function unlink(incoming, stamp) {
    var p = JSON.parse(JSON.stringify(incoming));
    delete p.repaysId; p.categoryId = null; p.type = 'pending'; p.needsTag = true; p.reviewReason = 'No longer linked to a group bill'; p.conf = 'guess'; p.tagWhy = ''; p.updatedAt = stamp;
    return p;
  }
  return { isGroup: isGroup, owedOf: owedOf, equalShare: equalShare, validate: validate, repayments: repayments, repaid: repaid, balance: balance, open: open, totalOpen: totalOpen, candidates: candidates, link: link, unlink: unlink };
})();
