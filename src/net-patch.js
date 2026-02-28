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

// Patch DNS to return IPs immediately
const originalLookup = dns.lookup;
dns.lookup = (hostname, options, callback) => {
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

// Patch socket to use browser-like settings
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) {
    const options = args[0];
    
    if (options && typeof options === 'object') {
        options.family = 4;
        options.keepAlive = false;
        
        // Add browser-like TCP settings
        options.noDelay = true;  // Disable Nagle's algorithm
        options.keepAliveInitialDelay = 0;
    }
    
    return originalConnect.apply(this, args);
};

// Patch TLS to use browser-like cipher suites
const originalCreateSecureContext = tls.createSecureContext;
tls.createSecureContext = function(options) {
    // Use browser-like TLS settings
    const browserOptions = {
        ...options,
        // Modern browser cipher suites
        ciphers: 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384',
        honorCipherOrder: true,
        minVersion: 'TLSv1.2',
        maxVersion: 'TLSv1.3'
    };
    return originalCreateSecureContext(browserOptions);
};

console.log('[NET-PATCH] ✅ Ready (Browser Mode)');