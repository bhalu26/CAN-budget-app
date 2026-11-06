Dev tools for the PDF layout tool (not needed to use it)
- gen.py, gen2.py   build the fake test PDFs into fixtures/ (need python: reportlab, pillow)
- e2e.py            browser suite: read, mask, leak check, downloads, passwords, scans, proof checks.
                    Needs python playwright; set PW_CHROMIUM=/path/to/chromium if the default browser is not installed.
                    Run from this folder: python3 e2e.py   (prints PASS/FAIL, ends with ALL PASSED)
- e2e2.py           quick check of one sample
- make_vendor.py    how vendor/pdf.js and pdf.worker.js were made from PDF.js 6.2.108 (needs the pdfjs-dist package)
- (the 7 masked real layouts are kept out of the public repository)
                    rerun.js prints the structure found (node rerun.js); pic.js prints one layout as text.
Node unit test for the same code: node ../../../tests/unit/pdflayout.test.js
