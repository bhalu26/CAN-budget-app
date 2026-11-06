import random, json, os, subprocess
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
os.makedirs(OUT, exist_ok=True)
random.seed(7)
W, H = 612, 792
MER = ["FRESHCO MARKET #4521 VANCOUVER BC", "ZENITH PHYSIO CLINIC", "BLUEBIRD CAFE NORTH VAN", "SHELL C7731 BURNABY",
       "E-TRANSFER SENT HARPREET GILL", "PAYROLL DEPOSIT NORTHWIND LTD", "HYDRO ONE BILL PAY", "NETFLIX.COM 866-579-7172",
       "AMOGHA RESTAURANT VANCOUVER", "ROGERS WIRELESS 8841-2290"]

TRUTH = {}
def fmt(c):
    return f"{c/100:,.2f}"

def chequing(path, wrong_at=None):
    c = canvas.Canvas(path, pagesize=(W, H))
    c.setTitle("Statement for Aarav Lindqvist"); c.setAuthor("Aarav Lindqvist"); c.setCreator("MapleLeaf Statement Engine 4.2")
    def head(pg):
        c.setFont("Helvetica-Bold", 14); c.drawString(40, 750, "MAPLE LEAF BANK")
        c.setFont("Helvetica", 9)
        c.drawString(40, 730, "Aarav Lindqvist"); c.drawString(40, 719, "1847 Hollyburn Crescent"); c.drawString(40, 708, "North Vancouver BC V7R 2B9")
        c.drawRightString(572, 730, "Chequing account statement"); c.drawRightString(572, 719, "Account number: 4521-889-0123")
        c.drawRightString(572, 708, "Statement period: Oct 1, 2026 to Oct 31, 2026"); c.drawRightString(572, 40, f"Page {pg} of 2")
    def thead(y):
        c.setFont("Helvetica-Bold", 9)
        c.drawString(40, y, "Date"); c.drawString(100, y, "Description"); c.drawRightString(400, y, "Withdrawals")
        c.drawRightString(470, y, "Deposits"); c.drawRightString(550, y, "Balance"); c.setFont("Helvetica", 9)
    head(1); thead(670)
    y = 652; bal = 250000
    c.drawString(100, y, "Opening balance"); c.drawRightString(550, y, fmt(bal)); y -= 14
    rows = []; n = 0; page = 1
    for i in range(40):
        if y < 80:
            c.showPage(); page = 2; head(2); thead(700); y = 682
        n += 1
        d = f"Oct {1 + i // 2}"
        desc = MER[i % len(MER)]
        if "PAYROLL" in desc: dep = random.randint(150000, 260000); wd = 0
        else: wd = random.randint(500, 24000); dep = 0
        bal += dep - wd
        shown = bal + (100 if wrong_at == n else 0)
        c.drawString(40, y, d); c.drawString(100, y, desc[:48])
        if wd: c.drawRightString(400, y, fmt(wd))
        if dep: c.drawRightString(470, y, fmt(dep))
        c.drawRightString(550, y, fmt(shown))
        rows.append({"date": d, "desc": desc[:48], "cents": dep - wd, "balance": shown, "cont": "REF 8841 TORONTO ON 4455" if i % 6 == 2 else ""})
        y -= 12
        if i % 6 == 2:
            c.setFont("Helvetica", 7.5); c.drawString(100, y, "REF 8841 TORONTO ON 4455"); c.setFont("Helvetica", 9); y -= 12
        y -= 2
    c.drawString(100, y - 6, "Closing balance"); c.drawRightString(550, y - 6, fmt(bal))
    c.save()
    TRUTH[os.path.basename(path)] = {"opening": 250000, "closing": bal, "rows": rows}
    return n

def card(path):
    c = canvas.Canvas(path, pagesize=(W, H)); c.setCreator("PacificCard PDF 2.0")
    c.setFont("Helvetica-Bold", 14); c.drawString(40, 750, "PACIFIC CARD VISA")
    c.setFont("Helvetica", 9)
    c.drawString(40, 730, "AARAV LINDQVIST"); c.drawString(40, 719, "Card number: 4500 12** **** 9876")
    c.drawRightString(572, 730, "Statement period: Sep 25, 2026 - Oct 24, 2026")
    c.drawString(40, 690, "Previous balance"); c.drawRightString(300, 690, "1,200.00"); c.drawString(40, 678, "New balance"); c.drawRightString(300, 678, "1,534.20")
    y = 640; c.setFont("Helvetica-Bold", 9)
    c.drawString(40, y, "Trans date"); c.drawString(100, y, "Post date"); c.drawString(160, y, "Description"); c.drawRightString(550, y, "Amount ($)")
    c.setFont("Helvetica", 9); y -= 16; n = 0; rows = []
    for i in range(16):
        n += 1
        d1 = f"Oct {3 + i}"; d2 = f"Oct {4 + i}"
        if i == 5:
            c.drawString(40, y, "Oct 8"); c.drawString(100, y, "Oct 9"); c.drawString(160, y, "PAYMENT - THANK YOU"); c.drawRightString(550, y, "250.00 CR"); rows.append({"date": "Oct 8", "desc": "PAYMENT - THANK YOU", "cents": -25000, "cont": ""}); y -= 14; continue
        amt = random.randint(300, 15000)
        c.drawString(40, y, d1); c.drawString(100, y, d2); c.drawString(160, y, MER[i % len(MER)][:40]); c.drawRightString(550, y, fmt(amt))
        rows.append({"date": d1, "desc": MER[i % len(MER)][:40], "cents": amt, "cont": "USD 12.50 @ 1.3600" if i == 9 else ""})
        y -= 12
        if i == 9:
            c.setFont("Helvetica", 7.5); c.drawString(160, y, "USD 12.50 @ 1.3600"); c.setFont("Helvetica", 9); y -= 12
        y -= 2
    c.save(); TRUTH[os.path.basename(path)] = {"rows": rows}; return n

def oneline(path):
    c = canvas.Canvas(path, pagesize=(W, H)); c.setCreator("LegacyPrint 1.0")
    c.setFont("Courier-Bold", 9); c.drawString(40, 750, "NORTHERN CREDIT UNION  -  ACCOUNT HISTORY")
    c.setFont("Courier", 9)
    c.drawString(40, 735, "Member: AARAV LINDQVIST      Account 000-4521-889")
    hdr = f"{'Date':<12}{'Description':<42}{'Amount':>11}{'Balance':>13}"
    c.setFont("Courier-Bold", 9); c.drawString(40, 700, hdr); c.setFont("Courier", 9)
    y = 686; bal = 180000; n = 0; rows = []
    for i in range(18):
        n += 1
        amt = random.randint(500, 20000) * (-1 if i % 4 else 1)
        bal += amt
        a = f"{abs(amt)/100:,.2f}" + ("" if amt > 0 else "-")
        line = f"{f'10/{1+i:02d}/2026':<12}{MER[i % len(MER)][:40]:<42}{a:>11}{fmt(bal):>13}"
        c.drawString(40, y, line); y -= 13
        rows.append({"date": f"10/{1+i:02d}/2026", "desc": MER[i % len(MER)][:40], "cents": amt, "balance": bal, "cont": ""})
    c.save(); TRUTH[os.path.basename(path)] = {"opening": 180000, "rows": rows}; return n

def scan(path):
    im = Image.new("RGB", (850, 1100), "white"); d = ImageDraw.Draw(im)
    for i in range(30): d.text((60, 80 + i * 30), f"Oct {i+1}  STORE {i*7}   {i*13}.45", fill="black")
    im.save(OUT + "/_scan.png")
    c = canvas.Canvas(path, pagesize=(W, H)); c.drawImage(ImageReader(OUT + "/_scan.png"), 0, 0, W, H); c.save()

n1 = chequing(OUT + "/chq.pdf")
n1b = chequing(OUT + "/chq-wrong.pdf", wrong_at=30)
n2 = card(OUT + "/card.pdf")
n3 = oneline(OUT + "/oneline.pdf")
scan(OUT + "/scan.pdf")
try:
    subprocess.check_call(["qpdf", "--encrypt", "secret123", "secret123", "256", "--", OUT + "/chq.pdf", OUT + "/locked.pdf"])
except (OSError, subprocess.CalledProcessError):
    print("qpdf not found: locked.pdf not rebuilt (keep the existing one)")
json.dump(TRUTH, open(OUT + "/truth.json", "w"), indent=1)
json.dump({"chq": n1, "card": n2, "oneline": n3,
           "secrets": ["Aarav", "Lindqvist", "Hollyburn", "Crescent", "V7R", "4521", "889", "0123", "FRESHCO", "ZENITH", "BLUEBIRD", "SHELL", "HARPREET", "GILL",
                       "NORTHWIND", "HYDRO", "NETFLIX", "AMOGHA", "ROGERS", "8841", "9876", "NORTHERN", "Pacific", "PACIFIC", "MAPLE", "Maple", "Leaf", "secret123", "MapleLeaf", "Toronto", "TORONTO"]},
          open(OUT + "/expected.json", "w"))
print("made", n1, n2, n3)
