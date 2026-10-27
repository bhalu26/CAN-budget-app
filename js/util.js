/* Small helpers shared by every screen. No network, no innerHTML with data. */
var U = (function () {
  'use strict';

  /* h('div', {class: 'x', onclick: fn}, child, 'text', [more]) -> element.
     Text children always become text nodes, so bank descriptions can never inject markup. */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.keys(v).forEach(function (p) { el.style[p] = v[p]; });
        else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked') el.checked = !!v;
        else if (k === 'text') el.textContent = v;
        else el.setAttribute(k, v === true ? '' : String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return; }
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  /* Emptying a side panel to redraw it keeps its place: once the redraw has run, the scroll position comes back and
     focus returns to the same field (or stays inside the panel), so a click near the bottom never jumps to the top. */
  function clear(el) {
    if (el.classList && el.classList.contains('panel') && !el._keep) {
      var y = el.scrollTop, back = holdFocus(el);
      el._keep = true;
      queueMicrotask(function () { el._keep = false; el.scrollTop = y; back(); });
    }
    while (el.firstChild) el.removeChild(el.firstChild); return el;
  }
  /* Remember the focused control inside box before it is rebuilt; the function returned puts focus back on the same
     control (same id, else same label nearest where it was), else on whatever now sits in its place (after "Show more",
     the first new row), else on the box itself, never at the top of the page. Leaves focus alone if the redraw moved it. */
  var FOC = 'input, select, textarea, button, summary, a[href], [tabindex]:not([tabindex="-1"])';
  function focusKey(e) { return e.tagName + '|' + (e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80); }
  function holdFocus(box) {
    var a = document.activeElement;
    if (!a || a === box || !box.contains(a)) return function () {};
    var id = a.id, key = focusKey(a), top = a.getBoundingClientRect().top, idx = Array.prototype.indexOf.call(box.querySelectorAll(FOC), a);
    return function () {
      var now = document.activeElement;
      if (!box.isConnected || (now && now !== box && now !== document.body && box.contains(now))) return;
      var f = id && document.getElementById(id);
      if (!f || !box.contains(f)) {
        f = null;
        // a control with the same label counts only near where it was (another card's "Show all 30" is not the same one)
        Array.prototype.forEach.call(box.querySelectorAll(FOC), function (e) { var d = Math.abs(e.getBoundingClientRect().top - top);
          if (focusKey(e) === key && e.offsetParent !== null && d < 240 && (!f || d < Math.abs(f.getBoundingClientRect().top - top))) f = e; });
      }
      if (!f && idx >= 0) f = box.querySelectorAll(FOC)[idx] || null;
      (f || box).focus({ preventScroll: true });
    };
  }
  /* Bring an element into view after the current redraw has put the panel back where it was. */
  function reveal(el) { if (el) queueMicrotask(function () { if (el.isConnected) el.scrollIntoView({ block: 'nearest' }); }); }

  /* Money: amounts are stored as numbers of dollars rounded to cents. */
  function round2(n) { return Math.round(n * 100) / 100; }
  function money(n, opts) {
    opts = opts || {};
    var neg = n < 0, a = Math.abs(n);
    var whole = opts.whole || (a >= 1000 && !opts.cents);
    var s = (whole ? Math.round(a).toString() : a.toFixed(2)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '−$' : (opts.plus ? '+$' : '$')) + s;
  }

  /* Amount expressions: digits, + - * / ( ) and decimals only. Returns null when not readable. */
  function calc(src) {
    var t = String(src == null ? '' : src).replace(/[\s,$]/g, ''), i = 0;
    if (!t || !/^[0-9+\-*/().]+$/.test(t)) return null;
    function num() { var m = t.slice(i).match(/^\d*\.?\d+/); if (!m) throw 0; i += m[0].length; return parseFloat(m[0]); }
    function fac() { if (t[i] === '-') { i++; return -fac(); } if (t[i] === '+') { i++; return fac(); } if (t[i] === '(') { i++; var v = exp(); if (t[i] !== ')') throw 0; i++; return v; } return num(); }
    function term() { var v = fac(); while (t[i] === '*' || t[i] === '/') { var o = t[i++]; var r = fac(); if (o === '/' && r === 0) throw 0; v = o === '*' ? v * r : v / r; } return v; }
    function exp() { var v = term(); while (t[i] === '+' || t[i] === '-') { var o = t[i++]; var r = term(); v = o === '+' ? v + r : v - r; } return v; }
    try { var v = exp(); if (i !== t.length || !isFinite(v)) return null; return round2(v); } catch (e) { return null; }
  }

  /* Dates are 'YYYY-MM-DD' strings in local time. */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function ym(date) { return date.slice(0, 7); }
  function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function monthLabel(ymStr) { var p = ymStr.split('-'); return MONTHS[+p[1] - 1] + ' ' + p[0]; }
  function shiftMonth(ymStr, d) { var p = ymStr.split('-'); var dt = new Date(+p[0], +p[1] - 1 + d, 1); return dt.getFullYear() + '-' + pad(dt.getMonth() + 1); }
  function dayLabel(date) { var p = date.split('-'); var dt = new Date(+p[0], +p[1] - 1, +p[2]); return WD[dt.getDay()] + ', ' + MON[dt.getMonth()] + ' ' + (+p[2]); }
  function shortDate(date) { var p = date.split('-'); return MON[+p[1] - 1] + ' ' + (+p[2]); }
  function validDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); if (!m) return false;
    var dt = new Date(+m[1], +m[2] - 1, +m[3]);
    return dt.getFullYear() === +m[1] && dt.getMonth() === +m[2] - 1 && dt.getDate() === +m[3];
  }

  /* True for a moment after ts: lets an element animate in once, not again on every redraw. */
  function fresh(ts) { return !!ts && Date.now() - ts < 250; }
  /* Replays an entrance animation on el (class cls) and removes the class afterwards. */
  function animateIn(el, cls) {
    if (!el) return;
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, 350);
  }

  function uid() {
    var a = new Uint8Array(8); crypto.getRandomValues(a);
    return Date.now().toString(36) + Array.prototype.map.call(a, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cat'; }

  function download(name, text, type) {
    var url = URL.createObjectURL(new Blob([text], { type: type || 'application/json' }));
    var a = h('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);   // phones can take a while to start a download
  }
  /* Rows -> CSV text (quotes only where needed, Windows line ends so Excel is happy). */
  function csv(rows) {
    return rows.map(function (r) { return r.map(function (c) { c = c === null || c === undefined ? '' : String(c); return /[",\r\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\r\n') + '\r\n';
  }
  function readFile(file, asBuffer) {
    return new Promise(function (ok, no) {
      var r = new FileReader();
      r.onload = function () { ok(r.result); }; r.onerror = function () { no(r.error); };
      if (asBuffer) r.readAsArrayBuffer(file); else r.readAsText(file);
    });
  }

  return { h: h, clear: clear, reveal: reveal, holdFocus: holdFocus, round2: round2, money: money, calc: calc, pad: pad, today: today, ym: ym, daysInMonth: daysInMonth,
    MONTHS: MONTHS, MON: MON, monthLabel: monthLabel, shiftMonth: shiftMonth, dayLabel: dayLabel, shortDate: shortDate, validDate: validDate,
    fresh: fresh, animateIn: animateIn, uid: uid, slug: slug, download: download, csv: csv, readFile: readFile };
})();
