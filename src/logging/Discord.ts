import axios, { AxiosRequestConfig } from 'axios'
import PQueue from 'p-queue'
import { Agent as HttpAgent } from 'http'
import { Agent as HttpsAgent } from 'https'
import { lookup } from 'dns'
import { promisify } from 'util'
import type { LogLevel } from './Logger'
import type { MicrosoftRewardsBot } from '../index'
import { HostRulesManager } from '../util/HostRules'

const dnsLookup = promisify(lookup)

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

let hostRulesManager: HostRulesManager | null = null

function getHostRulesManager(bot: MicrosoftRewardsBot): HostRulesManager {
    if (!hostRulesManager) {
        hostRulesManager = new HostRulesManager(bot)
    }
    return hostRulesManager
}

function truncate(text: string) {
    return text.length <= DISCORD_LIMIT ? text : text.slice(0, DISCORD_LIMIT - 14) + ' …(truncated)'
}

export async function sendDiscord(discordUrl: string, content: string, level: LogLevel, bot?: MicrosoftRewardsBot): Promise<void> {
    if (!discordUrl) return

    let finalUrl = discordUrl
    let headers: any = { 'Content-Type': 'application/json' }

    if (bot) {
        const hostRules = getHostRulesManager(bot)
        const urlResult = hostRules.applyHostRules(discordUrl)
        finalUrl = urlResult.url
        headers = hostRules.buildHeaders(headers, urlResult)

        if (urlResult.originalHostname) {
            bot.logger.debug('main', 'DISCORD-HOST-RULES', `Applied host rules | Original URL: ${discordUrl} | Modified URL: ${finalUrl} | Host header: ${urlResult.originalHostname}`)
        }
    }

    const capturedUrl = finalUrl
    const capturedHeaders = { ...headers }
    const truncatedContent = truncate(content)

    await discordQueue.add(async () => {
        const customLookup = (hostname: string, options: any, callback: any) => {
            if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
                callback(null, hostname, 4)
            } else {
                lookup(hostname, options, callback)
            }
        }

        const httpAgent = new HttpAgent({ keepAlive: false, lookup: customLookup })
        const httpsAgent = new HttpsAgent({ keepAlive: false, lookup: customLookup })

        const request: AxiosRequestConfig = {
            method: 'POST',
            url: capturedUrl,
            headers: capturedHeaders,
            data: { content: truncatedContent, allowed_mentions: { parse: [] } },
            timeout: 10000,
            maxRedirects: 0,
            validateStatus: (status) => status >= 200 && status < 400,
            httpAgent,
            httpsAgent
        }

        if (bot) {
            bot.logger.debug('main', 'DISCORD-REQUEST', `Sending to URL: ${capturedUrl.substring(0, 80)}`)
        }

        try {
            await axios(request)
        } catch (err: any) {
            const status = err?.response?.status
            if (status === 429) {
                console.warn('[Discord] Rate limited (429)')
                return
            }
            console.error('[Discord] Failed to send webhook:', {
                status,
                message: err?.message,
                url: capturedUrl.substring(0, 50) + '...'
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
