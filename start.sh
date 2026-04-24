#!/bin/bash

set -e

export CHROME_HOST_RULES="MAP rewards.bing.com 150.171.28.10,MAP www.bing.com 150.171.28.10,MAP account.microsoft.com 150.171.28.10,MAP prod.rewardsplatform.microsoft.com 52.190.158.80"

# echo "========================================="
# echo "🚀 STARTING WITH DNS FIXES"
# echo "========================================="

# # Force Google DNS at system level (if possible)
# if [ -w /etc/resolv.conf ]; then
    # cat > /etc/resolv.conf << 'EOF'
# nameserver 8.8.8.8
# nameserver 8.8.4.4
# nameserver 1.1.1.1
# options timeout:2 attempts:3 rotate
# EOF
    # echo "✅ /etc/resolv.conf updated"
# else
    # echo "⚠️ Cannot write /etc/resolv.conf - using Node.js DNS patches"
# fi

# # Show current DNS config
# echo "📋 Current DNS configuration:"
# cat /etc/resolv.conf 2>/dev/null || echo "   (cannot read resolv.conf)"

# echo "🔄 Checking for prod..."
# dig +short prod.rewardsplatform.microsoft.com
# echo "🔄 Checking for rewards..."
# dig +short rewards.bing.com
# echo "🔄 Checking for microsoft..."
# dig +short account.microsoft.com
# echo "🔄 Checking for bing..."
# dig +short www.bing.com
# echo "🔄 Checking for discord..."
# dig +short discord.com
# echo "🔄 Checking for bingapis..."
# dig +short www.bingapis.com
# echo "🔄 Checking for api bing..."
# dig +short api.bing.com

# Set Node.js options
# export NODE_OPTIONS="--require ./dist/net-patch.js --dns-result-order=ipv4first"
# export UV_THREADPOOL_SIZE=4

# echo "✅ NODE_OPTIONS: $NODE_OPTIONS"
# echo "✅ UV_THREADPOOL_SIZE: $UV_THREADPOOL_SIZE"


# UPDATE REPO: Re-download the repository to get latest changes
echo "Updating repository from remote source..."
cd /home/user/app

# Backup existing files before update
BACKUP_DIR="/tmp/app_backup_$(date +%s)"
mkdir -p "$BACKUP_DIR"
echo "Creating backup at $BACKUP_DIR"

# Backup important runtime files that shouldn't be overwritten
[ -f ".env" ] && cp .env "$BACKUP_DIR/" 2>/dev/null
[ -d "node_modules" ] && echo "Preserving node_modules" && mv node_modules "$BACKUP_DIR/" 2>/dev/null
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

        # Copy updated files to app directory
        cp -r /tmp/repo_extract/$REPO_DIR/* /home/user/app/

        # Restore backed up files
        [ -f "$BACKUP_DIR/.env" ] && cp "$BACKUP_DIR/.env" /home/user/app/ && echo "Restored .env"
        [ -d "$BACKUP_DIR/node_modules" ] && mv "$BACKUP_DIR/node_modules" /home/user/app/ && echo "Restored node_modules"
        [ -d "$BACKUP_DIR/.config" ] && cp -r "$BACKUP_DIR/.config" /home/user/app/ 2>/dev/null

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


echo "Running pre-build..."
npm run pre-build

echo "Running build..."
npm run build

sh -c "bash mkconf.sh && \
    if [ \"$RUN_ON_START\" = \"true\" ]; then bash src/run_daily.sh; fi & \
    yacron -c /home/user/app/job.yaml"
