import type { MicrosoftRewardsBot } from '../index'

export interface HostRuleResult {
    url: string
    originalHostname?: string
}

export class HostRulesManager {
    private bot: MicrosoftRewardsBot
    private hostRules: Map<string, string> = new Map()

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
        this.initializeHostRules()
    }

    private initializeHostRules(): void {
        // Keep all domains - net-patch handles resolution but we still need Host headers
        this.hostRules.set('rewards.bing.com', '150.171.30.10')
        this.hostRules.set('www.bing.com', '2.18.67.162')
        this.hostRules.set('account.microsoft.com', '150.171.30.10')
        this.hostRules.set('prod.rewardsplatform.microsoft.com', '13.107.213.40')
        this.hostRules.set('login.live.com', '13.107.213.40')
        this.hostRules.set('www.bingapis.com', '2.18.67.162')
        this.hostRules.set('api.bing.com', '2.18.67.162')
        this.hostRules.set('discord.com', '162.159.135.232')
        this.hostRules.set('gateway.discord.gg', '162.159.135.232')
        this.hostRules.set('cdn.discordapp.com', '162.159.135.232')
        this.hostRules.set('discordapp.com', '162.159.135.232')
        this.hostRules.set('trends.google.com', '142.250.185.46')
        this.hostRules.set('wikimedia.org', '198.35.26.96')
        this.hostRules.set('www.reddit.com', '151.101.1.140')
        this.hostRules.set('raw.githubusercontent.com', '185.199.108.133')
    }

    private isIPv6(host: string): boolean {
        return host.includes(':')
    }

    applyHostRules(url: string): HostRuleResult {
        if (this.hostRules.size === 0) {
            return { url }
        }

        try {
            const urlObj = new URL(url)
            const hostname = urlObj.hostname
            let originalHostname: string | undefined = hostname // Default to current hostname
            let modified = false

            // Try to find a matching domain in our rules
            for (const [originalDomain, mappedHost] of this.hostRules.entries()) {
                const isMatch = hostname === originalDomain || hostname.endsWith(`.${originalDomain}`)

                if (isMatch) {
                    originalHostname = originalDomain // Store the original domain for Host header
                    
                    try {
                        if (this.isIPv6(mappedHost)) {
                            urlObj.hostname = `[${mappedHost}]`
                        } else {
                            urlObj.hostname = mappedHost
                        }
                        modified = true
                        break
                    } catch (error) {
                        this.bot.logger.error(
                            this.bot.isMobile,
                            'HOST-RULES',
                            `Failed to apply host ${mappedHost}: ${error instanceof Error ? error.message : String(error)}`
                        )
                    }
                }
            }

            const finalUrl = urlObj.toString()
            if (modified) {
                this.bot.logger.debug(this.bot.isMobile, 'HOST-RULES', 
                    `Modified: ${hostname} -> ${urlObj.hostname} (Host: ${originalHostname})`)
            }
            
            // Always return originalHostname (even for non-modified domains)
            return { url: finalUrl, originalHostname }
            
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'HOST-RULES',
                `Failed to parse URL ${url}: ${error instanceof Error ? error.message : String(error)}`
            )
            return { url, originalHostname: new URL(url).hostname }
        }
    }

    buildHeaders(baseHeaders: any, urlResult: HostRuleResult, additionalHeaders?: any): any {
        const headers = {
            ...baseHeaders,
            ...additionalHeaders
        }

        // CRITICAL: Always set Host header if we have originalHostname
        if (urlResult.originalHostname) {
            headers['Host'] = urlResult.originalHostname
            // Debug log
            console.log(`[HOST-RULES] Setting Host header: ${urlResult.originalHostname}`);
        }

        return headers
    }

    getHostMapping(hostname: string): string | undefined {
        return this.hostRules.get(hostname)
    }
}