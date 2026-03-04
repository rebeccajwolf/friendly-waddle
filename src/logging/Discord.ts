import PQueue from 'p-queue'
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
 * Send Discord webhook - ALWAYS uses browser HTTP with queuing
 * Master process will queue requests for workers to handle
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
        bot.logger.info(
            false,
            'DISCORD',
            `📤 Discord webhook triggered in ${processType} (PID: ${pid}) - URL: ${discordUrl.substring(0, 50)}...`
        );
    }

    // ALWAYS use browser HTTP - it will queue if not ready
    try {
        await sendDiscordViaBrowser(discordUrl, content, level, originalHostname, bot);
        
        if (bot) {
            bot.logger.info(
                false,
                'DISCORD',
                `✅ Discord webhook sent successfully via browser in ${processType} ${pid}`,
                'green'
            );
        }
    } catch (error) {
        if (bot) {
            bot.logger.error(
                false,
                'DISCORD',
                `❌ Discord webhook failed in ${processType} ${pid}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
        throw error;
    }
}

/**
 * Send Discord webhook via browser - will queue if browser not ready
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
    const processType = cluster.isWorker ? 'worker' : 'master';

    // Log queue stats before attempt
    const queueStats = bot.browserHTTP.getQueueStats();
    bot.logger.debug(
        false,
        'DISCORD',
        `📊 BrowserHTTP queue stats before request: Processed=${queueStats.totalProcessed}, Failed=${queueStats.totalFailed}, Queue=${queueStats.currentQueueSize}`
    );

    const payload = {
        content: truncate(content),
        allowed_mentions: { parse: [] },
        username: 'Rewards Bot',
    };

    await discordQueue.add(async () => {
        try {
            bot.logger.debug(
                false,
                'DISCORD',
                `🔄 Sending Discord webhook via browser in ${processType} ${pid} (will queue if browser not ready)`
            );

            const startTime = Date.now();
            
            // This will queue automatically if browser isn't ready
            const response = await bot.browserHTTP.post(discordUrl, payload, {
                'Content-Type': 'application/json',
                ...(originalHostname ? { 'Host': originalHostname } : {})
            }, 'high'); // High priority for webhooks
            
            const duration = Date.now() - startTime;

            if (response.status !== 204) {
                bot.logger.warn(
                    false,
                    'DISCORD',
                    `⚠️ Discord webhook in ${processType} ${pid} returned unexpected status: ${response.status} (${duration}ms)`
                );
            } else {
                bot.logger.debug(
                    false,
                    'DISCORD',
                    `✅ Discord webhook in ${processType} ${pid} succeeded (${duration}ms)`
                );
            }
        } catch (err: any) {
            bot.logger.error(
                false,
                'DISCORD',
                `❌ Discord webhook failed in ${processType} ${pid}: ${err?.message}`
            );
            throw err;
        }
    });
}

export async function flushDiscordQueue(timeoutMs = 5000): Promise<void> {
    await Promise.race([
        (async () => {
            await discordQueue.onIdle()
        })(),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('discord flush timeout')), timeoutMs))
    ]).catch(() => {})
}