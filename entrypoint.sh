#!/bin/bash

set -e

echo "========================================="
echo "🚀 STARTING WITH NETWORK FIXES"
echo "========================================="

# Show network configuration
echo "📋 /etc/hosts entries:"
cat /etc/hosts | grep -E "bing|discord|google|reddit" || echo "No custom hosts found"

echo "📋 DNS configuration:"
cat /etc/resolv.conf

echo "📋 IPv4 priority:"
cat /etc/gai.conf | grep precedence || echo "No IPv4 priority set"

# Test connectivity to key domains
echo "========================================="
echo "🔍 TESTING CONNECTIONS"
echo "========================================="

# Test with ping (ICMP)
echo "📡 Testing ping to rewards.bing.com..."
ping -c 1 -W 2 rewards.bing.com > /dev/null 2>&1 && echo "✅ Ping OK" || echo "❌ Ping failed"

# Test with curl (HTTP)
echo "📡 Testing curl to rewards.bing.com..."
curl -I -s --connect-timeout 5 https://rewards.bing.com > /dev/null && echo "✅ Curl OK" || echo "❌ Curl failed"

# Test with Node.js
echo "📡 Testing Node.js resolution..."
node -e "
const dns = require('dns');
dns.lookup('rewards.bing.com', (err, addr) => {
    console.log('Node.js lookup:', err ? '❌ ' + err.message : '✅ ' + addr);
});
"

echo "========================================="
echo "✅ NETWORK CHECKS COMPLETE"
echo "========================================="

# Start the main application
echo "🚀 Starting Microsoft Rewards Bot..."

export CHROME_HOST_RULES="MAP rewards.bing.com 150.171.28.10,MAP www.bing.com 150.171.28.10,MAP account.microsoft.com 150.171.28.10,MAP prod.rewardsplatform.microsoft.com 52.190.158.80"


cd /home/user/app

# execute CMD
sh -c "nohup gunicorn keep_alive:app --bind 0.0.0.0:7860 & \
    bash mkconf.sh && \
    if [ \"$RUN_ON_START\" = \"true\" ]; then bash src/run_daily.sh >/proc/1/fd/1 2>/proc/1/fd/2; fi & \
    yacron -c /home/user/app/job.yaml"