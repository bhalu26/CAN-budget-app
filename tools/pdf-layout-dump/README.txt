STATEMENT LAYOUT DUMP
=====================
Makes a shareable "layout only" copy of a bank PDF. Every digit becomes 9, every unfamiliar word
becomes xxxx. Statement words (Date, Description, Balance, months...) stay readable so the format can
be recognised. Runs fully offline in Chrome or Edge; the page cannot use the internet.

How to use
1. Keep this folder together (index.html needs the vendor folder next to it). Open index.html in Chrome or Edge.
2. Choose one or more PDF statements (several banks at once is fine). Password-protected PDFs ask for the password.
3. Optional: type your name/street/employer under "Always hide these words". Type your bank's name under
   "Keep these words readable" (it is not personal and helps recognise the bank).
4. Look at the preview (Page picture / Text / Words). Yellow = readable. Click a yellow word to hide it,
   or any other word to keep it readable.
5. "Leak check passed" must show. It re-checks the finished file: no digit except 9, no unmasked word
   except the statement words. If it fails, the download buttons switch off.
6. Download the layout file (.json) and the text file (.txt) and share those. Never share the PDF itself.

What the summary tells you (and the reader can use)
- Table columns found, which side the amounts line up on, date and amount shapes (e.g. "Oct 99", "9,999.99").
- Counts of transaction lines, wrapped description lines, balance lines.
- Running-balance check: whether each printed balance equals the previous balance plus the movement.
  The first line that does not add up is named by page and number only, never by amount.
  A lone misprinted balance is reported once. The closing balance row is compared with the last balance.
- Section totals ("Total of...", TOTAL CREDITS / TOTAL DEBITS) compared with the sum of their lines.
- The statement's own summary box (opening + deposits - withdrawals = closing, or previous balance
  plus purchases less payments = new balance) checked by its own arithmetic, then against the table.
- A warning if dated lines have no readable amount (possible missed transactions).
  All of these are yes/no results and numbers of lines; no amounts are written to the file.

Good to know
- The file name of your PDF is never put in the output.
- "Also show which program made the PDF" is OFF by default: that hidden field can contain names.
- Scanned PDFs (pictures of pages) have no text; ask the bank for a CSV or the text version instead.
- Numbers are masked completely, so amounts and balances cannot be recovered from the shared file.
- The reader files in vendor/ are Mozilla PDF.js (Apache 2.0), see vendor/README.txt.
