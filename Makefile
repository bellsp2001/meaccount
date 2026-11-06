.PHONY: help setup-api setup-web dev-api dev-web test-api test-web migrate seed

help:
	@echo "MeAccount — Available Commands"
	@echo "────────────────────────────────"
	@echo "  make setup-api    Install Python dependencies"
	@echo "  make setup-web    Install Node dependencies"
	@echo "  make dev-api      Start FastAPI server (port 8000)"
	@echo "  make dev-web      Start React dev server (port 5173)"
	@echo "  make test-api     Run backend tests"
	@echo "  make migrate      Run database migrations"
	@echo "  make seed         Seed initial admin user"

setup-api:
	cd apps/api && pip install -r requirements.txt

setup-web:
	cd apps/web && npm install

dev-api:
	cd apps/api && uvicorn main:app --host 0.0.0.0 --port 8000 --reload

dev-web:
	cd apps/web && npm run dev

test-api:
	cd apps/api && pytest tests/ -v

migrate:
	cd apps/api && alembic upgrade head

seed:
	cd apps/api && python scripts/seed.py

seed-coa:
	cd apps/api && python scripts/seed_coa.py

test-gl:
	cd apps/api && pytest tests/test_gl.py -v

test-ar:
	cd apps/api && pytest tests/test_ar.py -v

test-all:
	cd apps/api && pytest tests/ -v

seed-ap:
	cd apps/api && python scripts/seed_ap.py

test-ap:
	cd apps/api && pytest tests/test_ap.py -v

test-all:
	cd apps/api && pytest tests/ -v --tb=short

test-dashboard:
	cd apps/api && pytest tests/test_dashboard.py -v

test-all:
	cd apps/api && pytest tests/ -v --tb=short

# Phase 1 complete setup
setup-phase1: setup-api
	cd apps/api && alembic upgrade head
	cd apps/api && python scripts/seed.py
	cd apps/api && python scripts/seed_coa.py
	cd apps/api && python scripts/seed_ar.py
	cd apps/api && python scripts/seed_ap.py
	@echo "✅ Phase 1 setup complete!"


seed-inventory:
	cd apps/api && python scripts/seed_inventory.py

test-inventory:
	cd apps/api && pytest tests/test_inventory.py -v

seed-payroll:
	cd apps/api && python scripts/seed_payroll.py

test-payroll:
	cd apps/api && pytest tests/test_payroll.py -v

test-tax:
	cd apps/api && pytest tests/test_tax.py -v

test-reports:
	cd apps/api && pytest tests/test_reports.py -v

test-audit:
	cd apps/api && pytest tests/test_audit.py -v

test-report-builder:
	cd apps/api && pytest tests/test_report_builder.py -v

seed-knowledge:
	cd apps/api && python scripts/seed_knowledge.py

test-chat-v2:
	cd apps/api && pytest tests/test_chat_v2.py -v

test-fraud:
	cd apps/api && pytest tests/test_fraud.py -v

test-analytics:
	cd apps/api && pytest tests/test_analytics.py -v

test-documents:
	cd apps/api && pytest tests/test_document_ai.py -v

test-company:
	cd apps/api && pytest tests/test_company.py -v

test-api-platform:
	cd apps/api && pytest tests/test_api_platform.py -v

test-ai-ops:
	cd apps/api && pytest tests/test_ai_ops.py -v

test-security:
	cd apps/api && pytest tests/test_security.py -v

test-readiness:
	cd apps/api && pytest tests/test_readiness.py -v

loadtest:
	cd apps/api && locust -f loadtest/locustfile.py --host $(HOST)

test-pos:
	cd apps/api && pytest tests/test_pos.py -v

seed-pos:
	cd apps/api && python scripts/seed_pos.py

seed-leave:
	cd apps/api && python scripts/seed_leave.py

test-leave:
	cd apps/api && pytest tests/test_leave.py -v

seed-doctemplate:
	cd apps/api && python scripts/seed_doctemplate.py

test-doctemplate:
	cd apps/api && pytest tests/test_doctemplate.py -v
