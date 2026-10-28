# Demo budget

[`demo-budget-2026.json`](demo-budget-2026.json) is a made-up household's 2026, from January 1 to the day the file was made. Load it to look around every screen, or use it to test. Everything in it is invented: no real people, shops or accounts.

## Load it

| Where | How |
|---|---|
| **Online** | Open the app › choose the demo file under **Open your budget file** › set any passphrase (the demo isn't locked, so the app asks for one before it saves anything) |
| **On your computer** | Open `index.html` in a new browser profile › **Or restore a backup file** › choose the demo file |

On a computer, the demo replaces any budget already in that browser, so use a separate browser profile for it.

On first open, the app logs one bill for you: CloudDrive, missed in September. That message is expected.

## What's in it

- **The household:**
  - Two incomes: a paycheque every two weeks, and a monthly one with a raise in July.
  - Rent, bills, everyday spending, and saving $1,600 a month.
  - About 550 lines across 10 months.
- **Accounts:**
  - Everyday Chequing, Rewards Visa and High-interest Savings, with month-end balances from the "bank files".
  - A TFSA and a US Dollar Account, with balances typed in.
- **Budget:**
  - 21 spending categories in 4 groups, plus 3 saving targets.
  - A yearly Travel budget ($4,000).
- **Tagging:**
  - A rule file with 43 rules, including one that depends on the amount (BULKBARN under $250 is Groceries, over is Household).
  - Two "suggest" rules.
  - One Always rule you made (GLOW PHARMACY → Personal care).
- **Bills & subscriptions:**
  - 14 items: rent, phone, internet, hydro (every 2 months, varies), streaming, music, cloud storage, gym, transit, a donation and two paycheques.
  - The card's annual fee is paused.
- **Big expenses:**
  - Car insurance: $1,380 a year, paid in March from its fund.
  - Dental work: $900, paid in September.
  - New laptop: $1,600 due in December, still being set aside.
- **Trips:**
  - Lisbon in spring: flights and a hotel deposit booked months before, then spending there.
  - Cottage long weekend: cabin booked in June.
- **Group bills:**
  - A $184 dinner where your share was $46. Two friends paid you back; one still owes $46.
  - A $96 pizza night: one person paid in cash, one by e-Transfer.
- **Splits:** the warehouse store in March, June and September, split 70/30 between Groceries and Household.
- **History and reviews:**
  - Edit history on a few lines.
  - January to August marked as reviewed.
  - Card payments matched as transfers between your accounts.

## Planted on purpose (for testing)

Opened on the date it was made, Data health shows exactly these, and nothing else:

| What | Where to see it | Expected |
|---|---|---|
| A missing bank line | Data health | Everyday Chequing, Aug 31 → Sep 30: **$64.10 unexplained** (a hardware purchase on Sep 23 that is in the bank's balance but not in the file) |
| A possible duplicate | Data health | **BEANERY COFFEE $5.25**, typed by hand and also imported, a day before the file date |
| An unusually large amount | Data health | **FRESHMART #212 $486.30** on Apr 22, about 7× the usual |
| A transfer with no other side | Data health | **E-TFR TO 3381 $300** on Jul 14 |
| A reviewed month that changed | Data health, Home (go to March) | **March 2026** changed after review: a GREENLEAF MARKET line moved to Household on Sep 4 |
| Money still owed | Home, Data health | **$46.00** from LUNA BISTRO on Jun 6 |
| Lines waiting for review | Review | **7**: an unknown kiosk, a refund, an e-Transfer in, an ATM withdrawal, a "suggest" online store, and this month's card payment (both sides) |
| A missed bill | the message on first open, Transactions | **CloudDrive $3.99, Sep 22**, logged automatically |
| A price change | Insights › Recurring & fixed | Gym **$49.99 → $54.99** from July |
| Paid from funds | Insights, Home › Big expenses | $1,380 (March) and $900 (September), outside the monthly limits |
| Not recurring | Transactions (search TUNEBOX) | a one-off TUNEBOX MUSIC GIFT on Apr 26, marked "not part of a recurring bill" |

## Make a fresh copy

The file is made by [`make-demo.js`](make-demo.js) using the app's own code. The same date always gives the same file.

```
node examples/make-demo.js                     # Jan 1 to today
node examples/make-demo.js --today=2026-12-31  # the whole year
node examples/make-demo.js --today=2026-10-27 --out=/tmp/demo.json
```

The automated check (`tests/demo-data.test.js` in the development package) remakes it for Oct 27, 2026, restores it in a browser, opens every screen, and checks the table above.
