"""
AI Fraud Detection Service — Pattern-based fraud/risk scanning
Rule-based heuristics matching known fraud patterns (deterministic, explainable, no external AI dependency required)
"""
from decimal import Decimal
from datetime import date, datetime, timedelta
from typing import List, Optional, Dict
from uuid import UUID
from statistics import mean, stdev
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from fastapi import HTTPException

from models.fraud import RiskAlert, RiskLevel, AlertStatus, FraudPattern, UserBehaviorProfile
from models.ap import Bill, APPayment, Supplier, BillStatus
from models.ar import Invoice
from models.accounting import Journal, JournalEntry, JournalStatus
from models.user import AuditLog
from schemas.fraud import ScanRequest, FraudScanSummary, RiskAlertResponse


def _risk_level_from_score(score: float) -> RiskLevel:
    if score >= 80: return RiskLevel.CRITICAL
    if score >= 60: return RiskLevel.HIGH
    if score >= 35: return RiskLevel.MEDIUM
    return RiskLevel.LOW


def _create_alert(db: Session, pattern: FraudPattern, score: float, title: str, description: str,
                  resource_type: str, resource_id: Optional[UUID] = None, reference: Optional[str] = None,
                  amount: Optional[Decimal] = None, related_user_id: Optional[UUID] = None) -> RiskAlert:
    # Avoid duplicate alerts for same resource+pattern
    existing = db.query(RiskAlert).filter(
        RiskAlert.pattern == pattern, RiskAlert.resource_id == resource_id,
        RiskAlert.status.in_([AlertStatus.OPEN, AlertStatus.INVESTIGATING]),
    ).first()
    if existing:
        return existing

    alert = RiskAlert(
        pattern=pattern, risk_level=_risk_level_from_score(score), risk_score=Decimal(str(round(score, 2))),
        title=title, description=description, resource_type=resource_type, resource_id=resource_id,
        reference=reference, amount=amount, related_user_id=related_user_id,
        status=AlertStatus.OPEN, detected_at=datetime.utcnow(),
    )
    db.add(alert)
    return alert


# ── Pattern Detectors ──────────────────────────────────────────

def _detect_ghost_vendor(db: Session, period_from: date, period_to: date) -> List[RiskAlert]:
    """ผู้ขายใหม่ (สร้าง <30 วัน) ที่มี Bill ยอดสูงทันที"""
    alerts = []
    suppliers = db.query(Supplier).filter(
        Supplier.created_at >= datetime.combine(period_from - timedelta(days=30), datetime.min.time()),
    ).all()

    for sup in suppliers:
        days_since_created = (datetime.utcnow() - sup.created_at).days
        if days_since_created > 30:
            continue
        bills = db.query(Bill).filter(
            Bill.supplier_id == sup.id, Bill.date >= period_from, Bill.date <= period_to,
        ).all()
        total_amount = sum(b.total for b in bills)

        if total_amount >= Decimal("50000") and days_since_created <= 7:
            score = min(95, 60 + (Decimal("50000") if total_amount > 100000 else 0) / 1000)
            a = _create_alert(
                db, FraudPattern.GHOST_VENDOR, float(score),
                title=f"ผู้ขายใหม่มียอดสั่งซื้อสูงผิดปกติ: {sup.name}",
                description=f"ผู้ขาย '{sup.name}' สร้างเมื่อ {days_since_created} วันที่แล้ว แต่มียอด Bill รวม ฿{total_amount:,.2f} "
                           f"ทันที ({len(bills)} รายการ) — ควรตรวจสอบว่าเป็นผู้ขายจริงหรือไม่",
                resource_type="supplier", resource_id=sup.id, reference=sup.code, amount=total_amount,
            )
            alerts.append(a)
    return alerts


def _detect_duplicate_payment(db: Session, period_from: date, period_to: date) -> List[RiskAlert]:
    """จ่ายเงิน Bill เดียวกัน ยอดเดียวกัน มากกว่า 1 ครั้ง"""
    alerts = []
    payments = db.query(APPayment).filter(
        APPayment.date >= period_from, APPayment.date <= period_to,
    ).all()

    seen: Dict[tuple, APPayment] = {}
    for p in payments:
        key = (str(p.bill_id), str(p.amount))
        if key in seen:
            prev = seen[key]
            a = _create_alert(
                db, FraudPattern.DUPLICATE_PAYMENT, 88,
                title="ตรวจพบการจ่ายเงินซ้ำ (Duplicate Payment)",
                description=f"Bill เดียวกันถูกจ่ายเงินจำนวน ฿{p.amount:,.2f} ซ้ำกัน 2 ครั้ง "
                           f"(วันที่ {prev.date} และ {p.date}) — มีความเสี่ยงสูญเสียเงินจากการจ่ายซ้ำ",
                resource_type="payment", resource_id=p.id, reference=p.reference, amount=p.amount,
                related_user_id=p.paid_by,
            )
            alerts.append(a)
        seen[key] = p
    return alerts


def _detect_split_transaction(db: Session, period_from: date, period_to: date, threshold: Decimal = Decimal("50000")) -> List[RiskAlert]:
    """แตกรายการ Bill เดียวกันเป็นหลายๆ ก้อนเล็กเพื่อหลบ threshold การอนุมัติ
    (ผู้ขายเดียวกัน วันเดียวกัน หลายรายการ รวมกันเกิน threshold แต่แต่ละรายการต่ำกว่า)"""
    alerts = []
    bills = db.query(Bill).filter(
        Bill.date >= period_from, Bill.date <= period_to, Bill.supplier_id.isnot(None),
    ).all()

    grouped: Dict[tuple, List[Bill]] = {}
    for b in bills:
        key = (str(b.supplier_id), str(b.date))
        grouped.setdefault(key, []).append(b)

    for (sup_id, bill_date), group in grouped.items():
        if len(group) < 2:
            continue
        total = sum(b.total for b in group)
        max_single = max(b.total for b in group)
        if total >= threshold and max_single < threshold * Decimal("0.6"):
            sup = db.query(Supplier).filter(Supplier.id == sup_id).first()
            score = 70
            a = _create_alert(
                db, FraudPattern.SPLIT_TRANSACTION, score,
                title=f"สงสัยแตกรายการเพื่อหลบวงเงินอนุมัติ: {sup.name if sup else sup_id}",
                description=f"พบ Bill {len(group)} รายการ จากผู้ขายเดียวกันในวันเดียวกัน ({bill_date}) "
                           f"รวมยอด ฿{total:,.2f} แต่ไม่มีรายการใดเกิน ฿{threshold*Decimal('0.6'):,.0f} "
                           f"ซึ่งอาจเป็นความพยายามหลีกเลี่ยงขั้นตอนอนุมัติวงเงินสูง",
                resource_type="bill", resource_id=group[0].id, amount=total,
            )
            alerts.append(a)
    return alerts


def _detect_off_hours_activity(db: Session, period_from: date, period_to: date) -> List[RiskAlert]:
    """ทำรายการนอกเวลาทำการปกติ (ก่อน 6 โมงเช้า หรือหลัง 4 ทุ่ม)"""
    alerts = []
    journals = db.query(Journal).filter(
        Journal.date >= period_from, Journal.date <= period_to,
        Journal.status == JournalStatus.POSTED,
    ).all()

    for j in journals:
        created_hour = j.created_at.hour if j.created_at else None
        if created_hour is not None and (created_hour < 6 or created_hour >= 22):
            total = sum(e.debit for e in j.entries)
            if total >= Decimal("20000"):   # only flag significant amounts
                a = _create_alert(
                    db, FraudPattern.OFF_HOURS_ACTIVITY, 55,
                    title="ทำรายการบัญชีนอกเวลาทำการ",
                    description=f"Journal {j.number} ถูกสร้างเวลา {created_hour}:00 น. ซึ่งอยู่นอกเวลาทำการปกติ (06:00-22:00) "
                               f"ยอดรายการ ฿{total:,.2f}",
                    resource_type="journal", resource_id=j.id, reference=j.number, amount=total,
                    related_user_id=j.created_by,
                )
                alerts.append(a)
    return alerts


def _detect_rapid_sequence(db: Session, period_from: date, period_to: date) -> List[RiskAlert]:
    """ทำรายการติดกันเร็วผิดปกติ (>10 รายการภายใน 5 นาที โดย user เดียวกัน) — สัญญาณ bot/automation"""
    alerts = []
    logs = db.query(AuditLog).filter(
        AuditLog.created_at >= datetime.combine(period_from, datetime.min.time()),
        AuditLog.created_at <= datetime.combine(period_to, datetime.max.time()),
        AuditLog.action == "CREATE",
    ).order_by(AuditLog.user_id, AuditLog.created_at).all()

    by_user: Dict[str, List[AuditLog]] = {}
    for log in logs:
        if log.user_id:
            by_user.setdefault(str(log.user_id), []).append(log)

    for user_id, user_logs in by_user.items():
        for i in range(len(user_logs) - 9):
            window = user_logs[i:i+10]
            span = (window[-1].created_at - window[0].created_at).total_seconds()
            if span <= 300:  # 10 actions within 5 minutes
                a = _create_alert(
                    db, FraudPattern.RAPID_SEQUENCE, 45,
                    title="ทำรายการติดกันเร็วผิดปกติ",
                    description=f"ผู้ใช้ทำรายการ 10 ครั้งภายใน {span:.0f} วินาที ซึ่งเร็วผิดปกติสำหรับการทำงานปกติของมนุษย์ "
                               f"อาจเป็นสัญญาณของ automation หรือ bulk import ที่ไม่ได้รับอนุญาต",
                    resource_type="audit_log", resource_id=None, related_user_id=UUID(user_id),
                )
                alerts.append(a)
                break  # only flag once per user per scan
    return alerts


def _detect_new_vendor_large_amount(db: Session, period_from: date, period_to: date) -> List[RiskAlert]:
    """ผู้ขายที่ไม่เคยมี transaction มาก่อน จู่ๆ มี Bill ยอดสูงผิดปกติเทียบค่าเฉลี่ยของบริษัท"""
    alerts = []
    all_bills = db.query(Bill).filter(Bill.gl_posted == True).all()
    if len(all_bills) < 5:
        return alerts

    new_bills = db.query(Bill).filter(Bill.date >= period_from, Bill.date <= period_to).all()
    new_bill_ids = {b.id for b in new_bills}

    # Baseline stats must exclude the bill being tested, otherwise a large outlier
    # drags its own mean/stdev up and can mask itself (self-contamination).
    baseline_amounts = [float(b.total) for b in all_bills if b.id not in new_bill_ids]
    if len(baseline_amounts) < 4:
        baseline_amounts = [float(b.total) for b in all_bills]  # fallback if too few excluded

    avg_amt = mean(baseline_amounts)
    try:
        sd = stdev(baseline_amounts)
    except Exception:
        sd = 0

    if sd == 0:
        return alerts

    for b in new_bills:
        z = (float(b.total) - avg_amt) / sd
        if z > 3.0:  # more than 3 standard deviations above baseline mean
            supplier_bill_count = db.query(Bill).filter(Bill.supplier_id == b.supplier_id).count()
            if supplier_bill_count <= 1:  # this is their first/only bill
                a = _create_alert(
                    db, FraudPattern.NEW_VENDOR_LARGE, min(90, 50 + z * 10),
                    title="ผู้ขายใหม่มียอดเงินสูงผิดปกติ",
                    description=f"Bill {b.number} จำนวน ฿{b.total:,.2f} สูงกว่าค่าเฉลี่ยของบริษัท (฿{avg_amt:,.2f}) "
                               f"อย่างมีนัยสำคัญ (Z-score: {z:.1f}) และเป็นรายการแรกของผู้ขายรายนี้",
                    resource_type="bill", resource_id=b.id, reference=b.number, amount=b.total,
                )
                alerts.append(a)
    return alerts


# ── Main scan orchestrator ─────────────────────────────────────

def run_fraud_scan(db: Session, payload: ScanRequest) -> FraudScanSummary:
    all_alerts: List[RiskAlert] = []
    all_alerts += _detect_ghost_vendor(db, payload.period_from, payload.period_to)
    all_alerts += _detect_duplicate_payment(db, payload.period_from, payload.period_to)
    all_alerts += _detect_split_transaction(db, payload.period_from, payload.period_to)
    all_alerts += _detect_off_hours_activity(db, payload.period_from, payload.period_to)
    all_alerts += _detect_rapid_sequence(db, payload.period_from, payload.period_to)
    all_alerts += _detect_new_vendor_large_amount(db, payload.period_from, payload.period_to)

    db.commit()
    for a in all_alerts:
        db.refresh(a)

    total_scanned = (
        db.query(Bill).filter(Bill.date >= payload.period_from, Bill.date <= payload.period_to).count() +
        db.query(APPayment).filter(APPayment.date >= payload.period_from, APPayment.date <= payload.period_to).count() +
        db.query(Journal).filter(Journal.date >= payload.period_from, Journal.date <= payload.period_to).count()
    )

    critical = sum(1 for a in all_alerts if a.risk_level == RiskLevel.CRITICAL)
    high     = sum(1 for a in all_alerts if a.risk_level == RiskLevel.HIGH)
    medium   = sum(1 for a in all_alerts if a.risk_level == RiskLevel.MEDIUM)
    low      = sum(1 for a in all_alerts if a.risk_level == RiskLevel.LOW)

    return FraudScanSummary(
        scan_date=datetime.utcnow(), period_from=payload.period_from, period_to=payload.period_to,
        total_transactions_scanned=total_scanned, alerts_created=len(all_alerts),
        critical_count=critical, high_count=high, medium_count=medium, low_count=low,
        alerts=[RiskAlertResponse.model_validate(a) for a in all_alerts],
    )


# ── Alert management ─────────────────────────────────────────

def get_alerts(db: Session, status: Optional[AlertStatus] = None, risk_level: Optional[RiskLevel] = None) -> List[RiskAlert]:
    q = db.query(RiskAlert).filter(RiskAlert.is_deleted == False)
    if status:      q = q.filter(RiskAlert.status == status)
    if risk_level:  q = q.filter(RiskAlert.risk_level == risk_level)
    return q.order_by(RiskAlert.risk_score.desc(), RiskAlert.detected_at.desc()).all()


def update_alert_status(db: Session, alert_id: UUID, status: AlertStatus, note: Optional[str], user_id: Optional[UUID] = None) -> RiskAlert:
    alert = db.query(RiskAlert).filter(RiskAlert.id == alert_id).first()
    if not alert:
        raise HTTPException(404, "ไม่พบ Risk Alert")
    alert.status = status
    alert.resolution_note = note
    alert.investigated_by = user_id
    if status in (AlertStatus.RESOLVED, AlertStatus.DISMISSED):
        alert.resolved_at = datetime.utcnow()
    db.commit(); db.refresh(alert)
    return alert


def get_risk_dashboard(db: Session) -> dict:
    open_alerts = db.query(RiskAlert).filter(RiskAlert.status.in_([AlertStatus.OPEN, AlertStatus.INVESTIGATING])).all()
    critical_open = sum(1 for a in open_alerts if a.risk_level == RiskLevel.CRITICAL)
    total_at_risk = sum(a.amount or Decimal("0") for a in open_alerts)

    by_pattern: Dict[str, int] = {}
    for a in open_alerts:
        key = a.pattern.value if hasattr(a.pattern, "value") else str(a.pattern)
        by_pattern[key] = by_pattern.get(key, 0) + 1

    all_alerts = db.query(RiskAlert).all()
    by_status: Dict[str, int] = {}
    for a in all_alerts:
        key = a.status.value if hasattr(a.status, "value") else str(a.status)
        by_status[key] = by_status.get(key, 0) + 1

    recent = db.query(RiskAlert).order_by(RiskAlert.detected_at.desc()).limit(10).all()

    return {
        "open_alerts_count": len(open_alerts),
        "critical_open_count": critical_open,
        "total_at_risk_amount": total_at_risk,
        "alerts_by_pattern": by_pattern,
        "alerts_by_status": by_status,
        "recent_alerts": [RiskAlertResponse.model_validate(a) for a in recent],
    }
