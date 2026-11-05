#!/bin/sh
# Nightly PostgreSQL backup for a Coolify-deployed MeAccount stack.
#
#   backup-db.sh <db-container-name> [label]
#
# Dumps the database inside the container (custom format, restorable with pg_restore), keeps
# 14 days locally in /var/backups/meaccount, and — if rclone has a remote named "r2" — copies
# each dump to Cloudflare R2 so a lost VM doesn't take the books with it.
#
# Find the container name with:  docker ps --format '{{.Names}}' | grep '^db-'
# Run nightly via cron (see docs/DEPLOY_ORACLE_COOLIFY.md):
#   15 2 * * * /opt/meaccount/backup-db.sh db-abc123 production >> /var/log/meaccount-backup.log 2>&1
set -eu

CONTAINER="${1:?usage: backup-db.sh <db-container-name> [label]}"
LABEL="${2:-production}"
DIR="/var/backups/meaccount/${LABEL}"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="${DIR}/meaccount-${LABEL}-${STAMP}.dump"
KEEP_DAYS=14

mkdir -p "$DIR"
echo "$(date -Is) dumping ${CONTAINER} → ${FILE}"
docker exec "$CONTAINER" pg_dump -U meaccount -d meaccount -Fc > "$FILE"

# A dump this small means pg_dump failed quietly — don't let it rotate out good backups.
if [ "$(stat -c %s "$FILE")" -lt 1024 ]; then
    echo "backup too small, keeping old ones" >&2
    exit 1
fi

if command -v rclone >/dev/null 2>&1 && rclone listremotes | grep -q '^r2:$'; then
    rclone copy "$FILE" "r2:meaccount-backups/${LABEL}/"
    echo "uploaded to r2:meaccount-backups/${LABEL}/"
fi

find "$DIR" -name '*.dump' -mtime +"$KEEP_DAYS" -delete
echo "$(date -Is) done"
