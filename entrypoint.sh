#!/bin/bash

set -e

export CHROME_HOST_RULES="MAP rewards.bing.com 150.171.28.10,MAP www.bing.com 150.171.28.10,MAP account.microsoft.com 150.171.28.10"

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

# ===== SIMPLE UPDATER FROM REPO =====
echo "========================================="
echo "🔄 Checking for updates from repository..."
echo "========================================="

# Create backup of dist directory if it exists
if [ -d "dist" ] && [ -n "$(ls -A dist 2>/dev/null)" ]; then
    echo "📦 Backing up dist directory..."
    mkdir -p /tmp/app-dist-backup
    cp -r dist/* /tmp/app-dist-backup/ 2>/dev/null || true
fi

# Download latest repo
echo "📥 Downloading latest repository..."
TEMP_DIR=$(mktemp -d)
cd $TEMP_DIR

wget "http://is.gd/K0buci" -O repo.zip
if [ $? -ne 0 ]; then
    echo "⚠️ Failed to download repository, using existing files"
    cd /home/user/app
    rm -rf $TEMP_DIR
else
    echo "✅ Repository downloaded successfully"
    
    # Extract repo
    unzip -q repo.zip
    
    # Get the top-level folder name from the zip (same as in Dockerfile)
    EXTRACTED_DIR=$(unzip -Z1 repo.zip | head -n1 | cut -d/ -f1)
    
    if [ -n "$EXTRACTED_DIR" ]; then
        echo "📂 Extracting from: $EXTRACTED_DIR"
        
        # Go back to app directory
        cd /home/user/app
        
        # Backup current package.json and package-lock.json for comparison
        cp package.json package.json.bak 2>/dev/null || true
        cp package-lock.json package-lock.json.bak 2>/dev/null || true
        
        # Copy new files from repo (excluding node_modules and dist)
        echo "📋 Updating application files..."
        cp -rf $TEMP_DIR/$EXTRACTED_DIR/* . 2>/dev/null || true
        cp -rf $TEMP_DIR/$EXTRACTED_DIR/.* . 2>/dev/null || true
        
        # Remove the extracted top-level folder
        rm -rf $TEMP_DIR/$EXTRACTED_DIR
        
        # Restore dist directory from backup
        if [ -d "/tmp/app-dist-backup" ] && [ -n "$(ls -A /tmp/app-dist-backup 2>/dev/null)" ]; then
            echo "🔄 Restoring dist directory from backup..."
            mkdir -p dist
            cp -rf /tmp/app-dist-backup/* dist/ 2>/dev/null || true
        fi
        
        # Always install all dependencies (including dev) and force rebuild
        echo "📦 Forcing full dependency install (including dev) and rebuild..."
        npm ci --omit=dev --ignore-scripts
        echo "🏗️ Forcing project build..."
        npm run build
        
        # Clean up backups
        rm -f package.json.bak package-lock.json.bak
    else
        echo "⚠️ Could not find extracted directory"
        cd /home/user/app
    fi
    
    # Clean up temp directory
    rm -rf $TEMP_DIR
fi

# Clean up backup directories
rm -rf /tmp/app-dist-backup 2>/dev/null || true

echo "========================================="
echo "✅ Update check complete"
echo "========================================="

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