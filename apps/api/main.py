import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from core.database import engine, Base
from core.config import settings
from api.v1.router import api_router

import models.registry    # noqa: F401 — loads every model so FKs resolve; see models/registry.py

TESTING = os.getenv("TESTING", "false").lower() == "true"


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not TESTING:
        Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="MeAccount API",
    description="AI-Powered Accounting Platform",
    version="4.3.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")


@app.get("/health")
async def health_check():
    return {"status": "ok", "app": "MeAccount", "version": "1.1.0", "sprint": "Phase 5 W49-50 Document Template Editor — Phase 5 COMPLETE"}
