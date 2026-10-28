/* Start-up, routing and the first-run screen. */
(function () {
  'use strict';
  var h = U.h;

  function parseHash() {
    var m = /^#\/([a-z]+)(?:\?(.*))?$/.exec(location.hash || '');
    var q = {};
    if (m && m[2]) m[2].split('&').forEach(function (kv) { var p = kv.split('='); q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); });
    return { route: m ? m[1] : 'home', q: q };
  }

  /* Redraws the screen in place: the scroll position and the focused field stay where they were
     (the page keeps its height while it is rebuilt, so the browser has no reason to jump to the top). */
  App.render = function () {
    var main = document.getElementById('main'), y = window.scrollY, back = U.holdFocus(main);
    main.style.minHeight = main.offsetHeight + 'px';
    try { draw(U.clear(main)); } finally {
      main.style.minHeight = '';
      window.scrollTo(0, y);
      back();   // focus stays on the control you used (or what replaced it), so the next Tab does not start from the top
    }
  };
  function draw(main) {
    if (Share.wantsOpenScreen()) { U.clear(document.getElementById('nav')); Share.openScreen(main); return; }
    if (!App.cfg) { (WorkFile.hosted() || App.fileWelcome ? fileWelcome : firstRun)(main); U.clear(document.getElementById('nav')); return; }
    var r = parseHash();
    var routes = App.readOnly ? ['home', 'transactions', 'insights'] : ['home', 'transactions', 'review', 'import', 'insights', 'health', 'settings', 'bills', 'rules', 'accounts', 'backup'];
    App.route = routes.indexOf(r.route) >= 0 ? r.route : 'home';
    App.routeQ = r.q;
    UI.nav();
    if (App.readOnly) main.appendChild(Share.banner());
    if (WorkFile.on()) main.appendChild(WorkFile.banner());
    try {
      if (App.route === 'home') Home.render(main);
      else if (App.route === 'transactions') Tx.render(main);
      else if (App.route === 'import') Importer.render(main);
      else if (App.route === 'insights') Insights.render(main);
      else if (App.route === 'review') ReviewStack.render(main);
      else if (App.route === 'accounts') { main.appendChild(Settings.subnav('accounts')); AccountsUI.render(main); }
      else if (App.route === 'health') HealthUI.render(main);
      else if (App.route === 'rules') { main.appendChild(Settings.subnav('rules')); RulesManager.render(main); main.appendChild(Settings.rulesSection()); }
      else if (App.route === 'bills') RecurringUI.render(main);
      else if (App.route === 'backup') Settings.renderBackup(main);
      else Settings.render(main);
    } catch (e) {
      main.appendChild(h('div', { class: 'toast warn', role: 'alert' }, 'Something went wrong showing this screen: ' + e.message + '. Your data is safe; try another screen or reload.'));
      if (window.console) console.error(e);
    }
    UI.showToast();
  }

  function firstRun(main) {
    main.appendChild(h('div', { class: 'stack', style: { maxWidth: '620px' } },
      h('h1', null, 'Welcome to your budget'),
      h('p', null, 'Everything stays in this browser on this computer. Nothing is sent anywhere.'),
      h('div', { class: 'card pad stack' }, h('h2', null, 'Start with your categories and limits'),
        h('p', { class: 'muted', style: { margin: 0 } }, 'Choose your private budget-seed.json. It sets up your groups, categories, limits, saving targets and cut-over date.'),
        fileField('seed', 'Choose budget-seed.json', '.json', function (text) {
          var cfg = M.fromSeed(JSON.parse(text));
          return DB.saveConfig(cfg).then(UI.reload).then(function () { DB.persist(); location.hash = '#/rules'; App.render(); UI.toast('Your categories are set up. Next: load your tagging rules below, then import your history (Settings > General has Excel history).'); });
        })),
      h('div', { class: 'card pad stack' }, h('h2', null, 'Or work from a budget file'),
        h('p', { class: 'muted', style: { margin: 0 } }, 'Open a budget file, edit it, and save a new file. Nothing readable is kept in this browser (only a locked recovery copy). This is how the app works when it is hosted as a web page.'),
        h('button', { type: 'button', class: 'btn', style: { alignSelf: 'flex-start' }, onclick: function () { App.fileWelcome = true; App.render(); } }, 'Work from a budget file')),
      h('div', { class: 'card pad stack' }, h('h2', null, 'Look at the shared budget (read-only)'),
        h('p', { class: 'muted', style: { margin: 0 } }, 'Open a locked snapshot from the shared Google Drive or iCloud folder with its passphrase. Nothing is changed or kept in this browser.'),
        h('button', { type: 'button', class: 'btn', style: { alignSelf: 'flex-start' }, onclick: Share.showOpen }, 'Open a shared snapshot')),
      h('div', { class: 'card pad stack' }, h('h2', null, 'Lost your data? Restore from your backup folder'),
        h('p', { class: 'muted', style: { margin: 0 } }, 'If you set up automatic backups, choose that folder; the newest good backup in it is used.'),
        h('button', { type: 'button', class: 'btn primary', style: { alignSelf: 'flex-start' }, onclick: function () {
          Safety.pickAndFindNewest().then(function (d) { return Safety.restore(d).then(function (n) { location.hash = '#/home'; App.render(); UI.toast('Restored ' + n + ' transactions from ' + d._name + ' (saved ' + d.savedAt.slice(0, 16).replace('T', ' ') + '). Automatic backups continue to that folder.'); }); })
            .catch(function (e) { if (e && e.name === 'AbortError') return; UI.toast('Could not restore: ' + e.message); });
        } }, 'Choose backup folder')),
      h('div', { class: 'card pad stack' }, h('h2', null, 'Or restore a backup file'),
        fileField('bk', 'Choose a budget file or backup', Vault.ACCEPT, function (text) {
          return Share.withPass(function (pass) { return Share.openText(text, pass); }, { title: 'Open a locked backup', verb: 'Open backup' }).then(function (data) {
          if (!data || data.app !== 'household-budget' || !data.config) throw new Error('This is not a backup from this app.');
          return DB.replaceAll(data.config, data.transactions || []).then(UI.reload).then(Share.adoptKey).then(function () { DB.persist(); location.hash = '#/home'; App.render(); }); });
        }))));
  }
  /* Hosted page (or chosen here): work from a budget file; nothing readable is kept in this browser. */
  function fileWelcome(main) {
    WorkFile.welcome(main);
    main.firstChild.appendChild(h('section', { class: 'card pad stack', 'aria-label': 'Look at a budget file' }, h('h2', null, 'Only look at a budget (read-only)'),
      h('p', { class: 'muted', style: { margin: 0 } }, 'Open a budget file to look at, without changing it. Nothing is kept, and it locks itself after 15 minutes.'),
      h('button', { type: 'button', class: 'btn', style: { alignSelf: 'flex-start' }, onclick: Share.showOpen }, 'Open read-only')));
    if (!WorkFile.hosted()) main.firstChild.appendChild(h('button', { type: 'button', class: 'btn link', style: { alignSelf: 'flex-start' }, onclick: function () { App.fileWelcome = false; App.render(); } }, 'Back: keep the budget in this browser instead'));
  }
  function fileField(id, label, accept, handle) {
    var msg = h('div', { class: 'small red', role: 'alert' });
    return h('div', { class: 'field' }, h('label', { for: id }, label),
      h('input', { id: id, type: 'file', accept: accept, class: 'input', style: { paddingTop: '8px' }, onchange: function (e) {
        var f = e.target.files[0]; if (!f) return;
        msg.textContent = '';
        U.readFile(f).then(function (t) { return handle(t); }).catch(function (err) { msg.textContent = 'Could not use this file: ' + err.message; });
      } }), msg);
  }

  // "Skip to main content" moves focus without touching the address (which drives the screens)
  document.getElementById('skip').addEventListener('click', function (e) { e.preventDefault(); var m = document.getElementById('main'); m.focus(); m.scrollIntoView(); });

  window.addEventListener('hashchange', function () {
    var r = parseHash();
    if (document.getElementById('layer').firstChild) UI.closePanel();
    UI.dropToast(1000); // a message from the previous screen does not follow you around
    if (r.route === 'transactions') Tx.setFilterFromHash(r.q);
    if (r.route === 'rules') RulesManager.setTest(r.q);
    UI.closeMenu();
    App.render();
    RecurringUI.autoLog();   // only does anything when the date has changed since it last ran
    var m = document.getElementById('main'); if (m) m.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    U.animateIn(m, 'enter');
  });

  DB.setTxHook(function (list) { Hist.applyAll(App.txs, list); });
  DB.open().then(UI.reload).then(function () { App.hasLocalBudget = !!App.cfg; DB.persist(); return Promise.all([Safety.loadHandle(), Share.load()]); }).then(function () { return Safety.integrity(); }).then(function () {
    var r = parseHash(); if (r.route === 'transactions') Tx.setFilterFromHash(r.q);
    if (r.route === 'rules') RulesManager.setTest(r.q);
    App.render();
    U.animateIn(document.getElementById('main'), 'enter');
    return RecurringUI.autoLog();   // bills and paycheques not recorded by the end of last month
  }).catch(function (e) {
    var main = U.clear(document.getElementById('main'));
    main.appendChild(h('div', { class: 'toast warn', role: 'alert' }, 'This browser would not open local storage (' + e.message + '). Use Chrome or Edge, and not a private window.'));
  });
})();
