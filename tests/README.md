# Tests

Plain Node scripts. The browser tests use [Playwright](https://playwright.dev) (Chromium).

```
node tests/unit/costs.test.js      # one unit suite
node tests/v20.test.js             # one browser suite
node tests/pdf-import.test.js      # PDF statements in the Import tab
```

**Private files.** Most tests build a budget from your own `budget-seed.json` (categories and limits), and some use your rules files. They are not in this repository.
Put them in `private/budget-seed.json`, `private/rules-personal.csv` and `rules/rules-general.csv`, or point to them:

```
BUDGET_SEED=/path/budget-seed.json BUDGET_RULES=/path/rules-general.csv BUDGET_RULES_PERSONAL=/path/rules-personal.csv BUDGET_PRIVATE_DIR=/path/folder node tests/v20.test.js
```

Without a seed the tests print `SKIP` and stop. `tests/unit/golden.json` (the recorded "golden" numbers) is written on the first run of `calc-regression.test.js` and is git-ignored, because it is derived from your seed.

**Dates.** Many tests use data dated October 2026. `tests/_clock.js` sets the browser's clock to 2026-10-24 (`TEST_TODAY=2026-11-05T12:00:00` changes it, `TEST_TODAY=real` uses the real date).

**Not here.** The old backup-lock, snapshot and offline-acceptance suites tested the previous snapshot design and were not carried over after the locked `.budget` file replaced it.

**PDF tool tests.** `tools/pdf-layout-dump/dev-tools/e2e.py` (Python Playwright) tests the layout tool; the fixtures are made-up statements. `node tests/unit/pdflayout.test.js` and `pdfproof.test.js` need no private files except where they say so.
