import axios, { AxiosRequestConfig } from 'axios'
import PQueue from 'p-queue'
import https from 'https'
import dns from 'dns'  // Add this import
import type { LogLevel } from './Logger'

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

export async function sendDiscord(discordUrl: string, content: string, level: LogLevel, originalHostname?: string): Promise<void> {
    if (!discordUrl) return

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (originalHostname) {
        headers['Host'] = originalHostname
    }

    const request: AxiosRequestConfig = {
        method: 'POST',
        url: discordUrl,
        headers,
        data: { content: truncate(content), allowed_mentions: { parse: [] } },
        timeout: 10000,
        // Force IPv4 and use our patched DNS
        family: 4
    }

    if (originalHostname) {
        request.httpsAgent = new https.Agent({
            rejectUnauthorized: false,
            servername: originalHostname,
            // Force IPv4
            lookup: (hostname, options, callback) => {
                dns.lookup(hostname, { ...options, family: 4 }, callback);
            }
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