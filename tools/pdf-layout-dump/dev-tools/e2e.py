import json, os, re, sys, time
from playwright.sync_api import sync_playwright

S = os.path.dirname(os.path.abspath(__file__))
SAMP = S + "/fixtures"; OUTD = S + "/out"; os.makedirs(OUTD, exist_ok=True)   # run: python3 e2e.py (needs python playwright; set PW_CHROMIUM to a Chromium path if needed)
URL = "file://" + os.path.abspath(os.path.join(S, "..", "index.html"))
exp = json.load(open(SAMP + "/expected.json"))
fails = []
def check(ok, msg):
    print(("PASS " if ok else "FAIL ") + msg)
    if not ok: fails.append(msg)

def snapshot(pg):
    return pg.evaluate("""() => LayoutDump._state.files.map(f => ({name: f.name, status: f.status, pages: f.pageCount, msg: f.msg,
        problems: (f.problems||[]).length, diag: f.exp ? f.exp.diag : null}))""")
def settle(pg, timeout=60000):
    pg.wait_for_function("""() => LayoutDump._state.files.length && LayoutDump._state.files.every(f => !['queued','reading'].includes(f.status))""", timeout=timeout)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get("PW_CHROMIUM") or None)
    ctx = b.new_context(accept_downloads=True, viewport={"width": 1200, "height": 900})
    pg = ctx.new_page()
    logs = []
    pg.on("console", lambda m: logs.append(("console." + m.type, m.text[:200])))
    pg.on("pageerror", lambda e: logs.append(("pageerror", str(e)[:300])))
    pg.on("requestfailed", lambda r: logs.append(("requestfailed", r.url[:120])))
    pg.goto(URL)
    check(pg.evaluate("typeof pdfjsLib !== 'undefined' && typeof pdfjsWorker !== 'undefined'"), "PDF.js loaded as plain scripts from file://")

    files = ["chq.pdf", "chq-wrong.pdf", "card.pdf", "oneline.pdf", "locked.pdf", "scan.pdf"]
    pg.set_input_files("#file", [SAMP + "/" + f for f in files])
    settle(pg)
    snap = {s["name"]: s for s in snapshot(pg)}
    for n in files: print(n, snap[n]["status"], snap[n]["pages"], snap[n]["msg"])
    check(snap["chq.pdf"]["status"] == "ok" and snap["chq.pdf"]["pages"] == 2, "chequing read, 2 pages")
    check(snap["locked.pdf"]["status"] == "locked", "locked PDF asks for a password")
    check(snap["scan.pdf"]["status"] == "scan", "scanned PDF reported as no text")

    # unlock with wrong then right password
    li = pg.locator("#files li", has_text="locked.pdf")
    li.locator("input[type=password]").fill("nope"); li.get_by_role("button", name="Unlock").click(); settle(pg)
    check(snapshot(pg)[4]["status"] == "locked" and "did not work" in snapshot(pg)[4]["msg"], "wrong password rejected")
    li = pg.locator("#files li", has_text="locked.pdf")
    li.locator("input[type=password]").fill("secret123"); li.get_by_role("button", name="Unlock").click(); settle(pg)
    snap = {s["name"]: s for s in snapshot(pg)}
    check(snap["locked.pdf"]["status"] == "ok", "right password unlocks")

    d = snap["chq.pdf"]["diag"]
    print(json.dumps({k: d[k] for k in ("counts", "balance", "dateShapes", "amountShapes")}, indent=None))
    check([c["role"] for c in d["header"]["cols"]] == ["date", "desc", "out", "in", "balance"], "chequing columns found: " + str([c["label"] for c in d["header"]["cols"]]))
    check([c["align"] for c in d["header"]["cols"]][2:] == ["right", "right", "right"], "amount columns detected as right-aligned")
    check(d["counts"]["tx"] == exp["chq"], "chequing transactions = %d (got %d)" % (exp["chq"], d["counts"]["tx"]))
    check(d["counts"]["cont"] >= 6, "wrapped description lines found (%d)" % d["counts"]["cont"])
    check(d["counts"]["repeatedHeader"] == 1, "repeated header on page 2 recognised")
    check(d["balance"]["present"] and d["balance"]["checked"] == exp["chq"] and d["balance"]["consistent"] == exp["chq"], "running balance: all %d add up (checked %d ok %d)" % (exp["chq"], d["balance"]["checked"], d["balance"]["consistent"]))
    w = snap["chq-wrong.pdf"]["diag"]["balance"]
    check(w["mismatches"] == [{"page": 1, "row": 30}] and w["consistent"] == w["checked"] - 1, "one misprinted balance reported once, at page 1 transaction 30: %s" % (w["mismatches"],))

    c = snap["card.pdf"]["diag"]
    print("card", json.dumps({k: c[k] for k in ("counts", "balance", "dateShapes", "amountShapes")}))
    check([x["role"] for x in c["header"]["cols"]] == ["date", "date2", "desc", "amount"], "card columns: " + str([x["label"] for x in c["header"]["cols"]]))
    check(c["counts"]["tx"] == exp["card"], "card transactions = %d (got %d)" % (exp["card"], c["counts"]["tx"]))
    check(not c["balance"]["present"], "card has no running balance")
    check(any("CR" in s["shape"] for s in c["amountShapes"]), "CR marker seen in amount shapes")

    o = snap["oneline.pdf"]["diag"]
    print("oneline", json.dumps({k: o[k] for k in ("counts", "balance", "amountShapes")}), [x["label"] for x in (o["header"] or {"cols": []})["cols"]])
    check(o["header"] is not None and o["counts"]["tx"] == exp["oneline"], "single-string rows: %d transactions (got %s)" % (exp["oneline"], o["counts"]["tx"]))
    check(o["balance"]["present"] and o["balance"]["consistent"] == o["balance"]["checked"] and o["balance"]["checked"] >= exp["oneline"] - 1, "single-string rows: running balance adds up with sign auto-detected (sign %s)" % o["balance"]["sign"])

    # leak checks and downloads for every ok file, default settings
    pg.fill("#keep", ""); pg.fill("#hide", ""); pg.wait_for_timeout(500)
    for i, name in enumerate(files):
        if snapshot(pg)[i]["status"] != "ok": continue
        pg.locator("#files li", has_text=name).locator("button.name").click()
        txt = pg.inner_text("#leak"); check(txt.startswith("Leak check passed"), name + ": " + txt)
        with pg.expect_download() as dj: pg.click("#dlJson")
        dj.value.save_as(OUTD + "/" + name + ".json")
        with pg.expect_download() as dt: pg.click("#dlTxt")
        dt.value.save_as(OUTD + "/" + name + ".txt")
        raw = open(OUTD + "/" + name + ".json").read() + open(OUTD + "/" + name + ".txt").read()
        low = raw.lower()
        leaked = [s for s in exp["secrets"] if s.lower() in low]
        check(not leaked, name + ": none of the private words appear in the files" + (" LEAKED: %s" % leaked if leaked else ""))
        obj = json.loads(open(OUTD + "/" + name + ".json").read())
        bad = [it["t"] for pgd in obj["pages"] for it in pgd["items"] if re.search(r"[0-8]", it["t"])]
        check(not bad, name + ": no digit other than 9 in any text item")
        body_txt = [l for l in open(OUTD + "/" + name + ".txt").read().splitlines() if re.match(r"^\s*\d+ \| ", l)]
        check(not any(re.search(r"[0-8]", l.split(" | ", 1)[1]) for l in body_txt), name + ": text file body has no digit other than 9 (%d lines)" % len(body_txt))

    # program name: off by default, readable only when ticked
    pg.locator("#files li", has_text="chq.pdf").first.locator("button.name").click()
    print("DEBUG sel", pg.evaluate("() => LayoutDump._state.sel"), pg.inner_text("#leak")[:40], "disabled", pg.is_disabled("#dlJson"), "msg:", pg.inner_text("#msg"))
    pg.wait_for_timeout(1500)
    with pg.expect_download() as dj: pg.click("#dlJson")
    dj.value.save_as(OUTD + "/chq-nosw.json"); check("Engine" not in open(OUTD + "/chq-nosw.json").read() and json.load(open(OUTD + "/chq-nosw.json"))["doc"]["software"] is None, "program name not in the file by default")
    pg.check("#sw"); pg.wait_for_timeout(500)
    with pg.expect_download() as dj: pg.click("#dlJson")
    dj.value.save_as(OUTD + "/chq-sw.json"); swd = json.load(open(OUTD + "/chq-sw.json"))["doc"]["software"]
    print("software when ticked:", swd)
    check(swd and "Engine" in swd["creator"] and "9.9" in swd["creator"], "program name appears (digits masked) once ticked")
    pg.uncheck("#sw"); pg.wait_for_timeout(300)

    # keep / hide behaviour
    pg.locator("#files li", has_text="chq.pdf").first.locator("button.name").click()
    pg.fill("#keep", "maple, leaf, bank"); pg.wait_for_timeout(600)
    with pg.expect_download() as dj: pg.click("#dlJson")
    dj.value.save_as(OUTD + "/chq-keep.json"); kept = open(OUTD + "/chq-keep.json").read()
    check("MAPLE LEAF BANK" in kept, "keep list makes the bank name readable")
    check("Aarav" not in kept and "Lindqvist" not in kept, "personal name still masked after keeping bank words")
    pg.fill("#hide", "date, balance"); pg.wait_for_timeout(600)
    with pg.expect_download() as dj: pg.click("#dlJson")
    dj.value.save_as(OUTD + "/chq-hide.json"); hid = json.loads(open(OUTD + "/chq-hide.json").read())
    texts = [it["t"] for it in hid["pages"][0]["items"]]
    check("Date" not in texts and "Balance" not in texts and "Xxxx" in texts, "hide list masks ordinary statement words")
    check(hid["diag"]["counts"]["tx"] == exp["chq"], "analysis unaffected by hiding words (works on real text)")

    # a text input that smuggles a digit into the keep list must not unmask digits
    pg.fill("#hide", ""); pg.fill("#keep", "maple leaf bank 4521 aarav"); pg.wait_for_timeout(600)
    leak = pg.inner_text("#leak"); print("keep with name ->", leak)
    with pg.expect_download() as dj: pg.click("#dlJson")
    dj.value.save_as(OUTD + "/chq-keepname.json"); kk = open(OUTD + "/chq-keepname.json").read()
    check("4521" not in kk, "digits never unmasked, even if typed into the keep box")
    pg.fill("#keep", "")

    # screenshots for a visual check
    pg.locator("#files li", has_text="chq.pdf").first.locator("button.name").click()
    pg.wait_for_timeout(300); pg.screenshot(path=S + "/shot-picture.png", full_page=True)
    pg.click("#tabs >> text=Text"); pg.wait_for_timeout(200); pg.screenshot(path=S + "/shot-text.png", full_page=True)
    pg.click("#tabs >> text=Words"); pg.wait_for_timeout(200); pg.screenshot(path=S + "/shot-words.png", full_page=True)
    # download-all
    if pg.locator("#dlAll").is_visible():
        with pg.expect_download() as da: pg.click("#dlAll")
        da.value.save_as(OUTD + "/all.json"); a = json.loads(open(OUTD + "/all.json").read())
        check(a["format"] == "pdf-layout-set" and len(a["files"]) == 5, "download-all holds %d files" % len(a["files"]))

    # ---- proof checks on fixtures with consistent numbers (summary box, section totals, closing rows)
    pg2 = ctx.new_page(); pg2.goto(URL)
    names = ["sumchq", "sumchq-bad", "cardsum", "cardsum-bad", "cardsec", "cardsec-bad"]
    pg2.set_input_files("#file", [SAMP + "/" + n + ".pdf" for n in names]); settle(pg2)
    R = {s["name"][:-4]: s["diag"] for s in snapshot(pg2)}
    check(all(R[n] and R[n]["header"] for n in names), "all six proof fixtures: table header found")
    g = R["sumchq"]; bd = R["sumchq-bad"]
    check(g["counts"]["tx"] == 7 and g["counts"]["bal"] == 2 and g["balance"]["consistent"] == 7 and g["balance"]["closing"] == 1, "summary chequing: 7 tx, dated opening + closing rows, balance and closing check ok")
    check(g["summary"]["arithmetic"] == 1 and g["summary"]["openingMatch"] == 1 and g["summary"]["closingMatch"] == 1 and g["summary"]["netMatch"] == 1, "summary chequing: box adds up and matches table")
    check(bd["summary"]["arithmetic"] == -1, "summary chequing, one misprinted summary amount: box arithmetic fails")
    g = R["cardsum"]; bd = R["cardsum-bad"]
    check(g["counts"]["tx"] == 5 and g["counts"]["total"] == 2 and g["totals"]["checked"] == 2 and g["totals"]["ok"] == 2, "card with TOTAL CREDITS/DEBITS: trailing '-' credits parse, both totals add up")
    check(g["summary"]["arithmetic"] == 1 and g["summary"]["netMatch"] == 1, "card summary (+/-/=) adds up and matches table net")
    check(bd["totals"]["ok"] == 1 and bd["totals"]["bad"] == [{"n": 2}], "card with one wrong total: only total 2 reported")
    g = R["cardsec"]; bd = R["cardsec-bad"]
    check(g["counts"]["tx"] == 5 and g["totals"]["checked"] == 2 and g["totals"]["ok"] == 2 and g["summary"]["arithmetic"] == 1 and g["summary"]["netMatch"] == 1, "card with sections: Total of... lines and Plus/Less summary all add up")
    check(bd["totals"]["bad"] == [{"n": 2}] and bd["summary"]["arithmetic"] == -1, "card with a wrong subtotal and wrong new balance: both reported")
    pg2.locator("#files li", has_text="cardsec-bad.pdf").locator("button.name").click(); pg2.wait_for_timeout(300)
    st = pg2.inner_text("#summary"); print("SUMMARY TEXT:", st.replace("\n", " | ")[:700])
    check("Section totals: 1 of 2" in st and "does not add up" in st, "page shows the failing subtotal and summary lines in words")
    pg2.locator("#files li", has_text="cardsec.pdf").first.locator("button.name").click(); pg2.wait_for_timeout(300)
    check("Section totals: all 2 add up" in pg2.inner_text("#summary"), "page shows the passing subtotal line")
    b.close()

print("--- browser log (non-trivial)")
seen = set()
for k, t in logs:
    if (k, t) in seen: continue
    seen.add((k, t)); print(k, t)
print("FAILED" if fails else "ALL PASSED", len(fails))
sys.exit(1 if fails else 0)
