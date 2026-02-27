// ===== SOCKET LEVEL DNS FIX - MUST BE FIRST =====
// This patches the lowest level of Node.js networking
import dns from 'dns';
import net from 'net';
import { Resolver } from 'dns/promises';

// Force Google DNS for all resolutions
const googleResolver = new Resolver();
googleResolver.setServers(['8.8.8.8', '8.8.4.4']);

// Cache for resolved IPs
const ipCache: Map<string, string[]> = new Map();

// Hardcoded IPs for problematic domains (like the Python examples)
const HARDCODED_IPS: Record<string, string[]> = {
    'discord.com': ['162.159.135.232', '162.159.133.232', '162.159.138.232'],
    'gateway.discord.gg': ['162.159.135.232', '162.159.133.232'],
    'cdn.discordapp.com': ['162.159.135.232'],
    'rewards.bing.com': ['150.171.27.10'],
    'www.bing.com': ['150.171.27.10'],
    'prod.rewardsplatform.microsoft.com': ['52.190.158.80']
};

// Pre-resolve common domains
async function preResolveHosts() {
    console.log('[SOCKET-FIX] Pre-resolving common hosts...');
    const domains = Object.keys(HARDCODED_IPS);
    
    for (const domain of domains) {
        try {
            // Try Google DNS first
            const addresses = await googleResolver.resolve4(domain);
            ipCache.set(domain, addresses);
            console.log(`[SOCKET-FIX] ✅ ${domain} -> ${addresses.join(', ')}`);
        } catch (err) {
            // Fall back to hardcoded IPs
            if (HARDCODED_IPS[domain]) {
                ipCache.set(domain, HARDCODED_IPS[domain]);
                console.log(`[SOCKET-FIX] ⚠️ ${domain} using hardcoded IPs: ${HARDCODED_IPS[domain].join(', ')}`);
            }
        }
    }
}

// ===== CRITICAL PART: Patch socket.getaddrinfo equivalent =====
// In Node.js, we need to patch net.Socket.connect and dns.lookup

// 1. Store original methods
const originalConnect = net.Socket.prototype.connect;
const originalLookup = dns.lookup;

// 2. Helper to get IP for host
function getIPForHost(host: string): string | null {
    // Check cache first
    for (const [domain, ips] of ipCache.entries()) {
        if (host === domain || host.endsWith(`.${domain}`)) {
            return ips[0]; // Return first IP
        }
    }
    
    // Check hardcoded IPs as fallback
    for (const [domain, ips] of Object.entries(HARDCODED_IPS)) {
        if (host === domain || host.endsWith(`.${domain}`)) {
            return ips[0];
        }
    }
    
    return null;
}

// 3. Patch net.Socket.connect (LOWEST LEVEL)
net.Socket.prototype.connect = function(this: any, ...args: any[]) {
    const options = args[0];
    
    if (options && typeof options === 'object') {
        const host = options.host || options.servername;
        
        if (host && typeof host === 'string') {
            const ip = getIPForHost(host);
            if (ip) {
                console.log(`[SOCKET-FIX] 🔄 Rewriting connection: ${host} -> ${ip}`);
                
                // Store original host for TLS SNI
                this._originalServername = host;
                
                // Replace host with IP
                if (options.host) options.host = ip;
                if (options.servername) options.servername = host; // Keep original for SNI
            }
        }
    }
    
    return originalConnect.apply(this, args as any);
};

// 4. Patch dns.lookup as fallback
(dns as any).lookup = function(hostname: string, options: any, callback?: any) {
    const ip = getIPForHost(hostname);
    
    if (ip) {
        console.log(`[SOCKET-FIX] DNS lookup: ${hostname} -> ${ip}`);
        
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
    }
    
    return originalLookup(hostname, options, callback);
};

// 5. Copy promisify property
(dns as any).lookup.__promisify__ = originalLookup.__promisify__;

// Run pre-resolution
preResolveHosts().then(() => {
    console.log('[SOCKET-FIX] ✅ Ready - All connections will be intercepted');
});

// Export for use
export { ipCache };