import axios from 'axios';
import PQueue from 'p-queue';
import https from 'https';
import type { LogLevel } from './Logger';

const DISCORD_LIMIT = 2000;
const discordQueue = new PQueue({ interval: 1000, intervalCap: 2 });

function truncate(text: string): string {
    return text.length <= DISCORD_LIMIT ? text : text.slice(0, DISCORD_LIMIT - 14) + ' …(truncated)';
}

export async function sendDiscord(discordUrl: string, content: string, level: LogLevel, originalHostname?: string): Promise<void> {
    if (!discordUrl) return;

    // Extract webhook info
    const match = discordUrl.match(/\/webhooks\/(\d+)\/([^\/]+)/);
    if (!match) return;

    // If originalHostname is discord.com, use discordapp.com endpoint
    // Otherwise keep original URL (for other services like ntfy)
    let webhookUrl = discordUrl;
    if (originalHostname === 'discord.com') {
        webhookUrl = `https://discordapp.com/api/webhooks/${match[1]}/${match[2]}`;
    }

    await discordQueue.add(async () => {
        try {
            await axios.post(webhookUrl, {
                content: truncate(content),
                allowed_mentions: { parse: [] }
            }, {
                timeout: 15000,
                httpsAgent: originalHostname === 'discord.com' ? new https.Agent({
                    rejectUnauthorized: false,
                    servername: 'discordapp.com'
                }) : undefined
            });
        } catch (err: any) {
            if (err?.response?.status !== 429) {
                console.error('[Discord] Failed:', err.message);
            }
        }
    });
}}

export async function flushDiscordQueue(timeoutMs = 5000): Promise<void> {
    await Promise.race([
        discordQueue.onIdle(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
    ]).catch(() => {});
}