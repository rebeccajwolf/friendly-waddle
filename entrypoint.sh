#!/bin/bash
set -e  # Exit on error

echo "========================================="
echo "🚀 Starting Microsoft Rewards Bot"
echo "========================================="
echo "Entrypoint started at $(date)"

# Export host rules for browser
export CHROME_HOST_RULES="MAP rewards.bing.com 150.171.28.10,MAP www.bing.com 150.171.28.10,MAP account.microsoft.com 150.171.28.10,MAP prod.rewardsplatform.microsoft.com 52.190.158.80"

# Set Python to unbuffered mode so logs appear immediately
export PYTHONUNBUFFERED=1

# Ensure all output goes to stdout/stderr
exec > >(tee -a /proc/1/fd/1) 2> >(tee -a /proc/1/fd/2 >&2)

cd /home/user/app

echo "Starting keep_alive server on port 7860..."
nohup gunicorn keep_alive:app --bind 0.0.0.0:7860 &
KEEP_ALIVE_PID=$!
echo "keep_alive started with PID: $KEEP_ALIVE_PID"

echo "Running mkconf.sh..."
bash mkconf.sh
MKCONF_EXIT=$?
echo "mkconf.sh completed with exit code: $MKCONF_EXIT"

if [ "$RUN_ON_START" = "true" ]; then
    echo "Running daily tasks (src/run_daily.sh)..."
    bash src/run_daily.sh
    DAILY_EXIT=$?
    echo "Daily tasks completed with exit code: $DAILY_EXIT"
fi

echo "Starting yacron scheduler..."
yacron -c /home/user/app/job.yaml &
YACRON_PID=$!
echo "yacron started with PID: $YACRON_PID"

# Wait for any process to exit
wait -n

# Exit with the status of the first process that exits
exit $?