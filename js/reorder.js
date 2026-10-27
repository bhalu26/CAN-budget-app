/* A reorderable list: drag by the handle (mouse), or use the ↑ ↓ buttons (keyboard, touch, screen readers).
   onMove(ids, movedItem, newIndex) is called with the new order; the caller saves and redraws, and focus is put back
   on the same arrow button so you can keep moving the item. A polite live region announces each move. */
var Reorder = (function () {
  'use strict';
  var h = U.h, pendingFocus = null, dragId = null;

  function list(o) {
    var items = o.items, ids = items.map(function (it) { return it.id; });
    var ol = h('ol', { class: 'reorder', 'aria-label': o.label });
    function move(from, to, how) {
      if (to < 0 || to >= ids.length || from === to) return;
      var next = ids.slice(), id = next.splice(from, 1)[0];
      next.splice(to, 0, id);
      pendingFocus = how ? 'ro-' + how + '-' + id : null;
      o.onMove(next, items[from], to);
    }
    items.forEach(function (it, i) {
      var li = h('li', { class: 'reorder-item', draggable: 'true', 'data-id': it.id,
        ondragstart: function (e) { dragId = it.id; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', it.id); } catch (x) {} },
        ondragend: function () { dragId = null; li.classList.remove('dragging'); clearMarks(); },
        ondragover: function (e) {
          if (!dragId || dragId === it.id) return;
          e.preventDefault(); e.dataTransfer.dropEffect = 'move';
          var r = li.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
          clearMarks(); li.classList.add(after ? 'drop-after' : 'drop-before');
        },
        ondragleave: function () { li.classList.remove('drop-before', 'drop-after'); },
        ondrop: function (e) {
          e.preventDefault();
          var from = ids.indexOf(dragId); if (from < 0) return;
          var r = li.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2, to = i + (after ? 1 : 0);
          if (from < to) to--;
          clearMarks(); move(from, to, null);
        } },
        h('span', { class: 'grip', 'aria-hidden': 'true', title: 'Drag to move' }, '⠿'),
        h('span', { class: 'reorder-label' }, it.label),
        o.extra ? o.extra(it) : null,
        h('span', { class: 'reorder-btns' },
          h('button', { type: 'button', id: 'ro-up-' + it.id, class: 'btn icon small-icon', disabled: i === 0, 'aria-label': 'Move ' + it.label + ' up', title: 'Move up', onclick: function () { move(i, i - 1, 'up'); } }, '↑'),
          h('button', { type: 'button', id: 'ro-down-' + it.id, class: 'btn icon small-icon', disabled: i === items.length - 1, 'aria-label': 'Move ' + it.label + ' down', title: 'Move down', onclick: function () { move(i, i + 1, 'down'); } }, '↓')));
      ol.appendChild(li);
    });
    function clearMarks() { Array.prototype.forEach.call(ol.querySelectorAll('.drop-before, .drop-after'), function (x) { x.classList.remove('drop-before', 'drop-after'); }); }
    if (pendingFocus) {
      var want = pendingFocus; pendingFocus = null;
      setTimeout(function () {
        var b = document.getElementById(want);
        if (b && b.disabled) b = document.getElementById(want.replace(/^ro-(up|down)-/, function (m, d) { return 'ro-' + (d === 'up' ? 'down' : 'up') + '-'; }));
        if (b) b.focus();
      }, 0);
    }
    return ol;
  }
  return { list: list };
})();
