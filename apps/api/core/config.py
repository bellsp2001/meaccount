from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    APP_NAME: str = "MeAccount"
    DEBUG: bool = False
    ALLOWED_ORIGINS: List[str] = [
        "http://localhost:5173", "http://localhost:3000",
        "http://127.0.0.1:5173", "http://127.0.0.1:3000",
    ]

    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str = "meaccount"
    POSTGRES_USER: str = "meaccount"
    POSTGRES_PASSWORD: str = "changeme_secret"

    # Optional explicit override. When set (e.g. DATABASE_URL=sqlite:///./x.db
    # or a managed-Postgres connection string from a hosting provider), it wins
    # over the POSTGRES_* parts below. This used to be a computed @property,
    # which silently ignored any DATABASE_URL env var — meaning deployment docs
    # that said "set DATABASE_URL" didn't actually work, and the DB-02 readiness
    # check could never observe anything but the constructed Postgres URL.
    DATABASE_URL_OVERRIDE: str = ""

    @property
    def DATABASE_URL(self) -> str:
        if self.DATABASE_URL_OVERRIDE:
            return self.DATABASE_URL_OVERRIDE
        return (
            f"postgresql://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_PASSWORD: str = "changeme_redis"

    SECRET_KEY: str = "dev_secret_key_change_in_production_min_32_chars"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    ANTHROPIC_API_KEY: str = ""
    AI_MODEL: str = "claude-sonnet-4-20250514"

    # Field-level encryption key for PII at rest (see core/encryption.py).
    # MUST be set via a real secrets manager in production — never committed.
    FIELD_ENCRYPTION_KEY: str = ""

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
