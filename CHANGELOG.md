# Changelog

Versions follow [Semantic Versioning](https://semver.org). Older budget files keep opening in newer versions.
1.0.0 is the first public release; 0.x versions were private builds (their old build number is in brackets).

## Unreleased

**New**
- **PDF statements.** Choose a bank or credit-card statement PDF on the Import screen. It is read on your computer (bundled pdf.js 3.11.174, Apache 2.0; nothing is sent anywhere) and turned into transactions:
  - dates in many forms, with the year taken from the statement period (December/January statements too);
  - descriptions over two lines, separate withdrawal and deposit columns, credits marked CR or in brackets;
  - rows that share a date printed once per day.
- **Checked against the statement itself.** The rows must add up from the opening (or previous) balance to the closing (or new) balance. The screen shows "✓ The rows add up", or exactly how far off they are.
- PDF rows go through the same review as CSV files: the account is matched by the card or account number in the statement, a card's new balance is saved as what is owed, possible duplicates are held back, and Undo works. Each line remembers its page. A scanned PDF (no text) or a file that is not a PDF says so; a password-protected PDF asks for its password.

**Improved**
- **Duplicates are caught more reliably.** Names are compared by their words ("Netflix" and "NETFLIX.COM VANCOUVER" are the same merchant), a line you typed is matched with the bank's even when the amount differs a little (a tip, rounding) or it posts a few days later, and the Excel history is checked too. Not duplicates: a purchase and its refund, two people's payments that share words, two charges the bank listed separately.
- **Recurring bills recognise their payments in more forms**: bank text that includes the bill's name ("APPLE.COM/BILL TORONTO" for an Apple bill), the bill's own part of a combined line ("Streaming 18.99 + Music 11.99" pays $18.99 toward a Streaming bill), and, for a fixed bill, a line in its category with its exact amount. A partial name match far from the bill's amount does not count.
- **Import:**
  - A card file that lists purchases as negative amounts is noticed and read that way, with a note and a "Read amounts the other way" button. The choice is remembered for that bank's format.
  - Rows that may repeat a line already in the app are held back as "Possible duplicates", each with three answers: leave it out, import it, or replace your typed line with the bank's (Undo brings yours back).
  - The import buttons stay in view while you scroll a long file.
- Transfers between your accounts are matched up to 5 days apart (pre-authorized payments can take a few business days).

**Fixed**
- Data health no longer says "balances and transactions do not add up" for an account you only update by hand (a TFSA, say): an account with no transactions has nothing to check its balances against. Accounts you import are still checked, even when nothing came in between two balances, since a statement may be missing.
- A tab left open past the end of a month now logs missed bills by itself (when you come back to it, or within 10 minutes), instead of waiting for you to change screens.
- Two open tabs can no longer log the same missed bill twice.
- "Import all files" now says when a logged line was taken out because its real payment came in.

**New**
- MIT licence.
- A demo budget (`examples/demo-budget-2026.json`): a made-up household's 2026 with every feature in use and a few problems planted for testing, described in `examples/DEMO.md`. `examples/make-demo.js` remakes it for any date.

## 1.0.0 (2026-10-27): first public release

**New**
- **Recurring items logged for you.** A bill, subscription or paycheque with nothing recorded for a date by the end of its month is added as a line marked "Logged automatically", with Undo. It waits out the bill's few days of leeway, and it never fills in months before the feature arrived or dates before you added the bill.
- When the real payment is imported later, the logged line is taken out, so nothing is counted twice. A logged line you edit is kept; one you delete stays deleted.
- Each bill can opt out under Edit: "Log it for me if it is not recorded by the end of the month".

**Docs**
- New README, user guide, changelog and an example budget seed for new users.

## 0.23.0 (build 23): never work on an old copy
- Every saved budget file has a revision number.
- Opening an older file warns you first and points to the newer one.
- Two copies changed separately (say, a laptop and a phone) are detected. Compare and merge shows what each side added, changed and deleted, then merges with Undo.

## 0.22.0 (build 22): one reliable budget file; work from a file
- One file type for backups and snapshots: `budget-YYYY-MM-DD-HHMM.budget`, always locked and checked after saving. Older `.json` and `.budgetsnap` files still open.
- Clear messages for a damaged, cut-off or empty file versus a wrong passphrase.
- "Work from a file" for the hosted page: open, edit, save a new file. Only a locked recovery copy stays on the device.

## 0.21.0 (build 21): trips and steadier screens
- Bookings paid before a trip (flights, hotels, deposits) can go on that trip.
- Delete confirmations and side panels keep their place; the keyboard cursor stays where you were.
- Dates like 01.10.2026 are read day first.

## 0.20.0 (build 20): menu and settings
- Settings sub-menu: General, Bills & subscriptions, Rules, Accounts, Backup & sharing.
- Bills & subscriptions became its own page with search, filters, Pause and Edit.

## 0.19.0 (build 19): simpler Import and Add expense
- Import in three steps: choose files, pick the account, check the rows.
- Add expense fills in a shop's usual category.

## 0.18.0 (build 18): what recurring bills cost
- Insights › Recurring & fixed: yearly and monthly cost, with a 12-month paid/late strip per bill.
- Insights › Top spending: top merchants and biggest expenses.
- Home: Bills still due and Safe to spend.

## 0.17.0 (build 17): quarterly bills and a design refresh
- One-click monthly and quarterly schedules.
- New light and dark palette meeting WCAG AA contrast.

## 0.16.0 (build 16): group bills, edit history, reviewed months
- Count only your share of a group bill, and track repayments.
- History of every change to a line.
- Mark a month as reviewed; you are told if it changes later.
- Twice-a-month bills.

## 0.15.0 (build 15): split a line
- Divide an imported line between categories (for example groceries plus household).

## 0.14.0 (build 14): the year at a glance
- Month grid (categories by month) and an Income / spent / saved view.

## 0.13.0 (build 13): data health
- One page for duplicates, balance gaps, odd dates and amounts, and lines waiting for review.
- Bank balances are checked during import.

## 0.12.0 (build 12): smarter tagging, bills, funds, accounts
- Rules that depend on the amount or direction.
- Tagging that learns from your choices.
- Recurring bills found from your history.
- Big-expense funds.
- Accounts and net worth.

## 0.11.0 (build 11): faster to use
- Command search (`Ctrl/Cmd+K`), keyboard shortcuts and a one-at-a-time Review.
- Undo for every change.
- Charts and "what if" limits.

## 0.10.0 (build 10): download your rules
- Download loaded rule files, and the rules you made, as CSV.

## 0.9.0 (build 9): gentle animations
- Short fades and slides, all under 0.3 s.
- Fades only when "Reduce motion" is on.

## 0.8.0 (build 8): layout
- Foldable menu; on a phone it is a top bar.

## 0.7.0 (build 7): locked backups
- Every backup file is locked with your passphrase.

## 0.6.0 (build 6): shared snapshot
- A locked, read-only copy for another computer.

## 0.1.0 to 0.5.0 (builds 1 to 5): foundations
- Categories and limits, adding expenses, Insights.
- Bank CSV import with tagging rules.
- Account tabs, transfer matching, importing several files at once, automatic backups to a folder.
