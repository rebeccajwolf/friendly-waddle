// ===== NETWORK PATCH - PRELOAD SCRIPT =====
const net = require('net');
const dns = require('dns');

const IP_MAP = {
    'rewards.bing.com': ['150.171.30.10', '150.171.29.10', '150.171.28.10', '150.171.27.10'],
    'www.bing.com': ['2.18.67.162', '2.18.67.135', '2.18.67.136'],
    'discord.com': ['162.159.135.232', '162.159.128.233', '162.159.138.232']
};

// Track current IP index per domain
const currentIndex = {};

console.log('🔧 NETWORK PATCH LOADED (Browser Mode)');

// CRITICAL: Patch DNS to return IPs immediately via nextTick
const originalLookup = dns.lookup;
dns.lookup = (hostname, options, callback) => {
    let opts = options;
    let cb = callback;

    if (typeof options === 'function') {
        cb = options;
        opts = {};
    }

    // Check if domain needs patching
    for (const [domain, ips] of Object.entries(IP_MAP)) {
        if (hostname === domain || hostname.endsWith(`.${domain}`)) {
            // Initialize index if needed
            if (currentIndex[domain] === undefined) currentIndex[domain] = 0;
            const ip = ips[currentIndex[domain]];
            
            console.log(`[DNS] ${hostname} -> ${ip} (immediate)`);
            
            // Return IMMEDIATELY via nextTick (browser-like)
            if (opts && opts.all) {
                process.nextTick(() => cb(null, [{ address: ip, family: 4 }]));
            } else {
                process.nextTick(() => cb(null, ip, 4));
            }
            return;
        }
    }

    // Force IPv4 for all other domains
    const family = 4;
    if (typeof options === 'function') {
        return originalLookup(hostname, { family }, options);
    }
    if (typeof callback === 'function') {
        return originalLookup(hostname, { ...opts, family }, callback);
    }
    return originalLookup(hostname, { ...opts, family });
};

// Patch socket to prevent connection pooling
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) {
    const options = args[0];
    
    if (options && typeof options === 'object') {
        // Force IPv4
        options.family = 4;
        
        // Disable keep-alive (browser behavior)
        if (options.keepAlive !== false) {
            options.keepAlive = false;
        }
    }
    
    return originalConnect.apply(this, args);
};

console.log('[NET-PATCH] ✅ Ready (Browser Mode)');