// dns-fix.ts - SIMPLIFIED - ONLY use discordapp.com
import dns from 'dns';

// Force Google DNS
dns.setServers(['8.8.8.8', '8.8.4.4']);

// Pre-resolve discordapp.com (the only domain we need)
async function preResolveHosts() {
    console.log('[DNS-FIX] Pre-resolving discordapp.com...');
    try {
        const addresses = await dns.promises.resolve4('discordapp.com');
        console.log(`[DNS-FIX] ✅ discordapp.com -> ${addresses.join(', ')}`);
    } catch (err) {
        console.log(`[DNS-FIX] ⚠️ Failed to resolve discordapp.com`);
    }
}

// Run pre-resolution
preResolveHosts().then(() => {
    console.log('[DNS-FIX] ✅ Ready');
});

// NO socket patching - let connections go through normally
// NO IP replacement - let discordapp.com resolve normally