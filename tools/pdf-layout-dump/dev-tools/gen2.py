import os
from reportlab.pdfgen import canvas
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures") + "/"
W, H = 612, 792
def m(c, d="$"): return f"{d}{c/100:,.2f}"

def sumchq(path, bad=False):
    c = canvas.Canvas(path, pagesize=(W, H)); c.setFont("Helvetica", 9)
    c.setFont("Helvetica-Bold", 12); c.drawString(40, 740, "Account summary"); c.setFont("Helvetica", 9)
    wd = 41000 if bad else 40000
    for y, lab, sg, amt in [(715, "Opening balance on Oct 1, 2026", "", m(100000)), (701, "Withdrawals", "-", m(wd, "")),
                             (687, "Deposits", "+", m(60000, "")), (673, "Closing balance on Oct 31, 2026", "=", m(120000))]:
        c.drawString(40, y, lab)
        if sg: c.drawString(250, y, sg)
        c.drawRightString(340, y, amt)
    c.setFont("Helvetica-Bold", 9); y = 600
    c.drawString(40, y, "Date"); c.drawString(100, y, "Description"); c.drawRightString(400, y, "Withdrawals ($)")
    c.drawRightString(470, y, "Deposits ($)"); c.drawRightString(550, y, "Balance ($)"); c.setFont("Helvetica", 9)
    y -= 14; c.drawString(40, y, "Oct 1"); c.drawString(100, y, "Opening balance"); c.drawRightString(550, y, m(100000))
    bal = 100000
    for day, d, w, dep in [(3, "FRESHCO MARKET", 12000, 0), (5, "PAYROLL DEPOSIT", 0, 25000), (9, "HYDRO BILL PAY", 8000, 0),
                           (12, "ZENITH PHYSIO CLINIC", 9500, 0), (15, "E-TRANSFER RECEIVED", 0, 35000), (20, "BLUEBIRD CAFE", 4500, 0),
                           (28, "ROGERS WIRELESS", 6000, 0)]:
        y -= 13; bal += dep - w
        c.drawString(40, y, f"Oct {day}"); c.drawString(100, y, d)
        if w: c.drawRightString(400, y, m(w, ""))
        if dep: c.drawRightString(470, y, m(dep, ""))
        c.drawRightString(550, y, m(bal, ""))
        if day == 12: y -= 13; c.drawString(100, y, "WALK-IN VISIT 2")
    y -= 16; c.drawString(100, y, "Closing balance"); c.drawRightString(550, y, m(bal))
    c.save()

def cardsum(path, bad=False):
    c = canvas.Canvas(path, pagesize=(W, H)); c.setFont("Helvetica", 9)
    c.setFont("Helvetica-Bold", 11); c.drawString(340, 740, "Account Summary"); c.setFont("Helvetica", 9)
    pur = [12000, 8550, 8450]; pur_sum = sum(pur)
    for y, lab, sg, amt in [(715, "Previous balance, Sep 30", "", m(50000)), (701, "Interest", "+", m(1000)),
                             (687, "Payments/credits", "-", m(20000)), (673, "Purchases/charges", "+", m(pur_sum)),
                             (659, "Account Balance", "=", m(60000))]:
        c.drawString(340, y, lab)
        if sg: c.drawString(470, y, sg)
        c.drawRightString(560, y, amt)
    c.setFont("Helvetica-Bold", 9); y = 560
    for x, t in [(40, "REF.#"), (90, "DATE"), (140, "DATE"), (190, "DETAILS")]: c.drawString(x, y, t)
    c.drawRightString(560, y, "AMOUNT($)"); c.setFont("Helvetica", 9)
    rows = [("1001", "Oct 3", "Oct 4", "FRESHCO MARKET", m(pur[0], "")), ("1002", "Oct 6", "Oct 7", "SHELL BURNABY", m(pur[1], "")),
            ("1003", "Oct 9", "Oct 10", "NETFLIX.COM", m(pur[2], "")), ("1004", "Oct 12", "Oct 12", "PAYMENT THANK YOU", m(20000, "") + "-"),
            ("1005", "Oct 31", "Oct 31", "INTEREST CHARGE", m(1000, ""))]
    for ref, d1, d2, desc, amt in rows:
        y -= 13; c.drawString(40, y, ref); c.drawString(90, y, d1); c.drawString(140, y, d2); c.drawString(190, y, desc); c.drawRightString(560, y, amt)
        if ref == "1002": y -= 13; c.drawString(190, y, "STORE 77 NORTH VAN")
    debits = pur_sum + 1000 + (500 if bad else 0)
    y -= 18; c.setFont("Helvetica-Bold", 9); c.drawString(190, y, "TOTAL CREDITS"); c.drawRightString(560, y, m(20000, "") + "-")
    y -= 13; c.drawString(190, y, "TOTAL DEBITS"); c.drawRightString(560, y, m(debits, ""))
    c.save()

def cardsec(path, bad=False):
    c = canvas.Canvas(path, pagesize=(W, H)); c.setFont("Helvetica", 9)
    for y, lab, amt in [(730, "Previous balance", m(50000)), (716, "Plus Purchases & debits", m(29000)),
                        (702, "Less Payments & credits", m(20000)), (688, "New balance", m(59000 + (100 if bad else 0)))]:
        c.drawString(40, y, lab); c.drawRightString(300, y, amt)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(40, 620, "Transaction"); c.drawString(110, 620, "Posting"); c.drawRightString(540, 620, "")
    c.drawString(40, 608, "Date"); c.drawString(110, 608, "Date"); c.drawString(180, 608, "Details"); c.drawRightString(540, 608, "Amount ($)")
    c.setFont("Helvetica", 9); y = 594
    def tx(a, b, d, amt):
        nonlocal y; y -= 13; c.drawString(40, y, a); c.drawString(110, y, b); c.drawString(180, y, d); c.drawRightString(540, y, amt)
    c.setFont("Helvetica-Bold", 9); y -= 13; c.drawString(40, y, "Payments & credits"); c.setFont("Helvetica", 9)
    tx("Oct 5", "Oct 6", "PAYMENT RECEIVED", "-100.00"); tx("Oct 20", "Oct 21", "PAYMENT RECEIVED", "-100.00")
    c.setFont("Helvetica-Bold", 9); y -= 13; c.drawString(180, y, "Total of payments & credits"); c.drawRightString(540, y, "-200.00"); c.setFont("Helvetica", 9)
    y -= 8; c.setFont("Helvetica-Bold", 9); y -= 13; c.drawString(40, y, "Purchases"); c.setFont("Helvetica", 9)
    tx("Oct 3", "Oct 4", "FRESHCO MARKET", "120.00"); tx("Oct 6", "Oct 7", "SHELL BURNABY", "85.50"); tx("Oct 9", "Oct 10", "NETFLIX.COM", "84.50")
    c.setFont("Helvetica-Bold", 9); y -= 13; c.drawString(180, y, "Total of purchases"); c.drawRightString(540, y, "290.00" if not bad else "291.00")
    c.save()

for n, f in [("sumchq", sumchq), ("cardsum", cardsum), ("cardsec", cardsec)]:
    f(OUT + n + ".pdf"); f(OUT + n + "-bad.pdf", True)
print("ok")
