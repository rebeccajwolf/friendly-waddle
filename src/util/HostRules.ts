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
        this.hostRules.set('rewards.bing.com', '150.171.27.10')
        this.hostRules.set('www.bing.com', '150.171.27.10')
        this.hostRules.set('account.microsoft.com', '150.171.27.10')
        this.hostRules.set('prod.rewardsplatform.microsoft.com', '52.190.158.80')
        this.hostRules.set('trends.google.com', '142.250.185.46')
        this.hostRules.set('www.bingapis.com', '150.171.73.13')
        this.hostRules.set('api.bing.com', '150.171.73.13')
        this.hostRules.set('wikimedia.org', '198.35.26.96')
        this.hostRules.set('www.reddit.com', '151.101.1.140')
        this.hostRules.set('raw.githubusercontent.com', '185.199.108.133')
        this.hostRules.set('discord.com', '162.159.133.233')
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
            let originalHostname: string | undefined
            let modified = false

            for (const [originalDomain, mappedHost] of this.hostRules.entries()) {
                const isMatch = hostname === originalDomain || hostname.endsWith(`.${originalDomain}`)

                if (isMatch) {
                    originalHostname = hostname

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
                this.bot.logger.debug(this.bot.isMobile, 'HOST-RULES', `Modified URL: ${finalUrl}`)
            }
            return { url: finalUrl, originalHostname }
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'HOST-RULES',
                `Failed to parse URL ${url}: ${error instanceof Error ? error.message : String(error)}`
            )
            return { url }
        }
    }

    buildHeaders(baseHeaders: any, urlResult: HostRuleResult, additionalHeaders?: any): any {
        const headers = {
            ...baseHeaders,
            ...additionalHeaders
        }

        if (urlResult.originalHostname) {
            headers['Host'] = urlResult.originalHostname
        }

        return headers
    }

    getHostMapping(hostname: string): string | undefined {
        return this.hostRules.get(hostname)
    }
}
