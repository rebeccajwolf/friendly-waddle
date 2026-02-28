#!/bin/bash
set -e

echo "========================================="
echo "🚀 STARTING WITH NETWORK FIXES"
echo "========================================="


# Show current directory contents for debugging
echo "📋 Current directory contents:"
ls -la /home/user/app/
echo "📋 Dist directory contents:"
ls -la /home/user/app/dist/ || echo "dist directory not found"

# Check if net-patch.js exists
if [ -f /home/user/app/net-patch.js ]; then
    echo "✅ net-patch.js found in app root"
    # Copy to dist if needed
    cp /home/user/app/net-patch.js /home/user/app/dist/net-patch.js 2>/dev/null || true
elif [ -f /home/user/app/dist/net-patch.js ]; then
    echo "✅ net-patch.js found in dist directory"
else
    echo "❌ net-patch.js not found!"
fi


# Show current DNS configuration
echo "📋 DNS configuration:"
cat /etc/resolv.conf

# Show IPv4 priority
echo "📋 IPv4 priority from /etc/gai.conf:"
grep "precedence" /etc/gai.conf || echo "No IPv4 priority set"

# ===== USE ENVIRONMENT VARIABLES FOR DNS =====
# These affect Node.js DNS resolution
export NODE_OPTIONS="--require ./dist/net-patch.js --dns-result-order=ipv4first --max-old-space-size=512"
export UV_THREADPOOL_SIZE=4

# Force IPv4 for all Node.js processes
export NODE_OPTIONS="$NODE_OPTIONS --dns-result-order=ipv4first"

# Set environment variables for DNS (affects some libraries)
export RES_OPTIONS="attempts:3 timeout:1"
export DNS_SERVER="8.8.8.8"

echo "✅ Environment variables set:"
echo "   NODE_OPTIONS: $NODE_OPTIONS"

# Test Node.js resolution with our patch
echo "========================================="
echo "🔍 TESTING NODE.JS RESOLUTION"
echo "========================================="

node -e "
const dns = require('dns');
const assert = require('assert');

// Test rewards.bing.com
dns.lookup('rewards.bing.com', (err, addr) => {
    if (err) {
        console.log('❌ rewards.bing.com lookup failed:', err.message);
    } else {
        console.log('✅ rewards.bing.com resolved to:', addr);
    }
});

// Test with our IP_MAP
setTimeout(() => {
    console.log('📡 If resolution fails, net-patch.js should intercept');
}, 1000);
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