import axios, { AxiosRequestConfig } from 'axios';
import PQueue from 'p-queue';
import https from 'https';
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

export async function sendDiscord(discordUrl: string, content: string, level: LogLevel, originalHostname?: string): Promise<void> {
    if (!discordUrl) return;

    const headers: Record<string, string> = { 
        'Content-Type': 'application/json',
        'Host': 'discord.com'  // Always set Host header
    };

    const request: AxiosRequestConfig = {
        method: 'POST',
        url: discordUrl,  // Keep original URL with discord.com
        headers,
        data: { content: truncate(content), allowed_mentions: { parse: [] } },
        timeout: 15000,
        httpsAgent: new https.Agent({
            rejectUnauthorized: false,
            servername: 'discord.com',  // SNI for TLS
            secureOptions: require('constants').SSL_OP_NO_TLSv1 | require('constants').SSL_OP_NO_TLSv1_1, // Force TLS 1.2+
            ciphers: 'DEFAULT@SECLEVEL=1'  // Lower security level for compatibility
        })
    };

    await discordQueue.add(async () => {
        try {
            await axios(request);
        } catch (err: any) {
            // Don't log 429s
            if (err?.response?.status === 429) return;
            
            console.error('[Discord] Failed:', {
                status: err?.response?.status,
                message: err?.message,
                code: err?.code
            });
        }
    });
}

export async function flushDiscordQueue(timeoutMs = 5000): Promise<void> {
    await Promise.race([
        discordQueue.onIdle(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
    ]).catch(() => {});
}