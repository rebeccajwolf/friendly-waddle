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

// Global queue for master process requests
const masterRequestQueue: Array<{
    discordUrl: string;
    content: string;
    level: LogLevel;
    originalHostname?: string;
    resolve: () => void;
    reject: (error: Error) => void;
    attempts?: number;
}> = [];

// Track which workers are processing to avoid duplicates
const processingWorkers = new Set<number>();
let queueCheckInterval: NodeJS.Timeout | null = null;

function truncate(text: string) {
    return text.length <= DISCORD_LIMIT ? text : text.slice(0, DISCORD_LIMIT - 14) + ' …(truncated)'
}

/**
 * Start periodic queue checking in worker processes
 */
export function startQueueChecker(bot: MicrosoftRewardsBot): void {
    if (!cluster.isWorker) return;
    if (queueCheckInterval) return;
    
    const workerId = process.pid;
    
    bot.logger.info(
        false,
        'DISCORD',
        `🔄 Starting queue checker in worker ${workerId}`
    );
    
    // Check queue every 5 seconds
    queueCheckInterval = setInterval(() => {
        if (masterRequestQueue.length > 0 && !processingWorkers.has(workerId)) {
            bot.logger.debug(
                false,
                'DISCORD',
                `🔍 Worker ${workerId} checking queue - ${masterRequestQueue.length} requests waiting`
            );
            processMasterQueue(bot);
        }
    }, 5000);
}

/**
 * Stop queue checker
 */
export function stopQueueChecker(): void {
    if (queueCheckInterval) {
        clearInterval(queueCheckInterval);
        queueCheckInterval = null;
    }
}

/**
 * Process master queue - called by workers when they're ready
 * Returns the number of requests processed
 */
export function processMasterQueue(bot: MicrosoftRewardsBot): number {
    if (!cluster.isWorker) return 0;
    
    const workerId = process.pid;
    
    if (masterRequestQueue.length === 0) {
        return 0;
    }
    
    // Don't let multiple workers process the same queue simultaneously
    if (processingWorkers.has(workerId)) {
        bot.logger.debug(
            false,
            'DISCORD',
            `⚠️ Worker ${workerId} already processing queue, skipping`
        );
        return 0;
    }
    
    processingWorkers.add(workerId);
    
    const queueSize = masterRequestQueue.length;
    bot.logger.info(
        false,
        'DISCORD',
        `📦 Worker ${workerId} processing ${queueSize} queued master requests`
    );
    
    let processed = 0;
    
    // Process all queued requests WITHOUT waiting for them to complete
    // This ensures they run in parallel with other operations
    while (masterRequestQueue.length > 0) {
        const request = masterRequestQueue.shift();
        if (request) {
            processed++;
            
            // Send the webhook asynchronously - don't await
            sendDiscordViaBrowser(
                request.discordUrl,
                request.content,
                request.level,
                request.originalHostname,
                bot
            ).then(() => {
                bot.logger.debug(
                    false,
                    'DISCORD',
                    `✅ Queued master webhook sent successfully in worker ${workerId}`
                );
                request.resolve();
            }).catch((error) => {
                bot.logger.error(
                    false,
                    'DISCORD',
                    `❌ Queued master webhook failed in worker ${workerId}: ${error.message}`
                );
                request.reject(error);
            });
        }
    }
    
    bot.logger.info(
        false,
        'DISCORD',
        `📊 Worker ${workerId} initiated ${processed} queued webhook requests`
    );
    
    processingWorkers.delete(workerId);
    return processed;
}

/**
 * Send Discord webhook - Master queues, workers execute via browser
 */
export async function sendDiscord(
    discordUrl: string, 
    content: string, 
    level: LogLevel, 
    originalHostname?: string,
    bot?: MicrosoftRewardsBot
): Promise<void> {
    if (!discordUrl) return

    const pid = process.pid;

    // If we're in master process, queue the request for workers
    if (!cluster.isWorker) {
        return new Promise((resolve, reject) => {
            masterRequestQueue.push({
                discordUrl,
                content,
                level,
                originalHostname,
                resolve,
                reject,
                attempts: 0
            });
            
            if (bot) {
                bot.logger.info(
                    false,
                    'DISCORD',
                    `📥 Discord webhook queued in master (PID: ${pid}) - Queue size: ${masterRequestQueue.length}`
                );
            }
        });
    }

    // We're in a worker process - execute via browser
    if (!bot) {
        throw new Error('Bot instance required for browser requests in worker');
    }

    // Log initial attempt
    bot.logger.info(
        false,
        'DISCORD',
        `📤 Discord webhook triggered in worker (PID: ${pid}) - URL: ${discordUrl.substring(0, 50)}...`
    );

    // Always use browser HTTP - it will queue if not ready
    try {
        await sendDiscordViaBrowser(discordUrl, content, level, originalHostname, bot);
        
        bot.logger.info(
            false,
            'DISCORD',
            `✅ Discord webhook sent successfully via browser in worker ${pid}`,
            'green'
        );
    } catch (error) {
        bot.logger.error(
            false,
            'DISCORD',
            `❌ Discord webhook failed in worker ${pid}: ${error instanceof Error ? error.message : String(error)}`
        );
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
                `🔄 Sending Discord webhook via browser in worker ${pid} (will queue if browser not ready)`
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
                    `⚠️ Discord webhook in worker ${pid} returned unexpected status: ${response.status} (${duration}ms)`
                );
            } else {
                bot.logger.debug(
                    false,
                    'DISCORD',
                    `✅ Discord webhook in worker ${pid} succeeded (${duration}ms)`
                );
            }
        } catch (err: any) {
            bot.logger.error(
                false,
                'DISCORD',
                `❌ Discord webhook failed in worker ${pid}: ${err?.message}`
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
    
    // Also try to process any remaining master queue requests
    if (cluster.isWorker && masterRequestQueue.length > 0) {
        console.log(`[DISCORD] Warning: ${masterRequestQueue.length} master requests still queued on flush`);
    }
}

// Also export the queue for monitoring
export function getMasterQueueSize(): number {
    return masterRequestQueue.length;
}