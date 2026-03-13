#!/bin/bash

set -e

export CHROME_HOST_RULES="MAP rewards.bing.com 150.171.28.10,MAP www.bing.com 150.171.28.10,MAP account.microsoft.com 150.171.28.10,MAP prod.rewardsplatform.microsoft.com 52.190.158.80"

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

echo "🔄 Checking for prod..."
dig +short prod.rewardsplatform.microsoft.com
echo "🔄 Checking for rewards..."
dig +short rewards.bing.com
echo "🔄 Checking for microsoft..."
dig +short account.microsoft.com
echo "🔄 Checking for bing..."
dig +short www.bing.com
echo "🔄 Checking for discord..."
dig +short discord.com
echo "🔄 Checking for bingapis..."
dig +short www.bingapis.com
echo "🔄 Checking for api bing..."
dig +short api.bing.com

# Set Node.js options
export NODE_OPTIONS="--require ./dist/net-patch.js --dns-result-order=ipv4first"
export UV_THREADPOOL_SIZE=4

echo "✅ NODE_OPTIONS: $NODE_OPTIONS"
echo "✅ UV_THREADPOOL_SIZE: $UV_THREADPOOL_SIZE"

cd /home/user/app

echo "========================================="
echo "🚀 Starting services..."
echo "========================================="

# Install yacron if not already present
if ! command -v yacron >/dev/null 2>&1; then
    echo "📦 Installing yacron..."
    pip install --no-cache-dir yacron
fi

# Start keep_alive in background
nohup gunicorn keep_alive:app --bind 0.0.0.0:7860 &
KEEP_ALIVE_PID=$!
echo "✅ keep_alive started with PID: $KEEP_ALIVE_PID"

# Start yacron in background right away (so scheduler is active immediately)
if [ -f "job.yaml" ]; then
    echo "✅ Found job.yaml – starting yacron in background"
    nohup yacron --config job.yaml > yacron.log 2>&1 &
    YACRON_PID=$!
    echo "   yacron started with PID: $YACRON_PID"
    echo "   Logs redirected to yacron.log"
else
    echo "⚠️ WARNING: job.yaml not found — yacron will NOT start"
    ls -la
fi

# Run mkconf.sh
echo "📝 Running mkconf.sh..."
bash mkconf.sh

# Run initial daily tasks if enabled (this blocks until finished)
if [ "$RUN_ON_START" = "true" ]; then
    echo "📅 Running initial daily tasks..."
    bash src/run_daily.sh
else
    echo "⏭️ Skipping initial daily tasks (RUN_ON_START is not true)"
fi

echo "========================================="
echo "✅ All startup tasks completed"
echo "========================================="

# Keep container alive by waiting on background processes
# (yacron + gunicorn should keep it running; this is just safety)
echo "⏳ Waiting for background processes (yacron / gunicorn)..."
wait -n

# If something exits, show status and exit
echo "One of the background processes exited."
ps aux | grep -E 'gunicorn|yacron|python|node'
exit 0