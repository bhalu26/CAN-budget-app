import re, subprocess, sys, json, os
root = subprocess.check_output(["npm","root","-g"]).decode().strip() + "/pdfjs-dist"
import os
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "vendor")
ver = json.load(open(root + "/package.json"))["version"]

def read(p): return open(p, encoding="utf-8").read()

# ---- main library
src = read(root + "/legacy/build/pdf.min.mjs")
m = re.search(r"export\s*\{([^}]*)\}\s*;?\s*(//# sourceMappingURL=.*)?\s*$", src)
assert m, "export list not found"
pairs = []
for part in m.group(1).split(","):
    part = part.strip()
    if not part: continue
    if " as " in part:
        a, b = [x.strip() for x in part.split(" as ")]
    else:
        a = b = part
    pairs.append("%s:%s" % (b, a))
body = src[:m.start()]
body = body.replace("import.meta.url", "location.href")
assert "import.meta" not in body
lib = '(function(){"use strict";\n' + body + '\nglobalThis.pdfjsLib={' + ",".join(pairs) + '};\n})();\n'
open(out + "/pdf.js", "w", encoding="utf-8").write(lib)

# ---- worker (runs on the main thread; sets globalThis.pdfjsWorker itself)
w = read(root + "/legacy/build/pdf.worker.min.mjs")
w = re.sub(r"export\s*\{WorkerMessageHandler\}\s*;?\s*(//# sourceMappingURL=.*)?\s*$", "", w)
assert "export{" not in w[-200:].replace(" ", "")
w = w.replace("import.meta.url", "location.href")
assert "import.meta" not in w
open(out + "/pdf.worker.js", "w", encoding="utf-8").write('(function(){"use strict";\n' + w + '\n})();\n')

import shutil
shutil.copy(root + "/LICENSE", out + "/PDFJS-LICENSE.txt")
open(out + "/README.txt", "w").write(
"PDF.js %s (Mozilla, Apache License 2.0; see PDFJS-LICENSE.txt)\n"
"Taken unchanged from the pdfjs-dist \"legacy\" build, with only these edits so it runs as a plain\n"
"script from a local file (Chrome blocks module scripts from file://):\n"
"  - wrapped in a function with \"use strict\"\n"
"  - the final \"export\" list became globalThis.pdfjsLib = {...}\n"
"  - two uses of import.meta.url became location.href (they are only used by Node.js code paths)\n"
"pdf.worker.js is run on the main thread (\"fake worker\"), so no web worker is needed.\n" % ver)
print("ok", ver, len(lib), len(w), len(pairs), "exports")
