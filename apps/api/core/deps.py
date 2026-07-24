from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from core.database import get_db
from core.security import decode_token
from models.user import User, UserRole
import uuid

security = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    token = credentials.credentials
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user_id = payload.get("sub")
    # Handle both str and UUID comparison
    user = db.query(User).filter(User.is_active == True, User.is_deleted == False).filter(
        User.email != ""  # ensure table exists
    ).all()
    user = next((u for u in user if str(u.id) == str(user_id)), None)

    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def require_roles(*roles: UserRole):
    def checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return current_user
    return checker


require_admin         = require_roles(UserRole.ADMIN)
require_accountant_up = require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
require_manager_up    = require_roles(UserRole.ADMIN, UserRole.MANAGER)
