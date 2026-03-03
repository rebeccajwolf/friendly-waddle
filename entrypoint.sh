#!/bin/bash
set -e

echo "========================================="
echo "🚀 Starting Microsoft Rewards Bot"
echo "========================================="

export CHROME_HOST_RULES="MAP rewards.bing.com 150.171.28.10,MAP www.bing.com 150.171.28.10,MAP account.microsoft.com 150.171.28.10,MAP prod.rewardsplatform.microsoft.com 52.190.158.80"
export PYTHONUNBUFFERED=1

cd /home/user/app

# Start keep_alive in background but keep output
nohup gunicorn keep_alive:app --bind 0.0.0.0:7860 &
echo $! > /tmp/keep_alive.pid

# Run setup scripts
bash mkconf.sh

# Run daily tasks if enabled
if [ "$RUN_ON_START" = "true" ]; then
    bash src/run_daily.sh
fi

# Start yacron in foreground (this will keep the container alive)
exec yacron -c /home/user/app/job.yaml