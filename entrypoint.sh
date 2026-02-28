#!/bin/bash
set -e

export NODE_OPTIONS="--require ./dist/net-patch.js --dns-result-order=ipv4first --network-family-autoselection=off --max-socket-connections=1"

# Disable Node.js connection pooling
export NODE_DEBUG=tls,net,http
export UV_THREADPOOL_SIZE=1

export CHROME_HOST_RULES="MAP rewards.bing.com 150.171.28.10,MAP www.bing.com 150.171.28.10,MAP account.microsoft.com 150.171.28.10,MAP prod.rewardsplatform.microsoft.com 52.190.158.80"


cd /home/user/app

# execute CMD
sh -c "nohup gunicorn keep_alive:app --bind 0.0.0.0:7860 & \
    bash mkconf.sh && \
    if [ \"$RUN_ON_START\" = \"true\" ]; then bash src/run_daily.sh >/proc/1/fd/1 2>/proc/1/fd/2; fi & \
    yacron -c /home/user/app/job.yaml"