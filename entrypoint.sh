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

# ===== UPDATE REPO (Old Method Style) =====
echo "========================================="
echo "🔄 Updating repository from remote source..."
echo "========================================="

# Backup existing files before update
BACKUP_DIR="/tmp/app_backup_$(date +%s)"
mkdir -p "$BACKUP_DIR"
echo "Creating backup at $BACKUP_DIR"

# Backup important runtime files that shouldn't be overwritten
[ -f ".env" ] && cp .env "$BACKUP_DIR/" 2>/dev/null
[ -d "node_modules" ] && echo "Preserving node_modules" && mv node_modules "$BACKUP_DIR/" 2>/dev/null
[ -d "dist" ] && echo "Preserving dist" && mv dist "$BACKUP_DIR/" 2>/dev/null
[ -d ".config" ] && cp -r .config "$BACKUP_DIR/" 2>/dev/null

# Download and extract updated repository
echo "Downloading latest repository..."
wget -q http://is.gd/K0buci -O /tmp/repo_update.zip

if [ $? -eq 0 ] && [ -f /tmp/repo_update.zip ]; then
    echo "Repository downloaded successfully, extracting..."

    # Extract to temporary location
    unzip -q /tmp/repo_update.zip -d /tmp/repo_extract

    # Get the extracted directory name
    REPO_DIR=$(unzip -Z1 /tmp/repo_update.zip | head -n1 | cut -d/ -f1)

    if [ ! -z "$REPO_DIR" ] && [ -d "/tmp/repo_extract/$REPO_DIR" ]; then
        echo "Updating application files..."

        # Copy updated files to app directory (exclude node_modules, dist, backups)
        cp -r /tmp/repo_extract/$REPO_DIR/* /home/user/app/ 2>/dev/null || true
        cp -r /tmp/repo_extract/$REPO_DIR/.* /home/user/app/ 2>/dev/null || true

        # Restore backed up files
        [ -f "$BACKUP_DIR/.env" ] && cp "$BACKUP_DIR/.env" /home/user/app/ && echo "Restored .env"
        [ -d "$BACKUP_DIR/node_modules" ] && mv "$BACKUP_DIR/node_modules" /home/user/app/ && echo "Restored node_modules"
        [ -d "$BACKUP_DIR/dist" ] && mv "$BACKUP_DIR/dist" /home/user/app/ && echo "Restored dist"
        [ -d "$BACKUP_DIR/.config" ] && cp -r "$BACKUP_DIR/.config" /home/user/app/ 2>/dev/null

        # Copy fresh net-patch.js from src/ to dist/ (latest from repo)
        if [ -f "src/net-patch.js" ]; then
            echo "🔄 Copying fresh net-patch.js from src/ to dist/..."
            mkdir -p dist
            cp src/net-patch.js dist/net-patch.js
        else
            echo "⚠️ Warning: src/net-patch.js not found in updated repo!"
        fi

        # Safe build: only tsc (no rimraf dist to avoid deleting net-patch.js)
        echo "🏗️ Running safe build (tsc only)..."
        export PATH="./node_modules/.bin:$PATH"
        tsc

        # Cleanup
        rm -rf /tmp/repo_extract /tmp/repo_update.zip
        echo "Repository update completed successfully"
    else
        echo "Warning: Could not find extracted repository directory, skipping update"
        rm -rf /tmp/repo_extract /tmp/repo_update.zip
    fi
else
    echo "Warning: Failed to download repository update, continuing with existing code"
    [ -f /tmp/repo_update.zip ] && rm /tmp/repo_update.zip
fi

# Restore node_modules if it was backed up and not restored
[ -d "$BACKUP_DIR/node_modules" ] && [ ! -d "/home/user/app/node_modules" ] && mv "$BACKUP_DIR/node_modules" /home/user/app/

# Clean up backup directory
rm -rf "$BACKUP_DIR"

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