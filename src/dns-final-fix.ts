// ===== FINAL DNS FIX - MUST BE FIRST =====
import dns from 'dns';
import net from 'net';
import { Resolver } from 'dns/promises';

// Force IPv4 preference at Node.js level
dns.setDefaultResultOrder('ipv4first');

// Override DNS servers globally
dns.setServers(['8.8.8.8', '8.8.4.4']);

// Google DNS resolver
const googleResolver = new Resolver();
googleResolver.setServers(['8.8.8.8', '8.8.4.4']);

// Cache for successful resolutions
const resolutionCache: Map<string, string> = new Map();

// Track failed domains to avoid retrying bad IPs
const failedDomains: Set<string> = new Set();

// Helper to resolve with Google DNS
async function resolveWithGoogle(host: string): Promise<string | null> {
    try {
        const addresses = await googleResolver.resolve4(host);
        if (addresses && addresses.length > 0) {
            const ip = addresses[0];
            console.log(`[DNS-FIX] ✅ Google resolved ${host} -> ${ip}`);
            resolutionCache.set(host, ip);
            return ip;
        }
    } catch (err) {
        console.log(`[DNS-FIX] ⚠️ Google DNS failed for ${host}`);
    }
    return null;
}

// Patch net.Socket.connect - ONLY use cache as last resort
const originalConnect = net.Socket.prototype.connect;

net.Socket.prototype.connect = function(this: any, ...args: any[]) {
    const options = args[0];
    
    if (options && typeof options === 'object') {
        const host = options.host;
        
        if (host && typeof host === 'string' && !host.match(/^\d+\.\d+\.\d+\.\d+$/)) {
            // Only intercept domain names, not IPs
            console.log(`[DNS-FIX] Connection attempt to ${host}`);
            
            // Check if this domain has been failing
            if (failedDomains.has(host)) {
                // Use cached IP as last resort
                const cachedIp = resolutionCache.get(host);
                if (cachedIp) {
                    console.log(`[DNS-FIX] 🔄 Using cached IP for ${host}: ${cachedIp}`);
                    this._originalServername = host;
                    options.host = cachedIp;
                }
            }
        }
    }
    
    return originalConnect.apply(this, args as any);
};

// Patch dns.lookup - ALWAYS try real DNS first
const originalLookup = dns.lookup;

(dns as any).lookup = function(hostname: string, options: any, callback?: any) {
    // Skip if it's already an IP
    if (hostname.match(/^\d+\.\d+\.\d+\.\d+$/)) {
        return originalLookup(hostname, options, callback);
    }
    
    // Handle callback-only case
    if (typeof options === 'function') {
        const cb = options;
        
        // Try Google DNS first
        resolveWithGoogle(hostname).then(ip => {
            if (ip) {
                cb(null, ip, 4);
            } else {
                // Fall back to system DNS
                originalLookup(hostname, cb);
            }
        }).catch(() => {
            originalLookup(hostname, cb);
        });
        return {} as any;
    }
    
    // Handle options+callback case
    if (typeof callback === 'function') {
        resolveWithGoogle(hostname).then(ip => {
            if (ip) {
                if (options && options.all) {
                    callback(null, [{ address: ip, family: 4 }]);
                } else {
                    callback(null, ip, 4);
                }
            } else {
                originalLookup(hostname, options, callback);
            }
        }).catch(() => {
            originalLookup(hostname, options, callback);
        });
        return {} as any;
    }
    
    return originalLookup(hostname, options, callback);
};

// Copy promisify property
(dns as any).lookup.__promisify__ = originalLookup.__promisify__;

// Patch dns.resolve4 to use our cache
const originalResolve4 = dns.resolve4;
(dns as any).resolve4 = function(hostname: string, options: any, callback?: any) {
    if (typeof options === 'function') {
        const cb = options;
        resolveWithGoogle(hostname).then(ip => {
            if (ip) {
                cb(null, [ip]);
            } else {
                originalResolve4(hostname, cb);
            }
        }).catch(() => {
            originalResolve4(hostname, cb);
        });
        return {} as any;
    }
    
    if (typeof callback === 'function') {
        resolveWithGoogle(hostname).then(ip => {
            if (ip) {
                callback(null, [ip]);
            } else {
                originalResolve4(hostname, options, callback);
            }
        }).catch(() => {
            originalResolve4(hostname, options, callback);
        });
        return {} as any;
    }
    
    return originalResolve4(hostname, options, callback);
};

// Pre-resolve common domains
async function preResolve() {
    console.log('[DNS-FIX] Pre-resolving common domains...');
    const domains = [
        'rewards.bing.com',
        'www.bing.com',
        'prod.rewardsplatform.microsoft.com',
        'discord.com',
        'gateway.discord.gg'
    ];
    
    for (const domain of domains) {
        const ip = await resolveWithGoogle(domain);
        if (!ip) {
            console.log(`[DNS-FIX] ⚠️ Adding ${domain} to failure list`);
            failedDomains.add(domain);
        }
    }
    
    console.log('[DNS-FIX] ✅ Ready - Always trying real DNS first');
}

// Start pre-resolution
preResolve();

// Export for use
export { resolutionCache, failedDomains };