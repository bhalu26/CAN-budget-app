# pdf.js (vendored)

Mozilla pdf.js **3.11.174**, legacy build, from the npm package `pdfjs-dist@3.11.174`, unchanged. Licence: Apache 2.0 (`LICENSE`).

| File | SHA-256 |
|---|---|
| `pdf.min.js` | `978fd1b2d134a98e98966186a97777bebf87d8e770dadab1ece3687e21a5aa6c` |
| `pdf.worker.min.js` | `38cde5311957b86bc3669f93e7d2566de333a90055ed6635bef60d9bf00e96f2` |

The app loads these only when a PDF statement is chosen (`js/pdf-read.js`). They run on the page without a web worker and without eval; the page's content policy allows no network access.
