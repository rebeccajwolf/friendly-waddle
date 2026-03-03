#!/bin/bash
set -e

echo "========================================="
echo "🚀 Starting Microsoft Rewards Bot"
echo "========================================="
echo "Entrypoint started at $(date)"

# Export host rules
export CHROME_HOST_RULES="MAP rewards.bing.com 150.171.28.10,MAP www.bing.com 150.171.28.10,MAP account.microsoft.com 150.171.28.10,MAP prod.rewardsplatform.microsoft.com 52.190.158.80"

# Force unbuffered output
export PYTHONUNBUFFERED=1
export PYTHONIOENCODING=utf-8

cd /home/user/app

echo "Starting keep_alive server on port 7860..."
python3 -u keep_alive.py &
KEEP_ALIVE_PID=$!
echo "keep_alive started with PID: $KEEP_ALIVE_PID"

# Give it a moment to start
sleep 2

echo "Running mkconf.sh..."
bash mkconf.sh

if [ "$RUN_ON_START" = "true" ]; then
    echo "Running daily tasks..."
    bash src/run_daily.sh
fi

echo "Starting yacron..."
yacron -c /home/user/app/job.yaml &
YACRON_PID=$!

# Wait for any process to exit
wait -n
exit $?