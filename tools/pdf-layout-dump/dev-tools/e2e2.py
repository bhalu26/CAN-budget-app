import json
from playwright.sync_api import sync_playwright
import os
HERE=os.path.dirname(os.path.abspath(__file__))
S=HERE+"/fixtures/"
names=["sumchq","sumchq-bad","cardsum","cardsum-bad","cardsec","cardsec-bad"]
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=os.environ.get("PW_CHROMIUM") or None); pg=b.new_page(); pg.goto("file://"+os.path.abspath(os.path.join(HERE,"..","index.html")))
    pg.set_input_files("#file",[S+n+".pdf" for n in names])
    pg.wait_for_function("() => LayoutDump._state.files.length==6 && LayoutDump._state.files.every(f => !['queued','reading'].includes(f.status))",timeout=60000)
    r=pg.evaluate("() => LayoutDump._state.files.map(f=>({n:f.name,st:f.status,d:f.exp&&f.exp.diag,pr:(f.problems||[]).length}))")
    for x in sorted(r,key=lambda x:x["n"]):
        d=x["d"]; print("==",x["n"],x["st"],"problems",x["pr"])
        if d and d.get("counts"):
            print(" hdr",[c["label"]+"/"+c["role"]+"/"+c["align"] for c in (d["header"] or {"cols":[]})["cols"]])
            print(" counts",{k:v for k,v in d["counts"].items() if v})
            print(" bal",{k:d["balance"][k] for k in("present","checked","consistent","closing")}, "mism",d["balance"]["mismatches"])
            print(" totals",d["totals"]); print(" summary",d["summary"])
    b.close()
