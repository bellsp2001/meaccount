# MeAccount — Project Status (End of Phase 4, W43-44)

## What's genuinely complete and tested

All 4 phases of the original roadmap, 22 sprints, **371 automated backend
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


## Post-Phase-4 audit (full 4-phase review)

A full review of all four phases was run after Phase 4 closed. Three real
bugs were found that the test suite had not caught, all now fixed with
regression tests added:

1. **`DATABASE_URL` env var silently did nothing.** It was a computed
   `@property` with no override path, so the value `DEPLOYMENT.md` told
   operators to set was ignored. As a side effect, the W43-44 readiness
   check `DB-02` ("not using SQLite in production") could never observe
   anything but the constructed Postgres URL — it always reported pass, and
   was effectively dead code. Fixed via `DATABASE_URL_OVERRIDE`; docs
   corrected; 4 regression tests added.

2. **6 of 7 seed scripts were completely broken.** W35-36 added
   `Account.company_id -> companies.id`, but the Phase 1/2 seed scripts each
   hand-listed only the models existing when they were written, so
   SQLAlchemy could not resolve the foreign key
   (`NoReferencedTableError`). **A fresh install following DEPLOYMENT.md
   would have failed at the seeding step.** Fixed by introducing
   `models/registry.py` as a single canonical model import; 9 regression
   tests added that execute each seed script as a real subprocess.

3. **Three sidebar menu items were dead links.** The parent entries for AI
   Ops, Developer, and Security pointed at paths (`/ai-ops`, `/developer`,
   `/security`) with no matching route, so clicking them fell through to the
   catch-all redirect instead of opening the section. Repointed at their
   first child routes.

Also cleaned up: a duplicate `httpx` pin in `requirements.txt`.

The known gaps listed above (mobile device testing, load test execution,
external integrations, SOC2 audit, full multi-company scoping) are all
unchanged — they remain blocked on infrastructure or scope, not on bugs.


## Phase 5 — filling gaps identified by competitor analysis (W45-50)

After a competitor review (TRcloud, FlowAccount, PEAK, Odoo), three genuinely
buildable gaps were identified and closed:

- **W45-46 POS (Point of Sale)**: Real-time checkout with barcode lookup,
  shift open/close with cash-drawer reconciliation, void with stock
  restoration. Integrates with the existing (already-tested) FIFO/AVCO
  inventory costing and GL posting rather than reimplementing them — a POS
  sale calls `services.inventory.issue_stock()` directly. 20 tests.

- **W47-48 Leave/HR Management**: Configurable leave types, per-employee
  balance tracking with carry-over, request/approval workflow with overlap
  detection and double-checked balance validation (at request time AND
  approval time, since balance can shift between the two), and unpaid-leave
  payroll deduction that computes a number for the existing
  `PayslipCreate.other_deduction` field rather than modifying the tested
  payroll module. 25 tests, including exact deduction math verification
  (30000/31 × 3 = 2903.22, checked precisely, not just "positive").

- **W49-50 Document Template Editor**: Configurable branding (logo, colors,
  fonts) and field-visibility toggles for invoice PDFs, with a real ReportLab
  renderer that applies template config to an actual Invoice record. Strict
  validation (hex color format, ReportLab base-14 font whitelist) rejects bad
  config at save time rather than failing silently at render time. 24 tests
  including real PDF magic-byte verification.

Explicitly NOT attempted in Phase 5 (flagged rather than half-built): e-Tax
Invoice / e-Commerce marketplace integrations (need real third-party
credentials — same limitation as W37-38's stub adapters), and full
multi-company `company_id` scoping across AR/AP/Inventory/Payroll (attempted
and deliberately reverted mid-sprint when the real scope — a "current
company" resolution mechanism touching nearly every endpoint — turned out to
be much larger than estimated; see git history / conversation log for the
reversion).

## Post-Phase-5 note on process

During Phase 5, three real bugs were caught by verification steps run
proactively before declaring each sprint done (not just running the new
sprint's own tests): dead sidebar navigation links (caught by a script
comparing every sidebar `to:` against every registered `<Route path>`), and
the same class of "app boots but seed script for a new model fails"
regression from the Phase 1-4 audit — checked immediately after adding each
new model, rather than discovered later.
