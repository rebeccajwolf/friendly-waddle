#!/bin/bash

set -e

echo "========================================="
echo "🚀 STARTING MICROSOFT REWARDS BOT"
echo "========================================="

# ===== DNS FIXES =====
echo "📡 Fixing DNS configuration..."

# Try to update resolv.conf if writable
if [ -w /etc/resolv.conf ]; then
    cat > /etc/resolv.conf << 'DNSEOF'
# Google DNS (primary)
nameserver 8.8.8.8
nameserver 8.8.4.4

# Cloudflare DNS (backup)
nameserver 1.1.1.1
nameserver 1.0.0.1

# OpenDNS (tertiary)
nameserver 208.67.222.222
nameserver 208.67.220.220

# Options for better resolution
options timeout:2 attempts:3 rotate single-request-reopen
DNSEOF
    echo "✅ DNS resolv.conf updated with multiple DNS servers"
else
    echo "⚠️ resolv.conf is read-only - will use NODE_OPTIONS DNS settings"
fi

# Show current DNS config
echo "📋 Current DNS configuration:"
cat /etc/resolv.conf 2>/dev/null || echo "   (cannot read resolv.conf)"

# ===== HOSTS FILE FIXES (if writable) =====
echo "📝 Adding hosts entries if possible..."

# Try to add hosts entries at runtime
if [ -w /etc/hosts ]; then
    cat >> /etc/hosts << 'HOSTSEOF'

# Microsoft Rewards domains
150.171.30.10    rewards.bing.com
150.171.29.10    rewards.bing.com
150.171.28.10    rewards.bing.com
150.171.27.10    rewards.bing.com
2.18.67.162      www.bing.com
2.18.67.135      www.bing.com
13.107.213.40    prod.rewardsplatform.microsoft.com
13.107.246.40    prod.rewardsplatform.microsoft.com

# Discord domains
162.159.135.232  discord.com
162.159.128.233  discord.com
162.159.138.232  discord.com
162.159.136.234  gateway.discord.gg
162.159.134.234  gateway.discord.gg
HOSTSEOF
    echo "✅ Hosts file updated with domain mappings"
else
    echo "⚠️ /etc/hosts is read-only - will use net-patch.js for domain mapping"
fi

# ===== IPv4 PREFERENCE =====
echo "🌐 Setting IPv4 preference..."

# Force IPv4 in gai.conf if writable
if [ -w /etc/gai.conf ]; then
    # Check if entry already exists
    if ! grep -q "^precedence ::ffff:0:0/96" /etc/gai.conf; then
        echo "precedence ::ffff:0:0/96  100" >> /etc/gai.conf
        echo "✅ IPv4 precedence added to gai.conf"
    else
        echo "✅ IPv4 precedence already set in gai.conf"
    fi
else
    echo "⚠️ gai.conf is read-only - using NODE_OPTIONS for IPv4"
fi

# ===== NETWORK DIAGNOSTICS =====
echo "========================================="
echo "🔍 NETWORK DIAGNOSTICS"
echo "========================================="

# Test DNS resolution
echo "📡 Testing DNS resolution..."
nslookup rewards.bing.com 8.8.8.8 2>/dev/null | head -5 || echo "   nslookup not available"
nslookup discord.com 8.8.8.8 2>/dev/null | head -5 || echo "   nslookup not available"

# Test connectivity with ping (if available)
if command -v ping &> /dev/null; then
    echo "📡 Testing ping to 8.8.8.8..."
    ping -c 1 -W 2 8.8.8.8 &> /dev/null && echo "✅ Internet reachable" || echo "❌ Internet unreachable"
fi



# ===== TEST NODE.JS RESOLUTION =====
echo "========================================="
echo "🔍 TESTING NODE.JS DNS RESOLUTION"
echo "========================================="

node -e "
const dns = require('dns');
console.log('Node.js version:', process.version);
console.log('DNS order:', dns.getDefaultResultOrder());

// Test rewards.bing.com
dns.lookup('rewards.bing.com', { family: 4 }, (err, addr) => {
    if (err) console.log('❌ rewards.bing.com lookup failed:', err.message);
    else console.log('✅ rewards.bing.com resolved to:', addr);
});

// Test discord.com
dns.lookup('discord.com', { family: 4 }, (err, addr) => {
    if (err) console.log('❌ discord.com lookup failed:', err.message);
    else console.log('✅ discord.com resolved to:', addr);
});

// Test multiple IPs
dns.resolve4('rewards.bing.com', (err, addrs) => {
    if (err) console.log('❌ rewards.bing.com resolve4 failed:', err.message);
    else console.log('📋 rewards.bing.com IPs:', addrs);
});
"

# ===== ENVIRONMENT SUMMARY =====
echo "========================================="
echo "📋 ENVIRONMENT SUMMARY"
echo "========================================="
echo "Current user: $(whoami)"
echo "Current directory: $(pwd)"
echo "Node version: $(node -v)"
echo "NPM version: $(npm -v)"
echo "PATH: $PATH"

# ===== START THE APPLICATION =====
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