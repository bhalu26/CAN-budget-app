/* Minimal offline .xlsx reader: unzips with the browser's own DecompressionStream and reads
   cell values (including the saved results of formulas). Nothing leaves the computer. */
var XLSX = (function () {
  'use strict';

  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  function unzip(buf) {
    var b = new Uint8Array(buf), eocd = -1;
    for (var i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) { if (u32(b, i) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw new Error('This is not an .xlsx file (could not open it as a zip).');
    var n = u16(b, eocd + 10), off = u32(b, eocd + 16), files = {};
    for (var k = 0; k < n; k++) {
      if (u32(b, off) !== 0x02014b50) throw new Error('The .xlsx file looks damaged.');
      var method = u16(b, off + 10), csize = u32(b, off + 20), nlen = u16(b, off + 28), xlen = u16(b, off + 30), clen = u16(b, off + 32), lho = u32(b, off + 42);
      var name = new TextDecoder().decode(b.subarray(off + 46, off + 46 + nlen));
      var dataStart = lho + 30 + u16(b, lho + 26) + u16(b, lho + 28);
      files[name] = { method: method, data: b.subarray(dataStart, dataStart + csize) };
      off += 46 + nlen + xlen + clen;
    }
    return files;
  }
  function inflate(entry) {
    if (entry.method === 0) return Promise.resolve(new TextDecoder().decode(entry.data));
    if (entry.method !== 8) return Promise.reject(new Error('Unsupported compression in .xlsx file.'));
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([entry.data]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (ab) { return new TextDecoder().decode(ab); });
  }
  function xml(text) {
    var d = new DOMParser().parseFromString(text, 'application/xml');
    if (d.getElementsByTagName('parsererror').length) throw new Error('Could not read part of the .xlsx file.');
    return d;
  }
  function byTag(node, tag) { return Array.prototype.slice.call(node.getElementsByTagNameNS('*', tag)); }

  /* Returns { sheetNames: [...], sheet(name) -> Promise<{cells: {A1: {v, f}}, rows: [[...]]}> } */
  function open(buf) {
    var files = unzip(buf);
    function read(path) { return files[path] ? inflate(files[path]) : Promise.resolve(null); }
    return Promise.all([read('xl/workbook.xml'), read('xl/_rels/workbook.xml.rels'), read('xl/sharedStrings.xml')]).then(function (r) {
      if (!r[0]) throw new Error('This .xlsx file has no workbook inside.');
      var wb = xml(r[0]), rels = xml(r[1] || '<r/>'), shared = [];
      if (r[2]) byTag(xml(r[2]), 'si').forEach(function (si) { shared.push(byTag(si, 't').map(function (t) { return t.textContent; }).join('')); });
      var target = {};
      byTag(rels, 'Relationship').forEach(function (x) { target[x.getAttribute('Id')] = x.getAttribute('Target'); });
      var sheets = byTag(wb, 'sheet').map(function (s) {
        var rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
        var t = target[rid] || '';
        var path = t.charAt(0) === '/' ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
        return { name: s.getAttribute('name'), path: path };
      });
      return {
        sheetNames: sheets.map(function (s) { return s.name; }),
        sheet: function (name) {
          var s = sheets.filter(function (x) { return x.name === name; })[0];
          if (!s) return Promise.reject(new Error('The workbook has no sheet named "' + name + '".'));
          return read(s.path).then(function (text) {
            var d = xml(text), cells = {}, rows = [];
            byTag(d, 'c').forEach(function (c) {
              var ref = c.getAttribute('r'), t = c.getAttribute('t'), vEl = byTag(c, 'v')[0], fEl = byTag(c, 'f')[0], v = null;
              if (t === 's' && vEl) v = shared[+vEl.textContent];
              else if (t === 'inlineStr') v = byTag(c, 't').map(function (x) { return x.textContent; }).join('');
              else if (t === 'str' || t === 'e') v = vEl ? vEl.textContent : null;
              else if (t === 'b') v = vEl ? vEl.textContent === '1' : null;
              else if (vEl) v = Number(vEl.textContent);
              var m = /^([A-Z]+)(\d+)$/.exec(ref); if (!m) return;
              var cell = { v: v, f: fEl ? fEl.textContent : null, t: t };
              cells[ref] = cell;
              var ri = +m[2] - 1, ci = colIndex(m[1]);
              (rows[ri] = rows[ri] || [])[ci] = cell;
            });
            return { cells: cells, rows: rows };
          });
        }
      };
    });
  }
  function colIndex(letters) { var n = 0; for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64); return n - 1; }
  /* Excel serial day number -> 'YYYY-MM-DD' (1900 date system). */
  function serialToDate(n) {
    if (typeof n !== 'number' || !isFinite(n) || n < 1) return null;
    var d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 864e5);
    return d.getUTCFullYear() + '-' + U.pad(d.getUTCMonth() + 1) + '-' + U.pad(d.getUTCDate());
  }
  return { open: open, serialToDate: serialToDate, colIndex: colIndex };
})();
