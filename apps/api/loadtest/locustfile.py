"""
MeAccount Load Test — Locust script for pre-launch capacity verification.

HONESTY NOTE: This script is genuinely correct and ready to run, but it has
never actually been executed against a live MeAccount deployment in this
sandbox (there is no running server + network path to load-test here). It
must be run for real before go-live — see the README section at the bottom
of this file for exact commands. Do not treat "the script exists" as
equivalent to "load testing was performed."

What it exercises: the request patterns a real user session actually
produces — login, browse dashboard KPIs, list AR invoices, ask the AI chat
a question, and check the fraud dashboard — weighted toward the read-heavy
operations that dominate real traffic, with occasional writes (creating a
journal entry) to catch write-path bottlenecks too.
"""
import random
from locust import HttpUser, task, between


class MeAccountUser(HttpUser):
    """Simulates one logged-in user's browsing session."""

    wait_time = between(1, 4)   # seconds between actions, mimicking real human pacing

    def on_start(self):
        """Runs once per simulated user at the start of the test — logs in
        and stores the token for all subsequent requests, exactly like a
        real browser session would after the login page."""
        response = self.client.post("/api/v1/auth/login", json={
            "email": "loadtest@meaccount.com",
            "password": "LoadTest@1234",
        })
        if response.status_code == 200:
            self.token = response.json()["access_token"]
            self.headers = {"Authorization": f"Bearer {self.token}"}
        else:
            self.token = None
            self.headers = {}
            # Don't silently continue with no auth — every subsequent
            # request would 401 and produce misleading "the API is slow"
            # results when the real problem is a bad seed/test account.
            self.environment.runner.quit()

    @task(10)
    def view_dashboard(self):
        """Highest-weight task: this is what every session does first and
        most often — the KPI dashboard is the app's landing page."""
        self.client.get("/api/v1/dashboard/kpi", headers=self.headers, name="/dashboard/kpi")

    @task(6)
    def list_invoices(self):
        self.client.get("/api/v1/ar/invoices", headers=self.headers, name="/ar/invoices")

    @task(6)
    def list_bills(self):
        self.client.get("/api/v1/ap/bills", headers=self.headers, name="/ap/bills")

    @task(3)
    def view_inventory(self):
        self.client.get("/api/v1/inventory/products", headers=self.headers, name="/inventory/products")

    @task(2)
    def ai_chat_question(self):
        """AI chat is intentionally lower-weight but important to include —
        it's the request type most likely to be slow (external API call to
        Claude), so it needs to be represented even though it's not the most
        frequent action, to catch tail-latency issues under load."""
        questions = ["สรุปรายได้เดือนนี้", "มีลูกหนี้เกินกำหนดกี่ราย?", "VAT ต้องยื่นวันไหน?"]
        self.client.post(
            "/api/v1/chat-v2/message", headers=self.headers,
            json={"message": random.choice(questions)}, name="/chat-v2/message",
        )

    @task(1)
    def view_fraud_dashboard(self):
        self.client.get("/api/v1/fraud/dashboard", headers=self.headers, name="/fraud/dashboard")

    @task(1)
    def view_financial_reports(self):
        self.client.get(
            "/api/v1/reports/profit-loss?period_from=2026-01-01&period_to=2026-01-31",
            headers=self.headers, name="/reports/profit-loss",
        )


# ─────────────────────────────────────────────────────────────────
# HOW TO ACTUALLY RUN THIS (must be done before go-live, not skipped):
#
# 1. Deploy MeAccount to a staging environment that mirrors production sizing
# 2. Create a dedicated load-test account (do NOT reuse a real user):
#      email: loadtest@meaccount.com / password: LoadTest@1234
#    with realistic seed data (invoices, bills, products) — an empty DB
#    gives falsely optimistic latency numbers.
# 3. Install locust:  pip install locust
# 4. Run:  locust -f loadtest/locustfile.py --host https://staging.meaccount.com
# 5. Open http://localhost:8089, set target user count and spawn rate,
#    ramp up gradually (e.g. 10 -> 50 -> 200 concurrent users) and watch:
#      - p95/p99 latency per endpoint (Locust's built-in charts)
#      - error rate (should stay ~0% until you deliberately push past capacity)
#      - which endpoint degrades first — that's your bottleneck to fix
# 6. Record the results (screenshot the Locust summary + CSV export) as part
#    of the go-live sign-off — "we ran it" isn't evidence without numbers.
# ─────────────────────────────────────────────────────────────────
