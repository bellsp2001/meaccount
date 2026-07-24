import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from core.database import engine, Base
from core.config import settings
from api.v1.router import api_router

import models.user        # noqa
import models.accounting  # noqa
import models.ar          # noqa
import models.ap          # noqa
import models.inventory   # noqa
import models.payroll     # noqa
import models.tax         # noqa
import models.period      # noqa
import models.report      # noqa
import models.knowledge   # noqa
import models.fraud       # noqa
import models.document    # noqa
import models.company     # noqa
import models.api_platform # noqa
import models.ai_ops       # noqa
import models.security     # noqa
import models.period      # noqa

TESTING = os.getenv("TESTING", "false").lower() == "true"


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not TESTING:
        Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="MeAccount API",
    description="AI-Powered Accounting Platform",
    version="4.0.0",
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
    return {"status": "ok", "app": "MeAccount", "version": "1.1.0", "sprint": "Phase 4 W43-44 Production Go-Live — Phase 4 COMPLETE"}
