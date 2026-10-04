#!/bin/bash
# Watchdog: keeps the Next.js dev server alive. If it crashes (e.g. OOM in the
# ~4GB sandbox), wait 3s and restart it with the same dev script.
cd /home/z/my-project
while true; do
  echo "[$(date '+%F %T')] Starting dev server (watchdog)..." >> dev.log
  NODE_OPTIONS=--max-old-space-size=1280 node node_modules/.bin/next dev -p 3000 --webpack >> dev.log 2>&1
  echo "[$(date '+%F %T')] Dev server exited (code $?). Restarting in 3s..." >> dev.log
  sleep 3
done
