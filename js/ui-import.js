/* Import bank CSV files: read every row, show them all for review, then import all or only the ones you pick. */
var Importer = (function () {
  'use strict';
  var h = U.h;
  var files = [];       // [{name, rows, L, sig, accountId, newAcct, entries, items, filter, summary}]
  var cur = 0;

  /* ---------- rules ---------- */
  function allRules() {
    var rows = M.ruleRows(App.cfg);   // personal + general, without rules turned off in Tagging rules
    return rows.length > 1 ? Engine.loadRules(rows) : [];
  }
  function catIdByName(name) {
    if (!name) return null;
    var n = String(name).toLowerCase();
    if (n === 'exclude' || n === 'not counted') return '_exclude';
    var c = App.cfg.categories.filter(function (x) { return x.name.toLowerCase() === n || (x.excelName || '').toLowerCase() === n; })[0];
    return c ? c.id : null;
  }

  /* ---------- reading a file ---------- */
  function addFile(name, text) {
    var rows = Engine.parseCSV(text.replace(/^\uFEFF/, '')).rows;
    var inf = Detect.infer(rows), L = inf.L;
    var f = { name: name, rows: rows, L: L, sig: Engine.layoutSignature(rows, L), filter: 'all', fixes: {}, dirCol: inf.dirCol, explain: inf.explain, inferred: inf.changed, complete: inf.complete, kindGuess: inf.kindGuess, balCol: inf.balCol };
    var prof = (App.cfg.profiles || {})[f.sig];
    if (prof) { f.L.cols = Object.assign({}, prof.cols); if (prof.dirCol !== undefined) f.dirCol = prof.dirCol; if (prof.balCol !== undefined) f.balCol = prof.balCol; f.known = true; }
    f.ident = Detect.identify(rows, f.L, name);
    var m = Detect.matchAccount(App.cfg, f.ident, f.sig);
    f.accountId = m.accountId; f.matchWhy = m.why || ''; f.suggestNew = m.suggestNew || null; f.maybeSame = m.maybeSame || null;
    if (f.suggestNew && !f.suggestNew.kind) f.suggestNew.kind = f.kindGuess || 'bank';
    var hdr = L.headerIdx >= 0 ? rows[L.headerIdx].map(function (x) { return x.trim().toLowerCase(); }) : [];
    f.hintCol = hdr.indexOf('merchant category description');
    f.codeCol = ['transaction', 'activity_sub_type'].map(function (n) { return hdr.indexOf(n); }).filter(function (i) { return i >= 0; })[0];
    if (f.codeCol === undefined) f.codeCol = -1;
    files.push(f);
    analyse(f);
  }

  function acct(id) { return (App.cfg.accounts || []).filter(function (a) { return a.id === id; })[0]; }

  var ruleById = {}, learnIdx = null;
  /* Which way round a file's amounts are: 'card' (purchases positive) or 'bank' (money out negative). The account suggests it,
     but many card files list purchases as negative: when nearly every spending row would read as money coming in, the other
     way is tried, kept if it reads sensibly, and remembered for this bank's format once imported. You can always switch it. */
  function analyse(f) {
    var a = acct(f.accountId), base = (a ? a.kind : (f.suggestNew ? f.suggestNew.kind : 'bank')) === 'card' ? 'card' : 'bank';
    var prof = f.sig && (App.cfg.profiles || {})[f.sig], saved = prof && prof.signMode;
    var mode = f.signMode || saved || base;
    f.signAuto = false;
    analyseWith(f, mode);
    if (!f.signMode && !saved && f.accountId && backwards(f)) {
      var other = mode === 'card' ? 'bank' : 'card';
      analyseWith(f, other);
      if (backwards(f)) analyseWith(f, other = mode); else f.signAuto = true;
      mode = other;
    }
    f.signUsed = mode;
  }
  /* most spending rows read as money in ("refund?"): the file's signs are the other way round */
  function backwards(f) {
    var rows = f.items.filter(function (it) { return it.selectable && it.amountRaw !== null && it.amountRaw !== undefined; });
    var refund = rows.filter(function (it) { return it.amountRaw > 0 && (it.type === 'expense' || it.type === 'pending'); }).length;
    return rows.length >= 3 && refund >= Math.max(2, rows.length * 0.6);
  }
  function analyseWith(f, mode) {
    var rules = allRules();
    ruleById = {}; rules.forEach(function (r) { ruleById[r.id] = r; });
    learnIdx = Learn.index(App.txs, U.today());
    var res = Engine.importRows(f.rows, f.L, rules, { signMode: mode, hintCol: f.hintCol, codeCol: f.codeCol, dirCol: f.dirCol });
    f.summary = res.summary;
    var cutOver = App.cfg.cutOver || '';
    var existing = {};
    App.txs.forEach(function (t) { if (t.fp) existing[t.fp] = true; });
    var also = {};   // lines already in a file loaded earlier in this batch (same account, not imported yet): the same statement loaded twice
    files.slice(0, Math.max(0, files.indexOf(f))).forEach(function (g) { if (g.done || !g.items || g.accountId !== f.accountId) return; g.items.forEach(function (x) { if (x.fp && x.selectable && x.state !== 'dup') also[x.fp] = g.name; }); });
    var oldSel = {};
    (f.items || []).forEach(function (it) { oldSel[it.line] = { selected: it.selected, catId: it.catId, touched: it.touched, dupChoice: it.dupChoice }; });
    var near = nearIndex(), claimed = {};
    f.items = [];
    res.entries.forEach(function (e) {
      if (e.status !== 'ok' && e.status !== 'tag' && e.status !== 'error') return;
      var it = { line: e.line, raw: e.raw, desc: e.desc, date: e.date, amountRaw: e.amount, flags: (e.flags || []).slice(), reasons: [], code: e.code || '' };
      var fx = f.fixes[e.line];
      if (e.status === 'error' && fx) {
        var d = fx.date && U.validDate(fx.date) ? fx.date : (e.date || null), am = fx.amount !== undefined ? U.calc(fx.amount) : e.amount;
        if (d && am !== null && am !== undefined) { it.date = d; it.amountRaw = a && a.kind === 'card' && f.L.cols.amount >= 0 && fx.amount !== undefined ? -am : am; e.status = 'tag'; e.match = Engine.classify(e.desc, allRules()); it.flags.push('fixed by hand'); }
      }
      if (e.status === 'error') { it.state = 'fix'; it.reasons.push(e.reason); it.selectable = false; it.selected = false; f.items.push(it); return; }
      decide(it, e.match || { status: 'unmatched' }, e.splits);
      it.fp = fp(f.accountId, it.date, it.amountRaw, it.desc);
      var o = oldSel[it.line], mb = null;
      it.dupChoice = o && o.dupChoice;
      if (existing[it.fp]) { it.state = 'dup'; it.reasons.unshift('Already in the app'); }
      else if (f.accountId && also[it.fp]) { it.state = 'dup'; it.reasons.unshift('Also in ' + also[it.fp] + ' (loaded together): imported once'); }
      else if (it.date < cutOver) { it.state = 'before'; it.reasons.unshift('Before your cut-over (' + cutOver + '); Excel history covers it'); }
      else if (f.accountId && (mb = maybeDup(f, it, near, claimed))) {
        it.maybe = mb; claimed[mb.t.id] = 1;
        if (it.dupChoice === 'replace' && mb.t.categoryId && !it.touched) { it.catId = mb.t.categoryId; it.touched = true; it.reasons = []; it.review = false; applyCat(it); }   // the bank's line takes your typed line's category
        if (it.dupChoice === 'keep' || it.dupChoice === 'replace') it.state = it.review ? 'review' : 'ready';
        else { it.state = 'maybe'; it.reasons.unshift(mb.why); }
      }
      else it.state = it.review ? 'review' : 'ready';
      it.selectable = true;
      it.selected = it.state === 'maybe' ? false : o && o.dupChoice === undefined ? o.selected : (it.state === 'ready' || it.state === 'review');
      if (o && o.touched) { it.catId = o.catId; it.touched = true; applyCat(it); }
      f.items.push(it);
    });
    f.balance = f.balCol >= 0 ? Accounts.fromFile(f.items.filter(function (it) { return it.state !== 'fix'; }).map(function (it) { return { date: it.date, balance: Engine.parseAmountStr((it.raw || [])[f.balCol]) }; })) : null;
    f.recon = f.balCol >= 0 ? Health.fileCheck(f.items.filter(function (it) { return it.state !== 'fix'; }).map(function (it) { return { date: it.date, amount: it.amountRaw, balance: Engine.parseAmountStr((it.raw || [])[f.balCol]), line: it.line }; })) : null;
  }
  /* lines already in the app by date, to compare each row with the ones a week either side */
  function nearIndex() { var by = {}; App.txs.forEach(function (t) { if (t.date) (by[t.date] = by[t.date] || []).push(t); }); return by; }
  /* the line already in the app that this row most likely repeats (Match.dup), or null */
  function maybeDup(f, it, near, claimed) {
    if (!it.date || it.amountRaw === null || it.amountRaw === undefined) return null;
    var row = { id: '__row', date: it.date, amount: Math.abs(it.amountRaw), direction: it.amountRaw < 0 ? 'out' : 'in', desc: it.desc, categoryId: it.catId, type: it.type, source: 'csv', accountId: f.accountId, batchId: '__new' };
    var best = null, rank = { high: 3, medium: 2, low: 1 };
    for (var k = -7; k <= 7; k++) {
      (near[Recurring.addDays(it.date, k)] || []).forEach(function (t) {
        if (claimed[t.id] || (t.auto && t.updatedAt === t.createdAt)) return;   // a line logged for a missed bill: the real payment replaces it by itself
        var r = Match.dup(row, t); if (!r || r.level === 'low') return;
        if (!best || rank[r.level] > rank[best.level] || (rank[r.level] === rank[best.level] && r.gap < best.gap)) best = { t: t, level: r.level, gap: r.gap, why: r.why };
      });
    }
    if (!best) return null;
    var t = best.t, hand = Match.origin(t) === 'hand';
    best.hand = hand && t.source !== 'excel';
    best.why = 'Possible duplicate of ' + (t.desc || UI.catName(t.categoryId)) + ' ' + U.money(Math.abs(t.amount), { cents: true }) + ' on ' + U.shortDate(t.date) +
      (t.source === 'manual' ? ' (typed by hand)' : t.source === 'excel' ? ' (Excel history)' : t.auto ? ' (logged for you)' : ' (' + (UI.acctName(t) || 'another import') + ')');
    return best;
  }
  /* Under a possible duplicate (or one you decided on): what it seems to repeat, and the three answers */
  function dupChoice(f, it) {
    if (!it.maybe || (it.state !== 'maybe' && !it.dupChoice)) return null;
    var t = it.maybe.t, pick = function (c) { return function () { it.dupChoice = c; analyse(f); App.render(); }; };
    var said = { keep: 'Will be imported as a separate payment.', replace: 'Will replace your typed line (Undo puts it back).', skip: 'Left out: it is already in the app.' }[it.dupChoice];
    return h('div', { class: 'dup-choice small row between', role: 'group', 'aria-label': 'Possible duplicate of row ' + it.line },
      h('div', null, h('div', null, 'Row ' + it.line + ' may already be in the app: ', h('strong', null, (t.desc || UI.catName(t.categoryId)) + ' · ' + U.money(Math.abs(t.amount), { cents: true }) + ' · ' + U.shortDate(t.date)),
        ' · ' + (t.source === 'manual' ? 'typed by hand' : t.source === 'excel' ? 'Excel history' : t.auto ? 'logged for you' : UI.acctName(t) || 'imported')),
      said ? h('div', { class: 'muted' }, said) : null),
      h('div', { class: 'row', style: { gap: '6px' } },
        h('button', { type: 'button', class: 'btn small-btn', 'aria-pressed': it.dupChoice === 'skip' || !it.dupChoice ? 'true' : 'false', onclick: pick('skip') }, 'Same: leave it out'),
        h('button', { type: 'button', class: 'btn small-btn', 'aria-pressed': it.dupChoice === 'keep' ? 'true' : 'false', onclick: pick('keep') }, 'Different: import it'),
        it.maybe.hand ? h('button', { type: 'button', class: 'btn small-btn', 'aria-pressed': it.dupChoice === 'replace' ? 'true' : 'false', onclick: pick('replace') }, 'Replace mine with the bank\'s') : null));
  }
  function fp(accountId, date, amount, desc) { return [accountId || '', date, amount, M.merchantKey(desc)].join('|'); }

  /* Decide type, category and whether to flag for review. */
  function decide(it, k, splits) {
    var norm = k.norm || '';
    var key = M.merchantKey(it.desc);
    var userRule = (App.cfg.rules || []).filter(function (r) { return r.merchant === key; })[0];
    it.review = false; it.splits = null; it.conf = 'guess'; it.why = ''; it.fundId = null;
    function ruleWhy(id) { var r = ruleById[id]; return r ? 'Rule ' + r.id + ' (' + r.pattern + ')' : ''; }
    if (userRule) { it.catId = userRule.categoryId; it.ruleNote = 'your rule'; it.conf = 'sure'; it.why = 'Your Always rule for ' + key; }
    else if (k.type === 'transfer' || k.type === 'income' || k.type === 'exclude') {
      it.catId = k.type === 'transfer' ? '_transfer' : k.type === 'income' ? '_income' : '_exclude';
      if (k.type === 'income' && k.typeApply === 'suggest') { it.review = true; it.reasons.push('Suggested as income'); }
      it.conf = Learn.ruleConfidence(ruleById[k.typeRule]); it.why = ruleWhy(k.typeRule);
    } else {
      /* your past choices for this merchant (same direction), then the rules */
      var hist = learnIdx ? Learn.history(learnIdx, it.desc, it.amountRaw < 0 ? 'out' : 'in') : null;
      var ruleCat = catIdByName(k.category), histWhy = hist ? 'You chose ' + UI.catName(hist.categoryId) + ' for ' + hist.key + ' ' + hist.count + ' of ' + hist.total + ' times' : '';
      if (k.type !== 'review' && Learn.sure(hist) && hist.categoryId !== ruleCat) {
        it.catId = hist.categoryId; it.conf = 'sure'; it.why = histWhy;
      } else if (k.type !== 'review' && Learn.likely(hist) && (!ruleCat || k.catApply === 'suggest') && hist.categoryId !== ruleCat) {
        it.catId = hist.categoryId; it.review = true; it.reasons.push('Suggested from your past choices'); it.conf = 'likely'; it.why = histWhy;
      } else {
        it.catId = ruleCat;
        if (k.type === 'review') { it.review = true; it.reasons.push('Check this one: the bank text could mean several things'); it.why = ruleWhy(k.typeRule); }
        else if (!it.catId) { it.review = true; it.reasons.push(k.category ? 'Rule category "' + k.category + '" is not in your categories' : 'No rule matched'); it.why = k.category ? ruleWhy(k.catRule) : 'No rule matched'; }
        else {
          if (k.catApply === 'suggest') { it.review = true; it.reasons.push('Suggested category'); }
          it.conf = Learn.ruleConfidence(ruleById[k.catRule]); it.why = ruleWhy(k.catRule);
          if (Learn.sure(hist) && hist.categoryId === it.catId) { it.conf = 'sure'; it.why += ' and your past choices agree'; }
        }
      }
    }
    if (it.catId === '_transfer' || /\bTRANSFER\b|\bTFR\b/.test(norm)) { it.review = true; it.reasons.push('Transfer: check it is between your own accounts'); }
    if (splits && splits.length) {
      it.splits = splits.map(function (p) { return { catId: catIdByName(p.category), amountRaw: p.amount, name: p.category }; });
      it.flags.push('split: ' + splits.map(function (p) { return (p.category === 'exclude' ? 'not counted' : p.category) + ' ' + U.money(Math.abs(p.amount), { cents: true }); }).join(' + '));
    }
    /* a big expense coming due: suggest paying it from its fund (always checked in Review) */
    var fund = !it.splits && it.amountRaw < 0 && (!it.catId || M.typeFor(App.cfg, it.catId) === 'expense') ? Funds.suggest(App.cfg, App.txs, it.desc, it.date, -it.amountRaw) : null;
    if (fund) {
      if (!it.catId && fund.categoryId) it.catId = fund.categoryId;
      it.fundId = fund.id; it.review = true; it.reasons.push('Looks like your ' + fund.name + ': paid from its fund, not this month\'s budget');
    }
    applyCat(it);
    if (it.type !== 'expense') it.fundId = null;
  }
  function applyCat(it) {
    it.type = it.catId ? M.typeFor(App.cfg, it.catId) : 'expense';
    if (it.type === 'expense' && it.amountRaw > 0 && !it.splits) { if (it.reasons.indexOf('Money in on a spending category (refund?)') < 0) it.reasons.push('Money in on a spending category (refund?)'); it.review = true; }
    if (it.type === 'income' && it.amountRaw < 0) { it.review = true; it.reasons.push('Money out marked as income'); }
  }

  /* ---------- importing ---------- */
  function toTx(f, it, batchId, stamp) {
    var a = acct(f.accountId);
    function one(catId, amountRaw, extraFlag) {
      /* Money in with no category yet is not counted anywhere until you tag it (it is not a refund). */
      var type = catId ? M.typeFor(App.cfg, catId) : (amountRaw > 0 ? 'pending' : 'expense');
      var amount = type === 'income' ? amountRaw : (type === 'transfer' || type === 'exclude' || type === 'pending') ? Math.abs(amountRaw) : -amountRaw;
      return { id: U.uid(), date: it.date, amount: U.round2(amount), type: type, categoryId: catId || null, desc: it.desc, note: '', account: a ? a.name : '', accountId: f.accountId,
        direction: amountRaw < 0 ? 'out' : 'in', source: 'csv', batchId: batchId, file: f.name, line: it.line, fp: it.fp,
        needsTag: !it.touched && (it.review || !catId), reviewReason: it.touched ? '' : it.reasons.filter(function (r) { return !/^Before|^Already/.test(r); }).join('; '),
        conf: it.touched ? 'sure' : (it.conf || 'guess'), tagWhy: it.touched ? 'You chose this when importing' : (it.why || ''),
        flags: it.flags.concat(extraFlag ? [extraFlag] : []), createdAt: stamp, fundId: it.fundId && type === 'expense' && !extraFlag ? it.fundId : undefined };
    }
    if (it.splits && !it.touched) return it.splits.map(function (p) { return one(p.catId, p.amountRaw, 'split part'); });
    return [one(it.catId, it.amountRaw)];
  }
  function doImport(f, which, quiet) {
    var chosen = f.items.filter(function (it) { return it.selectable && (which === 'all' ? (it.state === 'ready' || it.state === 'review') : it.selected); });
    if (!f.accountId) { if (!quiet) UI.toast('Choose which account this file is from first.'); return Promise.resolve(0); }
    if (!chosen.length) { if (!quiet) UI.toast('Nothing selected to import.'); return Promise.resolve(0); }
    var batchId = U.uid(), stamp = new Date().toISOString(), list = [];
    chosen.forEach(function (it) { list = list.concat(toTx(f, it, batchId, stamp)); });
    App.cfg.batches = (App.cfg.batches || []).concat([{ id: batchId, file: f.name, accountId: f.accountId, at: stamp, rows: chosen.length, tx: list.length,
      readRows: f.summary.ok + f.summary.tag + f.summary.error, notImported: f.items.length - chosen.length,
      recon: f.recon && f.recon.checked ? { days: f.recon.checked, breaks: f.recon.breaks.length } : null }]);
    App.cfg.profiles = App.cfg.profiles || {};
    App.cfg.profiles[f.sig] = { accountId: f.accountId, cols: Object.assign({}, f.L.cols), dirCol: f.dirCol, balCol: f.balCol, savedAt: stamp, format: f.ident.format || '', bank: f.ident.bank || '', signMode: f.signUsed };
    // "Replace mine": the bank's line takes the place of a line you typed (kept with the import, so Undo brings it back)
    var replaced = chosen.filter(function (it) { return it.dupChoice === 'replace' && it.maybe && it.maybe.hand; }).map(function (it) { return JSON.parse(JSON.stringify(it.maybe.t)); });
    if (replaced.length) App.cfg.batches[App.cfg.batches.length - 1].replaced = replaced;
    var ac = acct(f.accountId);
    if (ac && f.balance) ac.balances = Accounts.setBalance(ac, f.balance.date, Accounts.isDebt(ac) ? Math.abs(f.balance.amount) : f.balance.amount, 'import', batchId);   // the bank's closing balance
    if (ac) { ac.numbers = ac.numbers || []; f.ident.numbers.forEach(function (n) { if (ac.numbers.indexOf(n.last4) < 0) ac.numbers.push(n.last4); }); if (!ac.bank && f.ident.bank) ac.bank = f.ident.bank; }
    return DB.putAll(App.cfg, list).then(function () { return replaced.length ? DB.deleteTx(replaced.map(function (t) { return t.id; })) : null; }).then(UI.reload).then(function () {
      var linked = M.linkTransfers(App.cfg, App.txs);
      return linked.length ? DB.putTx(linked).then(UI.reload).then(function () { return linked.length / 2; }) : 0;
    }).then(function (pairs) {
      f.done = { rows: chosen.length, tx: list.length, review: App.txs.filter(function (t) { return t.batchId === batchId && t.needsTag; }).length, batchId: batchId, pairs: pairs, replaced: replaced.length };
      return RecurringUI.autoLog({ force: true, quiet: true });   // a real payment replaces a line logged for it
    }).then(function (logged) {
      f.done.logged = logged || '';   // "Import all files" adds these to its own message
      analyse(f);
      if (!quiet) { App.render(); UI.toast('Imported ' + chosen.length + ' of ' + f.items.length + ' rows from ' + f.name + '.' + (logged ? ' ' + logged : ''), function () { undo(batchId); }); }
      return chosen.length;
    });
  }
  function undo(batchId) {
    var gone = App.txs.filter(function (t) { return t.batchId === batchId; }), ids = gone.map(function (t) { return t.id; });
    var links = {}; gone.forEach(function (t) { if (t.linkId) links[t.linkId] = 1; });
    var partners = App.txs.filter(function (t) { return t.linkId && links[t.linkId] && ids.indexOf(t.id) < 0; }).map(function (t) {
      var n = JSON.parse(JSON.stringify(t)); delete n.linkId; n.flags = (n.flags || []).filter(function (f) { return f.indexOf('matches ') !== 0; }); return n; });
    var back = ((App.cfg.batches || []).filter(function (b) { return b.id === batchId; })[0] || {}).replaced || [];   // lines this import replaced
    partners = partners.concat(back);
    App.cfg.batches = (App.cfg.batches || []).filter(function (b) { return b.id !== batchId; });
    (App.cfg.accounts || []).forEach(function (a) { if (a.balances) a.balances = a.balances.filter(function (b) { return b.batchId !== batchId; }); });
    return Safety.snapshot('undo-import').then(function () { return DB.deleteTx(ids); }).then(function () { return partners.length ? DB.putTx(partners) : null; }).then(UI.saveCfg).then(UI.reload).then(function () {
      return RecurringUI.autoLog({ force: true, quiet: true });   // a bill the import had paid is missing again
    }).then(function (logged) {
      files.forEach(function (f) { if (f.done && f.done.batchId === batchId) f.done = null; analyse(f); });
      App.render(); UI.toast('Undone: ' + ids.length + ' transactions removed.' + (logged ? ' ' + logged : ''));
    });
  }

  /* ---------- screen ---------- */
  var allPrompt = null;   // after "Import all files": { names, rows, review }
  function pref(k) { try { return localStorage.getItem('ob.import.' + k) === '1'; } catch (e) { return false; } }
  function setPref(k, on) { try { localStorage.setItem('ob.import.' + k, on ? '1' : '0'); } catch (e) { /* private window: the choice lasts until reload */ } }
  var recentOn = null;
  function closeFile(f) {
    var i = files.indexOf(f); if (i < 0) return;
    files.splice(i, 1);
    var next = files.findIndex(function (x) { return !x.done; });
    cur = next >= 0 ? next : Math.max(0, Math.min(cur, files.length - 1));
  }

  function render(main) {
    Safety.guard('import', files.some(function (f) { return !f.done; }));
    if (recentOn === null) recentOn = pref('recent');
    main.appendChild(h('header', { class: 'stack-sm' }, h('h1', null, 'Import bank files'),
      h('div', { class: 'muted' }, 'Choose your bank\'s CSV files. You see every row before anything is saved, and every import can be undone.')));
    var hasRules = App.cfg.ruleSets && (App.cfg.ruleSets.general || App.cfg.ruleSets.personal);
    if (!hasRules) main.appendChild(h('div', { class: 'toast warn' }, h('span', null, 'No tagging rules loaded yet, so every row will need a category. Load rules-general.csv and rules-personal.csv in Settings.'), h('a', { class: 'btn', href: '#/settings' }, 'Go to Settings')));
    var input = h('input', { id: 'csvf', type: 'file', accept: '.csv,text/csv', multiple: true, class: 'input', style: { paddingTop: '8px' }, onchange: function (e) {
      var list = Array.prototype.slice.call(e.target.files);
      Promise.all(list.map(function (fl) { return U.readFile(fl).then(function (t) { return { name: fl.name, text: t }; }); })).then(function (rs) {
        allPrompt = null;
        rs.forEach(function (r) { try { addFile(r.name, r.text); } catch (err) { UI.toast('Could not read ' + r.name + ': ' + err.message); } });
        cur = files.length - 1; App.render();
      });
    } });
    main.appendChild(h('div', { class: 'card pad stack-sm' }, h('div', { class: 'field', style: { maxWidth: '460px' } }, h('label', { for: 'csvf' }, '1. Choose one or more CSV files'), input)));

    if (allPrompt) main.appendChild(h('section', { class: 'card pad stack-sm prompt', 'aria-label': 'Import finished', role: 'status' },
      h('strong', null, '✓ Imported ' + allPrompt.rows + ' rows from ' + allPrompt.names.length + ' files.'),
      h('div', { class: 'small muted' }, allPrompt.review ? allPrompt.review + ' flagged rows are waiting in Review. ' : '', 'Close these files, or keep them open to look at the rows again?'),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn primary', onclick: function () { files.filter(function (f) { return f.done; }).forEach(closeFile); allPrompt = null; App.render(); } }, 'Close these files'),
        h('button', { type: 'button', class: 'btn', onclick: function () { allPrompt = null; App.render(); } }, 'Keep them open'),
        allPrompt.review ? h('a', { class: 'btn', href: '#/transactions?f=review' }, 'Review flagged rows') : null)));

    if (files.length > 1) {
      var pending = files.filter(function (f) { return !f.done; });
      var noAcct = pending.filter(function (f) { return !f.accountId; });
      var rowsAll = pending.reduce(function (a, f) { return a + f.items.filter(function (it) { return it.state === 'ready' || it.state === 'review'; }).length; }, 0);
      main.appendChild(h('div', { class: 'row between' },
        h('div', { class: 'row', role: 'tablist', 'aria-label': 'Files' }, files.map(function (f, i) {
          return h('button', { type: 'button', role: 'tab', class: 'chip', 'aria-pressed': i === cur ? 'true' : 'false', 'aria-selected': i === cur ? 'true' : 'false', onclick: function () { cur = i; App.render(); } }, f.name + (f.done ? ' ✓' : ''));
        })),
        pending.length > 1 ? h('button', { type: 'button', class: 'btn primary', disabled: noAcct.length > 0 || !rowsAll, title: noAcct.length ? 'Still needs an account: ' + noAcct.map(function (f) { return f.name; }).join(', ') : null, onclick: function () {
          var total = 0, review = 0, names = pending.map(function (f) { return f.name; }), chain = Promise.resolve();
          pending.forEach(function (f) { chain = chain.then(function () { return doImport(f, 'all', true).then(function (n) { total += n; review += f.done ? f.done.review : 0; }); }); });
          chain.then(function () {
            var logged = pending.map(function (f) { return f.done ? f.done.logged : ''; }).filter(Boolean);   // logged lines taken out (or logged) along the way
            allPrompt = { names: names, rows: total, review: review }; App.render(); UI.toast('Imported ' + total + ' rows from ' + pending.length + ' files.' + (logged.length ? ' ' + logged.join(' ') : ''));
          });
        } }, 'Import all files (' + rowsAll + ' rows)') : null));
      if (pending.length > 1 && noAcct.length) main.appendChild(h('div', { class: 'small amber' }, noAcct.length + ' file' + (noAcct.length === 1 ? ' still needs' : 's still need') + ' an account: ' + noAcct.map(function (f) { return f.name; }).join(', ') + '.'));
    }
    if (files[cur]) fileView(main, files[cur]);
    else if (files.length === 0 && !allPrompt && !(App.cfg.batches || []).length) main.appendChild(h('div', { class: 'card pad muted' }, 'No file chosen yet. Download your statement as CSV from your bank, then choose it above.'));
    recent(main);
  }

  function fileView(main, f) {
    var sm = f.summary, cnt = { ready: 0, review: 0, fix: 0, dup: 0, before: 0, maybe: 0 };
    f.items.forEach(function (it) { cnt[it.state]++; });
    var sel = f.items.filter(function (it) { return it.selected; }).length;
    var allN = cnt.ready + cnt.review;
    var box = h('section', { class: 'card pad stack', 'aria-label': f.name });
    box.appendChild(h('div', { class: 'row between' }, h('h2', null, f.name), h('button', { type: 'button', class: 'btn link', onclick: function () { closeFile(f); App.render(); } }, 'Close file')));

    /* After an import: close the file, or keep it open */
    if (f.done && !f.done.kept) {
      box.appendChild(h('div', { class: 'notice stack-sm prompt', role: 'status' },
        h('strong', null, '✓ Imported ' + f.done.rows + ' rows' + (f.done.tx !== f.done.rows ? ' (' + f.done.tx + ' transactions)' : '') + ' from this file.'),
        h('div', { class: 'small' }, (f.done.review ? f.done.review + ' flagged for review. ' : 'Nothing needs review. ') + (f.done.pairs ? 'Matched ' + f.done.pairs + ' transfer pair' + (f.done.pairs > 1 ? 's' : '') + ' between your accounts. ' : '') + 'Close this file, or keep it open?'),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn primary', onclick: function () { closeFile(f); App.render(); } }, 'Close this file'),
          h('button', { type: 'button', class: 'btn', onclick: function () { f.done.kept = true; App.render(); } }, 'Keep it open'),
          f.done.review ? h('a', { class: 'btn', href: '#/transactions?f=review' }, 'Review them') : null,
          h('button', { type: 'button', class: 'btn link', onclick: function () { undo(f.done.batchId); } }, 'Undo this import'))));
    } else if (f.done) {
      box.appendChild(h('div', { class: 'row between small' }, h('span', { class: 'ok strong' }, '✓ Imported ' + f.done.rows + ' rows from this file.'),
        h('span', { class: 'row' }, f.done.review ? h('a', { class: 'btn link', href: '#/transactions?f=review' }, 'Review them') : null, h('button', { type: 'button', class: 'btn link', onclick: function () { undo(f.done.batchId); } }, 'Undo this import'))));
    }

    var body = f.done ? h('div', { class: 'stack' }) : box;   // once imported, the rows fold away: the prompt is what matters
    // One-line result of reading the file
    var parts = [cnt.ready + ' ready', cnt.review + ' flagged for review'];
    if (cnt.maybe) parts.push(cnt.maybe + ' possible duplicate' + (cnt.maybe === 1 ? '' : 's') + ' to decide');
    if (cnt.fix) parts.push(cnt.fix + ' need a fix'); if (cnt.dup) parts.push(cnt.dup + ' already in the app'); if (cnt.before) parts.push(cnt.before + ' before your cut-over');
    body.appendChild(h('div', { role: 'status', style: { fontSize: '16px' } }, h('strong', null, 'Read ' + (sm.ok + sm.tag + sm.error) + ' transactions: '), parts.join(' · ') + '. ',
      sm.reconciled ? null : h('span', { class: 'red strong' }, 'Row counts do not add up; nothing can be imported.')));

    // 2. Account
    var accts = App.cfg.accounts || [];
    if (!f.accountId && f.suggestNew && !f.newAcct) {
      var sn = f.suggestNew;
      body.appendChild(h('div', { class: 'toast warn' }, h('span', null, 'This looks like a new ' + (sn.kind === 'card' ? 'credit card' : 'bank account') + ': ' + sn.name + '.' + (f.maybeSame ? ' If it is a replacement card for ' + f.maybeSame.name + ', choose that account instead.' : '')),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onclick: function () {
          var a = { id: U.uid(), name: sn.name, kind: sn.kind || 'bank', numbers: sn.numbers.slice(), bank: sn.bank || '' };
          App.cfg.accounts = (App.cfg.accounts || []).concat([a]); f.accountId = a.id; f.suggestNew = null;
          UI.saveCfg().then(function () { analyse(f); App.render(); });
        } }, 'Add ' + sn.name))));
    }
    var aSel = h('select', { id: 'acct', class: 'input', onchange: function (e) { if (e.target.value === '__new') { f.newAcct = true; } else { f.accountId = e.target.value; f.newAcct = false; analyse(f); } App.render(); } },
      h('option', { value: '' }, 'Choose…'), accts.map(function (a) { return h('option', { value: a.id }, a.name + (a.kind === 'card' ? ' (credit card)' : ' (bank account)')); }), h('option', { value: '__new' }, 'New account…'));
    aSel.value = f.newAcct ? '__new' : (f.accountId || '');
    var acctRow = h('div', { class: 'row', style: { alignItems: 'flex-end', gap: '12px' } }, h('div', { class: 'field', style: { flex: '0 1 300px' } }, h('label', { for: 'acct' }, '2. Which account is this file from?'), aSel));
    if (f.matchWhy && f.accountId) acctRow.appendChild(h('span', { class: 'small muted', style: { paddingBottom: '12px' } }, 'Matched by ' + f.matchWhy + '.'));
    if (f.newAcct) {
      var nm = h('input', { id: 'an', class: 'input', placeholder: 'e.g. Scotiabank chequing', value: f.suggestNew ? f.suggestNew.name : '' });
      var kd = h('select', { id: 'ak', class: 'input' }, h('option', { value: 'bank' }, 'Bank account (money out is negative)'), h('option', { value: 'card' }, 'Credit card (purchases are positive)'));
      kd.value = f.suggestNew && f.suggestNew.kind ? f.suggestNew.kind : (f.kindGuess || 'bank');
      acctRow.appendChild(h('div', { class: 'field', style: { flex: '1 1 200px' } }, h('label', { for: 'an' }, 'Account name'), nm));
      acctRow.appendChild(h('div', { class: 'field', style: { flex: '1 1 240px' } }, h('label', { for: 'ak' }, 'Type'), kd));
      acctRow.appendChild(h('button', { type: 'button', class: 'btn', onclick: function () {
        if (!nm.value.trim()) return;
        var a = { id: U.uid(), name: nm.value.trim(), kind: kd.value, numbers: f.ident.numbers.map(function (n) { return n.last4; }), bank: f.ident.bank || '' };
        App.cfg.accounts = accts.concat([a]); f.accountId = a.id; f.newAcct = false;
        UI.saveCfg().then(function () { analyse(f); App.render(); });
      } }, 'Add account'));
    }
    body.appendChild(acctRow);
    if (!f.accountId) body.appendChild(h('div', { class: 'small muted' }, 'The account decides how amounts are read (cards list purchases as positive).'));

    // Things worth knowing, shown only when they apply
    var notes = h('div', { class: 'stack-sm' });
    if (f.accountId) {
      var neg = f.signUsed === 'bank', flip = function () { f.signMode = neg ? 'card' : 'bank'; analyse(f); App.render(); };
      if (f.signAuto || f.signMode) notes.appendChild(h('div', { class: 'notice row between', role: 'status' },
        h('span', null, h('strong', null, neg ? 'Money out is negative in this file' : 'Purchases are positive in this file'),
          f.signAuto ? ', so it was read that way (the other way round, every purchase looked like a refund).' : ' (you chose this).'),
        h('button', { type: 'button', class: 'btn', onclick: flip }, 'Read amounts the other way')));
    }
    var rvT = Reviewed.touched(App.cfg, f.items.filter(function (it) { return it.selectable && (it.state === 'ready' || it.state === 'review'); }).map(function (it) { return it.date; })), rvK = Object.keys(rvT).sort();
    if (rvK.length && !App.readOnly) notes.appendChild(h('div', { class: 'strong amber', role: 'status' }, 'Heads up: ' + rvK.map(function (k) { return rvT[k] + ' row' + (rvT[k] === 1 ? '' : 's') + ' in ' + ReviewedUI.name(k); }).join(' and ') + ' (marked as reviewed). Importing is allowed; that month will show as changed since reviewed.'));
    var rc = f.recon, problem = !sm.reconciled || sm.error > 0 || (!f.complete && !f.known);
    if (rc && rc.checked) {
      if (rc.ok) notes.appendChild(h('div', { class: 'strong ok' }, '✓ Balance check passed: ' + rc.rows + ' lines over ' + rc.checked + ' day' + (rc.checked === 1 ? '' : 's') + ' add up to the bank\'s running balance.'));
      else {
        problem = true;
        notes.appendChild(h('div', { class: 'strong amber', role: 'alert' }, '⚠ Balance check: the lines do not add up on ' + rc.breaks.length + ' day' + (rc.breaks.length === 1 ? '' : 's') + '. A line may be missing, repeated or changed in this file.'));
        rc.breaks.slice(0, 3).forEach(function (bk) {
          notes.appendChild(h('div', { class: 'small' }, U.shortDate(bk.date) + ': the balance changed by ' + U.money(bk.after - bk.before, { cents: true }) + ' but that day\'s lines (row' + (bk.rows.length === 1 ? ' ' : 's ') + bk.rows.join(', ') + ') total ' + U.money(rc.conv * bk.lines, { cents: true }) + ': ' + U.money(Math.abs(bk.unexplained), { cents: true }) + ' unexplained.'));
        });
        if (rc.breaks.length > 3) notes.appendChild(h('div', { class: 'small muted' }, 'and ' + (rc.breaks.length - 3) + ' more days.'));
      }
      var og = Health.openingGap(acct(f.accountId), rc);
      if (og) notes.appendChild(h('div', { class: 'strong amber', role: 'alert' }, '⚠ This file starts at ' + U.money(og.opening, { cents: true }) + ', but your last recorded balance was ' + U.money(og.prev.amount, { cents: true }) + ' on ' + U.shortDate(og.prev.date) + '. Lines between the two (an earlier statement?) may be missing.'));
    }
    if (f.balance) notes.appendChild(h('div', { class: 'small muted' }, 'Closing balance ' + U.money(f.balance.amount, { cents: true }) + ' on ' + U.shortDate(f.balance.date) + ' will be saved as the account balance.'));
    if (!f.complete && !f.known) notes.appendChild(h('div', { class: 'strong amber' }, 'Some columns could not be worked out. Open "How this file was read" and choose them; the app remembers them for this bank.'));
    if (notes.childNodes.length) body.appendChild(notes);

    // How the file was read (folded away unless something needs a look)
    var id = f.ident, found = h('div', { class: 'stack-sm', style: { marginTop: '8px' } });
    found.appendChild(h('div', null, 'Bank: ' + (id.bank ? id.bank + ' (from ' + id.bankFrom + ')' : 'not named in the file')));
    found.appendChild(h('div', null, 'Account: ' + (id.numbers.length ? id.numbers.map(function (n) { return 'number ending ' + n.last4 + (id.numbers.length > 1 ? ' (' + n.rows + ' rows)' : ''); }).join(', ') + ' (from ' + id.numbersFrom + ')' : 'no account or card number in the file')));
    found.appendChild(h('div', null, 'Format: ' + (f.known ? 'one you have imported before; saved columns used' : id.format ? id.format : 'not one the app knows; columns worked out from the data (check them below)')));
    found.appendChild(h('div', null, 'Rows: ' + sm.total + ' read, ' + (sm.ok + sm.tag + sm.error) + ' transactions' + (sm.header ? ', ' + sm.header + ' header' : '') + (sm.preamble ? ', ' + sm.preamble + ' lines above the table' : '') + (sm.blank ? ', ' + sm.blank + ' blank' : '') + (sm.reconciled ? '. All rows accounted for, none skipped.' : '.')));
    if (!f.known && (!id.format || f.inferred)) f.explain.forEach(function (e) { found.appendChild(h('div', { class: 'small' }, '• ' + e)); });
    id.notes.forEach(function (n) { found.appendChild(h('div', { class: 'small' }, n)); });
    var hdr = f.L.headerIdx >= 0 ? f.rows[f.L.headerIdx] : (f.rows[f.L.dataStart] || []).map(function (_, i) { return 'Column ' + (i + 1); });
    function colSel(key, label) {
      var sl = h('select', { id: 'col-' + key, class: 'input', onchange: function (e) { f.L.cols[key] = +e.target.value; if (key === 'amount' && +e.target.value >= 0) { f.L.cols.debit = -1; f.L.cols.credit = -1; } if ((key === 'debit' || key === 'credit') && +e.target.value >= 0) f.L.cols.amount = -1; analyse(f); App.render(); } },
        h('option', { value: '-1' }, '—'), hdr.map(function (x, i) { return h('option', { value: String(i) }, (x || 'Column ' + (i + 1))); }));
      sl.value = String(f.L.cols[key]);
      return h('div', { class: 'field', style: { flex: '1 1 150px' } }, h('label', { for: 'col-' + key }, label), sl);
    }
    function dirSel() {
      var sl = h('select', { id: 'col-dir', class: 'input', onchange: function (e) { f.dirCol = +e.target.value; analyse(f); App.render(); } },
        h('option', { value: '-1' }, '— (amount has a sign)'), hdr.map(function (x, i) { return h('option', { value: String(i) }, (x || 'Column ' + (i + 1))); }));
      sl.value = String(f.dirCol === undefined ? -1 : f.dirCol);
      return h('div', { class: 'field', style: { flex: '1 1 150px' } }, h('label', { for: 'col-dir' }, 'Money in / out word'), sl);
    }
    found.appendChild(h('div', { class: 'row', style: { marginTop: '4px' } }, colSel('date', 'Date'), colSel('desc', 'Description'), colSel('amount', 'Amount'), colSel('debit', 'Debit (out)'), colSel('credit', 'Credit (in)'), dirSel()));
    body.appendChild(h('details', { class: 'more', open: problem ? true : null },
      h('summary', { class: 'strong' }, 'How this file was read', h('span', { class: 'muted small', style: { fontWeight: '400' } }, f.known ? ' · saved for this bank' : ' · check once; remembered for this bank')), found));

    // 3. The rows
    var fdefs = [['all', 'All ' + f.items.length], ['ready', 'Ready ' + cnt.ready], ['review', 'Flagged ' + cnt.review], ['maybe', 'Possible duplicates ' + cnt.maybe], ['fix', 'Need a fix ' + cnt.fix], ['dup', 'Already in app ' + cnt.dup], ['before', 'Before cut-over ' + cnt.before]]
      .filter(function (d) { return d[0] === 'all' || d[0] === f.filter || cnt[d[0]] > 0; });
    body.appendChild(h('h3', null, '3. Check the rows'));
    body.appendChild(h('div', { class: 'row between' },
      h('div', { class: 'row', role: 'group', 'aria-label': 'Show rows' }, fdefs.map(function (d) {
        return h('button', { type: 'button', class: 'chip', 'aria-pressed': f.filter === d[0] ? 'true' : 'false', onclick: function () { f.filter = d[0]; App.render(); } }, d[1]);
      })),
      h('span', { class: 'row' }, h('span', { class: 'muted' }, sel + ' of ' + f.items.length + ' selected'),
        h('button', { type: 'button', class: 'btn link', onclick: function () { shown.forEach(function (it) { if (it.selectable) it.selected = true; }); App.render(); } }, 'Select all shown'),
        h('button', { type: 'button', class: 'btn link', onclick: function () { shown.forEach(function (it) { it.selected = false; }); App.render(); } }, 'Clear shown'))));
    var shown = f.items.filter(function (it) { return f.filter === 'all' || (f.filter === 'selected' ? it.selected : it.state === f.filter); });

    var tb = h('tbody');
    shown.forEach(function (it) {
      var stLabel = { ready: ['Ready', 'ok'], review: ['Review', 'amber'], fix: ['Needs a fix', 'red'], dup: ['Already in app', 'muted'], before: ['Before cut-over', 'muted'], maybe: ['Possible duplicate', 'amber'] }[it.state];
      var cb = h('input', { type: 'checkbox', checked: it.selected, disabled: !it.selectable, 'aria-label': 'Import row ' + it.line, onchange: function (e) { it.selected = e.target.checked; App.render(); } });
      var catCell;
      if (it.state === 'fix') {
        var fd = h('input', { type: 'date', class: 'input', 'aria-label': 'Date for row ' + it.line, value: it.date || '', onchange: function (e) { f.fixes[it.line] = Object.assign({}, f.fixes[it.line], { date: e.target.value }); } });
        var fa = h('input', { class: 'input', style: { maxWidth: '110px' }, 'aria-label': 'Amount for row ' + it.line, value: it.amountRaw === null || it.amountRaw === undefined ? '' : String(it.amountRaw), onchange: function (e) { f.fixes[it.line] = Object.assign({}, f.fixes[it.line], { amount: e.target.value }); } });
        catCell = h('div', { class: 'row' }, fd, fa, h('button', { type: 'button', class: 'btn', onclick: function () { analyse(f); App.render(); } }, 'Use these'));
      } else {
        catCell = UI.categorySelect('rc-' + it.line, it.catId || '', function (e) { it.catId = e.target.value || null; it.touched = true; it.reasons = it.reasons.filter(function (r) { return /^Before|^Already/.test(r); }); it.splits = null; applyCat(it); if (it.state === 'review') it.state = 'ready'; App.render(); }, { placeholder: 'Needs a category' });
        catCell.setAttribute('aria-label', 'Category for row ' + it.line);
        catCell.style.minWidth = '190px';
      }
      var amt = it.amountRaw === null || it.amountRaw === undefined ? '—' : (it.amountRaw < 0 ? '−' : '+') + U.money(Math.abs(it.amountRaw), { cents: true });
      tb.appendChild(h('tr', null,
        h('td', null, cb), h('td', { class: 'small muted' }, String(it.line)), h('td', { style: { whiteSpace: 'nowrap' } }, it.date ? U.shortDate(it.date) + ' ' + it.date.slice(0, 4) : '—'),
        h('td', null, h('div', { class: 'strong' }, it.desc || '(no description)'), h('div', { class: 'small muted' }, [it.code, it.ruleNote].concat(it.flags).filter(Boolean).join(' · '))),
        h('td', null, catCell),
        h('td', { class: 'r strong', style: { whiteSpace: 'nowrap', color: it.amountRaw > 0 ? 'var(--ok)' : '' } }, amt),
        h('td', null, h('div', { class: 'small strong ' + stLabel[1] }, stLabel[0]), it.state !== 'maybe' && it.conf && it.catId ? UI.confLabel(it.touched ? 'sure' : it.conf, it.touched ? 'You chose this' : it.why) : null,
          h('div', { class: 'small muted' }, (it.state === 'maybe' ? it.reasons.slice(1) : it.reasons).join('; ')))));
      var dc = dupChoice(f, it);
      if (dc) tb.appendChild(h('tr', { class: 'dup-row' }, h('td', null), h('td', { colspan: '6' }, dc)));
    });
    body.appendChild(h('div', { class: 'scroll-x', style: { maxHeight: '640px', overflowY: 'auto', border: '1px solid var(--line)', borderRadius: '8px' } },
      h('table', { class: 't', style: { minWidth: '900px' } }, h('thead', null, h('tr', null, h('th', null, h('span', { class: 'sr-only' }, 'Import')), h('th', null, 'Row'), h('th', null, 'Date'), h('th', null, 'Description'), h('th', null, 'Category'), h('th', { class: 'r' }, 'Amount'), h('th', null, 'Status'))), tb)));
    if (!shown.length) body.appendChild(h('div', { class: 'muted' }, 'No rows in this view.'));

    // 4. Import
    var ok = sm.reconciled && !!f.accountId, skipped = cnt.dup + cnt.before + cnt.fix;
    body.appendChild(h('div', { class: 'stack-sm import-bar' }, h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn primary', style: { minHeight: '44px' }, disabled: !ok || !allN, onclick: function () { doImport(f, 'all'); } }, 'Import all (' + allN + ')'),
      sel !== allN ? h('button', { type: 'button', class: 'btn', disabled: !ok || !sel, onclick: function () { doImport(f, 'selected'); } }, 'Import selected (' + sel + ')') : null),
      h('div', { class: 'small muted' }, !f.accountId ? 'Choose the account first.' : 'Takes the ready and flagged rows' + (skipped + cnt.maybe ? ' and leaves out ' + (skipped + cnt.maybe) + ' (' + [cnt.maybe ? cnt.maybe + ' possible duplicate' + (cnt.maybe === 1 ? '' : 's') : '', skipped ? 'already in the app, before your cut-over, or needing a fix' : ''].filter(Boolean).join('; ') + '; decide on a row, or tick it and use "Import selected")' : '') + '. Flagged rows are imported and wait in Review.')));
    if (f.done) box.appendChild(h('details', { class: 'more' }, h('summary', { class: 'strong' }, 'Show the rows from this file'), body));
    main.appendChild(box);
  }

  function recent(main) {
    var all = (App.cfg.batches || []), b = all.slice().reverse().slice(0, 8);
    if (!all.length) return;
    main.appendChild(h('label', { class: 'check', style: { alignSelf: 'flex-start' } }, h('input', { type: 'checkbox', id: 'show-recent', checked: recentOn, onchange: function (e) { recentOn = e.target.checked; setPref('recent', recentOn); App.render(); var x = document.getElementById('show-recent'); if (x) x.focus(); } }),
      h('span', null, 'Show recent imports (' + all.length + ')')));
    if (!recentOn) return;
    var s = h('section', { class: 'card pad stack', 'aria-label': 'Recent imports' }, h('h2', null, 'Recent imports'));
    b.forEach(function (x) {
      var a = acct(x.accountId), left = App.txs.filter(function (t) { return t.batchId === x.id; }).length;
      s.appendChild(h('div', { class: 'list-row' }, h('span', null, h('strong', null, x.file), h('span', { class: 'muted' }, ' · ' + (a ? a.name : '') + ' · ' + x.at.slice(0, 10) + ' · ' + x.rows + ' of ' + (x.readRows || '?') + ' rows · ' + left + ' transactions')),
        h('button', { type: 'button', class: 'btn link', 'aria-label': 'Undo the import of ' + x.file + ' from ' + x.at.slice(0, 10), onclick: function () { undo(x.id); } }, 'Undo this import')));
    });
    main.appendChild(s);
  }
  return { render: render, _files: function () { return files; } };
})();
