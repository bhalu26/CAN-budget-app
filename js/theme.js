/* Light or dark, applied before the page draws so it never flashes.
   The choice ("system", "light" or "dark") is a per-browser convenience kept in localStorage;
   "system" follows the computer's setting and changes with it. */
var Theme = (function () {
  'use strict';
  var KEY = 'budget-theme', mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function get() { try { var v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system'; } catch (e) { return 'system'; } }
  function resolved() { var c = get(); return c === 'system' ? (mq && mq.matches ? 'dark' : 'light') : c; }
  function apply() { document.documentElement.setAttribute('data-theme', resolved()); }
  function set(v) {
    try { if (v === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, v); } catch (e) {}
    apply();
    if (window.App && App.render && App.cfg) App.render();   // charts read colours at draw time
  }
  if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (get() === 'system') set('system'); });
  apply();
  return { get: get, set: set, resolved: resolved };
})();
