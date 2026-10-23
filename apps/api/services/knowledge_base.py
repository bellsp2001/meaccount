"""
Knowledge Base Service — Keyword-based retrieval (RAG lite) จากฐานความรู้บัญชี-ภาษีไทย
ใช้ keyword matching + TF-IDF-like scoring แทน vector embeddings เพื่อความเร็วและไม่ต้องพึ่ง external vector DB
"""
import re
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import or_

from models.knowledge import KnowledgeChunk
from schemas.chat_v2 import KnowledgeChunkCreate, KnowledgeSearchResult, KnowledgeChunkResponse


def create_knowledge_chunk(db: Session, payload: KnowledgeChunkCreate) -> KnowledgeChunk:
    chunk = KnowledgeChunk(**payload.model_dump())
    db.add(chunk); db.commit(); db.refresh(chunk)
    return chunk


def get_all_chunks(db: Session, category: Optional[str] = None) -> List[KnowledgeChunk]:
    q = db.query(KnowledgeChunk).filter(KnowledgeChunk.is_active == 1, KnowledgeChunk.is_deleted == False)
    if category:
        q = q.filter(KnowledgeChunk.category == category)
    return q.all()


def _tokenize(text: str) -> List[str]:
    """
    Thai/English tokenization. Thai script has no spaces between words, so word-level
    splitting alone misses matches (e.g. a query glued together as one long token).
    We therefore also emit character n-grams (n=2,3) for Thai spans, which lets
    substring-style overlap scoring find matches like "ภาษีมูลค่าเพิ่ม" inside a
    longer run-on query. ASCII/English tokens still split normally on non-word chars.
    """
    text = text.lower()
    tokens: List[str] = []

    for span in re.split(r'[\s,.\-()]+', text):
        if not span:
            continue
        if re.fullmatch(r'[a-z0-9]+', span):
            if len(span) >= 2:
                tokens.append(span)
        else:
            if len(span) >= 2:
                tokens.append(span)
            for n in (2, 3):
                for i in range(len(span) - n + 1):
                    tokens.append(span[i:i+n])

    return tokens


def search_knowledge(db: Session, query: str, top_k: int = 3) -> List[KnowledgeSearchResult]:
    """
    Keyword-overlap scoring: score = (matched_tokens / query_tokens) + keyword_bonus
    ง่ายกว่า vector search แต่ deterministic และไม่มี external dependency
    """
    chunks = db.query(KnowledgeChunk).filter(
        KnowledgeChunk.is_active == 1, KnowledgeChunk.is_deleted == False,
    ).all()
    if not chunks:
        return []

    query_tokens = set(_tokenize(query))
    if not query_tokens:
        return []

    scored = []
    for chunk in chunks:
        content_tokens = set(_tokenize(chunk.title + " " + chunk.content))
        keyword_tokens = set(_tokenize(chunk.keywords or ""))

        overlap = query_tokens & content_tokens
        keyword_overlap = query_tokens & keyword_tokens

        score = len(overlap) / max(len(query_tokens), 1)
        score += len(keyword_overlap) * 0.3   # keyword matches weighted higher

        if score > 0:
            scored.append((chunk, score))

    scored.sort(key=lambda x: x[1], reverse=True)
    top = scored[:top_k]

    max_score = top[0][1] if top else 1
    return [
        KnowledgeSearchResult(
            chunk=KnowledgeChunkResponse.model_validate(chunk),
            relevance=round(min(score / max(max_score, 0.01), 1.0), 2),
        )
        for chunk, score in top
    ]


def seed_thai_accounting_knowledge(db: Session):
    """สร้างฐานความรู้เริ่มต้น — กฎหมายบัญชี-ภาษีไทยที่ใช้บ่อย"""
    knowledge_items = [
        {
            "category": "vat", "title": "อัตราภาษีมูลค่าเพิ่ม (VAT)",
            "content": "ภาษีมูลค่าเพิ่มในประเทศไทยอัตราปกติคือ 7% (รวม VAT 10% แต่ลดเหลือ 7% ตามพระราชกฤษฎีกาต่อเนื่องทุกปี) "
                      "ผู้ประกอบการที่มีรายรับเกิน 1.8 ล้านบาทต่อปีต้องจดทะเบียนภาษีมูลค่าเพิ่ม และยื่นแบบ ภ.พ.30 ทุกเดือน ภายในวันที่ 15 ของเดือนถัดไป",
            "source": "ประมวลรัษฎากร มาตรา 80", "keywords": "vat,ภาษีมูลค่าเพิ่ม,7%,ภพ30,จดทะเบียน",
        },
        {
            "category": "wht", "title": "อัตราภาษีหัก ณ ที่จ่าย",
            "content": "อัตราภาษีหัก ณ ที่จ่ายที่ใช้บ่อย: ค่าจ้างทำของ/ค่าบริการ 3%, ค่าเช่าอสังหาริมทรัพย์ 5%, "
                      "ค่าขนส่ง 1%, ค่าโฆษณา 2%, เงินปันผล 10%, ดอกเบี้ย 15% (บางกรณี), เงินเดือน ตามอัตราก้าวหน้า (ภงด.1) "
                      "ผู้จ่ายเงินต้องออกหนังสือรับรองการหักภาษี ณ ที่จ่ายให้ผู้รับเงินทุกครั้ง",
            "source": "ประมวลรัษฎากร มาตรา 3 เตรส", "keywords": "wht,หัก ณ ที่จ่าย,3%,5%,ภงด",
        },
        {
            "category": "wht", "title": "กำหนดเวลายื่นภาษีหัก ณ ที่จ่าย",
            "content": "ผู้จ่ายเงินต้องนำส่งภาษีหัก ณ ที่จ่ายภายในวันที่ 7 ของเดือนถัดไป (ยื่นกระดาษ) หรือวันที่ 15 (ยื่นทางอินเทอร์เน็ต) "
                      "แบบที่ใช้: ภงด.1 (เงินเดือน), ภงด.3 (จ่ายให้บุคคลธรรมดา), ภงด.53 (จ่ายให้นิติบุคคล)",
            "source": "ประมวลรัษฎากร มาตรา 52", "keywords": "wht,ยื่นภาษี,ภงด1,ภงด3,ภงด53,กำหนดเวลา",
        },
        {
            "category": "tax_law", "title": "อัตราภาษีเงินได้นิติบุคคล SME",
            "content": "บริษัท SME (ทุนจดทะเบียนไม่เกิน 5 ล้านบาท และรายได้ไม่เกิน 30 ล้านบาทต่อปี) ได้รับสิทธิยกเว้นภาษีสำหรับกำไรสุทธิ 300,000 บาทแรก "
                      "ส่วนที่เกิน 300,000-3,000,000 บาท เสียภาษี 15% และส่วนที่เกิน 3,000,000 บาท เสียภาษี 20%",
            "source": "พระราชกฤษฎีกา ฉบับที่ 583", "keywords": "ภาษีนิติบุคคล,sme,15%,20%,ยกเว้น",
        },
        {
            "category": "labor_law", "title": "ประกันสังคม อัตราเงินสมทบ",
            "content": "เงินสมทบประกันสังคมคำนวณจากค่าจ้าง 5% ทั้งฝั่งนายจ้างและลูกจ้าง โดยฐานค่าจ้างขั้นต่ำ 1,650 บาท "
                      "สูงสุดไม่เกิน 15,000 บาทต่อเดือน (เพดานเงินสมทบสูงสุด 750 บาทต่อฝ่ายต่อเดือน)",
            "source": "พระราชบัญญัติประกันสังคม พ.ศ. 2533", "keywords": "ประกันสังคม,5%,750,เงินสมทบ",
        },
        {
            "category": "accounting", "title": "หลักการบันทึกบัญชีแบบ Double-Entry",
            "content": "ทุกรายการทางบัญชีต้องบันทึกทั้งด้าน Debit และ Credit เท่ากันเสมอ "
                      "บัญชีสินทรัพย์และค่าใช้จ่าย เพิ่มขึ้นด้าน Debit ลดลงด้าน Credit "
                      "บัญชีหนี้สิน ส่วนของผู้ถือหุ้น และรายได้ เพิ่มขึ้นด้าน Credit ลดลงด้าน Debit",
            "source": "มาตรฐานการบัญชีไทย (TFRS)", "keywords": "double entry,debit,credit,บันทึกบัญชี",
        },
        {
            "category": "accounting", "title": "ผังบัญชีมาตรฐาน 5 หมวด",
            "content": "ผังบัญชีแบ่งเป็น 5 หมวดหลัก: 1xxx สินทรัพย์ (Asset), 2xxx หนี้สิน (Liability), "
                      "3xxx ส่วนของผู้ถือหุ้น (Equity), 4xxx รายได้ (Income), 5xxx ค่าใช้จ่าย (Expense)",
            "source": "มาตรฐานผังบัญชีไทย", "keywords": "ผังบัญชี,หมวดบัญชี,chart of accounts",
        },
        {
            "category": "accounting", "title": "ความแตกต่างงบดุลและงบกำไรขาดทุน",
            "content": "งบดุล (Balance Sheet) แสดงฐานะการเงิน ณ วันใดวันหนึ่ง ประกอบด้วยสินทรัพย์ หนี้สิน และส่วนของผู้ถือหุ้น "
                      "งบกำไรขาดทุน (P&L) แสดงผลการดำเนินงานในช่วงเวลาหนึ่ง (เช่น 1 เดือน หรือ 1 ปี) ประกอบด้วยรายได้และค่าใช้จ่าย",
            "source": "มาตรฐานการบัญชีไทย", "keywords": "งบดุล,งบกำไรขาดทุน,balance sheet,p&l",
        },
        {
            "category": "vat", "title": "ภาษีซื้อต้องห้าม",
            "content": "ภาษีซื้อที่นำมาหักในการคำนวณภาษีมูลค่าเพิ่มไม่ได้ เช่น ภาษีซื้อที่เกี่ยวกับรถยนต์นั่งส่วนบุคคล, "
                      "ค่ารับรอง, ภาษีซื้อตามใบกำกับภาษีที่ไม่สมบูรณ์ หรือภาษีซื้อที่เกิดก่อนจดทะเบียน VAT",
            "source": "ประมวลรัษฎากร มาตรา 82/5", "keywords": "ภาษีซื้อต้องห้าม,vat,หักภาษี",
        },
        {
            "category": "wht", "title": "การหักภาษี ณ ที่จ่ายเงินเดือน (ภงด.1)",
            "content": "นายจ้างต้องคำนวณภาษีหัก ณ ที่จ่ายจากเงินเดือนพนักงานตามวิธีเงินได้พึงประเมินเป็นรายปี "
                      "(annualize เงินเดือน หักค่าใช้จ่าย 50% สูงสุด 100,000 บาท หักลดหย่อนต่างๆ แล้วคำนวณภาษีตามอัตราก้าวหน้า แล้วหารด้วย 12)",
            "source": "ประมวลรัษฎากร มาตรา 50(1)", "keywords": "ภงด1,เงินเดือน,หักภาษี,annualize",
        },
    ]

    for item in knowledge_items:
        existing = db.query(KnowledgeChunk).filter(KnowledgeChunk.title == item["title"]).first()
        if not existing:
            db.add(KnowledgeChunk(**item, is_active=1))
    db.commit()
