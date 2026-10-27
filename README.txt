OUR BUDGET - version 23
========================

What it is
- Your household budget app. It runs entirely in Chrome or Edge on this computer.
- Nothing is sent anywhere: the page is locked so it cannot use the internet.
- Your data is stored inside the browser on this computer only.

First time
1. Put this "budget-app" folder somewhere permanent (for example Documents/budget-app)
   and keep it there. Do not run it from inside the ZIP.
2. Open index.html in Chrome or Edge (right-click > Open with > Chrome or Edge).
   Bookmark it.
3. Choose your private budget-seed.json. Your groups, categories, limits, saving
   targets and cut-over date (Oct 1, 2026) are set up.
4. Settings > Excel history: choose 2026_Budget_Template.xlsx. Check the summary
   (every row is listed as ready, needs a category, or not imported with a reason),
   then press Import.
5. Settings > Backup > Download backup. Keep the file somewhere private.

Every day
- + Add expense: type sums like 4.75+3.50; pick a category; Enter saves and the
  panel stays open for the next one. Choose a trip to send it to Travel.
- Transactions: the month at a glance. Click a category chip to change it on the
  spot; tick "Always tag ... like this" to change every transaction from that merchant.
- Insights: the year so far by category. Click a category to see all its transactions.

Keep your data safe (do this first)
- Settings > Automatic backups > Choose a backup folder (for example
  Documents/Budget backups). Once you set a snapshot passphrase (version 6 section
  below), every backup file is locked with it, so this folder may also live inside
  Google Drive or iCloud as an off-site copy. Keep it separate from the shared
  snapshot folder.
  From then on the app writes a backup there a few seconds after every change:
  budget-latest.json, one file per day (last 30 kept), and a safety copy before
  anything risky (erase, restore, removing Excel history, undoing an import).
- After a browser restart, Chrome/Edge asks once to allow the folder again: press
  "Allow and resume" on Home.
- If the browser's data is ever wiped: open the app, press "Choose backup folder"
  on the first screen; the newest good backup is restored.
- If the app finds fewer transactions than your latest backup, Home warns
  "Possible data loss" and offers a one-click restore; backups pause until you decide.
- Closing the tab while something is typed but not saved, or while saving, asks first.
- Two open tabs stay in step with each other.
- Every save is all-or-nothing, so a crash cannot leave half an import.
- Use a normal (not private) window, and the same browser and folder each time.

Importing bank files (new in version 2)
1. Settings > Tagging rules: load rules-general.csv and rules-personal.csv (once;
   load newer files any time).
2. Import: choose one or more CSV files from your bank. The app reads the file and
   shows "What the app found": the bank (from column names, the lines above the
   table, or the file name), the account or card number (last 4 digits only), and
   the format. It picks the matching account by its number, or offers to add a new
   one in one click. For a format it has never seen, it works out the date,
   description and amount columns from the data (including separate money-in and
   money-out columns, Debit/Credit words, day-first dates and running balances) and
   explains each choice; correct any column once and it is remembered.
3. You see every row read, with a row count ("Read 352 rows: 351 transactions,
   1 header. All rows accounted for, none skipped.") and each row's status:
   Ready, Flagged (needs review), Need a fix, Already in the app, Before cut-over.
   Change any category right in the list.
4. Import all (ready + flagged rows) or tick rows and Import selected.
   Undo this import is available afterwards.
5. Review: flagged rows wait here. All transfers are flagged so you can confirm
   they are between your own accounts. Use "Looks right" or pick another category.

Version 4 additions
- Transactions has a tab for every account, grouped by bank (plus Excel history and
  Added by hand), each with its count and how many wait for review. Period: Month,
  Year or All time.
- Tick several transactions (or "Select all") to set one category for all of them,
  or press "Looks right" to clear their review flags. Undo works for both.
- "Export these as CSV" downloads exactly what you are looking at.
- Transfers between your own accounts are matched automatically (same amount out of
  one account and into another within 3 days); both sides stay flagged for review.
- Money coming in with no category yet is not counted anywhere until you tag it.
- Import: several files at once with "Import all files".
- Home: "Accounts this month" (spend, items to review, latest date per account) and
  a reminder when your last backup is 7 or more days old.
- Insights: choose one account to see its year by category.
- Settings > Check my data: spending by month and source (shows if a month comes from
  both Excel and bank files), possible double counting, loose ends, and every import.

Stress test checklist
1. Fresh start: load budget-seed.json, both rules files, then Excel history with
   "Let me choose a category for each old Extra 1 and Extra 2 row" ticked.
2. Import every October file at once (Import > choose all > give each an account >
   Import all files).
3. Settings > Check my data: each month should show one source; look at the list.
4. Review: clear the flagged lines (use bulk select for repeats).
5. Compare Insights Jan-Sep with your sheet; compare October totals per account with
   your bank statements.
6. Download a backup.

Version 6: shared snapshot and read-only viewer
- Settings > Shared snapshot: set a passphrase ("Suggest one" gives 6 easy words), then
  Print passphrase sheet (keep it at home, never in the shared folder), then
  Choose the shared folder (your Google Drive or iCloud folder on this computer),
  then Save a snapshot now. The newest 3 snapshots are kept in that folder.
- A snapshot is the whole budget locked with the passphrase (AES-256, key made from the
  passphrase with 600,000 rounds of PBKDF2). The passphrase is never stored; the app keeps
  it in the open tab only, so later saves are one click until you reload.
- Home reminds you when the snapshot is a week old and the budget has changed, and once
  a month to "Test a restore": type the passphrase and the app proves the newest
  snapshot opens (nothing here changes).
- On the other computer: copy this budget-app folder there, open index.html in Chrome
  or Edge, choose "Open a shared snapshot", choose the shared folder, type the
  passphrase. Everything is read-only, nothing is kept in that browser, and it locks
  itself after 15 minutes without use. Next time it opens straight to that screen.
- Preview the read-only view (Settings) shows exactly what the viewer sees.
- If this computer is lost: open a snapshot anywhere, then "Make this the main copy"
  at the bottom of Home.

Version 7: locked backups
- With a passphrase set, every backup file is locked with it: the automatic files,
  the safety copies before risky actions, and "Download locked backup". Plain files
  already in the backup folder are locked as soon as the passphrase is set.
- After a restart nothing is asked: this browser keeps a key made from the passphrase
  (it can be used here but never read out; the passphrase itself is not stored).
  If the browser's data is wiped, restoring from the folder or a file asks for the
  passphrase once, then backups carry on.
- Changing the passphrase re-locks every file in the backup folder with the new one.
- Old plain backup files still restore.
- Without the passphrase (and the printed sheet) the backups cannot be opened by
  anyone, including you. Keep the sheet safe.

Version 8: layout
- The menu sits behind the ☰ button at the top left. Folded, it is a slim strip (a dot
  on ☰ means items wait for review); open, a narrow column. Your choice is remembered.
  On a phone it is a top bar and the menu drops down, folding away after you pick.
- Clicking things (opening a group, changing a category, ticking a box) no longer
  jumps the page back to the top; changing screens still starts at the top.

Version 9: gentle animations
- New screens settle in with a short fade; bars grow in when a screen opens.
- Side panels (Add expense, category details) slide in from the right and out a
  little faster. Escape still closes at once.
- Things that open in place fade in: a group on Home, the category editor under a
  transaction, the menu, the confirmation bar. A transaction you just changed glows
  briefly so you can see which one it was.
- Buttons respond to hover and press.
- Nothing replays when the screen redraws, and every animation is 0.3 s or less.
- If "Reduce motion" is on in Windows or macOS settings, movement is replaced by a
  quick fade.

Version 10: download your rules
- Settings > Tagging rules: "Download" beside each loaded file gives it back exactly
  as loaded, under its own name. rules-personal.csv is private.
- "Rules you made" > "Download as CSV" saves your "Always tag" rules in the same
  columns as the rule files (priority 500, so they still win). To keep them for good,
  copy those lines into rules-personal.csv and load that file again: loading a file
  replaces the one in that slot.

Version 11: faster and more interactive
- Ctrl+K (Cmd+K on a Mac): search for any screen, category, month or action. Type an amount
  and a category to add an expense at once: "12.50 groceries", "4.75+3.50 dine out latte".
- Keyboard shortcuts: press ? to see them all. N add an expense, / search, G then H/T/R/I/M/U/S
  to go to a screen, [ ] previous/next month, J/K move through transactions, E change category.
- Review (menu): one flagged line at a time. Press a number to choose its category, Enter if the
  suggestion is right, A to always tag that merchant, S to skip, Z to undo.
- Undo: every change offers Undo in its confirmation bar (edits, deletes, limits, rules,
  review decisions, quick adds, Settings changes).
- Insights: a month-by-month chart (hover or tab to a month; click it for its transactions;
  "Show as table" for the numbers). Click a category for its own chart and a "What if the limit
  were..." slider: drag it to see the year play out; nothing changes until you save.
- Home: click any category, bill or total to see its transactions. Small bars show each
  category's last 6 months. "Customize Home" reorders or hides sections.
- Rules (menu): search all rules, test a bank description to see which rule tags it and why,
  edit a rule, turn one off, or add your own. Edits are kept and included when you download.
- Settings > Categories: "Change order" to drag categories (or use the arrows).
- Settings > Appearance: light, dark, or match your computer.

Version 12: smarter tagging, bills, big-expense funds, accounts and debt
- Tagging with conditions: a rule can apply only above or below an amount, or only to money in
  or out (Rules > Add or edit a rule > "Only when"). Example: COSTCO over $300 = Big Purchases,
  otherwise Groceries. Rules file v3 adds three optional columns: min_amount, max_amount, direction.
- Learning from you: after you tag a merchant the same way 3 times (at least 80% of the time) the
  app suggests it; after 5 out of 5 it applies it. Every tag shows how sure it is (Sure / Likely /
  Guess) and why. Your own choices are always "Sure". e-Transfers are never decided silently.
- Tax refunds (CRA, Revenu Quebec, BC) arriving in your account are suggested as income.
- Bills & subscriptions (G B, or Home > Coming up): the app finds payments that repeat (weekly to
  yearly) in your history; confirm the real ones. Home shows what is coming up in the next 30
  days (Paid / Different amount / Late / Due) and an estimate of where the month will end
  ("How?" shows the working). Not found: twice-a-month payments (1st and 15th) - add them by hand.
- Big expenses are now funds: each has a due month and a start month, and Home shows how much to
  set aside this month (e.g. a $900 fee over 3 months = $300.00 a month). Pay one from its fund
  (Add expense > "Pay from", or tick it in Review when an import matches its bank text): it then
  does not count against that month's limits. Settings > Big expenses: due month, start month,
  category and bank text. A yearly fee's due month may be a guess: check it there.
- Accounts (menu, G A): net worth = cash + investments - debts, with a chart of each month end.
  Balances come from bank files that have a balance column, or you type them in ("Update
  balance"). "About $X today" adds the transactions since. Add accounts you never import (TFSA,
  RRSP, car loan). USD accounts use a rate you type in - no live rates.
- Debts: add each card or loan's interest rate and minimum ("Loan details") to see when it is
  paid off. "Payoff plan" tries highest-rate-first or smallest-balance-first with an extra amount
  each month: debt-free date, interest, months saved. Nothing is saved until "Use this plan".
- Privacy: Settings > Backup now says plainly that the copy inside the browser is not encrypted
  by the app (keep FileVault / BitLocker on); backups and snapshots are encrypted once you set a
  passphrase.

Version 13: Data health and balance checks
- Data health (menu, G D, or the "to check" button on Home): one page listing everything that
  could make your numbers wrong, each with why it was flagged, the amount at stake and a way to
  fix or dismiss it. Nothing changes until you click, and every fix has Undo.
    * Balances against transactions: between two recorded balances, the lines in between must
      explain the change. If not, it shows how much is unexplained (a line missing, counted
      twice, or dated outside the period).
    * Possible duplicates: the same amount and merchant on the same day in two imports (high),
      typed by hand and also imported (high/medium), a day or two apart (medium), or repeated in
      one file (for information: two real purchases are possible). "Delete this one" asks first;
      "Not a duplicate: keep all" remembers your answer.
    * Lines waiting for review: says how much is already counted as spending (an unreviewed
      e-Transfer to yourself is counted until you confirm it) and how much is not counted yet.
    * Categories that no longer exist, impossible or far-future dates, $0 lines, amounts far
      above your usual for a merchant, transfers with no other side (when you have 2+ accounts),
      and months with nothing imported between months that have data.
  "What is checked" always lists every check, so "none" means it looked and found nothing.
  Ignored items stay listed under "Show ignored" so you can bring them back.
- Import preview: for bank files with a running-balance column, the lines are checked against
  the bank's balance. "Balance check passed" or the day where it does not add up and by how much.
  It also warns when a file starts at a different balance than your last recorded one (an earlier
  statement may be missing). Needs about 4 or more lines to recognise the balance column.
- Two files for the same account loaded together: lines that appear in both are imported once.
- Data health never changes the budget maths; it only reads your data.

Version 14: the year at a glance
- Insights (G I) now has three views (buttons under the account picker): By category (as before),
  Month grid, and Income, spent, saved. Ctrl+K "month grid" or "income spent" jumps straight there.
- Month grid: every category down the side, every month across, plus Total and Average a month.
  An amount more than that month's limit is shaded and marked (a triangle for over, two for more
  than 25% over), so it does not depend on colour. Yearly budgets such as Travel are not shaded.
  Group totals sit on the group rows, "All spending" closes the table, and the category column
  stays in view when you scroll sideways on a small screen. Click any amount to see the lines
  behind it. Months before this one with nothing in a category show a dot.
- Income, spent, saved: one row per month with income, what was spent, what was saved, what was
  left over (income - spent - saved) and the savings rate, then a "Year so far" row and the
  average full month, with the same four numbers as tiles on top. Payments made from a
  big-expense fund get their own column and are not in "Spent". "Moved between accounts"
  (transfers, card payments, anything marked not counted) is shown for transparency and is
  never in income or spending. Click an amount to see its lines.
- Every number is the same one Home and the By category view use: spent in a month equals
  the grid's column total and the year total equals Insights' year to date.
- Pick an account at the top to see these views for one account only.

Version 15: split an imported line
- A bank line can be divided between categories after it is imported (Costco: groceries plus
  household). Open it (Transactions > click the name, or Review > "Split...") and choose
  "Split this line...". Line 1 fills in whatever is left, so you usually only type the second
  amount and pick its category. "Put the rest here" fills the remainder in any line; "Add another
  line" for three or more. Save is refused until the lines add up to the bank amount to the cent.
- "Same split as Sep 5: Groceries 70%, Other household 30%" appears when you have split the same
  merchant before; it applies the same shares to this amount (the last line takes the odd cent).
- The bank amount never changes. Every part keeps the bank's date, account, file, line and
  fingerprint, so re-importing the same statement still sees the line as already in, and
  "Undo import" removes all the parts. The month's total spent and left to spend stay the same;
  only the split between categories moves.
- Saving can be undone. Later, open any part > "Change the split..." to adjust it, or "Join back
  into one line" (it asks for the category and waits in Review).
- Only spending lines can be split. A line paid from a big expense must be taken off its fund
  first (the panel says so). Transfers, income and saving are one piece.
- Data health: the parts of one split are never reported as duplicates, and a split whose parts
  no longer add up to the bank amount (you edited or deleted a part) is flagged with a
  "Change the split" button. Parts of a split are also ignored when the app learns where a
  merchant usually belongs.
- Not included: splitting a row in the import preview before importing (split after import,
  where you know the receipt). Rules that split a line automatically work as before.

Version 16: group bills, edit history, reviewed months, recurring, more to click
- Paid for a group (dining out): in Add expense or Edit details tick "I paid for others too: count
  only my share". Enter how many people were at the table (your share fills in, e.g. $120 for 4 =
  $30) or type your own share. The bank amount stays on the line (so balances and duplicate checks
  still work); spending, category totals, left to spend, Insights and the Month grid count only
  your share. Others owe you the rest: Home shows "Others owe you $X from N group bills", and
  Transactions has an "Owed to you" filter. Open the bill > "Track repayments..." to link the
  e-Transfers people sent you (they stay in your history but count as neither income nor
  spending) or to note cash received. A money-in Review card offers "Repays a group bill...".
  Data health flags a group bill still unpaid after 30 days. A shared line cannot also be split.
- Edit history: every change to a line is recorded ("Amount $84.20 -> $84.95", "Category Groceries
  -> Dine out", Marked reviewed, Split, Undo...). Open a line > History. Rows that were edited
  show "edited Oct 23". Data health > "Show recent changes" lists the latest edits across all
  lines. History is kept with the line, so it survives backups and restores (newest 25 per line).
- Reviewed months: on Home, "Mark September as reviewed" keeps a snapshot of that month. If you
  later add, edit or delete lines in it, Home says "Changed since you reviewed...", with "See what
  changed", "Review again" and "Reopen"; Data health lists it too and the Month grid shows a check
  or a warning on that month. It only informs: nothing is ever blocked (adding, editing, deleting
  and importing into a reviewed month all work, with a short note).
- Recurring: Edit details on any line shows whether it is part of a recurring bill. "Make this
  recurring..." opens Bills & subscriptions with the form filled in (name, amount, how often from
  your past payments, next date). "Not part of it" marks just that one payment as not recurring
  (and "Part of it after all" undoes it). New "Twice a month" schedule (e.g. the 1st and 15th, or
  the 15th and the last day), found automatically and added by hand. On Home > Coming up, a bill
  that is due or late and not yet in your transactions has "Log it": opens Add expense filled in.
  Rows of recurring bills show "Recurring: name".
- More to click: Insights tiles open what they summarise; column headings sort; group rows fold
  (Collapse all / Expand all); category names open their panel and amounts open their
  transactions; in the Month grid, month headings, category names and totals are links; in
  Income, spent, saved, month names open that month on Home and year totals open the year's lines.
- Transactions export has a new last column, "My share".

Version 17: monthly and quarterly bills, and a design refresh
- Recurring: Monthly and Quarterly (every 3 months) are now one-click choices ("Quick pick") when you add
  a recurring bill. A quarterly bill is suggested after 2 identical payments (3 if the amount varies).
  Items show what they cost per year and per month (a $300 quarterly bill is "about $100.00 a month"), and
  the panel total says what all your recurring bills come to a month. A quarterly (or any) bill due later in
  the month counts as a bill still to come in the month-end estimate, even in an everyday category.
- Design refresh ("quiet ledger"): a new warm-paper and deep-teal palette in light and dark (all text and
  control colours meet WCAG AA), flat hairline cards, a clearer type scale, and a summary band at the top
  of Home with the big "left to spend" number, a progress bar that says in words how the month is going,
  and Spent / Saved / Income. The reviewed, owed-to-you and month-end rows share one card. See
  docs/DESIGN-REFRESH.md for the references and what was changed.

Version 18: what your recurring bills cost, fixed every month, top spending
- Insights > "Recurring & fixed": what your recurring bills cost a year and a month; "Fixed every month"
  (same amount), "Changes every month" (amount moves, like hydro) and "Quarterly and yearly" (with how much
  to set aside a month). Each fixed bill has a 12-month strip: check = paid, "not equal" = paid a different
  amount, cross = not seen yet, dot = due or coming up (each has words for screen readers). Click a month to
  see that payment. A price rise shows as "$1,500.00 to $1,550.00 since Jul 1 (+$600 a year)".
- Also there: costs by category, "Limits lower than your fixed bills" (Raise limit, with Undo) and "Looks
  fixed, not in your list yet" (Add, or Not recurring, with Undo).
- Insights > "Top spending": top merchants for the year (total, times, average, share; store numbers are
  ignored, refunds are netted) and the biggest single expenses. Everything on them opens its transactions.
- Home: "Bills still due" (click for the list by category) and "Safe to spend" (left to spend minus bills
  still to come), for the current month only.
- Fixed bills that are paid a different amount are now flagged at 2% (was 5%).

Version 19: simpler Import, account drop-down, simpler Add expense
- Import tab: three steps (1 choose files, 2 which account, 3 check the rows), one line saying what was read,
  and the details of how the file was read folded away (they open by themselves if something needs a look).
- After an import a prompt asks: "Close this file, or keep it open?" (also: Review them, Undo this import).
  "Import all files" asks once for all of them. An imported file's rows fold away.
- "Show recent imports" is a tick box under the import area (off by default; the app remembers your choice).
- Transactions (and Insights): the Account filter is a drop-down. It lists only accounts that have transactions.
- Add expense: Amount, Where, Category, Date, then Save. Note, trip, "pay from a big expense" and "I paid for
  others too" are under "More options". Type a shop you have used before and its usual category is filled in
  (with the reason); a category you pick yourself is never changed. Today / Yesterday buttons set the date.
- Decision recorded: unreviewed e-Transfers keep counting as spending until you review them.

Version 20: menu order, Settings sub-menu, Bills & subscriptions page, Accounts
- Menu: Home, Transactions, Insights, Review, Import, Data health, Settings. Rules and Accounts are no longer
  in the menu: they are in the Settings sub-menu (General, Bills & subscriptions, Rules, Accounts, Backup &
  sharing), shown at the top of each of those pages. Shortcuts: G S Settings, G B Bills, G U Rules, G A Accounts, G K Backup.
- Bills & subscriptions is now a page: cost a year and a month, due in the next 30 days, what was found in your
  history (Confirm / Not recurring), search and filters (All, Bills, Subscriptions, Money in, Paused), one compact
  row per bill sorted by when it is next due, and Edit / Pause / Delete on each row (Edit opens its fields under it).
  Home links to it ("Manage bills & subscriptions").
- Accounts: every account name is a field you can change at any time (old transactions show the new name too).
  Type, currency, "closed" and how imports read it are under Details. Loan features are gone: no payoff plan,
  no loan details, no loan type (a loan entered earlier still counts as owed and is listed with the cards).
- Backup & sharing is its own section (automatic backups, download/restore, shared snapshot); the rule files are
  at the bottom of the Rules page.

Version 21: trips for bookings made before the trip, panels that keep their place, QA sweep
- Delete this transaction: the question ("Delete ..., $X?") now appears where the button was and stays in view;
  the cursor goes to "Keep it" (the safe answer). Every side panel keeps its place when it changes (Split, Group
  bill, Rules, the category panel...), and an error after Save is scrolled into view.
- Trips: a flight, hotel or deposit paid weeks before a trip can go on it. Open the line > More options > Trip
  lists every trip (the ones on that date first); the note under it says "Paid 41 days before the trip: it counts
  toward Japan's total, and in Travel for October 2026". Several lines at once: tick them in Transactions and use
  "Set trip" (or "Take off their trip"); Undo works. Home > Travel shows each trip's total with what was booked
  before, and the trip name opens all its lines (Transactions with a "Trip: Japan" filter). Settings > Trips shows
  each trip's total. Your yearly Travel budget still counts each payment in the month it was paid.
- Keyboard: after Show more, folding a group, sorting or a filter, the cursor stays where you were, so Tab carries
  on from there instead of from the top of the page.
- Smaller fixes: very long merchant names wrap on a phone; a link to a category or trip clears an old search;
  bank files with dates like 01.10.2026 are read day first (Oct 1) when nothing in the file says otherwise;
  charts draw at once (picking a month by keyboard keeps the cursor on it).

Version 22: one reliable budget file, and "work from a file" for the hosted page
- Every backup, snapshot and download is now the same kind of file: budget-2026-10-26-1430.budget, always locked with
  your passphrase. Older .json backups and .budgetsnap snapshots still open everywhere.
- The app tells problems apart: "This file is damaged" (a copying or syncing problem: the passphrase is not the problem),
  "This file is cut off" (an unfinished download or sync), "This file is empty" (a cloud placeholder), or "That passphrase
  does not open this file". Spaces pasted before or after the passphrase are forgiven. Every file is opened again and
  checked before it is saved, so a file the app hands you always opens.
- Nothing is ever written unlocked: with no passphrase set, the backup folder pauses (Home and Settings say so) and
  "Download budget file" asks you to set one first.
- Work from a file (the hosted page, or "Work from a budget file" on the first screen): open your budget file, work,
  press Save file. The budget stays in the open tab; only a locked recovery copy is kept, offered back if the tab closes
  before you save. Leaving with unsaved changes asks first; 30 minutes without use locks it. See docs/HOSTING-GITHUB.md.

Version 23: never work on an old copy
- Every budget file you save (Save file, Download budget file, a shared snapshot) has a revision number: 1, 2, 3...
  The message after saving says which, and the Budget file page / Backup & sharing shows the current one.
- Opening an older file says so before anything opens: "There is a newer copy: revision 1 ... You already saved
  revision 2 on ... (file name)". Choose the newer file, or open this one anyway.
- If two copies were changed separately (say the laptop and the phone both worked from revision 1), the app says
  "Two copies were changed separately" and offers to merge them. Compare and merge shows what each side added, changed
  and deleted, keeps both sides' new lines and the later edit of a line changed on both, and lets you keep either
  side's categories and settings. Undo is offered right after. Also under Budget file > "Merge in another file..."
  and Backup & sharing > "Merge a budget file into this budget...".
- On the Mac, restoring a file that is older than the budget in the browser stops first and offers to merge instead.
