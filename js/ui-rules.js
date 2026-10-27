/* Tagging rules: every rule in one searchable list (general file, personal file, rules added here, and your "Always" rules),
   a test box that shows exactly which rule tags a bank line and why, and an editor.
   File rules are turned off rather than deleted (they stay in the file); edits change the loaded copy, so "Download" in
   Settings gives back the file with your edits. The importer uses the same rules (M.ruleRows), so what you test is what imports. */
var RulesManager = (function () {
  'use strict';
  var h = U.h, C = null;
  var st = { q: '', src: 'all', val: '', test: '', testAmt: '', testDir: 'out', show: 100 };
  var SRC = { general: 'General file', personal: 'Personal file', mine: 'Always (yours)' };
  var MATCH = [['contains', 'contains'], ['word', 'has the whole word'], ['startswith', 'starts with'], ['exact', 'is exactly'], ['regex', 'matches the pattern (advanced)']];
  var TYPES = [['income', 'Income'], ['transfer', 'Transfer (own account)'], ['exclude', 'Not counted'], ['review', 'Always review'], ['refund', 'Refund (no effect: refunds come from money in)']];

  function cols() { if (!C) C = M.RULE_COLS; return C; }
  function ix(rows, name) { return rows[0].map(function (x) { return String(x).trim().toLowerCase(); }).indexOf(name); }
  function get(rows, r, name) { var i = ix(rows, name); return i >= 0 ? (r[i] || '') : ''; }
  function setv(rows, r, name, v) { var i = ix(rows, name); if (i < 0) { rows[0].push(name); i = rows[0].length - 1; } while (r.length <= i) r.push(''); r[i] = v; }

  /* Every rule as one flat list. */
  function entries() {
    var out = [], sets = App.cfg.ruleSets || {}, off = App.cfg.ruleOff || {};
    ['personal', 'general'].forEach(function (k) {
      var rows = sets[k] && sets[k].rows; if (!rows) return;
      rows.slice(1).forEach(function (r, i) {
        var id = get(rows, r, 'rule_id'); if (!get(rows, r, 'pattern')) return;
        out.push({ set: k, row: i + 1, id: id, kind: get(rows, r, 'kind'), pattern: get(rows, r, 'pattern'), match: get(rows, r, 'match_type') || 'contains', value: get(rows, r, 'value'),
          priority: get(rows, r, 'priority') || '100', apply: get(rows, r, 'apply') || 'auto', notes: get(rows, r, 'notes'), off: !!off[id], added: /^M\d+$/.test(id),
          min: get(rows, r, 'min_amount'), max: get(rows, r, 'max_amount'), dir: String(get(rows, r, 'direction')).toLowerCase() });
      });
    });
    (App.cfg.rules || []).forEach(function (r, i) {
      out.push({ set: 'mine', row: i, id: 'Always', kind: 'always', pattern: r.merchant, match: 'exact', value: UI.catName(r.categoryId), catId: r.categoryId, priority: '—', apply: 'auto', notes: r.createdAt ? 'Made ' + r.createdAt.slice(0, 10) : '', off: false });
    });
    return out;
  }
  /* "only $300 and up · money out" (empty when the rule has no conditions) */
  function condText(e) {
    var parts = [], mn = e.min !== '' && e.min != null ? U.money(+String(e.min).replace(/[$,]/g, ''), { whole: true }) : null, mx = e.max !== '' && e.max != null ? U.money(+String(e.max).replace(/[$,]/g, ''), { whole: true }) : null;
    if (mn && mx) parts.push(mn + ' to ' + mx); else if (mn) parts.push(mn + ' and up'); else if (mx) parts.push('up to ' + mx);
    if (e.dir === 'in') parts.push('money in'); else if (e.dir === 'out') parts.push('money out');
    return parts.length ? 'only ' + parts.join(', ') : '';
  }
  function valueLabel(e) {
    if (e.kind === 'type') { var t = TYPES.filter(function (x) { return x[0] === e.value; })[0]; return t ? t[1] : e.value; }
    if (e.kind === 'split') return 'Split: ' + e.value;
    return e.value;
  }

  /* ---------- test a bank description ---------- */
  function one(e) { return Engine.loadRules([cols(), [e.id, e.kind, e.pattern, e.match, e.value, e.priority, e.apply, '', e.min || '', e.max || '', e.dir || '']])[0]; }
  /* ctx = { amount, direction } or undefined (then rules with an amount condition do not match, as in the importer without an amount) */
  function signed(ctx) { return ctx && ctx.amount != null ? (ctx.direction === 'in' ? ctx.amount : -ctx.amount) : (ctx && ctx.direction === 'in' ? 100 : -100); }
  function hits(e, desc, ctx) {
    if (e.kind === 'always') return M.merchantKey(desc) === e.pattern;
    if (e.kind === 'split') return !!Engine.splitFor(desc, signed(ctx), [one(e)]);
    var c = Engine.classify(desc, [one(e)], ctx);
    return e.kind === 'type' ? !!c.typeRule : !!c.catRule;
  }
  function explain(desc, ctx) {
    var all = entries(), norm = Engine.normalize(desc), key = M.merchantKey(desc);
    var matched = all.filter(function (e) { return hits(e, desc, ctx); });
    var mine = matched.filter(function (e) { return e.kind === 'always'; })[0];
    var active = Engine.loadRules(M.ruleRows(App.cfg)), res = Engine.classify(desc, active, ctx), sp = Engine.splitFor(desc, signed(ctx), active);
    var byId = {}; active.forEach(function (r) { byId[r.id] = r; });
    return { desc: desc, norm: norm, key: key, mine: mine, res: res, split: sp, matched: matched, byId: byId };
  }
  function testCtx() { var a = U.calc(st.testAmt); return { amount: a === null ? null : Math.abs(a), direction: st.testDir }; }
  /* Why the winner beat the others of its kind: higher priority, or same priority and a longer pattern. */
  function why(w, e) {
    if (+e.priority < +w.priority) return 'lower priority (' + e.priority + ' vs ' + w.priority + ')';
    if (+e.priority === +w.priority) return 'same priority, shorter pattern';
    return '';
  }
  function testResult(box) {
    U.clear(box);
    var d = st.test.trim();
    if (!d) { box.appendChild(h('p', { class: 'small muted', style: { margin: 0 } }, 'Type or paste a description exactly as your bank writes it, for example "SAFEWAY #4545 VANCOUVER BC".')); return; }
    var x = explain(d, testCtx()), r = x.res, ents = x.matched;
    box.appendChild(h('div', { class: 'small muted' }, 'The app reads it as: ', h('code', null, x.norm || '(nothing left)'), x.key && x.key !== x.norm ? ' · merchant: ' + x.key : ''));
    var verdict, cls = 'ok';
    if (x.mine) verdict = 'Your Always rule: ' + x.mine.value;
    else if (r.type === 'review') { verdict = 'Flagged for review (a rule says it could mean several things)' + (r.category ? '; suggested ' + r.category : ''); cls = 'amber'; }
    else if (r.type === 'transfer' || r.type === 'income' || r.type === 'exclude') { verdict = (r.type === 'exclude' ? 'Not counted' : r.type === 'income' ? 'Income' : 'Transfer (own account)') + (r.typeApply === 'suggest' ? ', flagged for review' : ''); cls = r.typeApply === 'suggest' ? 'amber' : 'ok'; }
    else if (r.category) { verdict = r.category + (r.catApply === 'suggest' ? ', flagged for review' : ''); cls = r.catApply === 'suggest' ? 'amber' : 'ok'; }
    else { verdict = 'No rule matches: it will wait in Review'; cls = 'amber'; }
    if (x.split) verdict += ' · split: ' + x.split.parts.map(function (p) { return (p.category === 'exclude' ? 'not counted' : p.category) + ' ' + p.amount.toFixed(2) + '%'; }).join(' + ') + ' of the amount';
    box.appendChild(h('div', { class: 'test-verdict ' + cls, role: 'status' }, h('strong', null, verdict)));
    var winner = x.mine ? null : x.byId[r.typeRule && /transfer|income|exclude|review/.test(r.type) ? r.typeRule : r.catRule];
    var conf = x.mine ? 'sure' : (r.type === 'review' || (!r.category && !/transfer|income|exclude/.test(r.type)) ? 'guess' : Learn.ruleConfidence(winner));
    box.appendChild(h('div', { class: 'row small', style: { gap: '4px 10px' } }, h('span', { class: 'muted' }, 'Confidence:'), UI.confLabel(conf, x.mine ? 'Your Always rule' : winner ? 'Rule ' + winner.id : 'No rule'),
      h('span', { class: 'muted' }, testCtx().amount != null ? 'for ' + U.money(testCtx().amount, { cents: true }) + ' ' + (st.testDir === 'in' ? 'money in' : 'money out') : 'no amount entered: rules with an amount condition are left out')));
    if (x.mine) box.appendChild(h('div', { class: 'small' }, 'An Always rule you made decides first, whatever the file rules say.'));
    function group(title, kind, winnerId) {
      var list = ents.filter(function (e) { return e.kind === kind; });
      if (!list.length) return;
      var w = list.filter(function (e) { return e.id === winnerId; })[0];
      var ul = h('ul', { class: 'test-list' });
      list.sort(function (a, b) { return (b.id === winnerId) - (a.id === winnerId) || (+b.priority - +a.priority) || (b.pattern.length - a.pattern.length); }).forEach(function (e) {
        ul.appendChild(h('li', null, ruleChip(e), ' ', e.off ? h('span', { class: 'small amber' }, 'turned off') : e.id === winnerId ? h('span', { class: 'small ok strong' }, 'wins') : (w ? h('span', { class: 'small muted' }, 'loses: ' + why(w, e)) : null)));
      });
      box.appendChild(h('div', { class: 'stack-sm' }, h('div', { class: 'label' }, title), ul));
    }
    group('Type rules (decide income, transfer, not counted or review; they beat categories)', 'type', r.typeRule);
    group('Category rules', 'category', r.catRule);
    group('Split rules', 'split', x.split ? x.split.rule : null);
    if (!ents.some(function (e) { return e.kind !== 'always'; }) && !x.mine) {
      box.appendChild(h('button', { type: 'button', class: 'btn', style: { alignSelf: 'flex-start' }, onclick: function () { edit(null, { pattern: x.key || x.norm }); } }, 'Add a rule for "' + (x.key || x.norm) + '"'));
    }
  }
  function ruleChip(e) {
    return h('button', { type: 'button', class: 'rule-chip' + (e.off ? ' off' : ''), title: 'Edit this rule', onclick: function () { edit(e); } },
      h('span', { class: 'small muted' }, e.id), ' ', h('strong', null, e.pattern), ' → ', valueLabel(e), e.kind !== 'always' ? h('span', { class: 'small muted' }, ' · ' + e.priority + (e.apply === 'suggest' ? ' · flagged' : '') + (condText(e) ? ' · ' + condText(e) : '')) : null);
  }

  /* ---------- list ---------- */
  function filtered(all) {
    var q = st.q.trim().toUpperCase();
    return all.filter(function (e) {
      if (st.src === 'off' ? !e.off : st.src === 'added' ? !e.added : st.src !== 'all' && e.set !== st.src) return false;
      if (st.val && e.value !== st.val) return false;
      if (q && [e.id, e.pattern, e.value, valueLabel(e), e.notes].join(' ').toUpperCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function toFiles() { var f = document.getElementById('rule-files'); if (f) { f.scrollIntoView(); var i = f.querySelector('input, button'); if (i) i.focus(); } }
  function render(main) {
    var all = entries(), sets = App.cfg.ruleSets || {};
    var counts = { all: all.length, general: 0, personal: 0, mine: 0, added: 0, off: 0 };
    all.forEach(function (e) { counts[e.set]++; if (e.added) counts.added++; if (e.off) counts.off++; });
    main.appendChild(h('header', { class: 'row between' }, h('div', { class: 'stack-sm' }, h('h1', null, 'Tagging rules'),
      h('span', { class: 'muted' }, counts.all + ' rules · ' + (counts.off ? counts.off + ' turned off · ' : '') + 'used when you import bank files')),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: toFiles }, 'Rule files'), h('button', { type: 'button', class: 'btn primary', onclick: function () { edit(null, {}); } }, 'Add a rule'))));
    if (!sets.general && !sets.personal) main.appendChild(h('div', { class: 'card pad row between' }, h('span', null, 'No rule files loaded yet. Load rules-general.csv and rules-personal.csv to start.'), h('button', { type: 'button', class: 'btn primary', onclick: toFiles }, 'Load rule files')));

    // test box
    var res = h('div', { class: 'stack', 'aria-live': 'polite' }), timer = null;
    var tin = h('input', { id: 'rt', class: 'input', value: st.test, autocomplete: 'off', spellcheck: 'false', placeholder: 'e.g. SAFEWAY #4545 VANCOUVER BC',
      oninput: function (e) { st.test = e.target.value; clearTimeout(timer); timer = setTimeout(function () { testResult(res); }, 120); } });
    var again = function () { clearTimeout(timer); timer = setTimeout(function () { testResult(res); }, 120); };
    var tamt = h('input', { id: 'rt-amt', class: 'input', inputmode: 'decimal', value: st.testAmt, placeholder: 'optional', oninput: function (e) { st.testAmt = e.target.value; again(); } });
    var tdir = h('select', { id: 'rt-dir', class: 'input', onchange: function (e) { st.testDir = e.target.value; again(); } }, h('option', { value: 'out' }, 'Money out'), h('option', { value: 'in' }, 'Money in'));
    tdir.value = st.testDir;
    main.appendChild(h('section', { class: 'card pad stack', 'aria-labelledby': 'rt-h' }, h('h2', { id: 'rt-h' }, 'Test a bank description'),
      h('div', { class: 'row', style: { alignItems: 'flex-end', gap: '12px' } },
        h('div', { class: 'field', style: { flex: '3 1 260px' } }, h('label', { for: 'rt' }, 'Description as it appears on the statement'), tin),
        h('div', { class: 'field', style: { flex: '1 1 110px' } }, h('label', { for: 'rt-amt' }, 'Amount'), tamt),
        h('div', { class: 'field', style: { flex: '1 1 130px' } }, h('label', { for: 'rt-dir' }, 'Direction'), tdir)), res));
    testResult(res);

    // filters
    var list = h('div', { class: 'card rules-list' }), count = h('div', { class: 'row between' });
    var vals = {}; all.forEach(function (e) { if (e.kind === 'category' || e.kind === 'always') vals[e.value] = 1; });
    var vsel = h('select', { id: 'rv', class: 'input', style: { width: 'auto' }, 'aria-label': 'Show rules for', onchange: function (e) { st.val = e.target.value; st.show = 100; drawList(); } },
      h('option', { value: '' }, 'Any category or type'), Object.keys(vals).sort().map(function (v) { return h('option', { value: v }, v); }), TYPES.map(function (t) { return h('option', { value: t[0] }, 'Type: ' + t[1]); }));
    vsel.value = st.val;
    main.appendChild(h('div', { class: 'row', style: { alignItems: 'flex-end', gap: '12px' } },
      h('div', { class: 'field', style: { flex: '1 1 240px' } }, h('label', { for: 'rq' }, 'Search rules'),
        h('input', { id: 'rq', class: 'input', value: st.q, placeholder: 'Merchant, category, rule id or note', oninput: function (e) { st.q = e.target.value; st.show = 100; drawList(); } })),
      vsel));
    main.appendChild(h('div', { class: 'row', role: 'group', 'aria-label': 'Show' }, [['all', 'All'], ['general', 'General file'], ['personal', 'Personal file'], ['mine', 'Always (yours)'], ['added', 'Added here'], ['off', 'Turned off']].map(function (f) {
      return h('button', { type: 'button', class: 'chip', 'aria-pressed': st.src === f[0] ? 'true' : 'false', onclick: function () { st.src = f[0]; st.show = 100; App.render(); } }, f[1] + ' · ' + counts[f[0]]);
    })));
    main.appendChild(count); main.appendChild(list);
    function drawList() {
      U.clear(list); U.clear(count);
      var rows = filtered(all);
      count.appendChild(h('span', { class: 'muted', role: 'status' }, rows.length === all.length ? rows.length + ' rules' : rows.length + ' of ' + all.length + ' rules'));
      if (!rows.length) { list.appendChild(h('div', { class: 'pad muted' }, 'No rules match. Try another word, or test a description above.')); return; }
      rows.slice(0, st.show).forEach(function (e) {
        list.appendChild(h('div', { class: 'rule-row' + (e.off ? ' off' : '') },
          h('div', { class: 'who' }, h('button', { type: 'button', class: 'btn link name', onclick: function () { edit(e); } }, e.pattern),
            h('span', { class: 'small muted' }, [e.id, MATCH.filter(function (m) { return m[0] === e.match; }).map(function (m) { return m[1]; })[0] || e.match, condText(e), SRC[e.set] + (e.added ? ', added here' : ''), e.notes].filter(Boolean).join(' · '))),
          h('span', { class: 'rule-val' }, valueLabel(e)),
          h('span', { class: 'small muted rule-meta' }, e.kind === 'always' ? 'always first' : 'priority ' + e.priority),
          e.apply === 'suggest' ? h('span', { class: 'tag review ro' }, 'flags') : h('span', { class: 'tag ro muted-tag' }, 'auto'),
          e.kind === 'always' ? h('span', { class: 'rule-act' }) : h('button', { type: 'button', class: 'btn rule-act', 'aria-label': (e.off ? 'Turn on ' : 'Turn off ') + e.id + ' ' + e.pattern, onclick: function () { toggle(e); } }, e.off ? 'Turn on' : 'Turn off')));
      });
      if (rows.length > st.show) list.appendChild(h('button', { type: 'button', class: 'btn', style: { margin: '12px' }, onclick: function () { st.show += 200; drawList(); } }, 'Show ' + Math.min(200, rows.length - st.show) + ' more'));
    }
    drawList();
  }

  /* ---------- changes (all with Undo) ---------- */
  function save(msg, undoFn) { return UI.saveCfg().then(function () { App.render(); UI.toast(msg, undoFn); }); }
  function recount(k) { var s = App.cfg.ruleSets[k]; s.count = Engine.loadRules(s.rows).length; s.editedAt = new Date().toISOString(); }
  function toggle(e) {
    App.cfg.ruleOff = Object.assign({}, App.cfg.ruleOff);
    var wasOff = !!App.cfg.ruleOff[e.id];
    if (wasOff) delete App.cfg.ruleOff[e.id]; else App.cfg.ruleOff[e.id] = true;
    save((wasOff ? 'Turned on ' : 'Turned off ') + e.id + ' (' + e.pattern + ').', function () {
      App.cfg.ruleOff = Object.assign({}, App.cfg.ruleOff); if (wasOff) App.cfg.ruleOff[e.id] = true; else delete App.cfg.ruleOff[e.id]; save('Undone.');
    });
  }

  /* Edit (e) or add (e = null, pre = {pattern}) in a side panel, with a live count of the transactions it would match. */
  function edit(e, pre) {
    var adding = !e, always = e && e.kind === 'always';
    var f = adding ? { kind: 'category', pattern: (pre && pre.pattern) || '', match: 'contains', value: '', priority: '110', apply: 'auto', notes: '', min: '', max: '', dir: '' }
      : { kind: e.kind, pattern: e.pattern, match: e.match, value: always ? e.catId : e.value, priority: e.priority, apply: e.apply, notes: e.notes, min: e.min || '', max: e.max || '', dir: e.dir || '' };
    var errs = {}, confirmDel = false;
    UI.openPanel(function (p) {
      function draw() {
        U.clear(p);
        p.appendChild(UI.panelHead(adding ? 'Add a rule' : always ? 'Always rule' : 'Edit rule ' + e.id, adding ? 'Saved with your personal rules' : SRC[e.set]));
        if (always) {
          p.appendChild(h('p', { class: 'muted', style: { margin: 0 } }, 'Made with "Always tag … like this". It decides first for this exact merchant.'));
          p.appendChild(field('Merchant', h('div', { class: 'strong' }, f.pattern)));
          p.appendChild(field('Category', UI.categorySelect('re-val', f.value, function (ev) { f.value = ev.target.value; }), 're-val'));
        } else {
          var kinds = h('div', { class: 'row', role: 'radiogroup', 'aria-label': 'What the rule decides' });
          [['category', 'A category'], ['type', 'Income, transfer, not counted…'], ['split', 'A split']].forEach(function (k) {
            kinds.appendChild(h('label', { class: 'chip radio-chip' + (f.kind === k[0] ? ' on' : '') }, h('input', { type: 'radio', name: 're-kind', checked: f.kind === k[0], onchange: function () { f.kind = k[0]; f.value = ''; draw(); } }), h('span', null, k[1])));
          });
          p.appendChild(h('div', { class: 'stack-sm' }, h('div', { class: 'label' }, 'This rule decides'), kinds));
          var msel = h('select', { id: 're-match', class: 'input', onchange: function (ev) { f.match = ev.target.value; errs.pattern = check(); draw(); } }, MATCH.map(function (m) { return h('option', { value: m[0] }, 'Description ' + m[1]); }));
          msel.value = f.match;
          p.appendChild(field('How to match', msel, 're-match'));
          p.appendChild(field('Words to look for', h('input', { id: 're-pat', class: 'input', value: f.pattern, spellcheck: 'false', autocomplete: 'off',
            oninput: function (ev) { f.pattern = ev.target.value; if (errs.pattern) { errs.pattern = check(); errBox('pattern'); } preview(prev); },
            onblur: function () { errs.pattern = check(); errBox('pattern'); } }), 're-pat', 'Capitals and punctuation do not matter: the app compares cleaned-up text (see the test box).', 'pattern'));
          var val;
          if (f.kind === 'category') {
            val = h('select', { id: 're-val', class: 'input', onchange: function (ev) { f.value = ev.target.value; } }, h('option', { value: '' }, 'Choose…'),
              M.groupsWithCats(App.cfg).map(function (gc) { return h('optgroup', { label: gc.group.name }, gc.cats.map(function (c) { return h('option', { value: c.name }, c.name); })); }));
            if (f.value && !App.cfg.categories.some(function (c) { return c.name === f.value; })) val.appendChild(h('option', { value: f.value }, f.value + ' (not one of your categories)'));
          } else if (f.kind === 'type') {
            val = h('select', { id: 're-val', class: 'input', onchange: function (ev) { f.value = ev.target.value; } }, h('option', { value: '' }, 'Choose…'), TYPES.map(function (t) { return h('option', { value: t[0] }, t[1]); }));
          } else val = h('input', { id: 're-val', class: 'input', value: f.value, placeholder: 'exclude=1.75%;Rent=rest', oninput: function (ev) { f.value = ev.target.value; } });
          val.value = f.value;
          p.appendChild(field(f.kind === 'split' ? 'Split (part=amount;…)' : f.kind === 'type' ? 'Treat it as' : 'Category', val, 're-val',
            f.kind === 'split' ? 'A % is a fee on top of the rest; a number is a fixed amount; "rest" takes what is left. Example: exclude=1.75%;Rent=rest' : null, 'value'));
          p.appendChild(h('div', { class: 'row', style: { alignItems: 'flex-start' } },
            h('div', { style: { flex: '0 1 140px' } }, field('Priority', h('input', { id: 're-pri', class: 'input num', inputmode: 'numeric', value: f.priority, oninput: function (ev) { f.priority = ev.target.value; } }), 're-pri', 'Higher wins. Your files use 100; the BC list 90.', 'priority')),
            h('fieldset', { class: 'stack-sm', style: { border: 0, padding: 0, margin: 0, flex: '1 1 200px' } }, h('legend', { class: 'label', style: { paddingBottom: '4px' } }, 'When it matches'),
              h('label', { class: 'check' }, h('input', { type: 'radio', name: 're-apply', checked: f.apply !== 'suggest', onchange: function () { f.apply = 'auto'; } }), h('span', null, 'Tag it')),
              h('label', { class: 'check' }, h('input', { type: 'radio', name: 're-apply', checked: f.apply === 'suggest', onchange: function () { f.apply = 'suggest'; } }), h('span', null, 'Tag it and flag for review')))));
          var dsel = h('select', { id: 're-dir', class: 'input', onchange: function (ev) { f.dir = ev.target.value; preview(prev); } }, h('option', { value: '' }, 'Money in or out'), h('option', { value: 'out' }, 'Money out only'), h('option', { value: 'in' }, 'Money in only'));
          dsel.value = f.dir;
          p.appendChild(h('fieldset', { class: 'stack-sm', style: { border: 0, padding: 0, margin: 0 } }, h('legend', { class: 'label', style: { paddingBottom: '4px' } }, 'Only when (optional)'),
            h('div', { class: 'row', style: { alignItems: 'flex-start', gap: '12px' } },
              h('div', { style: { flex: '1 1 110px' } }, field('Amount at least', h('input', { id: 're-min', class: 'input', inputmode: 'decimal', value: f.min, placeholder: 'any', oninput: function (ev) { f.min = ev.target.value; preview(prev); }, onblur: function () { errs.amount = checkAmt(); errBox('amount'); } }), 're-min')),
              h('div', { style: { flex: '1 1 110px' } }, field('Amount at most', h('input', { id: 're-max', class: 'input', inputmode: 'decimal', value: f.max, placeholder: 'any', oninput: function (ev) { f.max = ev.target.value; preview(prev); }, onblur: function () { errs.amount = checkAmt(); errBox('amount'); } }), 're-max')),
              h('div', { style: { flex: '1 1 160px' } }, field('Direction', dsel, 're-dir'))),
            h('div', { class: 'small muted' }, 'For merchants that mean different things by amount, e.g. COSTCO $300 and up → Big Purchases. Amounts are in CAD, without the sign.'),
            h('div', { class: 'small red', id: 'err-amount', role: 'alert' }, errs.amount || '')));
          p.appendChild(field('Note (optional)', h('input', { id: 're-note', class: 'input', value: f.notes, oninput: function (ev) { f.notes = ev.target.value; } }), 're-note'));
        }
        var prev = h('div', { class: 'stack-sm', 'aria-live': 'polite' });
        p.appendChild(prev); preview(prev);
        p.appendChild(h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onclick: submit }, adding ? 'Add rule' : 'Save changes'), h('button', { type: 'button', class: 'btn', onclick: UI.closePanel }, 'Cancel')));
        if (!adding && !always) p.appendChild(h('button', { type: 'button', class: 'btn', style: { alignSelf: 'flex-start' }, onclick: function () { UI.closePanel(); toggle(e); } }, e.off ? 'Turn this rule on' : 'Turn this rule off'));
        if (!adding && (always || e.added)) {
          if (!confirmDel) p.appendChild(h('button', { type: 'button', class: 'btn danger', style: { alignSelf: 'flex-start' }, onclick: function () { confirmDel = true; draw(); } }, 'Delete this rule'));
          else p.appendChild(h('div', { class: 'toast warn', role: 'alert' }, h('span', null, 'Delete the rule for "' + e.pattern + '"? Transactions keep their categories.'),
            h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn danger', onclick: del }, 'Delete rule'), h('button', { type: 'button', class: 'btn', onclick: function () { confirmDel = false; draw(); } }, 'Keep it'))));
        }
        if (!adding && !always && !e.added) p.appendChild(h('p', { class: 'small muted', style: { margin: 0 } }, 'File rules are turned off rather than deleted. Your edits are kept in the app and included when you download the file.'));
      }
      function field(label, input, id, help, errKey) {
        return h('div', { class: 'field' }, id ? h('label', { for: id }, label) : h('div', { class: 'label' }, label), input,
          help ? h('div', { class: 'small muted' }, help) : null, errKey ? h('div', { class: 'small red', id: 'err-' + errKey, role: 'alert' }, errs[errKey] || '') : null);
      }
      function errBox(k) { var b = p.querySelector('#err-' + k); if (b) b.textContent = errs[k] || ''; }
      function checkAmt() {
        var mn = f.min === '' ? null : U.calc(f.min), mx = f.max === '' ? null : U.calc(f.max);
        if ((f.min !== '' && (mn === null || mn < 0)) || (f.max !== '' && (mx === null || mx < 0))) return 'Amounts are numbers like 300 (no minus sign).';
        if (mn !== null && mx !== null && mn > mx) return 'The smallest amount is bigger than the largest. Swap them.';
        return '';
      }
      function check() {
        if (!f.pattern.trim()) return 'Type the words to look for.';
        if (f.match === 'regex') { try { new RegExp(f.pattern); } catch (x) { return 'This pattern has a mistake: ' + x.message; } }
        if (f.match !== 'regex' && !Engine.normalize(f.pattern)) return 'Nothing is left once the app cleans this up (it drops words like POS and long numbers). Use the merchant name.';
        return '';
      }
      function preview(box) {
        U.clear(box);
        var pat = f.pattern.trim(); if (!pat || always) return;
        var cleaned = f.match === 'regex' ? pat : Engine.normalize(pat);
        var probe = { id: 'x', kind: f.kind === 'split' ? 'category' : f.kind, pattern: cleaned, match: f.match, value: 'x', priority: '100', apply: 'auto', min: checkAmt() ? '' : f.min, max: checkAmt() ? '' : f.max, dir: f.dir };
        var hitsList = App.txs.filter(function (t) { return t.desc && hits(probe, t.desc, { amount: Math.abs(t.amount), direction: t.direction || (t.type === 'income' ? 'in' : 'out') }); });
        box.appendChild(h('div', { class: 'label' }, hitsList.length ? 'Matches ' + hitsList.length + ' of your transactions' : 'Matches none of your transactions yet'));
        if (cleaned !== pat.toUpperCase() && f.match !== 'regex') box.appendChild(h('div', { class: 'small amber' }, 'Saved as "' + cleaned + '", the way the app cleans bank text before matching.'));
        hitsList.slice(0, 6).forEach(function (t) { box.appendChild(h('div', { class: 'small muted' }, U.shortDate(t.date) + ' · ' + t.desc + ' · now ' + UI.catName(t.categoryId))); });
      }
      /* the three optional columns; only written when used (or when the file already has them) */
      function conds(editing) {
        var mn = f.min === '' ? '' : String(U.calc(f.min)), mx = f.max === '' ? '' : String(U.calc(f.max)), out = [];
        var has = editing && App.cfg.ruleSets[e.set] && App.cfg.ruleSets[e.set].rows[0].map(function (x) { return String(x).trim().toLowerCase(); }).indexOf('min_amount') >= 0;
        if (mn || mx || f.dir || has) out.push(['min_amount', mn], ['max_amount', mx], ['direction', f.dir]);
        return out;
      }
      function submit() {
        if (always) {
          if (!f.value) return;
          var before = App.cfg.rules.slice(), r = App.cfg.rules[e.row];
          App.cfg.rules = App.cfg.rules.slice(); App.cfg.rules[e.row] = Object.assign({}, r, { categoryId: f.value });
          UI.closePanel(); save('Always rule for ' + e.pattern + ' now tags ' + UI.catName(f.value) + '.', function () { App.cfg.rules = before; save('Undone.'); }); return;
        }
        errs.pattern = check(); errs.value = f.value ? (f.kind === 'split' && f.value.indexOf('=') < 0 ? 'Write it as part=amount, separated by ;' : '') : 'Choose what the rule decides.';
        errs.priority = /^-?\d+$/.test(String(f.priority).trim()) ? '' : 'Use a whole number, like 100.';
        errs.amount = checkAmt();
        if (errs.pattern || errs.value || errs.priority || errs.amount) { draw(); var first = p.querySelector('[id^="err-"]:not(:empty)'); if (first) { var inp = first.parentNode.querySelector('input, select'); if (inp) inp.focus(); } return; }
        var pat = f.match === 'regex' ? f.pattern.trim() : Engine.normalize(f.pattern);
        var sets = App.cfg.ruleSets = Object.assign({}, App.cfg.ruleSets || {});
        if (adding) {
          if (!sets.personal) sets.personal = { file: 'rules-personal.csv', rows: [cols().slice()], count: 0, loadedAt: new Date().toISOString() };
          var rows = sets.personal.rows = sets.personal.rows.map(function (r) { return r.slice(); });
          var n = 0; entries().forEach(function (x) { var m = /^M(\d+)$/.exec(x.id); if (m) n = Math.max(n, +m[1]); });
          var id = 'M' + String(n + 1).padStart(3, '0'), row = [];
          [['rule_id', id], ['kind', f.kind], ['pattern', pat], ['match_type', f.match], ['value', f.value], ['priority', String(f.priority).trim()], ['apply', f.apply], ['notes', (f.notes ? f.notes + '; ' : '') + 'added in the app ' + U.today()]].concat(conds()).forEach(function (kv) { setv(rows, row, kv[0], kv[1]); });
          rows.push(row); recount('personal');
          UI.closePanel();
          save('Added rule ' + id + ' (' + pat + ' → ' + f.value + '). It is used from your next import.', function () {
            App.cfg.ruleSets.personal.rows = App.cfg.ruleSets.personal.rows.filter(function (r) { return r !== row && get(App.cfg.ruleSets.personal.rows, r, 'rule_id') !== id; }); recount('personal'); save('Undone.');
          });
          return;
        }
        var set = sets[e.set] = Object.assign({}, sets[e.set]), rws = set.rows = set.rows.slice();
        var old = rws[e.row].slice(), nr = old.slice();
        [['kind', f.kind], ['pattern', pat], ['match_type', f.match], ['value', f.value], ['priority', String(f.priority).trim()], ['apply', f.apply], ['notes', f.notes]].concat(conds(true)).forEach(function (kv) { setv(rws, nr, kv[0], kv[1]); });
        rws[e.row] = nr; recount(e.set);
        UI.closePanel();
        save('Saved ' + e.id + '. It is used from your next import.', function () { var s2 = App.cfg.ruleSets[e.set]; s2.rows = s2.rows.slice(); s2.rows[e.row] = old; recount(e.set); save('Undone.'); });
      }
      function del() {
        UI.closePanel();
        if (always) {
          var before = App.cfg.rules.slice();
          App.cfg.rules = before.filter(function (_, i) { return i !== e.row; });
          save('Always rule for ' + e.pattern + ' deleted.', function () { App.cfg.rules = before; save('Undone.'); }); return;
        }
        var s = App.cfg.ruleSets.personal, beforeRows = s.rows;
        s.rows = s.rows.filter(function (r, i) { return i !== e.row; }); recount('personal');
        save('Rule ' + e.id + ' deleted.', function () { App.cfg.ruleSets.personal.rows = beforeRows; recount('personal'); save('Undone.'); });
      }
      draw();
    }, { label: adding ? 'Add a rule' : 'Edit rule', wide: true });
  }

  function setTest(q) { if (q && q.test !== undefined) st.test = q.test; }
  return { render: render, setTest: setTest, explain: explain, edit: edit };
})();
