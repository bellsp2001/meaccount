#!/bin/sh
# Bring the schema up to date, then serve. Runs on every deploy, so a push that adds an Alembic
# revision migrates the database before the new code takes traffic.
set -e

echo "→ alembic upgrade head"
alembic upgrade head

# WEB_CONCURRENCY: uvicorn worker processes (2 suits the 2-OCPU Oracle free VM).
# --proxy-headers: trust X-Forwarded-* from the nginx/Traefik in front, so request.url is https.
echo "→ starting uvicorn (${WEB_CONCURRENCY:-2} workers)"
exec uvicorn main:app --host 0.0.0.0 --port 8000 \
    --workers "${WEB_CONCURRENCY:-2}" \
    --proxy-headers --forwarded-allow-ips="*"
