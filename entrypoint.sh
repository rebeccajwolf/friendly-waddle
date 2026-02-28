#!/bin/bash
set -e

echo "========================================="
echo "🚀 STARTING WITH BROWSER-LIKE NETWORKING"
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

# Show DNS configuration
echo "📋 DNS configuration:"
cat /etc/resolv.conf

# Show IPv4 priority
echo "📋 IPv4 priority from /etc/gai.conf:"
grep "precedence" /etc/gai.conf || echo "No IPv4 priority set"

# Set Node.js options - REMOVED invalid --max-socket-connections
export NODE_OPTIONS="--require ./dist/net-patch.js --dns-result-order=ipv4first"

# Set UV_THREADPOOL_SIZE to limit concurrent operations
export UV_THREADPOOL_SIZE=4

# Disable Node.js connection pooling via environment variables
export NODE_NO_WARNINGS=1

echo "✅ NODE_OPTIONS: $NODE_OPTIONS"
echo "✅ UV_THREADPOOL_SIZE: $UV_THREADPOOL_SIZE"

# Test Node.js resolution with our patch
echo "========================================="
echo "🔍 TESTING NODE.JS RESOLUTION"
echo "========================================="

node -e "
console.log('Testing DNS resolution with browser-like patch:');
const dns = require('dns');

dns.lookup('rewards.bing.com', (err, addr) => {
    if (err) {
        console.log('❌ rewards.bing.com lookup failed:', err.message);
    } else {
        console.log('✅ rewards.bing.com resolved to:', addr);
    }
});

dns.lookup('discord.com', (err, addr) => {
    if (err) {
        console.log('❌ discord.com lookup failed:', err.message);
    } else {
        console.log('✅ discord.com resolved to:', addr);
    }
});

// Show active handles
console.log('Node.js version:', process.version);
console.log('DNS order:', dns.getDefaultResultOrder());
"

echo "========================================="
echo "✅ NETWORK CHECKS COMPLETE"
echo "========================================="

# Start the main application
echo "🚀 Starting Microsoft Rewards Bot with browser-like networking..."

export CHROME_HOST_RULES="MAP rewards.bing.com 150.171.28.10,MAP www.bing.com 150.171.28.10,MAP account.microsoft.com 150.171.28.10,MAP prod.rewardsplatform.microsoft.com 52.190.158.80"


cd /home/user/app

# execute CMD
sh -c "nohup gunicorn keep_alive:app --bind 0.0.0.0:7860 & \
    bash mkconf.sh && \
    if [ \"$RUN_ON_START\" = \"true\" ]; then bash src/run_daily.sh >/proc/1/fd/1 2>/proc/1/fd/2; fi & \
    yacron -c /home/user/app/job.yaml"