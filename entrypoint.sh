#!/bin/bash

set -e

echo "=== Startup Debug Info ==="
echo "Current user: $(whoami)"
echo "Current UID: $(id -u)"
echo "App directory ownership:"
ls -la /home/user/app/
echo "Can we write to temp? $(touch /home/user/app/test && echo 'Yes' || echo 'No')"
rm -f /home/user/app/test

# Test Microsoft IP directly
curl -I https://150.171.27.10 --connect-timeout 10

# Test another known-good IP
curl -I https://8.8.8.8 --connect-timeout 10

export CHROME_HOST_RULES="MAP rewards.bing.com 150.171.28.10,MAP www.bing.com 150.171.28.10,MAP account.microsoft.com 150.171.28.10,MAP prod.rewardsplatform.microsoft.com 52.190.158.80"


cd /home/user/app

# execute CMD
sh -c "nohup gunicorn keep_alive:app --bind 0.0.0.0:7860 & \
    bash mkconf.sh && \
    if [ \"$RUN_ON_START\" = \"true\" ]; then bash src/run_daily.sh >/proc/1/fd/1 2>/proc/1/fd/2; fi & \
    yacron -c /home/user/app/job.yaml"