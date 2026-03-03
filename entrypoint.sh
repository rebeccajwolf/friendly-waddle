#!/bin/bash
set -e
echo "========================================="
echo "🚀 Starting Bot (Minimal Entrypoint)"
echo "========================================="

export CHROME_HOST_RULES="MAP rewards.bing.com 150.171.28.10,MAP www.bing.com 150.171.28.10,MAP account.microsoft.com 150.171.28.10,MAP prod.rewardsplatform.microsoft.com 52.190.158.80"
export PYTHONUNBUFFERED=1
export NODE_OPTIONS="--dns-result-order=ipv4first"

cd /home/user/app

# Start keep_alive in the background, but keep its output connected
echo "Starting keep_alive..."
gunicorn keep_alive:app --bind 0.0.0.0:7860 &

# Run setup scripts (their output will appear)
bash mkconf.sh

if [ "$RUN_ON_START" = "true" ]; then
    echo "Running daily tasks..."
    bash src/run_daily.sh
fi

# Start yacron in the background
echo "Starting yacron..."
yacron -c /home/user/app/job.yaml &

# THIS IS THE CRITICAL PART
# Start your Node.js bot in the FOREGROUND.
# Its stdout/stderr will become the container's primary log stream.
echo "Starting Node.js bot..."
