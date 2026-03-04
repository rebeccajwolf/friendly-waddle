#!/bin/bash

set -e

export CHROME_HOST_RULES="MAP rewards.bing.com 150.171.28.10,MAP www.bing.com 150.171.28.10,MAP account.microsoft.com 150.171.28.10,MAP prod.rewardsplatform.microsoft.com 52.190.158.80"


cd /home/user/app

# Start background processes but keep their output connected
gunicorn keep_alive:app --bind 0.0.0.0:7860 &
bash mkconf.sh

if [ "$RUN_ON_START" = "true" ]; then
    # Run this in background but capture output
    bash src/run_daily.sh 2>&1 | tee -a /proc/1/fd/1 &
fi

# Wait for any background process to exit
wait -n

# Exit with the status of the first process that exits
exit $?