// ===== NETWORK PATCH - PRELOAD SCRIPT (JavaScript) =====
// This file must be loaded FIRST via NODE_OPTIONS
const net = require('net');
const dns = require('dns');
const tls = require('tls');

// Hardcoded IP mappings based on working resolutions
const IP_MAP = {
    // Microsoft domains
    'rewards.bing.com': '150.171.30.10',
    'www.bing.com': '2.18.67.162',
    'account.microsoft.com': '150.171.30.10',
    'prod.rewardsplatform.microsoft.com': '13.107.213.40',
    'login.live.com': '13.107.213.40',
    
    // Bing API domains
    'www.bingapis.com': '2.18.67.162',
    'api.bing.com': '2.18.67.162',
    
    // Discord domains
    'discord.com': '162.159.135.232',
    'gateway.discord.gg': '162.159.135.232',
    'cdn.discordapp.com': '162.159.135.232',
    'discordapp.com': '162.159.135.232',
    
    // Other services
    'trends.google.com': '142.250.185.46',
    'wikimedia.org': '198.35.26.96',
    'www.reddit.com': '151.101.1.140',
    'raw.githubusercontent.com': '185.199.108.133'
};

// Track connections for debugging
const connectionLog = new Set();

console.log('\x1b[36m%s\x1b[0m', '🔧 NETWORK PATCH LOADED');
console.log('📋 Patched domains:', Object.keys(IP_MAP).join(', '));

// ===== LAYER 1: Patch net.Socket.connect =====
const originalConnect = net.Socket.prototype.connect;

net.Socket.prototype.connect = function(...args) {
    const options = args[0];
    
    if (options && typeof options === 'object') {
        const host = options.host || options.servername;
        
        if (host && typeof host === 'string') {
            for (const [domain, ip] of Object.entries(IP_MAP)) {
                if (host === domain || host.endsWith(`.${domain}`)) {
                    if (!connectionLog.has(domain)) {
                        console.log(`🔄 ${domain} -> ${ip}`);
                        connectionLog.add(domain);
                    }
                    
                    this._originalServername = host;
                    
                    if (options.host) options.host = ip;
                    if (options.servername) options.servername = host;
                    
                    if (options.family === undefined) {
                        options.family = 4;
                    }
                    break;
                }
            }
        }
    }
    
    return originalConnect.apply(this, args);
};

// ===== LAYER 2: Patch dns.lookup =====
const originalLookup = dns.lookup;

dns.lookup = function(hostname, options, callback) {
    for (const [domain, ip] of Object.entries(IP_MAP)) {
        if (hostname === domain || hostname.endsWith(`.${domain}`)) {
            if (typeof options === 'function') {
                options(null, ip, 4);
                return;
            }
            
            if (typeof callback === 'function') {
                if (options && options.all) {
                    callback(null, [{ address: ip, family: 4 }]);
                } else {
                    callback(null, ip, 4);
                }
                return;
            }
            
            return Promise.resolve({ address: ip, family: 4 });
        }
    }
    
    const opts = typeof options === 'object' ? { ...options, family: 4 } : { family: 4 };
    
    if (typeof options === 'function') {
        return originalLookup(hostname, opts, options);
    }
    if (typeof callback === 'function') {
        return originalLookup(hostname, opts, callback);
    }
    return originalLookup(hostname, opts);
};

// Copy promisify property
dns.lookup.__promisify__ = originalLookup.__promisify__;

console.log('[NET-PATCH] ✅ Ready');