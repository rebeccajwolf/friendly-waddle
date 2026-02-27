import axios, { AxiosRequestConfig } from 'axios';
import PQueue from 'p-queue';
import https from 'https';
import tls from 'tls'; // Add this import
import type { LogLevel } from './Logger';

const DISCORD_LIMIT = 2000;

export interface DiscordConfig {
    enabled?: boolean;
    url: string;
}

const discordQueue = new PQueue({
    interval: 1000,
    intervalCap: 2,
    carryoverConcurrencyCount: true
});

function truncate(text: string): string {
    return text.length <= DISCORD_LIMIT ? text : text.slice(0, DISCORD_LIMIT - 14) + ' …(truncated)';
}

// Discord's known IPs (from your hostrules)
const DISCORD_IPS = ['162.159.138.232'];

export async function sendDiscord(discordUrl: string, content: string, level: LogLevel, originalHostname?: string): Promise<void> {
    if (!discordUrl) return;

    // Extract webhook path
    const webhookPath = discordUrl.replace(/https?:\/\/[^\/]+/, '');
    
    // Try each Discord IP
    for (const ip of DISCORD_IPS) {
        const ipUrl = `https://${ip}${webhookPath}`;
        
        const headers: Record<string, string> = { 
            'Content-Type': 'application/json',
            'Host': 'discord.com' // Always set Host header
        };

        const request: AxiosRequestConfig = {
            method: 'POST',
            url: ipUrl,
            headers,
            data: { content: truncate(content), allowed_mentions: { parse: [] } },
            timeout: 15000,
            httpsAgent: new https.Agent({
                rejectUnauthorized: false, // Allow self-signed certs
                servername: 'discord.com', // SNI for TLS
                secureProtocol: 'TLSv1_2_method', // Force TLS 1.2 (Discord requires it)
                ciphers: tls.getCiphers().join(':'), // Use all available ciphers
                honorCipherOrder: true
            })
        };

        try {
            await discordQueue.add(async () => {
                await axios(request);
                console.log(`[Discord] ✅ Sent via IP ${ip}`);
                return; // Success!
            });
            return; // Exit function on success
        } catch (err: any) {
            console.log(`[Discord] ❌ Failed via IP ${ip}: ${err.code || err.message}`);
            // Continue to next IP
        }
    }
    
    // All IPs failed
    console.error('[Discord] All IPs failed');
}

export async function flushDiscordQueue(timeoutMs = 5000): Promise<void> {
    await Promise.race([
        (async () => {
            await discordQueue.onIdle();
        })(),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('discord flush timeout')), timeoutMs))
    ]).catch(() => {});
}