import axios, { AxiosRequestConfig } from 'axios'
import PQueue from 'p-queue'
import https from 'https'
import type { LogLevel } from './Logger'
import type { MicrosoftRewardsBot } from '../index'

const DISCORD_LIMIT = 2000

export interface DiscordConfig {
    enabled?: boolean
    url: string
}

const discordQueue = new PQueue({
    interval: 1000,
    intervalCap: 2,
    carryoverConcurrencyCount: true
})

function truncate(text: string) {
    return text.length <= DISCORD_LIMIT ? text : text.slice(0, DISCORD_LIMIT - 14) + ' …(truncated)'
}

/**
 * Send Discord webhook via browser if available, otherwise fall back to axios
 */
export async function sendDiscord(
    discordUrl: string, 
    content: string, 
    level: LogLevel, 
    originalHostname?: string,
    bot?: MicrosoftRewardsBot
): Promise<void> {
    if (!discordUrl) return

    // Try browser-based sending first if bot and browser HTTP are available
    if (bot?.browserHTTP?.isAvailable()) {
        try {
            await sendDiscordViaBrowser(discordUrl, content, level, originalHostname, bot);
            return;
        } catch (browserError) {
            console.warn('[Discord] Browser send failed, falling back to axios:', browserError);
            // Fall through to axios
        }
    }

    // Fall back to axios
    await sendDiscordViaAxios(discordUrl, content, level, originalHostname);
}

/**
 * Send Discord webhook via browser
 */
async function sendDiscordViaBrowser(
    discordUrl: string,
    content: string,
    level: LogLevel,
    originalHostname?: string,
    bot?: MicrosoftRewardsBot
): Promise<void> {
    if (!bot?.browserHTTP?.isAvailable()) {
        throw new Error('Browser HTTP not available');
    }

    const payload = {
        content: truncate(content),
        allowed_mentions: { parse: [] },
        username: 'Rewards Bot',
        avatar_url: 'https://i.imgur.com/4M34hi2.png'
    };

    await discordQueue.add(async () => {
        try {
            const response = await bot.browserHTTP!.post(discordUrl, payload, {
                'Content-Type': 'application/json',
                ...(originalHostname ? { 'Host': originalHostname } : {})
            });

            if (response.status !== 204) {
                console.warn(`[Discord] Browser webhook returned status: ${response.status}`);
            }
        } catch (err: any) {
            console.error('[Discord] Browser webhook failed:', {
                message: err?.message,
                url: discordUrl.substring(0, 50) + '...'
            });
            throw err;
        }
    });
}

/**
 * Send Discord webhook via axios (original implementation)
 */
async function sendDiscordViaAxios(
    discordUrl: string, 
    content: string, 
    level: LogLevel, 
    originalHostname?: string
): Promise<void> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (originalHostname) {
        headers['Host'] = originalHostname
    }

    const request: AxiosRequestConfig = {
        method: 'POST',
        url: discordUrl,
        headers,
        data: { content: truncate(content), allowed_mentions: { parse: [] } },
        timeout: 10000
    }

    if (originalHostname) {
        request.httpsAgent = new https.Agent({
            rejectUnauthorized: false,
            servername: originalHostname
        })
    }

    await discordQueue.add(async () => {
        try {
            await axios(request)
        } catch (err: any) {
            const status = err?.response?.status
            if (status === 429) {
                return
            }
            console.error('[Discord] Failed to send webhook:', {
                status,
                message: err?.message,
                url: discordUrl.substring(0, 50) + '...'
            })
        }
    })
}

export async function flushDiscordQueue(timeoutMs = 5000): Promise<void> {
    await Promise.race([
        (async () => {
            await discordQueue.onIdle()
        })(),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('discord flush timeout')), timeoutMs))
    ]).catch(() => {})
}