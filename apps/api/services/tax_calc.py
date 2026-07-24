"""
Thai Tax Calculation Engine — ภาษีเงินได้บุคคลธรรมดา + ประกันสังคม 2024/2567
อ้างอิง: ประมวลรัษฎากร, อัตราภาษีก้าวหน้า, พรบ.ประกันสังคม
"""
from decimal import Decimal, ROUND_HALF_UP

# ── ประกันสังคม (Social Security) ──────────────────────────────
SSO_RATE           = Decimal("0.05")     # 5%
SSO_MAX_BASE       = Decimal("15000")    # ฐานคำนวณสูงสุด 15,000 บาท/เดือน
SSO_MAX_CONTRIB    = Decimal("750")      # เพดานเงินสมทบ 750 บาท/เดือน (ทั้งนายจ้าง+ลูกจ้าง)


def calc_social_security(monthly_salary: Decimal) -> Decimal:
    """คำนวณเงินสมทบประกันสังคม (ฝั่งใดฝั่งหนึ่ง — employee หรือ employer เท่ากัน)"""
    base = min(monthly_salary, SSO_MAX_BASE)
    contrib = (base * SSO_RATE).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return min(contrib, SSO_MAX_CONTRIB)


# ── ภาษีเงินได้บุคคลธรรมดา — อัตราก้าวหน้า 2567 ──────────────────
# ขั้นบันได (เงินได้สุทธิต่อปี, อัตราภาษี%)
TAX_BRACKETS = [
    (Decimal("150000"),  Decimal("0")),
    (Decimal("300000"),  Decimal("0.05")),
    (Decimal("500000"),  Decimal("0.10")),
    (Decimal("750000"),  Decimal("0.15")),
    (Decimal("1000000"), Decimal("0.20")),
    (Decimal("2000000"), Decimal("0.25")),
    (Decimal("5000000"), Decimal("0.30")),
    (None,                Decimal("0.35")),
]

PERSONAL_ALLOWANCE       = Decimal("60000")   # ลดหย่อนส่วนตัว
SPOUSE_ALLOWANCE         = Decimal("60000")   # ลดหย่อนคู่สมรส (ไม่มีรายได้)
CHILD_ALLOWANCE          = Decimal("30000")   # ลดหย่อนบุตรคนแรก (คนที่ 2 เป็นต้นไป 60,000 ถ้าเกิดปี 61+)
EXPENSE_DEDUCTION_RATE   = Decimal("0.50")    # หักค่าใช้จ่าย 50% ของเงินได้
EXPENSE_DEDUCTION_MAX    = Decimal("100000")  # สูงสุด 100,000 บาท


def calc_annual_tax(net_income: Decimal) -> Decimal:
    """คำนวณภาษีจากเงินได้สุทธิ (หลังหักค่าใช้จ่าย+ลดหย่อนแล้ว) ตามอัตราก้าวหน้า"""
    if net_income <= 0:
        return Decimal("0")

    tax = Decimal("0")
    lower = Decimal("0")
    for upper, rate in TAX_BRACKETS:
        if upper is None:
            tax += (net_income - lower) * rate
            break
        if net_income > upper:
            tax += (upper - lower) * rate
            lower = upper
        else:
            tax += (net_income - lower) * rate
            break
    return tax.quantize(Decimal("1"), rounding=ROUND_HALF_UP)


def calc_monthly_withholding_tax(
    monthly_salary: Decimal,
    marital_status: str = "single",
    num_children: int = 0,
    sso_deducted: Decimal = Decimal("0"),
) -> Decimal:
    """
    คำนวณภาษีหัก ณ ที่จ่ายรายเดือน (วิธีเงินได้พึงประเมินเป็นรายปี ตามมาตรา 50(1))
    ขั้นตอน: annualize เงินเดือน -> หักค่าใช้จ่าย -> หักลดหย่อน -> คำนวณภาษีปี -> หาร 12
    """
    annual_income = monthly_salary * 12

    # หักค่าใช้จ่าย 50% สูงสุด 100,000
    expense_deduction = min(annual_income * EXPENSE_DEDUCTION_RATE, EXPENSE_DEDUCTION_MAX)

    # ลดหย่อน
    allowances = PERSONAL_ALLOWANCE
    if marital_status == "married":
        allowances += SPOUSE_ALLOWANCE
    allowances += CHILD_ALLOWANCE * min(num_children, 3)  # สมมติจำกัดคำนวณอัตโนมัติไม่เกิน 3 คน

    # ประกันสังคมลดหย่อนได้ตามที่จ่ายจริง (สูงสุด 9,000/ปี)
    sso_annual_deduction = min(sso_deducted * 12, Decimal("9000"))

    net_income = annual_income - expense_deduction - allowances - sso_annual_deduction
    net_income = max(net_income, Decimal("0"))

    annual_tax = calc_annual_tax(net_income)
    monthly_tax = (annual_tax / 12).quantize(Decimal("1"), rounding=ROUND_HALF_UP)

    return monthly_tax


def calc_payslip(
    base_salary: Decimal,
    ot_hours: Decimal = Decimal("0"),
    ot_rate: Decimal = Decimal("0"),
    allowance: Decimal = Decimal("0"),
    bonus: Decimal = Decimal("0"),
    other_deduction: Decimal = Decimal("0"),
    marital_status: str = "single",
    num_children: int = 0,
    sso_enrolled: bool = True,
) -> dict:
    """คำนวณสลิปเงินเดือนแบบครบวงจร"""
    ot_amount = (ot_hours * ot_rate).quantize(Decimal("0.01"))
    gross_pay = base_salary + ot_amount + allowance + bonus

    sso_employee = calc_social_security(base_salary) if sso_enrolled else Decimal("0")
    sso_employer = sso_employee  # employer contributes equal amount

    wht = calc_monthly_withholding_tax(
        monthly_salary=gross_pay,
        marital_status=marital_status,
        num_children=num_children,
        sso_deducted=sso_employee,
    )

    total_deduction = sso_employee + wht + other_deduction
    net_pay = gross_pay - total_deduction

    return {
        "ot_amount": ot_amount,
        "gross_pay": gross_pay,
        "sso_employee": sso_employee,
        "sso_employer": sso_employer,
        "withholding_tax": wht,
        "total_deduction": total_deduction,
        "net_pay": net_pay,
    }
