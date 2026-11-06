PDF.js 6.2.108 (Mozilla, Apache License 2.0; see PDFJS-LICENSE.txt)
Taken unchanged from the pdfjs-dist "legacy" build, with only these edits so it runs as a plain
script from a local file (Chrome blocks module scripts from file://):
  - wrapped in a function with "use strict"
  - the final "export" list became globalThis.pdfjsLib = {...}
  - two uses of import.meta.url became location.href (they are only used by Node.js code paths)
pdf.worker.js is run on the main thread ("fake worker"), so no web worker is needed.
