import enum
from sqlalchemy import Column, String, Boolean, Enum, ForeignKey, Text, DateTime
from datetime import datetime
from core.database import Base
from models.base import UUIDMixin, TimestampMixin, UUIDType


class UserRole(str, enum.Enum):
    ADMIN     = "admin"
    ACCOUNTANT= "accountant"
    CASHIER   = "cashier"
    INVENTORY = "inventory"
    MANAGER   = "manager"
    AUDITOR   = "auditor"


class User(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "users"

    email           = Column(String(255), unique=True, nullable=False, index=True)
    full_name       = Column(String(255), nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role            = Column(Enum(UserRole), nullable=False, default=UserRole.ACCOUNTANT)
    is_active       = Column(Boolean, default=True, nullable=False)
    is_verified     = Column(Boolean, default=False, nullable=False)
    avatar_url      = Column(String(500), nullable=True)

    def __repr__(self):
        return f"<User {self.email} [{self.role}]>"


class AuditLog(Base, UUIDMixin):
    __tablename__ = "audit_logs"

    user_id     = Column(UUIDType(), ForeignKey("users.id"), nullable=True)
    action      = Column(String(100), nullable=False)
    resource    = Column(String(100), nullable=False)
    resource_id = Column(String(100), nullable=True)
    detail      = Column(Text, nullable=True)
    ip_address  = Column(String(50), nullable=True)
    created_at  = Column(DateTime, default=datetime.utcnow, nullable=False)
