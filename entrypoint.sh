#!/bin/bash

set -e

echo "========================================="
echo "🚀 STARTING WITH NETWORK FIXES"
echo "========================================="

# ===== ADD HOSTS ENTRIES AT RUNTIME =====
echo "📝 Adding hosts entries to /etc/hosts..."

# Check if we can write to /etc/hosts
if [ -w /etc/hosts ]; then
    # Microsoft domains
    echo "150.171.30.10 rewards.bing.com" >> /etc/hosts
    echo "150.171.30.10 www.bing.com" >> /etc/hosts
    echo "150.171.30.10 account.microsoft.com" >> /etc/hosts
    echo "13.107.213.40 prod.rewardsplatform.microsoft.com" >> /etc/hosts
    echo "13.107.213.40 login.live.com" >> /etc/hosts
    
    # Bing API domains
    echo "2.18.67.162 www.bingapis.com" >> /etc/hosts
    echo "2.18.67.162 api.bing.com" >> /etc/hosts
    
    # Discord domains
    echo "162.159.135.232 discord.com" >> /etc/hosts
    echo "162.159.135.232 gateway.discord.gg" >> /etc/hosts
    echo "162.159.135.232 cdn.discordapp.com" >> /etc/hosts
    echo "162.159.135.232 discordapp.com" >> /etc/hosts
    
    # Other services
    echo "142.250.185.46 trends.google.com" >> /etc/hosts
    echo "198.35.26.96 wikimedia.org" >> /etc/hosts
    echo "151.101.1.140 www.reddit.com" >> /etc/hosts
    echo "185.199.108.133 raw.githubusercontent.com" >> /etc/hosts
    
    echo "✅ Hosts entries added successfully"
else
    echo "⚠️ Cannot write to /etc/hosts, continuing without hosts entries"
fi

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