// ===== NETWORK PATCH - PRELOAD SCRIPT =====
// This file must be loaded FIRST via NODE_OPTIONS
import net from 'net';
import dns from 'dns';
import tls from 'tls';

// Hardcoded IP mappings based on working resolutions
const IP_MAP: Record<string, string> = {
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
const connectionLog: Set<string> = new Set();

console.log('\x1b[36m%s\x1b[0m', '🔧 NETWORK PATCH LOADED');
console.log('📋 Patched domains:', Object.keys(IP_MAP).join(', '));

// ===== LAYER 1: Patch net.Socket.connect (Lowest level) =====
const originalConnect = net.Socket.prototype.connect;

net.Socket.prototype.connect = function(this: any, ...args: any[]) {
    const options = args[0];
    
    if (options && typeof options === 'object') {
        const host = options.host || options.servername;
        
        if (host && typeof host === 'string') {
            // Check if this domain needs patching
            for (const [domain, ip] of Object.entries(IP_MAP)) {
                if (host === domain || host.endsWith(`.${domain}`)) {
                    // Log only once per domain
                    if (!connectionLog.has(domain)) {
                        console.log(`🔄 ${domain} -> ${ip}`);
                        connectionLog.add(domain);
                    }
                    
                    // Store original for TLS SNI
                    this._originalServername = host;
                    
                    // Replace host with IP
                    if (options.host) options.host = ip;
                    if (options.servername) options.servername = host; // Keep original for SNI
                    
                    // Force IPv4
                    if (options.family === undefined) {
                        options.family = 4;
                    }
                    break;
                }
            }
        }
    }
    
    return originalConnect.apply(this, args as any);
};

// ===== LAYER 2: Patch tls.connect for SSL connections =====
const originalTLSConnect = tls.connect;

(tls as any).connect = function(...args: any[]) {
    const options = args[0];
    
    if (options && typeof options === 'object') {
        const host = options.host || options.servername;
        
        if (host && typeof host === 'string') {
            for (const [domain, ip] of Object.entries(IP_MAP)) {
                if (host === domain || host.endsWith(`.${domain}`)) {
                    if (options.host) options.host = ip;
                    if (options.servername) options.servername = host; // Keep for SNI
                    break;
                }
            }
        }
    }
    
    return originalTLSConnect.apply(this, args);
};

// ===== LAYER 3: Patch dns.lookup =====
const originalLookup = dns.lookup;

(dns as any).lookup = function(hostname: string, options: any, callback?: any) {
    // Check if this domain is in our map
    for (const [domain, ip] of Object.entries(IP_MAP)) {
        if (hostname === domain || hostname.endsWith(`.${domain}`)) {
            // Handle callback-only case
            if (typeof options === 'function') {
                options(null, ip, 4);
                return;
            }
            
            // Handle options+callback case
            if (typeof callback === 'function') {
                if (options && options.all) {
                    callback(null, [{ address: ip, family: 4 }]);
                } else {
                    callback(null, ip, 4);
                }
                return;
            }
            
            // Handle promise case
            return {
                then: (resolve: Function) => resolve({ address: ip, family: 4 })
            };
        }
    }
    
    // Force IPv4 for all other domains
    const opts = typeof options === 'object' ? { ...options, family: 4 } : { family: 4 };
    
    if (typeof options === 'function') {
        return originalLookup(hostname, opts, options);
    }
    if (typeof callback === 'function') {
        return originalLookup(hostname, opts, callback);
    }
    return originalLookup(hostname, opts);
};

// ===== LAYER 4: Patch dns.resolve4 =====
const originalResolve4 = dns.resolve4;

(dns as any).resolve4 = function(hostname: string, options: any, callback?: any) {
    // Check if this domain is in our map
    for (const [domain, ip] of Object.entries(IP_MAP)) {
        if (hostname === domain || hostname.endsWith(`.${domain}`)) {
            if (typeof options === 'function') {
                options(null, [ip]);
                return;
            }
            if (typeof callback === 'function') {
                callback(null, [ip]);
                return;
            }
            return Promise.resolve([ip]);
        }
    }
    
    if (typeof options === 'function') {
        return originalResolve4(hostname, options);
    }
    if (typeof callback === 'function') {
        return originalResolve4(hostname, options, callback);
    }
    return originalResolve4(hostname, options);
};

// Copy promisify property
(dns as any).lookup.__promisify__ = originalLookup.__promisify__;

// Export for use
export { IP_MAP };