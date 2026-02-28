#!/bin/bash
set -e

echo "========================================="
echo "🚀 STARTING WITH DNS FIXES"
echo "========================================="

# Force Google DNS at system level (if possible)
if [ -w /etc/resolv.conf ]; then
    cat > /etc/resolv.conf << 'EOF'
nameserver 8.8.8.8
nameserver 8.8.4.4
nameserver 1.1.1.1
options timeout:2 attempts:3 rotate
EOF
    echo "✅ /etc/resolv.conf updated"
else
    echo "⚠️ Cannot write /etc/resolv.conf - using Node.js DNS patches"
fi

# Show current DNS config
echo "📋 Current DNS configuration:"
cat /etc/resolv.conf 2>/dev/null || echo "   (cannot read resolv.conf)"

# Set Node.js options
export NODE_OPTIONS="--require ./dist/net-patch.js --dns-result-order=ipv4first"
export UV_THREADPOOL_SIZE=4

echo "✅ NODE_OPTIONS: $NODE_OPTIONS"
echo "✅ UV_THREADPOOL_SIZE: $UV_THREADPOOL_SIZE"

echo "========================================="
echo "🔍 TESTING DNS WITH GOOGLE DNS"
echo "========================================="

# Test both rewards.bing.com and discord.com
node -e "
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

console.log('📡 Testing rewards.bing.com...');
dns.resolve4('rewards.bing.com', (err, addrs) => {
    if (err) {
        console.log('❌ rewards.bing.com failed:', err.message);
    } else {
        console.log('✅ rewards.bing.com IPs:', addrs);
    }
});

console.log('📡 Testing discord.com...');
dns.resolve4('discord.com', (err, addrs) => {
    if (err) {
        console.log('❌ discord.com failed:', err.message);
    } else {
        console.log('✅ discord.com IPs:', addrs);
    }
});

// Also test with our patched lookup
setTimeout(() => {
    console.log('\n📡 Testing with patched dns.lookup:');
    dns.lookup('discord.com', { family: 4 }, (err, addr) => {
        if (err) {
            console.log('❌ discord.com lookup failed:', err.message);
        } else {
            console.log('✅ discord.com resolved to:', addr);
        }
    });
    
    dns.lookup('rewards.bing.com', { family: 4 }, (err, addr) => {
        if (err) {
            console.log('❌ rewards.bing.com lookup failed:', err.message);
        } else {
            console.log('✅ rewards.bing.com resolved to:', addr);
        }
    });
}, 500);
"

echo "========================================="
echo "🌐 HOSTS FILE CHECK"
echo "========================================="

# Check if hosts file has entries
echo "📋 Current hosts entries:"
grep -E "bing\.com|discord\.com" /etc/hosts 2>/dev/null || echo "   No custom hosts entries found"

echo "========================================="
echo "🚀 STARTING MICROSOFT REWARDS BOT"
echo "========================================="


export CHROME_HOST_RULES="MAP rewards.bing.com 150.171.28.10,MAP www.bing.com 150.171.28.10,MAP account.microsoft.com 150.171.28.10,MAP prod.rewardsplatform.microsoft.com 52.190.158.80"


cd /home/user/app

# execute CMD
sh -c "nohup gunicorn keep_alive:app --bind 0.0.0.0:7860 & \
    bash mkconf.sh && \
    if [ \"$RUN_ON_START\" = \"true\" ]; then bash src/run_daily.sh >/proc/1/fd/1 2>/proc/1/fd/2; fi & \
    yacron -c /home/user/app/job.yaml"