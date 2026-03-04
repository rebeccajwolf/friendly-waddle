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
 * Browser requests will be queued if browser isn't ready yet
 */
export async function sendDiscord(
    discordUrl: string, 
    content: string, 
    level: LogLevel, 
    originalHostname?: string,
    bot?: MicrosoftRewardsBot
): Promise<void> {
    if (!discordUrl) return

    // If we have a bot instance, try browser first (will queue if not ready)
    if (bot) {
        try {
            // Attempt browser send - this will queue if browser isn't ready
            await sendDiscordViaBrowser(discordUrl, content, level, originalHostname, bot);
            return;
        } catch (browserError) {
            // Only log if it's not a queue/availability issue
            if (!(browserError instanceof Error && browserError.message.includes('Browser page not available'))) {
                bot.logger.warn(
                    false,
                    'DISCORD',
                    `Browser send failed, falling back to axios: ${browserError instanceof Error ? browserError.message : String(browserError)}`
                );
            }
            // Fall through to axios
        }
    }

    // Fall back to axios (always works immediately)
    await sendDiscordViaAxios(discordUrl, content, level, originalHostname, bot);
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
    if (!bot) {
        throw new Error('Bot instance required for browser requests');
    }

    const payload = {
        content: truncate(content),
        allowed_mentions: { parse: [] },
    };

    await discordQueue.add(async () => {
        try {
            // This will queue if browser isn't ready yet
            const response = await bot.browserHTTP.post(discordUrl, payload, {
                'Content-Type': 'application/json',
                ...(originalHostname ? { 'Host': originalHostname } : {})
            });

            if (response.status !== 204) {
                bot.logger.warn(
                    false,
                    'DISCORD',
                    `Browser webhook returned status: ${response.status}`
                );
            } else {
                bot.logger.debug(
                    false,
                    'DISCORD',
                    `Browser webhook sent successfully to ${discordUrl.substring(0, 50)}...`
                );
            }
        } catch (err: any) {
            bot.logger.error(
                false,
                'DISCORD',
                `Browser webhook failed: ${err?.message} - URL: ${discordUrl.substring(0, 50)}...`
            );
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
    originalHostname?: string,
    bot?: MicrosoftRewardsBot
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
            await axios(request);
            if (bot) {
                bot.logger.debug(
                    false,
                    'DISCORD',
                    `Axios webhook sent successfully to ${discordUrl.substring(0, 50)}...`
                );
            }
        } catch (err: any) {
            const status = err?.response?.status
            if (status === 429) {
                if (bot) {
                    bot.logger.debug(false, 'DISCORD', 'Rate limited (429)');
                }
                return
            }
            
            const errorMsg = `Failed to send webhook: ${err?.message} - Status: ${status} - URL: ${discordUrl.substring(0, 50)}...`;
            
            if (bot) {
                bot.logger.error(false, 'DISCORD', errorMsg);
            } else {
                console.error('[Discord]', errorMsg);
            }
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