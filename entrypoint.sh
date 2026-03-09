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

# Set Node.js options
export NODE_OPTIONS="--require ./dist/net-patch.js --dns-result-order=ipv4first"
export UV_THREADPOOL_SIZE=4

echo "✅ NODE_OPTIONS: $NODE_OPTIONS"
echo "✅ UV_THREADPOOL_SIZE: $UV_THREADPOOL_SIZE"

cd /home/user/app

# Start services
echo "========================================="
echo "🚀 Starting services..."
echo "========================================="

# Start keep_alive in background
nohup gunicorn keep_alive:app --bind 0.0.0.0:7860 &
KEEP_ALIVE_PID=$!
echo "✅ keep_alive started with PID: $KEEP_ALIVE_PID"

# Run mkconf.sh
echo "📝 Running mkconf.sh..."
bash mkconf.sh

# Run daily tasks if enabled
if [ "$RUN_ON_START" = "true" ]; then
    echo "📅 Running daily tasks..."
    bash src/run_daily.sh
fi

echo "========================================="
echo "✅ All services started"
echo "========================================="

# Wait for any process to exit
wait -n

# Exit with the status of the first process that exits
exit $?