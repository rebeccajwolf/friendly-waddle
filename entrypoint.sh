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
echo "🔔 TESTING DISCORD WEBHOOK"
echo "========================================="

# Check if TOKEN secret is set
if [ -n "$TOKEN" ]; then
    echo "✅ Discord webhook URL found (${TOKEN:0:50}...)"
    
    # Send a test message to Discord
    echo "📡 Sending test webhook to Discord..."
    
    # Create a simple test payload
    TEST_PAYLOAD='{
        "content": "🚀 Microsoft Rewards Bot starting up - Test webhook from entrypoint",
        "username": "Rewards Bot",
        "avatar_url": "https://i.imgur.com/4M34hi2.png",
        "embeds": [{
            "title": "System Startup",
            "color": 5814783,
            "fields": [
                {
                    "name": "Timestamp",
                    "value": "'$(date -u +"%Y-%m-%d %H:%M:%S UTC")'",
                    "inline": true
                },
                {
                    "name": "Node Version",
                    "value": "'$(node -v)'",
                    "inline": true
                },
                {
                    "name": "DNS Status",
                    "value": "✅ Google DNS Active",
                    "inline": true
                }
            ],
            "footer": {
                "text": "Hugging Face Space"
            }
        }]
    }'
    
    # Send the webhook using curl
    curl -s -X POST \
        -H "Content-Type: application/json" \
        -d "$TEST_PAYLOAD" \
        "$TOKEN" \
        -o /tmp/discord_response.txt \
        -w "%{http_code}" \
        > /tmp/discord_status.txt 2>&1
    
    DISCORD_STATUS=$(cat /tmp/discord_status.txt)
    
    if [ "$DISCORD_STATUS" = "204" ]; then
        echo "✅ Discord webhook sent successfully (Status: 204)"
    else
        echo "⚠️ Discord webhook returned status: $DISCORD_STATUS"
        echo "Response: $(cat /tmp/discord_response.txt 2>/dev/null || echo 'No response')"
        
        # Fallback test with discordapp.com (bypass)
        echo "📡 Retrying with discordapp.com bypass..."
        FALLBACK_URL=$(echo "$TOKEN" | sed 's/discord\.com/discordapp.com/')
        
        curl -s -X POST \
            -H "Content-Type: application/json" \
            -d "$TEST_PAYLOAD" \
            "$FALLBACK_URL" \
            -o /tmp/discord_fallback.txt \
            -w "%{http_code}" \
            > /tmp/discord_fallback_status.txt
        
        FALLBACK_STATUS=$(cat /tmp/discord_fallback_status.txt)
        
        if [ "$FALLBACK_STATUS" = "204" ]; then
            echo "✅ Discord webhook sent via discordapp.com (Status: 204)"
        else
            echo "❌ Both Discord webhook attempts failed"
        fi
    fi
    
    # Clean up temp files
    rm -f /tmp/discord_response.txt /tmp/discord_status.txt /tmp/discord_fallback.txt /tmp/discord_fallback_status.txt
else
    echo "⚠️ TOKEN secret not found - skipping webhook test"
    echo "   To enable Discord notifications, add TOKEN to your Space secrets"
fi

echo "========================================="
echo "🔧 ENVIRONMENT VARIABLES CHECK"
echo "========================================="

# Show non-sensitive environment info
echo "📋 Node environment: $NODE_ENV"
echo "📋 Current user: $(whoami)"
echo "📋 Current directory: $(pwd)"
echo "📋 Disk space:"
df -h / | tail -1

echo "========================================="
echo "🚀 STARTING MICROSOFT REWARDS BOT"
echo "========================================="


export CHROME_HOST_RULES="MAP rewards.bing.com 150.171.28.10,MAP www.bing.com 150.171.28.10,MAP account.microsoft.com 150.171.28.10,MAP prod.rewardsplatform.microsoft.com 52.190.158.80"


cd /home/user/app

# execute CMD
# sh -c "nohup gunicorn keep_alive:app --bind 0.0.0.0:7860 & \
    # bash mkconf.sh && \
    # if [ \"$RUN_ON_START\" = \"true\" ]; then bash src/run_daily.sh >/proc/1/fd/1 2>/proc/1/fd/2; fi & \
    # yacron -c /home/user/app/job.yaml"