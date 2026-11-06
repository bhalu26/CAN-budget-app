/* Masking for the layout dump. Plain functions, no page access, so they can be tested on their own.
   Rules:
   - every digit becomes 9
   - every letter becomes x (capital letters become X), unless the word is on the "statement vocabulary" list
     (Date, Description, Balance, months, ...) or you asked to keep it
   - words you ask to hide are always masked, even if they are on the vocabulary list
   - punctuation and spacing are kept, so the shape of dates, amounts and descriptions stays visible */
var Mask = (function () {
  'use strict';

  var LIST = [
    'date dates posting posted post trans transaction transactions description descriptions details detail particulars narrative memo reference ref cheque check no number num',
    'debit debits credit credits withdrawal withdrawals deposit deposits amount amounts balance balances opening closing previous new forward brought carried',
    'statement statements period account accounts chequing checking savings saving card cards visa mastercard amex interac',
    'total totals subtotal summary payment payments purchase purchases interest fee fees charge charges rate annual apr limit available minimum due',
    'cash advance advances refund refunds reversal adjustment rewards points transfer transfers etransfer e bill online mobile banking atm pos',
    'page of from to for and the by at on in out paid money cr dr od continued thank you plus less equals minus sub',
    'relevé releve période periode compte comptes solde soldes retrait retraits dépôt depot dépôts depots débit crédit montant frais intérêts interets paiement paiements achat achats virement virements facture de du des le la les et au aux',
    'january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec',
    'janvier février fevrier mars avril mai juin juillet août aout septembre octobre novembre décembre decembre janv févr fevr avr juil déc',
    'monday tuesday wednesday thursday friday saturday sunday mon tue tues wed thu thur thurs fri sat sun',
    'cad usd eur gbp aud'
  ].join(' ');

  function key(w) { return String(w).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

  var VOCAB = {};
  LIST.split(/\s+/).forEach(function (w) { if (w) VOCAB[key(w)] = 1; });

  var RUN = /(\p{L}+)|(\p{Nd}+)|([^\p{L}\p{Nd}]+)/gu;
  var KEEP_SYM = /[\s!-\/:-@\[-`{-~$€£¥•·–—‘’“”«»−]/;

  /* "Padma Venkataraman, 12 Oak St" -> {padma:1, venkataraman:1, oak:1, st:1} */
  function wordsOf(x) {
    var out = {};
    (Array.isArray(x) ? x : [x || '']).forEach(function (s) {
      String(s).split(/[^\p{L}]+/u).forEach(function (w) { if (w.length >= 2) out[key(w)] = 1; });
    });
    return out;
  }
  function context(opts) { opts = opts || {}; return { keep: wordsOf(opts.keep), hide: wordsOf(opts.hide) }; }
  function readable(k, ctx) { return !ctx.hide[k] && (!!VOCAB[k] || !!ctx.keep[k]); }

  function cased(raw) {
    var o = '';
    Array.from(raw).forEach(function (c) { o += /\p{Lu}/u.test(c) ? 'X' : 'x'; });
    return o;
  }

  /* -> { out: masked text, tokens: [{ raw, out, k, alpha, readable }] } */
  function mask(text, ctx) {
    var tokens = [], out = '', m;
    RUN.lastIndex = 0;
    String(text).replace(RUN, function (all, a, d, o) {
      var t;
      if (a) { var k = key(a), ok = readable(k, ctx); t = { raw: a, out: ok ? a : cased(a), k: k, alpha: true, readable: ok }; }
      else if (d) { t = { raw: d, out: Array.from(d).map(function () { return '9'; }).join(''), alpha: false }; }
      else { t = { raw: o, out: Array.from(o).map(function (c) { return KEEP_SYM.test(c) ? c : '?'; }).join(''), alpha: false }; }
      tokens.push(t); out += t.out; return all;
    });
    return { out: out, tokens: tokens };
  }
  function text(s, ctx) { return mask(s, ctx).out; }

  /* Independent check of a finished export: every string must contain only 9 as a digit, only X/x or
     readable words as letters, and only plain punctuation. Strings listed in `allow` are fixed constants.
     Returns a list of problems (empty = clean). */
  function audit(value, ctx, allow, path, found) {
    found = found || []; path = path || '$'; allow = allow || {};
    if (typeof value === 'string') {
      if (allow[value]) return found;
      var m;
      RUN.lastIndex = 0;
      while ((m = RUN.exec(value))) {
        if (m[1]) { if (!/^[Xx]+$/.test(m[1]) && !readable(key(m[1]), ctx)) found.push({ path: path, why: 'a word that is not masked' }); }
        else if (m[2]) { if (!/^9+$/.test(m[2])) found.push({ path: path, why: 'a digit that is not masked' }); }
        else { Array.from(m[3]).forEach(function (c) { if (!KEEP_SYM.test(c) && c !== '?') found.push({ path: path, why: 'an unexpected character' }); }); }
      }
    } else if (Array.isArray(value)) {
      value.forEach(function (v, i) { audit(v, ctx, allow, path + '[' + i + ']', found); });
    } else if (value && typeof value === 'object') {
      Object.keys(value).forEach(function (k) { audit(value[k], ctx, allow, path + '.' + k, found); });
    }
    return found;
  }

  return { VOCAB: VOCAB, key: key, wordsOf: wordsOf, context: context, readable: readable, mask: mask, text: text, audit: audit };
})();
if (typeof module !== 'undefined') module.exports = Mask;
