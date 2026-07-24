"""
Seed Chart of Accounts — ผังบัญชีมาตรฐานไทย
Run: python scripts/seed_coa.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from core.database import SessionLocal, engine, Base
from models.accounting import Account, AccountTypeEnum, NormalBalance

Base.metadata.create_all(bind=engine)
db = SessionLocal()

COA = [
    # code, name, name_en, type, normal_balance, level, parent_code
    # ── 1xxx ASSET ──────────────────────────────────────────────
    ("1000","สินทรัพย์","Assets",              "asset","debit",1,None),
    ("1100","สินทรัพย์หมุนเวียน","Current Assets","asset","debit",2,"1000"),
    ("1101","เงินสด","Cash",                   "asset","debit",3,"1100"),
    ("1102","เงินฝากธนาคาร","Bank",            "asset","debit",3,"1100"),
    ("1103","เงินสดย่อย","Petty Cash",         "asset","debit",3,"1100"),
    ("1200","ลูกหนี้การค้า","Accounts Receivable","asset","debit",2,"1000"),
    ("1201","ลูกหนี้การค้า","Trade Receivable", "asset","debit",3,"1200"),
    ("1202","ค่าเผื่อหนี้สงสัยจะสูญ","Allowance for Doubtful","asset","credit",3,"1200"),
    ("1300","สินค้าคงเหลือ","Inventory",        "asset","debit",2,"1000"),
    ("1301","สินค้าสำเร็จรูป","Finished Goods", "asset","debit",3,"1300"),
    ("1302","วัตถุดิบ","Raw Material",           "asset","debit",3,"1300"),
    ("1400","สินทรัพย์หมุนเวียนอื่น","Other Current Assets","asset","debit",2,"1000"),
    ("1401","ภาษีมูลค่าเพิ่มรอเครดิต","VAT Input","asset","debit",3,"1400"),
    ("1402","ค่าใช้จ่ายจ่ายล่วงหน้า","Prepaid Expenses","asset","debit",3,"1400"),
    ("1500","สินทรัพย์ไม่หมุนเวียน","Non-Current Assets","asset","debit",2,"1000"),
    ("1501","ที่ดิน","Land",                    "asset","debit",3,"1500"),
    ("1502","อาคาร","Building",                 "asset","debit",3,"1500"),
    ("1503","อุปกรณ์สำนักงาน","Office Equipment","asset","debit",3,"1500"),
    ("1504","ค่าเสื่อมราคาสะสม","Accumulated Depreciation","asset","credit",3,"1500"),
    # ── 2xxx LIABILITY ──────────────────────────────────────────
    ("2000","หนี้สิน","Liabilities",            "liability","credit",1,None),
    ("2100","หนี้สินหมุนเวียน","Current Liabilities","liability","credit",2,"2000"),
    ("2101","เจ้าหนี้การค้า","Accounts Payable","liability","credit",3,"2100"),
    ("2102","เจ้าหนี้อื่น","Other Payables",    "liability","credit",3,"2100"),
    ("2103","ภาษีมูลค่าเพิ่มรอนำส่ง","VAT Output","liability","credit",3,"2100"),
    ("2104","ภาษีหัก ณ ที่จ่ายค้างจ่าย","WHT Payable","liability","credit",3,"2100"),
    ("2105","เงินเดือนค้างจ่าย","Accrued Salaries","liability","credit",3,"2100"),
    ("2106","ประกันสังคมค้างจ่าย","SSO Payable","liability","credit",3,"2100"),
    ("2200","หนี้สินไม่หมุนเวียน","Non-Current Liabilities","liability","credit",2,"2000"),
    ("2201","เงินกู้ยืมระยะยาว","Long-term Loan","liability","credit",3,"2200"),
    # ── 3xxx EQUITY ─────────────────────────────────────────────
    ("3000","ส่วนของผู้ถือหุ้น","Equity",       "equity","credit",1,None),
    ("3101","ทุนจดทะเบียน","Registered Capital","equity","credit",2,"3000"),
    ("3102","กำไรสะสม","Retained Earnings",     "equity","credit",2,"3000"),
    ("3103","กำไร(ขาดทุน)ประจำงวด","Current Period P&L","equity","credit",2,"3000"),
    # ── 4xxx INCOME ─────────────────────────────────────────────
    ("4000","รายได้","Revenue",                 "income","credit",1,None),
    ("4101","รายได้จากการขาย","Sales Revenue",  "income","credit",2,"4000"),
    ("4102","รายได้จากการให้บริการ","Service Revenue","income","credit",2,"4000"),
    ("4103","รายได้อื่น","Other Income",         "income","credit",2,"4000"),
    ("4104","ดอกเบี้ยรับ","Interest Income",    "income","credit",2,"4000"),
    # ── 5xxx EXPENSE ────────────────────────────────────────────
    ("5000","ค่าใช้จ่าย","Expenses",            "expense","debit",1,None),
    ("5101","ต้นทุนสินค้าขาย","Cost of Goods Sold","expense","debit",2,"5000"),
    ("5201","เงินเดือนและค่าจ้าง","Salaries & Wages","expense","debit",2,"5000"),
    ("5202","ประกันสังคม","Social Security","expense","debit",2,"5000"),
    ("5301","ค่าเช่า","Rent",                   "expense","debit",2,"5000"),
    ("5302","ค่าไฟฟ้า","Electricity",           "expense","debit",2,"5000"),
    ("5303","ค่าน้ำประปา","Water",              "expense","debit",2,"5000"),
    ("5304","ค่าโทรศัพท์/อินเทอร์เน็ต","Telephone/Internet","expense","debit",2,"5000"),
    ("5401","ค่าวัสดุสำนักงาน","Office Supplies","expense","debit",2,"5000"),
    ("5402","ค่าซ่อมแซม","Repairs",            "expense","debit",2,"5000"),
    ("5403","ค่าเสื่อมราคา","Depreciation",    "expense","debit",2,"5000"),
    ("5404","ค่าประกันภัย","Insurance",        "expense","debit",2,"5000"),
    ("5405","ค่าโฆษณา","Advertising",          "expense","debit",2,"5000"),
    ("5501","ดอกเบี้ยจ่าย","Interest Expense", "expense","debit",2,"5000"),
    ("5601","ภาษีเงินได้นิติบุคคล","Corporate Income Tax","expense","debit",2,"5000"),
]

# Build code→id map for parent lookup
code_to_id = {}

for row in COA:
    code, name, name_en, atype, nb, level, parent_code = row
    if db.query(Account).filter(Account.code == code).first():
        print(f"  – skip (exists): {code} {name}")
        continue
    acc = Account(
        code=code, name=name, name_en=name_en,
        account_type=AccountTypeEnum(atype),
        normal_balance=NormalBalance(nb),
        level=level,
        parent_id=code_to_id.get(parent_code),
    )
    db.add(acc)
    db.flush()
    code_to_id[code] = acc.id
    print(f"  ✓ {code} {name}")

db.commit()
db.close()
print(f"\n✅ Chart of Accounts seed complete — {len(COA)} accounts")
# (existing seed_coa.py — just ensuring AR models are imported for table creation)
