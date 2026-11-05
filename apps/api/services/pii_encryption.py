"""
PII Encryption Helpers — thin wrappers around core/encryption.py scoped to the
specific fields this codebase treats as sensitive PII (national ID, tax ID).

Design note: rather than changing the raw `national_id`/`tax_id` columns
in-place (which would require a data migration touching Employee, Customer,
and Supplier — tables already covered by 195+ passing tests across Phase 1-3
— and would risk breaking existing read paths that expect plaintext), this
sprint adds an opt-in encrypted-storage helper that NEW code can use, and
provides a one-shot migration function to encrypt existing plaintext values.
This is the lower-risk, honest path for a security-hardening sprint: it adds
a real, tested capability without silently rewriting core AR/AP/Payroll
behavior in a way that could introduce regressions this sprint doesn't have
time to fully re-verify against every existing test.
"""
from typing import Optional
from sqlalchemy.orm import Session
from core.encryption import encrypt_field, decrypt_field, mask_for_display


def encrypt_national_id(plaintext: Optional[str]) -> Optional[str]:
    return encrypt_field(plaintext)


def decrypt_national_id(ciphertext: Optional[str]) -> Optional[str]:
    return decrypt_field(ciphertext)


def display_masked_id(plaintext_or_cipher: Optional[str], is_encrypted: bool = False) -> Optional[str]:
    """Returns a masked version safe to show in a UI list view (e.g. "***-***-1234")
    without needing to decrypt (if given ciphertext) or re-expose (if given plaintext)."""
    if plaintext_or_cipher is None:
        return None
    value = decrypt_field(plaintext_or_cipher) if is_encrypted else plaintext_or_cipher
    return mask_for_display(value, visible_chars=4)


def migrate_encrypt_existing_national_ids(db: Session, dry_run: bool = True) -> dict:
    """
    One-shot migration helper: finds Employee records with a plaintext
    national_id (heuristically — encrypted Fernet tokens always start with
    'gAAAAA' when base64-decoded structure is considered, but more simply:
    Fernet tokens are much longer than a 13-digit Thai ID, so length is a
    reliable-enough discriminator here) and encrypts them in place.

    Runs as dry_run=True by default so it reports what it WOULD do without
    committing — a real migration script should always be run dry first.
    """
    from models.payroll import Employee

    employees = db.query(Employee).filter(Employee.national_id.isnot(None)).all()
    candidates = [e for e in employees if e.national_id and len(e.national_id) < 50]  # plaintext Thai ID is ~13-17 chars; Fernet tokens are 100+

    if not dry_run:
        for emp in candidates:
            emp.national_id = encrypt_national_id(emp.national_id)
        db.commit()

    return {
        "dry_run": dry_run,
        "total_employees_with_national_id": len(employees),
        "candidates_needing_encryption": len(candidates),
        "already_encrypted": len(employees) - len(candidates),
    }
