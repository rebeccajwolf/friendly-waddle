// dns-fix.ts - Import this FIRST in index.ts
import dns from 'dns';
import net from 'net';
import tls from 'tls';

// Force Google DNS
dns.setServers(['8.8.8.8', '8.8.4.4']);

// ONLY pre-resolve Discord domains
const RESOLVED_IPS: Record<string, string[]> = {};

async function preResolveHosts() {
    console.log('[DNS-FIX] Pre-resolving Discord hosts...');
    // ONLY Discord-related domains
    const hosts = ['discordapp.com', 'gateway.discord.gg', 'discord.com'];
    
    for (const host of hosts) {
        try {
            const addresses = await dns.promises.resolve4(host);
            RESOLVED_IPS[host] = addresses;
            console.log(`[DNS-FIX] ✅ ${host} -> ${addresses.join(', ')}`);
        } catch (err) {
            console.log(`[DNS-FIX] ⚠️ Failed to resolve ${host}`);
        }
    }
}

// Patch socket connections - ONLY for Discord domains
const originalConnect = net.Socket.prototype.connect;

net.Socket.prototype.connect = function(this: any, ...args: any[]) {
    const options = args[0];
    
    // ONLY intercept if this is a Discord connection
    if (options && typeof options === 'object') {
        const host = options.host || options.servername;
        
        // STRICT CHECK: Only modify Discord domains
        if (host && (
            host === 'discord.com' || 
            host === 'discordapp.com' || 
            host === 'gateway.discord.gg' ||
            host.endsWith('.discord.com') || 
            host.endsWith('.discordapp.com')
        )) {
            
            // Use discordapp.com for resolution if needed
            const resolveHost = host.includes('discordapp.com') ? 'discordapp.com' : 'discord.com';
            
            if (RESOLVED_IPS[resolveHost]) {
                // Pick first IP (avoid multiple connections)
                const ip = RESOLVED_IPS[resolveHost][0];
                console.log(`[DNS-FIX] 🔄 Discord connection: ${host} -> ${ip}`);
                
                // Store original host for TLS SNI
                options.host = ip;
                this._originalServername = host;
            }
        }
        // ALL OTHER DOMAINS (rewards.bing.com, etc.) are left untouched
    }
    
    return originalConnect.apply(this, args as any);
};

// Patch TLS - ONLY for Discord
const originalTLSCreateSecureContext = tls.createSecureContext;
tls.createSecureContext = function(options: any) {
    // Only log Discord connections, don't modify
    if (options.servername && (
        options.servername.includes('discord.com') || 
        options.servername.includes('discordapp.com')
    )) {
        console.log(`[DNS-FIX] 🔒 TLS SNI: ${options.servername}`);
    }
    return originalTLSCreateSecureContext.call(this, options);
};

// Patch dns.lookup - ONLY for Discord
const originalLookup = dns.lookup;
(dns as any).lookup = function(hostname: string, options: any, callback?: any) {
    // ONLY intercept Discord domains
    if (hostname && (
        hostname === 'discord.com' || 
        hostname === 'discordapp.com' || 
        hostname === 'gateway.discord.gg' ||
        hostname.endsWith('.discord.com') || 
        hostname.endsWith('.discordapp.com')
    )) {
        
        const resolveHost = hostname.includes('discordapp.com') ? 'discordapp.com' : 'discord.com';
        
        if (RESOLVED_IPS[resolveHost]) {
            const ip = RESOLVED_IPS[resolveHost][0];
            
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
    
    // ALL OTHER DOMAINS use original lookup
    return originalLookup(hostname, options as any, callback as any);
};

// Run pre-resolution immediately
preResolveHosts().then(() => {
    console.log('[DNS-FIX] ✅ Ready - Only Discord domains are modified');
});

// Export for use in other files
export { RESOLVED_IPS };