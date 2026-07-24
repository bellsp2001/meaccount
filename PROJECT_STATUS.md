# MeAccount — Project Status (End of Phase 4, W43-44)

## What's genuinely complete and tested

All 4 phases of the original roadmap, 22 sprints, **286 automated backend
tests passing** (run `pytest tests/` in `apps/api/` to verify yourself —
don't take this number on faith).

| Phase | Sprints | What it covers |
|---|---|---|
| 1 | W1-12 | Auth/RBAC, GL, AR, AP, Dashboard, AI Chat v1 |
| 2 | W13-24 | Inventory (FIFO), Payroll (Thai tax), Tax (VAT/WHT), Financial Statements, AI Audit, Report Builder |
| 3 | W25-36 | AI Chat 2.0 (RAG), Fraud Detection, Predictive Analytics, Mobile App, Document AI, Multi-Company |
| 4 | W37-44 | API Platform, AI Ops, Security & Compliance, Go-Live Readiness |

## Honest gaps — read this before treating anything below as "handled"

Several sprints in Phase 3-4 hit real infrastructure limits of the sandbox
this was built in. Rather than fake these, each was flagged explicitly at
build time and the actual limitation is documented in the relevant
service/model docstring. Summary:

- **Mobile app (W31-32)**: Source code is complete and the pure-logic layer
  (59 tests) genuinely passes in an isolated Jest run. **No screen has been
  rendered on a real device or simulator** — that requires `expo start` on a
  machine this sandbox doesn't have. See `apps/mobile/README.md`.

- **Custom AI model training (W39-40)**: There is no fine-tuned LLM. What
  exists is a Prompt Profile system (system prompt + few-shot examples,
  swappable per industry) plus a real feedback loop and A/B testing
  infrastructure — the standard way to specialize an API-based LLM without
  training weights. See `services/ai_ops.py` docstring for the full reasoning.

- **External integrations (W37-38)**: e-Tax Invoice (RD), Thai bank APIs, and
  Lazada/Shopee integrations are stub adapters that raise a clear
  `NotImplementedError` rather than faking a successful connection — none of
  them have real credentials. One `MockBankAdapter` demonstrates the
  connect/sync/error-handling flow works correctly. See
  `services/integrations.py`.

- **SOC2 / PDPA "compliance" (W41-42)**: No certification exists or can exist
  from code alone. What's real: field-level PII encryption (Fernet, tested),
  working Data Subject Request endpoints (access/export/delete/rectify),
  consent tracking, and a compliance scanner that explicitly separates
  code-verifiable controls from process/legal items requiring a licensed
  auditor. The scanner will tell you this itself if you run it.

- **Load testing (W43-44)**: A correct Locust script exists
  (`apps/api/loadtest/locustfile.py`) but **has never been run against a live
  deployment** — there's no server + network path to load-test in this
  sandbox. It must actually be executed against a real staging environment
  before go-live; see the script's own docstring for exact commands.

- **Multi-company (W35-36)**: Only `Journal` and `Account` are company-scoped.
  Fully scoping AR/AP/Inventory/Payroll to `company_id` is real, necessary
  work that's bigger than one sprint and wasn't attempted partially — see
  `models/company.py` docstring.

## Before you actually go live

Run `GET /api/v1/ops/readiness` as an admin user. It will tell you, from
live code inspection, exactly what's blocking and what's a manual item still
outstanding. Don't skip the manual items just because they're not
"blocking" in the automated sense — they're manual precisely because they
require a human decision or a real environment to verify, not because
they're optional.
