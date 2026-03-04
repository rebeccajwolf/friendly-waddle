import axios, { AxiosRequestConfig } from 'axios'
import PQueue from 'p-queue'
import https from 'https'
import type { LogLevel } from './Logger'
import type { MicrosoftRewardsBot } from '../index'
import cluster from 'cluster'

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
 * Send Discord webhook - will use browser in workers, axios in master
 * Enhanced logging for debugging
 */
export async function sendDiscord(
    discordUrl: string, 
    content: string, 
    level: LogLevel, 
    originalHostname?: string,
    bot?: MicrosoftRewardsBot
): Promise<void> {
    if (!discordUrl) return

    const processType = cluster.isWorker ? 'worker' : 'master';
    const pid = process.pid;

    // Log initial attempt
    if (bot) {
        bot.logger.debug(
            false,
            'DISCORD',
            `sendDiscord called in ${processType} (PID: ${pid}) - URL: ${discordUrl.substring(0, 50)}...`
        );
    } else {
        console.log(`[DISCORD] sendDiscord called in ${processType} (PID: ${pid}) - No bot instance`);
    }

    // Try browser first (only works in workers with ready browser)
    if (bot) {
        try {
            // Check if we're in a worker and browser might be available
            if (cluster.isWorker) {
                bot.logger.debug(
                    false,
                    'DISCORD',
                    `Attempting browser send in worker ${pid}`
                );
                
                await sendDiscordViaBrowser(discordUrl, content, level, originalHostname, bot);
                bot.logger.info(
                    false,
                    'DISCORD',
                    `✅ Discord webhook sent via browser in worker ${pid}`,
                    'green'
                );
                return;
            } else {
                bot.logger.debug(
                    false,
                    'DISCORD',
                    `Master process cannot use browser, falling back to axios`
                );
            }
        } catch (browserError) {
            // Log browser failure but continue to axios
            bot.logger.warn(
                false,
                'DISCORD',
                `Browser send failed in ${processType} ${pid}: ${browserError instanceof Error ? browserError.message : String(browserError)}`
            );
            // Fall through to axios
        }
    }

    // Fall back to axios (works in all processes)
    try {
        await sendDiscordViaAxios(discordUrl, content, level, originalHostname, bot);
        if (bot) {
            bot.logger.info(
                false,
                'DISCORD',
                `✅ Discord webhook sent via axios in ${processType} ${pid}`,
                'green'
            );
        } else {
            console.log(`[DISCORD] ✅ Webhook sent via axios in ${processType} ${pid}`);
        }
    } catch (axiosError) {
        if (bot) {
            bot.logger.error(
                false,
                'DISCORD',
                `❌ Both browser and axios failed in ${processType} ${pid}: ${axiosError instanceof Error ? axiosError.message : String(axiosError)}`
            );
        } else {
            console.error(`[DISCORD] ❌ Both browser and axios failed in ${processType} ${pid}:`, axiosError);
        }
        throw axiosError;
    }
}

/**
 * Send Discord webhook via browser (workers only)
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

    const pid = process.pid;

    bot.logger.debug(
        false,
        'DISCORD',
        `sendDiscordViaBrowser in worker ${pid} - Browser available: ${bot.browserHTTP.isAvailable()}`
    );

    const payload = {
        content: truncate(content),
        allowed_mentions: { parse: [] },
    };

    await discordQueue.add(async () => {
        try {
            bot.logger.debug(
                false,
                'DISCORD',
                `Executing browser webhook in worker ${pid}`
            );

            const startTime = Date.now();
            const response = await bot.browserHTTP.post(discordUrl, payload, {
                'Content-Type': 'application/json',
                ...(originalHostname ? { 'Host': originalHostname } : {})
            });
            const duration = Date.now() - startTime;

            if (response.status !== 204) {
                bot.logger.warn(
                    false,
                    'DISCORD',
                    `Browser webhook in worker ${pid} returned status: ${response.status} (${duration}ms)`
                );
            } else {
                bot.logger.debug(
                    false,
                    'DISCORD',
                    `Browser webhook in worker ${pid} succeeded (${duration}ms)`
                );
            }
        } catch (err: any) {
            bot.logger.error(
                false,
                'DISCORD',
                `Browser webhook failed in worker ${pid}: ${err?.message}`
            );
            throw err;
        }
    });
}

/**
 * Send Discord webhook via axios (fallback for all processes)
 */
async function sendDiscordViaAxios(
    discordUrl: string, 
    content: string, 
    level: LogLevel, 
    originalHostname?: string,
    bot?: MicrosoftRewardsBot
): Promise<void> {
    const pid = process.pid;
    const processType = cluster.isWorker ? 'worker' : 'master';

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
            if (bot) {
                bot.logger.debug(
                    false,
                    'DISCORD',
                    `Executing axios webhook in ${processType} ${pid}`
                );
            }

            const startTime = Date.now();
            await axios(request);
            const duration = Date.now() - startTime;

            if (bot) {
                bot.logger.debug(
                    false,
                    'DISCORD',
                    `Axios webhook succeeded in ${processType} ${pid} (${duration}ms)`
                );
            }
        } catch (err: any) {
            const status = err?.response?.status
            if (status === 429) {
                if (bot) {
                    bot.logger.debug(false, 'DISCORD', `Rate limited (429) in ${processType} ${pid}`);
                }
                return
            }
            
            const errorMsg = `Axios webhook failed in ${processType} ${pid}: ${err?.message} - Status: ${status}`;
            
            if (bot) {
                bot.logger.error(false, 'DISCORD', errorMsg);
            } else {
                console.error(`[DISCORD] ${errorMsg}`);
            }
            throw err;
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