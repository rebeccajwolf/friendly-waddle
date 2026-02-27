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

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (originalHostname) {
        headers['Host'] = originalHostname;
    }

    const request: AxiosRequestConfig = {
        method: 'POST',
        url: discordUrl,
        headers,
        data: { content: truncate(content), allowed_mentions: { parse: [] } },
        timeout: 20000, // INCREASED FROM 10000ms TO 20000ms
        // Add these options to help with slow connections
        maxContentLength: 2000,
        maxBodyLength: 2000
    };

    if (originalHostname) {
        request.httpsAgent = new https.Agent({
            rejectUnauthorized: false,
            servername: originalHostname,
            keepAlive: true, // Keep connection alive
            timeout: 20000 // Agent timeout
        });
    }

    await discordQueue.add(async () => {
        // Add retry logic with exponential backoff
        const maxRetries = 3;
        for (let i = 0; i < maxRetries; i++) {
            try {
                await axios(request);
                return; // Success!
            } catch (err: any) {
                const status = err?.response?.status;
                if (status === 429) {
                    // Rate limited - Discord's docs say wait and retry [citation:1]
                    const retryAfter = err?.response?.headers?.['retry-after'] || 5;
                    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                    continue;
                }
                
                // If it's a timeout and we have retries left, wait and retry
                if (err.code === 'ECONNABORTED' && i < maxRetries - 1) {
                    console.log(`[Discord] Timeout, retrying (${i + 1}/${maxRetries})...`);
                    await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1))); // Exponential backoff
                    continue;
                }
                
                // Other errors - log but don't retry
                if (i === maxRetries - 1 || (status && status !== 429)) {
                    console.error('[Discord] Failed to send webhook:', {
                        status,
                        message: err?.message,
                        code: err?.code,
                        url: discordUrl.substring(0, 50) + '...'
                    });
                }
            }
        }
    });
}

export async function flushDiscordQueue(timeoutMs = 5000): Promise<void> {
    await Promise.race([
        (async () => {
            await discordQueue.onIdle();
        })(),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('discord flush timeout')), timeoutMs))
    ]).catch(() => {});
}