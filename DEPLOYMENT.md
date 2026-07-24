# MeAccount — Deployment Guide

## Before you deploy: run the readiness scan

Once the API is running with a real database and admin login, hit:
```
GET /api/v1/ops/readiness   (admin only)
```
This checks config, DB connectivity, and security posture from actual code —
not a checklist you fill in by hand. Fix every `blocking: true` failure
before proceeding. See the response's `checks[]` array for specifics.

**What the scan cannot check for you** (do these manually, they're real
prerequisites, not optional):
- Run `loadtest/locustfile.py` against your actual staging environment
- Verify your rollback procedure by actually testing it
- Assign an on-call owner for the launch window
- Test a real backup restore, not just confirm backups exist

## Environment Setup

1. Copy `.env.example` to `.env` (or inject these as real environment
   variables via your deployment platform — see readiness check CFG-05):

```bash
# Required — generate with: openssl rand -hex 32
SECRET_KEY=<32+ char random string>
FIELD_ENCRYPTION_KEY=<Fernet.generate_key() output>

# Database (PostgreSQL required for production — SQLite is dev/test only)
DATABASE_URL=postgresql://user:pass@host:5432/meaccount

# Redis
REDIS_HOST=<your-redis-host>
REDIS_PASSWORD=<strong-password>

# CORS — your actual frontend domain(s), never "*"
ALLOWED_ORIGINS=["https://app.yourcompany.com"]

# AI features (optional but most AI features degrade gracefully without it)
ANTHROPIC_API_KEY=<your-key>
```

2. Run migrations:
```bash
cd apps/api
alembic upgrade head
```

3. Seed initial data, **then immediately change the default admin password**:
```bash
python scripts/seed.py
# Log in as admin@meaccount.com / Admin@1234, change password immediately,
# or the readiness scan's SEC-01 check will correctly flag this as blocking.
```

4. Run the full test suite one more time against your actual deployment
   target's Python/dependency versions:
```bash
pytest tests/ -v
```

## Architecture at a Glance

- **Backend**: FastAPI + SQLAlchemy 2, PostgreSQL, Redis
- **Frontend**: React 18 + TypeScript + Vite
- **Mobile**: React Native + Expo (see `apps/mobile/README.md` — has its own
  honest caveats about what's device-tested vs. not)
- **AI**: Claude API (Anthropic) for chat, OCR, classification — with
  rule-based fallback behavior when the API key isn't configured, so core
  accounting functions never depend on AI availability

## API Reference

The full, always-current route list is available live at:
```
GET /api/v1/ops/routes   (admin only)
```
This reflects the actual registered FastAPI routes via introspection — it
cannot drift out of sync with the code the way hand-written docs can.

Interactive API docs (Swagger UI): `/docs`

## Test Coverage

286 automated tests across 22 test files, covering every module from Phase 1
through Phase 4. Run the full suite:
```bash
pytest tests/ -v
```
(Takes ~4-5 minutes; the suite got long enough by Phase 4 that CI should
parallelize it rather than running serially.)
