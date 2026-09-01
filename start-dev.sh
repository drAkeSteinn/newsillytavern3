#!/bin/bash
# Dev server keepalive wrapper - restarts the server if it crashes
cd /home/z/my-project
while true; do
  echo "[$(date)] Starting dev server..."
  npx next dev -p 3000 --webpack 2>&1 | tee /home/z/my-project/dev.log
  EXIT_CODE=$?
  echo "[$(date)] Dev server exited with code $EXIT_CODE, restarting in 3s..."
  sleep 3
done
