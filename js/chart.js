/* Small SVG charts, drawn with plain DOM calls (no libraries, no innerHTML).
   Chart.columns: one series of monthly columns with a budget line; months over budget turn orange AND get an "over"
   label (never colour alone). Each column is a focusable button: hover or focus shows its tooltip, click/Enter picks it.
   Colours are read from the theme at draw time (validated pair: --chart-1 / --chart-over, light and dark).
   Chart.spark: a tiny trend for a row (decorative; the row text carries the numbers). */
var Chart = (function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg', h = U.h;
  function s(tag, attrs, kids) {
    var el = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { if (attrs[k] !== null && attrs[k] !== undefined) el.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function niceMax(v) {
    if (v <= 0) return 100;
    var p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  function compact(v) { return v >= 1000 ? '$' + (v / 1000).toFixed(v >= 10000 || v % 1000 === 0 ? 0 : 1) + 'K' : '$' + Math.round(v); }
  /* Column with 4px rounded top, square at the baseline. */
  function colPath(x, y, w, hgt) {
    var r = Math.min(4, w / 2, hgt);
    return 'M' + x + ',' + (y + hgt) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + hgt) + 'Z';
  }

  /* opts: { data: [{ label, full, value, budget, partial }], title, onPick(i), selected, height }
     Returns a container that draws itself to its width (and redraws when that changes). */
  function columns(opts) {
    var box = h('div', { class: 'chart' }), tip = h('div', { class: 'chart-tip', role: 'status', 'aria-live': 'polite', hidden: true });
    var holder = h('div', { class: 'chart-svg' });
    box.appendChild(holder); box.appendChild(tip);
    var lastW = 0;
    function draw() {
      var W = Math.max(280, Math.round(box.clientWidth || 640)); lastW = W;
      var H = opts.height || 200, padL = 44, padR = 8, padT = 22, padB = 26, n = opts.data.length;
      var maxV = niceMax(Math.max.apply(null, opts.data.map(function (d) { return Math.max(d.value, d.budget || 0); }).concat([1])) * 1.08);
      var y = function (v) { return padT + (H - padT - padB) * (1 - v / maxV); };
      var band = (W - padL - padR) / n, bw = Math.min(24, band * 0.6);
      var css = getComputedStyle(document.documentElement), col = function (v) { return css.getPropertyValue(v).trim(); };
      var svg = s('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'group', 'aria-label': opts.title });
      // gridlines: recessive hairlines with compact labels
      [0, 0.5, 1].forEach(function (f) {
        var v = maxV * f, yy = Math.round(y(v)) + 0.5;
        svg.appendChild(s('line', { x1: padL, x2: W - padR, y1: yy, y2: yy, stroke: col('--line'), 'stroke-width': 1 }));
        svg.appendChild(s('text', { x: padL - 6, y: yy + 4, 'text-anchor': 'end', 'font-size': 11, fill: col('--muted') }, [compact(v)]));
      });
      opts.data.forEach(function (d, i) {
        var cx = padL + band * i + band / 2, x = cx - bw / 2, over = opts.plain ? false : d.budget > 0 ? d.value > d.budget + 10 : d.value > 0 && d.budget === 0;
        var top = y(Math.max(0, d.value)), hgt = Math.max(0, y(0) - top);
        var g = s('g', { class: 'chart-col' + (opts.selected === i ? ' sel' : ''), tabindex: 0, role: 'button',
          'aria-label': d.full + ': ' + U.money(d.value, { cents: true }) + ' ' + (opts.noun || 'spent') + (d.budget ? ' of ' + U.money(d.budget, { whole: true }) + (over ? ', over budget' : '') : '') + (d.partial ? ', so far' : '') + (opts.onPick ? '. Press Enter to show these transactions.' : '') });
        g.appendChild(s('rect', { x: padL + band * i, y: padT - 18, width: band, height: H - padT - padB + 18, fill: 'transparent', class: 'hit' }));
        if (hgt > 0) g.appendChild(s('path', { d: colPath(x, top, bw, hgt), fill: col(over ? '--chart-over' : '--chart-1'), 'fill-opacity': d.partial ? 0.55 : 1, class: 'mark' }));
        if (d.budget > 0) g.appendChild(s('line', { x1: cx - band / 2 + 3, x2: cx + band / 2 - 3, y1: Math.round(y(d.budget)) + 0.5, y2: Math.round(y(d.budget)) + 0.5, stroke: col('--text'), 'stroke-width': 2, 'stroke-linecap': 'round', class: 'budget' }));
        if (over) g.appendChild(s('text', { x: cx, y: Math.min(top, y(d.budget)) - 6, 'text-anchor': 'middle', 'font-size': 10, 'font-weight': 600, fill: col('--text') }, ['over']));
        g.appendChild(s('text', { x: cx, y: H - 8, 'text-anchor': 'middle', 'font-size': 11, fill: col(opts.selected === i ? '--text' : '--muted'), 'font-weight': opts.selected === i ? 600 : 400 }, [d.label]));
        function show() {
          U.clear(tip); tip.hidden = false;
          tip.appendChild(h('strong', null, U.money(d.value, { cents: true }) + (d.partial ? ' so far' : '')));
          tip.appendChild(h('div', null, d.full));
          if (d.budget) tip.appendChild(h('div', { class: 'small' }, 'Budget ' + U.money(d.budget, { whole: true }) + ' · ' + (d.value > d.budget ? U.money(d.value - d.budget, { whole: true }) + ' over' : U.money(d.budget - d.value, { whole: true }) + ' under')));
          if (opts.onPick) tip.appendChild(h('div', { class: 'small muted' }, 'Click for these transactions'));
          var left = Math.min(Math.max(0, cx - 80), W - 170);
          tip.style.left = left + 'px'; tip.style.top = Math.max(0, Math.min(top, y(d.budget || 0)) - 70) + 'px';
        }
        function hide() { tip.hidden = true; }
        g.addEventListener('pointerenter', show); g.addEventListener('pointerleave', hide);
        g.addEventListener('focus', show); g.addEventListener('blur', hide);
        if (opts.onPick) {
          g.addEventListener('click', function () { opts.onPick(i); });
          g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onPick(i); } });
        }
        svg.appendChild(g);
      });
      // a redraw (new width) keeps focus on the same month
      var cols = holder.querySelectorAll('.chart-col'), fi = Array.prototype.indexOf.call(cols, document.activeElement);
      U.clear(holder); holder.appendChild(svg);
      if (fi >= 0) { var nf = svg.querySelectorAll('.chart-col')[fi]; if (nf) nf.focus({ preventScroll: true }); }
    }
    if (typeof ResizeObserver === 'function') new ResizeObserver(function () { if (Math.abs((box.clientWidth || 0) - lastW) > 4) draw(); }).observe(box);
    draw();   // the columns exist at once (so a picked month can take focus); redrawn at the real width once on the page
    box.redraw = function (data) { if (data) opts.data = data; draw(); };
    return box;
  }

  /* A tiny trend: one bar per month, over-limit months in the over colour. Decorative (aria-hidden): the row carries the text. */
  function spark(values, limit, current) {
    var css = getComputedStyle(document.documentElement), col = function (v) { return css.getPropertyValue(v).trim(); };
    var W = 6 * values.length + 2 * (values.length - 1), H = 22, max = Math.max.apply(null, values.concat([limit || 0, 1]));
    var svg = s('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, 'aria-hidden': 'true', class: 'spark-svg' });
    values.forEach(function (v, i) {
      var hh = Math.max(v > 0 ? 2 : 1, Math.round(v / max * H)), over = limit > 0 && v > limit + 10;
      svg.appendChild(s('rect', { x: i * 8, y: H - hh, width: 6, height: hh, rx: 1.5, fill: col(v > 0 ? (over ? '--chart-over' : '--chart-1') : '--line'), 'fill-opacity': i === values.length - 1 && current ? 0.55 : 1 }));
    });
    if (limit > 0 && limit < max) { var ly = Math.round(H - limit / max * H) + 0.5; svg.appendChild(s('line', { x1: 0, x2: W, y1: ly, y2: ly, stroke: col('--muted'), 'stroke-width': 1 })); }
    return svg;
  }

  /* The same numbers as a table (the chart's accessible twin). */
  function table(data, caption) {
    return h('table', { class: 't chart-table' }, h('caption', { class: 'sr-only' }, caption),
      h('thead', null, h('tr', null, h('th', null, 'Month'), h('th', { class: 'r' }, 'Spent'), h('th', { class: 'r' }, 'Budget'), h('th', { class: 'r' }, 'Difference'))),
      h('tbody', null, data.map(function (d) {
        var diff = d.value - (d.budget || 0);
        return h('tr', null, h('td', null, d.full + (d.partial ? ' (so far)' : '')), h('td', { class: 'r' }, U.money(d.value, { cents: true })), h('td', { class: 'r muted' }, d.budget ? U.money(d.budget, { whole: true }) : '—'),
          h('td', { class: 'r ' + (d.budget && diff > 10 ? 'red' : 'ok') }, d.budget ? (diff > 0 ? U.money(diff, { whole: true }) + ' over' : U.money(-diff, { whole: true }) + ' under') : ''));
      })));
  }
  return { columns: columns, spark: spark, table: table };
})();
