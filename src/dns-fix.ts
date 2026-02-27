// dns-fix.ts - Import this FIRST in index.ts
import dns from 'dns';
import net from 'net';
import tls from 'tls';

// Force Google DNS
dns.setServers(['8.8.8.8', '8.8.4.4']);

// Pre-resolve discordapp.com (the key domain)
const RESOLVED_IPS: Record<string, string[]> = {};

async function preResolveHosts() {
    console.log('[DNS-FIX] Pre-resolving hosts...');
    const hosts = ['discordapp.com', 'gateway.discord.gg', 'api.groq.com'];
    
    for (const host of hosts) {
        try {
            const addresses = await dns.promises.resolve4(host);
            RESOLVED_IPS[host] = addresses;
            console.log(`[DNS-FIX] ✅ ${host} -> ${addresses.join(', ')}`);
        } catch (err) {
            console.log(`[DNS-FIX] ⚠️ Failed to resolve ${host}`);
        }
    }
    
    // Map discord.com to use discordapp.com IPs
    if (RESOLVED_IPS['discordapp.com']) {
        RESOLVED_IPS['discord.com'] = RESOLVED_IPS['discordapp.com'];
    }
}

// Patch socket connections at the lowest level
const originalConnect = net.Socket.prototype.connect;

net.Socket.prototype.connect = function(this: any, ...args: any[]) {
    const options = args[0];
    if (options && typeof options === 'object') {
        const host = options.host || options.servername;
        if (host && (host.includes('discord.com') || host.includes('discordapp.com'))) {
            const useHost = host.includes('discordapp.com') ? 'discordapp.com' : 'discord.com';
            if (RESOLVED_IPS[useHost]) {
                const ip = RESOLVED_IPS[useHost][0];
                console.log(`[DNS-FIX] 🔄 Rewriting connection: ${host} -> ${ip}`);
                options.host = ip;
                // Store original host for TLS SNI
                this._originalServername = host;
            }
        }
    }
    return originalConnect.apply(this, args as any);
};

// Patch TLS to use correct SNI
const originalTLSCreateSecureContext = tls.createSecureContext;
tls.createSecureContext = function(options: any) {
    if (options.servername && options.servername.includes('discord.com')) {
        // Keep original servername for SNI
        console.log(`[DNS-FIX] 🔒 TLS SNI: ${options.servername}`);
    }
    return originalTLSCreateSecureContext.call(this, options);
};

// Patch dns.lookup as fallback
const originalLookup = dns.lookup;
(dns as any).lookup = function(hostname: string, options: any, callback?: any) {
    if (hostname.includes('discord.com') || hostname.includes('discordapp.com')) {
        const useHost = hostname.includes('discordapp.com') ? 'discordapp.com' : 'discord.com';
        if (RESOLVED_IPS[useHost]) {
            const ip = RESOLVED_IPS[useHost][0];
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
        }
    }
    return originalLookup(hostname, options as any, callback as any);
};

// Run pre-resolution immediately
preResolveHosts().then(() => {
    console.log('[DNS-FIX] ✅ Ready');
});

// Export for use in other files
export { RESOLVED_IPS };