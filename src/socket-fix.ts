// ===== FINAL DNS FIX - MUST BE FIRST =====
// This combines all working approaches from HF users
import dns from 'dns';
import net from 'net';
import { Resolver } from 'dns/promises';

// ===== LAYER 1: Force IPv4 preference at Node.js level =====
dns.setDefaultResultOrder('ipv4first');

// ===== LAYER 2: Override DNS servers =====
dns.setServers(['8.8.8.8', '8.8.4.4']);

// ===== LAYER 3: Custom resolver with Google DNS =====
const googleResolver = new Resolver();
googleResolver.setServers(['8.8.8.8', '8.8.4.4']);

// ===== LAYER 4: Hardcoded IP mappings (like the Persian solution) =====
const IP_MAP: Record<string, string[]> = {
    'rewards.bing.com': ['150.171.30.10', '150.171.29.10'],
    'www.bing.com': ['2.18.67.162', '2.18.67.135'],
    'prod.rewardsplatform.microsoft.com': ['13.107.213.40', '13.107.246.40'],
    'discord.com': ['162.159.135.232', '162.159.128.233'],
    'gateway.discord.gg': ['162.159.136.234', '162.159.134.234'],
    'api.telegram.org': ['149.154.167.220', '91.108.56.110']
};

// Cache for resolved IPs
const ipCache: Map<string, string[]> = new Map();

// Pre-resolve all domains
async function preResolveAll() {
    console.log('[DNS-FINAL] Pre-resolving all domains...');
    
    for (const [domain, hardcodedIPs] of Object.entries(IP_MAP)) {
        try {
            // Try Google DNS first
            const addresses = await googleResolver.resolve4(domain);
            ipCache.set(domain, addresses);
            console.log(`[DNS-FINAL] ✅ ${domain} -> ${addresses.join(', ')}`);
        } catch (err) {
            // Fall back to hardcoded IPs
            ipCache.set(domain, hardcodedIPs);
            console.log(`[DNS-FINAL] ⚠️ ${domain} using fallback: ${hardcodedIPs.join(', ')}`);
        }
    }
}

// ===== LAYER 5: Patch socket.getaddrinfo (LOWEST LEVEL) =====
const originalGetaddrinfo = (dns as any).lookup; // Store original

// Helper to get IP (returns only IPv4)
function getIPv4ForHost(host: string): string | null {
    // Check cache first
    for (const [domain, ips] of ipCache.entries()) {
        if (host === domain || host.endsWith(`.${domain}`)) {
            return ips[0]; // Return first IPv4
        }
    }
    
    // Check hardcoded map
    for (const [domain, ips] of Object.entries(IP_MAP)) {
        if (host === domain || host.endsWith(`.${domain}`)) {
            return ips[0];
        }
    }
    
    return null;
}

// ===== LAYER 6: Patch net.Socket.connect (like Python's socket patch) =====
const originalConnect = net.Socket.prototype.connect;

net.Socket.prototype.connect = function(this: any, ...args: any[]) {
    const options = args[0];
    
    if (options && typeof options === 'object') {
        const host = options.host || options.servername;
        
        if (host && typeof host === 'string') {
            const ip = getIPv4ForHost(host);
            if (ip) {
                console.log(`[DNS-FINAL] 🔄 ${host} -> ${ip}`);
                
                // Store original for TLS SNI
                this._originalServername = host;
                
                // Replace host with IP
                if (options.host) options.host = ip;
                if (options.servername) options.servername = host;
                
                // Force IPv4
                if (options.family === undefined) {
                    options.family = 4;
                }
            }
        }
    }
    
    return originalConnect.apply(this, args as any);
};

// ===== LAYER 7: Patch dns.lookup to force IPv4 only =====
(dns as any).lookup = function(hostname: string, options: any, callback?: any) {
    // Force IPv4
    const opts = typeof options === 'object' ? { ...options, family: 4 } : { family: 4 };
    
    const ip = getIPv4ForHost(hostname);
    
    if (ip) {
        console.log(`[DNS-FINAL] DNS: ${hostname} -> ${ip}`);
        
        if (typeof options === 'function') {
            options(null, ip, 4);
            return;
        }
        
        if (typeof callback === 'function') {
            if (opts.all) {
                callback(null, [{ address: ip, family: 4 }]);
            } else {
                callback(null, ip, 4);
            }
            return;
        }
    }
    
    // Fall back to original with forced IPv4
    if (typeof options === 'function') {
        return originalGetaddrinfo(hostname, opts, options);
    }
    if (typeof callback === 'function') {
        return originalGetaddrinfo(hostname, opts, callback);
    }
    return originalGetaddrinfo(hostname, opts);
};

// Copy promisify
(dns as any).lookup.__promisify__ = originalGetaddrinfo.__promisify__;

// ===== LAYER 8: Patch dns.resolve4 to use our cache =====
const originalResolve4 = dns.resolve4;
(dns as any).resolve4 = function(hostname: string, options: any, callback?: any) {
    const ip = getIPv4ForHost(hostname);
    
    if (ip) {
        if (typeof options === 'function') {
            options(null, [ip]);
            return;
        }
        if (typeof callback === 'function') {
            callback(null, [ip]);
            return;
        }
    }
    
    return originalResolve4(hostname, options, callback);
};

// Start pre-resolution
preResolveAll().then(() => {
    console.log('[DNS-FINAL] ✅ Ready - All connections forced to IPv4 with correct IPs');
});

// Export
export { ipCache };