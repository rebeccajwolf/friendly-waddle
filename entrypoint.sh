#!/bin/bash


echo "Starting script..."

export CHROME_HOST_RULES="MAP rewards.bing.com 150.171.28.10,MAP www.bing.com 150.171.28.10,MAP account.microsoft.com 150.171.28.10,MAP prod.rewardsplatform.microsoft.com 52.190.158.80"


cd /home/user/app

# execute CMD
sh -c "echo $CHROME_HOST_RULES & \
    yacron -c /home/user/app/job.yaml"
