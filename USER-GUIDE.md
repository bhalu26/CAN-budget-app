# User guide

How to use each part of Our Budget. New here? Start with the [README](README.md).

**Contents:**
[Two ways to run it](#two-ways-to-run-it) ·
[Setting up](#setting-up) ·
[Every day](#every-day) ·
[Importing bank files](#importing-bank-files) ·
[Bills & subscriptions](#bills--subscriptions) ·
[Insights](#insights) ·
[Planning](#planning) ·
[Data health](#data-health) ·
[Files, backups and sharing](#files-backups-and-sharing) ·
[Shortcuts](#shortcuts)

---

## Two ways to run it

**Online, working from a file** (the hosted page, or "Work from a budget file" on the first screen)
- Open your `.budget` file, type your passphrase, work, then press **Save file** (at the top of every screen). The new file goes to your Downloads folder. Keep your files together in one private place.
- Only a locked recovery copy stays on the device. If the tab closes before you save, open the page again and choose "Unsaved work from …".
- After 30 minutes without use it locks itself. On a shared device, use **Close file** when you're done.

**From your computer** (open `index.html`)
- The budget is kept in that browser. Use a normal window (not private), and the same browser each time.
- Turn on automatic backups (see [Files, backups and sharing](#files-backups-and-sharing)).
- Both ways use the same `.budget` files, so you can move between them.

## Setting up

1. **Budget seed.** Choose a seed file. It holds your groups, categories, monthly or yearly limits, saving targets and an optional *cut-over* date (bank lines before it are skipped on import). Start from [`examples/budget-seed.example.json`](examples/budget-seed.example.json).
2. **Passphrase.** Set one under Settings › Backup & sharing ("Suggest one" gives six easy words). Print the passphrase sheet and keep it at home.
3. **Rules (optional).** Settings › Rules: load rule files (CSV) or add rules as you go. Rules tag bank lines by merchant text; they can also depend on the amount (for example COSTCO over $300 is Big purchases) or on money in or out.
4. **Excel history (optional).** Settings › General › Excel history imports past months from a spreadsheet laid out in the app's template format. Most people can skip it.

## Every day

- **+ Add expense:** type sums like `4.75+3.50`. A shop you've used before fills in its usual category. Enter saves, and the panel stays open for the next one. Note, trip, "pay from a big expense" and "I paid for others too" are under More options.
- **Quick add:** press `Ctrl/Cmd+K` and type `12.50 groceries`.
- **Transactions:** filter by month, year or all time, by account, or by search. Click a category chip to change it, and tick "Always tag … like this" to change every line from that merchant. Tick several lines to set a category or trip for all of them, or export them as CSV.
- **Review:** lines the app wasn't sure about wait here, one at a time. Press a number to pick a category, Enter to accept the suggestion, A to always tag that merchant, Z to undo.
- **Split a line:** open it › "Split this line…" to divide it between categories. The parts must add up to the bank amount.
- **Group bills:** "I paid for others too" counts only your share. Home shows what others owe you, and "Track repayments…" links their e-Transfers.
- **Trips:** put a line on a trip, even a booking paid weeks before. The trip's total includes it.
- **Undo:** every change offers Undo in its confirmation bar. Open any line › History to see every change made to it.

## Importing bank files

1. **Import:** choose one or more CSV files. The app detects the bank, the account (from the last 4 digits) and the columns, and explains each choice. If a column is wrong, correct it once and it's remembered.
2. **Check the rows:** every row read is listed with its status (Ready, Flagged, Needs a fix, Already in the app, Before cut-over). Files with a running balance are checked against the bank's balance.
   - **Possible duplicates** are rows that may repeat a line already in the app (one you typed, or one imported before). They start unticked; choose **Same: leave it out**, **Different: import it**, or, for a line you typed, **Replace mine with the bank's** (it keeps your category; Undo brings your line back).
   - If a card file lists purchases as negative amounts, the app notices and says so; **Read amounts the other way** switches it. The choice is remembered for that bank.
3. **Import all** (or tick rows and use **Import selected**). Use **Undo this import** if something looks wrong.
4. Transfers between your own accounts are matched automatically and flagged for you to confirm in Review.

Importing the same statement twice brings nothing new in: lines already in the app are recognised.

## Bills & subscriptions

Settings › Bills & subscriptions (`G B`).

- **Found in your history:** payments that repeat (weekly to yearly, or twice a month). Choose **Confirm** for the real ones, or **Not recurring**.
- **Add** your own: name, the text on your statement, amount, how often, next date and category.
- **Home › Coming up** shows what's paid, late, due, or paid a different amount. **Safe to spend** is what's left to spend minus bills still due this month.
- **Logged for you:** if a bill or paycheque has nothing recorded by the end of its month, the app adds the line, marked "Logged automatically", with Undo:
  - It waits out the bill's few days of leeway, so a bill due on the 30th and paid on the 2nd isn't logged.
  - A tab left open over the month end catches up when you come back to it, or within 10 minutes.
  - A later import of the real payment takes the logged line out again.
  - A logged line you edit is kept as yours; one you delete stays deleted.
  - An amount that varies is logged at its usual amount. A bill without a category waits in Review.
  - Paused bills are skipped. To stop it for one bill, open Edit and untick "Log it for me if it is not recorded by the end of the month".

## Insights

- **By category:** the year so far. Click a category for its chart and a "what if the limit were…" slider.
- **Month grid:** every category by month. Amounts over the limit are shaded and marked.
- **Income, spent, saved:** one row per month, with the savings rate.
- **Recurring & fixed:** what your bills cost a year and a month, with a 12-month paid / late strip for each.
- **Top spending:** top merchants and biggest expenses.

Pick an account at the top to see one account only. Every number opens the transactions behind it.

## Planning

- **Big expenses (funds):** give one a due month and a start month. Home says how much to set aside each month (for example, $900 over 3 months is $300 a month). Paying it from its fund doesn't count against that month's limits.
- **Accounts:** net worth (cash + investments − debts) by month end. Balances come from bank files or you type them in. Add accounts you never import.
- **Reviewed months:** "Mark … as reviewed" on Home. If that month changes later, you're told what changed.

## Data health

One page (`G D`) listing what could make your numbers wrong:
- possible duplicates (the same payment typed and imported, or imported twice; names are compared by their words and small amount differences are allowed)
- balances the transactions don't explain
- lines waiting for review
- missing categories
- odd dates and amounts
- transfers with no other side
- months with nothing imported

Each item says why it was flagged and what is at stake, with a fix or "ignore" and Undo. Nothing changes until you click.

Balances you type in for an account you never import (a TFSA, say) aren't checked against lines, since there are none to check.

## Files, backups and sharing

Settings › Backup & sharing (`G K`).

- **Budget files:** `budget-YYYY-MM-DD-HHMM.budget`, always locked with your passphrase and checked after they are written. Older `.json` and `.budgetsnap` files still open.
- **Revisions:** each saved file has a revision number. Opening an older copy warns you first. Two copies changed separately can be compared and merged, with Undo ("Merge a budget file into this budget…").
- **Automatic backups** (from your computer, Chrome or Edge): choose a folder. The app writes `budget-latest.budget`, one file a day (the last 30 are kept), and a safety copy before risky actions. After a browser restart, press "Allow and resume" on Home.
- **Shared snapshot:** a locked, read-only copy for another computer. It opens with the passphrase, keeps nothing on that computer, and locks after 15 minutes.
- **If something goes wrong:**
  - The first screen offers "Restore from your backup folder" and "Restore a backup file".
  - If the app finds fewer transactions than the latest backup, Home warns you and offers a one-click restore.
- **Not encrypted:** the copy inside the browser (from your computer) isn't encrypted by the app, so keep your computer's disk encryption on. Without the passphrase, nobody can open your files, including you.

## Shortcuts

Press `?` in the app for the full list.

| Keys | Action |
|---|---|
| `Ctrl/Cmd+K` | Search screens, categories, months and actions; quick add |
| `N` | Add an expense |
| `/` | Search transactions |
| `G` then `H` `T` `R` `I` `M` `D` `S` `B` `U` `A` `K` | Home, Transactions, Review, Insights, Import, Data health, Settings, Bills, Rules, Accounts, Backup |
| `[` `]` | Previous / next month |
| `J` `K` · `E` | Move through transactions · change category |

Settings › Appearance: light, dark, or match your computer. If "Reduce motion" is on, movement becomes a quick fade.
