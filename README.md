# Our Budget

A private household budget app that runs entirely in your browser. No account, no server, no tracking: your budget never leaves your device unless you save a file yourself.

**Version 1.0.0** · [What's new](CHANGELOG.md) · [User guide](USER-GUIDE.md) · [Open the app](https://bhalu26.github.io/CAN-budget-app/)

---

## Why use it

- **Private by design.** The page is locked so it cannot use the internet (Content Security Policy `connect-src 'none'`). No backend, no CDN, no analytics.
- **Built for real bank data.** Import CSV files from any bank; the app works out the columns, tags lines with your rules, and shows every row it read.
- **Honest numbers.** Monthly limits, left to spend, bills still due and a month-end estimate, all traceable to the transactions behind them.

## Quick start

You need a desktop browser: Chrome, Edge or Safari.

| | Use it online | Run it from your computer |
|---|---|---|
| **Open** | [bhalu26.github.io/CAN-budget-app](https://bhalu26.github.io/CAN-budget-app/) | Download this repo, open `index.html` |
| **Your budget lives in** | A locked `.budget` file you open and save | The browser on that computer |
| **Best for** | Any device, one file you carry around | One main computer, with automatic backups to a folder (Chrome or Edge) |

**First time:**

1. Pick a budget seed file (online: **Start a new budget**). To try it out, use [`examples/budget-seed.example.json`](examples/budget-seed.example.json); change the categories and limits to your own later in Settings.
2. Set a passphrase (online: straight away; on your computer: Settings › Backup & sharing). Every file the app saves is locked with it.
3. Add expenses by hand (**+ Add expense**), or import a bank CSV (**Import**).

**Just looking?** Load the [demo budget](examples/DEMO.md): a made-up household's 2026 with every feature in use, plus a few problems planted on purpose for testing.
4. Online: press **Save file** when you are done, and keep the `.budget` file somewhere private.

> **Keep your passphrase safe.** Nobody can open your files without it, including you. The app can print a passphrase sheet for you to keep at home.

## Features

| Area | What you get |
|---|---|
| **Budget** | Groups and categories with monthly or yearly limits, saving targets, left to spend, safe to spend |
| **Transactions** | Quick add (`4.75+3.50`), split a line between categories, group bills (count only your share), trips, edit history, Undo everywhere |
| **Import** | Any bank CSV, account detection, balance checks, duplicate protection, tagging rules that learn from you |
| **Bills & subscriptions** | Found from your history, what's due and late, cost per year, and bills not recorded by month end are logged for you |
| **Insights** | Year by category, month grid, income / spent / saved, top merchants, recurring costs |
| **Planning** | Big-expense funds (set aside monthly), accounts and net worth |
| **Data health** | Duplicates, balance gaps, odd dates and amounts, all with a fix or dismiss and Undo |
| **Files & sharing** | Locked `.budget` files, automatic backups, read-only shared snapshots, revision numbers, compare and merge two copies |
| **Comfort** | Keyboard shortcuts (`?`), command search (`Ctrl/Cmd+K`), light and dark themes, phone-sized screens, screen-reader friendly |

## Your data and security

| What | Where it is | Protected by |
|---|---|---|
| `.budget` files, backups, snapshots | Wherever you save them | AES-256-GCM, key from your passphrase (PBKDF2-SHA-256, 600,000 rounds); each file is checked after it is written |
| The budget inside the browser (run from your computer) | That browser's storage | **Not encrypted by the app.** Use your computer's disk encryption (FileVault, BitLocker) |
| Unsaved work (online) | That browser, as a locked recovery copy | Your passphrase; it locks itself after 30 minutes idle |
| Your passphrase | Nowhere | It is never stored |

## Project layout

```
index.html        the app (open this)
css/  js/         the app's code: plain JavaScript, no build step, no dependencies
examples/         a starter budget seed, and a demo budget for 2026 (see examples/DEMO.md)
USER-GUIDE.md     how to use each part of the app
CHANGELOG.md      what changed in each version
```

## Versions

Versions follow [Semantic Versioning](https://semver.org): **major.minor.patch**.

- **Major:** files or data from an earlier version may need a step to carry over (none so far).
- **Minor:** new features. Older budget files always keep opening.
- **Patch:** fixes only.

1.0.0 is the first public release. The private builds before it are listed as 0.1 to 0.23 in the [changelog](CHANGELOG.md).
