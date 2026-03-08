// ===== NETWORK PATCH - PRELOAD SCRIPT =====
const net = require('net');
const dns = require('dns');
const tls = require('tls');

const IP_MAP = {
    'rewards.bing.com': ['150.171.30.10', '150.171.29.10', '150.171.28.10', '150.171.27.10'],
    'www.bing.com': ['2.18.67.162', '2.18.67.135', '2.18.67.136'],
    'discord.com': ['162.159.135.232', '162.159.128.233', '162.159.138.232']
};

// Track current IP index per domain
const currentIndex = {};

console.log('🔧 NETWORK PATCH LOADED (Browser Mode)');

// Store original methods
const originalLookup = dns.lookup;
const originalResolve4 = dns.resolve4;

// ===== PATCH 1: dns.lookup (for socket connections) =====
dns.lookup = function(hostname, options, callback) {
    let opts = options;
    let cb = callback;

    if (typeof options === 'function') {
        cb = options;
        opts = {};
    }

    for (const [domain, ips] of Object.entries(IP_MAP)) {
        if (hostname === domain || hostname.endsWith(`.${domain}`)) {
            if (currentIndex[domain] === undefined) currentIndex[domain] = 0;
            const ip = ips[currentIndex[domain]];
            
            console.log(`[DNS] ${hostname} -> ${ip} (immediate)`);
            
            if (opts && opts.all) {
                process.nextTick(() => cb(null, [{ address: ip, family: 4 }]));
            } else {
                process.nextTick(() => cb(null, ip, 4));
            }
            return;
        }
    }

    const family = 4;
    if (typeof options === 'function') {
        return originalLookup(hostname, { family }, options);
    }
    if (typeof callback === 'function') {
        return originalLookup(hostname, { ...opts, family }, callback);
    }
    return originalLookup(hostname, { ...opts, family });
};

// ===== PATCH 2: dns.resolve4 (for direct DNS queries) =====
dns.resolve4 = function(hostname, options, callback) {
    let opts = options;
    let cb = callback;

    if (typeof options === 'function') {
        cb = options;
        opts = {};
    }

    // Check if domain is in our map
    for (const [domain, ips] of Object.entries(IP_MAP)) {
        if (hostname === domain || hostname.endsWith(`.${domain}`)) {
            if (currentIndex[domain] === undefined) currentIndex[domain] = 0;
            const ip = ips[currentIndex[domain]];
            
            console.log(`[DNS-resolve4] ${hostname} -> ${ip} (immediate)`);
            
            // Return as array of IPs (what resolve4 expects)
            process.nextTick(() => {
                if (typeof cb === 'function') {
                    cb(null, [ip]);
                }
            });
            return;
        }
    }

    // For other domains, try Google DNS directly
    const googleDns = new dns.Resolver();
    googleDns.setServers(['8.8.8.8', '8.8.4.4']);
    
    googleDns.resolve4(hostname, opts, (err, addresses) => {
        if (!err && addresses && addresses.length > 0) {
            if (typeof cb === 'function') cb(null, addresses);
        } else {
            // Fallback to original
            originalResolve4(hostname, opts, cb);
        }
    });
};

// ===== PATCH 3: Override DNS servers globally =====
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

// ===== PATCH 4: Patch socket creation =====
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) {
    const options = args[0];
    
    if (options && typeof options === 'object') {
        options.family = 4;
        options.keepAlive = false;
        options.noDelay = true;
    }
    
    return originalConnect.apply(this, args);
};

console.log('[NET-PATCH] ✅ Ready - All DNS methods patched');