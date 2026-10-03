#!/bin/bash
# Sandbox keepalive — restarts the Next.js dev server if it dies (e.g., OOM kill).
# Launched detached (double-fork) so it survives between tool calls:
#   ( setsid nohup bash .zscripts/dev-keepalive-sandbox.sh > /dev/null 2>&1 & )
cd /home/z/my-project

LAST_START=0

while true; do
  if ! pgrep -f "next dev -p 3000" > /dev/null 2>&1; then
    NOW=$(date +%s)
    # Backoff: no restart more than once every 10s
    if [ $((NOW - LAST_START)) -ge 10 ]; then
      LAST_START=$NOW
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] [keepalive] dev server not running — starting..." >> dev.log
      bun run dev > /dev/null 2>&1
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] [keepalive] dev server exited (crash/OOM?), restarting in 5s..." >> dev.log
    fi
  fi
  sleep 5
done
