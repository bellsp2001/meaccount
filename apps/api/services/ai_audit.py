"""
AI Audit Service — Anomaly Detection, Duplicate Detection
Rule-based + statistical heuristics (ไม่ต้องพึ่ง AI API เพื่อความเร็วและ deterministic results)
"""
from decimal import Decimal
from datetime import date, datetime, timedelta
from typing import List, Optional
from statistics import mean, stdev
from sqlalchemy.orm import Session
from sqlalchemy import func, and_

from models.accounting import Journal, JournalEntry, JournalStatus, Account
from models.ar import Invoice, Payment as ARPayment
from models.ap import Bill, APPayment
from schemas.audit import AnomalyItem, AnomalyScanResponse, DuplicateGroup, DuplicateScanResponse


# ── Anomaly Detection ──────────────────────────────────────────

def scan_anomalies(db: Session, period_from: date, period_to: date) -> AnomalyScanResponse:
    """สแกนหารายการผิดปกติในช่วงเวลาที่กำหนด"""
    anomalies: List[AnomalyItem] = []

    journals = db.query(Journal).filter(
        Journal.date >= period_from, Journal.date <= period_to,
        Journal.status == JournalStatus.POSTED, Journal.is_deleted == False,
    ).all()

    # ── 1. Round number detection (จำนวนกลมๆ ผิดปกติ เช่น 100,000.00 พอดี) ──
    for j in journals:
        for entry in j.entries:
            amt = entry.debit or entry.credit
            if amt >= Decimal("10000") and amt % Decimal("10000") == 0:
                anomalies.append(AnomalyItem(
                    severity="low", category="round_number",
                    title="จำนวนเงินกลมผิดปกติ",
                    description=f"รายการ {j.number} มีจำนวนเงิน ฿{amt:,.2f} ซึ่งเป็นเลขกลมพอดี ควรตรวจสอบว่าถูกต้อง",
                    resource_type="journal", resource_id=j.id, reference=j.number,
                    amount=amt, date=j.date, risk_score=25.0,
                ))

    # ── 2. Weekend/holiday posting (ลงบัญชีวันเสาร์-อาทิตย์) ──
    for j in journals:
        if j.date.weekday() >= 5:  # Sat=5, Sun=6
            total = sum(e.debit for e in j.entries)
            anomalies.append(AnomalyItem(
                severity="medium", category="weekend_posting",
                title="ลงบัญชีในวันหยุดสุดสัปดาห์",
                description=f"รายการ {j.number} ลงวันที่ {j.date.strftime('%A %d/%m/%Y')} ซึ่งเป็นวันเสาร์-อาทิตย์",
                resource_type="journal", resource_id=j.id, reference=j.number,
                amount=total, date=j.date, risk_score=40.0,
            ))

    # ── 3. Unusual amount (Z-score outlier detection ต่อบัญชี) ──
    account_amounts: dict = {}
    for j in journals:
        for entry in j.entries:
            amt = float(entry.debit or entry.credit)
            if amt > 0:
                account_amounts.setdefault(str(entry.account_id), []).append((amt, j))

    for acc_id, amounts_journals in account_amounts.items():
        amounts = [x[0] for x in amounts_journals]
        if len(amounts) >= 4:
            m = mean(amounts)
            try:
                sd = stdev(amounts)
            except Exception:
                sd = 0
            if sd > 0:
                for amt, j in amounts_journals:
                    z = (amt - m) / sd
                    if z > 2.5:  # significantly higher than typical
                        acc = db.query(Account).filter(Account.id == acc_id).first()
                        anomalies.append(AnomalyItem(
                            severity="high", category="unusual_amount",
                            title="จำนวนเงินสูงผิดปกติเทียบค่าเฉลี่ย",
                            description=f"รายการ {j.number} ในบัญชี {acc.name if acc else acc_id} มีจำนวน ฿{amt:,.2f} "
                                       f"สูงกว่าค่าเฉลี่ย (฿{m:,.2f}) อย่างมีนัยสำคัญ (Z-score: {z:.1f})",
                            resource_type="journal", resource_id=j.id, reference=j.number,
                            amount=Decimal(str(amt)), date=j.date, risk_score=min(95.0, 50 + z * 10),
                        ))

    # ── 4. Duplicate reference numbers within short time window ──
    seen_refs: dict = {}
    for j in journals:
        if j.reference:
            key = (j.reference, str(j.entries[0].account_id) if j.entries else "")
            if key in seen_refs:
                prev = seen_refs[key]
                anomalies.append(AnomalyItem(
                    severity="high", category="duplicate",
                    title="เลขที่อ้างอิงซ้ำ (สงสัยรายการซ้ำ)",
                    description=f"รายการ {j.number} ({j.date}) มีเลขอ้างอิง '{j.reference}' ซ้ำกับ {prev.number} ({prev.date})",
                    resource_type="journal", resource_id=j.id, reference=j.reference,
                    amount=sum(e.debit for e in j.entries), date=j.date, risk_score=75.0,
                ))
            seen_refs[key] = j

    # ── 5. Same-day duplicate AP payments (จ่ายซ้ำ) ──
    ap_payments = db.query(APPayment).filter(APPayment.date >= period_from, APPayment.date <= period_to).all()
    seen_bill_pay = {}
    for p in ap_payments:
        key = (str(p.bill_id), str(p.amount))
        if key in seen_bill_pay:
            anomalies.append(AnomalyItem(
                severity="high", category="duplicate",
                title="สงสัยจ่ายเงินซ้ำ (Duplicate Payment)",
                description=f"พบการจ่ายเงิน Bill เดียวกันจำนวนเท่ากัน (฿{p.amount:,.2f}) มากกว่า 1 ครั้ง",
                resource_type="payment", resource_id=p.id, reference=p.reference,
                amount=p.amount, date=p.date, risk_score=85.0,
            ))
        seen_bill_pay[key] = p

    # Sort by risk score descending
    anomalies.sort(key=lambda a: a.risk_score, reverse=True)

    high   = sum(1 for a in anomalies if a.severity == "high")
    medium = sum(1 for a in anomalies if a.severity == "medium")
    low    = sum(1 for a in anomalies if a.severity == "low")

    return AnomalyScanResponse(
        scan_date=datetime.utcnow(), period_from=period_from, period_to=period_to,
        total_scanned=len(journals), anomalies_found=len(anomalies),
        high_risk_count=high, medium_risk_count=medium, low_risk_count=low,
        anomalies=anomalies,
    )


# ── Duplicate Detection (Invoice/Bill level) ────────────────────

def scan_duplicates(db: Session) -> DuplicateScanResponse:
    """หา Invoice/Bill ที่อาจซ้ำกัน (ลูกค้า/ผู้ขายเดียวกัน + ยอดเงินเท่ากัน + วันใกล้กัน)"""
    groups: List[DuplicateGroup] = []

    # Invoices: same customer + same total + within 7 days
    invoices = db.query(Invoice).filter(Invoice.is_deleted == False).order_by(Invoice.customer_id, Invoice.date).all()
    checked = set()
    for i, inv1 in enumerate(invoices):
        if inv1.id in checked:
            continue
        matches = [inv1]
        for inv2 in invoices[i+1:]:
            if inv2.id in checked:
                continue
            if (inv1.customer_id == inv2.customer_id and
                abs(inv1.total - inv2.total) < Decimal("0.01") and
                abs((inv2.date - inv1.date).days) <= 7):
                matches.append(inv2)
                checked.add(inv2.id)
        if len(matches) > 1:
            checked.add(inv1.id)
            groups.append(DuplicateGroup(
                resource_type="invoice",
                match_reason=f"ลูกค้าเดียวกัน + ยอดเงินเท่ากัน (฿{inv1.total:,.2f}) + วันที่ใกล้กัน (≤7 วัน)",
                items=[{"id": str(m.id), "number": m.number, "date": str(m.date), "total": float(m.total)} for m in matches],
                confidence=0.75,
            ))

    # Bills: same supplier + same total + within 7 days
    bills = db.query(Bill).filter(Bill.is_deleted == False).order_by(Bill.supplier_id, Bill.date).all()
    checked_b = set()
    for i, b1 in enumerate(bills):
        if b1.id in checked_b or not b1.supplier_id:
            continue
        matches = [b1]
        for b2 in bills[i+1:]:
            if b2.id in checked_b:
                continue
            if (b1.supplier_id == b2.supplier_id and
                abs(b1.total - b2.total) < Decimal("0.01") and
                abs((b2.date - b1.date).days) <= 7):
                matches.append(b2)
                checked_b.add(b2.id)
        if len(matches) > 1:
            checked_b.add(b1.id)
            groups.append(DuplicateGroup(
                resource_type="bill",
                match_reason=f"ผู้ขายเดียวกัน + ยอดเงินเท่ากัน (฿{b1.total:,.2f}) + วันที่ใกล้กัน (≤7 วัน)",
                items=[{"id": str(m.id), "number": m.number, "date": str(m.date), "total": float(m.total)} for m in matches],
                confidence=0.75,
            ))

    return DuplicateScanResponse(
        scan_date=datetime.utcnow(), groups=groups,
        total_found=sum(len(g.items) for g in groups),
    )
