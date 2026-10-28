/* Reading the text of a PDF, with where each piece sits on the page. Uses Mozilla pdf.js (vendor/pdfjs, version 3.11.174,
   Apache 2.0), loaded only when a PDF is chosen. It runs on this page: no web worker, no eval, nothing fetched (the page's
   content policy forbids it anyway); the file's bytes are handed over directly.
   PdfRead.pages(bytes, password) -> { pages: [{ n, width, height, items: [{ str, x, y, w, h }] }], textItems }
     x, y: the left and baseline of a piece of text, in points from the page's bottom-left corner.
   Errors carry .code: 'NEED_PASSWORD', 'WRONG_PASSWORD', 'NOT_PDF', 'NO_TEXT'. */
var PdfRead = (function () {
  'use strict';
  var loading = null;
  function script(src) {
    return new Promise(function (ok, no) {
      var s = document.createElement('script'); s.src = src; s.async = false;
      s.onload = function () { ok(); }; s.onerror = function () { no(new Error('Could not load the PDF reader (' + src + ').')); };
      document.head.appendChild(s);
    });
  }
  /* the worker script first (it defines the code pdf.js would otherwise run in a web worker), then pdf.js itself */
  function load() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    loading = loading || script('vendor/pdfjs/pdf.worker.min.js').then(function () { return script('vendor/pdfjs/pdf.min.js'); }).then(function () {
      var lib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
      if (!lib) throw new Error('The PDF reader did not start.');
      window.pdfjsLib = lib;
      return lib;
    });
    return loading;
  }
  function err(code, msg) { var e = new Error(msg); e.code = code; return e; }
  function pages(bytes, password) {
    return load().then(function (lib) {
      var data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      if (!(data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46)) throw err('NOT_PDF', 'This file is not a PDF.');
      var task = lib.getDocument({ data: data, password: password || undefined, isEvalSupported: false, disableFontFace: true, useSystemFonts: false,
        disableAutoFetch: true, disableStream: true, disableRange: true, verbosity: 0, stopAtErrors: false });
      return task.promise.catch(function (e) {
        if (e && e.name === 'PasswordException') throw err(e.code === 2 ? 'WRONG_PASSWORD' : 'NEED_PASSWORD', e.code === 2 ? 'That password does not open this PDF.' : 'This PDF is protected with a password.');
        if (e && /Invalid PDF|InvalidPDF/i.test(e.name + e.message)) throw err('NOT_PDF', 'This file is damaged or not a PDF.');
        throw e;
      }).then(function (doc) {
        var out = [], chain = Promise.resolve(), count = 0;
        for (var i = 1; i <= doc.numPages; i++) (function (n) {
          chain = chain.then(function () { return doc.getPage(n); }).then(function (pg) {
            var vp = pg.getViewport({ scale: 1 });
            return pg.getTextContent({ disableCombineTextItems: false }).then(function (tc) {
              var items = [];
              tc.items.forEach(function (it) {
                if (!it.str || !it.str.trim()) return;
                var t = it.transform;   // [a, b, c, d, e, f]: e, f = position; d (or a) ~ the font size
                items.push({ str: it.str, x: t[4], y: t[5], w: it.width || 0, h: Math.abs(t[3]) || Math.abs(t[0]) || it.height || 10 });
              });
              count += items.length;
              out.push({ n: n, width: vp.width, height: vp.height, items: items });
            });
          });
        })(i);
        return chain.then(function () {
          return doc.destroy().then(function () {
            if (!count) throw err('NO_TEXT', 'This PDF has no readable text: it is probably a scan or a photo. Download the statement from your bank\'s website instead (those PDFs have text).');
            return { pages: out, textItems: count };
          });
        });
      });
    });
  }
  return { load: load, pages: pages };
})();
